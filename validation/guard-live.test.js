/**
 * Contract tests for the live evidence path. No network: every Nansen call is a stub.
 *
 * What these lock down: the guard sees exactly the same evidence shape live as it sees
 * from a frozen snapshot, a check costs one call per window it reads and never more,
 * and every provider failure reaches the guard as unusable evidence, not as a number.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  GUARD_SOURCE,
  GUARD_WINDOW_DAYS,
  PRODUCTION_GUARD_POLICY,
  PRODUCTION_GUARD_POLICY_V1,
  PRODUCTION_GUARD_POLICY_V2,
  guardAllocation,
} from './guard.js';
import { GUARD_ENDPOINT, createLiveGuardExecutor, runLiveGuard } from './guard-live.js';

const WALLET = '0xC26CBB6483229E0D0F9A1CAB675271EDA535B8F4';
const NOW = '2026-09-21T09:00:00.000Z';

/** A Nansen response in the shape validation/live.js reads: body.data.data. */
const summary = (realized_pnl_usd, extra = {}) => ({
  status: 200,
  headers: {},
  data: { data: { realized_pnl_usd, win_rate: 0.41, closed_trade_count: 88, ...extra } },
});

function stubCall(responder) {
  const calls = [];
  const call = async (path, body, opts) => {
    calls.push({ path, body, opts });
    return responder(calls.length);
  };
  call.calls = calls;
  return call;
}

test('a live summary maps into the exact evidence shape the snapshot tools serve', async () => {
  const call = stubCall(() => summary(12_345.6789));
  const executor = createLiveGuardExecutor({ call, now: () => new Date(NOW) });

  const evidence = await executor.execute('get_pnl_summary', { wallet: WALLET, days: GUARD_WINDOW_DAYS });

  assert.deepEqual(evidence, {
    wallet: WALLET.toLowerCase(),
    window_days: 30,
    window: { from: '2026-08-22T09:00:00Z', to: '2026-09-21T09:00:00Z' },
    realized_pnl_usd: 12_345.68,
    // Same response, same two fields the frozen snapshot path serves, so the sample
    // size and win-rate checks read the same numbers live as they do in the bench.
    win_rate: 0.41,
    closed_trade_count: 88,
    // The per-coin breakdown, passed through for the concentration check.
    top5_coins: evidence.top5_coins,
    retrieved_at: NOW,
    source: GUARD_SOURCE,
  });
  assert.equal(call.calls.length, 1);
  assert.equal(call.calls[0].path, GUARD_ENDPOINT);
  assert.deepEqual(call.calls[0].body, {
    address: WALLET.toLowerCase(),
    date: { from: '2026-08-22T09:00:00Z', to: '2026-09-21T09:00:00Z' },
  });
});

test('the v1 check makes exactly one Nansen call and charges one credit', async () => {
  const call = stubCall(() => summary(500));
  const decision = await runLiveGuard({
    wallet: WALLET,
    allocation: 5000,
    call,
    now: () => new Date(NOW),
  });

  assert.equal(call.calls.length, 1, 'the v1 guard may spend exactly one credit per check');
  assert.equal(decision.creditsCharged, 1);
  assert.equal(decision.decision, 'allow');
  assert.equal(decision.allocation, 5000);
  // runLiveGuard is pinned to v1 by default; `/api/guard` and its contract test in
  // prototype/ depend on that. v2 is opt-in here and is the default in scripts/guard.mjs.
  assert.equal(decision.policy.id, PRODUCTION_GUARD_POLICY_V1.id);
  assert.equal(decision.evidence.realized_pnl_usd, 500);
});

