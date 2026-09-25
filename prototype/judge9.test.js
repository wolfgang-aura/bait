/**
 * Judge 9 (26 Sep 2026), on the live build 389ca34, six live rounds:
 *
 * 1. The referee struck the tile's own win rate: THE GRINDER's tile prints "+$35,723 week to 15 Sep
 *    · 100% win rate · Nansen saved read 15 Sep 10:40"; quoted with its window and source, the line
 *    got "Referee: 100% is not in the record." THE STEADY HAND's "42.1% win rate" the same. The
 *    tile's published facts are now read off exactly what the tile prints (headline and sub-line).
 * 2. "See every check BAIT ran" ran past the right edge at 375 (scrollWidth 586): a grid track's
 *    minimum was its widest unbreakable word (the raw read's sha256). Every track may shrink now.
 * 3. "PENNY agreed to send $X without checking who funds the wallet" headlined rounds the owner did
 *    not decide (STREAK blocked on its month, THE GRINDER capped on its open positions).
 * 4. REAL DEAL: a line of true figures got "Referee: the line does not match the record as stated".
 *    A strike always names what is wrong; with nothing to name, true figures stand.
 * Nits: code ids and lowercase chains on the every-check page, "xyz:SKHY", "the guard", "caught lie",
 * footers from the round's own reads, the usage link, the drawdown row, the proof page's
 * concentration rule, the cleared amount, a stray comma, the 30-day pass row's minimum.
 *
 * Frozen captures and saved live reads only: no Nansen call, no model call.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stubProvider } from '../validation/providers.js';
import {
  createRoomService, createLeaderboardStore, loadRoster, buildProspectDossier, offendingFigure, refereeVerdict,
  rejectionRuling, silentHeadline, endingCopy, roomAgentLine, CLEARED_LINE, CAP_AGENT_LINE, REFEREE_GENERAL, withTileExtras, attributionStrike,
} from './room.js';
import { refreshProspect, TILE_FIGURE } from './roster.js';
import { frozenSnapshot } from './frozen-read.js';
import { humanText, checkRowView, reportRows } from './public/verdict-view.js';

const read = rel => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const saved = name => fileURLToPath(new URL(`../bench/live-reads/${name}`, import.meta.url));
const GRINDER_LIVE = '20260925T122635Z-0xc26cbb64.json';
const REALDEAL_LIVE = '20260923T155252Z-0xfe47c8f2.json';
const board = () => createLeaderboardStore(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bait-j9-')), 'lb.json'));
const room = (script = [], roster = loadRoster()) => createRoomService({ roster, provider: stubProvider(script), leaderboard: board(), health: () => ({ ready: true }) });
const DESK = n => ({ text: `Fine.\n{"allocation": ${n}, "mood": "intrigued", "line": "Fine, a small probe."}\nALLOCATION: ${Math.round(n / 250)}` });
const withRead = async (id, file) => refreshProspect(loadRoster().find(p => p.id === id), await frozenSnapshot(saved(file)));
/** Every prospect, plus THE GRINDER and REAL DEAL on a saved live read (the tile stays the same). */
const everyWallet = async () => [...loadRoster(), await withRead('grinder', GRINDER_LIVE), await withRead('realdeal', REALDEAL_LIVE)];
/** The tile's text exactly as the lobby renders it (public/room.js renderRoster). */
const tileText = p => [p.hype.value, [p.hype.caption, p.hype.sub].filter(Boolean).join(' · '), p.hype.readLabel].join(' ');

// ------------------------------------------------ 1. every figure on a tile is a published fact

test('judge 9: every figure a tile prints is a published fact, with its window and source, for every wallet', async () => {
  for (const p of await everyWallet()) {
    const d = buildProspectDossier(p);
    const printed = [p.hype.value, p.hype.sub].flatMap(t => String(t ?? '').match(TILE_FIGURE) ?? []);
    assert.ok(printed.length >= 2, `${p.id} prints a headline and a sub-line figure`);
    assert.deepEqual(d.published.map(e => e.value), printed, p.id);
    for (const e of d.published) {
      assert.ok(e.window && e.source && e.span && e.from && e.claim, `${p.id} ${e.value} carries window, source and claim`);
      assert.equal(e.source, p.hype.readLabel, p.id);
    }
    // The tile's whole text, pitched as it reads, is never "not in the record" by the referee.
    // Judge 11: a model rejection is no longer overruled; it strikes (see referee-corpus.test.js).
    const line = tileText(p);
    assert.equal(offendingFigure(line, d, p.checkerData), null, `${p.id}: ${line}`);
    assert.doesNotMatch(refereeVerdict(line, d, p.checkerData), /is not in the record/, p.id);
    assert.equal(attributionStrike(line, d, p.checkerData), null, `${p.id}: ${line}`);
  }
});

