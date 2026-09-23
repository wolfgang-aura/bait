/**
 * The Pitch Room's live Nansen read, driven by a mocked Nansen client. Nothing here
 * reaches the network, spends a credit or writes the call ledger.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stubProvider } from '../validation/providers.js';
import { createLiveEvidence, liveSnapshot, LIVE_READ_CREDITS, ROOM_LIVE_GUARD_POLICY } from './live-evidence.js';
import { createRoomService, createLeaderboardStore, loadRoster, SHOTS, SLOT } from './room.js';

const T0 = new Date('2026-09-23T10:15:00Z');
const GRINDER = '0xc26cbb6483229e0d0f9a1cab675271eda535b8f4';

/** A mocked `call` with the real response shape. Counts every request it sees. */
function mockNansen({ pnl30 = -2_000_000, pnl7 = 15_000, fail = null, hang = false } = {}) {
  const seen = [];
  const call = async (pathName, body, opts) => {
    seen.push({ pathName, body, opts });
    if (hang) return new Promise(() => {});
    if (fail) throw Object.assign(new Error(`Nansen ${fail} on ${pathName}`), { status: fail });
    const days = Math.round((Date.parse(body.date.to) - Date.parse(body.date.from)) / 86_400_000);
    return {
      status: 200,
      headers: { 'x-nansen-credits-cost': '1' },
      data: { data: {
        realized_pnl_usd: days === 7 ? pnl7 : pnl30, win_rate: 0.55, closed_trade_count: 321,
        winning_trade_count: 177, fees_usd: 12, traded_coin_count: 4,
        top5_coins: [{ coin: 'HYPE', realized_pnl_usd: 40_000 }],
      } },
    };
  };
  return { call, seen };
}

const reader = (mock, extra = {}) => createLiveEvidence({
  enabled: true, keyPresent: true, call: mock.call, now: () => T0, fillPages: 0, ...extra,
});

// ----------------------------------------------------------------- the reader

test('one read is two summaries, and a second pick inside 30 minutes is a cache hit', async () => {
  const mock = mockNansen();
  const live = reader(mock);
  const first = await live.read(GRINDER);
  assert.equal(first.live, true);
  assert.equal(first.cached, false);
  assert.equal(first.fetchedAt, '2026-09-23T10:15:00Z');
  assert.equal(first.summary30.realized_pnl_usd, -2_000_000);
  assert.equal(first.summary7.realized_pnl_usd, 15_000);
  assert.deepEqual(mock.seen.map(c => c.pathName), ['profiler/perp-pnl-summary', 'profiler/perp-pnl-summary']);
  assert.ok(mock.seen.every(c => /^room live \d+d summary$/.test(c.opts.note)), 'every call is labelled in the ledger');

  const again = await live.read(GRINDER.toUpperCase().replace('0X', '0x'));
  assert.equal(again.cached, true);
  assert.equal(mock.seen.length, 2, 'the cache hit made no request');
  const status = live.status();
  assert.equal(status.credits_today, LIVE_READ_CREDITS);
  assert.equal(status.credits_total, LIVE_READ_CREDITS);
  assert.equal(status.last_live_success_at !== null, true);
});

test('the cache expires after 30 minutes and buys a fresh read', async () => {
  const mock = mockNansen();
  let clock = T0;
  const live = reader(mock, { now: () => clock });
  await live.read(GRINDER);
  clock = new Date(T0.getTime() + 31 * 60_000);
  const fresh = await live.read(GRINDER);
  assert.equal(fresh.cached, false);
  assert.equal(mock.seen.length, 4);
});

