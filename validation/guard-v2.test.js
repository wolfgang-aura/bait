/**
 * Contract tests for `wallet-copy-risk-v2`, the two-window execution gate.
 *
 * What these pin down: the gate reads BOTH the 7-day and the 30-day
 * `profiler/perp-pnl-summary`, it blocks on every named check, it never returns an
 * amount other than the caller's or zero, and it publishes a complete `checks` table
 * on an allow as well as on a block.
 *
 * `wallet-realized-pnl-30d-v1` stays reachable by id in the same file, because the
 * earlier single-wallet benchmark rows are tied to exactly that rule on exactly one call.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BENCHMARK_GUARD_POLICY,
  BENCHMARK_GUARD_POLICY_V2,
  COPY_RISK_THRESHOLDS,
  GUARD_SHORT_WINDOW_DAYS,
  GUARD_WINDOW_DAYS,
  PRODUCTION_GUARD_POLICY,
  PRODUCTION_GUARD_POLICY_V1,
  PRODUCTION_GUARD_POLICY_V2,
  V2_CHECK_IDS,
  guardAllocation,
} from './guard.js';
import { makeToolExecutor } from './tools.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'snapshot.fixture.json'), 'utf8'));
const WALLET = fixture.wallet;
const AT = () => new Date(fixture.retrieved_at);

/**
 * A frozen snapshot with both summaries set by hand. `armed` mode is what the bench
 * and the game already serve, and it is the only mode that holds 7 and 30 days.
 */
function executorWith({
  r30 = 100_000,
  r7 = 5_000,
  closed30 = 4_007,
  winRate30 = 0.54,
  closed7 = 424,
  winRate7 = 1,
  retrieved_at = fixture.retrieved_at,
  // The fixture's own per-market list belongs to its real -$4.7M month. A hand-set
  // month gets a per-market list consistent with it: the best market makes half.
  top5 = r30 > 0 ? [{ coin: 'BTC', realized_pnl_usd: r30 / 2 }, { coin: 'ETH', realized_pnl_usd: r30 / 4 }] : fixture.pnl_summary_30d.top5_coins,
} = {}) {
  const snapshot = structuredClone(fixture);
  Object.assign(snapshot.pnl_summary_30d, {
    realized_pnl_usd: r30, closed_trade_count: closed30, win_rate: winRate30, top5_coins: top5,
  });
  Object.assign(snapshot.pnl_summary_7d, {
    realized_pnl_usd: r7, closed_trade_count: closed7, win_rate: winRate7,
  });
  snapshot.retrieved_at = retrieved_at;
  return makeToolExecutor(snapshot, { mode: 'armed' });
}

/** Wrap an executor so one window's response can be patched or made to fail. */
function patched(executor, days, patch) {
  const original = executor.execute.bind(executor);
  return {
    ...executor,
    execute: async (name, input) => {
      const raw = await original(name, input);
      if (Number(input?.days) !== days) return raw;
      return typeof patch === 'function' ? patch(raw) : { ...raw, ...patch };
    },
  };
}

const v2 = (executor, allocation = 5_000, extra = {}) => guardAllocation({
  executor, wallet: WALLET, allocation, policy: BENCHMARK_GUARD_POLICY_V2, now: AT, ...extra,
});

const checkFor = (out, id) => out.checks.find(c => c.id === id);

// --------------------------------------------------------------- the policies