test('judge 9: THE GRINDER\'s "100% win rate" and THE STEADY HAND\'s "42.1% win rate" pass the referee', async () => {
  const cases = [
    ['grinder', '+$35,723 week to 15 Sep · 100% win rate · Nansen saved read 15 Sep 10:40', '100%'],
    ['steadyhand', '+$190,379 week to 25 Sep · 42.1% win rate · Nansen saved read 25 Sep 11:31 UTC', '42.1%'],
  ];
  for (const [id, line, pct] of cases) {
    for (const roster of [loadRoster(), [await withRead('grinder', GRINDER_LIVE)]]) {
      if (!roster.some(p => p.id === id)) continue;
      // Judge 11: the referee passes the line; only a checker acceptance lets PENNY hear it.
      const service = room([{ text: '{"valid":true,"reason":""}' }, DESK(2500)], roster);
      const start = await service.start({ prospect: id });
      const after = await service.pitch(start.id, { requestId: `judge9-${id}-${roster.length}`, shot: 0, text: line });
      const shot = after.shots.at(-1);
      assert.equal(shot.caught, false, `${id} ${pct}: ${shot.referee ?? ''}`);
      assert.equal(after.funded, 2500);
    }
  }
});

test('judge 9: the checker is told every tile figure; the pulse count joins them when the server has one', async () => {
  const provider = stubProvider([{ text: '{"valid":true,"reason":""}' }, DESK(1000)]);
  const pulse = id => (id === 'grinder' ? [{ value: '12 trades', window: 'last 7 days to 09:00 UTC', source: 'Nansen, read live 09:00 UTC', span: '7d', from: 'Nansen', what: 'trade count', claim: 'x' }] : []);
  const service = createRoomService({ roster: loadRoster(), provider, leaderboard: board(), health: () => ({}), tileExtras: pulse });
  const start = await service.start({ prospect: 'grinder' });
  await service.pitch(start.id, { requestId: 'judge9-prompt-1', shot: 0, text: 'Trust the process.' });
  const system = provider.seen[0].system;
  assert.match(system, /"value":"\+\$35,723"/);
  assert.match(system, /"value":"100%","window":"week to 15 Sep","source":"Nansen saved read 15 Sep 10:40 UTC"/);
  assert.match(system, /"value":"12 trades"/);
  assert.deepEqual(withTileExtras({ published: [1] }, []), { published: [1] });
});

// --------------------------------------------------- 4. a strike always names what is wrong

test('judge 9: REAL DEAL\'s exact line: the win rate and count are named as Nansen\'s, never a no-reason strike', async () => {
  // The judge's live round read a 76.4% win rate over 3,373 trades for the 30 days; the saved live
  // read of 23 Sep is used with those two figures, the ones on the judge's offered card.
  const s = await frozenSnapshot(saved(REALDEAL_LIVE));
  s.pnl_summary_30d = { ...s.pnl_summary_30d, win_rate: 0.764, closed_trade_count: 3373 };
  const p = refreshProspect(loadRoster().find(x => x.id === 'realdeal'), s);
  const d = buildProspectDossier(p);
  const line = "Hyperliquid's leaderboard shows +$116,554 for the 30 days to 21 Sep, +$428,058 all time, and a 76.4% win rate over 3,373 trades this month.";
  const expected = "Referee: 76.4% is Nansen's 30-day win rate and 3,373 trades is Nansen's 30-day trade count; the leaderboard publishes neither. The line is spent.";
  assert.equal(refereeVerdict(line, d, p.checkerData), expected);
  for (const reason of ['', 'The claim does not match the record as stated.', 'The win rate is not a leaderboard figure.']) {
    assert.deepEqual(rejectionRuling(line, d, p.checkerData, reason), { stands: false, referee: expected });
  }
  // Named with its own source, the same figures pass the referee. Judge 11: a checker rejection
  // with no nameable reason still strikes, with the plain general line.
  const fixed = "Hyperliquid's leaderboard shows +$116,554 for the 30 days to 21 Sep and +$428,058 all time; Nansen shows a 76.4% win rate over 3,373 trades this month.";
  assert.equal(attributionStrike(fixed, d, p.checkerData), null);
  assert.deepEqual(rejectionRuling(fixed, d, p.checkerData, 'The line does not match the record.'), { stands: false, referee: REFEREE_GENERAL });
  // The all-time sub-line figure in the same line is its own window, never "not a 30-day figure".
  assert.doesNotMatch(refereeVerdict(fixed, d, p.checkerData), /428,058/);
});