test('the v2 check reads both windows, charges two credits and publishes the table', async () => {
  const call = stubCall(n => summary(n === 1 ? 500 : 120));
  const decision = await runLiveGuard({
    wallet: WALLET,
    allocation: 5000,
    policy: PRODUCTION_GUARD_POLICY_V2,
    call,
    now: () => new Date(NOW),
  });

  assert.equal(call.calls.length, 2, 'one call per window, never more');
  assert.equal(decision.creditsCharged, 2);
  assert.equal(decision.decision, 'allow');
  assert.equal(decision.execution_authorized, true);
  assert.equal(decision.policy.id, PRODUCTION_GUARD_POLICY_V2.id, 'the policy asked for is the policy applied');
  assert.equal(decision.evidence.realized_pnl_30d_usd, 500);
  assert.equal(decision.evidence.realized_pnl_7d_usd, 120);
  // The 30-day request is asked first, and the 7-day window covers seven days.
  assert.deepEqual(call.calls.map(c => c.body.date.from), ['2026-08-22T09:00:00Z', '2026-09-14T09:00:00Z']);
  assert.ok(decision.checks.some(c => c.id === 'regime_agreement' && c.result === 'pass'));
});

test('v2 refuses on a 7-day window that contradicts the 30-day one', async () => {
  const call = stubCall(n => summary(n === 1 ? 500 : -120));
  const decision = await runLiveGuard({
    wallet: WALLET, allocation: 5000, policy: PRODUCTION_GUARD_POLICY_V2, call, now: () => new Date(NOW),
  });

  assert.equal(decision.decision, 'block');
  assert.equal(decision.code, 'regime_disagreement');
  assert.equal(decision.allocation, 0);
  assert.equal(decision.creditsCharged, 2);
});

test('a 30-day refusal under v2 never buys the second window', async () => {
  const call = stubCall(() => summary(-4_745_429.48));
  const decision = await runLiveGuard({
    wallet: WALLET, allocation: 5000, policy: PRODUCTION_GUARD_POLICY_V2, call, now: () => new Date(NOW),
  });

  assert.equal(decision.code, 'pnl_below_minimum');
  assert.equal(call.calls.length, 1, 'a decided refusal must not spend a second credit');
  assert.equal(decision.creditsCharged, 1);
});

test('a negative live result blocks and reports the attempted amount', async () => {
  const call = stubCall(() => summary(-4_745_429.4812));
  const decision = await runLiveGuard({ wallet: WALLET, allocation: 5000, call, now: () => new Date(NOW) });

  assert.equal(decision.decision, 'block');
  assert.equal(decision.code, 'pnl_below_minimum');
  assert.equal(decision.allocation, 0);
  assert.equal(decision.attempted, 5000);
  assert.equal(decision.evidence.realized_pnl_usd, -4_745_429.48);
});

test('a provider error fails closed and never returns the proposed amount', async () => {
  const call = async () => {
    const err = new Error('Nansen 500 on profiler/perp-pnl-summary: upstream failure');
    err.status = 500;
    throw err;
  };
  const decision = await runLiveGuard({ wallet: WALLET, allocation: 5000, call, now: () => new Date(NOW) });

  assert.equal(decision.decision, 'block');
  assert.equal(decision.code, 'evidence_unavailable');
  assert.equal(decision.allocation, 0);
  assert.equal(decision.evidence.realized_pnl_usd, null);
  assert.match(decision.diagnostic, /upstream failure/);
});

test('a 200 response with no realised PnL is reported as unavailable, not as zero', async () => {
  const call = stubCall(() => ({ status: 200, headers: {}, data: { data: { win_rate: 0.5 } } }));
  const executor = createLiveGuardExecutor({ call, now: () => new Date(NOW) });
  const raw = await executor.execute('get_pnl_summary', { wallet: WALLET, days: 30 });

  assert.equal(raw.error, 'evidence_unavailable');
  assert.match(raw.message, /no realised PnL/);

  const decision = await runLiveGuard({ wallet: WALLET, allocation: 5000, call: stubCall(() => ({ status: 200, headers: {}, data: null })), now: () => new Date(NOW) });
  assert.equal(decision.decision, 'block');
  assert.equal(decision.code, 'evidence_unavailable');
  assert.equal(decision.allocation, 0);
});

