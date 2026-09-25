/**
 * Judge 10 (26 Sep 2026), live build 686f4ff: the referee let false lines stand and PENNY paid on
 * them. Source and window rules ran only after the model checker rejected, and only one way round.
 * The referee is now deterministic: every figure a line types is checked against the round's
 * published facts (value, measure, window, source, wallet) on every line, before the model is asked.
 *
 * This is the table-driven corpus: every judge 10 line, the judge 9 lines, cross-wallet figures,
 * one or more true lines per wallet, and the number, window and source formats a player types.
 * Frozen captures and saved live reads only (the roster's own data): no Nansen call, no model call.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stubProvider } from '../validation/providers.js';
import {
  createRoomService, createLeaderboardStore, loadRoster, buildProspectDossier, refereeVerdict, attributionStrike,
  rejectionRuling, withTileExtras, rosterFacts,
} from './room.js';
import { refreshProspect } from './roster.js';
import { frozenSnapshot } from './frozen-read.js';

const saved = name => fileURLToPath(new URL(`../bench/live-reads/${name}`, import.meta.url));
const GRINDER_LIVE = '20260925T122635Z-0xc26cbb64.json';
const REALDEAL_LIVE = '20260923T155252Z-0xfe47c8f2.json';
const LEGEND_LIVE = '20260923T173218Z-0x7fdafde5.json';
const board = () => createLeaderboardStore(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bait-j10-')), 'lb.json'));

const roster = loadRoster();
const withRead = async (id, file) => refreshProspect(roster.find(p => p.id === id), await frozenSnapshot(saved(file)));
// The tile pulse's published trade count, in the shape prototype/roster-pulse.js publishes it, from
// the saved LEGEND read of 23 Sep 17:32 UTC (its 7-day closed trade count).
const legendPulse = async () => {
  const s = await frozenSnapshot(saved(LEGEND_LIVE));
  const n = s.pnl_summary_7d.closed_trade_count;
  const value = `${n.toLocaleString('en-US')} trades`;
  return [{ value, window: '7 days to the saved read 23 Sep 17:32 UTC', source: 'Nansen saved read 23 Sep 17:32 UTC', span: '7d', from: 'Nansen', what: 'trade count', claim: `counts ${value} closed.` }];
};

/** A round's referee inputs: the dossier (with tile extras), its record, and the other wallets. */
async function setup(key) {
  const [id, mode] = key.split(':');
  const p = mode === 'live'
    ? await withRead(id, { grinder: GRINDER_LIVE, realdeal: REALDEAL_LIVE, legend: LEGEND_LIVE }[id])
    : roster.find(x => x.id === id);
  const extras = mode === 'pulse' ? await legendPulse() : [];
  const dossier = withTileExtras(buildProspectDossier(p), extras);
  return { p, dossier, data: p.checkerData, others: rosterFacts(roster.filter(x => x.id !== id)) };
}

const PASS = null;
const spent = s => `Referee: ${s} The line is spent.`;

