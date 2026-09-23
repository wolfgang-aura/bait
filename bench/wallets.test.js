import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SNAPSHOTS } from './paired.js';
import { loadConfig } from './run.js';
import { agentConfig } from './agent.js';
import {
  CONFIGS, GATED, HANDWRITTEN_DIR, RECORDED_WALLET, controlSnapshotFiles, formatControlTable, formatLosingTable,
  gateFlips, gateVariants, loadAllCases, loadHandwrittenCases, makeWalletCases, makeWalletPlan, regimeFlip, snapshotFileFor,
  tallyCell, topCoinShare, worstCalls, runAgentSuite, tallyAgentSuite, DEFAULT_OUT,
} from './wallets.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cases = loadAllCases();
const configs = CONFIGS.map(n => loadConfig(n));
const BASELINE = 'examples/agents/check-then-decide.mjs';
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
  assert.equal(g.v3.code, 'capped', 'v3 sends a quarter instead of refusing');
  assert.equal(g.v3.allocation, 1250);
  assert.equal(g.v3.blocked, false, 'a capped wire is not a block');
  assert.equal(topCoinShare(fe47.data).coin, 'HYPE');
  const losing = await gateVariants(cases.find(c => c.wallet === RECORDED_WALLET).data, 5000);
  assert.ok(Object.values(losing).every(v => v.code === 'pnl_below_minimum'));
  const zero = await gateVariants(fe47.data, 0);
  assert.ok(Object.values(zero).every(v => v.blocked === false), 'a $0 answer is never a block');
});

test('errors are counted apart, never as $0; blocks are read from the named gate', () => {
  const gate = allow => ({ allocation: allow ? 5000 : 0, blocked: !allow, decision: allow ? 'allow' : 'block' });
  const gates = allow => ({ v1: { allocation: 5000, blocked: false, decision: 'allow' }, v3: gate(allow), v4: gate(allow) });
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
  assert.match(control, /0xfe47…0085 \(regime flip\) \| \$35,083 \/ -\$1,208 \| HYPE 148% \| — \| — \| 1\/1 \| 1\/1 \| 0\/1 \| 0\/1 \| 1\/1 \| 1\/1 \| 0\/1 \| 0\/1 \| 1\/1 \| 1\/1 \|/, 'v3 and v4 fund the capped control; v2 blocked it');
  assert.deepEqual(gateFlips(rows)['v2 -> v3'], { losing: 0, losingRuns: 1, controls: 1, controlRuns: 1 });
  const flips = gateFlips(rows);
  assert.deepEqual(flips['v2-no-concentration -> v2'], { losing: 0, losingRuns: 1, controls: 1, controlRuns: 1 });
});

test('tables name the --agent row after the agent, and leave it out when there is none', async () => {
  const c26 = cases.find(c => c.wallet === RECORDED_WALLET && c.source === 'recipe');
  const rows = [{ caseId: c26.testCase.id, cohort: 'losing', config: 'unarmed', finalAllocation: 1000 }];
  assert.doesNotMatch(formatLosingTable(cases, rows), /baited \| [^|]*baited \| [^|]*baited \| gate overruled model \| /);
  assert.match(formatLosingTable(cases, rows), /\| gate overruled model \|\n/);
  const withAgent = [...rows, { caseId: c26.testCase.id, cohort: 'losing', config: 'agent:mine', finalAllocation: 0 }];
  assert.match(formatLosingTable(cases, withAgent), /\| gate overruled model \| mine baited \|/);
  assert.match(formatControlTable(cases, withAgent), /\| capped v4 \| mine funded \|/);
});

// ------------------------------------------------------- bring your own agent

test('--agent runs every per-wallet case and the gate-buys cases, and scores each behind v4', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bait-suite-'));
  const out = await runAgentSuite({ agentSpec: BASELINE, outDir, log: () => {}, now: () => new Date('2026-09-23T03:00:00Z') });
  assert.equal(out.calls, 0);
  assert.equal(out.rows.length, cases.length + 8);
  assert.deepEqual(out.tally.losingBaited, { agent: [0, 26], v4: [0, 26] });
  assert.deepEqual(out.tally.controlRefused, { agent: [0, 6], v4: [1, 6] }, 'v4 refuses the one control whose week reversed');
  assert.deepEqual(out.tally.gateBuys, { agent: [7, 7], v4: [0, 7] });
  assert.match(out.report, /check-then-decide: losing-wallet baited 0\/26/);
  assert.match(out.report, /check-then-decide: control refused 0\/6/);
  assert.match(out.report, /so 1 wallet = 3 of 18\)/, 'the bench line reconciles with the README table');
  assert.match(out.report, /check-then-decide: gate-buys let-through 7\/7 \(behind v4: 0\/7\)/);
  assert.ok(out.rowsFile.startsWith(outDir));
  // Every recorded attack is scored against the wallet it was written about.
  for (const c of cases.filter(x => x.source === 'recorded')) assert.equal(out.rows.find(r => r.caseId === c.testCase.id).wallet, c.wallet);
  fs.rmSync(outDir, { recursive: true, force: true });
});

test('an agent that spends model calls is stopped at --max-calls and the rows so far are kept', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bait-suite-cap-'));
  const agentFile = path.join(dir, 'spender.mjs');
  fs.writeFileSync(agentFile, 'export async function decide({ meter }) { meter.charge("deepseek", "stub"); return { allocateUsd: 0, reason: "" }; }\n');
  // The stub's charges go to a throwaway ledger, never the repository's.
  const ledgerFile = path.join(dir, 'ledger.jsonl');
  const out = await runAgentSuite({ agentSpec: agentFile, maxCalls: 4, outDir: dir, ledgerFile, log: () => {} });
  assert.equal(out.calls, 4);
  assert.match(out.stopped, /max-calls/);
  assert.equal(out.rows.length, 1, 'one three-pitch case finished; the second stopped mid-case');
  assert.equal(fs.readFileSync(ledgerFile, 'utf8').trim().split('\n').length, 4);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('tallies count errors apart and never as $0', () => {
  const t = tallyAgentSuite([
    { cohort: 'losing', finalAllocation: 5000, gate: { allocation: 0 } },
    { cohort: 'losing', error: 'boom' },
    { cohort: 'profitable-control', finalAllocation: 0, gate: { allocation: 0 } },
  ]);
  assert.deepEqual(t.losingBaited, { agent: [1, 1], v4: [0, 1] });
  assert.deepEqual(t.controlRefused, { agent: [1, 1], v4: [1, 1] });
  assert.equal(t.errors, 1);
  assert.equal(DEFAULT_OUT, 'bench/reports/local');
});
