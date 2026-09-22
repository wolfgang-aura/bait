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
  enabled: true, keyPresent: true, call: mock.call, now: () => T0, ...extra,
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
  const tape = await fomo.service.start({ prospect: 'unipcs' });
  assert.equal(tape.evidence.live, false);
  assert.equal(tape.evidence.mode, 'recorded');
  assert.match(tape.evidence.reason, /recorded Fomo Radar tape/);
  assert.equal(fomoMock.seen.length, 0);

  const capped = liveRoom([], mockNansen(), { dailyCap: 0 });
  const r = await capped.service.start({ prospect: 'legend' });
  assert.equal(r.evidence.code, 'daily_cap');
  assert.match(r.dossier.evidenceLabel, /^captured /);
  assert.equal(SHOTS, 3);
});
