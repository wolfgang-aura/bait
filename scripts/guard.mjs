/**
 * Run BAIT's execution guard against live Nansen data from the command line.
 *
 *   npm run guard -- --wallet 0xc26cbb6483229e0d0f9a1cab675271eda535b8f4 --allocation 5000
 *   npm run guard -- --wallet 0x9546b9d4103be41ce13483a8f299d0df0eeb181c --allocation 5000 --json
 *
 * The default policy is `wallet-copy-risk-v2`: it reads the 7-day AND the 30-day
 * `profiler/perp-pnl-summary` and costs two credits, one per window, and it buys the
 * second window only after the first one passes. `--policy v1` is the older one-window
 * rule the recorded benchmark row is tied to, at one credit.
 *
 * The guard, not this script, decides. Exit codes: 0 allow, 2 block or bad usage, 3 no
 * API key, 1 unexpected crash. Nothing but $0 is ever reported on an error.
 */

import { loadEnv, call as nansenCall, refreshAccountBalance } from '../validation/nansen.js';
import { runLiveGuard } from '../validation/guard-live.js';
import {
  DEFAULT_GUARD_TIMEOUT_MS,
  GUARD_WINDOW_DAYS,
  PRODUCTION_GUARD_POLICY_V1,
  PRODUCTION_GUARD_POLICY_V2,
  PRODUCTION_GUARD_POLICY_V3,
} from '../validation/guard.js';

export const USAGE =
  'Usage: npm run guard -- --wallet 0x<40 hex> --allocation <usd> [--policy v1|v2] [--json] [--timeout <ms>]';

/** v2 is the default gate. v1 stays selectable so a recorded result can be rerun. */
export const POLICIES = { v1: PRODUCTION_GUARD_POLICY_V1, v2: PRODUCTION_GUARD_POLICY_V2, v3: PRODUCTION_GUARD_POLICY_V3 };

const FLAGS_WITH_VALUES = new Set(['--wallet', '--allocation', '--timeout', '--policy']);

/**
 * Parse argv. Unknown flags, missing values and non-numeric amounts are usage errors,
 * never silent defaults: a guard that guesses its own input is not a guard.
 */
export function parseArgs(argv = []) {
  const out = { wallet: null, allocation: null, json: false, timeoutMs: DEFAULT_GUARD_TIMEOUT_MS, policy: 'v3' };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--json') {
      out.json = true;
      continue;
    }
    if (!FLAGS_WITH_VALUES.has(flag)) return { error: `Unknown argument "${flag}".` };
    const value = argv[++i];
    if (value === undefined) return { error: `${flag} needs a value.` };
    if (flag === '--wallet') out.wallet = value;
    if (flag === '--allocation') {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0) return { error: `--allocation must be a non-negative number, got "${value}".` };
      out.allocation = n;
    }
    if (flag === '--timeout') {
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0) return { error: `--timeout must be a positive number of milliseconds, got "${value}".` };
      out.timeoutMs = n;
    }
    if (flag === '--policy') {
      if (!(value in POLICIES)) return { error: `--policy must be v1, v2 or v3, got "${value}".` };
      out.policy = value;
    }
  }
  if (!out.wallet) return { error: '--wallet is required.' };
  if (out.allocation === null) return { error: '--allocation is required.' };
  return out;
}