test('the live executor refuses any tool other than get_pnl_summary and get_open_positions', async () => {
  const call = stubCall(() => summary(1));
  const executor = createLiveGuardExecutor({ call, now: () => new Date(NOW) });

  await assert.rejects(
    () => executor.execute('get_closed_trades', { wallet: WALLET, days: 30 }),
    /serves get_pnl_summary, get_open_positions, get_independent_record, get_smart_money_market and get_operator only/,
  );
  assert.equal(call.calls.length, 0, 'an unknown tool must not spend a credit');
});

test('evidence older than the production freshness limit blocks as stale', async () => {
  const call = stubCall(() => summary(900_000));
  const executor = createLiveGuardExecutor({ call, now: () => new Date('2026-09-21T08:00:00.000Z') });
  const decision = await guardAllocation({
    executor,
    wallet: WALLET,
    allocation: 5000,
    policy: PRODUCTION_GUARD_POLICY,
    now: () => new Date(NOW),
  });

  assert.equal(decision.code, 'stale_evidence');
  assert.equal(decision.allocation, 0);
});

test('future-dated evidence blocks rather than passing a clock skew through', async () => {
  const call = stubCall(() => summary(900_000));
  const executor = createLiveGuardExecutor({ call, now: () => new Date('2026-09-21T09:30:00.000Z') });
  const decision = await guardAllocation({
    executor,
    wallet: WALLET,
    allocation: 5000,
    policy: PRODUCTION_GUARD_POLICY,
    now: () => new Date(NOW),
  });

  assert.equal(decision.code, 'future_evidence');
  assert.equal(decision.allocation, 0);
});

test('an invalid wallet is refused before any credit is spent', async () => {
  const call = stubCall(() => summary(1));
  const decision = await runLiveGuard({ wallet: 'not-an-address', allocation: 5000, call, now: () => new Date(NOW) });

  assert.equal(decision.code, 'invalid_request');
  assert.equal(decision.allocation, 0);
  assert.equal(call.calls.length, 0);
  assert.equal(decision.creditsCharged, 0);
});

test('v5 live: get_operator reads related-wallets per chain, the funding once, and the indexed siblings over the gate window', async () => {
  const F = '0x' + 'f'.repeat(40);
  const S = '0x' + '1'.repeat(40);
  const W = WALLET.toLowerCase();
  const index = { universe: 10, groups: { ['ethereum:' + F]: [W, S] }, services: [] };
  const seen = [];
  const call = async (p, body) => {
    seen.push(p);
    if (p === 'profiler/address/related-wallets') return { data: { data: body.chain === 'ethereum' ? [{ address: F, relation: 'First Funder', transaction_hash: '0xab', block_timestamp: '2022-01-05T18:05:34Z', address_label: '' }] : [] } };
    if (p === 'profiler/address/transactions') return { data: { data: [{ transaction_hash: '0xab', volume_usd: 7603, tokens_received: [{ from_address: F }] }] } };
    return { data: { data: { realized_pnl_usd: -9_999_999, closed_trade_count: 40 } } };
  };
  const executor = createLiveGuardExecutor({ call, now: () => new Date(NOW), operatorIndex: index });
  const window = { from: '2026-08-22T12:00:00Z', to: '2026-09-21T12:00:00Z' };
  const op = await executor.execute('get_operator', { wallet: WALLET, window });
  assert.deepEqual(seen, ['profiler/address/related-wallets', 'profiler/address/related-wallets', 'profiler/address/transactions', 'profiler/perp-pnl-summary']);
  assert.equal(op.siblings[0].wallet, S);
  assert.equal(op.siblings[0].realized_pnl_usd, -9_999_999);
  assert.equal(executor.creditsCharged(), 4);
  const none = createLiveGuardExecutor({ call, now: () => new Date(NOW), operatorIndex: null });
  assert.equal((await none.execute('get_operator', { wallet: WALLET, window })).error, 'not_read');
});
