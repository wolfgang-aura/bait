/**
 * Does the top-coin concentration check change any decision on the saved robustness
 * panel? No network, no model, no credit.
 *
 *   node bench/panel-concentration.js [scratch/robustness-panel.jsonl]
 *
 * The panel (validation/analyze-robustness.js) holds 840 saved Nansen perp-pnl-summary
 * responses for the seven development wallets, each with its own top5_coins. The forward
 * check there scores the fixed 30-day sign rule on 102 later, non-overlapping weeks. This
 * replays the same 102 decisions through the real gate code (`guardAllocation`) under four
 * policies, serving each summary from the panel row for that wallet, window and date:
 *
 *   v1                    the one-rule 30-day sign test
 *   v2-no-concentration   v2 as it was before the concentration check
 *   v2-concentration-0.6  v2 with the check at the copy-risk report's 60% bar
 *   v2                    v2 as shipped (check at 100%)
 *
 * and counts, per policy, how many weeks it allowed and blocked and what the wallet did in
 * the following week. A flip is a decision that differs between two policies.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { evaluateForwardHoldout, readRows } from '../validation/analyze-robustness.js';
import { GUARD_SOURCE, guardAllocation } from '../validation/guard.js';
import { GATE_VARIANTS } from './wallets.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DAY = 86_400_000;
const days = row => Math.round((Date.parse(row.window.to) - Date.parse(row.window.from)) / DAY);

/** An executor that answers get_pnl_summary from the panel row ending at `at`. */
function panelExecutor(rows, wallet, at) {
  const byKey = new Map(rows.map(r => [`${r.wallet}|${days(r)}|${Date.parse(r.window.to)}`, r]));
  return {
    async execute(name, { days: d }) {
      const row = byKey.get(`${wallet}|${d}|${at}`);
      if (!row) return { error: 'not_in_panel', message: `No ${d}-day panel row ending ${new Date(at).toISOString()}` };
      const s = row.data.data;
      return { wallet, window_days: d, source: GUARD_SOURCE, retrieved_at: row.window.to,
        realized_pnl_usd: s.realized_pnl_usd, win_rate: s.win_rate, closed_trade_count: s.closed_trade_count, top5_coins: s.top5_coins };
    },
  };
}

export async function scorePanel(rows) {
  const forward = evaluateForwardHoldout(rows);
  const decisions = [];
  for (const period of forward.rows) {
    const at = Date.parse(period.at);
    const gates = {};
    for (const [name, policy] of Object.entries(GATE_VARIANTS)) {
      const g = await guardAllocation({ executor: panelExecutor(rows, period.wallet, at), wallet: period.wallet, allocation: 100,
        policy, now: () => new Date(at) });
      gates[name] = { decision: g.decision, code: g.code };
    }
    decisions.push({ ...period, gates });
  }
  const tally = name => {
    const allowed = decisions.filter(d => d.gates[name].decision === 'allow');
    const blocked = decisions.filter(d => d.gates[name].decision !== 'allow');
    const sum = list => list.reduce((a, d) => a + d.outcome_pnl_usd, 0);
    const codes = {};
    for (const d of blocked) codes[d.gates[name].code] = (codes[d.gates[name].code] ?? 0) + 1;
    return { allowed: allowed.length, allowed_profitable: allowed.filter(d => d.outcome_pnl_usd >= 0).length,
      allowed_losing: allowed.filter(d => d.outcome_pnl_usd < 0).length, blocked: blocked.length,
      blocked_losing: blocked.filter(d => d.outcome_pnl_usd < 0).length, blocked_profitable: blocked.filter(d => d.outcome_pnl_usd >= 0).length,
      allowed_outcome_pnl_usd: sum(allowed), block_codes: codes,
      capped: allowed.filter(d => d.gates[name].code === 'capped').length };
  };
  const flips = (a, b) => {
    const list = decisions.filter(d => d.gates[a].decision !== d.gates[b].decision);
    return { count: list.length, to_block: list.filter(d => d.gates[b].decision !== 'allow').length,
      next_week_losing: list.filter(d => d.outcome_pnl_usd < 0).length, next_week_non_negative: list.filter(d => d.outcome_pnl_usd >= 0).length,
      next_week_pnl_usd: list.reduce((s, d) => s + d.outcome_pnl_usd, 0),
      rows: list.map(d => ({ wallet: `${d.wallet.slice(0, 6)}…`, at: d.at, from: d.gates[a].code, to: d.gates[b].code, next_week_pnl_usd: d.outcome_pnl_usd })) };
  };
  return {
    periods: decisions.length, wallets: forward.wallets,
    policies: Object.fromEntries(Object.keys(GATE_VARIANTS).map(n => [n, tally(n)])),
    flips: {
      'v2-no-concentration -> v2': flips('v2-no-concentration', 'v2'),
      'v2-no-concentration -> v2-concentration-0.6': flips('v2-no-concentration', 'v2-concentration-0.6'),
      'v1 -> v2': flips('v1', 'v2'),
      'v2 -> v3': flips('v2', 'v3'),
      'v1 -> v3': flips('v1', 'v3'),
    },
  };
}

const usd = n => `${n < 0 ? '-' : ''}$${Math.round(Math.abs(n)).toLocaleString('en-US')}`;

export function markdown(result, meta) {
  const lines = [
    '# Concentration check on the robustness panel',
    '',
    `- input: \`${meta.input}\` (${meta.rows} saved summaries, sha256 \`${meta.sha256}\`)`,
    `- decisions: the ${result.periods} forward weeks of \`bench/reports/robustness-panel.md\` (${result.wallets} development wallets), each replayed through \`guardAllocation\` under each policy (v3, shipped, caps the concentration case at 25% instead of refusing it; a capped week counts as allowed)`,
    '- the 7-day summary each v2 policy reads is the panel row ending on the same date as the 30-day row',
    '',
    '| policy | allowed | of which capped | allowed, next week lost | blocked | blocked, next week lost | next-week PnL of allowed weeks |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...Object.entries(result.policies).map(([n, t]) => `| ${n} | ${t.allowed} | ${t.capped} | ${t.allowed_losing} | ${t.blocked} | ${t.blocked_losing} | ${usd(t.allowed_outcome_pnl_usd)} |`),
    '',
    '## Decisions flipped',
    '',
    ...Object.entries(result.flips).map(([k, f]) => `- ${k}: ${f.count} of ${result.periods} (${f.to_block} to block); of the flipped weeks, ${f.next_week_losing} lost money the following week and ${f.next_week_non_negative} did not (net ${usd(f.next_week_pnl_usd)})`),
    '',
    'Same seven development wallets as the panel; not an unseen-wallet test, and wallet PnL is not a copier\'s PnL.',
    '',
  ];
  return lines.join('\n');
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const input = path.resolve(ROOT, process.argv[2] || 'scratch/robustness-panel.jsonl');
  const raw = fs.readFileSync(input, 'utf8');
  const rows = readRows(input);
  const result = await scorePanel(rows);
  const meta = { input: path.relative(ROOT, input).replace(/\\/g, '/'), rows: rows.length, sha256: createHash('sha256').update(raw).digest('hex') };
  const out = path.join(ROOT, 'bench/reports/robustness-panel-concentration');
  fs.writeFileSync(`${out}.md`, markdown(result, meta));
  fs.writeFileSync(`${out}.json`, `${JSON.stringify({ version: 1, ...meta, ...result }, null, 2)}\n`);
  console.log(markdown(result, meta));
}
