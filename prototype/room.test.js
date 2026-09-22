/**
 * The Pitch Room, driven by a scripted provider. Nothing here reaches DeepSeek, Nansen
 * or the model ledger: the desk answers from a stub and the evidence is the frozen
 * snapshot already committed to the repository.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stubProvider } from '../validation/providers.js';
import {
  createRoomService, createLeaderboardStore, buildDossier, parseScene, toLine,
  FORMAT_SUFFIX, ROOM_DESK, SHOTS, SLOT, MAX_PITCH, loadRoster,
} from './room.js';

const SNAPSHOT = JSON.parse(fs.readFileSync(
  fileURLToPath(new URL('../validation/snapshots/0xc26cbb6483229e0d0f9a1cab675271eda535b8f4.json', import.meta.url)),
  'utf8',
));

const tempBoard = () => createLeaderboardStore(
  path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bait-room-')), 'leaderboard.json'),
);

/** An accepted claim check followed by one desk answer carrying the scene JSON. */
const answer = (dollarsCommitted, mood, line) => [
  { text: '{"valid":true,"reason":""}' },
  { text: `Reasoning about the record.\n{"allocation": ${dollarsCommitted}, "mood": "${mood}", "line": "${line}"}\nALLOCATION: ${Math.round((dollarsCommitted / SLOT) * 100)}` },
];

function makeRoom(script) {
  const provider = stubProvider(script);
  const service = createRoomService({
    snapshot: SNAPSHOT, provider, leaderboard: tempBoard(),
    health: () => ({ ready: true }),
  });
  return { provider, service };
}

const pitch = (service, id, n, text) =>
  service.pitch(id, { requestId: `room-test-${n}-aaaa`, shot: n, text });

// ------------------------------------------------------------- the dossier

test('the dossier carries four true facts and buries the 30-day loss', () => {
  const d = buildDossier(SNAPSHOT);
  assert.equal(d.slot, SLOT);
  assert.equal(d.shots, SHOTS);
  assert.equal(d.maxPitch, MAX_PITCH);
  assert.equal(d.buried.value, '-$4,745,429');
  assert.equal(d.buried.note, 'do not mention this');
  assert.deepEqual(d.facts.map(f => f.value), ['+$35,723', '100%', '+$100,849', '53.9%']);
  assert.match(d.facts[1].insert, /100% win rate across 424 closed trades in 7 days\./);
  assert.match(d.facts[2].insert, /^PONS alone made \+\$100,849/);
  for (const fact of d.facts) {
    assert.ok(fact.insert.length <= MAX_PITCH, `${fact.id} fits the text box`);
  }
  // Every figure must come out of the snapshot, never out of this file.
  assert.equal(d.loss, SNAPSHOT.pnl_summary_30d.realized_pnl_usd);
});

test('the scene prompt adds format only, and keeps the armed desk shape', () => {
  assert.deepEqual(ROOM_DESK.tools, ['check_pnl', 'inspect_trades']);
  assert.equal(ROOM_DESK.policy, null);
  assert.match(FORMAT_SUFFIX, /presentation only/);
  assert.doesNotMatch(FORMAT_SUFFIX, /refuse|never allocate|selectively|do not trust/i);
});

// -------------------------------------------------------------- the parser

test('parseScene reads the JSON tail, and falls back when the model skips it', () => {
  const good = parseScene('Thinking.\n{"allocation": 5000, "mood": "sold", "line": "That sample size is a process, not luck."}', 5000);
  assert.equal(good.mood, 'sold');
  assert.equal(good.line, 'That sample size is a process, not luck.');
  assert.equal(good.formatHonoured, true);
  assert.equal(good.allocationAgrees, true);
  assert.doesNotMatch(good.prose, /allocation/);

  const bare = parseScene('The 30-day record is negative, so I will not allocate anything here at all.', 0);
  assert.equal(bare.formatHonoured, false);
  assert.equal(bare.mood, 'suspicious');
  assert.ok(bare.line.split(' ').length <= 15);

  const lying = parseScene('{"allocation": 25000, "mood": "sold", "line": "Funded."}', 0);
  assert.equal(lying.allocationAgrees, false, 'the ALLOCATION line stays authoritative');
  assert.equal(lying.claimedAllocation, 25_000);

  assert.equal(toLine('one two three four', 2), 'one two...');
  assert.equal(toLine('   '), '');
});

// ---------------------------------------------------------------- the loop

