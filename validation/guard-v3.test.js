import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { guardAllocation, BENCHMARK_GUARD_POLICY_V2, BENCHMARK_GUARD_POLICY_V3, PRODUCTION_GUARD_POLICY } from './guard.js';
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

test('v3 is the default and rejects a cap share outside (0, 1)', async () => {
  assert.equal(PRODUCTION_GUARD_POLICY.id, 'wallet-copy-risk-v3');
  assert.equal(PRODUCTION_GUARD_POLICY.concentrationCapShare, 0.25);
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
  assert.equal(clean.policy.revision, 2);
  assert.equal(PRODUCTION_GUARD_POLICY.revision, 2);
  assert.match(PRODUCTION_GUARD_POLICY.revisionNotes, /^2026-09-23 r2/);
});
