import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BENCHMARK_GUARD_POLICY,
  BENCHMARK_GUARD_POLICY_V2,
  GUARD_SOURCE,
  GUARD_WINDOW_DAYS,
  PRODUCTION_GUARD_POLICY,
  guardAllocation,
} from './guard.js';
import { makeToolExecutor } from './tools.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'snapshot.fixture.json'), 'utf8'));
const WALLET = fixture.wallet;

const executorWith = (realized_pnl_usd, changes = {}) => {
  const snapshot = structuredClone(fixture);
  snapshot.pnl_summary_30d.realized_pnl_usd = realized_pnl_usd;
  Object.assign(snapshot, changes);
  return makeToolExecutor(snapshot, { mode: 'armed' });
};

const benchmarkInput = (realized_pnl_usd, allocation = 2500) => ({
  executor: executorWith(realized_pnl_usd),
  wallet: WALLET,
  allocation,
  policy: BENCHMARK_GUARD_POLICY,
  now: () => new Date(fixture.retrieved_at),
});

test('a negative verified PnL forces zero and records the attempted allocation', async () => {
  const input = benchmarkInput(-4_745_429.48, 6250);
  const out = await guardAllocation(input);
  assert.equal(out.decision, 'block');
  assert.equal(out.code, 'pnl_below_minimum');
  assert.equal(out.allocation, 0);
  assert.equal(out.attempted, 6250);
  assert.equal(out.blocked, true);
  assert.equal(out.evidence.realized_pnl_usd, -4_745_429.48);
  assert.equal(out.policy.id, BENCHMARK_GUARD_POLICY.id);
  assert.deepEqual(input.executor.calls.map(c => [c.tool, c.input]), [[
    'get_pnl_summary', { wallet: WALLET, days: GUARD_WINDOW_DAYS },
  ]]);
});

test('a fresh, matching, non-negative result preserves the proposed allocation', async () => {
  const retrievedAt = '2026-09-21T03:00:00.000Z';
  const executor = executorWith(125_000.5, { retrieved_at: retrievedAt });
  const out = await guardAllocation({
    executor,
    wallet: WALLET,
    allocation: 6250,
    now: () => new Date('2026-09-21T03:10:00.000Z'),
  });
  assert.equal(out.decision, 'allow');
  assert.equal(out.code, 'allowed');
  assert.equal(out.allocation, 6250);
  assert.equal(out.blocked, false);
  assert.equal(out.policy.id, PRODUCTION_GUARD_POLICY.id);
});

test('the policy threshold is configurable without changing the model prompt', async () => {
  const out = await guardAllocation({
    ...benchmarkInput(999, 100),
    policy: { ...BENCHMARK_GUARD_POLICY, id: 'minimum-1000', minimumRealizedPnlUsd: 1000 },
  });
  assert.equal(out.code, 'pnl_below_minimum');
  assert.equal(out.allocation, 0);
});

test('missing, non-finite, and executor error evidence fail closed', async () => {
  for (const value of [undefined, Number.NaN, 'positive', Infinity]) {
    const out = await guardAllocation(benchmarkInput(value));
    assert.equal(out.code, 'evidence_unavailable', `value ${String(value)}`);
    assert.equal(out.allocation, 0);
  }
  const executor = { async execute() { return { error: 'upstream', message: 'provider failed' }; } };
  const out = await guardAllocation({ ...benchmarkInput(1), executor });
  assert.equal(out.code, 'evidence_unavailable');
  assert.equal(out.diagnostic, 'provider failed');
});

test('a result for a different wallet cannot authorize the allocation', async () => {
  const executor = executorWith(100);
  const original = executor.execute.bind(executor);
  executor.execute = async (...args) => ({ ...(await original(...args)), wallet: '0x1111111111111111111111111111111111111111' });
  const out = await guardAllocation({ ...benchmarkInput(1), executor });
  assert.equal(out.code, 'wallet_mismatch');
  assert.equal(out.allocation, 0);
});

test('a shorter window cannot answer the 30-day policy', async () => {
  const executor = executorWith(100);
  const original = executor.execute.bind(executor);
  executor.execute = async (...args) => ({ ...(await original(...args)), window_days: 7 });
  const out = await guardAllocation({ ...benchmarkInput(1), executor });
  assert.equal(out.code, 'window_mismatch');
});

test('an unapproved source cannot authorize the allocation', async () => {
  const executor = executorWith(100);
  const original = executor.execute.bind(executor);
  executor.execute = async (...args) => ({ ...(await original(...args)), source: 'user supplied CSV' });
  const out = await guardAllocation({ ...benchmarkInput(1), executor });
  assert.equal(out.code, 'source_mismatch');
  assert.equal(out.evidence.source, 'user supplied CSV');
});

test('production policy blocks stale, invalid, and implausibly future timestamps', async () => {
  const now = () => new Date('2026-09-21T03:30:00.000Z');
  for (const [retrieved_at, code] of [
    ['2026-09-21T03:00:00.000Z', 'stale_evidence'],
    ['not-a-date', 'invalid_timestamp'],
    ['2026-09-21T03:36:00.000Z', 'future_evidence'],
  ]) {
    const executor = executorWith(100, { retrieved_at });
    const out = await guardAllocation({ executor, wallet: WALLET, allocation: 100, now });
    assert.equal(out.code, code, retrieved_at);
    assert.equal(out.allocation, 0);
  }
});

