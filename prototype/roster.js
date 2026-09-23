/**
 * The Pitch Room roster: eight real public traders across two venues.
 *
 * A tile shows only what the trader publishes about themselves. The truth behind it is
 * served after the pick, never before, so the hype cannot be cross checked from the
 * roster call. Every truth number carries its source, its window and its capture date.
 *
 * Three sources, kept apart on purpose:
 *   - hype, Hyperliquid: the free public leaderboard rows saved in
 *     prototype/fixtures/roster-hype.json.
 *   - truth, Hyperliquid: a Nansen snapshot in validation/snapshots/ when one exists,
 *     otherwise the placeholder in prototype/fixtures/roster-snapshots/, which is
 *     labelled as a fixture everywhere it is shown. Nothing in this file calls Nansen.
 *   - hype and truth, Fomo: one recorded Fomo Radar response per handle in
 *     prototype/fixtures/fomo/, copied unchanged. Robinhood Chain fills only. This is
 *     not Nansen coverage and is never presented as Nansen coverage.
 *
 * Two rules this file exists to keep:
 *
 * 1. The roster is an unranked lineup. It is never sorted or numbered by PnL and it is
 *    never called a leaderboard, because Nansen allows per wallet PnL but not public
 *    PnL leaderboards.
 * 2. Realised means sold. For the Fomo prospects every realised figure is recomputed
 *    from the response's own `closed[]` rows rather than taken from its `stats` block,
 *    because the two disagree and only the rows are auditable: each one carries what was
 *    bought, what was sold, the exit share and the chain it was observed on. The same
 *    rule now covers unrealised PnL, the traded volume and the top position's share of
 *    the book, all of which the `stats` block also gets wrong. The model-written
 *    assessment fields in those responses are never read and never shown.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BENCHMARK_GUARD_POLICY, BENCHMARK_GUARD_POLICY_V3, assessCopyRisk } from '../validation/guard.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const FOMO_SOURCE = 'Fomo Radar /api/trader (recorded)';
export const FOMO_SCOPE = 'Robinhood Chain fills only';
export const NANSEN_SOURCE = 'Nansen /api/v1/profiler/perp-pnl-summary';

const money = n => `${n < 0 ? '-' : '+'}$${Math.round(Math.abs(n)).toLocaleString('en-US')}`;
const plain = n => `$${Math.round(Math.abs(n)).toLocaleString('en-US')}`;
const count = n => Math.round(n).toLocaleString('en-US');
const pct = n => `${(n * 100).toFixed(n === 1 ? 0 : 1)}%`;
const short = w => `${w.slice(0, 6)}...${w.slice(-4)}`;
const day = iso => new Date(iso).toISOString().slice(0, 10);
const minute = iso => `${new Date(iso).toISOString().slice(0, 10)} ${new Date(iso).toISOString().slice(11, 16)}`;
/**
 * How long a stretch of evidence covers, in the largest unit that is not a lie. Two
 * dates are not enough when a thousand fills land inside one hour: "2026-08-22 to
 * 2026-08-22" reads like a full day of trading and it was 74 minutes.
 */