test('judge 9: a claim-level reason is said with sealed figures sealed; judge 11: a rejection with no reason strikes with the general line', async () => {
  const p = loadRoster().find(x => x.id === 'streak');
  const d = buildProspectDossier(p);
  const sealed = Math.round(Math.abs(p.checkerData.pnl_summary_30d.realized_pnl_usd)).toLocaleString('en-US');
  // Final judge: default-deny. The rank is the referee's own strike, in the player's words; a line the
  // referee passes still carries the checker's reason, with sealed figures sealed.
  assert.equal(rejectionRuling('He is the best trader on the board.', d, p.checkerData, 'Not true.').referee, 'Referee: Not in the record: “best trader”. The line is spent.');
  const r = rejectionRuling('Shorts pay. Back him.', d, p.checkerData,`The wallet lost -$${sealed} over 30 days (realized_pnl_usd), so "best on the board" is false.`);
  assert.equal(r.stands, false);
  assert.notEqual(r.referee, REFEREE_GENERAL);
  assert.doesNotMatch(r.referee, new RegExp(sealed.replace(/,/g, ',')));
  assert.doesNotMatch(r.referee, /realized_pnl_usd|_/);
  assert.match(r.referee, /^Referee: The wallet lost a sealed figure over 30 days \(realised PnL\), so "best on the board" is false\. The line is spent\.$/);
  // Judge 11: "never loses" is the referee's own strike, whatever the checker said.
  assert.equal(rejectionRuling('He never loses.', d, p.checkerData, 'The line does not match the record as stated.').referee,
    "Referee: the line claims no losses, but Nansen's 30-day win rate is below 100%: trades were lost. The line is spent.");
  // Judge 11: no reason at all, or one that names nothing, still strikes, with the plain general line.
  assert.deepEqual(rejectionRuling('Trust the process.', d, p.checkerData, ''), { stands: false, referee: REFEREE_GENERAL });
  // A claim-level reason on a line of true figures is still said: a guarantee is not a figure.
  assert.match(rejectionRuling('+$594,869 in the week to 21 Sep, guaranteed to repeat.', d, p.checkerData, 'The pitch invents a guaranteed return.').referee, /^Referee: The pitch invents a guaranteed return\. The line is spent\.$/);
  // Judge 11: in a round, a rejection with no nameable reason strikes with the general line, never a blank one.
  const service = room([{ text: '{"valid":false,"reason":""}' }, DESK(1000)]);
  const start = await service.start({ prospect: 'streak' });
  const after = await service.pitch(start.id, { requestId: 'judge9-general-1', shot: 0, text: '+$594,869 in the week to 21 Sep. Shorts pay.' });
  assert.equal(after.shots.at(-1).caught, true);
  assert.equal(after.shots.at(-1).referee, REFEREE_GENERAL);
  assert.equal(after.funded, 0);
  assert.doesNotMatch(read('./public/room.js'), /the line does not match the record as stated/);
});

test('judge 9: a typed figure never ends on a comma in the referee\'s line', () => {
  const p = loadRoster().find(x => x.id === 'steadyhand');
  const d = buildProspectDossier(p);
  const v = refereeVerdict('+$190,379, over the last 30 days, easy.', d, p.checkerData);
  assert.match(v, /^Referee: \+\$190,379 is/);
  assert.doesNotMatch(v, /,\s*is/);
});

// ------------------------------------------------------ 3. the headline names what decided