test('benchmark policy keeps frozen evidence reproducible while retaining all other checks', async () => {
  const out = await guardAllocation({
    ...benchmarkInput(100, 100),
    now: () => new Date('2030-01-01T00:00:00.000Z'),
  });
  assert.equal(out.code, 'allowed');
  assert.equal(out.policy.max_evidence_age_ms, null);
});

test('executor exceptions and timeouts fail closed without leaking them into the public reason', async () => {
  const thrown = await guardAllocation({
    ...benchmarkInput(1, 5000),
    executor: { async execute() { throw new Error('Nansen 503 with private request id'); } },
  });
  assert.equal(thrown.code, 'evidence_unavailable');
  assert.equal(thrown.reason, 'blocked: required evidence is unavailable');
  assert.match(thrown.diagnostic, /private request id/);

  const timed = await guardAllocation({
    ...benchmarkInput(1, 5000),
    executor: { execute() { return new Promise(() => {}); } },
    timeoutMs: 5,
  });
  assert.equal(timed.code, 'evidence_timeout');
  assert.equal(timed.allocation, 0);
});

test('invalid wallet, allocation, executor, and timeout are refused before a call', async () => {
  let calls = 0;
  const executor = { async execute() { calls++; return {}; } };
  const cases = [
    { executor, wallet: 'not-a-wallet', allocation: 10 },
    { executor, wallet: WALLET, allocation: -1 },
    { executor, wallet: WALLET, allocation: Number.NaN },
    { executor: null, wallet: WALLET, allocation: 10 },
    { executor, wallet: WALLET, allocation: 10, timeoutMs: 0 },
  ];
  for (const input of cases) {
    const out = await guardAllocation(input);
    assert.equal(out.code, 'invalid_request');
    assert.equal(out.allocation, 0);
  }
  assert.equal(calls, 0);
});

test('a zero proposal is checked and reported but is not counted as a blocked attempt', async () => {
  const out = await guardAllocation(benchmarkInput(-1, 0));
  assert.equal(out.decision, 'block');
  assert.equal(out.allocation, 0);
  assert.equal(out.attempted, 0);
  assert.equal(out.blocked, false);
});

test('invalid policy configuration is rejected as a developer error', async () => {
  await assert.rejects(
    guardAllocation({ ...benchmarkInput(1), policy: { maxEvidenceAgeMs: -1 } }),
    /maxEvidenceAgeMs/,
  );
});

test('the production source contract is the Nansen PnL summary endpoint', () => {
  assert.equal(PRODUCTION_GUARD_POLICY.source, GUARD_SOURCE);
  assert.equal(PRODUCTION_GUARD_POLICY.windowDays, 30);
  assert.equal(PRODUCTION_GUARD_POLICY.minimumRealizedPnlUsd, 0);
});

// ------------------------------------------------ top-coin concentration (v2)

const v2Input = (r30, top5, { r7 = 1_000, allocation = 5_000, policy = BENCHMARK_GUARD_POLICY_V2 } = {}) => {
  const snapshot = structuredClone(fixture);
  Object.assign(snapshot.pnl_summary_30d, { realized_pnl_usd: r30, closed_trade_count: 2_064, win_rate: 0.6, top5_coins: top5 });
  Object.assign(snapshot.pnl_summary_7d, { realized_pnl_usd: r7 });
  return { executor: makeToolExecutor(snapshot, { mode: 'armed' }), wallet: WALLET, allocation, policy, now: () => new Date(fixture.retrieved_at) };
};
const row = (out, id) => out.checks.find(c => c.id === id);

test('one market that out-earns the whole month is refused, and the line names it', async () => {
  // The shape of the original profitable control: HYPE +$52,030 inside a +$35,083 month.
  const out = await guardAllocation(v2Input(35_083, [
    { coin: 'HYPE', realized_pnl_usd: 52_030 }, { coin: 'VVV', realized_pnl_usd: 1_395 }, { coin: 'ZEC', realized_pnl_usd: -282 },
  ]));
  assert.equal(out.decision, 'block');
  assert.equal(out.code, 'top_coin_concentration');
  assert.equal(out.allocation, 0);
  assert.equal(out.reason, 'blocked: one market carries more than 100% of the 30-day realised PnL');
  const c = row(out, 'concentration');
  assert.equal(c.result, 'fail');
  assert.equal(c.value, 'HYPE +$52,030 of +$35,083');
  assert.match(c.plain, /^HYPE alone made \+\$52,030, 148\.3% of the 30-day \+\$35,083\. Everything else it traded came to -\$16,947/);
});

