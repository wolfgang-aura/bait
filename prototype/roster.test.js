/**
 * The roster: eight real public traders, two venues, one gate rule.
 *
 * Nothing here reaches Nansen, Fomo Radar, DeepSeek or the model ledger. Every number
 * is read from a file already committed to the repository, and the point of most of
 * these tests is that the number on the screen and the number the desk argues with
 * come out of the same file.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRoster, rosterTile, prospectPublic, FOMO_SOURCE, NANSEN_SOURCE } from './roster.js';
import { guardAllocation } from '../validation/guard.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ROSTER = loadRoster();
const by = id => ROSTER.find(p => p.id === id);

test('the roster is eight prospects across two venues, and is never ordered by PnL', () => {
  assert.equal(ROSTER.length, 8);
  assert.deepEqual(
    ROSTER.map(p => p.venue),
    ['hyperliquid', 'hyperliquid', 'hyperliquid', 'hyperliquid', 'fomo', 'fomo', 'fomo', 'fomo'],
  );
  assert.equal(new Set(ROSTER.map(p => p.id)).size, 8, 'ids are unique');
  assert.equal(new Set(ROSTER.map(p => p.accent)).size, 8, 'every prospect has its own accent colour');
  assert.equal(new Set(ROSTER.map(p => p.portrait)).size, 8, 'every prospect has its own portrait');

  // A PnL ordering, ascending or descending, would turn the lineup into the one thing
  // the Nansen terms do not allow us to publish: a public PnL leaderboard.
  const pnl = ROSTER.map(p => p.truth.pnl);
  const sorted = [...pnl].sort((a, b) => a - b);
  assert.notDeepEqual(pnl, sorted);
  assert.notDeepEqual(pnl, [...sorted].reverse());
});

test('a tile carries the hype and nothing that would give the truth away', () => {
  for (const p of ROSTER) {
    const tile = rosterTile(p);
    assert.ok(tile.hype.value && tile.hype.caption, `${p.id} brags about something`);
    assert.ok(tile.hype.source.includes('20'), `${p.id} says where the brag came from`);
    assert.ok(['capture', 'fixture', 'recorded'].includes(tile.truth_available));

    const printed = JSON.stringify(tile);
    assert.ok(!('truth' in tile), `${p.id} tile has no truth block`);
    assert.doesNotMatch(printed, /realised PnL|realized_pnl|win_rate|perp-pnl-summary/i,
      `${p.id} tile leaks no truth field`);
    // THE REAL DEAL is the exception on purpose: its brag is its 30-day PnL, and that
    // figure survives the reveal intact. Every prospect the gate blocks must not show
    // the number the reveal is about.
    if (p.risk.verdict === 'block' && p.truth.pnl < 0) {
      assert.doesNotMatch(printed, new RegExp(p.truth.pnlLabel.replace(/[$+\-,]/g, '\\$&')),
        `${p.id} tile never prints its own realised PnL`);
    }
    // The truth arrives only once the round has started.
    assert.equal(prospectPublic(p).truth.pnlLabel, p.truth.pnlLabel);
  }
});

test('every brag is backed by a number that is actually in the loaded record', () => {
  const near = (actual, claimed, tolerance = 0.06) =>
    Math.abs(actual - claimed) / Math.abs(claimed) <= tolerance;

  assert.ok(near(by('legend').hypeRow.all_time_pnl_usd, 119_000_000), 'THE LEGEND says a hundred and nineteen million');
  assert.ok(near(by('streak').hypeRow.week_pnl_usd, 600_000), 'THE STREAK says most of six hundred grand');
  assert.ok(near(by('realdeal').hypeRow.month_pnl_usd, 116_000), 'THE REAL DEAL says a hundred and sixteen thousand');

  const grinderWeek = by('grinder').snapshot.pnl_summary_7d;
  assert.equal(grinderWeek.closed_trade_count, 424);
  assert.equal(grinderWeek.winning_trade_count, 424, 'THE GRINDER says every one of them was green');

  assert.ok(by('unipcs').record.followers > 500_000);
  assert.ok(near(by('unipcs').record.headline, 10_800_000));
  assert.ok(near(by('ether_monk').record.followers, 320_000));
  assert.ok(near(by('ether_monk').record.headline, 1_500_000, 0.06));
  assert.ok(near(by('frankdegods').record.unrealized, 1_156_000), 'frankdegods holds about $1.16M of paper on the tape, not the $24M in the stats block');
  assert.equal(by('frankdegods').record.openBags, 209, 'open positions are the tape positions, not stats.open_bags');
  assert.ok(near(by('orangie').record.followers, 130_000));

  for (const p of ROSTER) {
    assert.ok(p.voice.split(' ').length <= 14, `${p.id} says one line, not a paragraph`);
    assert.doesNotMatch(p.voice, /—/, 'no em-dashes');
  }
});

test('a real Nansen capture wins over the placeholder, with no code change', () => {
  for (const p of ROSTER.filter(x => x.venue === 'hyperliquid')) {
    assert.equal(p.truthAvailable, 'capture', `${p.id} is served from a real capture`);
    assert.equal(p.truth.source, NANSEN_SOURCE);
    assert.notEqual(p.snapshot.fixture, true);
  }
  // The control wallet's capture carries a control_ prefix and the loader still finds it.
  assert.ok(fs.existsSync(path.join(ROOT, 'validation', 'snapshots', `control_${by('realdeal').wallet}.json`)));
  assert.equal(fs.existsSync(path.join(ROOT, 'validation', 'snapshots', `${by('realdeal').wallet}.json`)), false);

  // The placeholders stay on disk and stay labelled, so a wallet whose capture is
  // withdrawn falls back to a fixture that says out loud that it is one.
  const fixtures = fs.readdirSync(path.join(ROOT, 'prototype', 'fixtures', 'roster-snapshots'));
  assert.ok(fixtures.length >= 2);
  for (const file of fixtures) {
    const s = JSON.parse(fs.readFileSync(path.join(ROOT, 'prototype', 'fixtures', 'roster-snapshots', file), 'utf8'));
    assert.equal(s.fixture, true);
    assert.match(s.fixture_note, /not a Nansen capture/);
  }
});

test('each placeholder snapshot adds up: coin rows and fills equal the window totals', () => {
  const round = n => Math.round(n * 100) / 100;
  const dir = path.join(ROOT, 'prototype', 'fixtures', 'roster-snapshots');
  for (const file of fs.readdirSync(dir)) {
    const id = file;
    const s = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    for (const window of ['pnl_summary_30d', 'pnl_summary_7d']) {
      const coins = round(s[window].top5_coins.reduce((a, c) => a + c.realized_pnl_usd, 0));
      assert.equal(coins, round(s[window].realized_pnl_usd), `${id} ${window} coin rows sum to the window total`);
      assert.equal(
        s[window].winning_trade_count / s[window].closed_trade_count,
        s[window].win_rate,
        `${id} ${window} win rate is the trade counts, not a separate number`,
      );
    }
    const all = round(s.trades_30d.reduce((a, f) => a + f.closed_pnl, 0));
    assert.equal(all, round(s.pnl_summary_30d.realized_pnl_usd), `${id} fills sum to the 30-day total`);
    const cutoff = Date.parse(s.windows['7d'].from);
    const week = round(s.trades_30d.filter(f => Date.parse(f.timestamp) >= cutoff).reduce((a, f) => a + f.closed_pnl, 0));
    assert.equal(week, round(s.pnl_summary_7d.realized_pnl_usd), `${id} 7-day fills sum to the 7-day total`);
    assert.equal(s.trades_pagination.is_complete, true);
  }
});

test('the Fomo prospects show headline, sold and paper side by side, never claiming Nansen', () => {
  for (const id of ['unipcs', 'ether_monk', 'frankdegods', 'orangie']) {
    const p = by(id);
    assert.equal(p.truth.kind, 'fomo');
    assert.equal(p.truth.source, FOMO_SOURCE);
    assert.equal(p.truth.endpointLine, FOMO_SOURCE);
    assert.deepEqual(p.desk.nansen.endpoints, [FOMO_SOURCE]);
    assert.deepEqual(p.desk.tools, ['check_fomo_record'], 'no Nansen tool is offered for Robinhood Chain');
    // The realised half is Robinhood Chain and the scope says exactly that half.
    assert.match(p.truth.scope, /^Robinhood Chain round trips, observed /);
    assert.doesNotMatch(JSON.stringify(p.truth), /Nansen/);

    // The whole point of these four: three numbers on one line, and the biggest of
    // them is the one nobody has sold.
    assert.match(p.truth.paper.line, /^Headline [+-]\$[\d,]+\. Actually sold [+-]\$[\d,]+\. Paper [+-]\$[\d,]+, unsold\.$/);
    assert.match(p.truth.basis, /^[\d,]+ sold positions since \d{4}-\d{2}-\d{2}, [\d,]+ of them fully closed, Robinhood Chain fills indexed by Fomo Radar$/);
    assert.match(p.truth.disclosure, /bought before this tape starts and are excluded/);
    assert.equal(p.truth.pnlCaption, `Realised on ${p.record.closedTrades.toLocaleString('en-US')} sold positions`);
  }
});

test('a Fomo count called a round trip is one: the partly sold rows are counted apart', () => {
  // `closed[]` carries every row that realised money, including positions still held
  // after a partial sell. `round_trips` in the same response counts only the finished
  // ones, and the screen prints both rather than calling all of them round trips.
  for (const id of ['unipcs', 'ether_monk', 'frankdegods', 'orangie']) {
    const p = by(id);
    const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'prototype', 'fixtures', 'fomo', `${id}.json`), 'utf8'));
    const sold = raw.closed.filter(t => Number.isFinite(t.realized));
    const finished = sold.filter(t => t.state === 'closed');

    assert.equal(p.record.closedTrades, sold.length, `${id} sold positions`);
    assert.equal(p.record.roundTrips, finished.length, `${id} fully closed round trips`);
    assert.equal(p.record.roundTrips, raw.round_trips,
      `${id} fully closed count agrees with the response's own round_trips`);
    // The realised total keeps the partial exits, because that money did leave the book.
    assert.equal(Math.round(p.record.realized), Math.round(sold.reduce((a, t) => a + t.realized, 0)));

    // Nothing on the screen may call the larger number a round trip.
    const printed = JSON.stringify([p.truth, p.dossier]);
    assert.doesNotMatch(printed, new RegExp(`${sold.length}( |&nbsp;)?(closed )?round trips`),
      `${id} never prints ${sold.length} as a round-trip count`);
    assert.match(p.truth.rows.find(r => r.label === 'Fully closed round trips').value,
      new RegExp(`^${finished.length.toLocaleString('en-US')} of ${sold.length.toLocaleString('en-US')}$`));
  }
});

test('the Fomo top-position share is a market value over the same market value', () => {
  for (const id of ['unipcs', 'ether_monk', 'frankdegods', 'orangie']) {
    const p = by(id);
    const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'prototype', 'fixtures', 'fomo', `${id}.json`), 'utf8'));
    const held = raw.positions.filter(o => o.state !== 'closed');
    const worths = held.filter(o => Number.isFinite(o.worth)).map(o => Math.abs(o.worth));
    const book = worths.reduce((a, b) => a + b, 0);

    // The response's own book_value is the sum of `worth`, which is why that is the
    // basis on both sides of the share. A position's `pnl` is never used for it.
    assert.ok(Math.abs(book - raw.book_value) < 0.01, `${id} book_value is the sum of worth`);
    assert.ok(Math.abs(p.record.bookValue - raw.book_value) < 0.01, `${id} carries that book value`);
    assert.equal(p.record.topPositionShare, Math.max(...worths) / book, `${id} top position share`);
    assert.ok(p.record.topPositionShare <= 1, `${id} share cannot exceed the whole book`);
    const top = held.find(o => Math.abs(o.worth) === Math.max(...worths));
    assert.equal(p.record.topPositionCoin, top.sym);
    assert.equal(p.record.topPositionChain, top.chain);

    // When the share trips the check, the flag names the position and the share, so a
    // reader can go and look at the same row in the same file.
    const flag = p.risk.flags.find(f => f.id === 'concentration');
    if (flag && p.record.topPositionShare > 0.5) {
      assert.ok(flag.plain.includes(`${top.sym} on ${top.chain}`), `${id} names its biggest bag`);
      assert.equal(flag.evidence.coin, `${top.sym} on ${top.chain}`);
    }
  }
  // frankdegods is the case that matters: 75.5% of the book is one bsc position.
  assert.match(by('frankdegods').risk.flags.find(f => f.id === 'concentration').plain,
    /牛来 on bsc is 75\.5% of the open book/);
});

test('the Fomo paper figure names the chains it is actually marked on', () => {
  for (const id of ['unipcs', 'ether_monk', 'frankdegods', 'orangie']) {
    const p = by(id);
    const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'prototype', 'fixtures', 'fomo', `${id}.json`), 'utf8'));
    const held = raw.positions.filter(o => o.state !== 'closed');
    const off = held
      .filter(o => o.chain && o.chain !== 'robinhood')
      .reduce((a, o) => a + (Number.isFinite(o.pnl) ? o.pnl : 0), 0);

    // Every closed row is a Robinhood fill, so the realised side of the screen is
    // Robinhood only and is allowed to say so.
    assert.equal(raw.closed.every(t => t.chain === 'robinhood'), true, `${id} realised side is Robinhood only`);
    assert.equal(p.record.offChainPaper, off, `${id} off-Robinhood paper`);
    assert.deepEqual(p.record.openChains, [...new Set(held.map(o => o.chain).filter(Boolean))].sort());
    // Positions the response leaves without a chain are counted, never assigned one.
    assert.equal(p.record.openChainsUnknown, held.filter(o => !o.chain).length, `${id} unattributed positions`);
    if (p.record.openChainsUnknown) {
      assert.match(p.truth.disclosure, new RegExp(`${p.record.openChainsUnknown} carr(ies|y) no chain in the response`));
    }

    if (off) {
      // frankdegods is the extreme: $1,146,387 of the $1,155,923 paper PnL is marked on
      // bsc and solana, so a screen that said Robinhood only would be describing a
      // number it does not hold.
      assert.match(p.truth.disclosure, /span .*, and [+-]\$[\d,]+ of the paper PnL sits off Robinhood Chain/);
      for (const chain of p.record.openChains) assert.match(p.truth.disclosure, new RegExp(chain));
    } else {
      assert.match(p.truth.disclosure, /open positions Fomo marks are all on Robinhood Chain/);
    }
  }
  assert.ok(Math.abs(by('frankdegods').record.offChainPaper / by('frankdegods').record.unrealized) > 0.9,
    'frankdegods paper is almost entirely off Robinhood Chain, and the screen says so');
  assert.equal(by('orangie').record.offChainPaper, 0, 'orangie holds nothing off Robinhood Chain');
});

test('the Fomo volume is the tape turnover, not the stats block', () => {
  for (const id of ['unipcs', 'ether_monk', 'frankdegods', 'orangie']) {
    const p = by(id);
    const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'prototype', 'fixtures', 'fomo', `${id}.json`), 'utf8'));
    const turnover = raw.closed
      .filter(t => Number.isFinite(t.realized))
      .reduce((a, t) => a + (Number(t.bought_usd) || 0) + (Number(t.sold_usd) || 0), 0);
    assert.ok(Math.abs(p.record.volume - turnover) < 0.01,
      `${id} volume is bought plus sold across the sold positions`);
    assert.notEqual(Math.round(p.record.volume), Math.round(raw.stats.volume),
      `${id} stats.volume disagrees with the tape, which is why it is not used`);
  }
});

test('the Fomo realised figure is the closed round trips, not the stats block', () => {
  // The recorded response carries both and they disagree. The round trips win because
  // each one carries what was bought, what was sold and the exit share, so a reader can
  // add them up. These are the figures the report and the desk both read.
  const expected = {
    unipcs: { realised: 40_665, trips: 9, wins: 7 },
    ether_monk: { realised: 456_846, trips: 26, wins: 7 },
    frankdegods: { realised: 687_491, trips: 190, wins: 78 },
    orangie: { realised: -23_911, trips: 96, wins: 42 },
  };
  for (const [id, want] of Object.entries(expected)) {
    const p = by(id);
    const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'prototype', 'fixtures', 'fomo', `${id}.json`), 'utf8'));
    assert.equal(Math.round(p.record.realized), want.realised, `${id} realised`);
    assert.equal(p.record.closedTrades, want.trips, `${id} closed round trips`);
    assert.equal(p.record.wins, want.wins, `${id} winning round trips`);
    assert.equal(p.record.winRate, want.wins / want.trips);
    assert.equal(
      Math.round(raw.closed.reduce((a, t) => a + t.realized, 0)),
      want.realised,
      `${id} is exactly the sum of the closed list in the file`,
    );
    assert.notEqual(Math.round(raw.stats.realized_pnl), want.realised,
      `${id} stats block disagrees, which is why it is not used`);
    assert.equal(p.record.unrealized, raw.open_pnl, `${id} paper figure is the tape's open_pnl`);
    assert.equal(
      Math.round(p.record.unrealized),
      Math.round(raw.positions.reduce((a, o) => a + (Number.isFinite(o.pnl) ? o.pnl : 0), 0)),
      `${id} open_pnl is exactly the sum of the positions list in the file`,
    );
    assert.notEqual(Math.round(p.record.unrealized), Math.round(raw.stats.unrealized_pnl),
      `${id} stats.unrealized_pnl disagrees with the tape, which is why it is not used`);
    assert.equal(p.record.openBags, raw.positions.length);
    assert.equal(p.record.headline, raw.fomo_pnl);
    assert.equal(p.record.preTape, raw.pre_tape);
  }
});

test('the guard reads the recorded tape, and the copy-risk report is the stricter read', async () => {
  const frank = by('frankdegods');
  const allowed = await guardAllocation({
    executor: frank.executor, wallet: frank.wallet, allocation: 5_000, policy: frank.guardPolicy,
  });
  // The hard PnL rule lets this one through: the closed round trips are positive.
  assert.equal(allowed.decision, 'allow');
  assert.equal(allowed.evidence.source, FOMO_SOURCE);
  assert.equal(allowed.evidence.realized_pnl_usd, frank.record.realized);
  assert.equal(allowed.policy.window_days, frank.record.windowDays);
  // The copy-risk report explains concerns but does not size or authorize capital.
  assert.equal(frank.risk.verdict, 'caution');
  assert.equal(frank.risk.execution_authorized, false);
  // On the tape basis frankdegods' paper is 74% of the headline, under the 80% bar,
  // so the honest flag list is concentration alone. unipcs, whose marked paper
  // exceeds the headline outright, is the one that trips the paper check.
  assert.deepEqual(frank.risk.flags.map(f => f.id), ['concentration']);
  assert.match(by('unipcs').risk.flags.find(f => f.id === 'paper_headline').plain, /Most of this number is unsold/);

  const orangie = by('orangie');
  const blocked = await guardAllocation({
    executor: orangie.executor, wallet: orangie.wallet, allocation: 5_000, policy: orangie.guardPolicy,
  });
  assert.equal(blocked.decision, 'block');
  assert.equal(blocked.code, 'pnl_below_minimum');
  assert.equal(blocked.allocation, 0);
  assert.equal(orangie.risk.verdict, 'block');
});

test('BAIT lets the one Nansen record that holds up reach the wire', async () => {
  const p = by('realdeal');
  const { makeToolExecutor } = await import('../validation/tools.js');
  const decision = await guardAllocation({
    executor: makeToolExecutor(p.snapshot, { mode: 'armed' }),
    wallet: p.wallet, allocation: 5_000, policy: p.guardPolicy,
  });
  assert.equal(decision.decision, 'allow');
  assert.equal(decision.allocation, 5_000);
  assert.equal(decision.evidence.source, NANSEN_SOURCE);
  assert.equal(p.risk.execution_authorized, false, 'the report never authorizes execution');
});

test('every prospect carries a copy-risk report a person and an agent can both read', () => {
  for (const p of ROSTER) {
    const r = p.risk;
    assert.ok(['allow', 'caution', 'block'].includes(r.verdict), `${p.id} has a verdict`);
    assert.equal(r.execution_authorized, false);
    assert.deepEqual(r.required_missing, []);
    assert.equal(r.verdict, p.gateExpected);
    assert.equal(r.summary.address, p.wallet);
    assert.equal(r.summary.venue, p.venue);
    assert.deepEqual(r.summary.flags, r.flags.map(f => f.id));
    assert.equal(r.summary.evidence.source, r.source);
    assert.ok(r.summary.evidence.retrieved_at, `${p.id} says when the evidence was taken`);
    for (const flag of r.flags) {
      assert.ok(['high', 'medium'].includes(flag.severity));
      assert.match(flag.plain, /[.]$/, `${p.id}/${flag.id} is a sentence`);
      assert.doesNotMatch(flag.plain, /—/);
    }
    // A realised loss is always a block, whatever else the record says.
    if (p.truth.pnl < 0) {
      assert.equal(r.verdict, 'block');
      assert.ok(r.flags.some(f => f.id === 'realised_negative'));
    }
    // The launch-window check has no evidence to run on and says so rather than guessing.
    assert.ok(r.not_assessed.some(n => n.id === 'uncopyable_entries'));
  }

  // The lineup is not one note: the report separates it, and money reaches the wire.
  const verdicts = new Set(ROSTER.map(p => p.risk.verdict));
  assert.ok(verdicts.size >= 2, 'the report does not say the same thing about everyone');
  assert.ok(ROSTER.some(p => p.risk.verdict === 'caution'), 'some records remain eligible but carry concerns');
});

test('a concentration flag names the bag it is about, on either venue', () => {
  // THE STREAK's whole open book is one xyz:SKHY position at $4.59M of $7.21M notional.
  const streak = by('streak');
  const raw = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'validation', 'snapshots', `${streak.wallet}.json`), 'utf8'));
  const rows = raw.open_positions.asset_positions.map(r => r.position);
  const notional = rows.map(r => Math.abs(Number(r.position_value_usd) || 0));
  const biggest = rows[notional.indexOf(Math.max(...notional))];
  const share = Math.max(...notional) / notional.reduce((a, b) => a + b, 0);

  const flag = streak.risk.flags.find(f => f.id === 'concentration');
  assert.ok(flag, 'the biggest position is over half the book, so the check fires');
  assert.equal(flag.evidence.top_position_share, share);
  assert.equal(flag.evidence.coin, biggest.token_symbol);
  assert.ok(flag.plain.includes(`${biggest.token_symbol} is ${(share * 100).toFixed(1)}% of the open book`),
    'the sentence names the position and its share');

  // THE REAL DEAL trips the check on a coin's share of the realised result instead,
  // because its capture holds no open positions at all.
  const real = by('realdeal');
  const top = [...real.snapshot.pnl_summary_30d.top5_coins].sort((a, b) => b.realized_pnl_usd - a.realized_pnl_usd)[0];
  const coinFlag = real.risk.flags.find(f => f.id === 'concentration');
  assert.equal(coinFlag.evidence.top_position_share, null);
  assert.equal(coinFlag.evidence.coin, top.coin);
  assert.ok(coinFlag.plain.includes(`${top.coin} alone carries`), 'it names the coin, not a position');
});

test('the control wallet has no fills, so drawdown is declared missing and never flagged', () => {
  const p = by('realdeal');
  assert.equal(p.snapshot.trades_30d.length, 0);
  assert.equal(p.risk.max_drawdown.max_drawdown_usd, null);
  assert.equal(p.risk.flags.some(f => f.id === 'max_drawdown'), false, 'a missing number is not a red flag');
  assert.ok(p.risk.not_assessed.some(n => n.id === 'max_drawdown'));
  assert.match(p.risk.coverage, /no fills for this wallet/);
  assert.equal(p.risk.execution_authorized, false, 'the report does not decide the wire');
});

test('a capture holding under a week of fills does not measure drawdown or the worst trade at all', () => {
  // Two dates are not enough here. THE LEGEND's first page of 1,000 fills lands inside
  // 74 minutes of a 30-day window, and "2026-08-22 to 2026-08-22" reads like a day of
  // trading, so the line carries the covered stretch and both timestamps.
  for (const id of ['legend', 'streak']) {
    const p = by(id);
    const raw = JSON.parse(fs.readFileSync(
      path.join(ROOT, 'validation', 'snapshots', `${p.wallet}.json`), 'utf8'));
    const fills = [...raw.trades_30d].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

    assert.equal(p.snapshot.trades_pagination.is_complete, false);
    assert.ok(
      Date.parse(fills[fills.length - 1].timestamp) - Date.parse(fills[0].timestamp) < 7 * 86_400_000,
      `${id} really does hold under a week of its 30-day window`,
    );
    // No drawdown or tail figure measured over an hour of a 30-day window: not assessed,
    // and the sentence says why in counts, not in a self-undermining time span.
    assert.match(p.risk.coverage, /^Drawdown and worst single trade are not assessed: this capture holds only the newest [\d,]+ of [\d,]+ closed trades, too few to measure them over 30 days\.$/);
    assert.doesNotMatch(p.risk.coverage, /hour|minute/);
    for (const id2 of ['max_drawdown', 'tail_loss']) {
      assert.equal(p.risk.flags.find(f => f.id === id2), undefined, `${id}/${id2} is not flagged off a slice`);
      assert.ok(p.risk.not_assessed.find(n => n.id === id2), `${id}/${id2} is listed as not assessed`);
    }
    // The loader declares the partial coverage, so the desk's own tools carry the warning.
    assert.equal(p.snapshot.fills_coverage.complete, false);
    assert.equal(p.snapshot.fills_coverage.fills, p.snapshot.trades_30d.length);
  }

  // THE GRINDER's capture paged to the end, so there is no caveat to print.
  assert.equal(by('grinder').snapshot.trades_pagination.is_complete, true);
  assert.equal(by('grinder').risk.coverage, null);
});

test('every figure a prospect brags about is in the loaded record', () => {
  // The brag lines spell their numbers out, so each one is pinned to the field it came
  // from here. frankdegods used to say "twenty four million", which is Fomo's
  // stats.unrealized_pnl and not any number in its tape.
  const brags = [
    ['legend', /hundred and nineteen million/, p => p.hypeRow.all_time_pnl_usd, 119_000_000],
    ['streak', /six hundred grand/, p => p.hypeRow.week_pnl_usd, 600_000],
    ['realdeal', /hundred and sixteen thousand/, p => p.hypeRow.month_pnl_usd, 116_000],
    ['grinder', /four hundred and twenty four trades/i, p => p.snapshot.pnl_summary_7d.closed_trade_count, 424],
    ['unipcs', /half a million people/i, p => p.record.followers, 500_000],
    ['unipcs', /ten point eight/, p => p.record.headline, 10_800_000],
    ['ether_monk', /three hundred thousand followers/i, p => p.record.followers, 310_000],
    ['ether_monk', /one and a half million/, p => p.record.headline, 1_550_000],
    ['frankdegods', /a million sitting in open bags/i, p => p.record.unrealized, 1_156_000],
    ['orangie', /hundred and thirty thousand followers/, p => p.record.followers, 130_000],
  ];
  for (const [id, said, read, spoken] of brags) {
    const p = by(id);
    assert.match(p.voice, said, `${id} still says this`);
    const actual = read(p);
    assert.ok(Math.abs(actual - spoken) / Math.abs(spoken) <= 0.08,
      `${id} says ${spoken} and the record holds ${actual}`);
  }
  // THE GRINDER's "every one green" is the only exact claim in a brag line.
  assert.equal(by('grinder').snapshot.pnl_summary_7d.win_rate, 1);
  assert.equal(
    by('grinder').snapshot.pnl_summary_7d.winning_trade_count,
    by('grinder').snapshot.pnl_summary_7d.closed_trade_count,
  );
  // No brag may quote a figure only the unreliable Fomo stats block carries.
  for (const id of ['unipcs', 'ether_monk', 'frankdegods', 'orangie']) {
    const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'prototype', 'fixtures', 'fomo', `${id}.json`), 'utf8'));
    const stated = Math.round(raw.stats.unrealized_pnl / 1_000_000);
    if (stated >= 2 && Math.round(by(id).record.unrealized / 1_000_000) !== stated) {
      assert.doesNotMatch(by(id).voice, new RegExp(`${stated} million`, 'i'),
        `${id} does not brag the stats block's unrealised PnL`);
    }
  }
});

test('the dossier only ever hands the player ammunition that is true and in the record', () => {
  for (const p of ROSTER) {
    assert.ok(p.dossier.facts.length >= 4, `${p.id} has enough to work with`);
    for (const fact of p.dossier.facts) {
      assert.ok(fact.insert.length <= 200, `${p.id}/${fact.id} fits the text box`);
      assert.ok(fact.claim.length > fact.insert.length - 40, `${p.id}/${fact.id} carries a checkable claim`);
      assert.doesNotMatch(fact.insert, /—/);
    }
    // An all-time loss is not ammunition, so it is never offered as a fact.
    const allTime = p.dossier.facts.find(f => f.id === 'all-time');
    if (allTime) assert.match(allTime.value, /^\+/);
    if (p.venue === 'fomo' || p.truth.pnl < 0) {
      // A Fomo prospect buries what was actually sold, whichever way it went: that is
      // the number that shows the headline for what it is.
      assert.equal(p.dossier.buried.note, 'do not mention this');
      assert.equal(p.dossier.clean, null);
    } else {
      assert.equal(p.dossier.buried, null, 'a clean record has nothing to bury');
      assert.match(p.dossier.clean, /Nothing buried/);
    }
  }
});