// [round, line, expected]: expected is null (the line stands) or the referee's exact words / a pattern.
const CORPUS = [
  // ---------------------------------------------------------------- judge 10: the five live lines
  ['streak', "Nansen's 7-day summary shows +$594,869 realised this week.",
    spent("+$594,869 is the tile's Hyperliquid leaderboard figure for the week to 21 Sep, not Nansen's; Nansen's 7-day summary is a different figure.")],
  ['realdeal', "Nansen's 30-day summary shows +$116,554.",
    spent("+$116,554 is the tile's Hyperliquid leaderboard figure for the 30 days to 21 Sep, not Nansen's; Nansen's 30-day summary is a different figure.")],
  ['realdeal:live', "Nansen's 30-day summary shows +$116,554.",
    spent("+$116,554 is the tile's Hyperliquid leaderboard figure for the 30 days to 21 Sep, not Nansen's; Nansen's 30-day summary is a different figure.")],
  ['grinder', 'Nansen shows +$35,723 realised over the last 30 days.', spent('+$35,723 is a 7-day figure, not 30-day.')],
  ['grinder:live', 'Nansen shows +$35,723 realised over the last 30 days.',
    spent("+$35,723 is the tile's Nansen 7-day figure for the week to 15 Sep, not a 30-day figure.")],
  ['grinder:live', 'The Hyperliquid leaderboard shows a 92.3% win rate over 30 days.',
    spent("92.3% is Nansen's 30-day win rate, not a leaderboard figure.")],
  ['grinder', 'The Hyperliquid leaderboard shows a 92.3% win rate over 30 days.',
    spent('92.3% is not a leaderboard figure: the Hyperliquid leaderboard publishes no win rate.')],
  ['grinder', 'The Hyperliquid leaderboard shows a 53.9% win rate over 30 days.',
    spent("53.9% is Nansen's 30-day win rate, not a leaderboard figure.")],
  ['legend', 'The Hyperliquid leaderboard shows 164,048 trades closed in the last 7 days.',
    spent('164,048 trades is not a leaderboard figure: the Hyperliquid leaderboard publishes no trade count.')],
  ['legend:pulse', 'The Hyperliquid leaderboard shows 132,082 trades closed in the last 7 days.',
    spent("132,082 trades is Nansen's 7-day trade count on the tile, not a leaderboard figure.")],
  ['legend:pulse', 'Nansen counts 132,082 trades closed in the last 7 days.', PASS],

  // ---------------------------------------------------------------------------- judge 9 lines
  ['grinder', '+$35,723 week to 15 Sep · 100% win rate · Nansen saved read 15 Sep 10:40', PASS],
  ['grinder:live', '+$35,723 week to 15 Sep · 100% win rate · Nansen saved read 15 Sep 10:40', PASS],
  ['steadyhand', '+$190,379 week to 25 Sep · 42.1% win rate · Nansen saved read 25 Sep 11:31 UTC', PASS],
  ['streak', '+$594,869 over the last 30 days. Shorts pay.',
    spent("+$594,869 is the tile's Hyperliquid leaderboard figure for the week to 21 Sep, not a 30-day figure.")],
  ['streak', '+$594,869 in the week to 21 Sep on the Hyperliquid leaderboard, and +$9,999,999 this month.', spent('+$9,999,999 is not in the record.')],
  ['streak', '+$594,869 in the week to 21 Sep on the Hyperliquid leaderboard. Shorts pay.', PASS],
  ['steadyhand', 'The Steady Hand made +$190,379 realised in the last 7 days, with a 51.4% win rate over 2,661 trades.',
    spent('51.4% and 2,661 trades are 30-day figures, not 7-day.')],
  ['steadyhand', 'It made +$190,379 over 30 days.', spent('+$190,379 is a 7-day figure, not 30-day.')],
  ['steadyhand', 'Made $209,987 on ZEC.', spent('$209,987 is not in the record.')],

  // ------------------------------------------------------------------------- cross-wallet figures
  ['streak', '+$116,554 over 30 days on the Hyperliquid leaderboard.',
    spent("+$116,554 is THE REAL DEAL's Hyperliquid leaderboard figure for the 30 days to 21 Sep, not this trader's.")],
  ['grinder', 'Nansen shows +$190,379 realised this week.',
    spent("+$190,379 is THE STEADY HAND's Nansen 7-day figure for the week to 25 Sep, not this trader's.")],
  ['realdeal', '+$94,310,198 all time on the leaderboard.',
    spent("+$94,310,198 is THE STREAK's Hyperliquid leaderboard all-time figure (all time to 21 Sep), not this trader's.")],
  ['steadyhand', 'FARTCOIN alone made +$353,874 over 30 days.', spent("+$353,874 is THE LEGEND's Nansen 30-day FARTCOIN PnL, not this trader's.")],

  // ------------------------------------------------------------------ true lines, every wallet
  ['steadyhand', 'Nansen shows +$190,379 realised over the last 7 days, with a 51.4% win rate over 2,661 trades in 30 days.', PASS],
  ['steadyhand', 'ZEC alone made +$262,838 over the 30 days.', PASS],
  ['legend', '+$118,975,612 all time on the Hyperliquid leaderboard, and FARTCOIN alone made +$353,874 over 30 days per Nansen.', PASS],
  ['legend', '$69,023,422 account value on the Hyperliquid leaderboard.', PASS],
  ['legend:live', 'FARTCOIN alone made +$327,739 over 30 days per Nansen, and +$118,975,612 all time on the leaderboard.', PASS],
  ['streak', 'The Hyperliquid leaderboard shows +$594,869 for the week to 21 Sep and +$94,310,198 all time.', PASS],
  ['streak', 'TAO alone made +$83,994 over the 30 days.', PASS],
  ['realdeal', "Hyperliquid's leaderboard shows +$116,554 over 30 days; Nansen's 30-day win rate is 60.3% over 2,064 trades.", PASS],
  ['realdeal:live', 'Nansen shows +$32,443 this week at a 91.3% win rate over 1,414 trades.', PASS],
  ['grinder', "Nansen's 7-day summary: +$35,723 realised, 100% win rate over 424 trades.", PASS],
  ['grinder:live', "Nansen's 30-day summary shows +$159,041 realised and a 92.3% win rate over 2,909 trades.", PASS],
  ['grinder', 'PONS alone made +$100,849 over 30 days.', PASS],

  // --------------------------------------------------------------------------- number formats
  ['streak', '$594,869 on the leaderboard this week.', PASS],
  ['streak', '594,869 on the leaderboard this week.', PASS],
  ['streak', '$594.9k on the leaderboard this week.', PASS],
  ['streak', '594k on the leaderboard this week.', PASS],
  ['streak', 'About $0.6m on the leaderboard this week.', PASS],
  ['streak', "594k this week per Nansen's summary.",
    spent("594k is the tile's Hyperliquid leaderboard figure for the week to 21 Sep, not Nansen's; Nansen's 7-day summary is a different figure.")],
  ['streak', 'Over $500k on the leaderboard this week.', PASS],
  ['steadyhand', 'About $190k in a week.', PASS],

  // --------------------------------------------------------------------------- window formats
  ['streak', '+$594,869 in 7 days on the leaderboard.', PASS],
  ['streak', '+$594,869 in 7d on the leaderboard.', PASS],
  ['streak', 'Leaderboard weekly PnL: +$594,869.', PASS],
  ['streak', '+$594,869 over the last 7 days on the Hyperliquid leaderboard.', PASS],
  ['realdeal', '+$116,554 this month on the leaderboard.', PASS],
  ['realdeal', '+$116,554 over 30d on the leaderboard.', PASS],
  ['realdeal', 'The 30-day leaderboard figure is +$116,554.', PASS],
  ['realdeal', '+$116,554 this week on the leaderboard.',
    spent("+$116,554 is the tile's Hyperliquid leaderboard figure for the 30 days to 21 Sep, not a 7-day figure.")],
  ['realdeal', '+$428,058 lifetime on the Hyperliquid leaderboard.', PASS],
  ['realdeal', '+$428,058 all time according to Nansen.', /^Referee: \+\$428,058 is the Hyperliquid leaderboard's all-time PnL, not a Nansen figure\. The line is spent\.$/],
  ['realdeal', '+$428,058 over 30 days on the leaderboard.', /^Referee: \+\$428,058 is the Hyperliquid leaderboard's all-time PnL, not a 30-day figure\. The line is spent\.$/],

  // --------------------------------------------------------------------------- source formats
  ['grinder', "According to Nansen's summary, +$35,723 in 7 days.", PASS],
  ['grinder', 'Nansen: +$35,723 in 7 days.', PASS],
  ['grinder', 'The leaderboard shows +$35,723 this week.', spent("+$35,723 is Nansen's 7-day realised PnL, not a leaderboard figure.")],
  ['grinder', 'Hyperliquid shows a 100% win rate this week.', spent("100% is Nansen's 7-day win rate, not a leaderboard figure.")],
  ['grinder', 'He made +$35,723 on Hyperliquid this week.', PASS],

  // ------------------------------------------------------------------ sign, sealed, measures
  ['streak', '+$163,698 this week per Nansen.', spent('+$163,698 is not in the record.')],
  ['streak', 'Nansen shows -$163,698 over 7 days.', PASS],
  ['steadyhand', 'It made +$358,593 in 7 days.', spent('+$358,593 is not the 7-day figure in the record.')],
  ['legend', 'He made $69,023,422 all time.', /^Referee: \$69,023,422 is the tile's Hyperliquid leaderboard account value \(read 21 Sep 21:56 UTC\), not an all-time figure\. The line is spent\.$/],
  ['steadyhand', 'NEAR alone made +$262,838 over the 30 days.', spent("+$262,838 is ZEC's 30-day PnL, not NEAR's.")],
  ['realdeal', 'The leaderboard shows 60.3% this month.', spent("60.3% is Nansen's 30-day win rate, not a leaderboard figure.")],

  // ------------------------------------- a cue in one sentence says nothing about the next one's figure
  ['legend', '+$118,975,612 all time on the public Hyperliquid leaderboard. FARTCOIN alone made +$353,874 over the 30 days.', PASS],
  ['realdeal', '+$428,058 all time on the public Hyperliquid leaderboard. 67.8% win rate across 115 closed trades in 7 days.', PASS],
  ['grinder', '+$35,723 this week. 53.9% win rate.', PASS],
  ['realdeal', 'Nansen shows 67.8% this week. The leaderboard shows 60.3% this month.', spent("60.3% is Nansen's 30-day win rate, not a leaderboard figure.")],

  // --------------------------------------------------------- not claims about the record at all
  ['grinder', 'Send $2,500 on the back of +$35,723 this week.', PASS],
  ['streak', 'Give him $5,000 and watch.', PASS],
  ['realdeal', 'Put 10% of the fund on him.', PASS],
  ['legend', 'Legends do not lose. Trust the process.', PASS],

  // ------------------------------------------------ judge 11: the live and offline attack lines
  // Live lines on STEADY HAND quoted the live read (+$222,264 7-day, ZEC +$275,194 30-day); the saved
  // roster read here has +$190,379 and ZEC +$262,838 in the same places. LEGEND's live FARTCOIN
  // figure (+$317,857) is +$353,874 in the saved read.
  ["streak", "Nansen shows +$83,994 realised over the last 30 days.",
    spent("+$83,994 is only TAO's 30-day PnL, not the wallet's total.")],
  ["steadyhand", "Nansen shows +$262,838 realised over the last 30 days.",
    spent("+$262,838 is only ZEC's 30-day PnL, not the wallet's total.")],
  ["steadyhand", "+$190,379 realised over the last 7 days per Nansen, and he has not closed a single losing trade this month.",
    spent("the line claims no losses, but Nansen's 30-day win rate is below 100%: trades were lost.")],
  ["grinder", "PONS alone made +$100,849 over the 30 days, and Nansen labels this wallet a Smart Money fund.",
    spent("nothing in the record labels this wallet Smart Money.")],
  ["realdeal", "The Hyperliquid leaderboard shows +$116,554 over the last 90 days.",
    spent("+$116,554 is the tile's Hyperliquid leaderboard figure for the 30 days to 21 Sep, not a 90-day figure.")],
  ["legend", "He made $69,023,422 on the Hyperliquid leaderboard.",
    spent("$69,023,422 is the tile's Hyperliquid leaderboard account value (read 21 Sep 21:56 UTC), not PnL.")],
  ["steadyhand", "Pull up Nansen's 30-day summary. +$190,379 realised.",
    spent("+$190,379 is a 7-day figure, not 30-day.")],
  ["steadyhand", "Arkham's dashboard shows +$190,379 realised this week.",
    spent("+$190,379 is Nansen's 7-day realised PnL, not an Arkham figure: the record was not read from Arkham.")],
  ["streak", "Nansen shows 331 trades this week.",
    spent("331 trades is not the wallet's 7-day trade count in the record.")],
  ["streak", "Nansen counts 7 trades this week.",
    spent("7 trades is not Nansen's 7-day trade count.")],
  ["grinder", "Nansen shows a 53.9% ROI over 30 days.",
    spent("53.9% is Nansen's 30-day win rate, not a return.")],
  ["streak", "Nansen shows a +$9,999,999 position this week.",
    spent("+$9,999,999 is not in the record.")],
  ["streak", "The leaderboard shows +9999999 USDC this week.",
    spent("+9999999 USDC is not in the record.")],
  ["streak", "He lost $594,869 on the Hyperliquid leaderboard in the week to 21 Sep.",
    spent("$594,869 has the wrong sign: the tile's Hyperliquid leaderboard figure for the week to 21 Sep is a gain, not a loss.")],
  ["legend", "+$118,975,612 all time on the public Hyperliquid leaderboard, and FARTCOIN alone made +$353,874 over the 30 days.",
    PASS],
  ["grinder", "Over 1,000 trades in 30 days per Nansen.",
    PASS],
  ["streak", "+$25,000 this week on the leaderboard.",
    spent("+$25,000 is not in the record.")],
  ["streak", "+$594,869 today on the Hyperliquid leaderboard.",
    spent("+$594,869 is the tile's Hyperliquid leaderboard figure for the week to 21 Sep, not a figure for today.")],
  ["streak", "+$594,869 this year on the Hyperliquid leaderboard.",
    spent("+$594,869 is the tile's Hyperliquid leaderboard figure for the week to 21 Sep, not a figure for this year.")],
  ["streak", "+$594,869 over the last 3 weeks on the Hyperliquid leaderboard.",
    spent("+$594,869 is the tile's Hyperliquid leaderboard figure for the week to 21 Sep, not a 3-week figure.")],
  ["legend", "He is up $69,023,422.",
    spent("$69,023,422 is the tile's Hyperliquid leaderboard account value (read 21 Sep 21:56 UTC), not PnL.")],
  ["streak", "Nansen's 7-day summary says so. +$594,869.",
    spent("+$594,869 is the tile's Hyperliquid leaderboard figure for the week to 21 Sep, not Nansen's; Nansen's 7-day summary is a different figure.")],
  ["streak", "The leaderboard shows it for this week. +$594,869.",
    PASS],
  ["streak", "About $600k on the leaderboard this week.",
    PASS],
  ["streak", "The leaderboard shows 594869 this week.",
    PASS],
  ["streak", "Give him $5,000 of your $25,000 slot.",
    PASS],

  // ------------------------------------------------- judge 11: more adversarial lines, all struck
  ["steadyhand", "The Steady Hand banked +$190,379 over the last two weeks per Nansen.",
    spent("+$190,379 is Nansen's 7-day realised PnL, not a two-week figure.")],
  ["steadyhand", "DeBank shows a 51.4% win rate over 30 days.",
    spent("51.4% is Nansen's 30-day win rate, not a DeBank figure: the record was not read from DeBank.")],
  ["steadyhand", "Nansen shows +$116,494 realised this week.",
    spent("+$116,494 is not the wallet's 7-day total in the record.")],
  ["steadyhand", "NEAR alone made +$190,379 this week.",
    spent("+$190,379 is Nansen's 7-day realised PnL, not NEAR's.")],
  ["steadyhand", "A 51.4% ROI across 2,661 trades in 30 days per Nansen.",
    spent("51.4% is Nansen's 30-day win rate, not a return.")],
  ["steadyhand", "Nansen counts 12 coins traded this week.",
    spent("12 coins is not Nansen's 7-day coin count.")],
  ["legend", "He is sitting on a +$118,975,612 account balance.",
    spent("+$118,975,612 is the Hyperliquid leaderboard's all-time PnL, not the account value.")],
  ["legend", "+$118,975,612 over the last 30 days on the Hyperliquid leaderboard.",
    spent("+$118,975,612 is the Hyperliquid leaderboard's all-time PnL, not a 30-day figure.")],
  ["legend", "FARTCOIN made +$353,874 in 24h per Nansen.",
    spent("+$353,874 is Nansen's FARTCOIN 30-day PnL, not a 24-hour figure.")],
  ["legend", "Nansen labels him Smart Money, +$353,874 from FARTCOIN over 30 days.",
    spent("nothing in the record labels this wallet Smart Money.")],
  ["streak", "The Streak has never had a losing trade: +$594,869 this week on the leaderboard.",
    spent("the line claims no losses, but Nansen's 7-day win rate is below 100%: trades were lost.")],
  ["streak", "+$594,869 this week on the leaderboard, and Nansen confirms it.",
    spent("+$594,869 is the tile's Hyperliquid leaderboard figure for the week to 21 Sep, not Nansen's; Nansen's 7-day summary is a different figure.")],
  ["streak", "Dune's dashboard puts him at +$94,310,198 all time.",
    spent("+$94,310,198 is the Hyperliquid leaderboard's all-time PnL, not a Dune figure: the record was not read from Dune.")],
  ["streak", "TAO alone made +$83,994 this week.",
    spent("+$83,994 is a 30-day figure, not 7-day.")],
  ["realdeal", "+$428,058 in 2025 alone on the Hyperliquid leaderboard.",
    spent("+$428,058 is the Hyperliquid leaderboard's all-time PnL, not a figure for 2025.")],
  ["realdeal", "The leaderboard shows 2,064 trades over 30 days.",
    spent("2,064 trades is Nansen's 30-day trade count, not a leaderboard figure.")],
  ["realdeal", "HYPE alone made +$52,030 over the 30 days, and 67.8% of his trades won this month.",
    spent("67.8% is a 7-day figure, not 30-day.")],
  ["realdeal", "Nansen shows +$52,030 realised over 30 days.",
    spent("+$52,030 is only HYPE's 30-day PnL, not the wallet's total.")],
  ["grinder", "100% win rate across 424 closed trades in 30 days.",
    spent("100% and 424 trades are 7-day figures, not 30-day.")],
  ["grinder", "He made 35723 dollars yesterday per Nansen.",
    spent("35723 dollars is Nansen's 7-day realised PnL, not a figure for yesterday.")],
  ["grinder", "Over 5,000 trades in 30 days per Nansen.",
    spent("5,000 trades is not in the record.")],
  ["grinder", "Nansen labels this wallet a Smart Money fund.",
    spent("nothing in the record labels this wallet Smart Money.")],

  ["grinder", "+$35,723 this week per Nansen. His 30-day PnL is positive too.",
    spent("the line says the 30-day result made money; the 30-day realised PnL in the record did not.")],
  ["grinder", "PONS alone made +$100,849 over the 30 days; overall he is up this month too.",
    spent("the line says the 30-day result made money; the 30-day realised PnL in the record did not.")],

  // ------------------------------------------------------ judge 11: true paraphrases, all stand
  ["steadyhand", "Per Nansen, the Steady Hand booked about $190k of realised profit in the last week.",
    PASS],
  ["steadyhand", "Across the past thirty days Nansen logs 2,661 closed trades at a 51.4% win rate.",
    PASS],
  ["legend", "The Legend's all-time leaderboard PnL: +$118,975,612.",
    PASS],
  ["legend", "Nansen's 30-day read: FARTCOIN alone made roughly $354k.",
    PASS],
  ["streak", "TAO alone made +$83,994 over 30 days per Nansen, and the leaderboard shows +$594,869 for the week to 21 Sep.",
    PASS],
  ["streak", "Hyperliquid's leaderboard lists +$94.3m lifetime.",
    PASS],
  ["realdeal", "On the Hyperliquid leaderboard he is up +$116,554 over 30 days and +$428,058 all time.",
    PASS],
  ["realdeal", "In 7 days Nansen records a 67.8% win rate over 115 trades.",
    PASS],
  ["grinder", "At least 400 closed trades this week, every one a winner: a 100% win rate per Nansen.",
    PASS],
  ["grinder", "PONS alone made over $100k in the last 30 days, per Nansen.",
    PASS],
  ["grinder", "No losing trades this week: a 100% win rate over 424 trades per Nansen.",
    PASS],
];

test(`judge 10: the referee corpus (${CORPUS.length} lines) is ruled deterministically, whatever the model says`, async () => {
  const cache = new Map();
  const failures = [];
  for (const [key, line, expected] of CORPUS) {
    if (!cache.has(key)) cache.set(key, await setup(key));
    const { dossier, data, others } = cache.get(key);
    const got = attributionStrike(line, dossier, data, { others });
    const ok = expected === null ? got === null
      : expected instanceof RegExp ? expected.test(got ?? '') : got === expected;
    if (!ok) failures.push(`${key} | ${line}\n   want: ${expected}\n   got:  ${got}`);
  }
  assert.equal(failures.length, 0, `\n${failures.join('\n')}`);
});

test('judge 10: every pair of offered cards, and every tile, pitched as written, stands on every wallet and saved read', async () => {
  const keys = ['steadyhand', 'legend', 'streak', 'realdeal', 'grinder', 'grinder:live', 'realdeal:live', 'legend:live', 'legend:pulse'];
  for (const key of keys) {
    const { p, dossier, data, others } = await setup(key);
    const inserts = dossier.facts.filter(f => f.tone === 'positive').map(f => f.insert);
    const lines = [...inserts.flatMap(a => inserts.map(b => (a === b ? a : `${a} ${b}`))),
      [p.hype.value, [p.hype.caption, p.hype.sub].filter(Boolean).join(' · '), p.hype.readLabel].join(' '),
      ...dossier.published.map(e => e.claim)];
    for (const line of lines) assert.equal(attributionStrike(line, dossier, data, { others }), null, `${key}: ${line}`);
  }
});

test('judge 10: a deterministic strike is final: a model rejection or acceptance cannot change it', async () => {
  for (const [key, line, expected] of CORPUS.filter(([, , e]) => e !== null).slice(0, 12)) {
    const { dossier, data, others } = await setup(key);
    for (const reason of ['', 'The line does not match the record.', `${line.match(/[\d,.]+/)?.[0]} is on the tile.`]) {
      const r = rejectionRuling(line, dossier, data, reason, { others });
      assert.equal(r.stands, false, `${key}: ${line}`);
      assert.equal(r.referee, attributionStrike(line, dossier, data, { others }));
    }
    assert.notEqual(refereeVerdict(line, dossier, data, { others }), null);
    void expected;
  }
});

test('judge 10: in a round the referee strikes before the model is asked, and PENNY never hears the line', async () => {
  const cases = [
    ['streak', "Nansen's 7-day summary shows +$594,869 realised this week.", /not Nansen's/],
    ['realdeal', "Nansen's 30-day summary shows +$116,554.", /not Nansen's/],
    ['grinder', 'Nansen shows +$35,723 realised over the last 30 days.', /7-day figure, not 30-day/],
    ['grinder', 'The Hyperliquid leaderboard shows a 53.9% win rate over 30 days.', /not a leaderboard figure/],
    ['legend', 'The Hyperliquid leaderboard shows 164,048 trades closed in the last 7 days.', /publishes no trade count/],
    ['grinder', '+$116,554 over 30 days on the Hyperliquid leaderboard.', /THE REAL DEAL's/],
  ];
  for (const [id, text, why] of cases) {
    const provider = stubProvider([{ text: '{"valid":true,"reason":""}' }, { text: 'Fine.\n{"allocation": 15000, "mood": "sold", "line": "Deal."}\nALLOCATION: 60' }]);
    const service = createRoomService({ roster: loadRoster(), provider, leaderboard: board(), health: () => ({}) });
    const start = await service.start({ prospect: id });
    const after = await service.pitch(start.id, { requestId: `judge10-${id}-${text.length}`, shot: 0, text });
    const shot = after.shots.at(-1);
    assert.equal(shot.caught, true, `${id}: ${text}`);
    assert.match(shot.referee, why);
    assert.equal(after.funded, 0, 'PENNY paid nothing on a struck line');
    assert.equal(provider.seen.length, 0, 'neither the checker nor PENNY was asked');
  }
});

test('judge 11: a model rejection always strikes, with a reason: code never un-strikes it', async () => {
  const { dossier, data, others } = await setup('realdeal');
  const line = "Hyperliquid's leaderboard shows +$116,554 over 30 days; Nansen's 30-day win rate is 60.3% over 2,064 trades.";
  // Judge 10 let this stand because every figure passed the referee; judge 11: the model's word strikes.
  const figures = rejectionRuling(line, dossier, data, '+$116,554 is not the 30-day realised PnL of +$35,083.', { others });
  assert.equal(figures.stands, false);
  assert.match(figures.referee, /^Referee: .+ The line is spent\.$/);
  assert.doesNotMatch(figures.referee, /35,083/, 'a sealed figure stays sealed');
  const claim = rejectionRuling(`${line} Guaranteed to double.`, dossier, data, 'The pitch invents a guaranteed return.', { others });
  assert.equal(claim.stands, false);
  for (const reason of ['', '   ', 'The line does not match the record.', undefined]) {
    const r = rejectionRuling(line, dossier, data, reason, { others });
    assert.equal(r.stands, false);
    assert.equal(r.referee, 'Referee: the line does not match the record as stated. The line is spent.', 'no blank reason');
  }
});

test('judge 11: in a round a model rejection of a line the referee passed strikes, and PENNY never hears it', async () => {
  const text = '+$190,379 realised over the last 7 days per Nansen, and he closes his losers fast.';
  const provider = stubProvider([{ text: '{"valid":false,"reason":"The pitch claims a trading habit the record does not show."}' }, { text: 'Fine.\n{"allocation": 18000, "mood": "sold", "line": "Deal."}\nALLOCATION: 72' }]);
  const service = createRoomService({ roster: loadRoster(), provider, leaderboard: board(), health: () => ({}) });
  const start = await service.start({ prospect: 'steadyhand' });
  assert.equal(attributionStrike(text, withTileExtras(buildProspectDossier(roster.find(p => p.id === 'steadyhand')), []), roster.find(p => p.id === 'steadyhand').checkerData, { others: rosterFacts(roster.filter(p => p.id !== 'steadyhand')) }), null);
  const after = await service.pitch(start.id, { requestId: 'judge11-model-reject-01', shot: 0, text });
  const shot = after.shots.at(-1);
  assert.equal(shot.caught, true);
  assert.match(shot.referee, /^Referee: .+ The line is spent\.$/);
  assert.equal(after.funded, 0, 'PENNY paid nothing on a struck line');
  assert.equal(provider.seen.length, 1, 'only the checker was asked');
});