test('the daily cap and the total cap refuse before any request leaves', async () => {
  const mock = mockNansen();
  const daily = reader(mock, { dailyCap: 3 });
  assert.equal((await daily.read(GRINDER)).live, true);
  const refused = await daily.read('0x7fdafde5cfb5465924316eced2d3715494c517d1');
  assert.equal(refused.live, false);
  assert.equal(refused.code, 'daily_cap');
  assert.match(refused.reason, /2 of 3/);
  assert.equal(mock.seen.length, 2, 'the capped read made no request');
  assert.equal(daily.available(), false);

  const other = mockNansen();
  const total = reader(other, { totalCap: 1 });
  const none = await total.read(GRINDER);
  assert.equal(none.code, 'total_cap');
  assert.equal(other.seen.length, 0);
});

test('a hung provider times out, falls back and keeps the credits reserved', async () => {
  const mock = mockNansen({ hang: true });
  const live = reader(mock, { timeoutMs: 30 });
  const read = await live.read(GRINDER);
  assert.equal(read.live, false);
  assert.equal(read.code, 'timeout');
  assert.match(read.reason, /timed out/);
  assert.equal(live.status().credits_today, LIVE_READ_CREDITS, 'a request we stopped waiting for may still be billed');
  assert.equal(live.status().last_live_failure.code, 'timeout');
});

test('no key, or live reads switched off, makes no request at all', async () => {
  const mock = mockNansen();
  const noKey = createLiveEvidence({ enabled: true, keyPresent: false, call: mock.call });
  assert.deepEqual(await noKey.read(GRINDER), { live: false, code: 'no_key', reason: 'no Nansen key is configured' });
  const off = createLiveEvidence({ enabled: false, keyPresent: true, call: mock.call });
  assert.equal((await off.read(GRINDER)).code, 'disabled');
  assert.equal(mock.seen.length, 0);
  assert.equal(noKey.status().available, false);
  assert.equal(noKey.status().blocked_by, 'no_key');
});

test('a provider error or an incomplete summary is a fallback, never a number', async () => {
  const err = await reader(mockNansen({ fail: 503 })).read(GRINDER);
  assert.equal(err.live, false);
  assert.equal(err.code, 'provider_error');

  const broken = mockNansen();
  const call = async (...args) => { const r = await broken.call(...args); delete r.data.data.win_rate; return r; };
  const partial = await createLiveEvidence({ enabled: true, keyPresent: true, call, now: () => T0 }).read(GRINDER);
  assert.equal(partial.code, 'unusable');
});

test('the counter survives a restart when it has a file to live in', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bait-live-')), 'credits.json');
  const mock = mockNansen();
  await reader(mock, { stateFile: file }).read(GRINDER);
  const reborn = reader(mockNansen(), { stateFile: file });
  assert.equal(reborn.status().credits_today, LIVE_READ_CREDITS);
  assert.equal(reborn.status().credits_total, LIVE_READ_CREDITS);
  assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /apikey|NANSEN_API_KEY/i);
});

test('the live snapshot keeps the capture\'s fill tape and says it is not live', () => {
  const roster = loadRoster();
  const grinder = roster.find(p => p.id === 'grinder');
  const read = { live: true, fetchedAt: '2026-09-23T10:15:00Z', endpoint: 'profiler/perp-pnl-summary', windows: { '30d': { from: 'a', to: 'b' }, '7d': { from: 'c', to: 'b' } },
    summary30: { realized_pnl_usd: -1, win_rate: 0.5, closed_trade_count: 1, top5_coins: [] }, summary7: { realized_pnl_usd: 1, win_rate: 0.5, closed_trade_count: 1, top5_coins: [] } };
  const snap = liveSnapshot(grinder.snapshot, read);
  assert.equal(snap.source, 'live');
  assert.equal(snap.retrieved_at, '2026-09-23T10:15:00Z');
  assert.equal(snap.trades_pagination.is_complete, false);
  assert.equal(snap.fills_coverage.from_capture, grinder.snapshot.retrieved_at);
  assert.equal(snap.live_read.fills_from_capture, grinder.snapshot.retrieved_at);
});

// ------------------------------------------------------------------- the room

