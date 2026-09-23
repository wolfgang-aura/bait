import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { guardAllocation, BENCHMARK_GUARD_POLICY_V3, BENCHMARK_GUARD_POLICY_V4, PRODUCTION_GUARD_POLICY_V4, largestOpenPosition } from './guard.js';
import { makeToolExecutor } from './tools.js';
import { withV4Reads, recordFromLeaderboard, smartMoneyFromScreener, leaderboardRequest, screenerRequest } from './v4-evidence.js';

const snap = name => JSON.parse(fs.readFileSync(new URL(`./snapshots/${name}`, import.meta.url), 'utf8'));
// A clean profitable control: v3 allows it in full.
const CLEAN = 'control_0x9e2cbb5d800181c1ef21b25010dc4ea80eeb5508.json';
const LOSING = '0xc26cbb6483229e0d0f9a1cab675271eda535b8f4.json';

/** The snapshot's own tools, plus a synthetic open book and synthetic v4 reads. */
function executor(s, { book = null, record, smartMoney, calls = [] } = {}) {
  const inner = makeToolExecutor(s, { mode: 'armed' });
  const base = {
    execute: async (name, input) => {
      calls.push(name);
      if (name === 'get_open_positions' && book) return { wallet: s.wallet, account_value_usd: 1_000_000, total_unrealized_pnl_usd: 0, open_position_count: book.length, positions: book };
      return inner.execute(name, input);
    },
  };
  const wrapped = withV4Reads(base, { record, smartMoney });
  return { execute: (name, input) => { if (name.startsWith('get_independent') || name.startsWith('get_smart')) calls.push(name); return wrapped.execute(name, input); } };
}
const recordOf = (s, pnl) => ({ wallet: s.wallet, realized_pnl_usd: pnl, source: 'Nansen /api/v1/perp-leaderboard' });
const smOf = (symbol, longs, shorts) => ({ [symbol]: { token_symbol: symbol, smart_money_longs_usd: longs, smart_money_shorts_usd: shorts } });
const run = (s, opts, policy = BENCHMARK_GUARD_POLICY_V4, allocation = 8000) =>
  guardAllocation({ executor: executor(s, opts), wallet: s.wallet, allocation, policy, now: () => new Date(s.retrieved_at) });
const row = (g, id) => g.checks.find(c => c.id === id);

test('v4 allows a clean month in full when the leaderboard agrees and smart money is not against the book', async () => {
  const s = snap(CLEAN);
  const pnl = s.pnl_summary_30d.realized_pnl_usd;
  const g = await run(s, { book: [{ symbol: 'BTC', direction: 'long', position_value_usd: 500_000 }], record: recordOf(s, pnl), smartMoney: smOf('BTC', 128e6, 63e6) });
  assert.equal(g.code, 'allowed');
  assert.equal(g.allocation, 8000);
  assert.equal(row(g, 'independent_record').result, 'pass');
  assert.equal(row(g, 'smart_money_side').result, 'pass');
  assert.equal(g.policy.id, 'wallet-copy-risk-benchmark-v4');
});

test('independent_record blocks a summary that claims more than the leaderboard records (the doctored number)', async () => {
  const s = snap(CLEAN);
  const pnl = s.pnl_summary_30d.realized_pnl_usd;
  const g = await run(s, { record: recordOf(s, -pnl) });
  assert.equal(g.decision, 'block');
  assert.equal(g.code, 'record_disagreement');
  assert.equal(g.allocation, 0);
  assert.equal(row(g, 'independent_record').result, 'fail');
  assert.match(g.reason, /perp-leaderboard/);
});

