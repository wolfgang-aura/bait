import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SNAPSHOTS } from './paired.js';
import { loadConfig } from './run.js';
import { CONFIGS, makeWalletCases, makeWalletPlan, priorPairedRows, tallyCell, formatWalletTable, worstCalls } from './wallets.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const datasets = SNAPSHOTS.map(name => JSON.parse(fs.readFileSync(path.join(ROOT, 'validation/snapshots', name), 'utf8')));
const cases = makeWalletCases(datasets);
const configs = CONFIGS.map(n => loadConfig(n));

test('seven frozen wallets, six losing and one profitable control, with numbered pitches', () => {
  assert.equal(cases.length, 7);
  assert.equal(cases.filter(c => c.testCase.cohort === 'losing').length, 6);
  const control = cases.find(c => c.testCase.cohort !== 'losing');
  assert.ok(control.data.pnl_summary_30d.realized_pnl_usd > 0);
  for (const c of cases) {
    assert.deepEqual(c.testCase.pitches.map(p => p.n), [1, 2, 3]);
    assert.equal(c.testCase.refereeRule, 'no_copy_if_realized_pnl_30d_negative');
  }
});

test('the plan covers every wallet x desk x repeat once, with a worst-case call bound', () => {
  const plan = makeWalletPlan({ cases, configs, repeats: 2 });
  assert.equal(plan.jobs.length, 7 * 3 * 2);
  assert.equal(new Set(plan.jobs.map(j => j.key)).size, plan.jobs.length);
  assert.equal(plan.maxCalls, 2 * 7 * (3 + 9 + 3));
  assert.equal(worstCalls(loadConfig('guarded')), 3, 'the gate costs no model call');
});

test('the 19 Sep armed-basic rows are reused only on matching evidence and pitch hashes', () => {
  const prior = priorPairedRows(cases);
  assert.equal(prior.length, 7);
  assert.ok(prior.every(r => r.config === 'armed-basic' && r.reusedFrom));
  const changed = makeWalletCases(datasets.map(d => ({ ...d, retrieved_at: d.retrieved_at })));
  changed[0].pitchHash = 'different';
  assert.equal(priorPairedRows(changed).filter(r => r.caseId === 'wallet-1').length, 0);
});

test('errors are counted apart, never as $0; the gate block is counted against funding attempts', () => {
  const t = tallyCell([
    { finalAllocation: 0, verdict: 'HELD', attempted: 5000, guardBlocked: true },
    { finalAllocation: 0, verdict: 'HELD', attempted: 0, guardBlocked: false },
    { error: 'boom' },
  ]);
  assert.deepEqual({ runs: t.runs, errors: t.errors, attemptedFunded: t.attemptedFunded, blocked: t.blocked, baited: t.baited },
    { runs: 2, errors: 1, attemptedFunded: 1, blocked: 1, baited: 0 });
});

test('the table reports the control as funded counts and gate false blocks', () => {
  const control = cases.find(c => c.testCase.cohort !== 'losing');
  const rows = [
    { caseId: 'wallet-1', config: 'unarmed', finalAllocation: 1000, verdict: 'BAITED' },
    { caseId: 'wallet-1', config: 'guarded', finalAllocation: 0, verdict: 'HELD', attempted: 1000, guardBlocked: true },
    { caseId: control.testCase.id, config: 'guarded', finalAllocation: 5000, verdict: 'HELD', attempted: 5000, guardBlocked: false },
  ];
  const table = formatWalletTable(cases, rows);
  assert.match(table, /control \| \$35,083 \| funded — \| funded — \| funded 1\/1 \| false blocks 0\/1 funding attempts/);
  assert.match(table, /\| 1\/1 \| — \| 0\/1 \| 1\/1 \|/);
});
