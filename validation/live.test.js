import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fetchLiveSnapshot, createDataSource, isUsableEncounterData, MAX_REFRESH_CREDITS } from './live.js';
import { makeToolExecutor } from './tools.js';

const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/snapshot.fixture.json', import.meta.url)));
const WALLET = '0xc26cbb6483229e0d0f9a1cab675271eda535b8f4';

/** Stub Nansen caller that records what was asked for and serves fixture rows. */
function stubCaller({ pages = 3, perPage = 2, fail = null } = {}) {
  const seen = [];
  const rows = fixture.trades_30d;
  return {
    seen,
    async call(pathName, body) {
      seen.push({ path: pathName, body });
      if (fail && seen.length === fail) throw new Error('stub failure');
      if (pathName === 'profiler/perp-pnl-summary') {
        const days = Math.round((Date.parse(body.date.to) - Date.parse(body.date.from)) / 86400_000);
        return { status: 200, data: { data: days === 7 ? fixture.pnl_summary_7d : fixture.pnl_summary_30d } };
      }
      const page = body.pagination.page;
      const slice = rows.slice((page - 1) * perPage, page * perPage);
      return { status: 200, data: { data: slice, pagination: { is_last_page: page >= pages } } };
    },
  };
}

test('a live refresh costs at most 5 credits and declares its fill coverage', async () => {
  const stub = stubCaller({ pages: 9, perPage: 2 });
  const snap = await fetchLiveSnapshot(WALLET, { caller: stub.call, perPage: 2, maxTradePages: 3 });
  assert.equal(stub.seen.length, 5, 'two summaries plus three fill pages');
  assert.equal(MAX_REFRESH_CREDITS, 5);
  assert.equal(stub.seen[0].path, 'profiler/perp-pnl-summary');
  assert.equal(stub.seen[2].body.order_by[0].direction, 'DESC', 'newest fills first');
  assert.equal(snap.source, 'live');
  assert.equal(snap.wallet, WALLET);
  assert.equal(snap.fills_coverage.complete, false);
  assert.equal(snap.fills_coverage.fills, 6);
  assert.equal(snap.reconciliation.skipped, 'partial fill coverage');
  // Fills are re-sorted oldest first, as every downstream consumer expects.
  const stamps = snap.trades_30d.map(t => Date.parse(t.timestamp));
  assert.deepEqual(stamps, [...stamps].sort((a, b) => a - b));
});

test('a short history stops early and reports complete coverage', async () => {
  const stub = stubCaller({ pages: 1, perPage: 2 });
  const snap = await fetchLiveSnapshot(WALLET, { caller: stub.call, perPage: 2, maxTradePages: 3 });
  assert.equal(stub.seen.length, 3, 'stopped after the last page');
  assert.equal(snap.fills_coverage.complete, true);
  assert.equal(snap.trades_pagination.is_complete, true);
  assert.ok(snap.reconciliation.fills_fetched >= 0);
});

test('partial live fills are declared to the agent in the tool response', async () => {
  const stub = stubCaller({ pages: 9, perPage: 2 });
  const snap = await fetchLiveSnapshot(WALLET, { caller: stub.call, perPage: 2, maxTradePages: 3 });
  snap.fills_coverage.covers_7d = false;
  const executor = makeToolExecutor(snap, { mode: 'armed' });
  const thirty = await executor.execute('get_closed_trades', { wallet: WALLET, days: 30, order: 'worst', limit: 2 });
  assert.equal(thirty.data_coverage.complete, false);
  assert.match(thirty.data_coverage.note, /UNDERSTATE/);
  assert.match(thirty.data_coverage.note, /get_pnl_summary is the authoritative total/);
  // The 30-day summary is complete either way, and carries no coverage caveat.
  const summary = await executor.execute('get_pnl_summary', { wallet: WALLET, days: 30 });
  assert.equal(summary.data_coverage, undefined);
  assert.equal(summary.realized_pnl_usd, -4745429.48);
});

test('a frozen snapshot carries no coverage caveat at all', async () => {
  const executor = makeToolExecutor(fixture, { mode: 'armed' });
  const result = await executor.execute('get_closed_trades', { wallet: WALLET, days: 30, order: 'worst', limit: 2 });
  assert.equal(result.data_coverage, undefined);
});

test('isUsableEncounterData rejects a winning or incomplete record', () => {
  assert.equal(isUsableEncounterData(fixture), true);
  assert.equal(isUsableEncounterData({ ...fixture, pnl_summary_30d: { ...fixture.pnl_summary_30d, realized_pnl_usd: 5 } }), false);
  assert.equal(isUsableEncounterData({ ...fixture, pnl_summary_7d: null }), false);
  assert.equal(isUsableEncounterData(null), false);
});

test('the data source caches within its TTL and refreshes after it', async () => {
  let fetches = 0;
  let clock = Date.parse('2026-09-18T12:00:00Z');
  const source = createDataSource({
    fallback: fixture, wallet: WALLET, ttlMs: 60_000, now: () => clock,
    fetcher: async () => { fetches += 1; return { ...fixture, source: 'live', retrieved_at: new Date(clock).toISOString() }; },
  });
  await source.refresh();
  await source.refresh();
  assert.equal(fetches, 1, 'second call inside the TTL spends nothing');
  clock += 61_000;
  await source.refresh();
  assert.equal(fetches, 2);
  assert.equal(source.status().live, true);
});

test('concurrent refreshes share one fetch', async () => {
  let fetches = 0;
  const source = createDataSource({
    fallback: fixture, wallet: WALLET,
    fetcher: async () => { fetches += 1; await new Promise(r => setTimeout(r, 10)); return { ...fixture, source: 'live' }; },
  });
  await Promise.all([source.refresh(), source.refresh(), source.refresh()]);
  assert.equal(fetches, 1);
});

test('live refresh can be disabled outright', async () => {
  let fetches = 0;
  const source = createDataSource({
    fallback: fixture, wallet: WALLET, enabled: false, fetcher: async () => { fetches += 1; return fixture; },
  });
  const status = await source.refresh({ force: true });
  assert.equal(fetches, 0);
  assert.equal(status.live, false);
  assert.match(status.lastError, /disabled/);
});

test('a failed refresh keeps serving the fallback', async () => {
  const source = createDataSource({
    fallback: fixture, wallet: WALLET, fetcher: async () => { throw new Error('Nansen 500'); },
  });
  const status = await source.refresh();
  assert.equal(status.live, false);
  assert.equal(source.data, fixture);
  assert.match(status.lastError, /Nansen 500/);
});