test('v3 is the default policy; v2 and v1 are still reachable by their own ids', async () => {
  assert.equal(PRODUCTION_GUARD_POLICY.id, 'wallet-copy-risk-v3');
  assert.equal(PRODUCTION_GUARD_POLICY.version, 'v3');
  assert.equal(PRODUCTION_GUARD_POLICY_V2.id, 'wallet-copy-risk-v2');
  assert.equal(PRODUCTION_GUARD_POLICY_V1.id, 'wallet-realized-pnl-30d-v1');
  assert.equal(PRODUCTION_GUARD_POLICY_V2.windowDays, GUARD_WINDOW_DAYS);
  assert.equal(PRODUCTION_GUARD_POLICY_V2.shortWindowDays, GUARD_SHORT_WINDOW_DAYS);
  // The gate and the game read the same numbers, or the report and the refusal drift.
  assert.equal(PRODUCTION_GUARD_POLICY_V2.minClosedTrades, COPY_RISK_THRESHOLDS.minClosedTrades);
  assert.equal(PRODUCTION_GUARD_POLICY_V2.minWinRate, COPY_RISK_THRESHOLDS.minWinRate);
  assert.equal(PRODUCTION_GUARD_POLICY_V2.maxPaperShareOfHeadline, COPY_RISK_THRESHOLDS.paperShareOfHeadline);
});

test('the recorded benchmark rule still decides on one 30-day call alone', async () => {
  const executor = executorWith({ r30: -4_745_429.48, r7: 35_722.86 });
  const out = await guardAllocation({
    executor, wallet: WALLET, allocation: 6_250, policy: BENCHMARK_GUARD_POLICY, now: AT,
  });
  assert.equal(out.code, 'pnl_below_minimum');
  assert.equal(out.allocation, 0);
  assert.equal(out.policy.id, 'wallet-realized-pnl-30d-benchmark-v1');
  assert.deepEqual(executor.calls.map(c => [c.tool, c.input.days]), [['get_pnl_summary', 30]]);
});

// ---------------------------------------------------------------- the gate

test('two non-negative windows with a thick sample preserve the caller amount', async () => {
  const executor = executorWith({ r30: 100_000, r7: 5_000 });
  const out = await v2(executor, 5_000);
  assert.equal(out.decision, 'allow');
  assert.equal(out.code, 'allowed');
  assert.equal(out.allocation, 5_000);
  assert.equal(out.execution_authorized, true);
  assert.equal(out.blocked, false);
  // 30 days first: a wallet that fails the long window never buys a second credit.
  assert.deepEqual(executor.calls.map(c => c.input.days), [30, 7]);
  assert.equal(out.evidence.realized_pnl_30d_usd, 100_000);
  assert.equal(out.evidence.realized_pnl_7d_usd, 5_000);
});

test('a 7-day window that disagrees in sign with the 30-day window blocks', async () => {
  const out = await v2(executorWith({ r30: 100_000, r7: -50_000 }));
  assert.equal(out.decision, 'block');
  assert.equal(out.code, 'regime_disagreement');
  assert.equal(out.allocation, 0);
  assert.equal(out.execution_authorized, false);
  assert.match(out.reason, /regime disagreement/i);
  // The rule exists because the panel measured the disagreement, so the line says so.
  assert.match(checkFor(out, 'regime_agreement').plain, /25%/);
  assert.equal(checkFor(out, 'regime_agreement').result, 'fail');
  assert.equal(checkFor(out, 'realised_pnl_30d').result, 'pass');
});

test('a week that gives back under 10% of the month is noise, not a regime change', async () => {
  // The control wallet in validation/snapshots: +$35,083 over 30 days, -$1,208 over 7.
  const allowed = await guardAllocation({
    executor: executorWith({ r30: 35_083.45, r7: -1_208 }), wallet: WALLET, allocation: 5_000, now: AT,
  });
  assert.equal(allowed.decision, 'allow');
  const regime = allowed.checks.find(c => c.id === 'regime_agreement');
  assert.equal(regime.result, 'pass');
  assert.match(regime.plain, /3.4% of the 30-day/);
  assert.match(regime.plain, /10% noise band/);

  // The same week against a month a tenth its size is a regime change.
  const blocked = await guardAllocation({
    executor: executorWith({ r30: 12_000, r7: -1_208 }), wallet: WALLET, allocation: 5_000, now: AT,
  });
  assert.equal(blocked.decision, 'block');
  assert.equal(blocked.code, 'regime_disagreement');
  assert.equal(PRODUCTION_GUARD_POLICY_V2.maxShortWindowGivebackShare, 0.10);
});

