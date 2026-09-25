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
  enabled: true, keyPresent: true, call: mock.call, now: () => T0, fillPages: 0, positions: false, ...extra,
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

test('round 20: a hung provider times out, retries once, falls back, and its credits are reported as unused, not as reads', async () => {
  const mock = mockNansen({ hang: true });
  const live = reader(mock, { timeoutMs: 30 });
  const read = await live.read(GRINDER);
  assert.equal(read.live, false);
  assert.equal(read.code, 'timeout');
  assert.match(read.reason, /timed out/);
  // Two attempts (the first and one retry), each possibly billed; neither counts as a read that was used.
  assert.equal(live.status().credits_today, 0, 'no read succeeded, so none is counted as used');
  assert.equal(live.status().credits_unused_today, 2 * LIVE_READ_CREDITS, 'what the timed-out requests may cost, under its own name');
  assert.equal(live.status().retries_this_process, 1);
  assert.equal(mock.seen.filter(c => c.pathName === 'profiler/perp-pnl-summary').length, 4, 'two summaries, twice');
  assert.equal(live.status().last_live_failure.code, 'timeout');
});

test('no key, or live reads switched off, makes no request at all', async () => {
  const mock = mockNansen();
  const noKey = createLiveEvidence({ positions: false, enabled: true, keyPresent: false, call: mock.call });
  assert.deepEqual(await noKey.read(GRINDER), { live: false, code: 'no_key', reason: 'no Nansen key is configured' });
  const off = createLiveEvidence({ positions: false, enabled: false, keyPresent: true, call: mock.call });
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
  const partial = await createLiveEvidence({ positions: false, enabled: true, keyPresent: true, call, now: () => T0 }).read(GRINDER);
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
  assert.deepEqual(round.dossier.sealed, { label: '7-day and 30-day realised PnL' });
  assert.match(round.dossier.evidenceLabel, /^live Nansen read /);

  const said = await say(service, round.id, 0, '+$15,000 realised over the last 7 days.');
  assert.equal(said.finished, false, 'a commitment raises the meter; the player wires it');
  const one = await service.finish(round.id, { wire: true });
  const wire = one.shots[0].wire;
  assert.equal(wire.decision, 'block');
  assert.equal(wire.pnlLabel, '-$2,000,000', 'the gate judged the live number');
  assert.equal(wire.policyId, ROOM_LIVE_GUARD_POLICY.id);
  assert.equal(wire.live, true);
  assert.equal(one.finished, true);
  assert.equal(one.prospect.truth.availability, 'live');
  assert.equal(one.prospect.truth.pnl, -2_000_000);
  assert.equal(one.prospect.truth.pnlLabel, '-$2,000,000');
  assert.match(one.prospect.truth.capturedLabel, /^2026-\d\d-\d\d \d\d:\d\d UTC$/);
  assert.match(one.prospect.truth.scope, /summaries read live, trade fills from the 2026-09-15 UTC capture/);
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

test('a live record that is no longer losing plays as a clean record: the gate clears it, one verdict', async () => {
  const mock = mockNansen({ pnl30: 250_000, pnl7: 20_000 });
  const { service } = liveRoom([
    ...answer(5000, 'sold', 'Funded.'),
  ], mock);
  const round = await service.start({ prospect: 'grinder' });
  assert.deepEqual(round.dossier.sealed, { label: '7-day and 30-day realised PnL' }, 'a clean record looks the same before the gate');
  await say(service, round.id, 0, '+$20,000 realised over the last 7 days.');
  const one = await service.finish(round.id, { wire: true });
  assert.equal(one.dossier.buried, null);
  assert.equal(one.dossier.clean, 'Nothing buried. The 30-day record holds up.');
  assert.equal(one.shots[0].wire.decision, 'allow');
  const { final } = one;
  // Round 14: the gate alone decides the verdict; no CAUTION relabels a cleared transfer.
  assert.equal(final.verdict, 'allow');
  assert.equal(final.stamp, 'CLEARED');
  assert.equal(one.shots[0].wire.stamp, 'CLEARED');
  assert.match(final.subline, /cleared it: \$5,000 reached/);
  assert.doesNotMatch(JSON.stringify(final), /CAUTION|still shows concerns/);
  assert.equal(final.executed, 5000);
});

test('a capped or failed read plays the frozen capture and says why; the Fomo four never read', async () => {
  const mock = mockNansen({ fail: 503 });
  const { service } = liveRoom([...answer(5000, 'sold', 'Funded.')], mock);
  const round = await service.start({ prospect: 'grinder' });
  assert.equal(round.evidence.live, false);
  assert.equal(round.evidence.code, 'provider_error');
  assert.match(round.evidence.reason, /failed/);
  await say(service, round.id, 0, '+$35,723 realised over the last 7 days.');
  const one = await service.finish(round.id, { wire: true });
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
  assert.match(r.coverage, /trade fills are the .* capture, 2\.0 days older than the summaries/);
  assert.ok(r.not_assessed.filter(n => ['max_drawdown', 'tail_loss'].includes(n.id)).every(n => /nothing measured on them is used/.test(n.reason)));
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

function fillsMock({ fills = 2, last = true, stepMs = 3_600_000, pnl = i => (i % 2 ? -500 : 900) } = {}) {
  const seen = [];
  const call = async (pathName, body) => {
    seen.push({ pathName, body });
    if (pathName === 'profiler/perp-trades') {
      const rows = Array.from({ length: fills }, (_, i) => ({ timestamp: new Date(Date.parse('2026-09-23T10:00:00Z') - i * stepMs).toISOString(),
        token_symbol: 'BTC', side: 'Long', action: 'Close', closed_pnl: pnl(i), value_usd: 10_000 }));
      return { status: 200, headers: { 'x-nansen-credits-cost': '1' }, data: { data: rows, pagination: { is_last_page: last } } };
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
  const live = createLiveEvidence({ positions: false, enabled: true, keyPresent: true, call: mock.call, now: () => T0, fillPages: 1, rawDir });
  const read = await live.read(GRINDER);
  assert.equal(read.live, true);
  assert.deepEqual(mock.seen.map(c => c.pathName).sort(), ['profiler/perp-pnl-summary', 'profiler/perp-pnl-summary', 'profiler/perp-trades']);
  assert.equal(read.fills.rows.length, 6);
  assert.equal(live.status().credits_today, 3, 'two summaries and one page of fills');
  assert.deepEqual([live.status().credits_per_round.refused, live.status().credits_per_round.full], [3, 3], 'no v4 reads here: the same either way');
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
  const live = createLiveEvidence({ positions: false, enabled: true, keyPresent: true, call, now: () => T0, fillPages: 1 });
  const read = await live.read(GRINDER);
  assert.equal(read.live, true);
  assert.match(read.fills.error, /429/);
  const grinder = loadRoster().find(p => p.id === 'grinder');
  assert.equal(liveSnapshot(grinder.snapshot, read).live_read.fills_live, undefined);
});

test('round 16: a live tape shorter than a week is not assessed, and the report says how little it covers', async () => {
  const mock = fillsMock({ fills: 6 });
  const live = createLiveEvidence({ positions: false, enabled: true, keyPresent: true, call: mock.call, now: () => T0, fillPages: 1 });
  const read = await live.read(GRINDER);
  read.fills.complete = false;
  const { copyRiskReport, refreshProspect } = await import('./roster.js');
  const grinder = loadRoster().find(p => p.id === 'grinder');
  const p = refreshProspect(grinder, liveSnapshot(grinder.snapshot, read));
  const na = p.risk.not_assessed.filter(n => ['max_drawdown', 'tail_loss'].includes(n.id));
  assert.equal(na.length, 2, 'neither is judged on five hours of fills');
  assert.ok(na.every(n => /^the newest 6 fills cover only 5 hours, too short to judge$/.test(n.reason)), JSON.stringify(na));
  assert.ok(!copyRiskReport(p).flags.some(f => ['max_drawdown', 'tail_loss'].includes(f.id)), 'no finding from a sliver');
});

test('the worst-trade row always shows the value read off the live fills, with the span', async () => {
  const mock = fillsMock({ fills: 6 });
  const { service } = liveRoom([...answer(5000, 'intrigued', 'Opening small.')], mock, { fillPages: 1 });
  const round = await service.start({ prospect: 'grinder' });
  await say(service, round.id, 0, round.dossier.facts[0].insert);
  const { final } = await service.finish(round.id, {});
  const row = final.gate.checks.find(c => c.id === 'fills_worst_trade');
  assert.match(row.plain, /Worst single closed trade over (all 6 fills in the window|the newest 6 fills \(5 hours\)): -\$500/);
  assert.notEqual(row.result, 'fail', 'never blocks');
  // The span of a partial tape comes from millisecond timestamps: never "NaN days".
  const { spanText } = await import('./roster.js');
  assert.equal(spanText(Date.parse('2026-09-23T05:59:00Z'), Date.parse('2026-09-23T07:26:00Z')), '1 hour 27 minutes');
  assert.doesNotMatch(JSON.stringify(final.gate.checks), /NaN/);
  const dd = final.gate.checks.find(c => c.id === 'fills_drawdown');
  assert.doesNotMatch(dd.plain, /\d\.\d hours/, 'one span format');
  // A pasted wallet with no account value: the value is shown and the missing bar is said.
  const pasted = liveRoom([...answer(4000, 'intrigued', 'Fine.')], fillsMock({ fills: 6 }), { fillPages: 1 }).service;
  const res = await pasted.start({ wallet: '0x3333333333333333333333333333333333333333' });
  await say(pasted, res.id, 0, res.dossier.facts[0].insert);
  const pf = (await pasted.finish(res.id, {})).final.gate.checks.find(c => c.id === 'fills_worst_trade');
  assert.match(pf.plain, /Worst single closed trade over .*: -\$500\. No limit applied/);
});

test('round 16: newest fills covering under a week are N/A, "too short to judge"; a full window shows the drawdown as a share of its peak', async () => {
  // A full page of 1,000 fills a second apart, and Nansen says there are more: 17 minutes of a month.
  const short = liveRoom([...answer(5000, 'intrigued', 'Opening small.')], fillsMock({ fills: 1000, last: false, stepMs: 1_000 }), { fillPages: 1 }).service;
  let round = await short.start({ prospect: 'grinder' });
  await say(short, round.id, 0, round.dossier.facts[0].insert);
  let checks = (await short.finish(round.id, {})).final.gate.checks;
  for (const id of ['fills_drawdown', 'fills_worst_trade']) {
    const row = checks.find(c => c.id === id);
    assert.equal(row.result, 'not_assessed', id);
    assert.equal(row.plain, 'The newest 1,000 fills cover only 17 minutes, too short to judge.');
  }
  // The whole window held (last page): the drawdown is measured, with its base and the limit.
  // Six fills, newest first; the one loss (-$200) comes after a $3,000 peak.
  const full = liveRoom([...answer(5000, 'intrigued', 'Opening small.')], fillsMock({ fills: 6, pnl: i => (i === 2 ? -200 : 1000) }), { fillPages: 1 }).service;
  round = await full.start({ prospect: 'grinder' });
  await say(full, round.id, 0, round.dossier.facts[0].insert);
  checks = (await full.finish(round.id, {})).final.gate.checks;
  assert.equal(checks.find(c => c.id === 'fills_drawdown').plain,
    'Worst peak-to-trough over all 6 fills in the window: $200, 0.0% of the $2,938,036 account value (Nansen positions), under the 15% limit; 6.7% of the $3,000 peak it fell from, under the 30% limit.');
  // A curve that fell from zero has no peak; it is measured against the account value alone.
  const flat = liveRoom([...answer(5000, 'intrigued', 'Opening small.')], fillsMock({ fills: 6 }), { fillPages: 1 }).service;
  round = await flat.start({ prospect: 'grinder' });
  await say(flat, round.id, 0, round.dossier.facts[0].insert);
  checks = (await flat.finish(round.id, {})).final.gate.checks;
  assert.equal(checks.find(c => c.id === 'fills_drawdown').plain, 'Worst peak-to-trough over all 6 fills in the window: $500, 0.0% of the $2,938,036 account value (Nansen positions), under the 15% limit.');
});

test('round 17: nothing the gate reads is in a response before the verdict; the final carries it', async () => {
  const { service } = liveRoom([...answer(2500, 'intrigued', 'Small.'), ...answer(5000, 'sold', 'More.')], fillsMock({ fills: 6 }), { fillPages: 1 });
  const round = await service.start({ prospect: 'grinder' });
  const one = await say(service, round.id, 0, round.dossier.facts[0].insert);
  const two = await say(service, round.id, 1, round.dossier.facts[1].insert);
  const leak = /realized_pnl|win_rate_30d|closed_trade_count|trades_30d|open_positions|max_drawdown|"summary"|"raw"|"truth"/;
  for (const [name, body] of [['start', round], ['line 1', one], ['line 2', two]]) {
    assert.doesNotMatch(JSON.stringify(body), leak, `${name} response holds no gate figure`);
  }
  const { final } = await service.finish(round.id, { wire: true });
  assert.equal(typeof final.evidence.summary.realized_pnl_30d_usd, 'number', 'the figures arrive with the verdict');
});

test('round 17: a live read also reads the open positions (one credit), and a failing fill row names its base and limit', async () => {
  // Positions: down $1,200,000 on a $2,000,000 account, 60%: the open-book check caps.
  const base = fillsMock({ fills: 6, pnl: i => (i === 2 ? -900_000 : 100_000) });
  const call = async (pathName, body) => {
    if (pathName === 'profiler/perp-positions') {
      return { status: 200, headers: { 'x-nansen-credits-cost': '1' }, data: { data: {
        asset_positions: [{ position: { token_symbol: 'BTC', unrealized_pnl_usd: '-1200000', position_value_usd: '5000000' } }],
        margin_summary_account_value_usd: '2000000' } } };
    }
    return base.call(pathName, body);
  };
  const { service, live } = liveRoom([...answer(4000, 'intrigued', 'Opening small.')], { call }, { fillPages: 1, positions: true, v4Reads: false });
  const round = await service.start({ prospect: 'grinder' });
  assert.equal(live.status().credits_today, 4, 'two summaries, one page of fills, the open positions');
  await say(service, round.id, 0, round.dossier.facts[0].insert);
  const { final } = await service.finish(round.id, { wire: true });
  const book = final.gate.checks.find(c => c.id === 'open_book');
  assert.equal(book.result, 'cap');
  assert.match(book.plain, /^The open positions are down \$1,200,000, 60\.0% of the \$2,000,000 account value, over the 25% limit\./);
  assert.equal(final.verdict, 'capped');
  // The drawdown row fails, and still shows its percent of each base and the limit.
  const dd = final.gate.checks.find(c => c.id === 'fills_drawdown');
  assert.equal(dd.result, 'caution');
  // The drop ($900,000) is larger than the $300,000 peak it fell from, so the peak is the wrong
  // base: no "300% of the peak"; the account value leads and decides the row.
  assert.equal(dd.plain, 'Worst peak-to-trough over all 6 fills in the window: $900,000, 45.0% of the $2,000,000 account value (Nansen positions), over the 15% limit.');
  assert.doesNotMatch(dd.plain, /peak it fell from/);
});

test('round 17: a fresh read is hidden from /api/live-reads until a gate has run on it, or the embargo passes', async () => {
  const rawDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bait-embargo-'));
  let clock = Date.parse('2026-09-23T10:15:00Z');
  const { service, live } = liveRoom([...answer(3000, 'intrigued', 'Small.')], fillsMock({ fills: 6 }), { fillPages: 1, rawDir, now: () => new Date(clock) });
  const round = await service.start({ prospect: 'grinder' });
  const [file] = fs.readdirSync(rawDir);
  assert.ok(file, 'the raw read is saved at once');
  assert.equal(live.isSealed(file), true, 'sealed while the round is open');
  await say(service, round.id, 0, round.dossier.facts[0].insert);
  assert.equal(live.isSealed(file), true, 'still sealed after a line');
  await service.finish(round.id, { wire: true });
  assert.equal(live.isSealed(file), false, 'released once the gate has run');
  // A round nobody finishes: released when the embargo (30 minutes) passes.
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'bait-embargo-'));
  const other = liveRoom([...answer(0, 'neutral', 'No.')], fillsMock({ fills: 6 }), { fillPages: 1, rawDir: dir2, now: () => new Date(clock) });
  await other.service.start({ prospect: 'grinder' });
  const [second] = fs.readdirSync(dir2);
  assert.equal(other.live.isSealed(second), true);
  clock += 30 * 60_000;
  assert.equal(other.live.isSealed(second), false);
});

test('round 18: the verdict lists the Nansen calls it stands on, with credits, time and the row each decided', async () => {
  const { service } = liveRoom([...answer(3000, 'intrigued', 'Small.')], fillsMock({ fills: 6 }), { fillPages: 1, positions: false });
  const round = await service.start({ prospect: 'grinder' });
  await say(service, round.id, 0, round.dossier.facts[0].insert);
  const { final } = await service.finish(round.id, { wire: true });
  const calls = final.gate.calls;
  assert.deepEqual(calls.map(c => c.endpoint), ['profiler/perp-pnl-summary 30d', 'profiler/perp-pnl-summary 7d', 'profiler/perp-trades']);
  assert.deepEqual(calls.map(c => c.credits), [1, 1, 1]);
  assert.ok(calls.every(c => /^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(c.at)));
  // The mock's month is +$12,000 and its week +$3,000: both summaries pass.
  assert.equal(calls[0].decided, 'PASS');
  assert.equal(calls[1].decided, 'PASS');
  // A frozen round made no call and says so.
  const { nansenCalls } = await import('./room.js');
  const frozen = nansenCalls({ retrieved_at: '2026-09-21T00:00:00Z' }, [{ id: 'realised_pnl_30d', result: 'fail' }]);
  assert.deepEqual(frozen, [{ endpoint: 'frozen Nansen capture', credits: 0, at: '2026-09-21T00:00:00Z', cached: false, frozen: true, decided: 'BLOCK' }]);
  const client = fs.readFileSync(new URL('./public/room.js', import.meta.url), 'utf8');
  assert.match(client, /renderCalls\(gate\.calls \?\? \[\]\);/);
});

test('round 20: a read that times out once and then succeeds is live, counted once as used, the first attempt as unused', async () => {
  const good = mockNansen();
  let calls = 0;
  const call = async (pathName, body, opts) => (++calls <= 2 ? new Promise(() => {}) : good.call(pathName, body, opts));
  const live = reader({ call }, { timeoutMs: 30 });
  const read = await live.read(GRINDER);
  assert.equal(read.live, true);
  assert.equal(live.status().credits_today, LIVE_READ_CREDITS, 'the read that was used');
  assert.equal(live.status().credits_unused_today, LIVE_READ_CREDITS, 'the attempt that timed out');
  assert.equal(live.status().retries_this_process, 1);
});

// ------------------------------------------------------------ gate v4 (bench/V4.md)

/** Summaries from fillsMock, plus an open book, perp-screener and perp-leaderboard. */
function v4Mock({ pnl30 = 12_000, side = 'short', smLong = 7_000_000, smShort = -3_000_000, record = pnl30 } = {}) {
  const base = fillsMock({ fills: 6 });
  const seen = [];
  const ok = (data, cost = '1') => ({ status: 200, headers: { 'x-nansen-credits-cost': cost }, data });
  const call = async (pathName, body, opts) => {
    seen.push({ pathName, body, opts });
    if (pathName === 'profiler/perp-positions') {
      return ok({ data: { asset_positions: [{ position: { token_symbol: 'HYPE', size: side === 'short' ? '-100' : '100', position_value_usd: side === 'short' ? '-900000' : '900000', unrealized_pnl_usd: '-1000' } }],
        margin_summary_account_value_usd: '1000000' } });
    }
    if (pathName === 'perp-screener') return ok({ data: [{ token_symbol: body.filters.token_symbol, current_smart_money_position_longs_usd: smLong, current_smart_money_position_shorts_usd: smShort }] });
    if (pathName === 'perp-leaderboard') return ok({ data: [{ trader_address: body.filters.trader_address, realized_pnl_usd: record, total_trades: 40 }] }, '5');
    const res = await base.call(pathName, body);
    if (pathName === 'profiler/perp-pnl-summary' && Math.round((Date.parse(body.date.to) - Date.parse(body.date.from)) / 86_400_000) === 30) res.data.data.realized_pnl_usd = pnl30;
    return res;
  };
  return { call, seen };
}

test('v4 live round: smart money against the book caps, the leaderboard record is bought and agrees, both rows and calls are on the card', async () => {
  const mock = v4Mock();
  const rawDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bait-v4-'));
  const { service, live } = liveRoom([...answer(4000, 'intrigued', 'Opening small.')], mock, { fillPages: 1, positions: true, rawDir });
  const round = await service.start({ prospect: 'grinder' });
  assert.equal(live.status().credits_today, 10, 'two summaries, fills, positions, perp-screener (1) and perp-leaderboard (5)');
  assert.equal(live.status().credits_per_round.full, 22, 'plus the gate v5 operator read at most (12)');
  assert.equal(live.status().credits_per_round.refused, 5, 'a refused round skips the 5-credit leaderboard and the operator read');
  const screener = mock.seen.find(c => c.pathName === 'perp-screener');
  assert.deepEqual(screener.body.filters, { trader_type: 'sm', token_symbol: 'HYPE' }, 'the market of the largest open position');
  const board = mock.seen.find(c => c.pathName === 'perp-leaderboard');
  assert.equal(board.body.filters.trader_address, GRINDER);
  assert.match(board.body.date.from, /^\d{4}-\d{2}-\d{2}$/, 'calendar days, as the summary counts them');
  await say(service, round.id, 0, round.dossier.facts[0].insert);
  const { final } = await service.finish(round.id, { wire: true });
  const row = id => final.gate.checks.find(c => c.id === id);
  assert.equal(row('smart_money_side').result, 'cap');
  assert.match(row('smart_money_side').plain, /largest open position is short HYPE\. Nansen's smart money holds 70% of its \$10\.0M there on the other side/);
  assert.equal(row('smart_money_side').source, 'perp-screener, smart money in the largest open position’s market');
  assert.equal(row('independent_record').result, 'pass');
  assert.equal(final.verdict, 'capped');
  assert.equal(final.gate.policyId, 'wallet-copy-risk-room-live-v5');
  assert.equal(final.gate.smartMoneyLive, true);
  assert.equal(final.gate.recordLive, true);
  const calls = final.gate.calls.map(c => [c.endpoint, c.credits, c.decided]);
  assert.deepEqual(calls.slice(-2), [['perp-screener, smart money', 1, 'CAP'], ['perp-leaderboard, 30 days', 5, 'PASS']]);
  const { listRawReads } = await import('./live-evidence.js');
  const body = JSON.parse(fs.readFileSync(path.join(rawDir, listRawReads(rawDir)[0].file), 'utf8'));
  assert.ok(body.endpoints.includes('perp-screener') && body.endpoints.includes('perp-leaderboard'), 'both raw responses are kept');
  assert.equal(body.responses.leaderboard.body.data[0].realized_pnl_usd, 12_000);
});

test('v4 live round: a record the summaries already refuse never buys the leaderboard, and the card says why', async () => {
  const mock = v4Mock({ pnl30: -2_000_000, side: 'long' });
  const { service, live } = liveRoom([...answer(4000, 'intrigued', 'Opening small.')], mock, { fillPages: 1, positions: true });
  const round = await service.start({ prospect: 'grinder' });
  assert.equal(mock.seen.filter(c => c.pathName === 'perp-leaderboard').length, 0);
  assert.equal(live.status().credits_today, 5, 'two summaries, fills, positions and the screener; no leaderboard');
  await say(service, round.id, 0, round.dossier.facts[0].insert);
  const { final } = await service.finish(round.id, { wire: true });
  assert.equal(final.verdict, 'block');
  const record = final.gate.checks.find(c => c.id === 'independent_record');
  assert.equal(record.result, 'not_assessed');
  assert.match(record.plain, /^Not read: the 30-day record already refused this request/);
  const lb = final.gate.calls.find(c => c.endpoint === 'perp-leaderboard, 30 days');
  assert.equal(lb.skipped, true);
  assert.equal(lb.credits, 0);
  // Smart money agrees with this long book: the row passes, shown beside the block.
  assert.equal(final.gate.checks.find(c => c.id === 'smart_money_side').result, 'pass');
});

test('v4 live round: a leaderboard record below the summary blocks the wire as record_disagreement', async () => {
  const mock = v4Mock({ side: 'long', record: -50_000 });
  const { service } = liveRoom([...answer(4000, 'intrigued', 'Opening small.')], mock, { fillPages: 1, positions: true });
  const round = await service.start({ prospect: 'grinder' });
  await say(service, round.id, 0, round.dossier.facts[0].insert);
  const { final } = await service.finish(round.id, { wire: true });
  assert.equal(final.verdict, 'block');
  assert.equal(final.gate.checks.find(c => c.id === 'independent_record').result, 'fail');
  assert.match(final.gate.reason, /perp-leaderboard/);
});

// ------------------------------------------------------------ gate v5 (bench/V5.md)

const FUNDER = '0x1111111111111111111111111111111111111111';
const SIBLING = '0x2222222222222222222222222222222222222222';
const TX = '0x' + 'ab'.repeat(32);
/** v4Mock plus the operator read: GRINDER's first funder on arbitrum also paid for SIBLING, which lost `siblingPnl`. */
function v5Mock({ siblingPnl = -500_000, label = 'Some Fund' } = {}) {
  const base = v4Mock({ side: 'long' });
  const ok = data => ({ status: 200, headers: { 'x-nansen-credits-cost': '1' }, data });
  const call = async (pathName, body, opts) => {
    if (pathName === 'profiler/address/related-wallets') {
      base.seen.push({ pathName, body, opts });
      return ok({ data: body.chain === 'arbitrum'
        ? [{ address: FUNDER, address_label: label, relation: 'First Funder', transaction_hash: TX, block_timestamp: '2025-01-01T00:00:00Z', chain: 'arbitrum' }]
        : [] });
    }
    if (pathName === 'profiler/address/transactions') {
      base.seen.push({ pathName, body, opts });
      return ok({ data: [{ transaction_hash: TX, volume_usd: 5_000, tokens_received: [{ from_address: FUNDER, from_address_label: label }] }] });
    }
    if (pathName === 'profiler/perp-pnl-summary' && body.address === SIBLING) {
      base.seen.push({ pathName, body, opts });
      return ok({ data: { realized_pnl_usd: siblingPnl, closed_trade_count: 90 } });
    }
    return base.call(pathName, body, opts);
  };
  return { call, seen: base.seen };
}
const INDEX = { universe: 2, groups: { [`arbitrum:${FUNDER}`]: [GRINDER, SIBLING] }, services: [] };

test('v5 live round: the operator behind the wallet lost money, so the operator row blocks, by short address and in one line', async () => {
  const mock = v5Mock();
  const rawDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bait-v5-'));
  const { service, live } = liveRoom([...answer(4000, 'intrigued', 'Opening small.')], mock, { fillPages: 1, positions: true, rawDir, operatorIndex: INDEX });
  const round = await service.start({ prospect: 'grinder' });
  assert.deepEqual(mock.seen.filter(c => c.pathName.startsWith('profiler/address')).map(c => [c.pathName, c.body.chain]),
    [['profiler/address/related-wallets', 'ethereum'], ['profiler/address/related-wallets', 'arbitrum'], ['profiler/address/transactions', 'arbitrum']]);
  assert.equal(live.status().credits_today, 10 + 4, 'v4\'s ten, two related-wallets, one funding transfer, one sibling summary');
  await say(service, round.id, 0, round.dossier.facts[0].insert);
  const { final } = await service.finish(round.id, { wire: true });
  const row = final.gate.checks.find(c => c.id === 'operator_record');
  assert.equal(row.result, 'fail');
  assert.equal(final.verdict, 'block');
  assert.equal(final.gate.policyId, 'wallet-copy-risk-room-live-v5');
  assert.equal(final.gate.operatorLive, true);
  assert.equal(row.plain, 'First funder 0x1111...1111 also paid for 1 indexed wallet; with this one the owner made -$488,000 over 30 days, so this wallet is the survivor.');
  assert.equal(row.source, 'related-wallets first funder, transactions, sibling perp-pnl-summary');
  assert.doesNotMatch(JSON.stringify(final), /Some Fund/, 'no Nansen label reaches the page');
  assert.deepEqual(final.gate.calls.at(-1), { endpoint: 'owner: related-wallets, transactions, sibling perp-pnl-summary', credits: 4, at: final.gate.calls.at(-1).at, cached: false, decided: 'BLOCK' });
  const { listRawReads } = await import('./live-evidence.js');
  const text = fs.readFileSync(path.join(rawDir, listRawReads(rawDir)[0].file), 'utf8');
  assert.doesNotMatch(text, /Some Fund|address_label/, 'the saved raw read is label-free');
  const saved = JSON.parse(text);
  assert.equal(saved.responses.operator.find(r => r.endpoint === 'profiler/address/related-wallets' && r.request.chain === 'arbitrum').body.data[0].funder_excluded_by_label, false);
  // The top-level list names the owner read's endpoints too, once each (siblings' summary is perp-pnl-summary).
  for (const e of ['profiler/address/related-wallets', 'profiler/address/transactions', 'profiler/perp-pnl-summary']) assert.ok(saved.endpoints.includes(e), `endpoints names ${e}`);
  for (const r of saved.responses.operator) assert.ok(saved.endpoints.includes(r.endpoint), `endpoints names ${r.endpoint}`);
  assert.equal(new Set(saved.endpoints).size, saved.endpoints.length, 'no endpoint listed twice');
});

test('saveRawRead lists the owner-read endpoints only when the owner read ran', async () => {
  const { saveRawRead } = await import('./live-evidence.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bait-raw-'));
  const base = { '30d': { status: 200 }, '7d': { status: 200 } };
  const read = (at, responses) => JSON.parse(fs.readFileSync(path.join(dir, saveRawRead(dir, { wallet: GRINDER, fetchedAt: at, windows: {}, responses }).file), 'utf8'));
  const skipped = read('2026-09-25T01:00:00.000Z', { ...base, operator: [] });
  assert.deepEqual(skipped.endpoints, ['profiler/perp-pnl-summary']);
  const ran = read('2026-09-25T01:01:00.000Z', { ...base, operator: [
    { endpoint: 'profiler/address/related-wallets', request: { chain: 'ethereum' } },
    { endpoint: 'profiler/address/related-wallets', request: { chain: 'arbitrum' } },
    { endpoint: 'profiler/address/transactions', request: {} },
    { endpoint: 'profiler/perp-pnl-summary', request: {} }] });
  assert.deepEqual(ran.endpoints, ['profiler/perp-pnl-summary', 'profiler/address/related-wallets', 'profiler/address/transactions']);
});

test('v5 live round: an exchange funder is not an operator; the row says why and no sibling is read', async () => {
  const mock = v5Mock({ label: 'Binance 14' });
  const { service } = liveRoom([...answer(4000, 'intrigued', 'Opening small.')], mock, { fillPages: 1, positions: true, operatorIndex: INDEX });
  const round = await service.start({ prospect: 'grinder' });
  assert.equal(mock.seen.filter(c => c.pathName === 'profiler/address/transactions' || c.body?.address === SIBLING).length, 0);
  await say(service, round.id, 0, round.dossier.facts[0].insert);
  const { final } = await service.finish(round.id, { wire: true });
  const row = final.gate.checks.find(c => c.id === 'operator_record');
  assert.equal(row.result, 'not_assessed');
  assert.equal(row.plain, 'Not assessed: no first funder counts as an owner (arbitrum 0x1111...1111: label: exchange, bridge, router or service).');
  assert.doesNotMatch(JSON.stringify(final), /Binance/);
});

test('v5 live round: a wallet an earlier row refuses never buys the operator read', async () => {
  const mock = v5Mock();
  const base = mock.call;
  mock.call = async (pathName, body, opts) => {
    const res = await base(pathName, body, opts);
    if (pathName === 'profiler/perp-pnl-summary' && body.address === GRINDER && Math.round((Date.parse(body.date.to) - Date.parse(body.date.from)) / 86_400_000) === 30) res.data.data.realized_pnl_usd = -2_000_000;
    return res;
  };
  const { service, live } = liveRoom([...answer(4000, 'intrigued', 'Opening small.')], mock, { fillPages: 1, positions: true, operatorIndex: INDEX });
  const round = await service.start({ prospect: 'grinder' });
  assert.equal(mock.seen.filter(c => c.pathName.startsWith('profiler/address')).length, 0);
  assert.equal(live.status().credits_today, 5);
  await say(service, round.id, 0, round.dossier.facts[0].insert);
  const { final } = await service.finish(round.id, { wire: true });
  const row = final.gate.checks.find(c => c.id === 'operator_record');
  assert.equal(row.result, 'not_assessed');
  assert.match(row.plain, /^Not read: the "realised_pnl_30d" check already refused this request/);
  assert.equal(final.gate.calls.find(c => c.endpoint.startsWith('owner:')).skipped, true);
});

test('a frozen round shows the operator row as not read, never as could not be read', async () => {
  const board = createLeaderboardStore(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bait-room-frozen-')), 'lb.json'));
  const service = createRoomService({ roster: loadRoster(), provider: stubProvider([...answer(4000, 'intrigued', 'Opening small.')]), leaderboard: board });
  const round = await service.start({ prospect: 'grinder' });
  await say(service, round.id, 0, round.dossier.facts[0].insert);
  const { final } = await service.finish(round.id, { wire: true });
  const row = final.gate.checks.find(c => c.id === 'operator_record');
  assert.equal(row.result, 'not_assessed');
  assert.match(row.plain, /frozen capture; related-wallets is read live only|already refused this request/);
});
