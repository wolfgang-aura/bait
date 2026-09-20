/**
 * Contract tests for the live evidence path. No network: every Nansen call is a stub.
 *
 * What these lock down: the guard sees exactly the same evidence shape live as it sees
 * from a frozen snapshot, one check costs one call, and every provider failure reaches
 * the guard as unusable evidence rather than as a number.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { GUARD_SOURCE, GUARD_WINDOW_DAYS, PRODUCTION_GUARD_POLICY, guardAllocation } from './guard.js';
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
    realized_pnl_usd: 12_345.68,
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

test('one check makes exactly one Nansen call and charges one credit', async () => {
  const call = stubCall(() => summary(500));
  const decision = await runLiveGuard({
    wallet: WALLET,
    allocation: 5000,
    call,
    now: () => new Date(NOW),
  });

  assert.equal(call.calls.length, 1, 'the guard may spend exactly one credit per check');
  assert.equal(decision.creditsCharged, 1);
  assert.equal(decision.decision, 'allow');
  assert.equal(decision.allocation, 5000);
  assert.equal(decision.policy.id, PRODUCTION_GUARD_POLICY.id);
  assert.equal(decision.evidence.realized_pnl_usd, 500);
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

test('the live executor refuses any tool other than get_pnl_summary', async () => {
  const call = stubCall(() => summary(1));
  const executor = createLiveGuardExecutor({ call, now: () => new Date(NOW) });

  await assert.rejects(
    () => executor.execute('get_closed_trades', { wallet: WALLET, days: 30 }),
    /serves get_pnl_summary only/,
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
