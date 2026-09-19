import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const days = (row) => Math.round((Date.parse(row.window.to) - Date.parse(row.window.from)) / 86400_000);
const money = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

export function summarize(rows) {
  const groups = new Map();
  for (const row of rows) {
    const pnl = row.data?.data?.realized_pnl_usd;
    if (!Number.isFinite(pnl)) continue;
    const key = `${row.wallet}|${days(row)}`;
    if (!groups.has(key)) groups.set(key, { wallet: row.wallet, days: days(row), values: [] });
    groups.get(key).values.push(pnl);
  }
  return [...groups.values()].map((group) => ({
    wallet: group.wallet,
    days: group.days,
    observations: group.values.length,
    non_negative: group.values.filter((value) => value >= 0).length,
    non_negative_rate: group.values.filter((value) => value >= 0).length / group.values.length,
    median_pnl_usd: median(group.values),
    min_pnl_usd: Math.min(...group.values),
    max_pnl_usd: Math.max(...group.values),
  })).sort((a, b) => a.wallet.localeCompare(b.wallet) || a.days - b.days);
}

export function markdown(summary, meta = {}) {
  const lines = [
    '# Historical robustness panel',
    '',
    `Generated from ${meta.rows ?? 0} saved Nansen PnL summaries across ${new Set(summary.map(row => row.wallet)).size} wallets.`,
    'Each observation uses a distinct historical endpoint. This tests whether a wallet classification depends on one convenient date.',
    '',
    '| Wallet | Window | Observations | Non-negative | Median realised PnL | Range |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
  ];
  for (const row of summary) {
    lines.push(`| ${row.wallet.slice(0, 8)}… | ${row.days}d | ${row.observations} | ${row.non_negative}/${row.observations} (${Math.round(row.non_negative_rate * 100)}%) | ${money(row.median_pnl_usd)} | ${money(row.min_pnl_usd)} to ${money(row.max_pnl_usd)} |`);
  }
  lines.push('', 'This panel measures the seven development wallets already used by BAIT. It is not an unseen test set or evidence of future returns.', '');
  return lines.join('\n');
}

export function readRows(file) {
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const input = path.resolve(process.argv[2] || 'scratch/robustness-panel.jsonl');
  const output = path.resolve(process.argv[3] || 'bench/reports/robustness-panel.md');
  const rows = readRows(input);
  const report = markdown(summarize(rows), { rows: rows.length });
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, report, 'utf8');
  process.stdout.write(`wrote ${output} from ${rows.length} observations\n`);
}