const answer = (committed, mood, line) => [
  { text: '{"valid":true,"reason":""}' },
  { text: `Reasoning.\n{"allocation": ${committed}, "mood": "${mood}", "line": "${line}"}\nALLOCATION: ${Math.round((committed / SLOT) * 100)}` },
];

function liveRoom(script, mock, extra = {}) {
  const board = createLeaderboardStore(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bait-room-live-')), 'lb.json'));
  const live = reader(mock, { now: () => new Date(), ...extra });
  const service = createRoomService({
    roster: loadRoster(), provider: stubProvider(script), leaderboard: board, liveEvidence: live,
  });
  return { service, live };
}
const say = (service, id, n, text) => service.pitch(id, { requestId: `live-test-${n}-aaaa`, shot: n, text });

test('a Hyperliquid round plays the live read: truth, dossier, every wire and the reveal', async () => {
  const mock = mockNansen({ pnl30: -2_000_000, pnl7: 15_000 });
  const { service } = liveRoom([
    ...answer(5000, 'intrigued', 'Opening small.'),
  ], mock);

  const config = await service.config();
  assert.equal(config.evidence.live, false, 'nothing is live before a pick');
  assert.equal(config.evidence.liveReady, true);
  assert.equal(mock.seen.length, 0, 'loading the page buys nothing');

  const round = await service.start({ prospect: 'grinder' });
  assert.equal(round.evidence.live, true);
  assert.match(round.evidence.fetchedLabel, /^\d\d:\d\d UTC$/);
  assert.equal(round.evidence.credits, LIVE_READ_CREDITS);
  assert.equal('truth' in round.prospect, false, 'the live record is sealed until the verdict');
  assert.equal(round.dossier.sealed.mustNotMention, true);
  assert.match(round.dossier.evidenceLabel, /^live Nansen read /);

  const one = await say(service, round.id, 0, '+$15,000 realised over the last 7 days.');
  const wire = one.shots[0].wire;
  assert.equal(wire.decision, 'block');
  assert.equal(wire.pnlLabel, '-$2,000,000', 'the gate judged the live number');
  assert.equal(wire.policyId, ROOM_LIVE_GUARD_POLICY.id);
  assert.equal(wire.live, true);
  assert.equal(one.finished, true, 'the desk agreed to send money, so the round is over');
  assert.equal(one.prospect.truth.availability, 'live');
  assert.equal(one.prospect.truth.pnl, -2_000_000);
  assert.equal(one.prospect.truth.pnlLabel, '-$2,000,000');
  assert.match(one.prospect.truth.capturedLabel, /^2026-\d\d-\d\d \d\d:\d\d UTC$/);
  assert.match(one.prospect.truth.scope, /summaries read live, fill tape from the 2026-09-15 UTC capture/);
  assert.equal(one.dossier.buried.value, '-$2,000,000');
  assert.equal(mock.seen.length, 2, 'one wire, one read');

  const { final } = await service.finish(round.id, {});
  assert.equal(final.gate.pnlLabel, '-$2,000,000');
  assert.equal(mock.seen.length, 2, 'the verdict card reuses the same read');
  assert.equal(final.gate.live, true);
  const fresh = final.gate.checks.find(c => c.id === 'evidence_freshness');
  assert.equal(fresh.result, 'pass');
  assert.match(fresh.plain, /^Live Nansen read at \d\d:\d\d UTC, \d+ min old when this wire was checked \(limit 60 min\)\.$/);
  assert.equal(final.evidence.live, true);
  assert.match(final.agentLine, /^The live Nansen read found negative realised PnL/);
  // The gate table states the tape's capture and age; a days-old tape is marked stale.
  assert.ok(final.gate.tape.capturedAt, 'the tape capture date is on the gate result');
  assert.equal(final.gate.tape.stale, final.gate.tape.ageMs > final.gate.tape.maxAgeMs);
  assert.equal(final.gate.tape.stale, true, 'a live read today over a September capture tape is stale');
});

test('a live record that is no longer losing plays as a clean record: the gate clears or cautions', async () => {
  const mock = mockNansen({ pnl30: 250_000, pnl7: 20_000 });
  const { service } = liveRoom([
    ...answer(5000, 'sold', 'Funded.'),
  ], mock);
  const round = await service.start({ prospect: 'grinder' });
  assert.equal(round.dossier.sealed.mustNotMention, false);
  const one = await say(service, round.id, 0, '+$20,000 realised over the last 7 days.');
  assert.equal(one.dossier.buried, null);
  assert.equal(one.dossier.clean, 'Nothing buried. The 30-day record holds up.');
  assert.equal(one.shots[0].wire.decision, 'allow');
  assert.notEqual(one.shots[0].wire.stamp, 'BLOCKED', 'the report never stamps BLOCKED on money the gate let through');
  const { final } = await service.finish(round.id, {});
  assert.ok(['CLEARED', 'CAUTION'].includes(final.stamp));
  assert.equal(final.executed, 5000);
});

test('a capped or failed read plays the frozen capture and says why; the Fomo four never read', async () => {
  const mock = mockNansen({ fail: 503 });
  const { service } = liveRoom([...answer(5000, 'sold', 'Funded.')], mock);
  const round = await service.start({ prospect: 'grinder' });
  assert.equal(round.evidence.live, false);
  assert.equal(round.evidence.code, 'provider_error');
  assert.match(round.evidence.reason, /failed/);
  const one = await say(service, round.id, 0, '+$35,723 realised over the last 7 days.');
  assert.equal(one.prospect.truth.availability, 'capture');
  assert.equal(one.prospect.truth.pnlLabel, '-$4,745,429', 'the frozen capture, exactly as before');
  assert.equal(one.shots[0].wire.decision, 'block');
  assert.equal(one.shots[0].wire.live, false);

  const fomoMock = mockNansen();
  const fomo = liveRoom([], fomoMock);
  // The Fomo four have no Nansen record, so they are not on the room roster at all.
  await assert.rejects(() => fomo.service.start({ prospect: 'unipcs' }), /not on the roster/);
  assert.equal(fomoMock.seen.length, 0);

  const capped = liveRoom([], mockNansen(), { dailyCap: 0 });
  const r = await capped.service.start({ prospect: 'legend' });
  assert.equal(r.evidence.code, 'daily_cap');
  assert.match(r.dossier.evidenceLabel, /^captured /);
  assert.equal(SHOTS, 3);
});

test('a fill tape more than a day behind the live summaries is shown but not used, and the report says why', async () => {
  const { copyRiskReport, tapeRecency, TAPE_MAX_AGE_MS } = await import('./roster.js');
  const legend = loadRoster().find(p => p.id === 'legend');
  const frozen = copyRiskReport(legend);
  assert.equal(frozen.tape.stale, false, 'a frozen capture reads its own tape: same moment, age 0');
  assert.equal(tapeRecency(legend.snapshot).ageMs, 0);
  const read = at => ({ live: true, fetchedAt: at, endpoint: 'profiler/perp-pnl-summary', windows: legend.snapshot.windows,
    summary30: legend.snapshot.pnl_summary_30d, summary7: legend.snapshot.pnl_summary_7d });
  const captured = Date.parse(legend.snapshot.retrieved_at);
  const fresh = liveSnapshot(legend.snapshot, read(new Date(captured + TAPE_MAX_AGE_MS - 60_000).toISOString()));
  assert.equal(tapeRecency(fresh).stale, false);
  const stale = { ...legend, snapshot: liveSnapshot(legend.snapshot, read(new Date(captured + 2 * 86_400_000).toISOString())) };
  const r = copyRiskReport(stale);
  assert.equal(r.tape.stale, true);
  assert.ok(Math.abs(r.tape.ageMs - 2 * 86_400_000) < 1000);
  assert.ok(!r.flags.some(f => ['max_drawdown', 'tail_loss'].includes(f.id)), 'nothing measured on a stale tape reaches the verdict');
  assert.match(r.coverage, /fill tape is the .* capture, 2\.0 days older than the summaries/);
  assert.ok(r.not_assessed.filter(n => ['max_drawdown', 'tail_loss'].includes(n.id)).every(n => /nothing measured on it is used/.test(n.reason)));
});

// ------------------------------------------------------------ any wallet (round 10)

const PASTED = '0x1111111111111111111111111111111111111111';
const PASTED2 = '0x2222222222222222222222222222222222222222';
/** A wallet whose two summaries say whatever the test needs. */
function walletMock(summary) {
  const seen = [];
  const call = async (pathName, body) => {
    seen.push({ pathName, body });
    const days = Math.round((Date.parse(body.date.to) - Date.parse(body.date.from)) / 86_400_000);
    return { status: 200, headers: { 'x-nansen-credits-cost': '1' }, data: { data: summary(days) } };
  };
  return { call, seen };
}
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bait-reads-'));

test('a pasted wallet: the address is validated before any read', async () => {
  const mock = mockNansen();
  const { service } = liveRoom([], mock);
  for (const bad of ['0x123', 'hello', `${PASTED}00`, '', 42]) {
    await assert.rejects(service.start({ wallet: bad }), /not a Hyperliquid address/);
  }
  assert.equal(mock.seen.length, 0, 'no credit spent on a bad address');
});

test('a pasted wallet plays the same round from one live read, cached by address, raw responses saved', async () => {
  const mock = mockNansen({ pnl30: -900_000, pnl7: 12_000 });
  const rawDir = tmpDir();
  const { service } = liveRoom([...answer(0, 'neutral', 'Go on.')], mock, { rawDir });
  const one = await service.start({ wallet: PASTED });
  assert.equal(one.finished, false);
  assert.ok(one.dossier.facts.length >= 1, 'the flattering facts come from the live read');
  assert.equal(mock.seen.length, 2, 'two summaries, 2 credits');
  const two = await service.start({ wallet: PASTED.toUpperCase().replace('0X', '0x') });
  assert.equal(two.finished, false);
  assert.equal(mock.seen.length, 2, 'the second start is a cache hit');
  const { listRawReads } = await import('./live-evidence.js');
  const saved = listRawReads(rawDir);
  assert.equal(saved.length, 1);
  assert.match(saved[0].sha256, /^[a-f0-9]{64}$/);
  const body = JSON.parse(fs.readFileSync(path.join(rawDir, saved[0].file), 'utf8'));
  assert.equal(body.responses['30d'].body.data.realized_pnl_usd, -900_000, 'the file is the response as Nansen sent it');
  assert.equal(body.responses['7d'].request.address, PASTED);
});

test('a pasted wallet under a spent cap is refused plainly, with no request sent', async () => {
  const mock = mockNansen();
  const { service } = liveRoom([], mock, { dailyCap: LIVE_READ_CREDITS });
  await service.start({ wallet: PASTED });
  await assert.rejects(service.start({ wallet: PASTED2 }), /used up/);
  assert.equal(mock.seen.length, 2);
});

test('a wallet with no perp history says so and starts nothing', async () => {
  const mock = walletMock(() => ({ realized_pnl_usd: 0, win_rate: null, closed_trade_count: 0, top5_coins: [] }));
  const { service } = liveRoom([], mock, { rawDir: tmpDir() });
  await assert.rejects(service.start({ wallet: PASTED }), /no closed Hyperliquid perp trade for this wallet in the last 30 days/);
});

test('a wallet with nothing flattering still gets the BAIT check and its verdict', async () => {
  const mock = walletMock(days => ({ realized_pnl_usd: days === 7 ? -5_000 : -40_000, win_rate: 0.31, closed_trade_count: days === 7 ? 40 : 180,
    winning_trade_count: 20, fees_usd: 10, traded_coin_count: 2, top5_coins: [{ coin: 'BTC', realized_pnl_usd: -12_000 }] }));
  const { service } = liveRoom([], mock, { rawDir: tmpDir() });
  const res = await service.start({ wallet: PASTED });
  assert.equal(res.checkOnly, true);
  assert.equal(res.final.headline, 'Nothing flattering to pitch.');
  assert.equal(res.final.verdict, 'block');
  assert.equal(res.final.gate.checks.find(c => c.id === 'realised_pnl_30d').result, 'fail');
  assert.equal(res.final.gate.live, true);
});

// ------------------------------------------------------------ live fills (round 11)

function fillsMock({ fills = 2 } = {}) {
  const seen = [];
  const call = async (pathName, body) => {
    seen.push({ pathName, body });
    if (pathName === 'profiler/perp-trades') {
      const rows = Array.from({ length: fills }, (_, i) => ({ timestamp: new Date(Date.parse('2026-09-23T10:00:00Z') - i * 3_600_000).toISOString(),
        token_symbol: 'BTC', side: 'Long', action: 'Close', closed_pnl: i % 2 ? -500 : 900, value_usd: 10_000 }));
      return { status: 200, headers: { 'x-nansen-credits-cost': '1' }, data: { data: rows, pagination: { is_last_page: true } } };
    }
    const days = Math.round((Date.parse(body.date.to) - Date.parse(body.date.from)) / 86_400_000);
    return { status: 200, headers: { 'x-nansen-credits-cost': '1' }, data: { data: {
      realized_pnl_usd: days === 7 ? 3_000 : 12_000, win_rate: 0.6, closed_trade_count: 40, winning_trade_count: 24, fees_usd: 1, traded_coin_count: 1,
      top5_coins: [{ coin: 'BTC', realized_pnl_usd: 12_000 }] } } };
  };
  return { call, seen };
}

test('a live read also reads the newest fills: second endpoint, charged, saved raw, and the tape is live, not stale', async () => {
  const mock = fillsMock({ fills: 6 });
  const rawDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bait-fills-'));
  const live = createLiveEvidence({ enabled: true, keyPresent: true, call: mock.call, now: () => T0, fillPages: 1, rawDir });
  const read = await live.read(GRINDER);
  assert.equal(read.live, true);
  assert.deepEqual(mock.seen.map(c => c.pathName).sort(), ['profiler/perp-pnl-summary', 'profiler/perp-pnl-summary', 'profiler/perp-trades']);
  assert.equal(read.fills.rows.length, 6);
  assert.equal(live.status().credits_today, 3, 'two summaries and one page of fills');
  assert.equal(live.status().credits_per_read, 3);
  const { listRawReads } = await import('./live-evidence.js');
  const body = JSON.parse(fs.readFileSync(path.join(rawDir, listRawReads(rawDir)[0].file), 'utf8'));
  assert.equal(body.responses.fills[0].body.data.length, 6, 'the fills are in the same raw file');
  const grinder = loadRoster().find(p => p.id === 'grinder');
  const snap = liveSnapshot(grinder.snapshot, read);
  assert.equal(snap.live_read.fills_live, true);
  assert.equal(snap.trades_30d.length, 6);
  const { tapeRecency } = await import('./roster.js');
  assert.equal(tapeRecency(snap).stale, false, 'a tape read in the same read is never stale');
});

test('a failed fills page keeps the summaries live and falls back to the capture tape, labelled', async () => {
  const base = fillsMock();
  const call = async (p, b, o) => { if (p === 'profiler/perp-trades') throw Object.assign(new Error('429'), { status: 429 }); return base.call(p, b, o); };
  const live = createLiveEvidence({ enabled: true, keyPresent: true, call, now: () => T0, fillPages: 1 });
  const read = await live.read(GRINDER);
  assert.equal(read.live, true);
  assert.match(read.fills.error, /429/);
  const grinder = loadRoster().find(p => p.id === 'grinder');
  assert.equal(liveSnapshot(grinder.snapshot, read).live_read.fills_live, undefined);
});