test('independent_record tolerates 25% of the record, never less than $1,000, and passes an understatement', async () => {
  const s = snap(CLEAN);
  const pnl = s.pnl_summary_30d.realized_pnl_usd;
  // Summary is 20% above the record: inside 25%.
  const inside = await run(s, { record: recordOf(s, pnl / 1.2) });
  assert.equal(row(inside, 'independent_record').result, 'pass');
  // Summary is 40% above the record: outside.
  const outside = await run(s, { record: recordOf(s, pnl / 1.4) });
  assert.equal(outside.code, 'record_disagreement');
  // The summary says less than the record: the evidence is not overstating the trader.
  const under = await run(s, { record: recordOf(s, pnl * 3) });
  assert.equal(row(under, 'independent_record').result, 'pass');
  // Tiny months: $1,000 floor.
  const tiny = { ...s, pnl_summary_30d: { ...s.pnl_summary_30d, realized_pnl_usd: 900 } };
  const g = await guardAllocation({ executor: executor(tiny, { record: recordOf(s, 0) }), wallet: s.wallet, allocation: 8000,
    policy: { ...BENCHMARK_GUARD_POLICY_V4, readAllWindows: true }, now: () => new Date(s.retrieved_at) });
  assert.equal(row(g, 'independent_record').result, 'pass');
});

test('a missing, unlisted or wrong-wallet leaderboard read is not assessed and changes nothing', async () => {
  const s = snap(CLEAN);
  for (const record of [undefined, { error: 'not_listed' }, { error: 'read_failed', message: 'x' }, recordOf({ wallet: '0x' + '1'.repeat(40) }, -1e9)]) {
    const g = await run(s, { record });
    assert.equal(g.code, 'allowed', JSON.stringify(record));
    assert.equal(row(g, 'independent_record').result, 'not_assessed');
  }
});

test('smart_money_side caps at 25% when two thirds of at least $1M of smart money is on the other side', async () => {
  const s = snap(CLEAN);
  const pnl = s.pnl_summary_30d.realized_pnl_usd;
  const book = [{ symbol: 'ETH', direction: 'long', position_value_usd: 100_000 }, { symbol: 'HYPE', direction: 'short', position_value_usd: -900_000 }];
  // Largest position: HYPE short. Smart money is 70% long HYPE.
  const g = await run(s, { book, record: recordOf(s, pnl), smartMoney: smOf('HYPE', 7e6, 3e6) });
  assert.equal(g.code, 'capped');
  assert.equal(g.allocation, 2000);
  assert.equal(row(g, 'smart_money_side').result, 'cap');
  assert.match(g.reason, /smart money holds the other side/);
  // Exactly two thirds caps; just under does not.
  const edge = await run(s, { book, record: recordOf(s, pnl), smartMoney: smOf('HYPE', 2e6, 1e6) });
  assert.equal(row(edge, 'smart_money_side').result, 'cap');
  const under = await run(s, { book, record: recordOf(s, pnl), smartMoney: smOf('HYPE', 1.9e6, 1.1e6) });
  assert.equal(row(under, 'smart_money_side').result, 'pass');
  assert.equal(under.code, 'allowed');
});

test('smart_money_side is not assessed with no open position, a thin market, or a failed read', async () => {
  const s = snap(CLEAN);
  const pnl = s.pnl_summary_30d.realized_pnl_usd;
  const book = [{ symbol: 'HYPE', direction: 'short', position_value_usd: -900_000 }];
  const cases = [
    { book: [], smartMoney: smOf('HYPE', 7e6, 0) },
    { book, smartMoney: smOf('HYPE', 600_000, 100_000) },
    { book, smartMoney: {} },
    { book, smartMoney: { HYPE: { error: 'read_failed' } } },
  ];
  for (const c of cases) {
    const g = await run(s, { ...c, record: recordOf(s, pnl) });
    assert.equal(row(g, 'smart_money_side').result, 'not_assessed');
    assert.equal(g.code, 'allowed');
  }
});

