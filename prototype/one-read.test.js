/**
 * Judge 5 (26 Sep 2026): inside one round every figure for a window comes from the same Nansen
 * read, and says which read it is. A live round: the fact cards, the BAIT check and the result
 * screen all use the live read and say "read live HH:MM UTC"; the tile keeps its dated saved
 * figure, and the round says how far the live 7-day figure moved from it. A frozen round: the
 * saved read everywhere, labelled "saved read 25 Sep 11:31 UTC".
 *
 * The live read here is a crafted fixture: THE STEADY HAND's committed saved read
 * (bench/live-reads/20260925T113130Z-0x20438cfd.json) replayed with no network call, moved to
 * 12:40 UTC, with the 7-day, 30-day and sibling figures the judge saw live. No Nansen call.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stubProvider } from '../validation/providers.js';
import { replayLiveRead } from './frozen-read.js';
import { ROOM_LIVE_GUARD_POLICY } from './live-evidence.js';
import { createRoomService, createLeaderboardStore, loadRoster, pitchedFacts } from './room.js';
import { readingLine, pitchedView } from './public/verdict-view.js';
import { ownerTreeHtml } from './public/owner-tree.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAVED = path.join(ROOT, 'bench', 'live-reads', '20260925T113130Z-0x20438cfd.json');

/** The saved read, replayed, then moved to 12:40 UTC with the figures the judge saw live. */
async function craftedLiveRead() {
  const replayed = await replayLiveRead(JSON.parse(fs.readFileSync(SAVED, 'utf8')));
  const read = JSON.parse(JSON.stringify(replayed).replaceAll('T11:31:30', 'T12:40:00'));
  read.summary7.realized_pnl_usd = 222264.31;
  read.summary30.realized_pnl_usd = 390477.24;
  // The leaderboard record is part of the same live read, so it moves with it.
  read.v4.record.realized_pnl_usd = 390477.24;
  const sibs = read.v5.operator.siblings;
  const sum = sibs.reduce((a, s) => a + s.realized_pnl_usd, 0);
  sibs[sibs.length - 1].realized_pnl_usd += -1_241_702 - sum;
  read.cached = false;
  read.raw = null;
  return read;
}

const answer = (committed, mood, line) => [
  { text: '{"valid":true,"reason":""}' },
  { text: `Reasoning.\n{"allocation": ${committed}, "mood": "${mood}", "line": "${line}"}\nALLOCATION: ${Math.round((committed / 25000) * 100)}` },
];

