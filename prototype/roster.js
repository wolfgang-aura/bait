/**
 * The Pitch Room roster: five real public Hyperliquid traders, every one with a Nansen record.
 *
 * A tile shows only what the trader publishes about themselves. The truth behind it is
 * served after the pick, never before, so the hype cannot be cross checked from the
 * roster call. Every truth number carries its source, its window and its capture date.
 *
 * Three sources, kept apart on purpose:
 *   - hype, Hyperliquid: the free public leaderboard rows saved in
 *     prototype/fixtures/roster-hype.json.
 *   - truth, Hyperliquid: a Nansen snapshot in validation/snapshots/ when one exists, or a
 *     saved live room read frozen into prototype/fixtures/frozen-reads/, otherwise the
 *     placeholder in prototype/fixtures/roster-snapshots/, which is
 *     labelled as a fixture everywhere it is shown. Nothing in this file calls Nansen.
 *   The four Fomo Radar prospects that used to share the roster were removed on
 *   23 Sep 2026: they had no Nansen record, so the gate could not read them.
 *
 * Two rules this file exists to keep:
 *
 * 1. The roster is an unranked lineup. It is never sorted or numbered by PnL and it is
 *    never called a leaderboard, because Nansen allows per wallet PnL but not public
 *    PnL leaderboards.
 * 2. Realised means sold: every truth figure is the Nansen summary's realised PnL.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BENCHMARK_GUARD_POLICY_V5, assessCopyRisk } from '../validation/guard.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

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
export const spanText = (from, to) => span(new Date(from).toISOString(), new Date(to).toISOString());
function span(fromIso, toIso) {
  const minutes = Math.max(0, Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 60_000));
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  if (minutes < 60 * 48) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${h} hour${h === 1 ? '' : 's'}${m ? ` ${m} minutes` : ''}`;
  }
  const d = Math.round(minutes / 1440);
  return `${d} days`;
}
// Capture dates are printed in UTC and say so, because the same instant is a different
// calendar day in the founder's timezone and a date without a zone invites that argument.
const stamp = iso => `${day(iso)} UTC`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayMonth = iso => { const d = new Date(iso); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };

/**
 * The lineup. Numbers live in the evidence files, not here: this table carries only
 * identity, venue, the accent colour the screen paints the tile with, and the portrait
 * the page draws. `voice` is the one line the tile says on hover, and every figure one of
 * them names is asserted against the loaded record by prototype/roster.test.js.
 */
export const PROSPECTS = [
  // A live-market wallet from the field test (bench/FIELD.md, leaderboard rank 195): its own
  // record passes the PnL rule and gate v4 in full; only v5's owner check (operator_record)
  // blocks it. Its frozen record is a saved live read, replayed (prototype/frozen-read.js).
  // No leaderboard row: the brag is Nansen's own 7-day window. First on the roster and focused on
  // load, marked "start here" (judge 3): a judge's first round lands on the owner reveal.
  {
    id: 'steadyhand', venue: 'hyperliquid', wallet: '0x20438cfdd36d75e185d6601697eb1973f4aee79d',
    name: 'THE STEADY HAND', handle: null, accent: '#B9A3E3', portrait: 'monk',
    hypeKind: 'week_streak', live: true, start: true,
    voice: 'A hundred and ninety grand this week. Nothing flashy, just steady.',
  },
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
    // Its brag is a dated past week, never "last week": a live read on 25 Sep 12:26 UTC
    // (bench/live-reads/20260925T122635Z-0xc26cbb64.json) found 0 closed trades in the 7 days before
    // it, the newest fill on 17 Sep, so the tile names the week it means.
    hypeKind: 'best_week', live: true,
    voice: 'My best week: four hundred and twenty four trades. Every one green.',
  },
];

export const VENUES = {
  hyperliquid: { id: 'hyperliquid', label: 'Hyperliquid', chain: 'Hyperliquid' },
};

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
    ? snapshot.live_read.fills_live
      ? (fillsHeld ? `; summaries and ${count(fillsHeld)} newest fills read live` : '; summaries read live; no closed fills in the window')
      : `; summaries read live, ${fillsHeld ? `trade fills from the ${stamp(snapshot.live_read.fills_from_capture)} capture` : 'no trade fills held'}`
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
      // Over 100,000 closed trades in 30 days is a machine's pace, not a person copying ideas.
      ...(month.closed_trade_count > 100_000 ? [{ label: 'Account type', value: 'high-frequency account' }] : []),
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

