/**
 * Live Nansen data for the playable encounter.
 *
 * `fetchLiveSnapshot` builds the same shape `snapshot.js` writes to disk, so the
 * referee, the evidence cards and the desk tools consume it unchanged. The difference
 * is honesty about coverage: a frozen snapshot paginates the whole 30-day fill history
 * (5 pages for the encounter wallet), which costs 7 credits and several minutes of
 * waiting on the 5-req/min `profiler/perp-trades` cap. A game cannot pay that per
 * session.
 *
 * What a live refresh buys, and why:
 *   1 credit  profiler/perp-pnl-summary, 30d  - the number the rule is judged on
 *   1 credit  profiler/perp-pnl-summary, 7d   - the number the player's best card uses
 *   <=3 cr    profiler/perp-trades            - most recent fills, newest first
 *   ----------------------------------------
 *   <=5 credits per refresh, cached for LIVE_TTL_MS.
 *
 * The fill pages stop at MAX_TRADE_PAGES, so the 30-day fill history is usually
 * PARTIAL. That is recorded in `fills_coverage` and surfaced to the agent in every
 * trade-tool response. The authoritative period totals come from the summaries, which
 * are complete by construction. Nothing is ever presented as more complete than it is.
 */

import { call, creditsUsed, CREDIT_BUDGET } from './nansen.js';
import { reconcile } from './reconcile.js';

export const PER_PAGE = 1000;
export const MAX_TRADE_PAGES = 3;
/** Refresh at most this often. One refresh serves every session started inside it. */
export const LIVE_TTL_MS = 10 * 60_000;
/** Worst case for one refresh: 2 summaries + MAX_TRADE_PAGES fill pages. */
export const MAX_REFRESH_CREDITS = 2 + MAX_TRADE_PAGES;

const iso = (d) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

/**
 * Fetch one live evidence set for a wallet.
 * @param {string} address           0x-prefixed Hyperliquid address
 * @param {object} opts              { maxTradePages, perPage, now, timeoutMs, log, caller }
 * @returns {Promise<object>}        snapshot-shaped object with source: 'live'
 */
export async function fetchLiveSnapshot(address, opts = {}) {
  const {
    maxTradePages = MAX_TRADE_PAGES,
    perPage = PER_PAGE,
    now = new Date(),
    timeoutMs = 60_000,
    log = () => {},
    caller = call,
    // Off by default: the game's tools never read positions, so the player flow does
    // not pay the extra credit. The benchmark's armed-plus config turns it on.
    includePositions = false,
  } = opts;

  const wallet = String(address).toLowerCase();
  const W30 = { from: iso(new Date(now.getTime() - 30 * 86400_000)), to: iso(now) };
  const W7 = { from: iso(new Date(now.getTime() - 7 * 86400_000)), to: iso(now) };

  const snapshot = {
    schema_version: 1,
    source: 'live',
    wallet,
    chain: 'hyperliquid',
    retrieved_at: iso(now),
    windows: { '30d': W30, '7d': W7 },
    pnl_summary_30d: null,
    pnl_summary_7d: null,
    open_positions: { skipped: 'live refresh does not fetch positions (the game tools never read them)' },
    trades_30d: [],
    trades_pagination: { per_page: perPage, pages_fetched: 0, is_complete: false, max_pages: maxTradePages },
    sources: [],
  };

  const source = (pathName, body, note) =>
    snapshot.sources.push({ path: pathName, body, note, at: iso(new Date()) });

  log('30d PnL summary');
  snapshot.pnl_summary_30d =
    (await caller('profiler/perp-pnl-summary', { address: wallet, date: W30 }, { note: 'live refresh 30d summary', timeoutMs })).data?.data ?? null;
  source('profiler/perp-pnl-summary', { address: wallet, date: W30 }, 'live 30d summary');

  log('7d PnL summary');
  snapshot.pnl_summary_7d =
    (await caller('profiler/perp-pnl-summary', { address: wallet, date: W7 }, { note: 'live refresh 7d summary', timeoutMs })).data?.data ?? null;
  source('profiler/perp-pnl-summary', { address: wallet, date: W7 }, 'live 7d summary');

  if (includePositions) {
    log('open perp positions');
    try {
      const res = await caller('profiler/perp-positions', { address: wallet }, { note: 'live refresh open positions', timeoutMs });
      snapshot.open_positions = res.data?.data ?? res.data ?? null;
      source('profiler/perp-positions', { address: wallet }, 'live open positions');
    } catch (err) {
      snapshot.open_positions = { skipped: `live fetch failed: ${String(err.message).slice(0, 160)}` };
    }
  }

  // Newest first, so the shortfall lands on the oldest end of the 30-day window and
  // the 7-day slice the player's strongest card uses is complete whenever it fits.
  for (let page = 1; page <= maxTradePages; page++) {
    const body = {
      address: wallet,
      date: W30,
      pagination: { page, per_page: perPage },
      order_by: [{ field: 'timestamp', direction: 'DESC' }],
    };
    log(`perp fills page ${page}/${maxTradePages}`);
    const res = await caller('profiler/perp-trades', body, { note: `live refresh fills page ${page}`, timeoutMs: Math.max(timeoutMs, 90_000) });
    const rows = res.data?.data ?? [];
    snapshot.trades_30d.push(...rows);
    snapshot.trades_pagination.pages_fetched = page;
    source('profiler/perp-trades', body, `live fills page ${page}`);
    if (res.data?.pagination?.is_last_page === true || rows.length < perPage) {
      snapshot.trades_pagination.is_complete = true;
      break;
    }
  }

  // Everything downstream expects oldest-first fills, as the frozen snapshots are.
  snapshot.trades_30d.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

  const oldest = snapshot.trades_30d[0]?.timestamp ?? null;
  const complete = snapshot.trades_pagination.is_complete;
  snapshot.fills_coverage = {
    complete,
    fills: snapshot.trades_30d.length,
    pages_fetched: snapshot.trades_pagination.pages_fetched,
    covers_from: complete ? W30.from : oldest,
    covers_to: W30.to,
    // With newest-first pagination a partial fetch still covers the whole 7-day slice
    // whenever the oldest fill we hold predates the start of that window.
    covers_7d: complete || (oldest !== null && Date.parse(oldest) <= Date.parse(W7.from)),
  };

  // Reconciling a partial fill set against a complete summary produces a meaningless
  // multi-million-dollar "gap". Only reconcile when the fills are actually complete.
  snapshot.reconciliation = complete
    ? reconcile(snapshot)
    : {
        skipped: 'partial fill coverage',
        note: `Only the most recent ${snapshot.trades_30d.length} fills were fetched, so fill totals cannot be reconciled against the 30-day summary.`,
        fills_fetched: snapshot.trades_30d.length,
        fills_complete: false,
        summary_realized_pnl_usd: snapshot.pnl_summary_30d?.realized_pnl_usd ?? null,
      };
  return snapshot;
}

