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
  assert.ok(near(by('frankdegods').record.unrealized, 24_000_000), 'frankdegods says twenty four million in open bags');
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
    assert.match(p.truth.scope, /Robinhood Chain fills only/);
    assert.doesNotMatch(JSON.stringify(p.truth), /Nansen/);

    // The whole point of these four: three numbers on one line, and the biggest of
    // them is the one nobody has sold.
    assert.match(p.truth.paper.line, /^Headline [+-]\$[\d,]+\. Actually sold [+-]\$[\d,]+\. Paper [+-]\$[\d,]+, unsold\.$/);
    assert.match(p.truth.basis, /^closed round trips since \d{4}-\d{2}-\d{2}, Robinhood Chain fills indexed by Fomo Radar$/);
    assert.match(p.truth.disclosure, /bought before this tape starts and are excluded/);
    assert.equal(p.truth.pnlCaption, `Realised on ${p.record.closedTrades.toLocaleString('en-US')} closed round trips`);
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
    assert.equal(p.record.unrealized, raw.stats.unrealized_pnl);
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
  assert.match(frank.risk.flags.find(f => f.id === 'paper_headline').plain, /Most of this number is unsold/);

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

test('the control wallet has no fills, so drawdown is declared missing and never flagged', () => {
  const p = by('realdeal');
  assert.equal(p.snapshot.trades_30d.length, 0);
  assert.equal(p.risk.max_drawdown.max_drawdown_usd, null);
  assert.equal(p.risk.flags.some(f => f.id === 'max_drawdown'), false, 'a missing number is not a red flag');
  assert.ok(p.risk.not_assessed.some(n => n.id === 'max_drawdown'));
  assert.match(p.risk.coverage, /no fills for this wallet/);
  assert.equal(p.risk.execution_authorized, false, 'the report does not decide the wire');
});

test('a partial capture says the drawdown covers the fills held, not the window', () => {
  const p = by('legend');
  assert.equal(p.snapshot.trades_pagination.is_complete, false);
  assert.match(p.risk.coverage, /fills held in this capture, not the whole window/);
  const flag = p.risk.flags.find(f => f.id === 'max_drawdown');
  if (flag) assert.match(flag.plain, /fills held in this capture/);
  // The loader declares the partial coverage, so the desk's own tools carry the warning.
  assert.equal(p.snapshot.fills_coverage.complete, false);
  assert.equal(p.snapshot.fills_coverage.fills, p.snapshot.trades_30d.length);
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
