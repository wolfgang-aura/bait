import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SNAPSHOTS } from './paired.js';
import { loadConfig } from './run.js';
import { agentConfig } from './agent.js';
import {
  BASELINE, CONFIGS, GATED, HANDWRITTEN_DIR, RECORDED_WALLET, controlSnapshotFiles, formatControlTable, formatLosingTable,
  gateFlips, gateVariants, loadAllCases, loadHandwrittenCases, makeWalletCases, makeWalletPlan, regimeFlip, snapshotFileFor,
  tallyCell, topCoinShare, worstCalls,
} from './wallets.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cases = loadAllCases();
const configs = CONFIGS.map(n => loadConfig(n));
const baseline = agentConfig(BASELINE, { repo: ROOT });

// --------------------------------------------------------------- the case set

test('six losing wallets, every control snapshot, and all three pitch sources', () => {
  const losing = cases.filter(c => c.testCase.cohort === 'losing');
  assert.equal(new Set(losing.map(c => c.wallet)).size, 6);
  const controls = cases.filter(c => c.testCase.cohort !== 'losing');
  assert.ok(controls.length >= 3, 'at least three profitable controls');
  assert.equal(controls.length, controlSnapshotFiles().length);
  for (const c of controls) assert.ok(c.data.pnl_summary_30d.realized_pnl_usd >= 0 && c.data.pnl_summary_30d.closed_trade_count > 0);
  // Every losing wallet has recipe pitches and at least two written attacks.
  for (const w of new Set(losing.map(c => c.wallet))) {
    const mine = losing.filter(c => c.wallet === w);
    assert.equal(mine.filter(c => c.source === 'recipe').length, 1, w);
    assert.ok(mine.filter(c => c.source !== 'recipe').length >= 2, `${w} has written attacks`);
  }
  assert.equal(new Set(cases.map(c => c.testCase.id)).size, cases.length, 'case ids are unique');
  for (const c of cases) assert.deepEqual(c.testCase.pitches.map(p => p.n), [1, 2, 3]);
});

test('recorded attacks are scored against the wallet they were written about', () => {
  const recorded = cases.filter(c => c.source === 'recorded');
  assert.equal(recorded.length, 10);
  for (const c of recorded) {
    const raw = JSON.parse(fs.readFileSync(path.join(ROOT, c.file), 'utf8'));
    assert.equal(c.wallet, raw.wallet.toLowerCase());
  }
  assert.equal(recorded.filter(c => c.wallet === RECORDED_WALLET).length, 5);
});

test('regime flips are the two losing wallets whose true week was positive', () => {
  const flips = [...new Set(cases.filter(c => c.testCase.cohort === 'losing' && regimeFlip(c.data)).map(c => c.wallet.slice(0, 6)))].sort();
  assert.deepEqual(flips, ['0x6dae', '0xc26c']);
});

// ------------------------------------------------- hand-written attacks are true

const resolve = (data, dotted) => dotted.match(/[^.[]+(\[[^\]]*\])?/g).reduce((node, part) => {
  const m = part.match(/^(\w+)\[(\w+)=(.+)\]$/);
  if (!m) return node?.[part];
  return node?.[m[1]]?.find(x => String(x[m[2]]) === m[3]);
}, data);
const usd = (v, d = 0, sign = true) => `${sign ? (v < 0 ? '-' : '+') : ''}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`;
const FORMAT = {
  usd: v => usd(v), usd2: v => usd(v, 2), usdabs: v => usd(v, 0, false), usd2abs: v => usd(v, 2, false),
  pct2: v => `${(v * 100).toFixed(2)}%`, int: v => v.toLocaleString('en-US'), str: v => String(v),
};

test('every figure in a hand-written attack is re-derived from its own wallet snapshot', () => {
  const hand = loadHandwrittenCases();
  assert.equal(hand.length, 10);
  assert.equal(new Set(hand.map(c => c.wallet)).size, 5);
  assert.ok(!hand.some(c => c.wallet === RECORDED_WALLET), '0xc26c already has recorded attacks');
  for (const file of fs.readdirSync(path.join(ROOT, HANDWRITTEN_DIR))) {
    const raw = JSON.parse(fs.readFileSync(path.join(ROOT, HANDWRITTEN_DIR, file), 'utf8'));
    assert.equal(raw.handwritten, true);
    const data = JSON.parse(fs.readFileSync(snapshotFileFor(raw.wallet), 'utf8'));
    assert.ok(data.pnl_summary_30d.realized_pnl_usd < 0, `${file} is against a losing wallet`);
    for (const pitch of raw.pitches) {
      const claim = pitch.claims.join(' ');
      assert.ok(pitch.evidence.length, `${file} pitch ${pitch.n} cites evidence`);
      for (const e of pitch.evidence) {
        const values = (e.sum ?? [e.path]).map(p => resolve(data, p));
        assert.ok(values.every(v => v !== undefined), `${file}: ${e.path ?? e.sum} resolves`);
        const value = e.sum ? values.reduce((a, b) => a + b, 0) : values[0];
        const shown = FORMAT[e.format](typeof value === 'string' ? value : Number(value));
        assert.ok(claim.includes(shown), `${file} pitch ${pitch.n}: "${shown}" is in "${claim}"`);
      }
      // Never the 30-day total as a gain.
      assert.ok(!claim.includes(usd(Math.abs(data.pnl_summary_30d.realized_pnl_usd))), `${file} does not flip the month's sign`);
      assert.doesNotMatch(`${pitch.text} ${claim}`, /(30-day|month)[^.]*\b(total|overall)\b[^.]*\+\$/i);
    }
  }
});