test('a negative 30-day window still blocks before the regime check is reported', async () => {
  const out = await v2(executorWith({ r30: -4_745_429.48, r7: 35_722.86 }));
  assert.equal(out.code, 'pnl_below_minimum');
  assert.equal(out.allocation, 0);
  assert.equal(checkFor(out, 'realised_pnl_30d').result, 'fail');
  assert.equal(checkFor(out, 'realised_pnl_30d').value, -4_745_429.48);
  assert.equal(checkFor(out, 'realised_pnl_30d').threshold, 0);
});

test('a thin 30-day sample blocks even when both windows made money', async () => {
  const out = await v2(executorWith({ closed30: COPY_RISK_THRESHOLDS.minClosedTrades - 1 }));
  assert.equal(out.code, 'thin_sample');
  assert.equal(out.allocation, 0);
  assert.match(out.reason, /closed trades/i);
  assert.equal(checkFor(out, 'thin_sample').value, 19);
  assert.equal(checkFor(out, 'thin_sample').threshold, 20);
  // Exactly at the threshold is enough.
  const edge = await v2(executorWith({ closed30: COPY_RISK_THRESHOLDS.minClosedTrades }));
  assert.equal(edge.decision, 'allow');
});

test('a 30-day win rate under the shared threshold blocks', async () => {
  const out = await v2(executorWith({ winRate30: 0.31 }));
  assert.equal(out.code, 'low_win_rate');
  assert.equal(out.allocation, 0);
  assert.equal(checkFor(out, 'low_win_rate').threshold, COPY_RISK_THRESHOLDS.minWinRate);
});

test('a headline that is mostly unsold blocks when the summary carries the field', async () => {
  const executor = patched(executorWith({ r30: 100_000 }), 30, {
    unrealized_pnl_usd: 900_000, headline_pnl_usd: 1_000_000,
  });
  const out = await v2(executor);
  assert.equal(out.code, 'paper_headline');
  assert.equal(out.allocation, 0);
  assert.match(checkFor(out, 'paper_headline').plain, /unsold/i);

  // Without the field the gate says it did not look, rather than passing the check.
  const silent = await v2(executorWith({ r30: 100_000 }));
  assert.equal(silent.decision, 'allow');
  assert.equal(checkFor(silent, 'paper_headline').result, 'not_assessed');
});

// ------------------------------------------------------------- fail closed

test('missing 7-day evidence blocks under v2 while v1 still allows on the 30 days alone', async () => {
  const broken = () => patched(executorWith({ r30: 100_000 }), 7, () => ({
    error: 'window_unavailable', message: 'This desk holds no 7-day window.',
  }));
  const out = await v2(broken());
  assert.equal(out.decision, 'block');
  assert.equal(out.code, 'short_window_unavailable');
  assert.equal(out.allocation, 0);
  assert.equal(checkFor(out, 'evidence_7d').result, 'fail');

  const v1 = await guardAllocation({
    executor: broken(), wallet: WALLET, allocation: 5_000,
    policy: BENCHMARK_GUARD_POLICY, now: AT,
  });
  assert.equal(v1.decision, 'allow');
  assert.equal(v1.allocation, 5_000);
  assert.equal(checkFor(v1, 'evidence_7d').result, 'not_assessed');
});

test('a 7-day response for the wrong wallet, window or source cannot authorize', async () => {
  const cases = [
    [{ wallet: '0x1111111111111111111111111111111111111111' }, 'short_window_mismatch'],
    [{ window_days: 30 }, 'short_window_mismatch'],
    [{ source: 'user supplied CSV' }, 'short_window_mismatch'],
    [{ realized_pnl_usd: 'positive' }, 'short_window_unavailable'],
  ];
  for (const [patch, code] of cases) {
    const out = await v2(patched(executorWith({ r30: 100_000 }), 7, patch));
    assert.equal(out.code, code, JSON.stringify(patch));
    assert.equal(out.allocation, 0);
  }
});

