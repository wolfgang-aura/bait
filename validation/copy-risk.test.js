/**
 * The copy-risk report: deterministic, offline, and separate from the execution gate.
 *
 * `guardAllocation` is not touched by any of this. These tests pin the arithmetic and
 * the wording of `assessCopyRisk`, including a hand-built drawdown series whose answer
 * can be checked on paper.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { assessCopyRisk, drawdownOf, agentVerdictLine, COPY_RISK_THRESHOLDS } from './guard.js';

/** A record with nothing wrong with it, used as the baseline for every single flag. */
const clean = () => ({
  address: '0x1111111111111111111111111111111111111111',
  venue: 'hyperliquid',
  source: 'Nansen /api/v1/profiler/perp-pnl-summary',
  retrieved_at: '2026-09-15T10:40:31Z',
  window: { from: '2026-08-16T10:40:31Z', to: '2026-09-15T10:40:31Z' },
  window_days: 30,
  realized_pnl_usd: 120_000,
  unrealized_pnl_usd: null,
  headline_pnl_usd: null,
  closed_trade_count: 400,
  win_rate: 0.55,
  realised_series: Array.from({ length: 400 }, () => 300),
  top_position_share: 0.2,
  top_coin_pnl_share: 0.3,
  worst_trade_usd: -1_000,
  volume_usd: 5_000_000,
  account_value_usd: 2_000_000,
  early_entry_share: 0.05,
});

test('drawdown is peak to trough of cumulative realised PnL, oldest trade first', () => {
  // +100, +100, -150, -50, +80: cumulative 100, 200, 50, 0, 80.
  // The peak is 200 and the trough after it is 0, so the drawdown is 200.
  const d = drawdownOf([100, 100, -150, -50, 80]);
  assert.equal(d.max_drawdown_usd, 200);
  assert.equal(d.peak_usd, 200);
  assert.equal(d.trough_usd, 0);
  assert.equal(d.final_usd, 80);
  assert.equal(d.share_of_peak, 1);
  assert.equal(d.trades, 5);

  // A series that only ever goes up never draws down.
  assert.equal(drawdownOf([10, 20, 30]).max_drawdown_usd, 0);
  assert.equal(drawdownOf([10, 20, 30]).share_of_peak, 0);

  // A series that starts underwater has no peak above zero to fall from, so the fall
  // is measured from the best point reached, which is zero at the start.
  const sinking = drawdownOf([-40, -60]);
  assert.equal(sinking.max_drawdown_usd, 100);
  assert.equal(sinking.peak_usd, 0);
  assert.equal(sinking.share_of_peak, null, 'a drawdown from zero has no meaningful share');

  // Order matters, which is the whole reason this reads a series and not a total. The
  // same five trades taking the loss first bottom out at -150 against a starting peak
  // of zero, so the worst fall is 150 rather than 200.
  assert.equal(drawdownOf([-150, 100, 100, -50, 80]).max_drawdown_usd, 150);
  assert.equal(drawdownOf([100, 100, -150, -50, 80]).final_usd, drawdownOf([-150, 100, 100, -50, 80]).final_usd);
  // Two losses back to back before any gain is a deeper hole than the same four trades
  // alternating, even though both end at +80.
  assert.equal(drawdownOf([100, -60, 100, -60]).max_drawdown_usd, 60);
  assert.equal(drawdownOf([-60, -60, 100, 100]).max_drawdown_usd, 120);
  assert.equal(drawdownOf([100, -60, 100, -60]).final_usd, drawdownOf([-60, -60, 100, 100]).final_usd);

  // No trades is not a drawdown of zero, it is an unknown.
  assert.equal(drawdownOf([]).max_drawdown_usd, null);
  assert.equal(drawdownOf(undefined).max_drawdown_usd, null);
  assert.equal(drawdownOf(['nonsense', null]).max_drawdown_usd, null);
});

test('a clean record raises nothing but does not authorize execution', () => {
  const r = assessCopyRisk(clean());
  assert.deepEqual(r.flags, []);
  assert.equal(r.verdict, 'allow');
  assert.equal(r.execution_authorized, false);
  assert.deepEqual(r.required_missing, []);
  assert.equal(r.max_drawdown.max_drawdown_usd, 0);
  assert.equal(r.summary.verdict, 'allow');
  assert.deepEqual(r.summary.flags, []);
  assert.equal(r.summary.address, clean().address);
  assert.equal(r.summary.evidence.source, clean().source);
  assert.equal(r.summary.evidence.window_days, 30);
});