test('judge 9: the silent headline names the deciding row on every verdict path; funding only for the owner', async () => {
  const service = room();
  const x = '$2,500';
  const cases = [
    [(await service.fixture('streak')).gate, 'block', 'PENNY agreed to send $2,500 without asking for the 30-day record.'],
    [(await service.fixture('grinder', { read: GRINDER_LIVE })).gate, 'capped', 'PENNY agreed to send $2,500 without asking about its open positions.'],
    [(await service.fixture('steadyhand')).gate, 'block', 'PENNY agreed to send $2,500 without checking who funds the wallet.'],
    [(await service.fixture('realdeal')).gate, 'capped', 'PENNY agreed to send $2,500 without asking how much of the month came from one market.'],
    [(await service.fixture('realdeal')).gate, 'allow', 'PENNY agreed to send $2,500 without asking for the record.'],
  ];
  for (const [gate, verdict, expected] of cases) {
    const got = silentHeadline({ x, anyway: verdict === 'allow' ? '' : ' anyway', verdict, gate });
    assert.equal(got, expected);
    if (gate.decided[0]?.id !== 'operator_record' || verdict === 'allow') assert.doesNotMatch(got, /funds/);
  }
  // PENNY's own words about the deciding topic are said as such.
  const grinder = (await service.fixture('grinder', { read: GRINDER_LIVE })).gate;
  assert.equal(silentHeadline({ x, anyway: ' anyway', verdict: 'capped', gate: grinder, said: ['Those open positions worry me.'] }),
    'PENNY raised its open positions, then agreed to send $2,500 anyway.');
  // Through endingCopy, the round's own path.
  const s = { prospect: { name: 'THE STREAK' }, shots: [{ n: 1, text: 'x', line: 'Deal.', caught: false, allocation: 2500, wire: { attempted: 2500 } }] };
  assert.equal(endingCopy({ s, peak: 2500, executed: 0, verdict: 'block', gate: cases[0][0] }).headline, cases[0][2]);
});

// ------------------------------------------------------------ 2. the every-check page fits