test('a month led by one market but not rescued by it passes the gate', async () => {
  const out = await guardAllocation(v2Input(3_866_286, [
    { coin: 'BTC', realized_pnl_usd: 2_192_969 }, { coin: 'HYPE', realized_pnl_usd: 924_145 },
  ]));
  assert.equal(out.decision, 'allow');
  const c = row(out, 'concentration');
  assert.equal(c.result, 'pass');
  assert.match(c.plain, /BTC, made 56\.7% of the 30-day result/);
  // Exactly the whole month in one market is at the bar, not over it.
  const single = await guardAllocation(v2Input(100, [{ coin: 'BTC', realized_pnl_usd: 100 }]));
  assert.equal(row(single, 'concentration').result, 'pass');
  // Its text must not claim the profit is spread out (seen on THE CLEAN SHEET, 25 Sep 2026).
  assert.doesNotMatch(row(single, 'concentration').plain, /does not rest on one market/);
  assert.match(row(single, 'concentration').plain, /made 100\.0% of the 30-day result, and everything else it traded came to \$0, so no one market carried a book that otherwise lost money/);
  assert.match(c.plain, /everything else it traded came to \+\$1,673,317/);
  // The executor rounds the total to cents; the per-market figure is not rounded.
  const rounded = await guardAllocation(v2Input(6_890_819.833430001, [{ coin: 'BTC', realized_pnl_usd: 6_890_819.833430001 }]));
  assert.equal(row(rounded, 'concentration').result, 'pass', 'rounding to cents is not concentration');
});

test('concentration reads top5_coins from a live-shaped summary as well as the desk executor', async () => {
  const wallet = '0x1111111111111111111111111111111111111111';
  const executor = { execute: async (_, { days }) => ({ wallet, window_days: days, source: GUARD_SOURCE,
    retrieved_at: '2026-09-22T00:00:00Z', realized_pnl_usd: days === 30 ? 10_000 : 500, closed_trade_count: 300, win_rate: 0.5,
    top5_coins: [{ coin: 'SOL', realized_pnl_usd: 12_000 }] }) };
  const out = await guardAllocation({ executor, wallet, allocation: 100, policy: BENCHMARK_GUARD_POLICY_V2, now: () => new Date('2026-09-22T00:00:00Z') });
  assert.equal(out.code, 'top_coin_concentration');
});

test('concentration says what it did not look at instead of passing', async () => {
  const missing = await guardAllocation(v2Input(50_000, []));
  assert.equal(missing.decision, 'allow');
  assert.equal(row(missing, 'concentration').result, 'not_assessed');
  assert.match(row(missing, 'concentration').plain, /no per-market breakdown/);

  const off = await guardAllocation({ ...v2Input(35_083, [{ coin: 'HYPE', realized_pnl_usd: 52_030 }]),
    policy: { ...BENCHMARK_GUARD_POLICY_V2, id: 'no-concentration', maxTopCoinPnlShare: null } });
  assert.equal(off.decision, 'allow', 'switching the check off restores the pre-check decision');
  assert.equal(row(off, 'concentration').result, 'not_assessed');

  const losing = await guardAllocation(v2Input(-10_000, [{ coin: 'HYPE', realized_pnl_usd: 52_030 }]));
  assert.equal(losing.code, 'pnl_below_minimum', 'a losing month is refused on its sign, not on concentration');
  assert.equal(row(losing, 'concentration').result, 'not_assessed');

  const v1 = await guardAllocation({ ...v2Input(35_083, [{ coin: 'HYPE', realized_pnl_usd: 52_030 }]), policy: BENCHMARK_GUARD_POLICY });
  assert.equal(v1.decision, 'allow', 'the recorded one-rule gate is unchanged');
  assert.equal(row(v1, 'concentration').result, 'not_assessed');

  await assert.rejects(guardAllocation({ ...v2Input(1, []), policy: { ...BENCHMARK_GUARD_POLICY_V2, maxTopCoinPnlShare: -1 } }), /maxTopCoinPnlShare/);
});

// ------------------------------------------------------- freshness, frozen vs live

test('frozen replay freshness is not assessed and names the capture date; a live policy still passes it', async () => {
  for (const policy of [BENCHMARK_GUARD_POLICY, BENCHMARK_GUARD_POLICY_V2]) {
    const out = await guardAllocation({ ...benchmarkInput(-1), policy });
    const fresh = row(out, 'evidence_freshness');
    assert.equal(fresh.result, 'not_assessed', policy.id);
    assert.equal(fresh.plain, `N/A (snapshot): frozen capture dated ${fixture.retrieved_at.slice(0, 10)}; age is not checked.`);
  }
  const live = await guardAllocation({
    executor: executorWith(125_000.5, { retrieved_at: '2026-09-21T03:00:00.000Z' }), wallet: WALLET, allocation: 10,
    now: () => new Date('2026-09-21T03:10:00.000Z'),
  });
  assert.equal(row(live, 'evidence_freshness').result, 'pass');
  // A future-dated frozen capture still fails: no age limit is not no clock check.
  const future = await guardAllocation({ ...benchmarkInput(-1), now: () => new Date(Date.parse(fixture.retrieved_at) - 3_600_000) });
  assert.equal(future.code, 'future_evidence');
});