// ----------------------------------------------------------- the copy risk

/**
 * The evidence BAIT's copy-risk report reads, normalised from whichever venue the
 * prospect trades on. Every field is a number already in the frozen record: nothing is
 * modelled, estimated or fetched.
 */
/**
 * How old the fill tape may be, measured against the summary read the decision stands on,
 * before anything computed from it (drawdown, worst single trade) is kept out of the
 * report's verdict. A live round reads the summaries live but its tape is the capture's;
 * past a day the two describe different months, so the tape is shown but not used.
 */
export const TAPE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** When the tape was captured and how far behind the summaries it is. No credits. */
export function tapeRecency(s) {
  const capturedAt = s?.fills_coverage?.from_capture ?? s?.retrieved_at ?? null;
  const readAt = s?.retrieved_at ?? null;
  const ageMs = Date.parse(readAt ?? '') - Date.parse(capturedAt ?? '');
  const known = Number.isFinite(ageMs);
  return { capturedAt, readAt, ageMs: known ? Math.max(0, ageMs) : null, maxAgeMs: TAPE_MAX_AGE_MS,
    stale: !known || ageMs > TAPE_MAX_AGE_MS };
}

export function copyRiskEvidence(p) {
  const s = p.snapshot;
  const tape = tapeRecency(s);
  const month = s.pnl_summary_30d;
  const fills = [...(s.trades_30d ?? [])].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const best = bestCoin(month);
  const complete = s.trades_pagination?.is_complete === true;
  // A newest-first first page of a wallet that trades every minute can cover an hour of a
  // 30-day window. Drawdown and the worst trade measured over that are not the window's,
  // so under a week of coverage they are not measured at all rather than footnoted.
  const covered = fills.length > 1 ? Date.parse(fills[fills.length - 1].timestamp) - Date.parse(fills[0].timestamp) : 0;
  // A live tape (round 11) is measured whatever it covers, and every sentence names the
  // stretch it covers; a capture's short first page is still not measured.
  // Round 16: live or captured, a partial tape covering under a week is too short to judge.
  const shortTape = !complete && fills.length > 0 && covered < 7 * 86_400_000;
  // A tape too far behind the summaries is not measured at all: its drawdown and worst
  // trade are a different stretch of time from the record the decision reads.
  const unusable = shortTape || (fills.length > 0 && tape.stale);
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
    realised_series: unusable ? [] : fills.map(f => Number(f.closed_pnl) || 0),
    series_short: shortTape,
    tape,
    tape_stale: fills.length > 0 && tape.stale,
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
    worst_trade_usd: fills.length && !unusable ? Math.min(...fills.map(f => Number(f.closed_pnl) || 0)) : null,
    volume_usd: p.hypeRow?.month_volume_usd ?? null,
    // Round 17: Nansen's own account value (profiler/perp-positions) when the record holds it.
    account_value_usd: Number.isFinite(Number(p.snapshot?.open_positions?.margin_summary_account_value_usd)) ? Number(p.snapshot.open_positions.margin_summary_account_value_usd) : (p.hypeRow?.account_value_usd ?? null),
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
    ? `the ${count(evidence.series_fills)} fills ${p.snapshot?.live_read?.fills_live ? "read live" : "held in this capture"}, `
      + `${span(evidence.series_from, evidence.series_to)} of the ${count(evidence.window_days)}-day window `
      + `(${minute(evidence.series_from)} to ${minute(evidence.series_to)} UTC)`
    : `the ${count(evidence.series_fills)} fills ${p.snapshot?.live_read?.fills_live ? "read live" : "held in this capture"}`;
  const tooFew = evidence.series_from && evidence.series_to
    ? `the newest ${count(evidence.series_fills)} fills cover only ${span(evidence.series_from, evidence.series_to)}, too short to judge`
    : `this capture holds only the newest ${count(evidence.series_fills)} of ${count(evidence.closed_trade_count)} closed trades, too few to measure them over ${count(evidence.window_days)} days`;
  const stale = evidence.tape_stale === true;
  const days = evidence.tape.ageMs === null ? 'an unknown time' : `${(evidence.tape.ageMs / 86_400_000).toFixed(1)} days`;
  const staleWhy = `the trade fills are the ${stamp(evidence.tape.capturedAt)} capture, ${days} older than the summaries this record reads (limit ${evidence.tape.maxAgeMs / 3_600_000} h), so nothing measured on them is used`;
  const coverage = stale
    ? `Drawdown and worst single trade are not assessed: ${staleWhy}.`
    : short
    ? `Drawdown and worst single trade are not assessed: ${tooFew}.`
    : partial
    ? `Drawdown and worst single trade are measured over ${held}, not over the whole window.`
    : evidence.realised_series?.length ? null
      : 'Drawdown is not available: the frozen capture holds no fills for this wallet.';

  return {
    ...report,
    not_assessed: report.not_assessed.map(n => (['max_drawdown', 'tail_loss'].includes(n.id) && (stale || short) ? { ...n, reason: stale ? staleWhy : tooFew } : n)),
    tape: { ...evidence.tape, stale: evidence.tape_stale === true },
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
    scope: 'Hyperliquid perpetuals',
    capturedLabel: p.snapshot?.source === 'live' && p.snapshot.live_read
      ? `${minute(evidence.retrieved_at)} UTC, read live` : stamp(evidence.retrieved_at),
    windowDays: evidence.window_days,
    basis: 'Nansen 30-day profiler summary',
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
  // A saved live room read frozen into a capture (prototype/frozen-read.js), with its v4 and v5 reads.
  frozenReadDir = path.join(root, 'prototype', 'fixtures', 'frozen-reads'),
  hypeFile = path.join(root, 'prototype', 'fixtures', 'roster-hype.json'),
} = {}) {
  const hypeBody = JSON.parse(fs.readFileSync(hypeFile, 'utf8'));
  const hypeRows = new Map(hypeBody.rows.map(r => [r.wallet.toLowerCase(), { ...r, capturedAt: hypeBody.retrieved_at }]));

  return PROSPECTS.map(p => {
    const venue = VENUES[p.venue];
    const base = {
      id: p.id, name: p.name, handle: p.handle, wallet: p.wallet, short: short(p.wallet),
      venue: p.venue, venueLabel: venue.label, chain: venue.chain,
      accent: p.accent, portrait: p.portrait, voice: p.voice, start: p.start === true,
    };

    const real = findSnapshot(snapshotDir, p.wallet) ?? findSnapshot(frozenReadDir, p.wallet);
    const snapshot = declareCoverage(JSON.parse(
      fs.readFileSync(real ?? path.join(fixtureDir, `${p.wallet}.json`), 'utf8'),
    ));
    const hype = hypeRows.get(p.wallet.toLowerCase());
    const availability = snapshot.fixture === true ? 'fixture' : 'capture';
    const week = snapshot.pnl_summary_7d;

    // Built for the prospect's own kind only: a Nansen-only brag has no leaderboard row.
    const headline = {
      all_time: () => ({ value: money(hype.all_time_pnl_usd), caption: 'all time', sub: `${plain(hype.account_value_usd)} account` }),
      month: () => ({ value: money(hype.month_pnl_usd), caption: '30 days', sub: `${money(hype.all_time_pnl_usd)} all time` }),
      week: () => ({ value: money(hype.week_pnl_usd), caption: '7 days', sub: `${money(hype.all_time_pnl_usd)} all time` }),
      week_streak: () => ({ value: money(week.realized_pnl_usd), caption: '7 days', sub: `${pct(week.win_rate)} win rate` }),
      best_week: () => ({ value: money(week.realized_pnl_usd), caption: `week to ${dayMonth(snapshot.windows['7d'].to)}`, sub: `${pct(week.win_rate)} win rate` }),
    }[p.hypeKind]();
    const fromNansen = p.hypeKind === 'week_streak' || p.hypeKind === 'best_week';

    const loaded = {
      ...base,
      hypeRow: hype ?? null,
      hype: {
        ...headline,
        source: fromNansen
          ? `Nansen 7-day window${p.hypeKind === 'best_week' ? ' to' : ','} ${stamp(snapshot.retrieved_at)}`
          : `Public Hyperliquid leaderboard, ${stamp(hype.capturedAt)}`,
        // The tile's figure and the record behind it are dated apart, because they are
        // read on different days: the leaderboard row and the Nansen capture.
        hypeDate: day(fromNansen ? snapshot.retrieved_at : hype.capturedAt),
        recordDate: day(snapshot.retrieved_at),
        hypeFrom: fromNansen ? 'Nansen' : 'leaderboard',
      },
      truth: hyperliquidTruth(snapshot, availability),
      truthAvailable: availability,
      dossier: hyperliquidDossier(snapshot, hype),
      record: null,
      snapshot,
      checkerData: snapshot,
      live: p.live === true,
      desk: {
        name: 'penny', policy: null,
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
      guardPolicy: BENCHMARK_GUARD_POLICY_V5,
      checkerNote: null,
    };
    const risk = copyRiskReport(loaded);
    return { ...loaded, risk, gateExpected: risk.verdict };
  });
}

/**
 * Rebuild one Hyperliquid prospect against a different snapshot, so a round played on
 * a live refresh shows the refreshed numbers rather than the numbers on disk at boot.
 * Every prospect is Hyperliquid; anything else is returned unchanged.
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

/** A Hyperliquid address, and nothing else. */
export const WALLET_PATTERN = /^0x[0-9a-fA-F]{40}$/;

/**
 * A wallet the player pasted, as a prospect. Built from one live read with the same
 * dossier, truth and report code as the four on the roster. There is no leaderboard row
 * and no fill tape: the hype is the best flattering fact the read holds, and the tape
 * checks say they are not assessed.
 */
export function walletProspect(walletInput, snapshot) {
  const wallet = String(walletInput).toLowerCase();
  const declared = { ...snapshot, trades_30d: snapshot.trades_30d ?? [], trades_pagination: { is_complete: true, ...(snapshot.trades_pagination ?? {}) } };
  const dossier = hyperliquidDossier(declared, null);
  const week = declared.pnl_summary_7d;
  const best = bestCoin(declared.pnl_summary_30d);
  const hype = week.realized_pnl_usd > 0
    ? { value: money(week.realized_pnl_usd), caption: '7 days', sub: 'Nansen, read live' }
    : best && best.realized_pnl_usd > 0
      ? { value: money(best.realized_pnl_usd), caption: `${best.coin}, 30 days`, sub: 'Nansen, read live' }
      : { value: 'no brag', caption: 'nothing flattering in the record', sub: 'Nansen, read live' };
  const base = {
    id: `wallet-${wallet}`, name: short(wallet), handle: null, wallet, short: short(wallet),
    venue: 'hyperliquid', venueLabel: VENUES.hyperliquid.label, chain: VENUES.hyperliquid.chain,
    accent: '#9AA2AD', portrait: 'nicecat', voice: null,
    hypeRow: null,
    hype: { ...hype, source: `Nansen live read, ${stamp(declared.retrieved_at)}`,
      hypeDate: day(declared.retrieved_at), recordDate: day(declared.retrieved_at), hypeFrom: 'Nansen' },
    truth: hyperliquidTruth(declared, 'live'),
    truthAvailable: 'live',
    dossier,
    record: null,
    snapshot: declared,
    checkerData: declared,
    live: true,
    pasted: true,
    desk: { name: 'penny', policy: null, tools: ['check_pnl'], nansen: { endpoints: ['profiler/perp-pnl-summary'], windows: [7, 30], live: true } },
    executor: null,
    guardPolicy: BENCHMARK_GUARD_POLICY_V5,
    checkerNote: null,
  };
  const risk = copyRiskReport(base);
  return { ...base, risk, gateExpected: risk.verdict };
}

/**
 * The tile. Hype only: no realised PnL, no win rate, no endpoint, no verdict. The truth
 * and the copy-risk report are served after the pick.
 */
export function rosterTile(p) {
  const closed = p.snapshot?.pnl_summary_30d?.closed_trade_count ?? 0;
  return {
    // Said on the card rather than hidden (round 14): more than 100,000 closed trades in
    // 30 days is a high-frequency account.
    note: closed > 100_000 ? 'high-frequency account' : null,
    id: p.id, name: p.name, handle: p.handle, short: p.short,
    venue: p.venue, venueLabel: p.venueLabel, chain: p.chain,
    accent: p.accent, portrait: p.portrait, voice: p.voice,
    start: p.start === true,
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
