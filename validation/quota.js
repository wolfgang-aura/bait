/**
 * Nansen quota runner.
 *
 * The buildathon requires 1,000+ API calls logged on our key between 14 and 27
 * September. This script builds a historical robustness panel for every wallet in the
 * experiment. Each call measures a distinct 7-day or 30-day window. Responses can be
 * saved as JSONL for later analysis. Eligibility follows Nansen's Usage Analytics;
 * the local ledger also contains free account checks that do not increase that total.
 *
 *   node validation/quota.js --max-calls 10
 *   node validation/quota.js --max-calls 200 --daily-cap 300
 *   npm run quota -- --max-calls 50
 *
 * Flags:
 *   --max-calls N    stop after N successful-or-failed API calls this run (default 25)
 *   --daily-cap N    stop if the ledger already holds N calls since UTC midnight
 *   --wallet 0x..    restrict to one wallet (repeatable)
 *   --timeout MS     per-call timeout, default 45000
 *   --output PATH    append successful observations as JSONL
 *   --dry-run        plan and print the steps, make no calls
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  call as realCall,
  creditsUsed,
  CREDIT_BUDGET,
  QUOTA_WINDOW_START,
  ledgerStats,
  refreshAccountBalance,
  accountCreditsRemaining,
  BudgetExceeded,
} from './nansen.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_DIR = path.join(HERE, 'snapshots');
export const ENCOUNTER_WALLET = '0xc26cbb6483229e0d0f9a1cab675271eda535b8f4';
export const ELIGIBILITY_TARGET = 1000;
export const DASHBOARD_BASELINE = Object.freeze({
  verifiedAt: '2026-09-20T11:12:53Z',
  totalUsage: 1033,
  ledgerCreditsUsedSince: 1028,
});

export const DEFAULTS = { maxCalls: 25, dailyCap: 400, timeoutMs: 45_000, dryRun: false, wallets: [], output: null };

/** Project the dashboard's Total Usage from its last visual check and local charged credits. */
export function estimatedDashboardUsage(stats) {
  const charged = Number(stats?.credits_used_since);
  if (!Number.isFinite(charged)) return null;
  return DASHBOARD_BASELINE.totalUsage + charged - DASHBOARD_BASELINE.ledgerCreditsUsedSince;
}

/** Parse argv. Unknown flags and bad numbers are errors, not silent defaults. */
export function parseArgs(argv = []) {
  const opts = { ...DEFAULTS, wallets: [] };
  const number = (flag, raw) => {
    const n = Number(raw);
    if (!Number.isInteger(n) || n <= 0) throw new Error(`${flag} needs a positive integer, got ${JSON.stringify(raw)}`);
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--max-calls': opts.maxCalls = number(arg, argv[++i]); break;
      case '--daily-cap': opts.dailyCap = number(arg, argv[++i]); break;
      case '--timeout': opts.timeoutMs = number(arg, argv[++i]); break;
      case '--output': {
        const value = String(argv[++i] ?? '').trim();
        if (!value) throw new Error('--output needs a path');
        opts.output = path.resolve(value);
        break;
      }
      case '--dry-run': opts.dryRun = true; break;
      case '--wallet': {
        const w = String(argv[++i] ?? '').toLowerCase();
        if (!/^0x[a-f0-9]{40}$/.test(w)) throw new Error(`--wallet needs a 0x address, got ${JSON.stringify(argv[i])}`);
        opts.wallets.push(w);
        break;
      }
      default:
        throw new Error(`Unknown argument ${JSON.stringify(arg)}. See the header of validation/quota.js.`);
    }
  }
  return opts;
}

/** Wallets with evidence on disk, encounter wallet first. Control wallets included. */
export function walletsOnDisk(dir = SNAPSHOT_DIR) {
  let files = [];
  try { files = fs.readdirSync(dir); } catch { return [ENCOUNTER_WALLET]; }
  const found = files
    .filter((f) => f.endsWith('.json') && !f.startsWith('_'))
    .map((f) => path.basename(f, '.json').replace(/^control_/, '').toLowerCase())
    .filter((w) => /^0x[a-f0-9]{40}$/.test(w));
  const unique = [...new Set([ENCOUNTER_WALLET, ...found])];
  return unique;
}

