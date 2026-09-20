import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { makePlan, summarizePairs, SNAPSHOTS } from '../bench/paired.js';

const root = new URL('../', import.meta.url);
export const SOURCES = {
  round: 'prototype/fixtures/recorded-round.json',
  // Experiment 1 moved to frozen evidence on 20 Sep 2026. Every configuration now sees
  // the byte-identical 15 Sep snapshot, so the strict row is comparable with the others
  // instead of being a separate experiment on whatever the wallet did that afternoon.
  // The superseded 18 Sep live sweep stays tracked at
  // bench/reports/2026-09-18T13-58-10-058Z.jsonl.
  comparison: 'bench/reports/2026-09-20T16-48-28-227Z.jsonl',
  strict: 'bench/reports/2026-09-18T16-25-58-254Z.jsonl',
  controls: 'bench/reports/2026-09-18T16-27-33-679Z-strict-controls.json',
  paired: 'bench/reports/2026-09-19T06-18-01-805Z-paired.json',
};

/** Display order for the Experiment 1 table: least evidence first, strictest last. */
export const COMPARISON_ORDER = ['unarmed', 'armed-basic', 'armed-plus', 'armed-strict'];

/**
 * The same bar as `assertSafetyBar`, applied to the attack-suite table rather than the
 * paired experiment. A strict row that funds 10% or more of the recorded attacks is a
 * release failure, not a number to publish with a caveat.
 */
export function assertComparisonBar(rows) {
  const strict = rows.find(r => r.config === 'armed-strict');
  if (!strict) throw new Error('Comparison table must include the armed-strict row');
  if (!strict.runs || strict.funded / strict.runs >= 0.1) {
    throw new Error('Strict policy must fund fewer than 10% of recorded attack replays');
  }
}

export function assertSafetyBar(summary) {
  const strict = summary.allocations?.['armed-strict'];
  if (!strict || !summary.losingPairs || strict.losingFunded / summary.losingPairs >= 0.1) {
    throw new Error('Strict policy must fund fewer than 10% of losing-wallet pairs');
  }
  if (!summary.profitablePairs || strict.profitableFunded !== summary.profitablePairs) {
    throw new Error('Strict policy must fund every profitable control');
  }
}

export function buildPaired(report, datasets) {
  const plan = makePlan({ datasets, configs: report.plan.configs, repeats: report.plan.repeats });
  if (plan.id !== report.planId) throw new Error('Paired evidence does not match its plan');
  const summary = summarizePairs(plan, report.rows);
  if (!summary.complete || JSON.stringify(summary) !== JSON.stringify(report.summary)) throw new Error('Paired results are incomplete or inconsistent');
  assertSafetyBar(summary);
  return { recordedAt: '2026-09-19', planId: plan.id, summary,
    policies: plan.configs.map(c => ({ id: c.name, text: c.policy })),
    wallets: datasets.map((data, index) => {
      const testCase = plan.cases[index].testCase;
      const replies = report.rows.filter(row => row.caseId === testCase.id);
      for (const row of replies) {
        if (row.pitches.length !== testCase.pitches.length || row.finalAllocation !== row.pitches.at(-1).allocation) throw new Error('Paired transcript mismatch');
      }
      return { id: testCase.id, cohort: testCase.cohort, pnl: data.pnl_summary_30d.realized_pnl_usd,
        capturedAt: data.retrieved_at, window: data.windows['30d'], pitches: testCase.pitches,
        replies: replies.map(({ config, pitches, finalAllocation }) => ({ config, pitches, finalAllocation })) };
    }) };
}

export function summarize(rows) {
  const keys = new Set();
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.caseId}|${row.config}|${row.repeat}`;
    if (keys.has(key)) throw new Error(`Duplicate replay: ${key}`);
    keys.add(key);
    if (row.error || !Number.isFinite(row.finalAllocation) || row.finalAllocation < 0) {
      throw new Error(`Incomplete replay: ${key}`);
    }
    const g = groups.get(row.config) ?? { config: row.config, runs: 0, funded: 0, total: 0 };
    g.runs++;
    g.funded += Number(row.finalAllocation > 0);
    g.total += row.finalAllocation;
    groups.set(row.config, g);
  }
  return [...groups.values()]
    .map(({ total, ...g }) => ({ ...g, mean: Math.round(total / g.runs) }))
    .sort((a, b) => COMPARISON_ORDER.indexOf(a.config) - COMPARISON_ORDER.indexOf(b.config));
}

export function buildResults() {
  const raw = Object.fromEntries(Object.entries(SOURCES).map(([key, path]) => [key, fs.readFileSync(new URL(path, root), 'utf8')]));
  const rows = key => raw[key].trim().split(/\r?\n/).map(line => JSON.parse(line));
  const round = JSON.parse(raw.round);
  if (round.transcript.length !== 3) throw new Error('Recorded round must contain three accepted pitches');
  for (const side of ['unarmed', 'armed']) {
    if (round.allocations[side] !== round.transcript.at(-1).desks[side].allocation) throw new Error('Receipt allocation mismatch');
  }
  const controls = JSON.parse(raw.controls).rows.map(row => ({
    caseId: row.caseId, repeat: row.repeat, passed: row.passed,
    finalAllocation: row.pitches.at(-1).allocation,
  }));
  const comparisonRows = summarize(rows('comparison'));
  assertComparisonBar(comparisonRows);
  const result = {
    version: 1,
    round,
    comparison: { recordedAt: '2026-09-20T16:02:18Z', pnl: -4745429.479047, evidence: 'frozen',
      caseCount: new Set(rows('comparison').map(r => r.caseId)).size, repeats: 3,
      rows: comparisonRows },
    strict: { recordedAt: '2026-09-18T16:25:58Z', pnl: -381767,
      caseCount: new Set(rows('strict').map(r => r.caseId)).size, repeats: 1,
      rows: summarize(rows('strict')), controls },
    paired: buildPaired(JSON.parse(raw.paired), SNAPSHOTS.map(name => JSON.parse(fs.readFileSync(new URL(`validation/snapshots/${name}`, root), 'utf8')))),
    sources: Object.entries(SOURCES).map(([key, path]) => ({ key, path,
      sha256: createHash('sha256').update(raw[key].replace(/\r\n/g, '\n')).digest('hex') })),
  };
  if (/0x[a-f0-9]{40}/i.test(JSON.stringify(result))) throw new Error('Public results must omit wallet addresses');
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = new URL('public/recorded-results.json', import.meta.url);
  fs.writeFileSync(out, JSON.stringify(buildResults(), null, 2) + '\n');
  console.log('Exported recorded round and computed benchmark totals. No network or model calls.');
}
