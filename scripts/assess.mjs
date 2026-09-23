#!/usr/bin/env node
/**
 * BAIT copy-risk report from the command line.
 *
 *   npm run assess -- 0xc26cbb6483229e0d0f9a1cab675271eda535b8f4
 *   npm run assess -- frankdegods
 *   npm run assess -- --list
 *
 * Reads the frozen evidence already in the repository: Nansen snapshots for the
 * Hyperliquid addresses and recorded Fomo Radar tapes for the Fomo handles. It makes no
 * network call, spends no Nansen credit and takes no API key. Assessing an address that
 * is not in the frozen set needs a live capture, which this script will not make for you.
 *
 * Prints a short table for a person, then the machine summary an agent would branch on.
 */
import { loadRoster, findProspect } from '../prototype/roster.js';
import { agentVerdictLine } from '../validation/guard.js';

const usd = n => (n === null || n === undefined ? 'n/a' : `${n < 0 ? '-' : '+'}$${Math.round(Math.abs(n)).toLocaleString('en-US')}`);
const pct = n => (n === null || n === undefined ? 'n/a' : `${(n * 100).toFixed(1)}%`);
const row = (label, value) => `  ${label.padEnd(26)}${value}`;

const roster = loadRoster();
const query = process.argv.slice(2).filter(a => !a.startsWith('--'))[0];
const wantsList = process.argv.includes('--list') || !query;

if (wantsList) {
  console.log('\nBAIT copy-risk report. Addresses and handles in the frozen evidence set:\n');
  for (const p of roster) {
    console.log(row(p.handle ?? p.id, `${p.wallet}  ${p.venueLabel}`));
  }
  console.log('\nUsage: npm run assess -- <address|handle>\n');
  process.exit(query ? 0 : 1);
}

const prospect = findProspect(roster, query);
if (!prospect) {
  console.error(`\nNo frozen evidence for ${query}.`);
  console.error('BAIT assesses an unknown address from a live Nansen capture, which needs a');
  console.error('NANSEN_API_KEY and spends credits. Run `npm run assess -- --list` to see the');
  console.error('addresses and handles this repository already holds evidence for.\n');
  process.exit(1);
}

const { risk, truth } = prospect;
const stamp = { block: 'BLOCK', caution: 'CAUTION', allow: 'ALLOW' }[risk.verdict];

console.log(`\n${stamp}  ${prospect.name}${prospect.handle ? ` (${prospect.handle})` : ''}  ${prospect.venueLabel}`);
console.log(`  ${prospect.wallet}\n`);
console.log(row('Realised', `${usd(risk.summary.realised_30d)} over ${risk.windowDays} days, ${risk.summary.closed_trades ?? 'n/a'} closed trades`));
if (risk.summary.unrealised !== null) console.log(row('Unrealised, unsold', usd(risk.summary.unrealised)));
if (risk.summary.headline !== null) console.log(row('Profile headline', usd(risk.summary.headline)));
console.log(row('Win rate', pct(risk.summary.win_rate)));
console.log(row('Max drawdown', risk.summary.max_drawdown === null
  ? 'not available in this capture'
  : `${usd(-risk.summary.max_drawdown)} from the top${risk.summary.max_drawdown_share_of_peak !== null ? ` (${pct(risk.summary.max_drawdown_share_of_peak)} of the peak)` : ''}`));
console.log(row('Execution authorization', 'none, run the guard on fresh evidence'));
console.log(row('Evidence', `${risk.source}, captured ${risk.capturedLabel}`));
console.log(row('Basis', risk.basis));
console.log(row('Scope', truth.scope));

console.log('\nWhat you would be getting into:');
if (!risk.flags.length) console.log('  Nothing flagged against the thresholds in validation/guard.js.');
for (const flag of risk.flags) console.log(`  [${flag.severity}] ${flag.plain}`);
if (risk.coverage) console.log(`  Note: ${risk.coverage}`);
for (const skipped of risk.not_assessed) console.log(`  Not assessed, ${skipped.id}: ${skipped.reason}`);

console.log(`\n${agentVerdictLine(risk.verdict)}\n`);
console.log(JSON.stringify(risk.summary, null, 2));
console.log('');