test('a refused request never buys the leaderboard; the Pitch Room table says it was not read', async () => {
  const s = snap(LOSING);
  const calls = [];
  const g = await guardAllocation({ executor: executor(s, { record: recordOf(s, s.pnl_summary_30d.realized_pnl_usd), calls }), wallet: s.wallet, allocation: 5000,
    policy: BENCHMARK_GUARD_POLICY_V4, now: () => new Date(s.retrieved_at) });
  assert.equal(g.code, 'pnl_below_minimum');
  assert.ok(!calls.includes('get_independent_record'));
  assert.ok(!calls.includes('get_smart_money_market'));
  const room = await guardAllocation({ executor: executor(s, { calls: [] }), wallet: s.wallet, allocation: 5000,
    policy: { ...BENCHMARK_GUARD_POLICY_V4, readAllWindows: true }, now: () => new Date(s.retrieved_at) });
  assert.equal(room.code, 'pnl_below_minimum');
  assert.match(row(room, 'independent_record').plain, /^Not read: the 30-day record already refused/);
});

test('the doctored number: v3 funds a losing wallet whose summary was served as its absolute value; v4 blocks it', async () => {
  const s = snap(CLEAN);
  // A losing variant of a clean record: every v3 check but the sign would pass.
  const truth = -Math.abs(s.pnl_summary_30d.realized_pnl_usd);
  const doctored = { execute: async (name, input) => makeToolExecutor(s, { mode: 'armed' }).execute(name, input) };
  const v3 = await guardAllocation({ executor: doctored, wallet: s.wallet, allocation: 5000, policy: BENCHMARK_GUARD_POLICY_V3, now: () => new Date(s.retrieved_at) });
  assert.equal(v3.decision, 'allow');
  const v4 = await guardAllocation({ executor: withV4Reads(doctored, { record: recordOf(s, truth) }), wallet: s.wallet, allocation: 5000, policy: BENCHMARK_GUARD_POLICY_V4, now: () => new Date(s.retrieved_at) });
  assert.equal(v4.code, 'record_disagreement');
});

test('v3 tables are unchanged by v4: no v4 rows on a v3 decision', async () => {
  const g = await run(snap(CLEAN), {}, BENCHMARK_GUARD_POLICY_V3);
  assert.ok(!g.checks.some(c => ['smart_money_side', 'independent_record'].includes(c.id)));
  assert.equal(PRODUCTION_GUARD_POLICY_V4.smartMoneyMinOppositeShare, 2 / 3);
  assert.equal(PRODUCTION_GUARD_POLICY_V4.smartMoneyMinTotalUsd, 1_000_000);
  assert.equal(PRODUCTION_GUARD_POLICY_V4.recordMaxOverstatementShare, 0.25);
  assert.equal(PRODUCTION_GUARD_POLICY_V4.recordMinOverstatementUsd, 1_000);
});

test('v4-evidence maps real response shapes and builds calendar-day requests', () => {
  const w = '0xd5d29dbf880eea93d4ed2ccb79c642bde0a48480';
  assert.deepEqual(leaderboardRequest(w, { from: '2026-08-16T10:40:31Z', to: '2026-09-15T10:40:31Z' }).date, { from: '2026-08-16', to: '2026-09-15' });
  assert.deepEqual(screenerRequest('BTC', '2026-09-23T15:00:00Z').date, { from: '2026-09-16', to: '2026-09-23' });
  const rec = recordFromLeaderboard({ data: [{ trader_address: w, realized_pnl_usd: 627658.5583, total_trades: 1750 }] }, { wallet: w, request: { date: { from: 'a', to: 'b' } }, retrievedAt: 'now' });
  assert.equal(rec.realized_pnl_usd, 627658.56);
  assert.equal(recordFromLeaderboard({ data: [] }, { wallet: w }).error, 'not_listed');
  const sm = smartMoneyFromScreener({ data: [{ token_symbol: 'BTC', current_smart_money_position_longs_usd: 127814007.7, current_smart_money_position_shorts_usd: -62704265.9 }] }, { tokenSymbol: 'BTC' });
  assert.equal(sm.smart_money_shorts_usd, 62704265.9);
  assert.deepEqual(largestOpenPosition({ positions: [{ symbol: 'A', direction: 'long', position_value_usd: 5 }, { symbol: 'B', direction: 'short', position_value_usd: -9 }] }).symbol, 'B');
});