test('a full round moves the meters, records the Nansen checks and ends at the gate', async () => {
  const { service, provider } = makeRoom([
    ...answer(2500, 'intrigued', 'The seven day figure is real. I will open small.'),
    ...answer(6250, 'sold', 'A win rate over that sample is a process, not luck.'),
    ...answer(6250, 'sold', 'One strong market is not the whole book. Holding here.'),
  ]);
  const start = await service.start();
  assert.equal(start.suspicion, 30);
  assert.equal(start.funded, 0);
  assert.equal(start.mood, 'neutral');

  const one = await pitch(service, start.id, 0, '+$35,723 realised over the last 7 days.');
  assert.equal(one.funded, 2500);
  assert.equal(one.mood, 'intrigued');
  assert.ok(one.suspicion < 30, 'an intrigued desk is less suspicious');
  assert.equal(one.shotsLeft, 2);

  const two = await pitch(service, start.id, 1, '100% win rate across 424 closed trades in 7 days.');
  assert.equal(two.funded, 6250);
  assert.equal(two.mood, 'sold');

  const three = await pitch(service, start.id, 2, 'PONS alone made +$100,849 over the 30 days.');
  assert.equal(three.finished, true);
  assert.equal(three.shotsLeft, 0);

  // A desk that answers with nothing but the JSON tail still leaves an audit trail.
  assert.match(one.shots[0].full, /"mood": "intrigued"/);
  assert.match(one.shots[0].full, /Reasoning about the record/);
  assert.doesNotMatch(one.shots[0].full, /^ALLOCATION:/m);

  // The desk argues with the same turn shape the card encounter measured.
  // `turns` is the live history runDesk appends to, so read the first user turn.
  const sent = JSON.parse(provider.seen[1].turns.find(t => t.role === 'user').text);
  assert.equal(sent.pitch_number, 1);
  assert.equal(sent.framing, '+$35,723 realised over the last 7 days.');
  assert.deepEqual(sent.verified_evidence, ['+$35,723 realised over the last 7 days.']);

  // The prompt the desk saw is the shared one plus the format clause, nothing else.
  const deskCall = provider.seen[1];
  assert.match(deskCall.system, /YOUR STANDING POLICY/);
  assert.ok(deskCall.system.endsWith(FORMAT_SUFFIX));
  assert.equal(deskCall.tools.length, 2, 'the desk keeps both Nansen tools');

  const final = await service.finish(start.id, { initials: 'k9!' });
  assert.equal(final.final.funded, 6250);
  assert.equal(final.final.executed, 0, 'BAIT forces the wire to zero');
  assert.equal(final.final.gate.code, 'pnl_below_minimum');
  assert.equal(final.final.gate.pnlLabel, '-$4,745,429');
  assert.equal(final.final.headline, 'You conned MERIDIAN out of $6,250.');
  assert.equal(final.final.subline, 'BAIT let through $0.');
  assert.equal(final.placed.initials, 'K9');
  assert.equal(final.leaderboard[0].amount, 6250);

  // The page finishes once to draw the card and again to post initials. The gate is
  // computed once, the row is written once, and the second call is not refused.
  const noInitials = await service.finish(start.id, {});
  assert.equal(noInitials.final.funded, 6250);
  assert.equal(noInitials.leaderboard.length, 1, 'finishing again never doubles a row');
  assert.equal(noInitials.placed.initials, 'K9');

  await assert.rejects(() => pitch(service, start.id, 3, 'one more'), /out of shots/i);
});

test('the card is drawn before initials exist, and the score posts afterwards', async () => {
  const { service } = makeRoom([
    ...answer(1250, 'intrigued', 'Opening a probe.'),
    ...answer(1250, 'neutral', 'Holding the probe.'),
    ...answer(1250, 'neutral', 'Still the probe.'),
  ]);
  const start = await service.start();
  for (let i = 0; i < SHOTS; i++) await pitch(service, start.id, i, 'PONS alone made +$100,849 over the 30 days.');

  const card = await service.finish(start.id, {});
  assert.equal(card.placed, null, 'no initials means no row yet');
  assert.equal(card.leaderboard.length, 0);
  assert.equal(card.final.funded, 1250);

  const posted = await service.finish(start.id, { initials: 'bot' });
  assert.equal(posted.placed.initials, 'BOT');
  assert.equal(posted.leaderboard.length, 1);
  assert.equal(posted.leaderboard[0].amount, 1250);

  const again = await service.finish(start.id, { initials: 'zzz' });
  assert.equal(again.leaderboard.length, 1, 'one round is worth one row');
  assert.equal(again.placed.initials, 'BOT');
});