const usd = n =>
  typeof n === 'number' && Number.isFinite(n)
    ? `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : 'unavailable';

const MARK = { pass: 'PASS', fail: 'FAIL', not_assessed: '  - ' };

/** The compact operator view. One decision, then the facts it rests on. */
function report(decision, write) {
  const row = (label, value) => write(`  ${label.padEnd(11)}${value}\n`);
  write('\n');
  write(`DECISION   ${decision.decision.toUpperCase()}\n`);
  row('code', decision.code);
  row('reason', decision.reason);
  row('wallet', decision.evidence.wallet ?? 'unverified');
  row('attempted', usd(decision.attempted));
  row('enforced', usd(decision.allocation));
  row(`pnl ${GUARD_WINDOW_DAYS}d`, usd(decision.evidence.realized_pnl_usd));
  if (decision.policy.short_window_days) {
    row(`pnl ${decision.policy.short_window_days}d`, usd(decision.evidence.realized_pnl_7d_usd));
  }
  row('retrieved', decision.evidence.retrieved_at ?? 'no evidence');
  row('source', decision.evidence.source ?? 'none');
  row('policy', decision.policy.id);
  row('credits', `${decision.creditsCharged ?? 'unknown'} charged, ${decision.creditsRemaining ?? 'unknown'} remaining`);
  if (decision.diagnostic) row('diagnostic', String(decision.diagnostic).slice(0, 200));
  // The table is the answer to "so this is just a PnL check": every check the policy
  // ran, what it read, what it wanted, and the ones it honestly could not assess.
  if (decision.checks?.length) {
    write('\nCHECKS\n');
    for (const check of decision.checks) {
      write(`  ${MARK[check.result] ?? '  ? '} ${check.id.padEnd(19)}${check.plain}\n`);
    }
  }
  write('\n');
}

/**
 * @returns {Promise<number>} the process exit code
 */
export async function main({
  argv = process.argv.slice(2),
  call = nansenCall,
  now = () => new Date(),
  write = text => process.stdout.write(text),
  env = { ...loadEnv(), ...process.env },
  checkBalance = null,
} = {}) {
  const args = parseArgs(argv);
  if (args.error) {
    write(`${args.error}\n${USAGE}\n`);
    return 2;
  }

  if (!env.NANSEN_API_KEY) {
    write('No NANSEN_API_KEY found. Add NANSEN_API_KEY=<your key> to .env in the repository root.\n');
    return 3;
  }

  const policy = POLICIES[args.policy];
  const windows = policy.shortWindowDays ? [policy.shortWindowDays, policy.windowDays] : [policy.windowDays];
  write(`BAIT guard, live Nansen evidence. Policy: ${policy.id}.\n`);
  write(`Wallet ${args.wallet}, proposed allocation ${usd(args.allocation)}.\n`);

  // The free `account` endpoint costs nothing and proves the key works before a
  // billable call is made. It also seeds the balance the credit line reports.
  // A failure here is not fatal: the guard still runs and still fails closed.
  const balance = checkBalance ?? (call === nansenCall ? refreshAccountBalance : null);
  if (balance) {
    try {
      const account = await balance({ note: 'guard CLI key check' });
      write(`Key accepted. Nansen plan ${account?.plan ?? 'unknown'}, ${account?.credits_remaining ?? 'unknown'} credits remaining.\n`);
    } catch (err) {
      write(`Could not read the Nansen account balance: ${err?.message ?? err}\n`);
    }
  }

  write(`Fetching Nansen ${windows.join('- and ')}-day PnL summary, at most ${windows.length} credit${windows.length === 1 ? '' : 's'}...\n`);

  let decision;
  try {
    decision = await runLiveGuard({
      wallet: args.wallet,
      allocation: args.allocation,
      policy,
      call,
      now,
      timeoutMs: args.timeoutMs,
    });
  } catch (err) {
    write(`Unexpected failure, nothing was authorized: ${err?.message ?? err}\n`);
    return 1;
  }

  if (args.json) write(`${JSON.stringify(decision, null, 2)}\n`);
  else report(decision, write);

  return decision.decision === 'allow' ? 0 : 2;
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith('guard.mjs');
if (invokedDirectly) {
  // process.exitCode, not process.exit: forcing the exit while undici is still closing
  // its keep-alive socket trips a libuv assertion on Windows and replaces the real exit
  // code with a crash code. The command still cannot hang, because every Nansen request
  // carries the guard's own deadline as an AbortSignal, so the loop always drains.
  main()
    .then(code => { process.exitCode = code; })
    .catch(err => {
      process.stderr.write(`Unexpected failure, nothing was authorized: ${err?.message ?? err}\n`);
      process.exitCode = 1;
    });
}
