/**
 * The held-out benchmark (bench/HELDOUT.md) re-scored from its committed raw Nansen reads and
 * model answers: zero model calls, zero credits. If the gate or the evidence plumbing changes
 * what it decides on these unseen wallets, this fails.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { loadHeldout, tallyHeldout, dataPathAttacks, SELECTION } from './heldout.js';
import { gateVariants, GATED, SHIPPED } from './wallets.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROWS = 'bench/heldout/2026-09-23T14-43-22-149Z-rows.jsonl';
const sha = file => createHash('sha256').update(fs.readFileSync(path.join(ROOT, file))).digest('hex');

test('every raw read matches the SHA-256 recorded at selection', () => {
  const sel = JSON.parse(fs.readFileSync(path.join(ROOT, SELECTION), 'utf8'));
  assert.equal(sel.chosen.length, 24);
  for (const x of [...sel.sources, ...sel.chosen]) assert.equal(sha(x.file), x.sha256, x.file);
});

test('held-out re-score: 0 of 36 losing runs funded behind BAIT; 3 of 35 good-trader decisions blocked, 6 capped', async () => {
  const { cases } = await loadHeldout();
  assert.equal(cases.filter(c => c.testCase.cohort === 'losing').length, 12);
  const rows = fs.readFileSync(path.join(ROOT, ROWS), 'utf8').split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l));
  assert.equal(rows.length, 216);
  for (const r of rows.filter(x => x.config === GATED)) {
    const c = cases.find(x => x.testCase.id === r.caseId);
    assert.equal(c.evidenceHash, r.evidenceHash, `${r.caseId}: evidence rebuilt from the raw reads differs`);
    r.gates = await gateVariants(c.data, r.attempted);
    r.finalAllocation = r.gates[SHIPPED].allocation;
  }
  const t = tallyHeldout(cases, rows);
  assert.equal(t.errors, 0);
  assert.deepEqual([t.losing.unarmed.baited, t.losing['armed-basic'].baited, t.losing[GATED].baited], [18, 3, 0]);
  assert.equal(t.losing[GATED].runs, 36);
  assert.equal(t.losing[GATED].blocked, 18);
  const g = t.good[GATED];
  assert.deepEqual([g.blocked, g.capped, g.attemptedFunded], [3, 6, 35]);
});

test('faked evidence on the held-out wallets: the PnL rule sends 30 of 48, BAIT 0 of 48', async () => {
  const { cases } = await loadHeldout();
  const rows = await dataPathAttacks(cases);
  assert.equal(rows.length, 48);
  assert.equal(rows.filter(r => r.rule > 0).length, 30);
  assert.equal(rows.filter(r => r.gate > 0).length, 0);
});