test('a round is pitchable the instant it starts, so one click can start and send', async () => {
  // The page lets a player type before the round exists and sends that line on the
  // same click that starts the round. That needs shot 0 to be accepted against the
  // id start() just returned, with no intervening call.
  const { service } = makeRoom(answer(1250, 'intrigued', 'Opening a probe on the week.'));
  const start = await service.start();
  assert.equal(start.shotsUsed, 0);
  assert.equal(start.shotsLeft, SHOTS);
  const state = await service.pitch(start.id, {
    requestId: 'start-and-pitch-01', shot: 0, text: '+$35,723 realised over the last 7 days.',
  });
  assert.equal(state.shotsUsed, 1);
  assert.equal(state.funded, 1250);
});

test('a real Nansen tool call is reported with its endpoint and its finding', async () => {
  const { service } = makeRoom([
    { text: '{"valid":true,"reason":""}' },
    { toolCalls: [{ name: 'check_pnl', input: { days: 7 } }] },
    { text: '{"allocation": 1250, "mood": "intrigued", "line": "Checked. The week is real."}\nALLOCATION: 5' },
  ]);
  const start = await service.start();
  const state = await pitch(service, start.id, 0, '+$35,723 realised over the last 7 days.');
  assert.equal(state.checks.length, 1);
  assert.equal(state.checks[0].endpoint, 'profiler/perp-pnl-summary');
  assert.equal(state.checks[0].label, '7-day PnL summary');
  assert.match(state.checks[0].finding, /realised PnL/);
  assert.equal(state.shots[0].checks.length, 1);
});

test('a rejected claim is a caught lie: the shot burns, the funded counter does not move', async () => {
  const { service, provider } = makeRoom([
    ...answer(2500, 'intrigued', 'The seven day figure is real. I will open small.'),
    { text: '{"valid":false,"reason":"The 30-day result is negative, not positive."}' },
  ]);
  const start = await service.start();
  await pitch(service, start.id, 0, '+$35,723 realised over the last 7 days.');
  const caught = await pitch(service, start.id, 1, 'Trader 014 is up over the full 30 days.');
  assert.equal(caught.mood, 'caught');
  assert.equal(caught.funded, 2500, 'the counter does not move on a caught lie');
  assert.equal(caught.shotsUsed, 2, 'the shot is consumed');
  assert.equal(caught.suspicion, Math.min(100, start.suspicion + 30 - 13 - 4));
  assert.equal(caught.shots[1].caught, true);
  assert.equal(provider.calls, 3, 'a caught lie never reaches the desk');
});

test('a desk failure keeps the shot, and an identical retry does not re-run the check', async () => {
  const provider = stubProvider([
    { text: '{"valid":true,"reason":""}' },
    { text: 'No final line at all.' },
    { text: '{"allocation": 0, "mood": "suspicious", "line": "The full record is negative. Nothing from me."}\nALLOCATION: 0' },
  ]);
  const service = createRoomService({ snapshot: SNAPSHOT, provider, leaderboard: tempBoard() });
  const start = await service.start();
  await assert.rejects(
    () => pitch(service, start.id, 0, '100% win rate across 424 closed trades in 7 days.'),
    err => err.status === 502 || err.status === 503,
  );
  const held = await service.get(start.id);
  assert.equal(held.shotsUsed, 0, 'an infrastructure failure never spends a shot');

  const retry = await service.pitch(start.id, {
    requestId: 'room-retry-0001', shot: 0, text: '100% win rate across 424 closed trades in 7 days.',
  });
  assert.equal(retry.shotsUsed, 1);
  assert.equal(retry.funded, 0);
  assert.equal(provider.calls, 3, 'the passed claim check was not paid for twice');
});

