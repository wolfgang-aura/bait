/**
 * The cold open: "Who is the best trader here?"
 *
 * Seven Fomo (Robinhood Chain) handles, shown first exactly as Fomo shows them, which is
 * a handle, a follower count and one profile headline PnL. The player picks one. Then
 * every card flips to what the recorded tape says, ranked by realised PnL on the
 * positions that were actually sold.
 *
 * Three rules this file exists to keep:
 *
 * 1. Every figure comes out of `closed[]` and `positions[]` in the recorded response,
 *    through the same `readFomo` the roster uses. The `stats` block disagrees with its
 *    own tape and is never read, and neither are the model-written `summary`, `score`,
 *    `status` and `red_flags` fields.
 * 2. The hard-truth line is generated from those numbers here, by code. Nobody types a
 *    sentence about a trader, so nobody can type one the tape does not support.
 * 3. Realised means sold. A trader with fewer than twenty sold positions is labelled a
 *    thin sample and is never called the best, however large the number is, and a tie at
 *    the top is labelled the same way rather than broken arbitrarily.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COPY_RISK_THRESHOLDS } from '../validation/guard.js';
import { readFomo, copyRiskReport, FOMO_SOURCE } from './roster.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * The lineup, in the order the pick screen shows it: most followed first. That is the
 * order Fomo itself sorts by and it is deliberately not an order by PnL, which is the
 * one thing this project does not publish.
 *
 * The founder asked for frankdegods, orangie, unipcs, dumbcrayoneater, pointfarmcap,
 * minhxdynasty and rasmr_eth. `pointfarmcap` and `rasmr_eth` are not indexed by Fomo
 * Radar (404) and `MINHxDYNASTY` answers 200 with an empty `closed[]` and `positions[]`,
 * so it has no tape to reveal. The three open slots went to the most followed handles
 * that do carry a usable tape.
 */
export const OPENER_HANDLES = [
  'unipcs',
  'dumbcrayoneater',
  'frankdegods',
  'orangie',
  'theveeman',
  'econoar',
  'notanicecat69',
];

/** Fewer sold positions than this and the tape cannot say whether it was skill. */
export const MIN_SOLD_TO_RANK = COPY_RISK_THRESHOLDS.minClosedTrades;

export const OPENER_SCOPE = 'Robinhood Chain round trips';
export const OPENER_QUESTION = 'Who is the best trader here?';
export const OPENER_PUNCHLINE = 'You picked by the headline. So does an AI desk.';

const money = n => `${n < 0 ? '-' : '+'}$${Math.round(Math.abs(n)).toLocaleString('en-US')}`;
const plain = n => `$${Math.round(Math.abs(n)).toLocaleString('en-US')}`;
const count = n => Math.round(n).toLocaleString('en-US');
const pct = n => `${(n * 100).toFixed(n === 1 ? 0 : 1)}%`;
const day = iso => new Date(iso).toISOString().slice(0, 10);

/**
 * One hard truth per trader, in the order a reader would care about it. The first rule
 * that fires wins, so the line names the worst thing the tape actually says rather than
 * the first thing that happens to be true.
 *
 * `paper_headline`, `concentration` and `low_win_rate` are taken from BAIT's own
 * copy-risk report, so the thresholds behind them are the shipped ones rather than a
 * second set invented for this screen.
 */
