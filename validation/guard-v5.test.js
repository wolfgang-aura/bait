import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { guardAllocation, BENCHMARK_GUARD_POLICY_V4, BENCHMARK_GUARD_POLICY_V5, PRODUCTION_GUARD_POLICY_V5 } from './guard.js';
import { makeToolExecutor } from './tools.js';
import { withV5Reads, operatorAnswer, firstFunderFrom, fundingFrom, fundingRequest, siblingFrom, funderExclusion, indexSiblings,
  createOperatorReader, MIN_FUNDING_USD, MAX_SIBLINGS_READ } from './v5-evidence.js';

const snap = name => JSON.parse(fs.readFileSync(new URL(`./snapshots/${name}`, import.meta.url), 'utf8'));
const CLEAN = 'control_0x9e2cbb5d800181c1ef21b25010dc4ea80eeb5508.json';
const LOSING = '0xc26cbb6483229e0d0f9a1cab675271eda535b8f4.json';
const F = '0x' + 'f'.repeat(40);
const S1 = '0x' + '1'.repeat(40);
const S2 = '0x' + '2'.repeat(40);

const index = (wallet, members = [S1, S2], services = []) => ({ universe: 100, groups: { [`ethereum:${F}`]: [wallet.toLowerCase(), ...members] }, services });
const funder = (extra = {}) => ({ chain: 'ethereum', funder: F, label: 'High Activity', tx_hash: '0xabc', block_timestamp: '2024-01-01T00:00:00Z', funding: { funding_usd: 5000 }, ...extra });
const opFor = (s, pnls, { funders = [funder()], idx = index(s.wallet) } = {}) => operatorAnswer({ wallet: s.wallet, funders, index: idx,
  records: Object.fromEntries([S1, S2].map((w, i) => [w, pnls[i] === undefined ? { wallet: w, error: 'no_record' } : { wallet: w, realized_pnl_usd: pnls[i] }])),
  window: s.windows['30d'] });
const run = (s, operator, policy = BENCHMARK_GUARD_POLICY_V5, allocation = 8000) => guardAllocation({
  executor: withV5Reads(makeToolExecutor(s, { mode: 'armed' }), { operator }), wallet: s.wallet, allocation, policy, now: () => new Date(s.retrieved_at) });
const row = (g, id) => g.checks.find(c => c.id === id);

test('v5 blocks a profitable wallet whose operator lost money across its siblings', async () => {
  const s = snap(CLEAN);
  const own = s.pnl_summary_30d.realized_pnl_usd;
  const g = await run(s, opFor(s, [-own, -1000]));
  assert.equal(g.decision, 'block');
  assert.equal(g.code, 'operator_losing');
  assert.equal(g.allocation, 0);
  assert.equal(row(g, 'operator_record').result, 'fail');
  assert.match(row(g, 'operator_record').plain, /survivor/);
  assert.equal(g.evidence.operator.siblings.length, 2);
  assert.equal(g.policy.id, 'wallet-copy-risk-benchmark-v5');
});

test('v5 passes the same wallet when its operator made money, and v4 never reads the operator', async () => {
  const s = snap(CLEAN);
  const own = s.pnl_summary_30d.realized_pnl_usd;
  const g = await run(s, opFor(s, [-own / 2, 100]));
  assert.equal(row(g, 'operator_record').result, 'pass');
  assert.notEqual(g.code, 'operator_losing');
  const v4 = await run(s, opFor(s, [-own * 3, -1]), BENCHMARK_GUARD_POLICY_V4);
  assert.equal(row(v4, 'operator_record'), undefined);
  assert.notEqual(v4.code, 'operator_losing');
});

test('an excluded, dust-funded or unindexed funder, or siblings with no record, is not assessed and changes nothing', async () => {
  const s = snap(CLEAN);
  const own = s.pnl_summary_30d.realized_pnl_usd;
  const cases = [
    opFor(s, [-own * 3], { funders: [funder({ label: 'Binance 14' })] }),
    opFor(s, [-own * 3], { funders: [funder({ label: 'Hot Wallet' })] }),
    opFor(s, [-own * 3], { funders: [funder({ funding: { funding_usd: MIN_FUNDING_USD - 1 } })] }),
    opFor(s, [-own * 3], { funders: [funder({ funding: { error: 'funding_value_unknown' } })] }),
    opFor(s, [-own * 3], { idx: { universe: 100, groups: {}, services: [] } }),
    opFor(s, [-own * 3], { idx: index(s.wallet, [S1, S2], [`ethereum:${F}`]) }),
    opFor(s, []),
    undefined,
    { error: 'read_failed' },
  ];
  for (const operator of cases) {
    const g = await run(s, operator);
    assert.notEqual(g.code, 'operator_losing', JSON.stringify(operator));
    assert.equal(row(g, 'operator_record').result, 'not_assessed', JSON.stringify(operator));
  }
});

