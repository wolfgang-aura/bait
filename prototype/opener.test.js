/**
 * The cold open: seven Fomo handles, every figure recomputed from the raw recorded
 * response rather than from anything the loader says about it.
 *
 * Nothing here reaches Fomo Radar, Nansen, DeepSeek or the model ledger. Each assertion
 * reads `prototype/fixtures/fomo/<handle>.json` itself and rebuilds the number from the
 * same fields a reader could add up by hand, which is the only way a screen this small
 * can be audited: follower count from `stats.followers`, headline from `fomo_pnl`,
 * realised from `closed[]`, paper and the open book from `positions[]`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadOpener, hardTruth, punchlineFor, OPENER_HANDLES, MIN_SOLD_TO_RANK, OPENER_PUNCHLINE } from './opener.js';
import { readFomo, copyRiskReport, FOMO_SOURCE } from './roster.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FOMO = path.join(ROOT, 'prototype', 'fixtures', 'fomo');
const OPENER = loadOpener();

const raw = file => JSON.parse(fs.readFileSync(path.join(FOMO, `${file}.json`), 'utf8'));
const byHandle = handle => OPENER.reveal.find(t => t.handle === handle);
/** Every trader on the screen, paired with the file it was read out of. */
const pairs = () => OPENER_HANDLES.map(file => ({ file, body: raw(file), row: OPENER.reveal.find(t => t.file === file) }));

test('the cold open is seven recorded Fomo handles and nothing else', () => {
  assert.equal(OPENER_HANDLES.length, 7);
  assert.equal(OPENER.pick.length, 7);
  assert.equal(OPENER.reveal.length, 7);
  assert.equal(new Set(OPENER.reveal.map(t => t.handle)).size, 7);

  for (const { file, body } of pairs()) {
    // The envelope says where the response came from and when, and the response inside
    // it is the endpoint's own 168-hour window.
    assert.equal(body.source, FOMO_SOURCE);
    assert.equal(body.source_url, `https://fomoradar.app/api/trader/${file}`);
    assert.equal(body.hours, 168, `${file} was recorded over the 168-hour window`);
    assert.ok(Number.isFinite(Date.parse(body.retrieved_at)), `${file} says when it was retrieved`);
    assert.match(body.retrieved_at, /Z$/, `${file} capture time is UTC`);
    assert.equal(body.chain, 'robinhood');
  }
});

test('the pick screen shows only the handle, the crowd and the profile headline', () => {
  // Follower order, which is how Fomo itself sorts and is deliberately not a PnL order.
  const followers = OPENER.pick.map(t => t.followers);
  assert.deepEqual(followers, [...followers].sort((a, b) => b - a));

  for (const t of OPENER.pick) {
    const file = OPENER_HANDLES.find(h => raw(h).handle === t.handle);
    const body = raw(file);
    assert.equal(t.followers, body.stats.followers, `${t.handle} follower count is stats.followers`);
    assert.equal(t.headline, body.fomo_pnl, `${t.handle} headline is fomo_pnl`);
    assert.equal(t.followersLabel, body.stats.followers.toLocaleString('en-US'));
    assert.equal(t.headlineLabel, `+$${Math.round(body.fomo_pnl).toLocaleString('en-US')}`);

    // A pick card must not carry the tape. The whole screen depends on the player not
    // being able to see the answer before choosing.
    assert.deepEqual(Object.keys(t).sort(), ['followers', 'followersLabel', 'handle', 'headline', 'headlineLabel']);
  }
});

