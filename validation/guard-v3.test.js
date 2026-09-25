import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { guardAllocation, BENCHMARK_GUARD_POLICY_V2, BENCHMARK_GUARD_POLICY_V3, PRODUCTION_GUARD_POLICY, PRODUCTION_GUARD_POLICY_V3 } from './guard.js';
import { makeToolExecutor } from './tools.js';

const snap = name => JSON.parse(fs.readFileSync(new URL(`./snapshots/${name}`, import.meta.url), 'utf8'));
const run = (s, policy, allocation = 8000) => guardAllocation({
  executor: makeToolExecutor(s, { mode: 'armed' }), wallet: s.wallet, allocation, policy,
});

test('v3 caps a month one market carried at a quarter of the request; v2 refused it', async () => {
  const s = snap('control_0xfe47c8f29f65830d7990e85852cc2c5cee1c0085.json');
  const v3 = await run(s, BENCHMARK_GUARD_POLICY_V3);
  assert.equal(v3.decision, 'allow');
  assert.equal(v3.code, 'capped');
  assert.equal(v3.capped, true);
  assert.equal(v3.attempted, 8000);
  assert.equal(v3.allocation, 2000);
  assert.equal(v3.held, 6000);
  assert.equal(v3.execution_authorized, true);
  assert.match(v3.reason, /^capped: .* 25% of the request is allowed$/);
  const row = v3.checks.find(c => c.id === 'concentration');
  assert.equal(row.result, 'cap');
  assert.match(row.plain, /sends 25% of the request and holds the rest/);
  const v2 = await run(s, BENCHMARK_GUARD_POLICY_V2);
  assert.equal(v2.decision, 'block');
  assert.equal(v2.allocation, 0);
});

test('v3 still refuses a losing month and a reversed week, and passes a clean month in full', async () => {
  const losing = await run(snap('0xc26cbb6483229e0d0f9a1cab675271eda535b8f4.json'), BENCHMARK_GUARD_POLICY_V3);
  assert.equal(losing.decision, 'block');
  assert.equal(losing.code, 'pnl_below_minimum');
  assert.equal(losing.held, 8000);
  const reversed = await run(snap('control_0x490c7ed1b96059df56296f44dcd24124e9353227.json'), BENCHMARK_GUARD_POLICY_V3);
  assert.equal(reversed.decision, 'block');
  assert.equal(reversed.code, 'regime_disagreement');
  const clean = await run(snap('control_0x9e2cbb5d800181c1ef21b25010dc4ea80eeb5508.json'), BENCHMARK_GUARD_POLICY_V3);
  assert.equal(clean.decision, 'allow');
  assert.equal(clean.code, 'allowed');
  assert.equal(clean.allocation, 8000);
  assert.equal(clean.held, 0);
});

test('v4 is the default since 23 Sep (bench/V4.md); v3 keeps its cap share and rejects one outside (0, 1)', async () => {
  assert.equal(PRODUCTION_GUARD_POLICY.id, 'wallet-copy-risk-v5');
  assert.equal(PRODUCTION_GUARD_POLICY_V3.concentrationCapShare, 0.25);
  const s = snap('control_0xfe47c8f29f65830d7990e85852cc2c5cee1c0085.json');
  await assert.rejects(() => run(s, { ...BENCHMARK_GUARD_POLICY_V3, concentrationCapShare: 1 }), /concentrationCapShare/);
});

// v3 revision 2 (23 Sep 2026): the window is checked by its dates, not only its label.
const relabel = (s, edit) => ({
  async execute(name, input) {
    const out = await makeToolExecutor(s, { mode: 'armed' }).execute(name, input);
    return name === 'get_pnl_summary' ? edit(out, input) : out;
  },
});