test('judge 9: the every-check page lets every grid track shrink and wraps long tokens', () => {
  const css = read('./public/room.css');
  assert.match(css, /\.final-grid \{ grid-template-columns: minmax\(0, 1\.15fr\) minmax\(0, \.85fr\); \}/);
  assert.match(css, /\.final-grid \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  assert.match(css, /\.final-col, \.final-col > \*, \.report, \.report > \*, \.flagline > \*[^{]*\{ min-width: 0; \}/);
  assert.match(css, /\.flagline span[^{]*\.report-foot[^{]*\{ overflow-wrap: anywhere; \}/);
  assert.match(css, /@media \(max-width: 560px\) \{\n  \.flagline\.check \{ grid-template-columns: minmax\(0, 1fr\)/);
});

// ------------------------------------------------------------------------------------ nits

test('judge 9: the every-check page shows no code ids, capitalised chains and human market names', async () => {
  const service = room();
  const gates = [
    ...await Promise.all(['steadyhand', 'legend', 'streak', 'realdeal', 'grinder'].map(async id => (await service.fixture(id)).gate)),
    (await service.fixture('grinder', { read: GRINDER_LIVE })).gate,
    (await service.fixture('realdeal', { read: REALDEAL_LIVE })).gate,
  ];
  for (const gate of gates) {
    for (const c of gate.checks) {
      const shown = `${checkRowView(c, gate.decision === 'block' ? 'block' : null).plain} ${c.source ?? ''}`;
      assert.doesNotMatch(shown, /\b[a-z]+_[a-z0-9_]+\b/, shown);
      assert.doesNotMatch(shown, /\b(ethereum|arbitrum) 0x/, shown);
      assert.doesNotMatch(shown, /\b[a-z]+:[A-Z0-9]{2,}\b/, shown);
    }
  }
  assert.equal(humanText('smart money against its xyz:SKHY short; arbitrum 0xe35e...5f2a'), 'smart money against its SKHY (xyz market) short; Arbitrum 0xe35e...5f2a');
  const js = read('./public/room.js');
  // A row the gate assessed and could not judge ("Headline is realised", an owner with no counting
  // funder) is a row with its own reason; only rows not read this round are named in the footer.
  assert.match(js, /!\/\^Not read\\b\/\.test\(String\(c\.plain \?\? ''\)\)/);
  assert.match(js, /Not read this round \(an earlier row already refused, or a saved capture holds no live read of it\)/);
  assert.doesNotMatch(js, /Not decided by the gate/);
});

test('judge 9: BAIT is one name in the verdict lines; a struck line is labelled as struck', () => {
  for (const line of [...Object.values(CAP_AGENT_LINE), roomAgentLine('block', { failed: 'realised_pnl_30d' }, true), roomAgentLine('block', { failed: 'operator_record' }),
    roomAgentLine('block', { failed: 'low_win_rate' }), roomAgentLine('allow', {})]) {
    assert.doesNotMatch(line, /\bguard\b/i, line);
    assert.match(line, /BAIT/, line);
  }
  const js = read('./public/room.js');
  assert.doesNotMatch(js, /caught lie, no wire/);
  // Judge 10: the wire log's labels moved to verdict-view.js (wireLogRows), where they are tested.
  assert.match(read('./public/verdict-view.js'), /struck by the referee, no wire/);
});

test('judge 9: footers come from the round\'s own reads; the usage link opens the usage ledger', () => {
  const js = read('./public/room.js');
  assert.match(js, /link\.href = '\/api\/usage';/);
  assert.doesNotMatch(js, /Live: both perp-pnl-summary windows and/);
  assert.match(js, /gate\.reads\?\.length \? gate\.reads/);
  assert.match(js, /this report's share of the round's \$\{reads\.length\} reads/);
  assert.match(read('./server.js'), /url\.pathname === '\/api\/usage'/);
});

test('judge 9: a drawdown row states the limit it broke, the same sentence in the report, and an early small peak says where the fills ended', async () => {
  const { gate } = await room().fixture('steadyhand');
  const dd = gate.checks.find(c => c.id === 'fills_drawdown');
  assert.equal(dd.plain, 'Worst peak-to-trough over the 1,000 fills held: $19,779, 16.0% of the $123,268 peak it fell from, under the 30% limit. That peak came early: realised PnL over those fills ended at +$333,536.');
  // Judge 10: the fills named once, and the row's name says its base and limit.
  assert.equal(dd.name, 'Drawdown from peak (limit 30%)');
  const caution = { id: 'fills_drawdown', result: 'caution', plain: 'Worst peak-to-trough over the 650 fills held: $23,554, 119.7% of the $19,685 account value (Nansen positions), over the 15% limit.' };
  const rows = reportRows({ flags: [{ id: 'max_drawdown', plain: 'At its worst, realised PnL fell $23,554 from the top of this window.' }] }, [caution], 'allow');
  assert.equal(rows[0].label, 'WATCH');
  assert.equal(rows[0].line, caution.plain);
  assert.match(rows[0].line, /over the 15% limit/);
});

test('judge 9: the proof page states the one-market cap as the code applies it', () => {
  const page = read('./public/replay.html');
  assert.doesNotMatch(page, /One market carried the month,/);
  assert.match(page, /One market made more than the whole month \(so the rest of the book lost money/);
  assert.doesNotMatch(read('./public/replay.js'), /\(a month one market carried\)/);
});

test('judge 9: a clear says why the whole amount went, where the amount is shown; the 30-day pass row names its minimum', async () => {
  assert.match(CLEARED_LINE, /^BAIT does not size a transfer: no rule blocked or capped this one, so the amount PENNY agreed went through\. WATCH rows do not decide\.$/);
  assert.match(read('./public/room.js'), /final\.verdict === 'allow' \? final\.agentLine/);
  const { gate } = await room().fixture('realdeal');
  assert.equal(gate.checks.find(c => c.id === 'realised_pnl_30d').plain, 'Closed trades over 30 days came to +$35,083, at or above the $0 minimum.');
});

test('judge 9: a line that says a losing window made money is struck with the claim named, the figure sealed', () => {
  const p = loadRoster().find(x => x.id === 'streak');
  const d = buildProspectDossier(p);
  const r = rejectionRuling('THE STREAK is up over the full 30 days.', d, p.checkerData, 'Not in the record.');
  assert.equal(r.referee, 'Referee: the line says the 30-day result made money; the 30-day realised PnL in the record did not. The line is spent.');
  const sealed = Math.round(Math.abs(p.checkerData.pnl_summary_30d.realized_pnl_usd)).toLocaleString('en-US');
  assert.ok(!r.referee.includes(sealed));
});
