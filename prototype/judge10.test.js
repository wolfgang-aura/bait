/**
 * Judge 10 (26 Sep 2026), live build 686f4ff, besides the referee (./referee-corpus.test.js):
 *
 * 2. The every-check page printed "Line 1 · $2,000 · undefined" (THE STREAK) and "Line 1 · $3,500 ·
 *    undefined" (THE LEGEND): a line that committed money but was not the one wired has no stamp.
 * 3. THE LEGEND: PENNY committed $3,500 on line 1 and dropped to $0 on line 3. The card kept "PENNY
 *    HAS COMMITTED $3,500" while the meter read $0, the result said "PENNY refused to send money",
 *    and the what-if ran on $5,000, a figure the player never saw.
 *
 * Stub model replies and frozen captures only: no Nansen call, no model call.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stubProvider } from '../validation/providers.js';
import { createRoomService, createLeaderboardStore, loadRoster, withdrawnCommitment, endingCopy } from './room.js';
import { wireLogRows, commitmentCard } from './public/verdict-view.js';

const board = () => createLeaderboardStore(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bait-j10b-')), 'lb.json'));
const accept = { text: '{"valid":true,"reason":""}' };
const desk = (n, line = 'Fine.') => ({ text: `Reasoning.\n{"allocation": ${n}, "mood": "${n ? 'intrigued' : 'suspicious'}", "line": "${line}"}\nALLOCATION: ${Math.round((n / 25000) * 100)}` });
const BAD = /\b(undefined|null|NaN)\b/;

async function play(id, allocations, line) {
  const script = allocations.flatMap(n => [accept, desk(n)]);
  const service = createRoomService({ roster: loadRoster(), provider: stubProvider(script), leaderboard: board(), health: () => ({}) });
  let state = await service.start({ prospect: id });
  const cards = [];
  for (let i = 0; i < allocations.length; i++) {
    state = await service.pitch(state.id, { requestId: `judge10-${id}-${i}-${allocations.join('-')}`, shot: i, text: line });
    cards.push(commitmentCard(state.shots.at(-1), state.shots.at(-2)?.allocation ?? 0, { to: state.prospect.name, linesLeft: state.shotsLeft }));
  }
  return { state, cards, result: await service.finish(state.id, {}) };
}

// ------------------------------------------------------- 3. a commitment PENNY took back

test('judge 10: THE LEGEND round: $3,500 on line 1, $0 on line 3 is said as a withdrawal, on the card, the result and the what-if', async () => {
  const { cards, result } = await play('legend', [3500, 3500, 0], '+$118,975,612 all time on the public Hyperliquid leaderboard.');
  const { final, shots } = result;
  // The in-play card follows the meter down.
  assert.equal(cards[0].title, 'Line 1 · PENNY has committed $3,500 to THE LEGEND');
  assert.equal(cards[1].title, 'Line 2 · PENNY still commits $3,500 to THE LEGEND');
  assert.equal(cards[2].kind, 'withdrawn');
  assert.equal(cards[2].title, 'Line 3 · PENNY withdrew its $3,500 commitment to THE LEGEND');
  assert.equal(cards[2].amount, '$0');
  assert.match(cards[2].why, /nothing is committed, so nothing is wired/);
  // The result says what happened, not "refused".
  assert.equal(final.headline, 'PENNY committed $3,500 on line 1, then withdrew it on line 3.');
  assert.doesNotMatch(final.headline, /refused/);
  assert.equal(final.stamp, 'NO WIRE');
  // The what-if is on the $3,500 the player saw, and says where it comes from.
  assert.equal(final.whatIf.amount, 3500);
  assert.equal(final.whatIf.intro, "PENNY withdrew its $3,500 commitment. Here's what the BAIT check would have done with that $3,500:");
  assert.equal(final.subline, "Nothing was wired. Had the $3,500 PENNY committed on line 1 gone out, the BAIT check would have blocked it on THE LEGEND's record.");
  assert.doesNotMatch(JSON.stringify([final.headline, final.subline, final.whatIf.intro]), /\$5,000/);
  // The wire log shows the $3,500 and what became of it.
  assert.deepEqual(wireLogRows(shots).map(r => r.text), [
    'Line 1 · $3,500 · committed, restated on line 2',
    'Line 2 · $3,500 · committed, withdrawn on line 3',
    'Line 3 · PENNY withdrew its $3,500, no wire',
  ]);
});

test('judge 10: a PENNY that never committed is checked on a fifth of its fund, and the page says so', async () => {
  const { result: { final, shots } } = await play('legend', [0, 0, 0], '+$118,975,612 all time on the public Hyperliquid leaderboard.');
  assert.equal(final.headline, 'PENNY refused to send money.');
  assert.equal(final.whatIf.amount, 5000);
  assert.match(final.whatIf.intro, /with \$5,000, a fifth of its \$25,000 fund:$/);
  assert.match(final.subline, /Had it sent \$5,000, a fifth of its \$25,000 fund, the BAIT check would have/);
  assert.equal(withdrawnCommitment(shots), null);
});

test('judge 10: a lowered commitment is wired at the lower amount, and every line says what it did', async () => {
  const { cards, result } = await play('streak', [2000, 1000], '+$94,310,198 all time on the public Hyperliquid leaderboard.');
  assert.equal(cards[1].title, 'Line 2 · PENNY lowered its commitment to THE STREAK from $2,000 to $1,000');
  const rows = wireLogRows(result.shots).map(r => r.text);
  assert.equal(rows[0], 'Line 1 · $2,000 · committed, lowered to $1,000 on line 2');
  assert.match(rows[1], /^Line 2 · \$1,000 · BLOCKED · \$1,000 stopped$/);
  assert.equal(rows.length, 2);
});

// ---------------------------------------------------------- 2. no "undefined" on any screen

test('judge 10: no wire-log row, card, headline or subline says undefined, null or NaN, across fixture states', async () => {
  const shot = (n, allocation, extra = {}) => ({ n, text: 'x', line: 'Fine.', caught: false, allocation, wire: allocation > 0 ? { attempted: allocation, attemptedLabel: `$${allocation.toLocaleString('en-US')}`, pending: true } : null, ...extra });
  const wired = (n, allocation, verdict) => shot(n, allocation, { wire: { attempted: allocation, attemptedLabel: `$${allocation.toLocaleString('en-US')}`, decision: verdict === 'block' ? 'block' : 'allow', verdict, stamp: { block: 'BLOCKED', capped: 'CAPPED', allow: 'CLEARED' }[verdict], stoppedLabel: '$0' } });
  const states = [
    [],
    [shot(1, 0), shot(2, 0), shot(3, 0)],
    [shot(1, 3500), shot(2, 3500), shot(3, 0)],
    [shot(1, 2000), wired(2, 1000, 'block')],
    [shot(1, 1000), wired(2, 4000, 'capped')],
    [shot(1, 1000), { n: 2, text: 'x', caught: true, allocation: 1000, referee: 'Referee: x.' }, wired(3, 1000, 'allow')],
    [{ n: 1, text: 'x', caught: true, allocation: 0 }, shot(2, 2500)],
    [shot(1, 2500, { wire: { attempted: 2500 } })],
    [shot(1, 2500, { wire: {} })],
  ];
  for (const shots of states) {
    for (const r of wireLogRows(shots)) assert.doesNotMatch(r.text, BAD, JSON.stringify(shots));
    shots.forEach((s, i) => {
      const card = commitmentCard(s, shots[i - 1]?.allocation ?? 0, { to: 'THE STREAK', linesLeft: 2 - i });
      if (card) for (const v of Object.values(card)) assert.doesNotMatch(String(v), BAD);
    });
    const peak = shots.filter(s => !s.caught).at(-1)?.allocation ?? 0;
    const end = endingCopy({ s: { prospect: { name: 'THE STREAK' }, shots }, peak, executed: 0, verdict: 'block', gate: null });
    assert.doesNotMatch(`${end.headline} ${end.subline}`, BAD);
  }
});

test('judge 10: the page renders the wire log and the card from the tested helpers', () => {
  const js = fs.readFileSync(new URL('./public/room.js', import.meta.url), 'utf8');
  assert.match(js, /for \(const r of wireLogRows\(list\)\)/);
  assert.match(js, /const card = commitmentCard\(latest, shots\[shots\.length - 2\]\?\.allocation \?\? 0/);
  assert.match(js, /final\.whatIfIntro \?\?/);
  assert.doesNotMatch(js, /\$\{w\.stamp\}/);
});

// ------------------------------------------------------------------------------------ nits

test('judge 10: a drawdown row is named by the base and limit it measures, and says its fills once', async () => {
  const service = createRoomService({ roster: loadRoster(), provider: stubProvider([]), leaderboard: board(), health: () => ({}) });
  const steady = (await service.fixture('steadyhand')).gate.checks.find(c => c.id === 'fills_drawdown');
  const grinder = (await service.fixture('grinder')).gate.checks.find(c => c.id === 'fills_drawdown');
  assert.equal(steady.name, 'Drawdown from peak (limit 30%)');
  assert.equal(grinder.name, 'Drawdown vs account value (limit 15%)');
  for (const row of [steady, grinder]) {
    const where = row.plain.match(/over (the [^:]+?):/)?.[1];
    assert.ok(where, row.plain);
    assert.equal(row.plain.split(where).length - 1, 1, `the fills are named once: ${row.plain}`);
  }
  const js = fs.readFileSync(new URL('./public/room.js', import.meta.url), 'utf8');
  assert.match(js, /name\.textContent = c\.name \?\? checkName\(c\.id\);/);
});

test('judge 10: at phone width a best-cons card\'s last grid track takes the row, so its text spans the card', () => {
  const css = fs.readFileSync(new URL('./public/room.css', import.meta.url), 'utf8');
  assert.match(css, /\.board-list li \{ grid-template-columns: 20px 38px minmax\(0, 1fr\);/);
  assert.doesNotMatch(css, /\.board-list li \{ grid-template-columns: 20px 38px 80px; \}/);
});

test('judge 10: a what-if says what BAIT would do, never that it blocked or sent money', async () => {
  const { roomAgentLine } = await import('./room.js');
  assert.equal(roomAgentLine('block', { failed: 'realised_pnl_30d' }, false, { whatIf: true }), 'The Nansen record shows negative realised PnL over 30 days, so BAIT would block the transfer.');
  assert.match(roomAgentLine('capped', { checks: [{ id: 'open_book', result: 'cap' }] }, false, { whatIf: true }), /BAIT would send a quarter of the request and hold the rest\.$/);
  const { result: { final } } = await play('legend', [3500, 0, 0], '+$118,975,612 all time on the public Hyperliquid leaderboard.');
  assert.match(final.agentLine, /would block/);
});

test('judge 10: the checkpoint stamp lands at its own tilt, so a long what-if stamp never covers the button', () => {
  const css = fs.readFileSync(new URL('./public/room.css', import.meta.url), 'utf8');
  assert.match(css, /\.cp-stamp \{ animation-name: cp-stamp; \}/);
  assert.match(css, /@keyframes cp-stamp \{ from \{ opacity: 0; transform: rotate\(-2deg\) scale\(2\.4\); \} to \{ opacity: 1; transform: rotate\(-2deg\) scale\(1\); \} \}/);
});