/** True when a dataset can drive the encounter: losing 30-day record, both summaries. */
export function isUsableEncounterData(data) {
  const m = data?.pnl_summary_30d;
  const w = data?.pnl_summary_7d;
  return Boolean(
    Number.isFinite(m?.realized_pnl_usd) &&
      Number.isFinite(w?.realized_pnl_usd) &&
      m.realized_pnl_usd < 0 &&
      Array.isArray(m.top5_coins) &&
      m.top5_coins.length > 0
  );
}

/**
 * A cached live/snapshot data source.
 *
 * `refresh()` is safe to call on every session start: it only spends credits when the
 * cache has expired, and concurrent callers share one in-flight fetch. A failed or
 * unusable refresh keeps serving the frozen fallback and records why, so the UI can
 * label the data truthfully instead of guessing.
 */
export function createDataSource({
  fallback,
  wallet = fallback?.wallet,
  ttlMs = LIVE_TTL_MS,
  enabled = true,
  fetcher = fetchLiveSnapshot,
  now = () => Date.now(),
  log = () => {},
}) {
  if (!fallback) throw new Error('createDataSource needs a frozen fallback dataset.');

  let data = fallback;
  let mode = 'snapshot';
  let fetchedAt = null;
  let lastAttemptAt = null;
  let lastError = enabled ? null : 'Live refresh is disabled (NANSEN_LIVE=0).';
  let inFlight = null;

  const status = () => ({
    mode,
    live: mode === 'live',
    fetchedAt,
    lastAttemptAt,
    lastError,
    capturedAt: data.retrieved_at,
    ttlMs,
    maxRefreshCredits: MAX_REFRESH_CREDITS,
    fillsComplete: data.trades_pagination?.is_complete === true,
    fillCount: data.trades_30d?.length ?? 0,
  });

  async function attempt() {
    lastAttemptAt = new Date().toISOString();
    try {
      const fresh = await fetcher(wallet, { log });
      if (!isUsableEncounterData(fresh)) {
        // A wallet that has climbed back above water is a real outcome, not an error.
        // Say so and keep the frozen case rather than quietly reshaping the game.
        throw new Error(
          `Live record is not usable for this encounter (30d realised PnL ` +
            `${fresh?.pnl_summary_30d?.realized_pnl_usd ?? 'missing'}). Serving the captured snapshot.`
        );
      }
      data = fresh;
      mode = 'live';
      fetchedAt = fresh.retrieved_at;
      lastError = null;
    } catch (err) {
      lastError = String(err?.message || err).slice(0, 300);
      log(`live refresh failed: ${lastError}`);
    }
    return status();
  }

  return {
    get data() {
      return data;
    },
    status,
    creditsNote: () => `${creditsUsed()}/${CREDIT_BUDGET} credits used locally`,
    /** Refresh if the cache has expired. `force` ignores the TTL. */
    async refresh({ force = false } = {}) {
      if (!enabled) return status();
      if (!force && fetchedAt && now() - Date.parse(fetchedAt) < ttlMs) return status();
      if (inFlight) return inFlight;
      inFlight = attempt().finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
  };
}
