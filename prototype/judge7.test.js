/**
 * Judge 7 (26 Sep 2026), on the live build:
 *
 * 1. A pass row said more than its check tested: the leaderboard row read "in line with the
 *    summary" while the summary said +$30,022 and the leaderboard +$72,441. The check only tests
 *    that the summary claims no more than the leaderboard, so the row says that.
 * 2. The all-time card (+$428,058, a Hyperliquid leaderboard read of 21 Sep) sat under a
 *    "Nansen, read live" heading. Every card carries its own read.
 * 3. Rule ids reached the screen ('the "realised_pnl_30d" check already refused').
 * Nits: fill-row titles, the owner tree's "you pitched" tag, the checkpoint's owner sentence said
 * twice, the WATCH rows' policy line.
 *
 * Frozen captures only: no Nansen or model call.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { guardAllocation, BENCHMARK_GUARD_POLICY_V4, BENCHMARK_GUARD_POLICY_V5 } from '../validation/guard.js';
import { makeToolExecutor } from '../validation/tools.js';
import { withV4Reads } from '../validation/v4-evidence.js';
import { stubProvider } from '../validation/providers.js';
import { createRoomService, createLeaderboardStore, loadRoster, buildProspectDossier, publicDossier } from './room.js';
import { CHECK_NAME, checkName, factGroups, WATCH_NOTE } from './public/verdict-view.js';
import { ownerTreeHtml } from './public/owner-tree.js';

const snap = name => JSON.parse(fs.readFileSync(new URL(`../validation/snapshots/${name}`, import.meta.url), 'utf8'));
const CLEAN = 'control_0x9e2cbb5d800181c1ef21b25010dc4ea80eeb5508.json';
const row = (g, id) => g.checks.find(c => c.id === id);
const withRecord = (s, pnl) => withV4Reads(makeToolExecutor(s, { mode: 'armed' }), { record: { wallet: s.wallet, realized_pnl_usd: pnl } });
const gateOn = (s, executor, policy = BENCHMARK_GUARD_POLICY_V4) => guardAllocation({ executor, wallet: s.wallet, allocation: 8000, policy, now: () => new Date(s.retrieved_at) });
const usd = n => `${n < 0 ? '-' : '+'}$${Math.round(Math.abs(n)).toLocaleString('en-US')}`;
const room = () => createRoomService({ roster: loadRoster(), provider: stubProvider([]),
  leaderboard: createLeaderboardStore(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bait-j7-')), 'lb.json')), health: () => ({ ready: true }) });

// ---------------------------------------------------------------- 1. pass text

test('judge 7: a leaderboard pass says the summary claims no more than the record, never "in line"', async () => {
  const s = snap(CLEAN);
  const pnl = s.pnl_summary_30d.realized_pnl_usd;
  // The summary says less than the leaderboard (THE REAL DEAL's live shape: +$30,022 vs +$72,441).
  const under = row(await gateOn(s, withRecord(s, pnl * 2.4)), 'independent_record');
  assert.equal(under.result, 'pass');
  assert.equal(under.plain, `The 30-day summary's ${usd(pnl)} claims no more than Nansen's perp-leaderboard record of ${usd(pnl * 2.4)} for the same days. This check refuses only a summary that claims more.`);
  // A summary a little above the record passes on the tolerance, and says so with the figures.
  const over = row(await gateOn(s, withRecord(s, pnl / 1.2)), 'independent_record');
  assert.equal(over.result, 'pass');
  const record = pnl / 1.2;
  assert.equal(over.plain, `The 30-day summary's ${usd(pnl)} claims ${usd(pnl - record).slice(1)} more than Nansen's perp-leaderboard record of ${usd(record)} for the same days, within the ${usd(0.25 * record).slice(1)} allowed. This check refuses only a summary that claims more than that.`);
  for (const r of [under, over]) assert.doesNotMatch(r.plain, /in line|agrees|matches/);
});

test('judge 7: no pass row claims more than its check tested', async () => {
  const s = snap(CLEAN);
  const g = await gateOn(s, withRecord(s, s.pnl_summary_30d.realized_pnl_usd));
  const all = g.checks.map(c => c.plain).join('\n');
  // thin_sample tests a count against a minimum; it cannot say the record is "enough to judge".
  assert.match(row(g, 'thin_sample').plain, /closed trades in 30 days, at or above the 20 minimum\.$/);
  assert.doesNotMatch(all, /enough of a record to judge|in line with the summary|so the two agree|Most of the headline is money/);
  // A week that flips sign but is small passes on the 10% bar, and says it is the gate that counts it as agreeing.
  const flipped = { ...s, pnl_summary_7d: { ...s.pnl_summary_7d, realized_pnl_usd: -s.pnl_summary_30d.realized_pnl_usd * 0.05 } };
  const regime = row(await gateOn(flipped, withRecord(flipped, flipped.pnl_summary_30d.realized_pnl_usd)), 'regime_agreement');
  assert.equal(regime.result, 'pass');
  assert.match(regime.plain, /under 10%, so the gate counts the two as agreeing\.$/);
  // The owner row refuses on the owner's sum; it does not call the wallet a survivor.
  const guardSrc = fs.readFileSync(new URL('../validation/guard.js', import.meta.url), 'utf8');
  assert.doesNotMatch(guardSrc, /t\.(fail|pass)\([^;]*survivor/s);
});

// ---------------------------------------------------------------- 2. every card dated

test('judge 7: the all-time card carries its own leaderboard read, the Nansen cards the round read', () => {
  for (const id of ['realdeal', 'streak']) {
    const p = loadRoster().find(x => x.id === id);
    const d = publicDossier(buildProspectDossier(p));
    const allTime = d.facts.find(f => f.id === 'all-time');
    assert.ok(allTime, id);
    assert.equal(allTime.source, 'Hyperliquid leaderboard read 21 Sep 21:56 UTC', id);
    for (const f of d.facts.filter(x => x.id !== 'all-time')) assert.equal(f.source, `Nansen, ${d.read.label}`, `${id} ${f.id}`);
    // Grouped under their own read: the leaderboard card never sits under the Nansen heading.
    const groups = factGroups(d.facts);
    const lb = groups.find(g => g.facts.some(f => f.id === 'all-time'));
    assert.equal(lb.source, 'Hyperliquid leaderboard read 21 Sep 21:56 UTC');
    assert.deepEqual(lb.facts.map(f => f.id), ['all-time']);
    for (const g of groups) assert.ok(g.facts.every(f => f.source === g.source));
  }
  const client = fs.readFileSync(new URL('./public/room.js', import.meta.url), 'utf8');
  assert.match(client, /factGroups\(d\.facts\)/, 'the room renders the cards grouped by their read');
});

// ---------------------------------------------------------------- 3. no rule ids on screen

const SNAKE = /\b[a-z0-9]+_[a-z0-9_]+\b/;

test('judge 7: no rule id reaches a row, a heading or the result copy', async () => {
  const service = room();
  for (const p of loadRoster()) {
    const { gate } = await service.fixture(p.id);
    for (const c of gate.checks) {
      assert.doesNotMatch(c.plain, SNAKE, `${p.id} ${c.id}: ${c.plain}`);
      assert.ok(CHECK_NAME[c.id], `${c.id} has a human name`);
      assert.doesNotMatch(checkName(c.id), SNAKE);
    }
  }
  // STREAK: the owner row names the 30-day row by its human name.
  const { gate } = await service.fixture('streak');
  assert.equal(row(gate, 'operator_record').plain, 'Not read: the "30-day realised PnL" check already refused this request, so the owner\'s other wallets could not change it.');
  // Outside the room a refused request skips the week; the skip names the row the same way.
  const losing = snap('0xc26cbb6483229e0d0f9a1cab675271eda535b8f4.json');
  const g = await gateOn(losing, makeToolExecutor(losing, { mode: 'armed' }), BENCHMARK_GUARD_POLICY_V5);
  for (const c of g.checks) assert.doesNotMatch(c.plain ?? '', SNAKE, `${c.id}: ${c.plain}`);
  // The page never prints an id with its underscores swapped for spaces.
  const client = fs.readFileSync(new URL('./public/room.js', import.meta.url), 'utf8');
  assert.doesNotMatch(client, /\.id\.replace\(\/_\/g/);
});

// ---------------------------------------------------------------- nits

test('judge 7: fill rows are titled for what was read, and the text and coverage line agree', async () => {
  assert.equal(CHECK_NAME.fills_drawdown, 'Drawdown in the fills read');
  assert.equal(CHECK_NAME.fills_worst_trade, 'Worst trade in the fills read');
  const { gate } = await room().fixture('steadyhand');
  // A frozen tape: both rows name the same fills the same way.
  assert.match(row(gate, 'fills_drawdown').plain, /^Worst peak-to-trough over the 1,000 fills held: /);
  assert.match(row(gate, 'fills_worst_trade').plain, /^Worst single closed trade over the 1,000 fills held: /);
  const roster = fs.readFileSync(new URL('./roster.js', import.meta.url), 'utf8');
  assert.match(roster, /all \$\{count\(fillsHeld\)\} fills in the window read live/, 'a complete live tape is not called "newest"');
});

test('judge 7: the owner tree tags the pitched wallet "this wallet"; the checkpoint says the owner sentence once', async () => {
  const { gate } = await room().fixture('steadyhand');
  const full = ownerTreeHtml(gate.operator);
  assert.match(full, /<span class="ot-tag">this wallet<\/span>/);
  assert.doesNotMatch(full, /you pitched/);
  // Judge 10: the line says "other wallets"; the tree's tag already marks the pitched one.
  assert.ok(full.includes('other wallets, which lost'), 'the result screen keeps the line');
  const compact = ownerTreeHtml(gate.operator, { compact: true });
  assert.doesNotMatch(compact, /ot-line/, 'the checkpoint row above the tree already says it');
});

test('judge 7: WATCH rows say why they neither block nor cap, as the gate does', () => {
  assert.equal(WATCH_NOTE, 'WATCH rows are measured on the trade fills by BAIT’s copy-risk report. The gate does not read the fills, so a WATCH neither blocks nor caps the transfer.');
  const client = fs.readFileSync(new URL('./public/room.js', import.meta.url), 'utf8');
  assert.equal((client.match(/WATCH_NOTE/g) ?? []).length >= 3, true, 'imported and shown on the checkpoint and the result table');
  // The gate's own table: the fill checks are skipped there, so no fill figure can move a wire.
  const guardSrc = fs.readFileSync(new URL('../validation/guard.js', import.meta.url), 'utf8');
  assert.match(guardSrc, /for \(const \[id, plain\] of Object\.entries\(FILL_ONLY_CHECKS\)\) t\.skip\(id, plain\);/);
});

// ---------------------------------------------------------------- proof page

test('judge 7: the proof page strapline lists the gate\'s seven endpoints, from the code\'s list', async () => {
  const { GATE_V5_ENDPOINTS } = await import('./live-evidence.js');
  const short = GATE_V5_ENDPOINTS.map(e => e.split('/').at(-1));
  assert.equal(short.length, 7);
  const replay = fs.readFileSync(new URL('./public/replay.js', import.meta.url), 'utf8');
  const listed = JSON.parse(replay.match(/const GATE_ENDPOINTS = (\[[^\]]*\]);/)[1].replace(/'/g, '"'));
  assert.deepEqual(listed, short);
  assert.match(replay, /the gate reads \$\{GATE_ENDPOINTS\.length === 7 \? 'seven' : GATE_ENDPOINTS\.length\} Nansen endpoints/);
  // The replayed round's own reads are named as that round's, not as the gate's list.
  assert.match(replay, /the replayed attack in section 1 was recorded [^`]*its agent read/);
});

test('judge 7: the proof page says the owner catch is by construction', () => {
  const html = fs.readFileSync(new URL('./public/replay.html', import.meta.url), 'utf8');
  assert.match(html, /funded <strong>0 of 12 owner attacks<\/strong>, by construction: the attack is defined by the owner's loss, the quantity the rule reads/);
});

test('judge 7: the recorded demo says its rounds predate the owner check and links the live room for v5', async () => {
  const { demoFiles } = await import('./package-demo.js');
  const page = demoFiles().get('index.html');
  assert.match(page, /<p class="note gate-note" id="gate-note">Every round on this page was recorded before the owner check existed, between 18 and 23 Sep; the benchmark&rsquo;s BAIT row ran gate v4 and was re-gated under v5 on 25 Sep with the same decisions\. None of them shows the owner check\. <a href="https:\/\/bait-wyqr\.onrender\.com\/" data-host-link>Play a round under gate v5, with the owner check, in the live room<\/a>\.<\/p>/);
});
