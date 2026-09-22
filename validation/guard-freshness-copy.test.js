import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guardAllocation, BENCHMARK_GUARD_POLICY_V2, GUARD_SOURCE } from './guard.js';

test('a frozen replay never claims its evidence was retrieved recently', async () => {
  const wallet = '0x1111111111111111111111111111111111111111';
  const executor = { execute: async (_, { days }) => ({ wallet, window_days: days,
    source: GUARD_SOURCE, retrieved_at: '2026-09-15T00:00:00Z', realized_pnl_usd: -100,
    closed_trade_count: 30, win_rate: 0.5 }) };
  const decision = await guardAllocation({ executor, wallet, allocation: 2500,
    policy: BENCHMARK_GUARD_POLICY_V2, now: () => new Date('2026-09-22T00:00:00Z') });
  const freshness = decision.checks.find(row => row.id === 'evidence_freshness');
  assert.match(freshness.plain, /Frozen replay/);
  assert.doesNotMatch(freshness.plain, /recently enough/);
  assert.equal(decision.allocation, 0);
});
