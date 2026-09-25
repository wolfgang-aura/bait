/**
 * Judge 6 (26 Sep 2026), three screens that said something untrue:
 *
 * 1. A line of true figures in the wrong window ("+$X in the last 7 days, with a 52.9% win rate over
 *    2,743 trades", the win rate and count being 30-day figures) was rejected and the referee said
 *    "a figure in that line is not in the record", which was false; PENNY said "Hm. Go on." under
 *    the caught face.
 * 2. The tile's saved figure sat above a live stamp that belonged to the trade count, and only THE
 *    STEADY HAND linked its tile figure to the round's read.
 * 3. The checkpoint's "Reading Nansen ..." line listed owner endpoints the round never called.
 *
 * Frozen captures and a scripted provider only: no Nansen or model call.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stubProvider } from '../validation/providers.js';
import {
  createRoomService, createLeaderboardStore, loadRoster, buildProspectDossier, refereeVerdict, roundReads, publicDossier,
} from './room.js';
import { movedSince } from './roster.js';
import { createRosterPulse } from './roster-pulse.js';

const tempBoard = () => createLeaderboardStore(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bait-j6-')), 'lb.json'));
const desk = (committed, mood, line) => ({ text: `Reasoning.\n{"allocation": ${committed}, "mood": "${mood}", "line": "${line}"}\nALLOCATION: ${Math.round((committed / 25000) * 100)}` });
const accept = { text: '{"valid":true,"reason":""}' };
const rosterRoom = script => createRoomService({ roster: loadRoster(), provider: stubProvider(script), leaderboard: tempBoard(), health: () => ({ ready: true }) });
const steady = () => loadRoster().find(p => p.id === 'steadyhand');

// ------------------------------------------------------------------ 1. the referee

test('judge 6: 30-day figures typed under "last 7 days" get the real reason, not "not in the record"', () => {
  const p = steady();
  const d = buildProspectDossier(p);
  // THE STEADY HAND's saved read: 7-day +$190,379; 30-day 51.4% win rate over 2,661 trades.
  const line = 'The Steady Hand made +$190,379 realised in the last 7 days, with a 51.4% win rate over 2,661 trades.';
  assert.equal(refereeVerdict(line, d, p.checkerData), 'Referee: 51.4% and 2,661 trades are 30-day figures, not 7-day. The line is spent.');
  // The other way round: a 7-day figure said over 30 days.
  assert.equal(refereeVerdict('It made +$190,379 over 30 days.', d, p.checkerData), 'Referee: +$190,379 is a 7-day figure, not 30-day. The line is spent.');
  // A figure off the record is still named.
  assert.equal(refereeVerdict('Made $209,987 on ZEC.', d, p.checkerData), 'Referee: $209,987 is not in the record. The line is spent.');
  // No specific reason: the referee never claims a figure is missing.
  const general = refereeVerdict('He never loses. Best on the board.', d, p.checkerData);
  assert.doesNotMatch(general, /not in the record/);
  assert.equal(general, 'Referee: the line does not match the record as stated. The line is spent.');
  // A sealed figure is never placed in its window by the referee (that would confirm it).
  const sealed = Math.round(p.checkerData.pnl_summary_30d.realized_pnl_usd).toLocaleString('en-US');
  assert.doesNotMatch(refereeVerdict(`It made +$${sealed} in 7 days.`, d, p.checkerData), /30-day/);
});

test('judge 6: a caught line shows the window reason, and PENNY does not answer as if nothing happened', async () => {
  const service = rosterRoom([{ text: '{"valid":false,"reason":"The win rate and trade count are 30-day figures, not 7-day."}' }]);
  const round = await service.start({ prospect: 'steadyhand' });
  const state = await service.pitch(round.id, { requestId: 'judge6-caught-0', shot: 0,
    text: 'The Steady Hand made +$190,379 realised in the last 7 days, with a 51.4% win rate over 2,661 trades.' });
  const shot = state.shots[0];
  assert.equal(shot.caught, true);
  assert.equal(shot.referee, 'Referee: 51.4% and 2,661 trades are 30-day figures, not 7-day. The line is spent.');
  assert.equal(state.mood, 'caught');
  assert.doesNotMatch(state.line, /go on/i, 'no normal reply under the caught face');
  assert.match(state.line, /referee/i);
  assert.equal(shot.line, state.line);
});

// -------------------------------------------------------------- 2. the tile stamp

test('judge 6: every tile figure is labelled with the read it came from', () => {
  const tiles = Object.fromEntries(loadRoster().map(p => [p.id, p.hype]));
  assert.equal(tiles.steadyhand.readLabel, 'Nansen saved read 25 Sep 11:31 UTC');
  assert.equal(tiles.grinder.readLabel, 'Nansen saved read 15 Sep 10:40 UTC');
  for (const id of ['legend', 'streak', 'realdeal']) assert.equal(tiles[id].readLabel, 'Hyperliquid leaderboard read 21 Sep 21:56 UTC', id);
});

test('judge 6: the pulse stamp names the trade count it dates, live or saved', async () => {
  const p = steady();
  const budget = { sharedBlocker: () => null, reserve: () => ({ settle() {} }) };
  const live = createRosterPulse({ prospects: [p], budget, now: () => new Date('2026-09-26T16:51:00Z'),
    call: async () => ({ headers: {}, data: { data: { closed_trade_count: 611, traded_coin_count: 3 } } }) });
  const w = (await live.get()).wallets[0];
  assert.equal(w.figure, '611 trades closed in the last 7 days');
  assert.equal(w.stamp, 'count: Nansen, read live 16:51 UTC');
  const off = createRosterPulse({ prospects: [p], budget: { ...budget, sharedBlocker: () => ({ code: 'disabled' }) }, call: async () => { throw new Error('no'); } });
  assert.equal((await off.get()).wallets[0].stamp, 'live reads off · count: Nansen saved read 25 Sep 11:31 UTC');
});

test('judge 6: one rule for every wallet: the tile figure is linked to the same window on the round\'s read', async () => {
  const roster = loadRoster();
  const by = id => roster.find(p => p.id === id);
  // THE REAL DEAL: the tile is the leaderboard's 30 days to 21 Sep; the round reads Nansen's 30-day realised.
  const realdeal = by('realdeal');
  const tile30 = realdeal.hypeRow.month_pnl_usd;
  const read30 = realdeal.snapshot.pnl_summary_30d.realized_pnl_usd;
  const m = movedSince(realdeal);
  assert.equal(m.window, '30-day');
  assert.equal(m.delta, Math.round(read30 - tile30));
  assert.equal(m.line, `30-day: the tile's +$116,554 is the 21 Sep 21:56 leaderboard read; this read's realised is +$35,083, ${m.deltaLabel} apart`);
  // THE STREAK: the tile's leaderboard week against the round's 7-day realised.
  assert.equal(movedSince(by('streak')).window, '7-day');
  // An all-time tile has no window on the round's read; a frozen Nansen tile is the round's read.
  assert.equal(movedSince(by('legend')), null);
  assert.equal(movedSince(by('steadyhand')), null);
  assert.equal(movedSince(by('grinder')), null);

  // Before the verdict the link is shown only when the round's figure is on an offered card:
  // THE REAL DEAL's 30-day realised is sealed, so the facts panel does not carry it.
  const before = publicDossier(buildProspectDossier(realdeal));
  assert.equal(before.moved, null);
  // After the verdict the result screen links the tile to the round's read, whatever was pitched.
  const service = rosterRoom([accept, desk(4000, 'intrigued', 'Small probe.')]);
  const round = await service.start({ prospect: 'realdeal' });
  assert.equal(round.dossier.moved, null);
  await service.pitch(round.id, { requestId: 'judge6-moved-0', shot: 0, text: round.dossier.facts[0].insert });
  const { final } = await service.finish(round.id, { wire: true });
  assert.equal(final.pitched.moved?.line, m.line);
});

// ------------------------------------------------------- 3. what the checkpoint read

test('judge 6: the "Reading Nansen" line lists only the owner calls this read made', () => {
  const p = steady();
  const v5 = p.snapshot.v5_reads;
  assert.ok(roundReads(p.snapshot).includes('transactions'), 'the saved read called all three');
  const onlyRelated = { ...p.snapshot, v5_reads: { ...v5, endpoints: ['profiler/address/related-wallets'], credits: 2 } };
  const reads = roundReads(onlyRelated);
  assert.ok(reads.includes('related-wallets'));
  assert.ok(!reads.includes('transactions'), 'transactions was not called');
  assert.ok(!reads.some(r => /siblings/.test(r)), 'no sibling summaries were read');
});

// ------------------------------------------------------------------ NITs

test('judge 6: the headline says what PENNY said and "anyway" only when BAIT stopped money', async () => {
  const { endingCopy } = await import('./room.js');
  // PENNY's line from the judge's REAL DEAL round: a remark on a gap, not "no track record".
  const shots = [{ n: 1, text: '67.8% win rate across 115 closed trades in 7 days.', line: 'Win rate without 30-day P&L tells me little. Small size.', caught: false, allocation: 4000, wire: { attempted: 4000 } }];
  const s = { prospect: { name: 'THE REAL DEAL' }, shots };
  assert.equal(endingCopy({ s, peak: 4000, executed: 4000, verdict: 'allow' }).headline, 'PENNY noted a gap in the record, then agreed to send $4,000.');
  assert.equal(endingCopy({ s, peak: 4000, executed: 1000, verdict: 'capped' }).headline, 'PENNY noted a gap in the record, then agreed to send $4,000 anyway.');
});

test('judge 6: the owner sentence is said once on the result screen; phone rows keep the sentence', async () => {
  const { oncePitched } = await import('./public/verdict-view.js');
  assert.equal(oncePitched('First funder 0xeb26...d4cf also funds 4 indexed wallets that lost $1,228,400 over 30 days; this is the one being pitched.'),
    'First funder 0xeb26...d4cf also funds 4 indexed wallets that lost $1,228,400 over 30 days.');
  assert.equal(oncePitched('Closed trades over 30 days came to -$1.'), 'Closed trades over 30 days came to -$1.');
  const css = fs.readFileSync(new URL('./public/room.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /\.cp-row span \{ display: none; \}/, 'the checkpoint sentence (worst trade share, concentration reason) shows at 375 too');
  const client = fs.readFileSync(new URL('./public/room.js', import.meta.url), 'utf8');
  assert.doesNotMatch(client, /One market not carrying the month/, 'a PASS row name must not read as the opposite of its figure');
});