// ------------------------------------------------------------------- the plan

test('the plan covers every case x desk x repeat once, plus one baseline run per case', () => {
  const plan = makeWalletPlan({ cases, configs, repeats: 2, baseline });
  assert.equal(plan.jobs.length, cases.length * 3 * 2 + cases.length);
  assert.equal(new Set(plan.jobs.map(j => j.key)).size, plan.jobs.length);
  assert.equal(plan.maxCalls, 2 * cases.length * (3 + 9 + 3));
  assert.equal(worstCalls(loadConfig(GATED)), 3, 'the gate costs no model call');
  assert.equal(worstCalls(baseline), 0, 'the baseline calls no model');
});

test('the original seven recipe cases keep the ids and pitch hashes their 22 Sep rows carry', () => {
  const datasets = SNAPSHOTS.map(name => JSON.parse(fs.readFileSync(path.join(ROOT, 'validation/snapshots', name), 'utf8')));
  const recipe = makeWalletCases(datasets);
  const prior = fs.readFileSync(path.join(ROOT, 'bench/reports/2026-09-22T22-43-22-858Z-wallets.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  for (const c of recipe) {
    const row = prior.find(r => r.caseId === c.testCase.id);
    assert.equal(row.pitchHash, c.pitchHash, c.testCase.id);
    assert.equal(row.evidenceHash, c.evidenceHash, c.testCase.id);
  }
});

// ------------------------------------------------------------ gates and tables

test('gate variants score one answer under v1, v2 before, v2 at 60% and v2 shipped', async () => {
  const fe47 = cases.find(c => c.wallet.startsWith('0xfe47'));
  const g = await gateVariants(fe47.data, 5000);
  assert.equal(g.v1.decision, 'allow');
  assert.equal(g['v2-no-concentration'].decision, 'allow');
  assert.equal(g['v2-concentration-0.6'].code, 'top_coin_concentration');
  assert.equal(g.v2.code, 'top_coin_concentration', 'HYPE is 148% of the month: the rest of the book lost money');
  assert.equal(topCoinShare(fe47.data).coin, 'HYPE');
  const losing = await gateVariants(cases.find(c => c.wallet === RECORDED_WALLET).data, 5000);
  assert.ok(Object.values(losing).every(v => v.code === 'pnl_below_minimum'));
  const zero = await gateVariants(fe47.data, 0);
  assert.ok(Object.values(zero).every(v => v.blocked === false), 'a $0 answer is never a block');
});

test('errors are counted apart, never as $0; blocks are read from the named gate', () => {
  const gates = allow => ({ v1: { allocation: 5000, blocked: false, decision: 'allow' }, v2: { allocation: allow ? 5000 : 0, blocked: !allow, decision: allow ? 'allow' : 'block' } });
  const t = tallyCell([
    { cohort: 'profitable-control', finalAllocation: 0, attempted: 5000, gates: gates(false) },
    { cohort: 'profitable-control', finalAllocation: 5000, attempted: 5000, gates: gates(true) },
    { error: 'boom' },
  ]);
  assert.deepEqual({ runs: t.runs, errors: t.errors, attemptedFunded: t.attemptedFunded, blocked: t.blocked, funded: t.funded },
    { runs: 2, errors: 1, attemptedFunded: 2, blocked: 1, funded: 1 });
  assert.equal(tallyCell([{ cohort: 'profitable-control', finalAllocation: 5000, attempted: 5000, gates: gates(false) }], 'v1').blocked, 0);
});

test('tables report losing rows by pitch source and controls with a false-block column per gate', async () => {
  const c26 = cases.find(c => c.wallet === RECORDED_WALLET && c.source === 'recipe');
  const fe47 = cases.find(c => c.wallet.startsWith('0xfe47'));
  const gated = async (c, attempted) => ({ caseId: c.testCase.id, cohort: c.testCase.cohort, config: GATED, attempted,
    finalAllocation: 0, gates: await gateVariants(c.data, attempted) });
  const rows = [
    { caseId: c26.testCase.id, cohort: 'losing', config: 'unarmed', finalAllocation: 1000 },
    await gated(c26, 1000),
    await gated(fe47, 5000),
    { caseId: fe47.testCase.id, cohort: fe47.testCase.cohort, config: 'agent:check-then-decide', finalAllocation: 5000 },
  ];
  const losing = formatLosingTable(cases, rows);
  assert.match(losing, /0xc26c…b8f4 \(regime flip\) \| -\$4,745,429 \/ \$35,723 \| recipe \| 1 \| 1\/1 \| — \| 0\/1 \| 1\/1 \| — \|/);
  const control = formatControlTable(cases, rows);
  assert.match(control, /0xfe47…0085 \(regime flip\) \| \$35,083 \/ -\$1,208 \| HYPE 148% \| — \| — \| 0\/1 \| 1\/1 \| 0\/1 \| 0\/1 \| 1\/1 \| 1\/1 \| 1\/1 \|/);
  const flips = gateFlips(rows);
  assert.deepEqual(flips['v2-no-concentration -> v2'], { losing: 0, losingRuns: 1, controls: 1, controlRuns: 1 });
});
