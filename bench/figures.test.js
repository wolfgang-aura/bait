/**
 * Figure drift guard. bench/FIGURES.json is the one copy of every headline figure; this test
 * fails if it drifts from the committed rows, reports and raw reads it is derived from, or if
 * any doc or served page (README, SUBMISSION, docs/, bench/*.md, prototype/public, the Pages
 * copy) states a headline figure that differs from it, names v3 as the default gate, or carries
 * a broken relative link. After a data change: `node bench/figures.js --write`, then fix the docs
 * this test names.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { computeFigures, loadFigures, checkDocs, checkText, checkLinks, FIGURES_FILE } from './figures.js';
import { PRODUCTION_GUARD_POLICY } from '../validation/guard.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('figure drift: FIGURES.json is exactly what the committed sources give (zero calls)', async () => {
  const derived = await computeFigures();
  assert.deepEqual(loadFigures(), JSON.parse(JSON.stringify(derived)),
    `${FIGURES_FILE} is stale: run node bench/figures.js --write, then fix the docs`);
});

test('figure drift: the headline figures are the published ones', () => {
  const F = loadFigures();
  assert.deepEqual([F.trueFacts.aiAlone, F.trueFacts.withNansenTools, F.trueFacts.behindBait], [[63, 78], [19, 78], [0, 78]]);
  assert.deepEqual([F.fakedEvidence.pnlRule, F.fakedEvidence.bait], [[49, 67], [0, 67]]);
  assert.deepEqual([F.heldout.losing, F.heldout.behindBait], [12, [0, 36]]);
  assert.deepEqual(F.cost.all, { decisions: 53, blocked: 6, capped: 9, fullAmount: 38 });
  assert.equal(F.gate.endpointCount, 5);
  assert.equal(F.gate.policy, PRODUCTION_GUARD_POLICY.id);
  const L = F.liveRound;
  assert.deepEqual([L.askUsd, L.allowedUsd, L.pnl30, L.smartMoneyOppositePct, L.smartMoneyTotalUsdM, L.verdict], [5000, 1250, 186449, 82, 47.8, 'CAPPED']);
  assert.equal(F.benchCommand, 'npm run bench -- --agent your-agent.mjs --snapshot');
});

test('figure drift: every doc, served page and the Pages copy matches FIGURES.json, names v4 as the default, and has no broken relative link', async () => {
  const problems = await checkDocs();
  assert.deepEqual(problems, [], `\n${problems.join('\n')}`);
});

test('figure drift: the checker catches a stale figure, a v3 default, a mixed bench command and a broken link', () => {
  const F = loadFigures();
  const caught = text => checkText('fixture.md', text, F);
  assert.equal(caught('the AI alone backed one in 64 of 78 runs').length, 1);
  assert.equal(caught('a simple PnL rule let 48/67 through').length, 1);
  assert.equal(caught('6 of 53 good-trader decisions blocked, 8 capped').length, 1);
  assert.equal(caught('38 of 52 good-trader transfers went through in full').length, 1);
  assert.equal(caught('BAIT reads four Nansen endpoints').length, 1);
  assert.equal(caught('smart money held 81% of its $47.8M in SOL').length, 1);
  assert.equal(caught('- **0x8923...1bac** capped: $1,300 allowed, $3,700 held').length, 3);
  assert.equal(caught('The default policy,\n`wallet-copy-risk-v3` reads').length, 1);
  assert.equal(caught('`npm run bench -- --agent x.mjs --a unarmed`').length, 1);
  assert.deepEqual(caught('## `wallet-copy-risk-v3` (default until 23 Sep 2026)'), []);
  assert.deepEqual(caught('63 of 78, 19 of 78, 0 of 78; 49 of 67; 6 of 53 good-trader decisions blocked, 9 capped'), []);
  assert.equal(checkLinks('docs/x.md', '[gone](missing.md) [ok](DETAILS.md) [anchor](../README.md#no-such-heading)').length, 2);
});

test('figure drift: the README explains every denominator once, in "The numbers"', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const numbers = readme.split('## The numbers')[1]?.split('\n## ')[0] ?? '';
  for (const den of ['of 78', 'of 26', 'of 67', 'of 54', 'of 18', 'of 36', 'of 35', 'of 53']) {
    assert.ok(numbers.includes(den), `"The numbers" does not explain "${den}"`);
  }
});
