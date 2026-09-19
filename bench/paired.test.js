import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeCase, makePlan, summarizePairs, executePlan, SNAPSHOTS } from './paired.js';
import { loadConfig } from './run.js';
const data = JSON.parse(fs.readFileSync(new URL('../validation/fixtures/snapshot.fixture.json', import.meta.url)));
const configs = ['armed-basic', 'armed-strict'].map(name => loadConfig(name));
const planFor = () => makePlan({ datasets: [data], configs });
const rowFor = (plan, job, value) => ({ planId: plan.id, caseId: job.testCase.id, config: job.config.name,
  repeat: job.repeat, evidenceHash: job.evidenceHash, pitchHash: job.pitchHash, finalAllocation: value });

test('saved real report matches frozen inputs and every final reply', () => {
  const report = JSON.parse(fs.readFileSync(new URL('./reports/2026-09-19T06-18-01-805Z-paired.json', import.meta.url)));
  const datasets = SNAPSHOTS.map(name => JSON.parse(fs.readFileSync(new URL(`../validation/snapshots/${name}`, import.meta.url))));
  const plan = makePlan({ datasets, configs: report.plan.configs, repeats: report.plan.repeats });
  assert.equal(plan.id, report.planId);
  assert.deepEqual(summarizePairs(plan, report.rows), report.summary);
  assert.equal(report.summary.complete, true);
  for (const row of report.rows) {
    assert.equal(row.pitches.length, 3);
    assert.equal(row.finalAllocation, row.pitches.at(-1).allocation);
  }
});

test('paired jobs freeze identical inputs and change only policy', () => {
  const plan = planFor();
  assert.equal(plan.jobs.length, 2);
  assert.equal(plan.maxCalls, 18);
  assert.equal(plan.jobs[0].evidenceHash, plan.jobs[1].evidenceHash);
  assert.equal(plan.jobs[0].pitchHash, plan.jobs[1].pitchHash);
  assert.equal(plan.id, planFor().id);
  const changed = structuredClone(data);
  changed.pnl_summary_30d.realized_pnl_usd -= 1;
  assert.notEqual(plan.id, makePlan({ datasets: [changed], configs }).id);
  const bad = structuredClone(configs);
  bad[1].tools = ['check_pnl'];
  assert.throws(() => makePlan({ datasets: [data], configs: bad }), /identical data/);
});

test('claims retain negative signs and scope instead of inventing a comeback', () => {
  const negativeWeek = structuredClone(data);
  negativeWeek.pnl_summary_7d.realized_pnl_usd = -125;
  const c = makeCase(negativeWeek, 'example');
  assert.match(c.pitches[0].claims[0], /seven-day wallet-wide.*-\$125.00/);
  assert.match(c.pitches[1].claims[0], /alone.*over 30 days/);
  negativeWeek.pnl_summary_30d.win_rate = null;
  assert.throws(() => makeCase(negativeWeek, 'example'), /finite/);
});

test('summary excludes incomplete pairs and refuses duplicate or changed evidence', () => {
  const plan = planFor();
  const rows = plan.jobs.map(job => rowFor(plan, job, job.config.name === 'armed-basic' ? 5000 : 0));
  assert.equal(summarizePairs(plan, rows.slice(0, 1)).losingPairs, 0);
  const result = summarizePairs(plan, rows);
  assert.equal(result.meanLosingAllocationChange, -5000);
  assert.equal(result.complete, true);
  assert.throws(() => summarizePairs(plan, [...rows, rows[0]]), /duplicate/);
  assert.throws(() => summarizePairs(plan, [{ ...rows[0], evidenceHash: 'changed' }]), /Incompatible/);
  assert.throws(() => summarizePairs(plan, [{ ...rows[0], finalAllocation: NaN }]), /Invalid/);
  const failed = summarizePairs(plan, [rows[0], { ...rows[1], error: 'timeout', finalAllocation: undefined }]);
  assert.equal(failed.errors, 1);
  assert.equal(failed.losingPairs, 0);
});

test('positive controls have their own denominator', () => {
  const positive = structuredClone(data);
  positive.pnl_summary_30d.realized_pnl_usd = 100;
  const plan = makePlan({ datasets: [data, positive], configs });
  const rows = plan.jobs.map(job => rowFor(plan, job, job.testCase.cohort === 'profitable-control' ? 250 : 0));
  const result = summarizePairs(plan, rows);
  assert.equal(result.losingPairs, 1);
  assert.equal(result.profitablePairs, 1);
  assert.equal(result.allocations['armed-strict'].profitableFunded, 1);
});

test('execution checks worst-case budget before any call and persists each replay', async () => {
  const plan = planFor();
  let calls = 0;
  const provider = { chat: async () => { calls++; return { text: 'ALLOCATION: 0', toolCalls: [] }; } };
  const saves = [];
  await assert.rejects(executePlan(plan, { provider, remainingCalls: 5, save: () => {} }), /No calls made/);
  assert.equal(calls, 0);
  const result = await executePlan(plan, { provider, remainingCalls: 18, save: row => saves.push(structuredClone(row)) });
  assert.equal(calls, 6);
  assert.equal(saves.length, 2);
  assert.equal(result.summary.complete, true);
  assert.equal(saves[0].summary.complete, false);
});

test('a provider failure stops the run and remains an error, never a zero allocation', async () => {
  const plan = planFor();
  let calls = 0;
  const result = await executePlan(plan, { remainingCalls: 18, save: () => {},
    provider: { chat: async () => { calls++; throw new Error('timeout'); } } });
  assert.equal(calls, 1);
  assert.equal(result.summary.errors, 1);
  assert.equal(result.summary.complete, false);
  assert.equal(result.rows[0].finalAllocation, undefined);
});