test('every reveal figure is recomputed from the raw closed[] and positions[]', () => {
  for (const { file, body, row } of pairs()) {
    const sold = body.closed.filter(t => Number.isFinite(t.realized));
    const fullyClosed = sold.filter(t => t.state === 'closed');
    const held = body.positions.filter(p => p.state !== 'closed');
    const wins = sold.filter(t => t.realized > 0).length;
    const realised = sold.reduce((a, t) => a + t.realized, 0);
    const worths = held.filter(p => Number.isFinite(p.worth)).map(p => Math.abs(p.worth));
    const book = worths.reduce((a, b) => a + b, 0);

    assert.equal(row.sold, sold.length, `${file} sold positions`);
    assert.equal(row.fullyClosed, fullyClosed.length, `${file} fully closed round trips`);
    assert.equal(row.fullyClosed, body.round_trips, `${file} agrees with the response's own round_trips`);
    assert.equal(row.open, held.length, `${file} open positions`);
    assert.equal(Math.round(row.realised), Math.round(realised), `${file} realised is the sum of closed[]`);
    assert.equal(row.realisedLabel, `${realised < 0 ? '-' : '+'}$${Math.round(Math.abs(realised)).toLocaleString('en-US')}`);
    assert.equal(row.winRate, sold.length ? wins / sold.length : null, `${file} win rate over sold positions`);
    assert.equal(row.paper, body.open_pnl, `${file} paper is the tape's open_pnl`);
    assert.equal(
      Math.round(row.paper),
      Math.round(body.positions.reduce((a, p) => a + (Number.isFinite(p.pnl) ? p.pnl : 0), 0)),
      `${file} open_pnl is exactly the sum of the positions list`,
    );
    assert.equal(row.topPositionShare, book > 0 ? Math.max(...worths) / book : null, `${file} top position share`);

    // The stats block is the thing this whole project exists to distrust: it disagrees
    // with its own tape, so nothing on the screen may equal it by accident.
    assert.notEqual(Math.round(realised), Math.round(body.stats.realized_pnl),
      `${file} stats.realized_pnl disagrees with the tape, which is why it is not read`);
  }
});

