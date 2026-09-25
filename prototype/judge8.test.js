/**
 * Judge 8 (26 Sep 2026), on the live build (public 1302f55), four live rounds:
 *
 * 1. The referee struck the game's own tile figure: THE STREAK's tile shows "+$594,869, week to
 *    21 Sep, Hyperliquid leaderboard read 21 Sep 21:56 UTC"; pitched with that window and source,
 *    the referee said "+$594,869 is not in the record". One rule now: a tile figure is a published
 *    fact. Quoted with its own window (and, for a leaderboard figure, its source) it stands; in the
 *    wrong window the referee says whose figure it is and which window it covers.
 * 2. THE GRINDER's capped result headlined "+$159,041 30-day realised PnL" under "Why BAIT capped
 *    it", a passing figure. The "why" card headlines the row that decided.
 * 3. The 7-day/30-day pass row said "Both windows point the same way" when the week was +$0.
 * Nits: owner copy, overreaching BLOCK/WATCH text, WATCH note on the result, a zero fact, the pulse
 * zero, owner-read credit range, the ticker, the report footer, the usage link, "apart", the quote.
 *
 * Frozen captures and saved live reads only: no Nansen call, no model call.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { guardAllocation, BENCHMARK_GUARD_POLICY_V4, assessCopyRisk } from '../validation/guard.js';
import { makeToolExecutor } from '../validation/tools.js';
import { withV4Reads } from '../validation/v4-evidence.js';
import { stubProvider } from '../validation/providers.js';
import {
  createRoomService, createLeaderboardStore, loadRoster, buildProspectDossier, publicDossier,
  offendingFigure, refereeVerdict,
} from './room.js';
import { refreshProspect, movedSince } from './roster.js';
import { frozenSnapshot } from './frozen-read.js';
import { pulseFigure } from './roster-pulse.js';
import { recordHeadline, WATCH_NOTE_SHORT, reportRows } from './public/verdict-view.js';
import { ownerTreeHtml } from './public/owner-tree.js';

const read = rel => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const snap = name => JSON.parse(read(`../validation/snapshots/${name}`));
const CLEAN = 'control_0x9e2cbb5d800181c1ef21b25010dc4ea80eeb5508.json';
const GRINDER_LIVE = new URL('../bench/live-reads/20260925T122635Z-0xc26cbb64.json', import.meta.url);
const board = () => createLeaderboardStore(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bait-j8-')), 'lb.json'));
const room = (script = [], roster = loadRoster()) => createRoomService({ roster, provider: stubProvider(script), leaderboard: board(), health: () => ({ ready: true }) });
const grinderLive = async () => {
  const s = await frozenSnapshot(fileURLToPath(GRINDER_LIVE));
  return loadRoster().map(p => (p.id === 'grinder' ? refreshProspect(p, s) : p));
};
const DESK = n => ({ text: `Fine.\n{"allocation": ${n}, "mood": "intrigued", "line": "Fine, a small probe."}\nALLOCATION: ${Math.round(n / 250)}` });

// ------------------------------------------------------ 1. the tile figure is a published fact

test('judge 8: every tile figure is a published fact in the round, never "not in the record"', async () => {
  const roster = [...loadRoster(), ...(await grinderLive()).filter(p => p.id === 'grinder').map(p => ({ ...p, id: 'grinder-live' }))];
  for (const p of roster) {
    const d = buildProspectDossier(p);
    const tile = d.published?.[0];
    assert.ok(tile, `${p.id} carries its tile figure`);
    assert.equal(tile.value, p.hype.value, p.id);
    assert.equal(tile.source, p.hype.readLabel, p.id);
    const window = p.tileFigure?.window === '30d' ? '30 days' : p.tileFigure?.window === '7d' ? 'the week' : 'all time';
    const line = `${tile.value} over ${window} to ${p.hype.caption.split(' to ').at(-1)} on the ${tile.source.startsWith('Hyperliquid') ? 'Hyperliquid leaderboard' : 'Nansen record'}.`;
    assert.equal(offendingFigure(line, d, p.checkerData), null, `${p.id}: ${line}`);
    assert.doesNotMatch(refereeVerdict(line, d, p.checkerData), /is not in the record/, p.id);
  }
});

test('judge 8: THE STREAK tile figure in its own window and source passes the referee; judge 11: a model rejection still strikes', async () => {
  const line = '+$594,869 in the week to 21 Sep on the Hyperliquid leaderboard. Shorts pay.';
  // The checker accepts: the referee passes the tile figure and PENNY hears the line.
  const ok = room([{ text: '{"valid":true,"reason":""}' }, DESK(2500)]);
  const round = await ok.start({ prospect: 'streak' });
  const heard = await ok.pitch(round.id, { requestId: 'judge8-streak-0', shot: 0, text: line });
  assert.equal(heard.shots.at(-1).caught, false, 'the tile figure is not a caught lie');
  assert.equal(heard.funded, 2500);
  assert.match(heard.shots.at(-1).full ?? '', /./);
  // Judge 11: code never overrules a model rejection. It strikes, and the sealed figure stays sealed.
  const service = room([
    { text: '{"valid":false,"reason":"+$594,869 is not in the known facts; the 7-day realised PnL is -$163,698."}' },
    DESK(2500),
  ]);
  const start = await service.start({ prospect: 'streak' });
  const after = await service.pitch(start.id, { requestId: 'judge8-streak-1', shot: 0, text: line });
  const shot = after.shots.at(-1);
  assert.equal(shot.caught, true);
  assert.equal(after.funded, 0);
  assert.doesNotMatch(shot.referee, /163,698/);
});

test('judge 8: the checker prompt lists the tile figure as published, with its window and read', async () => {
  const provider = stubProvider([{ text: '{"valid":true,"reason":""}' }, DESK(1000)]);
  const service = createRoomService({ roster: loadRoster(), provider, leaderboard: board(), health: () => ({ ready: true }) });
  const start = await service.start({ prospect: 'streak' });
  await service.pitch(start.id, { requestId: 'judge8-streak-2', shot: 0, text: 'Shorts pay. Trust the process.' });
  const system = provider.seen[0].system;
  assert.match(system, /"published":\[\{"value":"\+\$594,869","window":"week to 21 Sep","source":"Hyperliquid leaderboard read 21 Sep 21:56 UTC"/);
  assert.match(system, /published on the trader's tile/);
});

test('judge 8: the tile figure in the wrong window is named as the tile\'s figure, with its window', () => {
  const p = loadRoster().find(x => x.id === 'streak');
  const d = buildProspectDossier(p);
  assert.equal(refereeVerdict('+$594,869 over the last 30 days. Shorts pay.', d, p.checkerData),
    "Referee: +$594,869 is the tile's Hyperliquid leaderboard figure for the week to 21 Sep, not a 30-day figure. The line is spent.");
  // A rejection that names another figure still stands: a quoted tile figure does not launder the rest.
  assert.equal(refereeVerdict('+$594,869 in the week to 21 Sep on the Hyperliquid leaderboard, and +$9,999,999 this month.', d, p.checkerData),
    'Referee: +$9,999,999 is not in the record. The line is spent.');
});

test('judge 8: a rejection that is not about the tile figure still catches the line', async () => {
  const service = room([{ text: '{"valid":false,"reason":"The pitch invents a guaranteed return."}' }]);
  const start = await service.start({ prospect: 'streak' });
  const after = await service.pitch(start.id, { requestId: 'judge8-streak-3', shot: 0, text: '+$594,869 in the week to 21 Sep on the Hyperliquid leaderboard, guaranteed to repeat.' });
  assert.equal(after.shots.at(-1).caught, true);
});

// ------------------------------------------------ 2. the "why" card headlines the deciding row

test('judge 8: THE GRINDER capped on a live read headlines the open book, not the passing 30-day figure', async () => {
  const { gate } = await room([], await grinderLive()).fixture('grinder');
  assert.equal(gate.code, 'capped');
  const caps = gate.checks.filter(c => c.result === 'cap').map(c => c.id);
  assert.deepEqual(gate.decided.map(d => d.id), caps);
  const first = gate.decided[0];
  assert.equal(first.id, 'open_book');
  assert.match(first.value, /^-\$[\d,]+$/);
  assert.match(first.caption, /^open positions, \d+\.\d% of the \$[\d,]+ account \(limit 25%\)$/);
  const head = recordHeadline({ verdict: 'capped', gate }, { pnlLabel: '+$159,041', pnlCaption: '30-day realised PnL', pnl: 159041 });
  assert.equal(head.value, first.value);
  assert.notEqual(head.value, '+$159,041');
  assert.deepEqual(head.also.map(a => a.id), caps.slice(1));
  // The 30-day figure stays on the card as a row, labelled as the figure that passed.
  assert.deepEqual(head.rows[0], { label: '30-day realised (passed)', value: '+$159,041' });
});

test('judge 8: every verdict headlines its own deciding figure', async () => {
  const service = room();
  const streak = (await service.fixture('streak')).gate;
  assert.equal(streak.decided[0].id, 'realised_pnl_30d');
  assert.equal(streak.decided[0].value, '-$6,262,156');
  assert.equal(streak.decided[0].caption, '30-day realised PnL');
  const steady = (await service.fixture('steadyhand')).gate;
  assert.equal(steady.decided[0].id, 'operator_record');
  assert.equal(steady.decided[0].value, steady.operator.combinedLabel);
  const real = (await service.fixture('realdeal')).gate;
  assert.equal(real.decided[0].id, 'concentration');
  assert.equal(real.decided[0].value, '+$52,030');
  assert.equal(real.decided[0].caption, 'HYPE alone, 148.3% of the 30-day +$35,083; the rest of the book -$16,946');
  const h = recordHeadline({ verdict: 'capped', gate: real }, { pnlLabel: '+$35,083', pnlCaption: '30-day realised PnL', pnl: 35083 });
  assert.equal(h.value, '+$52,030');
  // A clear has no deciding row: the record's own figure.
  const clear = recordHeadline({ verdict: 'allow', gate: real }, { pnlLabel: '+$35,083', pnlCaption: '30-day realised PnL', pnl: 35083 });
  assert.deepEqual([clear.value, clear.caption, clear.rows.length], ['+$35,083', '30-day realised PnL', 0]);
});

test('judge 8: the capped agent line names the rule that capped, not always "one market"', async () => {
  const src = read('./room.js');
  assert.doesNotMatch(src, /\? 'One market carried the whole month, so the guard sent a quarter of the request and held the rest\.'/);
  assert.match(src, /CAP_AGENT_LINE/);
});

// ------------------------------------------------------------- 3. the agree row says what it tested

test('judge 8: the 7-day/30-day pass row states the 7-day figure and the 10% test, never "same way"', async () => {
  const s = snap(CLEAN);
  const week = (pnl7, pnl30) => ({ ...s, pnl_summary_7d: { ...s.pnl_summary_7d, realized_pnl_usd: pnl7 }, pnl_summary_30d: { ...s.pnl_summary_30d, realized_pnl_usd: pnl30 } });
  const gate = x => guardAllocation({ executor: withV4Reads(makeToolExecutor(x, { mode: 'armed' }), { record: { wallet: x.wallet, realized_pnl_usd: x.pnl_summary_30d.realized_pnl_usd } }),
    wallet: x.wallet, allocation: 8000, policy: BENCHMARK_GUARD_POLICY_V4, now: () => new Date(x.retrieved_at) });
  const zero = (await gate(week(0, 159040.85))).checks.find(c => c.id === 'regime_agreement');
  assert.equal(zero.result, 'pass');
  assert.equal(zero.plain, 'The 7-day +$0 does not reverse the 30-day +$159,041 by 10% or more.');
  const same = (await gate(week(20000, 159040.85))).checks.find(c => c.id === 'regime_agreement');
  assert.equal(same.plain, 'The 7-day +$20,000 does not reverse the 30-day +$159,041 by 10% or more.');
  assert.doesNotMatch(read('../validation/guard.js'), /point the same way|points the other way/);
});

// ------------------------------------------------------------------------------------ nits

test('judge 8: owner copy: the subhead names the first funder, the result hedges once, the row names BAIT\'s own index', async () => {
  const js = read('./public/room.js');
  assert.match(js, /this wallet plus \$\{owner\.siblings\.length\} others its first funder also funds/);
  assert.doesNotMatch(js, /siblings\.length\} it funds/);
  const { gate } = await room().fixture('steadyhand');
  const tree = ownerTreeHtml(gate.operator);
  assert.equal((tree.match(/Shared funding is not proof of one owner\./g) ?? []).length, 1);
  assert.doesNotMatch(ownerTreeHtml(gate.operator, { compact: true }), /Shared funding/);
  const index = JSON.parse(read('../bench/v5/operator-index.json'));
  const row = gate.checks.find(c => c.id === 'operator_record');
  assert.match(row.plain, new RegExp(`^First funder 0x[0-9a-f]{4}\\.\\.\\.[0-9a-f]{4} also funds 4 other wallets in BAIT's own index of ${index.universe.toLocaleString('en-US')} Hyperliquid wallets; they lost \\$[\\d,]+ over 30 days; the wallet you pitched has the same first funder\\.$`));
});

test('judge 8: BLOCK and WATCH rows say what was measured, not what copying "would" do', async () => {
  const guard = read('../validation/guard.js');
  assert.doesNotMatch(guard, /would have lost money|long losing runs|One trade can take a quarter of the book/);
  const { gate } = await room().fixture('streak');
  assert.equal(gate.checks.find(c => c.id === 'realised_pnl_30d').plain, 'Closed trades over 30 days came to -$6,262,156, under the policy minimum of $0.');
  assert.equal(gate.checks.find(c => c.id === 'low_win_rate').plain, '18.2% of closed trades were profitable, under the 40.0% minimum.');
  const tail = assessCopyRisk({ address: '0x' + '1'.repeat(40), realized_pnl_usd: 1, window_days: 30, source: 's', retrieved_at: '2026-09-20T00:00:00Z', worst_trade_usd: -600_000, account_value_usd: 1_000_000 })
    .flags.find(f => f.id === 'tail_loss');
  assert.equal(tail.plain, 'The worst single closed trade here was -$600,000, 60.0% of the $1,000,000 account value, over the 25.0% limit.');
});

test('judge 8: a result with WATCH rows says once that a WATCH neither blocks nor caps', () => {
  const js = read('./public/room.js');
  assert.match(js, /WATCH_NOTE_SHORT/);
  assert.match(WATCH_NOTE_SHORT, /neither blocks nor caps/);
  assert.ok(WATCH_NOTE_SHORT.length < 120);
  const rows = reportRows({ flags: [{ id: 'max_drawdown', plain: 'x' }] }, [{ id: 'fills_drawdown', result: 'caution', plain: 'y' }], 'allow');
  assert.equal(rows[0].label, 'WATCH');
});

test('judge 8: a zero 7-day figure is not offered as a flattering card; the live pulse zero says what it counts', async () => {
  const p = (await grinderLive()).find(x => x.id === 'grinder');
  assert.equal(p.snapshot.pnl_summary_7d.realized_pnl_usd, 0);
  const d = publicDossier(buildProspectDossier(p));
  assert.ok(!d.facts.some(f => /^\+?\$0$/.test(f.value)), d.facts.map(f => f.value).join(' '));
  assert.equal(pulseFigure(0, { live: true }), 'No trades closed in the last 7 days');
});

test('judge 8: the owner read costs 1 to 12 credits, as the code bounds it', async () => {
  const { V5_MAX_CREDITS } = await import('./live-evidence.js');
  assert.equal(V5_MAX_CREDITS, 12);
  const page = read('./public/replay.html');
  assert.match(page, /plus 1 to 12 for the owner read/);
  assert.doesNotMatch(page, /2 to 12/);
});

test('judge 8: the ticker names the round\'s reads; the report footer names endpoints, not a raw path, and says "not assessed" once', async () => {
  const js = read('./public/room.js');
  assert.match(js, /d\.reads \?\? d\.endpoints/);
  const service = room();
  for (const id of ['streak', 'grinder', 'realdeal']) {
    const start = await service.start({ prospect: id });
    const { gate } = await service.fixture(id);
    assert.deepEqual(start.dossier.reads, gate.reads, id);
  }
  assert.doesNotMatch(js, /\$\{risk\.source\}, captured/);
  assert.match(js, /reportSource\(/);
  assert.match(js, /raw usage JSON/);
  assert.doesNotMatch(js, /'all Nansen usage'/);
});

test('judge 8: a tile and a read that differ say "lower" or "higher", not a signed "apart"', () => {
  const p = loadRoster().find(x => x.id === 'realdeal');
  const m = movedSince(p);
  assert.equal(m.line, "30-day: the tile's +$116,554 is the 21 Sep 21:56 leaderboard read; this read's realised is +$35,083, $81,471 lower");
  assert.doesNotMatch(m.line, /apart/);
});

test('judge 8: PENNY\'s line under the result headline shows on a phone too, clamped', () => {
  const css = read('./public/room.css');
  const phone = css.slice(css.indexOf('@media (max-width: 900px)'));
  assert.doesNotMatch(phone.slice(0, phone.indexOf('\n}')), /\.reveal-quote \{ display: none; \}/);
  assert.match(css, /\.reveal-quote:not\(\[hidden\]\) \{[^}]*-webkit-line-clamp: 3/);
});

test('judge 8: a capture fixture can replay a saved live read of the same wallet, and nothing else', async () => {
  const service = room();
  const { gate } = await service.fixture('grinder', { read: '20260925T122635Z-0xc26cbb64.json' });
  assert.equal(gate.code, 'capped');
  await assert.rejects(service.fixture('grinder', { read: '../../.env' }), /Unknown saved read/);
  await assert.rejects(service.fixture('streak', { read: '20260925T122635Z-0xc26cbb64.json' }), /another wallet/);
});