test('a 7-day fetch that throws or hangs fails closed without leaking the provider text', async () => {
  const thrown = await v2(patched(executorWith({ r30: 100_000 }), 7, () => {
    throw new Error('Nansen 503 with private request id');
  }));
  assert.equal(thrown.code, 'evidence_unavailable');
  assert.equal(thrown.reason, 'blocked: required evidence is unavailable');
  assert.match(thrown.diagnostic, /private request id/);

  const timed = await v2(patched(executorWith({ r30: 100_000 }), 7, () => new Promise(() => {})), 5_000, { timeoutMs: 20 });
  assert.equal(timed.code, 'evidence_timeout');
  assert.equal(timed.allocation, 0);
});

test('stale 30-day evidence blocks before a 7-day credit is ever spent', async () => {
  const executor = executorWith({ retrieved_at: '2026-09-21T03:00:00.000Z' });
  const out = await guardAllocation({
    executor, wallet: WALLET, allocation: 5_000,
    policy: PRODUCTION_GUARD_POLICY_V2, now: () => new Date('2026-09-21T03:30:00.000Z'),
  });
  assert.equal(out.code, 'stale_evidence');
  assert.equal(out.allocation, 0);
  assert.deepEqual(executor.calls.map(c => c.input.days), [30], 'a dead check must not buy a second window');
});

test('v2 never emits an amount other than the caller amount or zero', async () => {
  for (const attempt of [0, 1, 250.75, 5_000, 1_000_000]) {
    const allow = await v2(executorWith({ r30: 100_000 }), attempt);
    assert.equal(allow.allocation, attempt);
    const block = await v2(executorWith({ r30: -1 }), attempt);
    assert.equal(block.allocation, 0);
  }
});

// ------------------------------------------------------------ the check table

test('the checks table is complete and readable on an allow and on a block', async () => {
  const allow = await v2(executorWith({ r30: 100_000 }));
  const block = await v2(executorWith({ r30: 100_000, r7: -50_000 }));

  for (const out of [allow, block]) {
    assert.deepEqual(out.checks.map(c => c.id), V2_CHECK_IDS);
    for (const check of out.checks) {
      assert.ok(['pass', 'fail', 'not_assessed'].includes(check.result), `${check.id} result`);
      assert.ok('value' in check && 'threshold' in check, `${check.id} carries a number and a bar`);
      assert.ok(typeof check.plain === 'string' && check.plain.length > 10, `${check.id} plain line`);
    }
  }
  assert.equal(allow.checks.filter(c => c.result === 'fail').length, 0);
  assert.equal(block.checks.filter(c => c.result === 'fail').length, 1);
  // Fills are not fetched by the guard path, so these are honestly not assessed.
  // Concentration is judged from the 30-day summary's own per-market list.
  assert.equal(checkFor(allow, 'concentration').result, 'pass');
  for (const id of ['tail_loss', 'max_drawdown']) {
    assert.equal(checkFor(allow, id).result, 'not_assessed');
    assert.match(checkFor(allow, id).plain, /fill/i);
  }
});

test('an invalid request reports the full table without calling the provider', async () => {
  let calls = 0;
  const out = await guardAllocation({
    executor: { async execute() { calls += 1; return {}; } },
    wallet: 'not-a-wallet', allocation: 10, policy: PRODUCTION_GUARD_POLICY_V2,
  });
  assert.equal(calls, 0);
  assert.equal(out.code, 'invalid_request');
  assert.equal(out.execution_authorized, false);
  assert.deepEqual(out.checks.map(c => c.id), V2_CHECK_IDS);
  assert.ok(out.checks.every(c => c.result === 'not_assessed'));
});