const iso = (d) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

/**
 * Build distinct rolling-window observations. Each round moves seven days back, which
 * turns quota work into a regime-stability dataset instead of repeated current reads.
 */
export function planSteps(wallets, { now = new Date(), rounds = 40 } = {}) {
  const steps = [];
  const anchor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  for (let round = 0; round < rounds; round++) {
    const at = new Date(anchor.getTime() - round * 7 * 86400_000);
    const W30 = { from: iso(new Date(at.getTime() - 30 * 86400_000)), to: iso(at) };
    const W7 = { from: iso(new Date(at.getTime() - 7 * 86400_000)), to: iso(at) };
    for (const wallet of wallets) {
      steps.push({ label: `${wallet.slice(0, 8)}… 30d summary`, path: 'profiler/perp-pnl-summary', body: { address: wallet, date: W30 } });
      steps.push({ label: `${wallet.slice(0, 8)}… 7d summary`, path: 'profiler/perp-pnl-summary', body: { address: wallet, date: W7 } });
    }
  }
  return steps;
}

const observationKey = (step) => [step.body.address, step.body.date.from, step.body.date.to].join('|');

export function completedObservationKeys(output) {
  const keys = new Set();
  if (!output || !fs.existsSync(output)) return keys;
  for (const line of fs.readFileSync(output, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      keys.add([row.wallet, row.window?.from, row.window?.to].join('|'));
    } catch {
      // A partial final line after interruption is ignored and retried.
    }
  }
  return keys;
}

export function appendObservation(output, step, response, retrievedAt = new Date().toISOString()) {
  if (!output) return;
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.appendFileSync(output, JSON.stringify({
    schema_version: 1,
    retrieved_at: retrievedAt,
    wallet: step.body.address,
    window: step.body.date,
    endpoint: step.path,
    data: response?.data ?? null,
  }) + '\n', 'utf8');
}

/** Calls already logged since UTC midnight, for the daily cap. */
export function callsToday(now = new Date()) {
  const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return ledgerStats(midnight.toISOString()).calls_since;
}

function write(line) {
  process.stdout.write(`${line}\n`);
  // Keep progress visible when output is piped to a file or another process.
  if (typeof process.stdout.flush === 'function') process.stdout.flush();
}

async function withTimeout(promise, ms, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`step timed out after ${ms}ms: ${label}`)), ms); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run the quota plan.
 * @param {object} opts  parseArgs output plus injectable { caller, accountCheck, stats, balance, now, log }
 */
