/**
 * The live evidence path for BAIT's execution guard.
 *
 * `validation/guard.js` is the product. Until now it only ever read frozen evidence
 * from `bench/run.js` and the tests, so nobody could point it at a wallet and watch it
 * decide. This module gives it a real adapter: one Nansen
 * `profiler/perp-pnl-summary` call per window, mapped into the exact evidence shape
 * `validation/tools.js` serves from a snapshot, so the number the guard judges live is
 * the same field the benchmark judged frozen.
 *
 * Cost: 1 credit per window read. `wallet-realized-pnl-30d-v1` reads the 30-day
 * summary only, so one credit. `wallet-copy-risk-v2` reads the 7-day summary as well,
 * so two, and it buys the second only after the first passes. Nothing else is fetched.
 * The credit guard in `validation/nansen.js` stays in the path, so a live check can
 * never overspend the key.
 *
 * Fail closed is the rule. A provider error, a missing number, a wrong wallet, a wrong
 * window or a stale timestamp all reach `guardAllocation` as unusable evidence and it
 * forces the allocation to $0. No number is ever invented to fill a gap.
 */

import {
  GUARD_SOURCE,
  GUARD_WINDOW_DAYS,
  DEFAULT_GUARD_TIMEOUT_MS,
  PRODUCTION_GUARD_POLICY_V1,
  guardAllocation,
} from './guard.js';
import {
  call as nansenCall,
  accountCreditsRemaining,
  creditCostFor,
} from './nansen.js';
import { leaderboardRequest, screenerRequest, recordFromLeaderboard, smartMoneyFromScreener, LEADERBOARD_ENDPOINT, SCREENER_ENDPOINT } from './v4-evidence.js';
import { createOperatorReader } from './v5-evidence.js';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Gate v5's operator index (bench/V5.md), built from Nansen reads by `node bench/v5.js --collect`. */
export const OPERATOR_INDEX_FILE = fileURLToPath(new URL('../bench/v5/operator-index.json', import.meta.url));
export function loadOperatorIndex(file = OPERATOR_INDEX_FILE) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

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
  operatorIndex = undefined,
} = {}) {
  const calls = [];
  let charged = 0;

  async function execute(name, args = {}) {
    if (name === 'get_open_positions') return openPositions(args);
    if (name === 'get_independent_record') return independentRecord(args);
    if (name === 'get_smart_money_market') return smartMoneyMarket(args);
    if (name === 'get_operator') return operator(args);
    if (name !== 'get_pnl_summary') {
      throw new Error(`Live guard executor serves get_pnl_summary, get_open_positions, get_independent_record, get_smart_money_market and get_operator only, not "${name}".`);
    }

    const wallet = String(args.wallet ?? '').toLowerCase();
    const days = Number.isInteger(args.days) ? args.days : GUARD_WINDOW_DAYS;
    const at = now();
    const date = { from: iso(new Date(at.getTime() - days * 86_400_000)), to: iso(at) };
    const body = { address: wallet, date };

    calls.push({ path: GUARD_ENDPOINT, body, at: at.toISOString() });

    // One call per window. Any throw here reaches guardAllocation, which blocks with
    // a diagnostic and never turns a failure into a number.
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

    // win_rate and closed_trade_count are fields the same response already carries and
    // the frozen `validation/tools.js` path already serves. Passing them through is
    // what lets `wallet-copy-risk-v2` judge sample size and win rate live instead of
    // reporting them as not assessed. Nothing is derived and nothing is invented: a
    // field Nansen omits arrives as undefined and the gate records "not assessed".
    return {
      wallet,
      window_days: days,
      // The request's own date range, so the gate can check the span, not only the label.
      window: date,
      realized_pnl_usd: round2(summary.realized_pnl_usd),
      win_rate: finite(summary.win_rate) ? summary.win_rate : undefined,
      closed_trade_count: Number.isInteger(summary.closed_trade_count) ? summary.closed_trade_count : undefined,
      // The per-coin breakdown the same response carries, for the concentration check.
      top5_coins: Array.isArray(summary.top5_coins) ? summary.top5_coins : undefined,
      retrieved_at: at.toISOString(),
      source: GUARD_SOURCE,
    };
  }

  // Round 17: the third read, one credit. A throw reaches the gate's open-book check, which
  // records it as not assessed.
  async function openPositions(args = {}) {
    const wallet = String(args.wallet ?? '').toLowerCase();
    const at = now();
    calls.push({ path: 'profiler/perp-positions', body: { address: wallet }, at: at.toISOString() });
    const response = await call('profiler/perp-positions', { address: wallet }, { note: 'guard live open positions', timeoutMs });
    charged += creditCostFor('profiler/perp-positions');
    const d = response?.data?.data ?? response?.data ?? null;
    const rows = Array.isArray(d?.asset_positions) ? d.asset_positions : null;
    const account = Number(d?.margin_summary_account_value_usd);
    if (!rows || !Number.isFinite(account)) return { error: 'positions_unavailable', message: `Nansen returned no open positions for ${wallet}.` };
    return {
      wallet,
      open_position_count: rows.length,
      total_unrealized_pnl_usd: round2(rows.reduce((s, r) => s + (Number(r.position?.unrealized_pnl_usd) || 0), 0)),
      account_value_usd: round2(account),
      // Gate v4 reads the largest position's market and side from these.
      positions: rows.map(r => r.position ?? {}).map(p => ({ symbol: p.token_symbol, direction: Number(p.size) < 0 ? 'short' : 'long',
        position_value_usd: round2(Number(p.position_value_usd)), unrealized_pnl_usd: round2(Number(p.unrealized_pnl_usd)) })),
      source: 'Nansen /api/v1/profiler/perp-positions',
      retrieved_at: at.toISOString(),
    };
  }

  // Gate v4: a second record of the month, perp-leaderboard over the same calendar days (5 credits).
  async function independentRecord(args = {}) {
    const wallet = String(args.wallet ?? '').toLowerCase();
    const at = now();
    const window = args.window?.from && args.window?.to ? args.window : { from: iso(new Date(at.getTime() - (args.days ?? GUARD_WINDOW_DAYS) * 86_400_000)), to: iso(at) };
    const body = leaderboardRequest(wallet, window);
    calls.push({ path: LEADERBOARD_ENDPOINT, body, at: at.toISOString() });
    const response = await call(LEADERBOARD_ENDPOINT, body, { note: 'guard live v4 independent record', timeoutMs });
    charged += creditCostFor(LEADERBOARD_ENDPOINT);
    return recordFromLeaderboard(response?.data, { wallet, request: body, retrievedAt: at.toISOString() });
  }

  // Gate v4: smart money's current positions in one market, perp-screener (1 credit).
  async function smartMoneyMarket(args = {}) {
    const at = now();
    const body = screenerRequest(args.token_symbol, at, args.days ?? 7);
    calls.push({ path: SCREENER_ENDPOINT, body, at: at.toISOString() });
    const response = await call(SCREENER_ENDPOINT, body, { note: 'guard live v4 smart money', timeoutMs });
    charged += creditCostFor(SCREENER_ENDPOINT);
    return smartMoneyFromScreener(response?.data, { tokenSymbol: args.token_symbol, request: body, retrievedAt: at.toISOString() });
  }

  // Gate v5: the operator behind the wallet (related-wallets per chain, the funding transfer,
  // each indexed sibling's 30-day summary over the gate's own window).
  async function operator(args = {}) {
    const index = operatorIndex === undefined ? loadOperatorIndex() : operatorIndex;
    if (!index) return { error: 'not_read', message: 'Not assessed: no operator index in this checkout (bench/v5/operator-index.json, built by node bench/v5.js --collect).' };
    const wallet = String(args.wallet ?? '').toLowerCase();
    const at = now();
    const window = args.window?.from && args.window?.to ? args.window : { from: iso(new Date(at.getTime() - (args.days ?? GUARD_WINDOW_DAYS) * 86_400_000)), to: iso(at) };
    const counted = async (p, body, opts) => {
      calls.push({ path: p, body, at: now().toISOString() });
      const r = await call(p, body, opts);
      charged += creditCostFor(p);
      return r;
    };
    return createOperatorReader({ call: counted, index, now, timeoutMs })({ wallet, window });
  }

  return {
    execute,
    calls,
    creditsCharged: () => charged,
  };
}

/**
 * Run the guard against live Nansen evidence.
 *
 * Freshness stays on: both production policies require evidence no older than 15
 * minutes, which a live fetch satisfies by construction and a broken clock does not.
 *
 * Cost follows the policy, one credit per window. `wallet-realized-pnl-30d-v1` reads
 * the 30-day summary and costs one credit. `wallet-copy-risk-v2` reads the 7-day
 * summary too and costs two, and it buys the second window only after the first one
 * passes identity, window, source and freshness, so a dead check still costs one.
 *
 * The default here is pinned to v1 rather than to the library default. `/api/guard` in
 * `prototype/server.js` calls this function and its contract test asserts one credit
 * and the v1 policy id; the game screens are owned elsewhere this session. Pass
 * `policy: PRODUCTION_GUARD_POLICY_V2` for the two-window gate, as `scripts/guard.mjs`
 * now does by default.
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
  policy = PRODUCTION_GUARD_POLICY_V1,
  call = nansenCall,
  now = () => new Date(),
  timeoutMs = DEFAULT_GUARD_TIMEOUT_MS,
  operatorIndex = undefined,
} = {}) {
  const executor = createLiveGuardExecutor({ call, now, timeoutMs, operatorIndex });
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
