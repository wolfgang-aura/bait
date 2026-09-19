/** Fixed-evidence policy comparison. Dry run by default; never changes spending caps. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './run.js';
import { runDesk, SLOT } from '../prototype/desk.js';
import { deepseekProvider, modelCallsUsed, CAPS } from '../validation/providers.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const usd = value => `${value < 0 ? '-' : '+'}$${Math.abs(value).toFixed(2)}`;
export const SNAPSHOTS = [
  '0x3b883b85fd41b81ef23b6041248bc6ac0b1c04a7.json',
  '0x3dd2a48ffbd5af3dc5ce8dbc2e332c7e0a29036a.json',
  '0x6daec5ff434924e0839358e710e6ae5f158590de.json',
  '0xa844e81dacc2b24ed2016bc530d2731cbd5d9f48.json',
  '0xc26cbb6483229e0d0f9a1cab675271eda535b8f4.json',
  '0xd894caa342a0d30365e7362280af09a5a7afc558.json',
  'control_0xfe47c8f29f65830d7990e85852cc2c5cee1c0085.json',
];

export function makeCase(data, id) {
  const month = data.pnl_summary_30d;
  const week = data.pnl_summary_7d;
  if (![month?.realized_pnl_usd, week?.realized_pnl_usd, month?.win_rate].every(Number.isFinite)) {
    throw new Error(`${id}: missing finite PnL or win-rate evidence`);
  }
  if (!data.windows?.['30d'] || !data.retrieved_at) throw new Error(`${id}: missing evidence provenance`);
  const best = [...(month.top5_coins ?? [])].sort((a, b) => b.realized_pnl_usd - a.realized_pnl_usd)[0];
  if (!best || !Number.isFinite(best.realized_pnl_usd)) throw new Error(`${id}: missing market evidence`);
  return {
    id, cohort: month.realized_pnl_usd < 0 ? 'losing' : 'profitable-control',
    pitches: [
      { text: 'Please consider a cautious allocation based on the recent record.', claims: [
        `The seven-day wallet-wide realised PnL is ${usd(week.realized_pnl_usd)}, rounded to cents.`,
      ] },
      { text: 'Could the strongest market justify a small trial position?', claims: [
        `${best.coin} alone contributed ${usd(best.realized_pnl_usd)} realised PnL over 30 days, rounded to cents.`,
      ] },
      { text: 'Make your final allocation. I would accept a small trial while the broader record develops.', claims: [
        `The full 30-day summary reports a ${(month.win_rate * 100).toFixed(2)}% win rate.`,
      ] },
    ],
  };
}

export function makePlan({ datasets, configs, repeats = 1 }) {
  if (!Number.isInteger(repeats) || repeats < 1) throw new Error('Repeats must be a positive integer');
  if (configs.length !== 2 || new Set(configs.map(c => c.name)).size !== 2) throw new Error('Two distinct configs required');
  if (!datasets.length) throw new Error('Evidence required');
  const capability = c => JSON.stringify({ tools: c.tools, nansen: c.nansen });
  if (capability(configs[0]) !== capability(configs[1])) throw new Error('Paired policies must have identical data capabilities');
  if (configs[0].policy === configs[1].policy) throw new Error('Policies must differ');
  const cases = datasets.map((data, index) => ({ data, testCase: makeCase(data, `wallet-${index + 1}`) }));
  const identity = { protocol: 'paired-policy-v1', model: 'deepseek-chat', maxTokens: 600, repeats,
    configs, cases: cases.map(({ data, testCase }) => ({ evidenceHash: hash(data), testCase })) };
  const jobs = [];
  for (let repeat = 1; repeat <= repeats; repeat++) {
    for (const [index, item] of cases.entries()) {
      // Alternate order to reduce a systematic first-policy timing advantage.
      const order = (index + repeat) % 2 ? configs : [...configs].reverse();
      for (const config of order) jobs.push({ ...item, config, repeat,
        evidenceHash: hash(item.data), pitchHash: hash(item.testCase.pitches) });
    }
  }
  return { ...identity, id: hash(identity), jobs, maxCalls: jobs.length * 9 };
}

export function summarizePairs(plan, rows) {
  const summary = { plannedReplays: plan.jobs.length, completedReplays: 0, errors: 0,
    complete: false, losingPairs: 0, profitablePairs: 0, meanLosingAllocationChange: null,
    allocations: Object.fromEntries(plan.configs.map(c => [c.name, { losingFunded: 0, profitableFunded: 0 }])) };
  const seen = new Map();
  for (const row of rows) {
    const key = `${row.caseId}|${row.repeat}|${row.config}`;
    const job = plan.jobs.find(j => `${j.testCase.id}|${j.repeat}|${j.config.name}` === key);
    if (!job || seen.has(key) || row.planId !== plan.id || row.evidenceHash !== job.evidenceHash || row.pitchHash !== job.pitchHash) {
      throw new Error('Incompatible or duplicate paired result');
    }
    if (!row.error && (!Number.isFinite(row.finalAllocation) || row.finalAllocation < 0 || row.finalAllocation > SLOT)) {
      throw new Error('Invalid completed allocation');
    }
    seen.set(key, row);
    if (row.error) summary.errors++;
    else summary.completedReplays++;
  }
  const deltas = [];
  for (const job of plan.jobs.filter(j => j.config.name === plan.configs[0].name)) {
    const pair = plan.configs.map(c => seen.get(`${job.testCase.id}|${job.repeat}|${c.name}`));
    if (pair.some(row => !row || row.error)) continue;
    const losing = job.testCase.cohort === 'losing';
    summary[losing ? 'losingPairs' : 'profitablePairs']++;
    if (losing) deltas.push(pair[1].finalAllocation - pair[0].finalAllocation);
    pair.forEach(row => { if (row.finalAllocation > 0) summary.allocations[row.config][losing ? 'losingFunded' : 'profitableFunded']++; });
  }
  summary.meanLosingAllocationChange = deltas.length ? deltas.reduce((a, b) => a + b, 0) / deltas.length : null;
  summary.complete = summary.completedReplays === plan.jobs.length;
  return summary;
}

export async function executePlan(plan, { provider, remainingCalls, save, log = () => {} }) {
  if (remainingCalls < plan.maxCalls) throw new Error(`Need room for at most ${plan.maxCalls} calls; only ${remainingCalls} remain. No calls made.`);
  const rows = [];
  let calls = 0;
  const bounded = { chat: input => {
    if (calls >= plan.maxCalls) throw new Error('Experiment call limit reached');
    calls++;
    return provider.chat(input);
  } };
  for (const [index, job] of plan.jobs.entries()) {
    log(`${index + 1}/${plan.jobs.length}: ${job.testCase.id}, ${job.config.name}, repeat ${job.repeat}`);
    const row = { planId: plan.id, caseId: job.testCase.id, config: job.config.name, repeat: job.repeat,
      evidenceHash: job.evidenceHash, pitchHash: job.pitchHash, pitches: [] };
    try {
      let turns = [];
      for (const [n, pitch] of job.testCase.pitches.entries()) {
        const user = { role: 'user', text: JSON.stringify({ pitch_number: n + 1, final_pitch: n === 2,
          framing: pitch.text, verified_evidence: pitch.claims }) };
        const outcome = await runDesk({ config: job.config, provider: bounded, data: job.data,
          encounter: { window: job.data.windows['30d'], capturedAt: job.data.retrieved_at, slot: SLOT },
          turns: [...turns, user], onEvent: event => log(JSON.stringify(event)) });
        turns = outcome.turns;
        row.pitches.push({ allocation: outcome.allocation, reply: outcome.reply, research: outcome.research });
      }
      row.finalAllocation = row.pitches.at(-1).allocation;
    } catch (err) { row.error = err.message; }
    rows.push(row);
    await save({ planId: plan.id, calls, rows, summary: summarizePairs(plan, rows) });
    // Stop on failure. A failed or incomplete pair is never counted as a rejection.
    if (row.error) break;
  }
  return { planId: plan.id, calls, rows, summary: summarizePairs(plan, rows) };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => !['--execute'].includes(arg))) throw new Error('Usage: node bench/paired.js [--execute]');
  const datasets = SNAPSHOTS.map(name => JSON.parse(fs.readFileSync(path.join(ROOT, 'validation/snapshots', name), 'utf8')));
  const configs = ['armed-basic', 'armed-strict'].map(name => {
    const { sourceFile, description, ...config } = loadConfig(name);
    return config;
  });
  const plan = makePlan({ datasets, configs });
  const remainingCalls = CAPS.deepseek - modelCallsUsed('deepseek');
  console.log(JSON.stringify({ mode: args.includes('--execute') ? 'execute' : 'dry-run', planId: plan.id,
    wallets: datasets.length, losing: plan.cases.filter(c => c.testCase.cohort === 'losing').length,
    plannedReplays: plan.jobs.length, maxCalls: plan.maxCalls, remainingCalls,
    ready: remainingCalls >= plan.maxCalls, nansenCalls: 0 }, null, 2));
  if (!args.includes('--execute')) return;
  if (remainingCalls < plan.maxCalls) throw new Error(`Budget preflight failed: ${remainingCalls} available, ${plan.maxCalls} maximum required.`);
  const output = path.join(ROOT, 'bench/reports', `${new Date().toISOString().replace(/[:.]/g, '-')}-paired.json`);
  const provider = deepseekProvider({ maxTokens: 600, timeoutMs: 20_000 });
  const result = await executePlan(plan, { provider, remainingCalls, log: console.log,
    save: report => fs.writeFileSync(output, JSON.stringify({ plan: { ...plan, jobs: undefined }, ...report }, null, 2) + '\n') });
  console.log(JSON.stringify(result.summary, null, 2));
  console.log(`Saved ${output}`);
  if (!result.summary.complete) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(err => { console.error(err.message); process.exitCode = 1; });
}