export function hardTruth(record, risk) {
  const flag = id => risk.flags.find(f => f.id === id) ?? null;
  const sold = record.closedTrades;

  if (sold === 0) {
    return {
      id: 'no_round_trips',
      label: 'no round trips',
      line: `Nothing on this tape has ever been sold. ${count(record.openBags)} open positions and `
        + `zero round trips, so there is no realised record to rank at all.`,
    };
  }

  if (sold < MIN_SOLD_TO_RANK) {
    return {
      id: 'thin_sample',
      label: 'thin sample',
      line: `Only ${count(sold)} position${sold === 1 ? ' has' : 's have'} ever been sold. `
        + `${money(record.unrealized)} of the headline is still open and unsold.`,
    };
  }

  if (record.realized < 0) {
    // When the win rate is also under BAIT's bar, the loss has a shape worth naming: it
    // is not one bad exit, it is most of them.
    const alsoLosing = flag('low_win_rate')
      ? ` Only ${pct(record.winRate)} of them made money.`
      : '';
    return {
      id: 'realised_loss',
      label: 'realised loss',
      line: `${count(sold)} sold positions came to ${money(record.realized)} against a `
        + `${money(record.headline)} headline.${alsoLosing}`,
    };
  }

  if (flag('paper_headline')) {
    return {
      id: 'paper_headline',
      label: 'paper headline',
      line: `${plain(record.unrealized)} sits unsold in ${count(record.openBags)} open `
        + `positions, against ${money(record.realized)} realised.`,
    };
  }

  if (flag('concentration') && record.topPositionShare !== null) {
    const bag = record.topPositionCoin && record.topPositionChain
      ? `${record.topPositionCoin} on ${record.topPositionChain}`
      : record.topPositionCoin ?? 'one position';
    return {
      id: 'concentration',
      label: 'one bag decides it',
      line: `${bag} is ${pct(record.topPositionShare)} of the ${plain(record.bookValue)} `
        + `still open, so one bag decides it.`,
    };
  }

  if (flag('low_win_rate')) {
    return {
      id: 'low_win_rate',
      label: 'low win rate',
      line: `Only ${pct(record.winRate)} of ${count(sold)} sold positions made money.`,
    };
  }

  // Nothing above fired, which still leaves the gap the whole screen is about: the
  // headline counts positions nobody has sold.
  return {
    id: 'headline_is_not_realised',
    label: 'headline is not realised',
    line: `The headline reads ${money(record.headline)}. What was actually sold across `
      + `${count(sold)} positions is ${money(record.realized)}.`,
  };
}

/**
 * The line under the reveal, which has to answer the player rather than lecture them.
 *
 * A player who picked the one tape that actually sells at a profit is told so, and then
 * told the one thing still wrong with it, in that trader's own generated hard truth. A
 * player who picked on the headline gets the point of the screen and the name of the
 * tape that did hold up. Neither branch is typed per trader.
 */
export function punchlineFor(traders, bestHandle, handle) {
  const best = traders.find(t => t.handle === bestHandle) ?? null;
  const picked = traders.find(t => t.handle === handle) ?? null;

  // `lead` is the sentence the screen sets large and `tail` is the qualifier under it.
  // `line` is the two of them joined, for a reader that wants one string.
  const say = (id, lead, tail) => ({ id, lead, tail, line: tail ? `${lead} ${tail}` : lead });

  if (best && picked && picked.handle === best.handle) {
    return say('found_it', 'You found the one that sells.', `Even so: ${picked.hardTruth.line}`);
  }
  // No best means the top of the ranking is tied or every tape is a thin sample, so
  // there is no name to hand out and the line does not invent one.
  return say('headline', OPENER_PUNCHLINE, best
    ? `Best on the tape was @${best.handle}, ${best.realisedLabel} realised across `
      + `${count(best.sold)} sold positions.`
    : null);
}