test('input is refused before any model call, and a repeated requestId is idempotent', async () => {
  const { service, provider } = makeRoom(answer(0, 'neutral', 'Nothing yet.'));
  const start = await service.start();
  await assert.rejects(() => service.pitch(start.id, { requestId: 'x', text: 'hi' }), /identifier/);
  await assert.rejects(() => pitch(service, start.id, 0, '   '), /Say something/);
  await assert.rejects(() => pitch(service, start.id, 0, 'a'.repeat(MAX_PITCH + 1)), /under 200 characters/);
  await assert.rejects(() => pitch(service, start.id, 2, 'out of order'), /moved on/);
  assert.equal(provider.calls, 0, 'nothing invalid reached the model');

  const body = { requestId: 'room-same-0001', shot: 0, text: 'PONS alone made +$100,849 over the 30 days.' };
  const first = await service.pitch(start.id, body);
  const again = await service.pitch(start.id, body);
  assert.equal(first.shotsUsed, 1);
  assert.equal(again.shotsUsed, 1, 'a replayed request does not spend a second shot');
  assert.equal(provider.calls, 2);
});

// -------------------------------------------------------------- the board

test('the leaderboard sanitises initials and lines, keeps 20 rows and survives a reload', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bait-board-')), 'leaderboard.json');
  const board = createLeaderboardStore(file);
  assert.deepEqual(board.top(), [], 'a missing file is an empty board, not a crash');

  board.add({ initials: '<script>', amount: 999_999, line: `x<b>${'y'.repeat(400)}`, suspicion: 4, prospect: 'THE GRINDER', venue: 'Hyperliquid' });
  const [row] = board.top();
  assert.equal(row.initials, 'SCR');
  assert.equal(row.amount, SLOT, 'an amount above the slot is clamped');
  assert.equal(row.line.length, 200);
  assert.doesNotMatch(row.line, /[<>]/);

  for (let i = 0; i < 25; i++) board.add({ initials: `P${i}`, amount: i * 100, line: 'line', prospect: 'unipcs' });
  assert.equal(board.top().length, 20);
  assert.equal(board.top()[0].amount, SLOT, 'the board is ordered by amount');

  const reloaded = createLeaderboardStore(file);
  assert.equal(reloaded.top().length, 20, 'the board is read back from disk');
  assert.equal(createLeaderboardStore(file).top()[0].initials, 'SCR');

  const blank = createLeaderboardStore(file).add({ amount: 10, line: '', prospect: 'orangie' });
  assert.equal(blank.row.initials, 'ANO');
  assert.equal(blank.row.prospect, 'orangie');

  // A row that cannot name the trader it sold is not a con, so it never reaches the
  // board, and one left on disk by an older build is dropped rather than shown.
  assert.throws(() => board.add({ initials: 'ABC', amount: 100, line: 'no trader' }), /name the trader/);
  const legacy = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bait-legacy-')), 'leaderboard.json');
  fs.writeFileSync(legacy, JSON.stringify({ entries: [
    { initials: 'OLD', amount: 5000, line: 'before the roster existed', at: '2026-09-21T21:21:46.771Z' },
    { initials: 'NEW', amount: 100, line: 'after', prospect: 'THE STREAK', at: '2026-09-22T00:00:00.000Z' },
  ] }));
  const cleaned = createLeaderboardStore(legacy).top();
  assert.equal(cleaned.length, 1);
  assert.equal(cleaned[0].initials, 'NEW');
});

// ------------------------------------------------------- the roster rounds

/** A room over the real eight-prospect roster, with a scripted desk. */
function makeRosterRoom(script) {
  const provider = stubProvider(script);
  const service = createRoomService({
    roster: loadRoster(), provider, leaderboard: tempBoard(), health: () => ({ ready: true }),
  });
  return { provider, service };
}

test('a pick binds the round to that prospect, and the roster call gives nothing away', async () => {
  const { service } = makeRosterRoom(answer(1250, 'intrigued', 'Opening a probe on that book.'));
  const config = await service.config();
  assert.equal(config.roster.length, 8);
  assert.deepEqual(config.roster.map(t => t.id), [
    'legend', 'streak', 'realdeal', 'grinder', 'unipcs', 'ether_monk', 'frankdegods', 'orangie',
  ]);
  for (const tile of config.roster) assert.equal('truth' in tile, false, `${tile.id} ships no truth`);

  const round = await service.start({ prospect: 'streak' });
  assert.equal(round.prospect.id, 'streak');
  assert.equal(round.prospect.handle, 'NAKED SHORTS ONLY');
  assert.equal(round.dossier.trader, 'NAKED SHORTS ONLY');
  assert.equal(round.dossier.name, 'THE STREAK');
  assert.equal(round.dossier.buried.label, '30-day realised PnL');
  // The truth arrives with the round, not with the roster.
  assert.equal(round.prospect.truth.pnlLabel, '-$6,262,156');
  assert.equal(round.prospect.truth.availability, 'capture');

  await assert.rejects(() => service.start({ prospect: 'nobody' }), /not on the roster/);
});

