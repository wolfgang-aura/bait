/**
 * The two Nansen reads gate v4 adds (bench/V4.md), in one place so the live guard, the Pitch
 * Room and the benchmark build the same requests and map the same responses.
 *
 *   perp-screener     1 credit   smart money's current longs and shorts in one market
 *   perp-leaderboard  5 credits  one wallet's realised PnL over the same 30 calendar days
 *
 * The gate asks for them by tool name (`get_smart_money_market`, `get_independent_record`);
 * `withV4Reads` answers those names from saved responses, and everything else from the
 * executor it wraps. Nothing here invents a number: a response without the field is an error
 * the gate records as not assessed.
 */
import { SMART_MONEY_SOURCE, RECORD_SOURCE } from './guard.js';

export const SCREENER_ENDPOINT = 'perp-screener';
export const LEADERBOARD_ENDPOINT = 'perp-leaderboard';
export const SCREENER_CREDITS = 1;
export const LEADERBOARD_CREDITS = 5;

const ymd = value => new Date(value).toISOString().slice(0, 10);
const finite = v => typeof v === 'number' && Number.isFinite(v);

/** perp-leaderboard for one wallet over the calendar days of a 30-day window. */
export function leaderboardRequest(wallet, window) {
  return {
    date: { from: ymd(window.from), to: ymd(window.to) },
    pagination: { page: 1, per_page: 10 },
    filters: { trader_address: String(wallet).toLowerCase() },
    premium_labels: false,
  };
}

/** perp-screener, smart-money cohort, one market, the `days` ending at `now`. */
export function screenerRequest(tokenSymbol, now, days = 7) {
  const at = new Date(now);
  return {
    date: { from: ymd(at.getTime() - days * 86_400_000), to: ymd(at) },
    pagination: { page: 1, per_page: 10 },
    filters: { trader_type: 'sm', token_symbol: String(tokenSymbol) },
  };
}

/** A perp-leaderboard response as the gate's `get_independent_record` answer. */
export function recordFromLeaderboard(body, { wallet, request, retrievedAt }) {
  const rows = Array.isArray(body?.data) ? body.data : [];
  const row = rows.find(r => String(r?.trader_address ?? '').toLowerCase() === String(wallet).toLowerCase());
  if (!row) return { error: 'not_listed', message: `perp-leaderboard returned no row for ${wallet}.`, source: RECORD_SOURCE };
  if (!finite(row.realized_pnl_usd)) return { error: 'no_realised_pnl', message: 'The leaderboard row carried no realised PnL.', source: RECORD_SOURCE };
  return {
    wallet: String(row.trader_address).toLowerCase(),
    window: request?.date ?? null,
    realized_pnl_usd: Math.round(row.realized_pnl_usd * 100) / 100,
    total_trades: Number.isInteger(row.total_trades) ? row.total_trades : null,
    source: RECORD_SOURCE,
    retrieved_at: retrievedAt ?? null,
  };
}

/** A perp-screener smart-money response as the gate's `get_smart_money_market` answer. */
export function smartMoneyFromScreener(body, { tokenSymbol, request, retrievedAt }) {
  const rows = Array.isArray(body?.data) ? body.data : [];
  const row = rows.find(r => String(r?.token_symbol ?? '').toUpperCase() === String(tokenSymbol).toUpperCase());
  if (!row) return { error: 'not_listed', message: `perp-screener returned no smart-money row for ${tokenSymbol}.`, source: SMART_MONEY_SOURCE };
  const longs = Number(row.current_smart_money_position_longs_usd);
  const shorts = Number(row.current_smart_money_position_shorts_usd);
  if (!Number.isFinite(longs) || !Number.isFinite(shorts)) return { error: 'no_positions', message: 'The screener row carried no smart-money positions.', source: SMART_MONEY_SOURCE };
  return {
    token_symbol: row.token_symbol,
    smart_money_longs_usd: Math.abs(longs),
    smart_money_shorts_usd: Math.abs(shorts),
    smart_money_longs_count: Number.isInteger(row.smart_money_longs_count) ? row.smart_money_longs_count : null,
    smart_money_shorts_count: Number.isInteger(row.smart_money_shorts_count) ? row.smart_money_shorts_count : null,
    window: request?.date ?? null,
    source: SMART_MONEY_SOURCE,
    retrieved_at: retrievedAt ?? null,
  };
}

/**
 * Answer the two v4 tools from reads already made; delegate everything else.
 * `reads.record` is a get_independent_record answer (or an error object, e.g. `not_read`);
 * `reads.smartMoney` maps an upper-case market symbol to a get_smart_money_market answer.
 */
export function withV4Reads(executor, reads = {}) {
  return {
    ...executor,
    execute: async (name, input = {}) => {
      if (name === 'get_independent_record') {
        return reads.record ?? { error: 'not_read', message: 'No perp-leaderboard read was made for this evidence.' };
      }
      if (name === 'get_smart_money_market') {
        const hit = reads.smartMoney?.[String(input.token_symbol ?? '').toUpperCase()];
        return hit ?? { error: 'not_read', message: reads.smartMoneyNote ?? null };
      }
      return executor.execute(name, input);
    },
  };
}