function room(script, liveEvidence = null, now = () => new Date('2026-09-25T12:45:00Z')) {
  const board = createLeaderboardStore(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bait-one-read-')), 'lb.json'));
  return createRoomService({ roster: loadRoster(), provider: stubProvider(script), leaderboard: board, liveEvidence, now });
}

const liveStub = read => ({ read: async () => read, available: () => true, policy: ROOM_LIVE_GUARD_POLICY, release() {} });

test('live read present: the fact cards, the BAIT check and the result screen all use it and say "read live 12:40 UTC"', async () => {
  const service = room([...answer(5000, 'intrigued', 'Opening small.')], liveStub(await craftedLiveRead()));
  const round = await service.start({ prospect: 'steadyhand' });
  assert.equal(round.evidence.live, true);
  // The fact cards: the live 7-day figure, labelled with the live read.
  const week = round.dossier.facts.find(f => f.id === 'week-pnl');
  assert.equal(week.value, '+$222,264');
  assert.deepEqual(round.dossier.read, { live: true, at: '2026-09-25T12:40:00Z', label: 'read live 12:40 UTC' });
  // The tile keeps its dated saved figure; the round says how far the live read moved it.
  const tile = (await service.config()).roster.find(t => t.id === 'steadyhand');
  assert.equal(tile.hype.value, '+$190,379');
  assert.equal(round.dossier.moved.tile, '+$190,379');
  assert.equal(round.dossier.moved.live, '+$222,264');
  assert.equal(round.dossier.moved.delta, Math.round(222264.31 - 190378.888508));
  assert.equal(round.dossier.moved.line, `7-day moved since the 25 Sep 11:31 read: +$${Math.round(222264.31 - 190378.888508).toLocaleString('en-US')}`);

  await service.pitch(round.id, { requestId: 'one-read-live-0', shot: 0, text: week.insert });
  const { final } = await service.finish(round.id, { wire: true });
  // The BAIT check: the live 30-day figure and the live siblings, the live read's label.
  assert.equal(final.gate.read.label, 'read live 12:40 UTC');
  assert.match(final.gate.checks.find(c => c.id === 'realised_pnl_30d').plain, /\+\$390,477/);
  assert.equal(final.gate.failed, 'operator_record');
  assert.equal(final.gate.operator.siblingsLabel, '-$1,241,702');
  assert.equal(final.gate.operator.readLabel, 'read live 12:40 UTC');
  assert.match(ownerTreeHtml(final.gate.operator, { compact: true }), /Owner, read live 12:40 UTC/);
  assert.equal(readingLine(final.gate, '0x2043...e79d'),
    'Reading Nansen perp-pnl-summary (30 and 7 days), perp-trades, perp-positions, perp-screener, perp-leaderboard, related-wallets, transactions and the siblings’ perp-pnl-summary for 0x2043...e79d: read live 12:40 UTC');
  // The result screen: what the player pitched, from the live read, not the tile's saved figure.
  assert.equal(final.read.label, 'read live 12:40 UTC');
  assert.deepEqual(final.pitched.facts, [{ id: 'week-pnl', value: '+$222,264', label: '7-day realised', source: 'Nansen, read live 12:40 UTC' }]);
  const view = pitchedView(final);
  assert.equal(view.value, '+$222,264');
  assert.match(view.source, /^Nansen, read live 12:40 UTC · 7-day moved since the 25 Sep 11:31 read: \+\$31,88\d$/);
  // No saved-read figure for a window the live read covers reaches the check or the result.
  const shown = JSON.stringify({ gate: final.gate, pitched: final.pitched, headline: final.headline, because: final.because });
  for (const saved of ['+$358,593', '-$1,228,400']) assert.doesNotMatch(shown, new RegExp(saved.replace(/[$+]/g, '\\$&')), saved);
  assert.ok(!JSON.stringify(final.pitched.facts).includes('+$190,379'), 'the tile figure is not what was pitched');
});

test('live read absent: the saved read everywhere, labelled "saved read 25 Sep 11:31 UTC"', async () => {
  const service = room([...answer(5000, 'intrigued', 'Opening small.')]);
  const round = await service.start({ prospect: 'steadyhand' });
  assert.equal(round.evidence.live, false);
  const week = round.dossier.facts.find(f => f.id === 'week-pnl');
  const tile = (await service.config()).roster.find(t => t.id === 'steadyhand');
  assert.equal(week.value, tile.hype.value, 'the card and the tile are the same saved read');
  assert.equal(round.dossier.read.label, 'saved read 25 Sep 11:31 UTC');
  assert.equal(round.dossier.moved, null);
  assert.equal(round.dossier.evidenceLabel, 'Nansen saved read 25 Sep 11:31 UTC');

  await service.pitch(round.id, { requestId: 'one-read-frozen-0', shot: 0, text: week.insert });
  const { final } = await service.finish(round.id, { wire: true });
  assert.equal(final.gate.read.label, 'saved read 25 Sep 11:31 UTC');
  assert.match(final.gate.checks.find(c => c.id === 'realised_pnl_30d').plain, /\+\$358,593/);
  assert.equal(final.gate.operator.siblingsLabel, '-$1,228,400');
  assert.equal(final.gate.operator.readLabel, 'saved read 25 Sep 11:31 UTC');
  assert.match(readingLine(final.gate, 'x'), /related-wallets, transactions and the siblings’ perp-pnl-summary for x: saved read 25 Sep 11:31 UTC, no call this round$/);
  assert.equal(final.read.label, 'saved read 25 Sep 11:31 UTC');
  assert.deepEqual(final.pitched.facts, [{ id: 'week-pnl', value: '+$190,379', label: '7-day realised', source: 'Nansen, saved read 25 Sep 11:31 UTC' }]);
  assert.equal(pitchedView(final).source, 'Nansen, saved read 25 Sep 11:31 UTC');
});

test('a live snapshot never carries the capture\'s saved owner read under live summaries', async () => {
  const read = await craftedLiveRead();
  delete read.v5;
  delete read.v4;
  const service = room([...answer(5000, 'intrigued', 'Opening small.')], liveStub(read));
  const round = await service.start({ prospect: 'steadyhand' });
  await service.pitch(round.id, { requestId: 'one-read-nov5-0', shot: 0, text: round.dossier.facts[0].insert });
  const { final } = await service.finish(round.id, { wire: true });
  const row = final.gate.checks.find(c => c.id === 'operator_record');
  assert.equal(row.result, 'not_assessed', 'no owner read this round, so no saved one stands in');
  assert.equal(final.gate.operator, null);
  assert.doesNotMatch(JSON.stringify(final.gate), /1,228,400/);
});

test('the "What you pitched" card follows the lines: typed figures count, a round that quoted none says so', () => {
  const dossier = {
    read: { live: false, label: 'saved read 25 Sep 11:31 UTC' }, moved: null,
    facts: [
      { id: 'week-pnl', value: '+$190,379', label: '7-day realised', insert: '+$190,379 realised over the last 7 days.', tone: 'positive' },
      { id: 'month-wins', value: '61.2%', label: '30-day win rate, 2,661 trades', insert: '61.2% win rate across 2,661 closed trades in 30 days.', tone: 'positive' },
    ],
  };
  const typed = pitchedFacts([{ text: 'Wins 61% of the time, and a caught one: +$190k', caught: false }], dossier);
  assert.equal(typed.used, true);
  assert.deepEqual(typed.facts.map(f => f.id), ['week-pnl', 'month-wins']);
  const caught = pitchedFacts([{ text: '+$190,379 realised over the last 7 days.', caught: true }, { text: 'Trust me.', caught: false }], dossier);
  assert.equal(caught.used, false, 'a caught line is not a pitch that landed');
  assert.deepEqual(caught.facts.map(f => f.id), ['week-pnl']);
  assert.match(pitchedView({ pitched: caught }).source, /^Your lines quoted no fact card; the round's lead fact · Nansen, saved read 25 Sep 11:31 UTC$/);
  assert.equal(pitchedView({}), null, 'no pitch: the tile hype stays');
});