test('the operator row is never read when an earlier check refused (a losing month)', async () => {
  const s = snap(LOSING);
  let asked = 0;
  const inner = makeToolExecutor(s, { mode: 'armed' });
  const g = await guardAllocation({ executor: { execute: (n, i) => { if (n === 'get_operator') asked++; return withV5Reads(inner, {}).execute(n, i); } },
    wallet: s.wallet, allocation: 8000, policy: BENCHMARK_GUARD_POLICY_V5, now: () => new Date(s.retrieved_at) });
  assert.equal(g.code, 'pnl_below_minimum');
  assert.equal(asked, 0);
});

test('response mapping: first funder, funding size by hash, sibling record, exclusions, index lookup', () => {
  const ff = firstFunderFrom({ data: [{ address: '0xDEAD' + '0'.repeat(36), relation: 'Deployed Contract' }, { address: F.toUpperCase().replace('0X', '0x'), address_label: 'x', relation: 'First Funder', transaction_hash: '0xAB', block_timestamp: '2022-01-05T18:05:34Z', chain: 'ethereum' }] }, { chain: 'ethereum' });
  assert.equal(ff.funder, F);
  assert.equal(firstFunderFrom({ data: [] }, { chain: 'arbitrum' }).error, 'no_first_funder');
  assert.deepEqual(fundingRequest(S1, 'ethereum', '2022-01-05T18:05:34Z').date, { from: '2022-01-05', to: '2022-01-06' });
  const tx = { data: [{ transaction_hash: '0xab', volume_usd: 7603.089, tokens_received: [{ from_address: F }] }] };
  assert.equal(fundingFrom(tx, { txHash: '0xAB', funder: F }).funding_usd, 7603.09);
  assert.equal(fundingFrom(tx, { txHash: '0xcd', funder: F }).error, 'funding_tx_not_found');
  assert.equal(fundingFrom(tx, { txHash: '0xab', funder: S1 }).error, 'funding_tx_not_from_funder');
  assert.equal(siblingFrom({ data: { realized_pnl_usd: -12.3456, closed_trade_count: 3 } }, { wallet: S1 }).realized_pnl_usd, -12.35);
  assert.equal(siblingFrom({ data: {} }, { wallet: S1 }).error, 'no_record');
  assert.ok(funderExclusion({ label: 'Coinbase: Hot Wallet' }));
  assert.ok(funderExclusion({ label: 'Across Protocol: Relayer' }));
  assert.equal(funderExclusion({ label: 'High Activity' }), null);
  assert.equal(funderExclusion({ label: 'lordgigachad.eth' }), null);
  assert.ok(funderExclusion({ label: '', wallets: 11 }));
  assert.deepEqual(indexSiblings(index(S2, [S1]), S2, [{ chain: 'ethereum', funder: F }]).map(s => s.wallet), [S1]);
});

test('the live reader reads each chain once, the funding once per counted funder, and at most MAX_SIBLINGS_READ siblings', async () => {
  const W = '0x' + 'a'.repeat(40);
  const many = Array.from({ length: 12 }, (_, i) => `0x${String(i + 1).padStart(40, '0')}`);
  const idx = { universe: 50, groups: { [`arbitrum:${F}`]: [W, ...many] }, services: [] };
  const seen = [];
  const call = async (p, body) => {
    seen.push(p);
    if (p.endsWith('related-wallets')) return { data: { data: body.chain === 'arbitrum' ? [{ address: F, relation: 'First Funder', transaction_hash: '0xab', block_timestamp: '2024-11-14T18:55:01Z', address_label: '' }] : [] } };
    if (p.endsWith('transactions')) return { data: { data: [{ transaction_hash: '0xab', volume_usd: 50_000, tokens_received: [{ from_address: F }] }] } };
    return { data: { data: { realized_pnl_usd: -500, closed_trade_count: 10 } } };
  };
  const read = createOperatorReader({ call, index: idx, now: () => new Date('2026-09-25T00:00:00Z') });
  const op = await read({ wallet: W, window: { from: '2026-08-26T00:00:00Z', to: '2026-09-25T00:00:00Z' } });
  assert.equal(seen.filter(p => p.endsWith('related-wallets')).length, 2);
  assert.equal(seen.filter(p => p.endsWith('transactions')).length, 1);
  assert.equal(seen.filter(p => p === 'profiler/perp-pnl-summary').length, MAX_SIBLINGS_READ);
  assert.equal(op.siblings.length, MAX_SIBLINGS_READ);
  assert.ok(op.funders.find(f => f.chain === 'arbitrum').counts);
});

test('v5 policy shape: every v4 bar unchanged, operator bar at zero', () => {
  for (const k of ['smartMoneyMinOppositeShare', 'smartMoneyMinTotalUsd', 'recordMaxOverstatementShare', 'recordMinOverstatementUsd', 'concentrationCapShare', 'minClosedTrades', 'minWinRate'])
    assert.equal(PRODUCTION_GUARD_POLICY_V5[k], BENCHMARK_GUARD_POLICY_V4[k], k);
  assert.equal(PRODUCTION_GUARD_POLICY_V5.operatorMaxCombinedLossUsd, 0);
  assert.equal(PRODUCTION_GUARD_POLICY_V5.maxEvidenceAgeMs, 15 * 60 * 1000);
  assert.equal(BENCHMARK_GUARD_POLICY_V5.maxEvidenceAgeMs, null);
});
