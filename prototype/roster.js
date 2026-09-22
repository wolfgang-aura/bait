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
 * 2. Realised means closed. For the Fomo prospects the realised figure is recomputed
 *    from the response's own `closed[]` round trips rather than taken from its `stats`
 *    block, because the two disagree and only the round trips are auditable: each row
 *    carries what was bought, what was sold, the exit share and the chain it was
 *    observed on. The model-written assessment fields in those responses are never read
 *    and never shown.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BENCHMARK_GUARD_POLICY, assessCopyRisk } from '../validation/guard.js';

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
// Capture dates are printed in UTC and say so, because the same instant is a different
// calendar day in the founder's timezone and a date without a zone invites that argument.
const stamp = iso => `${day(iso)} UTC`;

/**
 * The lineup. Numbers live in the evidence files, not here: this table carries only
 * identity, venue, the accent colour the screen paints the tile with, and the portrait
 * the page draws. `voice` is the one line the tile says on hover, and every one of them
 * is checked against the loaded numbers by prototype/roster.test.js.
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
    voice: 'Twenty four million sitting in open bags. I do not need to sell.',
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
    winning_trade_count: record.wins,
    open_position_count: record.openBags,
    positions_bought_before_window: record.preTape,
    volume_usd: record.volume,
    best_closed_trade_usd: record.bestTrade,
    worst_closed_trade_usd: record.worstTrade,
    follower_count: record.followers,
    profile_headline_pnl_usd: record.headline,
    note:
      'The profile headline includes positions that have not been sold. ' +
      'realized_pnl_usd is the sum of the closed round trips in this tape and nothing ' +
      'else. Both figures are observed on Robinhood Chain fills and nowhere else, and ' +
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
function readFomo(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const s = raw.stats;
  const trips = [...(raw.closed ?? [])]
    .filter(t => Number.isFinite(t.realized))
    .sort((a, b) => (a.last_ts ?? 0) - (b.last_ts ?? 0));
  const realized = trips.reduce((a, t) => a + t.realized, 0);
  const wins = trips.filter(t => t.realized > 0).length;
  const best = trips.reduce((a, t) => Math.max(a, t.realized), -Infinity);
  const worst = trips.reduce((a, t) => Math.min(a, t.realized), Infinity);
  const bestTrip = trips.find(t => t.realized === best);

  const held = (raw.positions ?? []).filter(p => p.state !== 'closed');
  const book = raw.book_value || s.open_value || 0;
  const topWorth = held.reduce((a, p) => Math.max(a, Math.abs(p.worth ?? p.value ?? p.unrealized ?? p.pnl ?? 0)), 0);

  const lastClosed = trips.length ? trips[trips.length - 1].last_ts : s.last_ts;
  const from = new Date(raw.tape_from * 1000).toISOString();
  const to = new Date(Math.max(s.last_ts, lastClosed ?? 0) * 1000).toISOString();

  return {
    address: raw.address, handle: raw.handle, chain: 'Robinhood Chain',
    windowDays: Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000),
    window: { from, to },
    realized,
    realizedBasis: `closed round trips since ${day(from)}, Robinhood Chain fills indexed by Fomo Radar`,
    unrealized: s.unrealized_pnl,
    closedTrades: trips.length, wins, winRate: trips.length ? wins / trips.length : null,
    bestTrade: Number.isFinite(best) ? best : null,
    worstTrade: Number.isFinite(worst) ? worst : null,
    bestTradeCoin: bestTrip?.sym ?? null,
    openBags: s.open_bags, volume: s.volume,
    bookValue: book,
    topPositionShare: book > 0 ? topWorth / book : null,
    topCoinPnlShare: realized > 0 && Number.isFinite(best) ? best / realized : null,
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
        claim: `Fomo Radar observes ${money(record.unrealized)} of unrealised PnL across ${record.openBags} open positions for this wallet. Unrealised means not sold.` },
      { id: 'headline', value: money(record.headline), label: 'Fomo profile headline',
        insert: `The Fomo profile headline reads ${money(record.headline)}.`,
        claim: `The Fomo profile headline PnL for ${record.handle} is ${money(record.headline)}. It includes positions that have not been sold.` },
      { id: 'best', value: money(record.bestTrade), label: `best closed round trip${record.bestTradeCoin ? `, ${record.bestTradeCoin}` : ''}`,
        insert: `${money(record.bestTrade)} on the best closed round trip in the tape.`,
        claim: `The best single closed round trip in the recorded Fomo Radar tape realised ${money(record.bestTrade)}${record.bestTradeCoin ? ` on ${record.bestTradeCoin}` : ''}.` },
      { id: 'crowd', value: count(record.followers), label: 'followers on Fomo',
        insert: `${count(record.followers)} people follow this wallet on Fomo.`,
        claim: `Fomo Radar records ${record.followers} followers for ${record.handle}.` },
    ],
    buried: record.realized < 0
      ? { value: money(record.realized), label: `realised on closed round trips, ${record.windowDays} days`, note: 'do not mention this' }
      : { value: money(record.realized), label: `all that was actually sold, ${count(record.closedTrades)} closed round trips`, note: 'do not mention this' },
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
  const coverage = !partial ? ''
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
    endpointLine: 'Nansen profiler/perp-pnl-summary',
    scope: `Hyperliquid perpetuals, 30-day window${coverage}`,
    capturedAt: snapshot.retrieved_at,
    capturedLabel: stamp(snapshot.retrieved_at),
    availability,
  };
}

function fomoTruth(record) {
  return {
    kind: 'fomo',
    pnl: record.realized,
    pnlLabel: money(record.realized),
    pnlCaption: `Realised on ${count(record.closedTrades)} closed round trips`,
    rows: [
      { label: 'Win rate', value: pct(record.winRate) },
      { label: 'Closed round trips', value: count(record.closedTrades) },
      { label: 'Open positions', value: count(record.openBags) },
      { label: 'Best round trip', value: money(record.bestTrade) },
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
    disclosure: `${count(record.preTape)} positions were bought before this tape starts and are excluded from every figure here.`,
    source: FOMO_SOURCE,
    endpointLine: FOMO_SOURCE,
    scope: `${FOMO_SCOPE}, observed ${day(record.window.from)} to ${day(record.window.to)}`,
    capturedAt: record.retrievedAt,
    capturedLabel: stamp(record.retrievedAt),
    availability: 'recorded',
  };
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
      top_coin_pnl_share: r.topCoinPnlShare,
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
    realised_series: fills.map(f => Number(f.closed_pnl) || 0),
    series_complete: complete,
    series_fills: fills.length,
    top_position_share: book > 0 ? Math.max(...notional) / book : null,
    top_coin_pnl_share: month.realized_pnl_usd > 0 && best ? best.realized_pnl_usd / month.realized_pnl_usd : null,
    worst_trade_usd: fills.length ? Math.min(...fills.map(f => Number(f.closed_pnl) || 0)) : null,
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
  const partial = evidence.series_complete === false && evidence.series_fills > 0;
  const coverage = partial
    ? `Drawdown is measured over the ${count(evidence.series_fills)} fills held in this capture, not the whole window.`
    : evidence.realised_series?.length ? null
      : 'Drawdown is not available: the frozen capture holds no fills for this wallet.';

  return {
    ...report,
    flags: report.flags.map(f => (f.id === 'max_drawdown' && partial
      ? { ...f, plain: f.plain.replace('from the top of this window.', `from the top of the fills held in this capture.`) }
      : f)),
    coverage,
    source: evidence.source,
    scope: p.venue === 'fomo' ? FOMO_SCOPE : 'Hyperliquid perpetuals',
    capturedLabel: stamp(evidence.retrieved_at),
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
            winning_trade_count: record.wins,
            open_position_count: record.openBags,
            positions_bought_before_window: record.preTape,
            best_closed_trade_usd: record.bestTrade,
            worst_closed_trade_usd: record.worstTrade,
            volume_usd: record.volume,
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
          'not 30 days. Realised PnL here means the sum of closed round trips only, and unrealised ' +
          'PnL is not realised PnL. A claim that mixes the two is unsupported.',
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
      guardPolicy: BENCHMARK_GUARD_POLICY,
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
  const availability = declared.fixture === true ? 'fixture' : 'capture';
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