const span = (fromIso, toIso) => {
  const minutes = Math.max(0, Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 60_000));
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  if (minutes < 60 * 48) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${h} hour${h === 1 ? '' : 's'}${m ? ` ${m} minutes` : ''}`;
  }
  const d = Math.round(minutes / 1440);
  return `${d} days`;
};
// Capture dates are printed in UTC and say so, because the same instant is a different
// calendar day in the founder's timezone and a date without a zone invites that argument.
const stamp = iso => `${day(iso)} UTC`;

/**
 * The lineup. Numbers live in the evidence files, not here: this table carries only
 * identity, venue, the accent colour the screen paints the tile with, and the portrait
 * the page draws. `voice` is the one line the tile says on hover, and every figure one of
 * them names is asserted against the loaded record by prototype/roster.test.js, which is
 * how the $24M frankdegods used to brag was caught: that number is in Fomo's `stats`
 * block and nowhere in its tape.
 */
export const PROSPECTS = [
  {
    id: 'legend', venue: 'hyperliquid', wallet: '0x7fdafde5cfb5465924316eced2d3715494c517d1',
    name: 'THE LEGEND', handle: 'BobbyBigSize', accent: '#FF5C39', portrait: 'legend',
    hypeKind: 'all_time',
    voice: 'A hundred and nineteen million, all time. Go and look it up.',
  },
  {
    id: 'streak', venue: 'hyperliquid', wallet: '0xa312114b5795dff9b8db50474dd57701aa78ad1e',
    name: 'THE STREAK', handle: 'NAKED SHORTS ONLY', accent: '#FF4D6D', portrait: 'streak',
    hypeKind: 'week',
    voice: 'Up most of six hundred grand this week. Shorts pay.',
  },
  {
    id: 'realdeal', venue: 'hyperliquid', wallet: '0xfe47c8f29f65830d7990e85852cc2c5cee1c0085',
    name: 'THE REAL DEAL', handle: null, accent: '#62D49A', portrait: 'realdeal',
    hypeKind: 'month', tools: ['check_pnl'],
    voice: 'A hundred and sixteen thousand this month. Small book, real print.',
  },
  {
    id: 'grinder', venue: 'hyperliquid', wallet: '0xc26cbb6483229e0d0f9a1cab675271eda535b8f4',
    name: 'THE GRINDER', handle: 'Trader 014', accent: '#FFB020', portrait: 'grinder',
    hypeKind: 'week_streak', live: true,
    voice: 'Four hundred and twenty four trades last week. Every one green.',
  },
  {
    id: 'unipcs', venue: 'fomo', wallet: '0x0a6ebed0155edb4b21d92ad02897a626cd90119e',
    name: 'unipcs', handle: 'unipcs', accent: '#8B7BFF', portrait: 'unipcs',
    voice: 'Half a million people watch this wallet. The profile says ten point eight.',
  },
  {
    id: 'ether_monk', venue: 'fomo', wallet: '0x2408ce75d217e3a70d6ca370c78c1b34d706f5a0',
    name: 'ether_monk', handle: 'ether_monk', accent: '#4FC3F7', portrait: 'monk',
    voice: 'Three hundred thousand followers. The profile reads one and a half million.',
  },
  {
    id: 'frankdegods', venue: 'fomo', wallet: '0x696d1265c8fc4f14797abebfae3c43ebfa9d8e28',
    name: 'frankdegods', handle: 'frankdegods', accent: '#E0C46C', portrait: 'frank',
    // The $24M this line used to brag was Fomo's `stats.unrealized_pnl`, which its own
    // tape contradicts: the 209 marked positions carry $1.16M. The brag is the tape.
    voice: 'A million sitting in open bags. I do not need to sell.',
  },
  {
    id: 'orangie', venue: 'fomo', wallet: '0x0eb6f8e5c8bc7d5c920d485b7b3d52e56cdef21f',
    name: 'orangie', handle: 'orangie', accent: '#FFA62B', portrait: 'orangie',
    voice: 'A hundred and thirty thousand followers watch every entry I take.',
  },
];

export const VENUES = {
  hyperliquid: { id: 'hyperliquid', label: 'Hyperliquid', chain: 'Hyperliquid' },
  fomo: { id: 'fomo', label: 'Fomo', chain: 'Robinhood Chain' },
};

// ------------------------------------------------------------- Fomo records

/**
 * A recorded Fomo Radar response, served to the desk and to BAIT's gate through the
 * same tiny executor, so the desk and the gate can never be looking at two different
 * numbers.
 */
export function fomoExecutor(record) {
  const payload = {
    wallet: record.address,
    handle: record.handle,
    window_days: record.windowDays,
    window: record.window,
    realized_pnl_usd: record.realized,
    realized_basis: record.realizedBasis,
    unrealized_pnl_usd: record.unrealized,
    win_rate: record.winRate,
    closed_trade_count: record.closedTrades,
    fully_closed_round_trip_count: record.roundTrips,
    winning_trade_count: record.wins,
    open_position_count: record.openBags,
    positions_bought_before_window: record.preTape,
    volume_usd: record.volume,
    volume_basis: 'bought plus sold across the sold positions in this tape',
    best_closed_trade_usd: record.bestTrade,
    worst_closed_trade_usd: record.worstTrade,
    open_book_chains: record.openChains,
    unrealized_pnl_off_robinhood_usd: record.offChainPaper,
    follower_count: record.followers,
    profile_headline_pnl_usd: record.headline,
    note:
      'The profile headline includes positions that have not been sold. ' +
      `realized_pnl_usd is the sum of the ${record.closedTrades} sold positions in this tape ` +
      `and nothing else; ${record.roundTrips} of them went out in full and the rest were ` +
      'partly sold. The realised figure is observed on Robinhood Chain fills and nowhere ' +
      'else, the open book Fomo marks also carries positions on other chains, and ' +
      `${record.preTape} positions bought before the tape started are excluded.`,
    source: FOMO_SOURCE,
    scope: FOMO_SCOPE,
    retrieved_at: record.retrievedAt,
  };
  return {
    execute: async name => {
      if (name === 'get_pnl_summary' || name === 'check_fomo_record') return { ...payload };
      return { error: 'unavailable', message: `The desk holds the recorded Fomo Radar tape only. ${name} is not served for this trader.` };
    },
  };
}

/**
 * Read one recorded response and recompute the realised figures from its `closed[]`
 * round trips. `stats.realized_pnl` in the same file disagrees with that list, so the
 * list wins: it is the part a reader can add up themselves.
 */
export function readFomo(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const s = raw.stats;
  // Every row in `closed[]` has realised PnL, but not every row is a finished round
  // trip: `state` is `closed` only when the whole position went out. The rest are
  // `trimmed` or still `held` after a partial sell, and the response's own
  // `round_trips` counts only the finished ones (frankdegods: 190 rows, 186 finished).
  // The realised total keeps every row, because a partial sell is money taken off the
  // table, and the screen says "sold positions" rather than calling all 190 round trips.
  const trips = [...(raw.closed ?? [])]
    .filter(t => Number.isFinite(t.realized))
    .sort((a, b) => (a.last_ts ?? 0) - (b.last_ts ?? 0));
  const roundTrips = trips.filter(t => t.state === 'closed').length;
  const realized = trips.reduce((a, t) => a + t.realized, 0);
  const wins = trips.filter(t => t.realized > 0).length;
  const best = trips.reduce((a, t) => Math.max(a, t.realized), -Infinity);
  const worst = trips.reduce((a, t) => Math.min(a, t.realized), Infinity);
  const bestTrip = trips.find(t => t.realized === best);
  // The turnover behind the realised figure, added up from the same rows. `stats.volume`
  // is not derivable from anything in the tape (frankdegods: $5.94M in the block against
  // $7.27M bought and sold across the 190 rows), so it is not read here.
  const turnover = trips.reduce((a, t) => a + (Number(t.bought_usd) || 0) + (Number(t.sold_usd) || 0), 0);

  const held = (raw.positions ?? []).filter(p => p.state !== 'closed');
  // Fomo's stats block disagrees with its own tape on unrealised PnL as well as on
  // realised (frankdegods: $24.0M in the block, $1.16M marked on the 209 tape
  // positions). Every figure here comes from the tape, so the paper number does too.
  const unrealized = Number.isFinite(raw.open_pnl)
    ? raw.open_pnl
    : held.reduce((a, p) => a + (Number.isFinite(p.pnl) ? p.pnl : 0), 0);
  // `book_value` is exactly the sum of `worth` over the held positions in all four
  // recorded responses, so the top position's share is a market value over the same
  // market value. Nothing here falls back to a position's PnL for that share: a PnL
  // over a book value is not a share of anything.
  const book = held.reduce((a, p) => a + (Number.isFinite(p.worth) ? p.worth : 0), 0);
  const topWorth = held.reduce((a, p) => Math.max(a, Number.isFinite(p.worth) ? Math.abs(p.worth) : 0), 0);
  const topPosition = held.find(p => Number.isFinite(p.worth) && Math.abs(p.worth) === topWorth) ?? null;

  // Every closed row in these responses is a Robinhood Chain round trip, but the open
  // book Fomo marks is not: it carries positions on other chains, and for some handles
  // nearly all of the paper PnL sits there. The screen names those chains rather than
  // letting "Robinhood Chain fills only" cover a figure it does not cover.
  const offChainPnl = held
    .filter(p => p.chain && p.chain !== 'robinhood')
    .reduce((a, p) => a + (Number.isFinite(p.pnl) ? p.pnl : 0), 0);
  const openChains = [...new Set(held.map(p => p.chain).filter(Boolean))].sort();
  const openChainsUnknown = held.filter(p => !p.chain).length;

  const lastClosed = trips.length ? trips[trips.length - 1].last_ts : s.last_ts;
  const from = new Date(raw.tape_from * 1000).toISOString();
  const to = new Date(Math.max(s.last_ts, lastClosed ?? 0) * 1000).toISOString();

  return {
    address: raw.address, handle: raw.handle, chain: 'Robinhood Chain',
    windowDays: Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000),
    window: { from, to },
    realized,
    realizedBasis:
      `${count(trips.length)} sold positions since ${day(from)}, ${count(roundTrips)} of them fully closed, ` +
      'Robinhood Chain fills indexed by Fomo Radar',
    unrealized,
    closedTrades: trips.length, roundTrips, wins, winRate: trips.length ? wins / trips.length : null,
    bestTrade: Number.isFinite(best) ? best : null,
    worstTrade: Number.isFinite(worst) ? worst : null,
    bestTradeCoin: bestTrip?.sym ?? null,
    bestTradeClosed: bestTrip?.state === 'closed',
    openBags: held.length, volume: turnover,
    bookValue: book,
    topPositionShare: book > 0 ? topWorth / book : null,
    topPositionCoin: topPosition?.sym ?? null,
    topPositionChain: topPosition?.chain ?? null,
    topCoinPnlShare: realized > 0 && Number.isFinite(best) ? best / realized : null,
    offChainPaper: offChainPnl,
    openChains, openChainsUnknown,
    preTape: raw.pre_tape ?? 0,
    followers: s.followers, headline: raw.fomo_pnl,
    series: trips.map(t => t.realized),
    retrievedAt: raw.retrieved_at,
  };
}

// ------------------------------------------------------------- Nansen records

/**
 * A live refresh, and some captures, page only as far as the credit budget allows. When
 * the fills are partial and the file does not already say so, declare it here, so the
 * desk's trade tool carries the standard coverage warning instead of presenting a
 * truncated total as the period total.
 */
function declareCoverage(snapshot) {
  if (snapshot.trades_pagination?.is_complete === true || snapshot.fills_coverage) return snapshot;
  const fills = [...(snapshot.trades_30d ?? [])].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  if (!fills.length) return snapshot;
  return {
    ...snapshot,
    fills_coverage: {
      complete: false,
      fills: fills.length,
      covers_from: fills[0].timestamp,
      covers_to: fills[fills.length - 1].timestamp,
    },
  };
}

/** The frozen capture for one wallet, if there is one. The control wallet is prefixed. */
function findSnapshot(dir, wallet) {
  for (const name of [`${wallet}.json`, `control_${wallet}.json`]) {
    const file = path.join(dir, name);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

// ------------------------------------------------------------ the dossiers

/** The strongest coin in a window, or null when nothing in it made money. */
const bestCoin = summary => {
  const rows = [...(summary?.top5_coins ?? [])].sort((a, b) => b.realized_pnl_usd - a.realized_pnl_usd);
  return rows[0]?.realized_pnl_usd > 0 ? rows[0] : null;
};

/**
 * The ammunition for one Hyperliquid prospect: four or five true facts the player may
 * use and, when the record has one, the number they must not mention. Every figure is
 * read out of the loaded snapshot or the loaded leaderboard row, never typed here, so
 * the dossier and the claim checker can never disagree about what is true.
 */
function hyperliquidDossier(snapshot, hype) {
  const week = snapshot.pnl_summary_7d;
  const month = snapshot.pnl_summary_30d;
  const best = bestCoin(month);
  const facts = [];

  facts.push({ id: 'week-pnl', value: money(week.realized_pnl_usd), label: '7-day realised',
    insert: `${money(week.realized_pnl_usd)} realised over the last 7 days.`,
    claim: `Over the last 7 days of the evaluation period this wallet realised ${money(week.realized_pnl_usd)} in PnL, rounded to the nearest dollar.` });
  facts.push({ id: 'week-wins', value: pct(week.win_rate), label: `7-day win rate, ${count(week.closed_trade_count)} trades`,
    insert: `${pct(week.win_rate)} win rate across ${count(week.closed_trade_count)} closed trades in 7 days.`,
    claim: `The Nansen 7-day summary reports a ${(week.win_rate * 100).toFixed(2)}% win rate across ${week.closed_trade_count} closed trades.` });
  if (best) {
    facts.push({ id: 'best-market', value: money(best.realized_pnl_usd), label: `${best.coin}, 30 days`,
      insert: `${best.coin} alone made ${money(best.realized_pnl_usd)} over the 30 days.`,
      claim: `${best.coin} contributed ${money(best.realized_pnl_usd)} of realised PnL over the full 30-day period, rounded to the nearest dollar.` });
  }
  facts.push({ id: 'month-wins', value: pct(month.win_rate), label: `30-day win rate, ${count(month.closed_trade_count)} trades`,
    insert: `${pct(month.win_rate)} win rate across ${count(month.closed_trade_count)} closed trades in 30 days.`,
    claim: `The full 30-day Nansen summary reports a ${(month.win_rate * 100).toFixed(2)}% win rate across ${month.closed_trade_count} closed trades.` });
  // An all-time figure is only ammunition when it is a gain. A negative one is another
  // number the player would have to hide, so it never enters the dossier.
  if (hype && hype.all_time_pnl_usd > 0) {
    facts.push({ id: 'all-time', value: money(hype.all_time_pnl_usd), label: 'all time, public leaderboard',
      insert: `${money(hype.all_time_pnl_usd)} all time on the public Hyperliquid leaderboard.`,
      claim: `The free public Hyperliquid leaderboard row captured on ${day(hype.capturedAt)} reports ${money(hype.all_time_pnl_usd)} all-time PnL and an account value of ${plain(hype.account_value_usd)} for this address.` });
  }

  const losing = month.realized_pnl_usd < 0;
  return {
    facts,
    buried: losing
      ? { value: money(month.realized_pnl_usd), label: '30-day realised PnL', note: 'do not mention this' }
      : null,
    clean: losing ? null : 'Nothing buried. The 30-day record holds up.',
  };
}

/** The ammunition for one Fomo prospect: the crowd, the headline and the open book. */
function fomoDossier(record) {
  return {
    facts: [
      { id: 'paper', value: money(record.unrealized), label: `unrealised, ${count(record.openBags)} open positions`,
        insert: `${money(record.unrealized)} unrealised across ${count(record.openBags)} open positions.`,
        claim: `The recorded Fomo Radar tape marks ${money(record.unrealized)} of unrealised PnL across ${record.openBags} open positions for this wallet. Unrealised means not sold.` },
      { id: 'headline', value: money(record.headline), label: 'Fomo profile headline',
        insert: `The Fomo profile headline reads ${money(record.headline)}.`,
        claim: `The Fomo profile headline PnL for ${record.handle} is ${money(record.headline)}. It includes positions that have not been sold.` },
      // Labelled as the tape's own maximum, because the `stats` block carries a much
      // smaller `best_trade` (frankdegods: $88,576 against $411,609 on the tape) and a
      // reader has to know which of the two is on screen.
      { id: 'best', value: money(record.bestTrade),
        label: `best exit in the tape${record.bestTradeCoin ? `, ${record.bestTradeCoin}` : ''}`,
        insert: `${money(record.bestTrade)} on the best single exit in the tape.`,
        claim: `The best single exit in the recorded Fomo Radar tape realised ${money(record.bestTrade)}${record.bestTradeCoin ? ` on ${record.bestTradeCoin}` : ''}, and that position was ${record.bestTradeClosed ? 'sold in full' : 'only partly sold'}.` },
      { id: 'crowd', value: count(record.followers), label: 'followers on Fomo',
        insert: `${count(record.followers)} people follow this wallet on Fomo.`,
        claim: `Fomo Radar records ${record.followers} followers for ${record.handle}.` },
    ],
    buried: record.realized < 0
      ? { value: money(record.realized), label: `realised on sold positions, ${record.windowDays} days`, note: 'do not mention this' }
      : { value: money(record.realized), label: `all that was actually sold, across ${count(record.closedTrades)} sold positions`, note: 'do not mention this' },
    clean: null,
  };
}

// --------------------------------------------------------------- the truth

function hyperliquidTruth(snapshot, availability) {
  const month = snapshot.pnl_summary_30d;
  const week = snapshot.pnl_summary_7d;
  const best = bestCoin(month);
  const fillsHeld = snapshot.trades_30d?.length ?? 0;
  const partial = snapshot.trades_pagination?.is_complete !== true;
  // A live read replaces the two summaries and nothing else. The fill tape under it is
  // still the frozen capture's, and the scope says so with that capture's date.
  const live = snapshot.source === 'live' && snapshot.live_read;
  const coverage = live
    ? `; summaries read live, ${fillsHeld ? `fill tape from the ${stamp(snapshot.live_read.fills_from_capture)} capture` : 'no fill tape held'}`
    : !partial ? ''
    : fillsHeld === 0
      ? ', summary only, this capture holds no individual fills'
      : `, ${count(fillsHeld)} fills held of ${count(month.closed_trade_count)} closed trades`;
  return {
    kind: 'nansen',
    pnl: month.realized_pnl_usd,
    pnlLabel: money(month.realized_pnl_usd),
    pnlCaption: '30-day realised PnL',
    rows: [
      { label: '7-day realised', value: money(week.realized_pnl_usd) },
      { label: 'Win rate', value: pct(month.win_rate) },
      { label: 'Closed trades', value: count(month.closed_trade_count) },
      { label: 'Top coin', value: best ? `${best.coin} ${money(best.realized_pnl_usd)}` : 'none in profit' },
    ],
    paper: null,
    source: NANSEN_SOURCE,
    endpointLine: live ? 'Nansen profiler/perp-pnl-summary, read live' : 'Nansen profiler/perp-pnl-summary',
    scope: `Hyperliquid perpetuals, 30-day window${coverage}`,
    capturedAt: snapshot.retrieved_at,
    // A live read is dated to the minute, because its age is what the gate checks.
    capturedLabel: live ? `${minute(snapshot.retrieved_at)} UTC` : stamp(snapshot.retrieved_at),
    availability,
  };
}

function fomoTruth(record) {
  return {
    kind: 'fomo',
    pnl: record.realized,
    pnlLabel: money(record.realized),
    pnlCaption: `Realised on ${count(record.closedTrades)} sold positions`,
    rows: [
      { label: `Win rate, ${count(record.closedTrades)} sold`, value: pct(record.winRate) },
      { label: 'Fully closed round trips', value: `${count(record.roundTrips)} of ${count(record.closedTrades)}` },
      { label: 'Open positions', value: count(record.openBags) },
      { label: 'Best single exit', value: money(record.bestTrade) },
    ],
    // The three numbers side by side. This is the whole reveal for the Fomo four.
    paper: {
      label: 'Paper, unsold',
      value: money(record.unrealized),
      headlineLabel: 'Fomo profile headline',
      headlineValue: money(record.headline),
      realisedLabel: 'Actually sold',
      realisedValue: money(record.realized),
      line: `Headline ${money(record.headline)}. Actually sold ${money(record.realized)}. Paper ${money(record.unrealized)}, unsold.`,
    },
    basis: record.realizedBasis,
    disclosure: `${count(record.preTape)} positions were bought before this tape starts and are excluded from every figure here. `
      + openBookLine(record),
    source: FOMO_SOURCE,
    endpointLine: FOMO_SOURCE,
    // The realised side is Robinhood Chain and only Robinhood Chain: every closed row
    // in these four responses is a Robinhood fill. The open book is not, so the scope
    // says which half of the screen it covers instead of covering both.
    scope: `Robinhood Chain round trips, observed ${day(record.window.from)} to ${day(record.window.to)}`,
    capturedAt: record.retrievedAt,
    capturedLabel: stamp(record.retrievedAt),
    availability: 'recorded',
  };
}

/**
 * Where the paper figure and the top position actually sit. Fomo marks open positions on
 * chains other than Robinhood, and for frankdegods that is 99% of the paper PnL, so a
 * screen that only says "Robinhood Chain" would be describing a number it does not hold.
 */
function openBookLine(record) {
  // The response leaves a handful of positions without a chain, so they are counted
  // apart rather than swept into the named list or into the off-Robinhood total.
  const unknown = record.openChainsUnknown
    ? ` ${count(record.openChainsUnknown)} ${record.openChainsUnknown === 1 ? 'carries' : 'carry'} no chain in the response.`
    : '';
  const chains = record.openChains.join(', ') || 'Robinhood Chain';
  if (!record.offChainPaper) {
    return `The ${count(record.openBags)} open positions Fomo marks are all on Robinhood Chain.${unknown}`;
  }
  return `The ${count(record.openBags)} open positions Fomo marks span ${chains}, and ${money(record.offChainPaper)} `
    + `of the paper PnL sits off Robinhood Chain.${unknown}`;
}

// ----------------------------------------------------------- the copy risk

/**
 * The evidence BAIT's copy-risk report reads, normalised from whichever venue the
 * prospect trades on. Every field is a number already in the frozen record: nothing is
 * modelled, estimated or fetched.
 */
export function copyRiskEvidence(p) {
  if (p.venue === 'fomo') {
    const r = p.record;
    return {
      address: p.wallet, venue: 'fomo', source: FOMO_SOURCE, retrieved_at: r.retrievedAt,
      window: r.window, window_days: r.windowDays,
      realized_pnl_usd: r.realized,
      unrealized_pnl_usd: r.unrealized,
      headline_pnl_usd: r.headline,
      closed_trade_count: r.closedTrades,
      win_rate: r.winRate,
      realised_series: r.series,
      series_complete: true,
      top_position_share: r.topPositionShare,
      top_position_coin: r.topPositionCoin && r.topPositionChain
        ? `${r.topPositionCoin} on ${r.topPositionChain}` : r.topPositionCoin,
      top_coin_pnl_share: r.topCoinPnlShare,
      top_coin: r.bestTradeCoin,
      worst_trade_usd: r.worstTrade,
      volume_usd: r.volume,
      account_value_usd: r.bookValue || null,
      // Fomo Radar's response carries no token launch times, so the share of entries
      // taken inside a launch window cannot be derived. The report says so rather than
      // guessing at it.
      early_entry_share: null,
    };
  }

  const s = p.snapshot;
  const month = s.pnl_summary_30d;
  const fills = [...(s.trades_30d ?? [])].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const best = bestCoin(month);
  const complete = s.trades_pagination?.is_complete === true;
  // A newest-first first page of a wallet that trades every minute can cover an hour of a
  // 30-day window. Drawdown and the worst trade measured over that are not the window's,
  // so under a week of coverage they are not measured at all rather than footnoted.
  const covered = fills.length > 1 ? Date.parse(fills[fills.length - 1].timestamp) - Date.parse(fills[0].timestamp) : 0;
  const shortTape = !complete && fills.length > 0 && covered < 7 * 86_400_000;
  // A Hyperliquid capture holds the open perp book as an object of asset positions.
  const open = (s.open_positions?.asset_positions ?? []).map(row => row.position ?? {});
  const unrealised = open.reduce((a, o) => a + (Number(o.unrealized_pnl_usd) || 0), 0);
  const notional = open.map(o => Math.abs(Number(o.position_value_usd) || 0));
  const book = notional.reduce((a, b) => a + b, 0);
  return {
    address: p.wallet, venue: 'hyperliquid', source: NANSEN_SOURCE, retrieved_at: s.retrieved_at,
    window: s.windows['30d'], window_days: 30,
    realized_pnl_usd: month.realized_pnl_usd,
    unrealized_pnl_usd: open.length ? unrealised : null,
    headline_pnl_usd: null,
    closed_trade_count: month.closed_trade_count,
    win_rate: month.win_rate,
    realised_series: shortTape ? [] : fills.map(f => Number(f.closed_pnl) || 0),
    series_short: shortTape,
    series_complete: complete,
    series_fills: fills.length,
    // The stretch the held fills actually cover. A first page of 1,000 newest-first
    // fills off a wallet that trades every minute can be 74 minutes of a 30-day window,
    // and anything measured over it has to say so with dates, not just a count.
    series_from: fills.length ? fills[0].timestamp : null,
    series_to: fills.length ? fills[fills.length - 1].timestamp : null,
    top_position_share: book > 0 ? Math.max(...notional) / book : null,
    top_position_coin: book > 0 ? (open[notional.indexOf(Math.max(...notional))]?.token_symbol ?? null) : null,
    top_coin_pnl_share: month.realized_pnl_usd > 0 && best ? best.realized_pnl_usd / month.realized_pnl_usd : null,
    top_coin: best?.coin ?? null,
    worst_trade_usd: fills.length && !shortTape ? Math.min(...fills.map(f => Number(f.closed_pnl) || 0)) : null,
    volume_usd: p.hypeRow?.month_volume_usd ?? null,
    account_value_usd: p.hypeRow?.account_value_usd ?? null,
    early_entry_share: null,
  };
}

/**
 * The report a person reads before copying an address and an agent branches on. The
 * drawdown sentence is rewritten when the capture holds only part of the window's
 * fills, because a drawdown over a truncated tape is not the window's drawdown.
 */
export function copyRiskReport(p) {
  const evidence = copyRiskEvidence(p);
  const report = assessCopyRisk(evidence);
  const short = evidence.series_short === true;
  const partial = !short && evidence.series_complete === false && evidence.series_fills > 0;
  const held = partial && evidence.series_from && evidence.series_to
    ? `the ${count(evidence.series_fills)} fills held in this capture, `
      + `${span(evidence.series_from, evidence.series_to)} of the ${count(evidence.window_days)}-day window `
      + `(${minute(evidence.series_from)} to ${minute(evidence.series_to)} UTC)`
    : `the ${count(evidence.series_fills)} fills held in this capture`;
  const tooFew = `this capture holds only the newest ${count(evidence.series_fills)} of ${count(evidence.closed_trade_count)} closed trades, too few to measure them over ${count(evidence.window_days)} days`;
  const coverage = short
    ? `Drawdown and worst single trade are not assessed: ${tooFew}.`
    : partial
    ? `Drawdown and worst single trade are measured over ${held}, not over the whole window.`
    : evidence.realised_series?.length ? null
      : 'Drawdown is not available: the frozen capture holds no fills for this wallet.';

  return {
    ...report,
    not_assessed: report.not_assessed.map(n => (short && ['max_drawdown', 'tail_loss'].includes(n.id) ? { ...n, reason: tooFew } : n)),
    flags: report.flags.map(f => {
      if (!partial) return f;
      if (f.id === 'max_drawdown') {
        return { ...f, plain: f.plain.replace('from the top of this window.', `from the top of ${held}.`) };
      }
      // The worst single trade comes off the same truncated tape, so it is not the
      // window's worst trade either and must not be presented as one.
      if (f.id === 'tail_loss') {
        return { ...f, plain: f.plain.replace('the worst single closed trade here was', `the worst single closed trade in ${held} was`) };
      }
      return f;
    }),
    coverage,
    source: evidence.source,
    scope: p.venue === 'fomo' ? FOMO_SCOPE : 'Hyperliquid perpetuals',
    capturedLabel: p.snapshot?.source === 'live' && p.snapshot.live_read
      ? `${minute(evidence.retrieved_at)} UTC, read live` : stamp(evidence.retrieved_at),
    windowDays: evidence.window_days,
    basis: p.venue === 'fomo' ? p.record.realizedBasis : 'Nansen 30-day profiler summary',
  };
}

// --------------------------------------------------------------- the loader

/**
 * Load every prospect. A Hyperliquid prospect prefers its real Nansen capture in
 * validation/snapshots/ and falls back to the placeholder, which is labelled as one all
 * the way to the screen. When a real capture lands, only the file changes.
 */
export function loadRoster({
  root = path.resolve(HERE, '..'),
  snapshotDir = path.join(root, 'validation', 'snapshots'),
  fixtureDir = path.join(root, 'prototype', 'fixtures', 'roster-snapshots'),
  fomoDir = path.join(root, 'prototype', 'fixtures', 'fomo'),
  hypeFile = path.join(root, 'prototype', 'fixtures', 'roster-hype.json'),
} = {}) {
  const hypeBody = JSON.parse(fs.readFileSync(hypeFile, 'utf8'));
  const hypeRows = new Map(hypeBody.rows.map(r => [r.wallet.toLowerCase(), { ...r, capturedAt: hypeBody.retrieved_at }]));

  return PROSPECTS.map(p => {
    const venue = VENUES[p.venue];
    const base = {
      id: p.id, name: p.name, handle: p.handle, wallet: p.wallet, short: short(p.wallet),
      venue: p.venue, venueLabel: venue.label, chain: venue.chain,
      accent: p.accent, portrait: p.portrait, voice: p.voice,
    };

    if (p.venue === 'fomo') {
      const record = readFomo(path.join(fomoDir, `${p.handle}.json`));
      const loaded = {
        ...base,
        hypeRow: null,
        hype: {
          value: money(record.headline),
          caption: 'Fomo profile headline',
          sub: `${count(record.followers)} followers`,
          source: `${FOMO_SOURCE}, ${stamp(record.retrievedAt)}`,
        },
        truth: fomoTruth(record),
        truthAvailable: 'recorded',
        dossier: fomoDossier(record),
        record,
        snapshot: null,
        // What the claim checker is allowed to treat as known. Named for the window it
        // actually covers, so nothing in the prompt calls a 38-day tape a 30-day one.
        checkerData: {
          wallet: record.address,
          retrieved_at: record.retrievedAt,
          pnl_summary_30d: {
            window_days: record.windowDays,
            window: record.window,
            realized_pnl_usd: record.realized,
            realized_basis: record.realizedBasis,
            unrealized_pnl_usd: record.unrealized,
            win_rate: record.winRate,
            closed_trade_count: record.closedTrades,
            fully_closed_round_trip_count: record.roundTrips,
            winning_trade_count: record.wins,
            open_position_count: record.openBags,
            positions_bought_before_window: record.preTape,
            best_closed_trade_usd: record.bestTrade,
            worst_closed_trade_usd: record.worstTrade,
            volume_usd: record.volume,
            open_book_chains: record.openChains,
            unrealized_pnl_off_robinhood_usd: record.offChainPaper,
            follower_count: record.followers,
            profile_headline_pnl_usd: record.headline,
            source: FOMO_SOURCE,
            scope: FOMO_SCOPE,
          },
          pnl_summary_7d: null,
        },
        desk: {
          name: 'meridian', policy: null, tools: ['check_fomo_record'],
          nansen: { endpoints: [FOMO_SOURCE], windows: [], live: false },
        },
        executor: fomoExecutor(record),
        guardPolicy: {
          ...BENCHMARK_GUARD_POLICY,
          id: `wallet-realized-pnl-${record.windowDays}d-fomo-recorded-v1`,
          windowDays: record.windowDays,
          source: FOMO_SOURCE,
        },
        checkerNote:
          `The observed window for this trader is ${record.windowDays} days of Robinhood Chain fills, ` +
          `not 30 days. Realised PnL here means the sum of the ${record.closedTrades} sold positions ` +
          `only, of which ${record.roundTrips} were sold in full, and unrealised PnL is not realised ` +
          'PnL. A claim that mixes the two is unsupported, and so is a claim that all of the open ' +
          'positions are on Robinhood Chain.',
      };
      const risk = copyRiskReport(loaded);
      return { ...loaded, risk, gateExpected: risk.verdict };
    }

    const real = findSnapshot(snapshotDir, p.wallet);
    const snapshot = declareCoverage(JSON.parse(
      fs.readFileSync(real ?? path.join(fixtureDir, `${p.wallet}.json`), 'utf8'),
    ));
    const hype = hypeRows.get(p.wallet.toLowerCase());
    const availability = snapshot.fixture === true ? 'fixture' : 'capture';
    const week = snapshot.pnl_summary_7d;

    const headline = {
      all_time: { value: money(hype.all_time_pnl_usd), caption: 'all time', sub: `${plain(hype.account_value_usd)} account` },
      month: { value: money(hype.month_pnl_usd), caption: '30 days', sub: `${money(hype.all_time_pnl_usd)} all time` },
      week: { value: money(hype.week_pnl_usd), caption: '7 days', sub: `${money(hype.all_time_pnl_usd)} all time` },
      week_streak: { value: money(week.realized_pnl_usd), caption: '7 days', sub: `${pct(week.win_rate)} win rate` },
    }[p.hypeKind];

    const loaded = {
      ...base,
      hypeRow: hype,
      hype: {
        ...headline,
        source: p.hypeKind === 'week_streak'
          ? `Nansen 7-day window, ${stamp(snapshot.retrieved_at)}`
          : `Public Hyperliquid leaderboard, ${stamp(hype.capturedAt)}`,
      },
      truth: hyperliquidTruth(snapshot, availability),
      truthAvailable: availability,
      dossier: hyperliquidDossier(snapshot, hype),
      record: null,
      snapshot,
      checkerData: snapshot,
      live: p.live === true,
      desk: {
        name: 'meridian', policy: null,
        // The control wallet's capture holds no fills, so the trade tool is not offered
        // for it. A tool that can only answer with zeros is worse than no tool.
        tools: p.tools ?? ['check_pnl', 'inspect_trades'],
        nansen: {
          endpoints: (p.tools ?? ['check_pnl', 'inspect_trades']).includes('inspect_trades')
            ? ['profiler/perp-pnl-summary', 'profiler/perp-trades']
            : ['profiler/perp-pnl-summary'],
          windows: [7, 30], live: false,
        },
      },
      executor: null,
      guardPolicy: BENCHMARK_GUARD_POLICY_V3,
      checkerNote: null,
    };
    const risk = copyRiskReport(loaded);
    return { ...loaded, risk, gateExpected: risk.verdict };
  });
}

/**
 * Rebuild one Hyperliquid prospect against a different snapshot, so a round played on
 * a live refresh shows the refreshed numbers rather than the numbers on disk at boot.
 * A Fomo prospect has no live path and is returned unchanged.
 */
export function refreshProspect(p, snapshot) {
  if (p.venue !== 'hyperliquid' || !snapshot || snapshot === p.snapshot) return p;
  const declared = declareCoverage(snapshot);
  const availability = declared.source === 'live' && declared.live_read ? 'live'
    : declared.fixture === true ? 'fixture' : 'capture';
  const next = {
    ...p,
    snapshot: declared,
    checkerData: declared,
    dossier: hyperliquidDossier(declared, p.hypeRow),
    truth: hyperliquidTruth(declared, availability),
    truthAvailable: availability,
  };
  const risk = copyRiskReport(next);
  return { ...next, risk, gateExpected: risk.verdict };
}

/**
 * The tile. Hype only: no realised PnL, no win rate, no endpoint, no verdict. The truth
 * and the copy-risk report are served after the pick.
 */
export function rosterTile(p) {
  return {
    id: p.id, name: p.name, handle: p.handle, short: p.short,
    venue: p.venue, venueLabel: p.venueLabel, chain: p.chain,
    accent: p.accent, portrait: p.portrait, voice: p.voice,
    hype: p.hype,
    truth_available: p.truthAvailable,
  };
}

/** What the page may see about a prospect once the round has started. */
export function prospectPublic(p) {
  return {
    ...rosterTile(p),
    truth: p.truth,
    risk: p.risk,
    gateExpected: p.gateExpected,
  };
}

/** Find one prospect by address or public handle, for the assess route and the CLI. */
export function findProspect(roster, query) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return null;
  return roster.find(p =>
    p.wallet.toLowerCase() === q ||
    p.id.toLowerCase() === q ||
    String(p.handle ?? '').toLowerCase() === q) ?? null;
}
