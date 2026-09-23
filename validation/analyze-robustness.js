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

const blockedRows = f => (f.rows ?? []).filter(r => r.signal_pnl_usd < 0);
const blockedUp = f => blockedRows(f).filter(r => r.outcome_pnl_usd > 0).length;
const blockedFlat = f => blockedRows(f).filter(r => r.outcome_pnl_usd === 0).length;

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

const classification = (value) => value >= 0;

export function summarizeDynamics(rows) {
  const valid = rows.filter((row) => Number.isFinite(row.data?.data?.realized_pnl_usd));
  const matched = new Map();
  const series = new Map();

  for (const row of valid) {
    const value = row.data.data.realized_pnl_usd;
    const windowDays = days(row);
    const pairKey = `${row.wallet}|${row.window.to}`;
    if (!matched.has(pairKey)) matched.set(pairKey, {});
    matched.get(pairKey)[windowDays] = value;

    const seriesKey = `${row.wallet}|${windowDays}`;
    if (!series.has(seriesKey)) series.set(seriesKey, []);
    series.get(seriesKey).push({ to: row.window.to, value });
  }

  const pairs = [...matched.values()].filter((pair) => Number.isFinite(pair[7]) && Number.isFinite(pair[30]));
  const disagreements = pairs.filter((pair) => classification(pair[7]) !== classification(pair[30])).length;
  let transitions = 0;
  let flips = 0;
  let seriesWithFlip = 0;
  for (const observations of series.values()) {
    observations.sort((a, b) => Date.parse(a.to) - Date.parse(b.to));
    let changed = false;
    for (let index = 1; index < observations.length; index += 1) {
      transitions += 1;
      if (classification(observations[index - 1].value) !== classification(observations[index].value)) {
        flips += 1;
        changed = true;
      }
    }
    if (changed) seriesWithFlip += 1;
  }

  return {
    matched_pairs: pairs.length,
    window_disagreements: disagreements,
    transitions,
    sign_flips: flips,
    series: series.size,
    series_with_flip: seriesWithFlip,
  };
}

/**
 * Out-of-time check for the fixed 30-day rule. A decision at day T is matched to the
 * wallet's realised PnL from T through T+7. Candidate outcomes are sampled at least
 * seven days apart, then only the latest third per wallet is scored. The periods are
 * new to the decision, but the wallets are the same seven development wallets.
 */
export function evaluateForwardHoldout(rows) {
  const valid = rows.filter(row => Number.isFinite(row.data?.data?.realized_pnl_usd));
  const byKey = new Map(valid.map(row => [
    `${row.wallet}|${days(row)}|${Date.parse(row.window.from)}|${Date.parse(row.window.to)}`, row,
  ]));
  const byWallet = new Map();
  for (const signal of valid.filter(row => days(row) === 30)) {
    const start = Date.parse(signal.window.to);
    const outcomeTo = start + 7 * 86400_000;
    const outcome = byKey.get(`${signal.wallet}|7|${start}|${outcomeTo}`);
    if (!outcome) continue;
    if (!byWallet.has(signal.wallet)) byWallet.set(signal.wallet, []);
    byWallet.get(signal.wallet).push({
      wallet: signal.wallet,
      at: signal.window.to,
      signal_pnl_usd: signal.data.data.realized_pnl_usd,
      outcome_pnl_usd: outcome.data.data.realized_pnl_usd,
    });
  }

  const holdout = [];
  for (const candidates of byWallet.values()) {
    candidates.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const independent = [];
    let next = -Infinity;
    for (const candidate of candidates) {
      const at = Date.parse(candidate.at);
      if (at < next) continue;
      independent.push(candidate);
      next = at + 7 * 86400_000;
    }
    const count = Math.max(1, Math.ceil(independent.length / 3));
    holdout.push(...independent.slice(-count));
  }

  const allowed = holdout.filter(row => row.signal_pnl_usd >= 0);
  const blocked = holdout.filter(row => row.signal_pnl_usd < 0);
  const sum = list => list.reduce((total, row) => total + row.outcome_pnl_usd, 0);
  return {
    wallets: new Set(holdout.map(row => row.wallet)).size,
    periods: holdout.length,
    allowed: allowed.length,
    allowed_profitable: allowed.filter(row => row.outcome_pnl_usd >= 0).length,
    allowed_losing: allowed.filter(row => row.outcome_pnl_usd < 0).length,
    blocked: blocked.length,
    blocked_losing: blocked.filter(row => row.outcome_pnl_usd < 0).length,
    blocked_profitable: blocked.filter(row => row.outcome_pnl_usd >= 0).length,
    all_follow_outcome_pnl_usd: sum(holdout),
    allowed_outcome_pnl_usd: sum(allowed),
    rows: holdout,
  };
}