test('the ranking is realised PnL on sold positions, and a thin sample is never the best', () => {
  const realised = OPENER.reveal.map(t => t.realised);
  assert.deepEqual(realised, [...realised].sort((a, b) => b - a), 'the reveal is ordered by realised PnL');
  assert.deepEqual(OPENER.reveal.map(t => t.order), [1, 2, 3, 4, 5, 6, 7]);

  for (const t of OPENER.reveal) {
    assert.equal(t.thinSample, t.sold < MIN_SOLD_TO_RANK, `${t.handle} thin-sample flag is the sold count`);
    if (t.thinSample) {
      assert.equal(t.rank, null, `${t.handle} carries no ranked position`);
      assert.equal(t.rankLabel, 'thin sample');
      assert.equal(t.best, false, `${t.handle} is never called the best on ${t.sold} sold positions`);
    } else {
      assert.match(t.rankLabel, /^(#\d+|tied)$/);
    }
  }

  // Exactly one trader may be called the best, and only when no other rankable tape
  // matches its realised figure.
  const best = OPENER.reveal.filter(t => t.best);
  const rankable = OPENER.reveal.filter(t => !t.thinSample);
  const top = rankable[0];
  const tied = rankable.filter(t => t.realised === top.realised).length > 1;
  assert.equal(OPENER.tiedAtTop, tied);
  assert.equal(best.length, tied ? 0 : 1);
  if (!tied) {
    assert.equal(best[0].handle, top.handle);
    assert.equal(OPENER.bestHandle, top.handle);
    assert.ok(top.sold >= MIN_SOLD_TO_RANK);
    // One of them really can be the best, which is what makes the screen a question
    // rather than a trick.
    assert.ok(top.realised > 0, 'the best tape on the board actually made money selling');
  }
});

test('every trader carries one hard truth, generated from its own numbers', () => {
  const seen = new Set();
  for (const { file, body, row } of pairs()) {
    const truth = row.hardTruth;
    assert.ok(truth.id && truth.label && truth.line, `${file} has a hard truth`);
    assert.match(truth.line, /[.]$/, `${file} hard truth is a sentence`);
    assert.doesNotMatch(truth.line, /—/, 'no em-dashes');
    seen.add(truth.id);

    const sold = body.closed.filter(t => Number.isFinite(t.realized));
    const realised = sold.reduce((a, t) => a + t.realized, 0);
    const money = n => `${n < 0 ? '-' : '+'}$${Math.round(Math.abs(n)).toLocaleString('en-US')}`;

    // The line is only allowed to say the thing the tape actually shows.
    if (truth.id === 'no_round_trips') assert.equal(sold.length, 0);
    if (truth.id === 'thin_sample') {
      assert.ok(sold.length < MIN_SOLD_TO_RANK, `${file} really is a thin sample`);
      assert.ok(truth.line.includes(sold.length.toLocaleString('en-US')), `${file} names its sold count`);
      assert.ok(truth.line.includes(money(body.open_pnl)), `${file} names the unsold paper`);
    }
    if (truth.id === 'realised_loss') {
      assert.ok(realised < 0, `${file} really did lose money selling`);
      assert.ok(truth.line.includes(money(realised)), `${file} names its realised figure`);
      assert.ok(truth.line.includes(money(body.fomo_pnl)), `${file} names the headline it is set against`);
    }
    if (truth.id === 'paper_headline') {
      assert.ok(body.open_pnl > 0, `${file} really is carrying unsold gain`);
      assert.ok(truth.line.includes(Math.round(body.open_pnl).toLocaleString('en-US')), `${file} names the paper`);
    }
    if (truth.id === 'concentration') {
      const held = body.positions.filter(p => p.state !== 'closed' && Number.isFinite(p.worth));
      const worths = held.map(p => Math.abs(p.worth));
      const topBag = held.find(p => Math.abs(p.worth) === Math.max(...worths));
      assert.ok(truth.line.includes(`${topBag.sym} on ${topBag.chain}`), `${file} names the bag`);
      assert.ok(Math.max(...worths) / worths.reduce((a, b) => a + b, 0) > 0.5);
    }
    if (truth.id === 'low_win_rate') {
      assert.ok(sold.filter(t => t.realized > 0).length / sold.length < 0.4);
    }
  }
  // The point of the screen: one of them may be the best, but no tape on it is clean.
  assert.equal(seen.has('headline_is_not_realised') && seen.size === 1, false,
    'the hard truths are not all the same fallback line');
});

test('the hard truth is derived, so a different tape produces a different line', () => {
  // The same function, run against two real records, must not return the same sentence.
  // This is what stops a hand-typed line being smuggled in as a generated one.
  const lines = new Map();
  for (const file of OPENER_HANDLES) {
    const record = readFomo(path.join(FOMO, `${file}.json`));
    const risk = copyRiskReport({ venue: 'fomo', wallet: record.address, record });
    const derived = hardTruth(record, risk);
    assert.deepEqual(derived, byHandle(record.handle).hardTruth, `${file} line is reproducible from the record alone`);
    lines.set(file, derived.line);
  }
  assert.equal(new Set(lines.values()).size, OPENER_HANDLES.length, 'no two traders get the same sentence');

  // A tape with nothing sold has no realised record, and the line says exactly that
  // rather than ranking a zero.
  const empty = {
    closedTrades: 0, roundTrips: 0, openBags: 4, realized: 0, unrealized: 1_000,
    headline: 1_000, winRate: null, topPositionShare: null, topPositionCoin: null,
    topPositionChain: null, bookValue: 1_000,
  };
  assert.equal(hardTruth(empty, { flags: [] }).id, 'no_round_trips');
});

test('each reveal card names its source and its capture date', () => {
  for (const { file, body, row } of pairs()) {
    const captured = new Date(body.retrieved_at).toISOString().slice(0, 10);
    assert.equal(row.source, FOMO_SOURCE);
    assert.equal(row.capturedAt, body.retrieved_at);
    assert.equal(
      row.sourceLine,
      `${FOMO_SOURCE}, captured ${captured} UTC, Robinhood Chain round trips`,
      `${file} names its source and capture date`,
    );
    // Nothing on this screen is Nansen coverage and nothing may imply that it is.
    assert.doesNotMatch(JSON.stringify(row), /Nansen/);
  }
  assert.match(OPENER.capturedRange, /^\d{4}-\d{2}-\d{2}( to \d{4}-\d{2}-\d{2})? UTC$/);
});

test('the line under the reveal answers the pick, and does not lecture a right one', () => {
  const best = OPENER.reveal.find(t => t.best);
  assert.ok(best, 'this board has a best tape, so both branches are reachable');

  // Right pick: told so, then told the one thing still wrong with that same tape, in
  // the hard truth its own numbers generated.
  const right = OPENER.punchlines[best.handle];
  assert.equal(right.id, 'found_it');
  assert.equal(right.lead, 'You found the one that sells.');
  assert.equal(right.line, `${right.lead} ${right.tail}`, 'line is the lead and the tail joined');
  assert.ok(right.line.startsWith('You found the one that sells.'), right.line);
  assert.ok(right.line.includes(best.hardTruth.line), 'it carries that trader own hard truth');
  assert.equal(right.line.includes(OPENER_PUNCHLINE), false, 'a right pick is not told it picked on the headline');

  // Every other pick: the point of the screen, and the name of the tape that held up.
  for (const t of OPENER.reveal.filter(x => !x.best)) {
    const wrong = OPENER.punchlines[t.handle];
    assert.equal(wrong.id, 'headline', `${t.handle} gets the headline line`);
    assert.equal(wrong.lead, OPENER_PUNCHLINE);
    assert.ok(wrong.line.startsWith(OPENER_PUNCHLINE), wrong.line);
    assert.ok(wrong.line.includes(`@${best.handle}`), `${t.handle} is told who was best`);
    assert.ok(wrong.line.includes(best.realisedLabel), `${t.handle} is told what the best tape realised`);
  }
  assert.equal(Object.keys(OPENER.punchlines).length, OPENER.reveal.length);

  // With no best on the board there is no name to hand out, and the line invents none.
  const tied = punchlineFor(OPENER.reveal, null, best.handle);
  assert.equal(tied.id, 'headline');
  assert.equal(tied.tail, null);
  assert.equal(tied.line, OPENER_PUNCHLINE);
});

test('the cold open reads no model-written field and lands one line of copy', () => {
  assert.equal(OPENER.punchline, OPENER_PUNCHLINE);
  assert.equal(OPENER.punchline, 'You picked by the headline. So does an AI desk.');
  assert.equal(OPENER.question, 'Who is the best trader here?');

  // The recorded responses carry a model's own opinion of each trader. None of it may
  // reach the screen, and the fixtures still hold it so the omission is checkable.
  const printed = JSON.stringify(OPENER);
  for (const { file, body } of pairs()) {
    assert.ok(typeof body.summary === 'string', `${file} still carries the field we refuse to read`);
    assert.equal(printed.includes(body.summary), false, `${file} model summary never reaches the screen`);
    for (const flag of body.red_flags ?? []) {
      assert.equal(printed.includes(JSON.stringify(flag)), false, `${file} model red flag never reaches the screen`);
    }
  }
});

test('the four handles the founder asked for that have no usable tape are not on the board', () => {
  // pointfarmcap and rasmr_eth are not indexed by Fomo Radar and MINHxDYNASTY answers
  // with an empty tape. None of them has a fixture, so none of them can be drawn.
  for (const missing of ['pointfarmcap', 'rasmr_eth', 'minhxdynasty']) {
    assert.equal(OPENER_HANDLES.includes(missing), false);
    assert.equal(fs.existsSync(path.join(FOMO, `${missing}.json`)), false, `${missing} has no recorded tape`);
  }
  // The four the founder named that do have one are all on the board.
  for (const asked of ['frankdegods', 'orangie', 'unipcs', 'dumbcrayoneater']) {
    assert.ok(OPENER_HANDLES.includes(asked), `${asked} is on the board`);
  }
  // Every filled slot clears the bar the brief set, except the ones the founder named.
  for (const { file, row } of pairs()) {
    if (['frankdegods', 'orangie', 'unipcs', 'dumbcrayoneater'].includes(file)) continue;
    assert.ok(row.sold >= MIN_SOLD_TO_RANK, `${file} was picked for a usable tape and has one`);
  }
});