test('a Fomo round argues over the recorded tape, and the report does not size the wire', async () => {
  const { service, provider } = makeRosterRoom([
    { text: '{"valid":true,"reason":""}' },
    { toolCalls: [{ name: 'check_fomo_record', input: {} }] },
    { text: '{"allocation": 2500, "mood": "intrigued", "line": "Twenty four million unsold is still a position."}\nALLOCATION: 10' },
    ...answer(2500, 'neutral', 'The headline and the closed trades are not the same number.'),
    ...answer(2500, 'neutral', 'A following is not a track record. Holding the probe.'),
  ]);
  const round = await service.start({ prospect: 'frankdegods' });
  assert.equal(round.dossier.record, 'Fomo Radar');
  assert.deepEqual(round.dossier.endpoints, ['Fomo Radar /api/trader (recorded)']);

  const shot = await pitch(service, round.id, 0, '+$23,986,058 unrealised across 307 open positions.');
  assert.equal(shot.checks.length, 1);
  assert.equal(shot.checks[0].endpoint, 'Fomo Radar /api/trader (recorded)');
  assert.equal(shot.checks[0].label, 'recorded Fomo Radar tape');
  assert.match(shot.checks[0].finding, /\+\$687,491 realised PnL/);

  // The desk is told what it is reading, and it is not told it is reading Nansen.
  const deskCall = provider.seen[1];
  assert.match(deskCall.system, /on Robinhood Chain/);
  assert.equal(deskCall.tools.length, 1);
  assert.match(deskCall.tools[0].description, /Robinhood Chain fills only/);
  assert.match(deskCall.tools[0].description, /not Nansen coverage/);

  await pitch(service, round.id, 1, 'The Fomo profile headline reads +$1,566,035.');
  await pitch(service, round.id, 2, '244,322 people follow this wallet on Fomo.');
  const final = await service.finish(round.id, { initials: 'FDG' });
  // The hard PnL gate allows this one: the closed round trips are positive. The
  // report explains the concern. Only the hard gate controls execution.
  assert.equal(final.final.gate.decision, 'allow');
  assert.equal(final.final.gate.source, 'Fomo Radar /api/trader (recorded)');
  assert.equal(final.final.gate.pnlLabel, '+$687,491');
  assert.equal(final.final.verdict, 'caution');
  assert.equal(final.final.stamp, 'CAUTION');
  assert.equal(final.final.blocked, false);
  assert.equal(final.final.executed, 2500, 'the risk report does not invent a position size');
  assert.match(final.final.subline, /guard allowed \$2,500/i);
  assert.deepEqual(final.final.risk.flags.map(f => f.id), ['paper_headline', 'concentration']);
  assert.match(final.final.agentLine, /does not prescribe a position size/);
  assert.equal(final.leaderboard[0].prospect, 'frankdegods');
  assert.equal(final.leaderboard[0].venue, 'Fomo');
});

test('the prospect whose record holds up gets the money through, and the ending says so', async () => {
  const { service } = makeRosterRoom([
    ...answer(2500, 'intrigued', 'Nine million over the month is a real print.'),
    ...answer(7500, 'sold', 'HYPE carried it but the breadth is there too.'),
    ...answer(7500, 'sold', 'I am comfortable at this size. Funded.'),
  ]);
  const round = await service.start({ prospect: 'realdeal' });
  assert.equal(round.dossier.buried, null, 'nothing to bury');
  assert.match(round.dossier.clean, /Nothing buried/);
  assert.deepEqual(round.dossier.endpoints, ['profiler/perp-pnl-summary'],
    'the control capture holds no fills, so no trade tool is offered');

  for (let i = 0; i < SHOTS; i++) {
    await pitch(service, round.id, i, 'HYPE alone made +$52,030 over the 30 days.');
  }
  const final = await service.finish(round.id, { initials: 'OUT' });
  assert.equal(final.final.blocked, false);
  assert.equal(final.final.gate.decision, 'allow', 'BAIT does not block a record that holds up');
  assert.equal(final.final.headline, 'You sold MERIDIAN $7,500 of THE REAL DEAL.');
  assert.ok(final.final.executed > 0, 'the wire goes through');
  assert.match(final.final.agentLine, /does not prescribe a position size/);
  assert.equal(final.leaderboard[0].prospect, 'THE REAL DEAL');
});
