import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BENCHMARK_GUARD_POLICY,
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
  assert.equal(thrown.reason, 'blocked: Nansen evidence is unavailable');
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
