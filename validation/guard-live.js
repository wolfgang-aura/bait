/**
 * The live evidence path for BAIT's execution guard.
 *
 * `validation/guard.js` is the product. Until now it only ever read frozen evidence
 * from `bench/run.js` and the tests, so nobody could point it at a wallet and watch it
 * decide. This module gives it a real adapter: one Nansen
 * `profiler/perp-pnl-summary` call per check, mapped into the exact evidence shape
 * `validation/tools.js` serves from a snapshot, so the number the guard judges live is
 * the same field the benchmark judged frozen.
 *
 * Cost: 1 credit per check. Nothing else is fetched. The credit guard in
 * `validation/nansen.js` stays in the path, so a live check can never overspend the key.
 *
 * Fail closed is the rule. A provider error, a missing number, a wrong wallet, a wrong
 * window or a stale timestamp all reach `guardAllocation` as unusable evidence and it
 * forces the allocation to $0. No number is ever invented to fill a gap.
 */

import {
  GUARD_SOURCE,
  GUARD_WINDOW_DAYS,
  DEFAULT_GUARD_TIMEOUT_MS,
  PRODUCTION_GUARD_POLICY,
  guardAllocation,
} from './guard.js';
import {
  call as nansenCall,
  accountCreditsRemaining,
  creditCostFor,
} from './nansen.js';

/** The only endpoint a live guard check is permitted to touch. */
export const GUARD_ENDPOINT = 'profiler/perp-pnl-summary';

/** Same second-precision ISO the snapshot writer and live.js use for windows. */
const iso = date => date.toISOString().replace(/\.\d{3}Z$/, 'Z');
/** tools.js rounds realised PnL to cents before the guard sees it. Match it exactly. */
const round2 = n => Math.round(n * 100) / 100;
const finite = value => typeof value === 'number' && Number.isFinite(value);

/**
 * Build the evidence adapter `guardAllocation` calls.
 *
 * @param {{ call?: Function, now?: () => Date, timeoutMs?: number }} options
 * @returns {{ execute(name: string, args: object): Promise<object>, calls: object[], creditsCharged(): number }}
 */
export function createLiveGuardExecutor({
  call = nansenCall,
  now = () => new Date(),
  timeoutMs = DEFAULT_GUARD_TIMEOUT_MS,
} = {}) {
  const calls = [];
  let charged = 0;

  async function execute(name, args = {}) {
    if (name !== 'get_pnl_summary') {
      throw new Error(`Live guard executor serves get_pnl_summary only, not "${name}".`);
    }

    const wallet = String(args.wallet ?? '').toLowerCase();
    const days = Number.isInteger(args.days) ? args.days : GUARD_WINDOW_DAYS;
    const at = now();
    const date = { from: iso(new Date(at.getTime() - days * 86_400_000)), to: iso(at) };
    const body = { address: wallet, date };

    calls.push({ path: GUARD_ENDPOINT, body, at: at.toISOString() });

    // One call. Any throw here reaches guardAllocation, which blocks with a diagnostic.
    const response = await call(GUARD_ENDPOINT, body, {
      note: `guard live ${days}d summary`,
      timeoutMs,
    });
    // The ledger only charges a request that reached Nansen. A budget stop or a
    // network failure throws above this line and costs nothing.
    charged += creditCostFor(GUARD_ENDPOINT);

    const summary = response?.data?.data ?? null;
    if (!summary || !finite(summary.realized_pnl_usd)) {
      return {
        error: 'evidence_unavailable',
        message: `Nansen returned no realised PnL for ${wallet} over ${days} days.`,
      };
    }

    return {
      wallet,
      window_days: days,
      realized_pnl_usd: round2(summary.realized_pnl_usd),
      retrieved_at: at.toISOString(),
      source: GUARD_SOURCE,
    };
  }

  return {
    execute,
    calls,
    creditsCharged: () => charged,
  };
}

/**
 * Run the production guard against live Nansen evidence.
 *
 * Freshness stays on: the production policy requires evidence no older than 15
 * minutes, which a live fetch satisfies by construction and a broken clock does not.
 *
 * @param {{
 *   wallet: string,
 *   allocation: number,
 *   policy?: object,
 *   call?: Function,
 *   now?: () => Date,
 *   timeoutMs?: number,
 * }} input
 * @returns {Promise<object>} the guard decision plus creditsCharged / creditsRemaining
 */
export async function runLiveGuard({
  wallet,
  allocation,
  policy = PRODUCTION_GUARD_POLICY,
  call = nansenCall,
  now = () => new Date(),
  timeoutMs = DEFAULT_GUARD_TIMEOUT_MS,
} = {}) {
  const executor = createLiveGuardExecutor({ call, now, timeoutMs });
  const decision = await guardAllocation({ executor, wallet, allocation, policy, timeoutMs, now });

  let creditsCharged = null;
  try {
    creditsCharged = executor.creditsCharged();
  } catch {
    creditsCharged = null;
  }
  let creditsRemaining = null;
  try {
    creditsRemaining = accountCreditsRemaining()?.credits_remaining ?? null;
  } catch {
    creditsRemaining = null;
  }

  return { ...decision, creditsCharged, creditsRemaining };
}

export default runLiveGuard;