test('each check fires on its own threshold and nowhere else', () => {
  const fires = (patch, id) => {
    const r = assessCopyRisk({ ...clean(), ...patch });
    assert.ok(r.flags.some(f => f.id === id), `${id} should fire`);
    return r.flags.find(f => f.id === id);
  };

  const negative = fires({ realized_pnl_usd: -1 }, 'realised_negative');
  assert.equal(negative.severity, 'high');
  assert.match(negative.plain, /Copying this wallet would have lost money too/);

  // Unrealised above 80% of the headline, and above 80% of realised plus unrealised.
  const paper = fires({ unrealized_pnl_usd: 9_000, headline_pnl_usd: 10_000, realized_pnl_usd: 1_000 }, 'paper_headline');
  assert.match(paper.plain, /Most of this number is unsold/);
  assert.equal(assessCopyRisk({ ...clean(), unrealized_pnl_usd: 1_000, headline_pnl_usd: 10_000, realized_pnl_usd: 9_000 })
    .flags.some(f => f.id === 'paper_headline'), false, 'a mostly realised headline is not flagged');

  assert.match(fires({ closed_trade_count: COPY_RISK_THRESHOLDS.minClosedTrades - 1 }, 'thin_sample').plain, /Not enough closed trades/);
  assert.equal(assessCopyRisk({ ...clean(), closed_trade_count: COPY_RISK_THRESHOLDS.minClosedTrades })
    .flags.some(f => f.id === 'thin_sample'), false, 'the threshold itself passes');

  assert.match(fires({ win_rate: 0.39 }, 'low_win_rate').plain, /the winners carry it/);
  assert.match(fires({ early_entry_share: 0.21 }, 'uncopyable_entries').plain, /cannot copy with any lag/);
  assert.match(fires({ top_position_share: 0.51 }, 'concentration').plain, /One market carried the result/);
  assert.match(fires({ top_coin_pnl_share: 0.61 }, 'concentration').plain, /One market carried the result/);
  assert.match(fires({ worst_trade_usd: -600_000, account_value_usd: 1_000_000 }, 'tail_loss').plain, /quarter of the book/);

  // A drawdown over 30% of the peak, on a series whose arithmetic is obvious.
  const drop = fires({ realised_series: [1_000, -400], account_value_usd: null, volume_usd: null }, 'max_drawdown');
  assert.match(drop.plain, /you would have been down \$400 from the top of this window\./);
  assert.equal(drop.evidence.max_drawdown_usd, 400);
  assert.equal(drop.evidence.peak_usd, 1_000);

  // The same fall against a large account is survivable and is not flagged.
  assert.equal(
    assessCopyRisk({ ...clean(), realised_series: [1_000, -200] }).flags.some(f => f.id === 'max_drawdown'),
    false,
    'a 20% fall from the peak is under the threshold',
  );
});

test('a missing input is reported as not assessed rather than counted as a pass or a flag', () => {
  const bare = assessCopyRisk({ address: '0x2222222222222222222222222222222222222222' });
  assert.deepEqual(bare.flags, []);
  assert.equal(bare.verdict, 'insufficient', 'missing evidence cannot become a green result');
  assert.equal(bare.execution_authorized, false);
  assert.deepEqual(bare.required_missing.sort(), ['realized_pnl_usd', 'retrieved_at', 'source', 'window_days']);
  const skipped = bare.not_assessed.map(n => n.id);
  for (const id of ['realised_negative', 'paper_headline', 'thin_sample', 'low_win_rate',
    'uncopyable_entries', 'concentration', 'tail_loss', 'max_drawdown']) {
    assert.ok(skipped.includes(id), `${id} says why it could not run`);
  }
  for (const row of bare.not_assessed) assert.match(row.reason, /^[a-z]/, 'the reason is a sentence fragment a person can read');

  // Launch times are the one check no venue in this repository carries evidence for.
  const launch = assessCopyRisk({ ...clean(), early_entry_share: null });
  assert.ok(launch.not_assessed.some(n => n.id === 'uncopyable_entries' && /launch times/.test(n.reason)));
});

test('the verdict blocks a realised loss and otherwise reports concerns without sizing capital', () => {
  const one = assessCopyRisk({ ...clean(), win_rate: 0.1 });
  assert.equal(one.flags.length, 1);
  assert.equal(one.verdict, 'caution');
  assert.equal(one.execution_authorized, false);

  const two = assessCopyRisk({ ...clean(), win_rate: 0.1, closed_trade_count: 4 });
  assert.equal(two.flags.length, 2);
  assert.equal(two.verdict, 'caution');

  const three = assessCopyRisk({ ...clean(), win_rate: 0.1, closed_trade_count: 4, top_position_share: 0.9 });
  assert.equal(three.flags.length, 3);
  assert.equal(three.verdict, 'caution');
  assert.equal(three.execution_authorized, false);

  // One realised loss blocks on its own, even with nothing else against the record.
  const loss = assessCopyRisk({ ...clean(), realized_pnl_usd: -5 });
  assert.equal(loss.flags.length, 1);
  assert.equal(loss.verdict, 'block');
  assert.equal(loss.execution_authorized, false);
});

test('the same evidence always gives the same answer', () => {
  const evidence = { ...clean(), win_rate: 0.2, closed_trade_count: 3 };
  assert.deepEqual(assessCopyRisk(evidence), assessCopyRisk(evidence));
  assert.deepEqual(assessCopyRisk(evidence).summary, assessCopyRisk({ ...evidence }).summary);
});

test('the agent line keeps assessment separate from execution', () => {
  assert.match(agentVerdictLine('allow'), /fresh evidence before allocating/);
  assert.match(agentVerdictLine('caution'), /does not prescribe a position size/);
  assert.match(agentVerdictLine('block'), /guard rule blocks allocation/);
  assert.match(agentVerdictLine('insufficient'), /cannot assess/);
  assert.match(agentVerdictLine('nonsense'), /cannot authorize/);
});
