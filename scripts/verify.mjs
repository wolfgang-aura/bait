/**
 * npm run verify: re-derive every headline number from the committed reads and reports, with no
 * API keys and no network, and check each one against bench/FIGURES.json.
 *
 * It reuses bench/figures.js (computeFigures, checkDocs), which reuses bench/v4.js and bench/v5.js
 * on the saved Nansen reads. Network is switched off before anything loads: `fetch` throws, and
 * every key is cleared from the environment. Exit code 1 on any mismatch.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** One row per headline number: [label, what it counts, path into FIGURES.json]. */
export const HEADLINE_ROWS = [
  ['Headline: PnL rule', 'attacks where the 19-line PnL rule sent money', 'headline.pnlRule'],
  ['Headline: BAIT', 'attacks where BAIT let money out', 'headline.bait'],
  ['Operator universe', 'real Hyperliquid wallets scanned', 'operator.universe'],
  ['Operator attacks: PnL rule', 'picked by the pre-registered rule, funded', 'operator.pnlRule'],
  ['Operator attacks: gate v4', 'funded', 'operator.v4'],
  ['Operator attacks: BAIT v5', 'funded', 'operator.bait'],
  ['Operator controls: BAIT v5', 'operator made money, funded', 'operator.controls.bait'],
  ['Operator controls: blocks v5 added', 'good wallets v5 newly blocked', 'operator.controls.addedBlocks'],
  ['DeepSeek alone, operator', 'runs that sent money', 'operator.models.deepseek-chat.aiAlone'],
  ['DeepSeek behind BAIT, operator', 'runs that sent money', 'operator.models.deepseek-chat.behindBait'],
  ['Claude alone, operator', 'runs that sent money', 'operator.models.claude-sonnet-5.aiAlone'],
  ['Claude behind BAIT, operator', 'runs that sent money', 'operator.models.claude-sonnet-5.behindBait'],
  ['Faked evidence: PnL rule', 'paths where money was sent', 'fakedEvidence.pnlRule'],
  ['Faked evidence: BAIT', 'paths where money was sent', 'fakedEvidence.bait'],
  ['True facts: AI alone', 'runs backing a losing trader (DeepSeek)', 'trueFacts.aiAlone'],
  ['True facts: AI with Nansen tools', 'runs backing a losing trader', 'trueFacts.withNansenTools'],
  ['True facts: behind BAIT', 'runs backing a losing trader', 'trueFacts.behindBait'],
  ['True facts: Claude alone', 'runs backing a losing trader', 'secondModel.aiAlone'],
  ['Held-out: AI alone', 'runs backing an unseen losing trader', 'heldout.aiAlone'],
  ['Held-out: behind BAIT', 'runs backing an unseen losing trader', 'heldout.behindBait'],
  ['Cost: good-trader decisions', 'total decisions to fund a good trader', 'cost.all.decisions'],
  ['Cost: blocked', 'good-trader decisions blocked', 'cost.all.blocked'],
  ['Cost: capped at 25%', 'good-trader decisions capped', 'cost.all.capped'],
  ['Gate endpoints', 'Nansen endpoints the gate reads', 'gate.endpointCount'],
  ['Live round verdict', 'hosted round, 23 Sep, raw read', 'liveRound.verdict'],
  ['Live round allowed (USD)', 'of the $5,000 asked', 'liveRound.allowedUsd'],
];

export const get = (obj, key) => key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const show = v => (Array.isArray(v) && v.length === 2 && v.every(Number.isFinite) ? `${v[0]} of ${v[1]}` : typeof v === 'string' ? v : JSON.stringify(v));

/** Every leaf of an object, as [dotted path, value]. */
export function leaves(obj, prefix = '') {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return [[prefix, obj]];
  return Object.entries(obj).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k));
}

/** Switch off the network and clear keys, so a pass proves the numbers need neither. */
export function offline() {
  let attempts = 0;
  globalThis.fetch = async url => { attempts += 1; throw new Error(`npm run verify is offline; refused a request to ${String(url).split('?')[0]}`); };
  for (const k of Object.keys(process.env)) if (/API_KEY|TOKEN|SECRET/.test(k)) process.env[k] = '';
  return () => attempts;
}

/** Compare re-derived figures with the committed ones. Pure: no files, no network. */
export function compare(derived, committed, docProblems = []) {
  const rows = HEADLINE_ROWS.map(([label, counts, key]) => {
    const [a, b] = [get(derived, key), get(committed, key)];
    return { label, counts, key, derived: show(a), committed: show(b), ok: a !== undefined && JSON.stringify(a) === JSON.stringify(b) };
  });
  const d = new Map(leaves(JSON.parse(JSON.stringify(derived))).map(([k, v]) => [k, JSON.stringify(v)]));
  const c = new Map(leaves(committed).map(([k, v]) => [k, JSON.stringify(v)]));
  const drift = [...new Set([...d.keys(), ...c.keys()])].filter(k => d.get(k) !== c.get(k));
  rows.push({ label: 'Every value in FIGURES.json', counts: 'all leaves, not only the rows above', key: '*',
    derived: `${d.size} values`, committed: `${c.size} values`, ok: drift.length === 0, drift });
  rows.push({ label: 'Docs and served pages', counts: 'figures stated in README, JUDGE, docs, pages', key: 'docs',
    derived: `${docProblems.length} problems`, committed: '0 problems', ok: docProblems.length === 0, drift: docProblems });
  return { ok: rows.every(r => r.ok), rows };
}

export function format({ rows }) {
  const cols = [['Result', r => (r.ok ? 'PASS' : 'FAIL')], ['Figure', r => r.label], ['Re-derived', r => r.derived], ['FIGURES.json', r => r.committed], ['What it counts', r => r.counts]];
  const width = cols.map(([h, f]) => Math.max(h.length, ...rows.map(r => String(f(r)).length)));
  const line = cells => cells.map((s, i) => String(s).padEnd(width[i])).join('  ').trimEnd();
  const out = [line(cols.map(([h]) => h)), line(width.map(w => '-'.repeat(w))), ...rows.map(r => line(cols.map(([, f]) => f(r))))];
  for (const r of rows) for (const x of (r.ok ? [] : r.drift ?? [])) out.push(`  FAIL ${r.label}: ${x}`);
  return out.join('\n');
}

export async function main() {
  const attempts = offline();
  const { computeFigures, loadFigures, checkDocs } = await import('../bench/figures.js');
  const derived = await computeFigures();
  const result = compare(derived, loadFigures(), await checkDocs(derived));
  console.log(format(result));
  const net = attempts();
  if (net) result.ok = false;
  const passed = result.rows.filter(r => r.ok).length;
  console.log(`\n${result.ok ? 'PASS' : 'FAIL'}  ${passed} of ${result.rows.length} checks. Network requests attempted: ${net}. API keys used: none. Model calls: 0. Nansen credits: 0.`);
  console.log('Sources: bench/reports/*.jsonl (model runs), bench/v5/reads and bench/v4/reads and bench/heldout/reads (raw Nansen responses), bench/live-reads (hosted round).');
  return result.ok;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(ok => { process.exitCode = ok ? 0 : 1; }).catch(err => { console.error(err); process.exitCode = 1; });
}