export async function runQuota(opts = {}) {
  const {
    maxCalls = DEFAULTS.maxCalls,
    dailyCap = DEFAULTS.dailyCap,
    timeoutMs = DEFAULTS.timeoutMs,
    dryRun = false,
    wallets: only = [],
    caller = realCall,
    accountCheck = refreshAccountBalance,
    balance = accountCreditsRemaining,
    stats = ledgerStats,
    now = () => new Date(),
    today = callsToday,
    log = write,
    output = null,
  } = opts;

  const wallets = only.length ? only : walletsOnDisk();
  const completed = completedObservationKeys(output);
  const steps = planSteps(wallets, { now: now(), rounds: 60 })
    .filter((step) => !completed.has(observationKey(step)));
  const started = Date.now();
  const before = stats(QUOTA_WINDOW_START);

  log('=== Nansen quota run ===');
  log(`  wallets        ${wallets.length}`);
  log(`  max calls      ${maxCalls}`);
  log(`  daily cap      ${dailyCap}`);
  log(`  saved rows     ${completed.size}`);
  log(`  ledger before  ${before.calls_since} calls since ${QUOTA_WINDOW_START}, ${before.credits_used_total} credits`);

  let account = null;
  if (!dryRun) {
    try {
      account = await withTimeout(accountCheck({ note: 'quota run guard' }), timeoutMs, 'account');
      log(`  account        plan=${account?.plan} credits_remaining=${account?.credits_remaining}`);
    } catch (err) {
      log(`  account        check failed: ${err.message}`);
    }
  }

  const summary = { attempted: 0, ok: 0, failed: 0, stoppedBy: 'plan exhausted', errors: [] };
  const doneToday = today(now());
  if (doneToday >= dailyCap) {
    summary.stoppedBy = `daily cap (${doneToday} calls already logged today, cap ${dailyCap})`;
    log(`  STOP           ${summary.stoppedBy}`);
  } else {
    for (const step of steps) {
      if (summary.attempted >= maxCalls) { summary.stoppedBy = `--max-calls ${maxCalls}`; break; }
      if (doneToday + summary.attempted >= dailyCap) { summary.stoppedBy = `--daily-cap ${dailyCap}`; break; }
      const n = summary.attempted + 1;
      if (dryRun) { log(`  [${n}/${maxCalls}] DRY-RUN ${step.path} ${step.label}`); summary.attempted = n; continue; }
      const t0 = Date.now();
      try {
        const response = await withTimeout(caller(step.path, step.body, { note: 'historical robustness panel', timeoutMs }), timeoutMs + 5_000, step.label);
        appendObservation(output, step, response);
        summary.ok += 1;
        log(`  [${n}/${maxCalls}] ok   ${step.label} (${Date.now() - t0}ms)`);
      } catch (err) {
        summary.failed += 1;
        summary.errors.push(`${step.label}: ${err.message}`.slice(0, 200));
        log(`  [${n}/${maxCalls}] FAIL ${step.label}: ${String(err.message).slice(0, 150)}`);
        if (err instanceof BudgetExceeded) { summary.stoppedBy = 'credit budget'; summary.attempted = n; break; }
      }
      summary.attempted = n;
    }
  }

  const after = stats(QUOTA_WINDOW_START);
  let remaining = balance();
  if (!dryRun) {
    try {
      const acct = await withTimeout(accountCheck({ note: 'quota run final balance' }), timeoutMs, 'account');
      remaining = { credits_remaining: acct?.credits_remaining ?? null, checked_at: new Date().toISOString() };
    } catch (err) {
      log(`  final balance check failed: ${err.message}`);
    }
  }

  log('--- summary ---');
  log(`  attempted            ${summary.attempted} (${summary.ok} ok, ${summary.failed} failed)`);
  log(`  stopped by           ${summary.stoppedBy}`);
  log(`  elapsed              ${Math.round((Date.now() - started) / 1000)}s`);
  log(`  calls since ${QUOTA_WINDOW_START}   ${after.calls_since} (was ${before.calls_since})`);
  log(`  successful of those  ${after.successful_calls_since}`);
  const dashboardUsage = estimatedDashboardUsage(after);
  log(`  dashboard usage est. ${dashboardUsage ?? 'unknown'} (verified ${DASHBOARD_BASELINE.totalUsage} at ${DASHBOARD_BASELINE.verifiedAt})`);
  log(`  last success         ${after.last_success_at ?? 'none'}`);
  log(`  credits used locally ${creditsUsed()}/${CREDIT_BUDGET}`);
  log(`  credits remaining    ${remaining?.credits_remaining ?? 'unknown'} (Nansen account endpoint)`);
  // Free account checks appear in the local ledger but do not increase Nansen's
  // dashboard Total Usage. Anchor the estimate to the visually verified dashboard
  // value instead of claiming eligibility from raw ledger rows.
  const shortfall = dashboardUsage === null ? null : ELIGIBILITY_TARGET - dashboardUsage;
  if (shortfall > 0 && typeof remaining?.credits_remaining === 'number') {
    log(`  to reach dashboard ${ELIGIBILITY_TARGET}  ${shortfall} more usage; ${remaining.credits_remaining} credits left` +
      (remaining.credits_remaining < shortfall
        ? ` -> SHORT by about ${shortfall - remaining.credits_remaining} at 1 credit per call`
        : ' -> enough at 1 credit per call'));
  }
  if (summary.errors.length) log(`  first error          ${summary.errors[0]}`);

  return { ...summary, before, after, remaining };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`quota: ${err.message}`);
    process.exit(2);
  }
  const result = await runQuota(opts);
  process.exitCode = result.failed && !result.ok ? 1 : 0;
}