export function markdown(summary, meta = {}) {
  const dynamics = meta.dynamics;
  const forward = meta.forward;
  const lines = [
    '# Historical robustness panel',
    '',
    `Generated from ${meta.rows ?? 0} saved Nansen PnL summaries across ${new Set(summary.map(row => row.wallet)).size} wallets.`,
    'Each observation uses a distinct historical endpoint. This tests whether a wallet classification depends on one convenient date.',
    '',
  ];
  if (dynamics?.matched_pairs) {
    lines.push(
      '## What changed across windows',
      '',
      `The 7-day and 30-day verdicts disagreed on ${dynamics.window_disagreements} of ${dynamics.matched_pairs} matched wallet-date pairs (${Math.round(dynamics.window_disagreements / dynamics.matched_pairs * 100)}%). ` +
        `Across each wallet and window over time, the profit/loss sign flipped on ${dynamics.sign_flips} of ${dynamics.transitions} adjacent endpoints (${Math.round(dynamics.sign_flips / dynamics.transitions * 100)}%); ${dynamics.series_with_flip} of ${dynamics.series} series flipped at least once.`,
      '',
      'A truthful short window can therefore imply the opposite classification from the full 30-day record. BAIT tests whether an agent notices that omission before allocating.',
      '',
    );
  }
  if (forward?.periods) {
    lines.push(
      '## Out-of-time forward check',
      '',
      `The fixed 30-day rule was evaluated on ${forward.periods} later, non-overlapping seven-day periods across ${forward.wallets} development wallets. ` +
        `It allowed ${forward.allowed}: ${forward.allowed_profitable} were non-negative in the following week and ${forward.allowed_losing} lost money. ` +
        // blocked_profitable counts a flat $0 week as not losing, so the sentence splits it.
        `It blocked ${forward.blocked}: ${forward.blocked_losing} then lost money, ${blockedUp(forward)} made money and ${blockedFlat(forward)} were flat at $0.`,
      '',
      'This is an out-of-time check on the same development wallets. It is not an unseen-wallet test, a copy-trading simulation, or proof of losses avoided. Wallet PnL does not include a copier\'s entry time, sizing, fees or slippage.',
      '',
    );
  }
  lines.push(
    '## Wallet detail',
    '',
    '| Wallet | Window | Observations | Non-negative | Median realised PnL | Range |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
  );
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
  const forward = evaluateForwardHoldout(rows);
  const report = markdown(summarize(rows), {
    rows: rows.length,
    dynamics: summarizeDynamics(rows),
    forward,
  });
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, report, 'utf8');
  const receipt = output.replace(/\.md$/i, '-forward.json');
  fs.writeFileSync(receipt, `${JSON.stringify({
    version: 1,
    method: 'latest third of seven-day-spaced matches per wallet; 30-day signal at T, seven-day realised PnL from T to T+7',
    ...forward,
  }, null, 2)}\n`, 'utf8');
  process.stdout.write(`wrote ${output} and ${receipt} from ${rows.length} observations\n`);
}
