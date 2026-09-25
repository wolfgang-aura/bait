import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fundersOf, candidateGroups, fundingOf, buildIndex, summariesOf, operatorFromReads, components, select, windowsAt, universeRequest, MIN_PITCHED_PNL_USD } from './v5.js';
import { MAX_OPERATOR_WALLETS } from '../validation/v5-evidence.js';

const A = n => `0x${String(n).padStart(40, '0')}`;
const F1 = `0x${'f'.repeat(40)}`, F2 = `0x${'e'.repeat(40)}`, BN = `0x${'b'.repeat(40)}`, SVC = `0x${'c'.repeat(40)}`;
const T = '2026-09-25T00:00:00Z';
const W = windowsAt(T);

/** Synthetic saved reads: F1 funds 1,2,3 (operator loses), F2 funds 4,5 (operator wins), Binance funds 6,7, a service funds 11 wallets, 8 is dust-funded. */
function fixture() {
  const related = [];
  const funding = [];
  const rel = (wallet, chain, funder, label = '', tx = `0x${wallet.slice(-4)}${chain[0]}`) => {
    related.push({ wallet, request: { address: wallet, chain }, response: { data: [{ address: funder, address_label: label, relation: 'First Funder', transaction_hash: tx, block_timestamp: '2024-01-01T00:00:00Z' }] } });
    return tx;
  };
  const fund = (wallet, chain, funder, tx, usd) => funding.push({ wallet, funder, tx_hash: tx, request: { chain }, response: { data: [{ transaction_hash: tx, volume_usd: usd, tokens_received: [{ from_address: funder }] }] } });
  for (const n of [1, 2, 3]) fund(A(n), 'ethereum', F1, rel(A(n), 'ethereum', F1, 'High Activity'), 5000);
  for (const n of [4, 5]) fund(A(n), 'arbitrum', F2, rel(A(n), 'arbitrum', F2), 20_000);
  for (const n of [6, 7]) rel(A(n), 'ethereum', BN, 'Binance 14');
  for (let n = 20; n < 20 + MAX_OPERATOR_WALLETS + 1; n++) rel(A(n), 'ethereum', SVC, 'High Activity');
  fund(A(8), 'ethereum', F1, rel(A(8), 'ethereum', F1, 'High Activity'), 3); // dust: not a member
  const sum = (wallet, window, pnl) => ({ wallet, request: { address: wallet, date: window }, response: { data: { realized_pnl_usd: pnl, closed_trade_count: 50 } } });
  const summaries = [
    sum(A(1), W.current, 40_000), sum(A(2), W.current, -30_000), sum(A(3), W.current, -25_000),
    sum(A(4), W.current, 10_000), sum(A(5), W.current, 2_000),
    sum(A(1), W.previous, -1_000), sum(A(2), W.previous, 5_000), sum(A(3), W.previous, -9_000),
  ];
  return { universe: [], related, funding, summaries, cases: [], v4: [] };
}

function build(reads) {
  const funders = fundersOf(reads);
  const { groups, services } = candidateGroups(funders);
  const funding = fundingOf(reads);
  const index = buildIndex({ universe: Array(40), groups, services, funding });
  const summaries = summariesOf(reads);
  return { state: { T }, funders, groups, services, funding, index, summaries, operator: (w, win) => operatorFromReads({ wallet: w, window: win, funders, index, funding, summaries }) };
}

test('groups: exchange-labelled and service funders are excluded, dust funding is not membership', () => {
  const v5 = build(fixture());
  assert.deepEqual(Object.keys(v5.index.groups).sort(), [`arbitrum:${F2}`, `ethereum:${F1}`]);
  assert.deepEqual(v5.index.groups[`ethereum:${F1}`], [A(1), A(2), A(3)]);
  assert.deepEqual(v5.services, [`ethereum:${SVC}`]);
  assert.ok(v5.groups.find(g => g.funder === BN).excluded);
  assert.equal(components(v5.index).length, 2);
});

test('the pre-registered pick: the best wallet of a losing operator is an attack, of a winning one a control', () => {
  const v5 = build(fixture());
  const sel = select(v5, W.current);
  assert.deepEqual(sel.attack.map(a => a.wallet), [A(1)]);
  assert.equal(sel.attack[0].combined, 40_000 - 30_000 - 25_000);
  assert.deepEqual(sel.control.map(c => c.wallet), [A(4)]);
  // The same answer the gate reads: two siblings with records, both counted.
  const op = v5.operator(A(1), W.current);
  assert.equal(op.siblings.filter(s => Number.isFinite(s.realized_pnl_usd)).length, 2);
  assert.ok(op.funders[0].counts);
  // One month earlier: A(2) made money while its operator lost.
  assert.deepEqual(select(v5, W.previous).attack.map(a => a.wallet), [A(2)]);
  assert.ok(MIN_PITCHED_PNL_USD > 0);
});

test('windows and the universe request are fixed from T', () => {
  assert.deepEqual(W.current, { from: '2026-08-26T00:00:00Z', to: '2026-09-25T00:00:00Z' });
  assert.deepEqual(W.previous, { from: '2026-07-27T00:00:00Z', to: '2026-08-26T00:00:00Z' });
  assert.deepEqual(universeRequest(T, 3).date, { from: '2026-08-26', to: '2026-09-25' });
  assert.equal(universeRequest(T, 3).pagination.page, 3);
});