/** One trader, before the ranking is known. */
function readTrader(handle, fomoDir) {
  const record = readFomo(path.join(fomoDir, `${handle}.json`));
  // copyRiskReport wants a prospect shape. Only the venue, the wallet and the record are
  // read for a Fomo trader, so nothing here invents a field the report could branch on.
  const risk = copyRiskReport({ venue: 'fomo', wallet: record.address, record });
  return {
    handle: record.handle,
    file: handle,
    address: record.address,

    // What Fomo shows about them, and all the pick screen is allowed to see.
    followers: record.followers,
    followersLabel: count(record.followers),
    headline: record.headline,
    headlineLabel: money(record.headline),

    // What the tape shows, served only with the reveal.
    realised: record.realized,
    realisedLabel: money(record.realized),
    sold: record.closedTrades,
    fullyClosed: record.roundTrips,
    open: record.openBags,
    paper: record.unrealized,
    paperLabel: money(record.unrealized),
    winRate: record.winRate,
    winRateLabel: record.winRate === null ? 'not available' : pct(record.winRate),
    topPositionShare: record.topPositionShare,
    topPositionLabel: record.topPositionShare === null ? null : pct(record.topPositionShare),
    topPositionCoin: record.topPositionCoin,
    topPositionChain: record.topPositionChain,

    thinSample: record.closedTrades < MIN_SOLD_TO_RANK,
    hardTruth: hardTruth(record, risk),
    verdict: risk.verdict,

    source: FOMO_SOURCE,
    capturedAt: record.retrievedAt,
    // Every reveal card says where its numbers came from and when, in one line.
    sourceLine: `${FOMO_SOURCE}, captured ${day(record.retrievedAt)} UTC, ${OPENER_SCOPE}`,
  };
}

/**
 * The whole opener. No network call, no model call, no Nansen credit: seven recorded
 * responses read off disk, which is why the route behind this is safe to leave open on
 * the hosted demo.
 */
export function loadOpener({
  root = path.resolve(HERE, '..'),
  fomoDir = path.join(root, 'prototype', 'fixtures', 'fomo'),
  handles = OPENER_HANDLES,
} = {}) {
  const traders = handles.map(h => readTrader(h, fomoDir));

  // The pick screen is ordered by followers, because that is the thing being tested:
  // the player is choosing off the crowd and the headline. The reveal is ordered by
  // realised PnL on sold positions, which is the only ordering the tape supports.
  const pickOrder = [...traders].sort((a, b) => b.followers - a.followers);
  const ranked = [...traders].sort((a, b) => b.realised - a.realised);

  // A thin sample is never the best, and a tie at the top is not broken by hand.
  const eligible = ranked.filter(t => !t.thinSample);
  const topRealised = eligible.length ? eligible[0].realised : null;
  const tiedAtTop = eligible.filter(t => t.realised === topRealised).length > 1;
  const bestHandle = eligible.length && !tiedAtTop ? eligible[0].handle : null;

  const revealed = ranked.map((t, i) => ({
    ...t,
    order: i + 1,
    // A ranked position is only printed for a tape that can carry one.
    rank: t.thinSample ? null : ranked.filter(x => !x.thinSample).indexOf(t) + 1,
    rankLabel: t.thinSample
      ? 'thin sample'
      : tiedAtTop && t.realised === topRealised
        ? 'tied'
        : `#${ranked.filter(x => !x.thinSample).indexOf(t) + 1}`,
    best: t.handle === bestHandle,
  }));

  const captures = [...new Set(traders.map(t => day(t.capturedAt)))].sort();

  return {
    question: OPENER_QUESTION,
    punchline: OPENER_PUNCHLINE,
    source: FOMO_SOURCE,
    scope: OPENER_SCOPE,
    minSoldToRank: MIN_SOLD_TO_RANK,
    capturedRange: captures.length === 1 ? `${captures[0]} UTC` : `${captures[0]} to ${captures[captures.length - 1]} UTC`,
    // Hype only, in follower order. Nothing here gives the tape away.
    pick: pickOrder.map(t => ({
      handle: t.handle,
      followers: t.followers,
      followersLabel: t.followersLabel,
      headline: t.headline,
      headlineLabel: t.headlineLabel,
    })),
    reveal: revealed,
    // One line per possible pick, so the page never has to compose a sentence itself.
    punchlines: Object.fromEntries(
      revealed.map(t => [t.handle, punchlineFor(revealed, bestHandle, t.handle)]),
    ),
    bestHandle,
    tiedAtTop,
  };
}

/** What the page is allowed to see. The reveal rides along; the game has no secret. */
export function openerPublic(opener = loadOpener()) {
  return opener;
}

export default loadOpener;
