import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { summarize, buildResults, buildPaired, assertSafetyBar, SOURCES } from './export-results.js';
import { SNAPSHOTS } from '../bench/paired.js';

test('published results reproduce source receipts and keep strict results separate', () => {
  const results = buildResults();
  assert.deepEqual(results, JSON.parse(fs.readFileSync(new URL('./public/recorded-results.json', import.meta.url))));
  assert.deepEqual(results.comparison.rows.map(r => [r.config, r.runs, r.funded, r.mean]), [
    ['unarmed', 30, 23, 4142], ['armed-basic', 30, 13, 950], ['armed-plus', 30, 9, 450],
  ]);
  assert.equal(results.strict.rows[0].runs, 10);
  assert.equal(results.strict.rows[0].funded, 0);
  assert.notEqual(results.comparison.pnl, results.strict.pnl);
  assert.equal(results.round.allocations.unarmed, 13750);
  assert.equal(results.round.allocations.armed, 2500);
  assert.equal(results.strict.controls.length, 4);
  assert.equal(results.paired.summary.losingPairs, 6);
  assert.equal(results.paired.wallets.length, 7);
  assert.equal(results.paired.wallets[2].replies.find(r => r.config === 'armed-basic').finalAllocation, 1000);
  assert.doesNotMatch(JSON.stringify(results), /0x[a-f0-9]{40}/i);
});

test('paired export refuses altered evidence, missing results and contradictory final replies', () => {
  const report = JSON.parse(fs.readFileSync(new URL(`../${SOURCES.paired}`, import.meta.url)));
  const datasets = SNAPSHOTS.map(name => JSON.parse(fs.readFileSync(new URL(`../validation/snapshots/${name}`, import.meta.url))));
  const changed = structuredClone(datasets);
  changed[0].pnl_summary_30d.realized_pnl_usd = 1;
  assert.throws(() => buildPaired(report, changed), /does not match/);
  assert.throws(() => buildPaired({ ...report, rows: report.rows.slice(1) }, datasets), /incomplete/);
  const badReply = structuredClone(report);
  badReply.rows[0].pitches.at(-1).allocation = 123;
  assert.throws(() => buildPaired(badReply, datasets), /transcript mismatch/);
});

test('missing or duplicated replays cannot become a zero-allocation result', () => {
  const row = { caseId: 'a', config: 'b', repeat: 1, finalAllocation: 0 };
  assert.throws(() => summarize([{ ...row, finalAllocation: null }]), /Incomplete/);
  assert.throws(() => summarize([{ ...row, error: 'Timeout' }]), /Incomplete/);
  assert.throws(() => summarize([row, row]), /Duplicate/);
});

test('public release enforces the strict policy safety bar and profitable control', () => {
  const passing = { losingPairs: 11, profitablePairs: 1, allocations: {
    'armed-strict': { losingFunded: 1, profitableFunded: 1 },
  } };
  assert.doesNotThrow(() => assertSafetyBar(passing));
  assert.throws(() => assertSafetyBar({ ...passing, losingPairs: 10 }), /fewer than 10%/);
  assert.throws(() => assertSafetyBar({ ...passing, allocations: {
    'armed-strict': { losingFunded: 0, profitableFunded: 0 },
  } }), /every profitable control/);
});