test('v3 r2 refuses a 30-day label whose dates span 7 days, a missing range, and a short coverage note', async () => {
  const s = snap('control_0x9e2cbb5d800181c1ef21b25010dc4ea80eeb5508.json');
  const gate = executor => guardAllocation({ executor, wallet: s.wallet, allocation: 5000, policy: BENCHMARK_GUARD_POLICY_V3 });
  const sevenDays = await gate(relabel(s, (o, i) => (i.days === 30 ? { ...o, window: s.windows['7d'] } : o)));
  assert.equal(sevenDays.code, 'window_dates_mismatch');
  assert.equal(sevenDays.allocation, 0);
  assert.match(sevenDays.checks.find(c => c.id === 'evidence_30d').plain, /labelled 30 days, but its dates run .*: 7 days/);
  const noDates = await gate(relabel(s, (o, i) => { if (i.days !== 30) return o; const { window, ...rest } = o; return rest; }));
  assert.equal(noDates.code, 'window_dates_mismatch');
  const coverage = await gate(relabel(s, (o, i) => (i.days === 30 ? { ...o, data_coverage: { retained_days: 7, complete: false } } : o)));
  assert.equal(coverage.code, 'window_dates_mismatch');
  const shortWeek = await gate(relabel(s, (o, i) => (i.days === 7 ? { ...o, window: s.windows['30d'] } : o)));
  assert.equal(shortWeek.code, 'short_window_mismatch');
  const clean = await gate(relabel(s, o => o));
  assert.equal(clean.decision, 'allow');
  assert.equal(clean.policy.revision, 3);
  assert.equal(PRODUCTION_GUARD_POLICY_V3.revision, 3);
  assert.match(PRODUCTION_GUARD_POLICY_V3.revisionNotes, /^2026-09-23 r2: .* r3: open positions read/);
});

test('v3 r3: the open book caps the request when open positions are down over 25% of the account value', async () => {
  const { guardAllocation, PRODUCTION_GUARD_POLICY } = await import('./guard.js');
  const now = () => new Date('2026-09-23T12:00:00Z');
  const wallet = '0x1111111111111111111111111111111111111111';
  const summary = days => ({
    wallet, window_days: days, window: { from: new Date(Date.parse('2026-09-23T12:00:00Z') - days * 86_400_000).toISOString(), to: '2026-09-23T12:00:00Z' },
    realized_pnl_usd: days === 7 ? 5_000 : 50_000, win_rate: 0.6, closed_trade_count: 400,
    top5_coins: [{ coin: 'BTC', realized_pnl_usd: 20_000 }, { coin: 'ETH', realized_pnl_usd: 30_000 }],
    retrieved_at: '2026-09-23T11:59:00Z', source: PRODUCTION_GUARD_POLICY.source,
  });
  const run = book => guardAllocation({
    executor: { execute: async (name, args) => (name === 'get_pnl_summary' ? summary(args.days) : book) },
    wallet, allocation: 4_000, now,
  });
  // Down $300,000 on a $1,000,000 account: 30%, over the 25% limit. Capped at 25%.
  const capped = await run({ wallet, account_value_usd: 1_000_000, total_unrealized_pnl_usd: -300_000, open_position_count: 3 });
  assert.equal(capped.code, 'capped');
  assert.equal(capped.allocation, 1_000);
  const row = capped.checks.find(c => c.id === 'open_book');
  assert.equal(row.result, 'cap');
  assert.equal(row.plain, 'The open positions are down $300,000, 30.0% of the $1,000,000 account value, over the 25% limit. Copying now inherits that loss, so the gate sends 25% of the request and holds the rest.');
  assert.match(capped.reason, /open positions are down more than 25% of the account value/);
  // Down 10%: passes, and says so with its base and limit.
  const fine = await run({ wallet, account_value_usd: 1_000_000, total_unrealized_pnl_usd: -100_000, open_position_count: 3 });
  assert.equal(fine.code, 'allowed');
  assert.equal(fine.checks.find(c => c.id === 'open_book').plain, 'The open positions are down $100,000, 10.0% of the $1,000,000 account value, under the 25% limit.');
  // A failed read changes nothing and says so.
  const unread = await run({ error: 'positions_unavailable' });
  assert.equal(unread.code, 'allowed');
  assert.equal(unread.checks.find(c => c.id === 'open_book').result, 'not_assessed');
  // The row is only added by a policy that runs it: v2 decisions keep their shape.
  const { PRODUCTION_GUARD_POLICY_V2 } = await import('./guard.js');
  const v2 = await guardAllocation({ executor: { execute: async (name, args) => summary(args.days) }, wallet, allocation: 4_000, now, policy: PRODUCTION_GUARD_POLICY_V2 });
  assert.equal(v2.checks.some(c => c.id === 'open_book'), false);
});
