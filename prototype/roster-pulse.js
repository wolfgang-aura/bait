/**
 * The roster pulse: one live Nansen read per roster wallet, shared by every visitor, so the
 * front door shows data read minutes ago next to the dated brag.
 *
 * What it reads: profiler/perp-pnl-summary over the last 7 days, 1 credit per wallet.
 * What it shows: activity only, closed trades and markets traded in those 7 days. Never
 * realised PnL or win rate: a tile carries the hype only (prototype/roster.js), and the
 * 30-day realised figure is what the reveal is about.
 *
 * Spend: a refresh happens only when a page asks and the last attempt is older than ttlMs
 * (default 15 minutes). An idle host spends nothing; a busy one at most one credit per wallet
 * per ttlMs (4 wallets: 16 credits an hour). A failed attempt is kept for the same ttlMs, so a
 * failing provider cannot be hit faster. Credits go through the room's own caps
 * (live-evidence.js `sharedBlocker`/`reserve`), which keep one round's read in reserve, and
 * every call goes through validation/nansen.js (ledger, CREDIT_BUDGET, account balance).
 * The key never leaves validation/nansen.js.
 *
 * Nothing is shown as live that was not read live. A wallet whose read failed, or a refresh the
 * caps refused, is served with the saved capture's figure, its date and the reason.
 */
import { creditCostFor } from '../validation/nansen.js';

export const PULSE_ENDPOINT = 'profiler/perp-pnl-summary';
export const PULSE_WINDOW_DAYS = 7;
export const PULSE_TTL_MS = 15 * 60_000;
export const PULSE_TIMEOUT_MS = 15_000;

const iso = d => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
const hhmm = value => `${new Date(value).toISOString().slice(11, 16)} UTC`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const savedAt = value => { const d = new Date(value); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${hhmm(value)}`; };
const count = n => Math.round(n).toLocaleString('en-US');

/** The figure a tile prints, from a live read or the saved capture. One short line. */
export function pulseFigure(trades, { live = false } = {}) {
  if (!Number.isInteger(trades)) return null;
  // A live zero sits under a tile bragging about a dated busy week (THE GRINDER, judge 4): say it
  // is the current week that is quiet, so the strip does not read as a denial of the tile.
  if (trades === 0) return live ? 'Quiet now: no trades closed in the last 7 days' : 'No trades closed in 7 days';
  return `${count(trades)} trade${trades === 1 ? '' : 's'} closed in ${live ? 'the last ' : ''}7 days`;
}

const PAUSE_WORDS = {
  disabled: 'live reads off',
  no_key: 'live reads off: no Nansen key',
  daily_cap: 'live reads paused: daily credit cap',
  total_cap: 'live reads paused: credit allowance used up',
};

/**
 * @param {{
 *   prospects: Array<{ id: string, wallet: string, snapshot: object }>,
 *   call: Function, budget: { sharedBlocker: (n: number) => object|null, reserve: (n: number) => { settle: Function } },
 *   now?: () => Date, ttlMs?: number, timeoutMs?: number, log?: (line: string) => void,
 * }} options
 */
export function createRosterPulse({
  prospects, call, budget, now = () => new Date(), ttlMs = PULSE_TTL_MS, timeoutMs = PULSE_TIMEOUT_MS, log = () => {},
}) {
  const costPer = creditCostFor(PULSE_ENDPOINT);
  const cost = prospects.length * costPer;
  const saved = new Map(prospects.map(p => {
    const week = p.snapshot?.pnl_summary_7d ?? {};
    return [p.id, { trades: week.closed_trade_count ?? null, coins: week.traded_coin_count ?? null, at: p.snapshot?.retrieved_at ?? null }];
  }));
  /** The last attempt: when, and per wallet what came back. */
  let last = null;
  let inFlight = null;
  const stats = { refreshes: 0, credits: 0, unusedCredits: 0, lastSuccessAt: null, lastFailure: null };

  async function readOne(p, at) {
    const request = { address: p.wallet, date: { from: iso(new Date(at.getTime() - PULSE_WINDOW_DAYS * 86_400_000)), to: iso(at) } };
    let timer;
    try {
      const res = await Promise.race([
        call(PULSE_ENDPOINT, request, { note: 'roster pulse 7d summary', timeoutMs }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error(`timed out after ${timeoutMs}ms`), { code: 'timeout' })), timeoutMs); }),
      ]);
      const hdr = Number(res?.headers?.['x-nansen-credits-cost']);
      const credits = Number.isFinite(hdr) && res?.headers?.['x-nansen-credits-cost'] !== '' ? hdr : costPer;
      const s = res?.data?.data;
      if (!s || !Number.isInteger(s.closed_trade_count)) {
        return { ok: false, credits, reason: 'Nansen answered without a closed trade count' };
      }
      return { ok: true, credits, trades: s.closed_trade_count, coins: Number.isInteger(s.traded_coin_count) ? s.traded_coin_count : null };
    } catch (err) {
      // Billed if it got an HTTP answer or may still be billed after a timeout; counted unused.
      const billed = err?.status || err?.code === 'timeout' ? costPer : 0;
      return { ok: false, unused: billed, reason: err?.code === 'timeout' ? 'the live read timed out' : 'the live read failed', message: String(err?.message ?? err).slice(0, 160) };
    } finally { clearTimeout(timer); }
  }

  async function refresh() {
    const at = now();
    const reservation = budget.reserve(cost);
    let used = 0;
    let unused = 0;
    const results = new Map();
    try {
      const settled = await Promise.all(prospects.map(p => readOne(p, at)));
      prospects.forEach((p, i) => {
        const r = settled[i];
        if (r.ok) used += r.credits; else unused += (r.credits ?? r.unused ?? 0);
        results.set(p.id, r);
      });
    } finally {
      reservation.settle({ used, unused });
    }
    stats.refreshes += 1;
    stats.credits += used;
    stats.unusedCredits += unused;
    const ok = [...results.values()].filter(r => r.ok).length;
    if (ok) stats.lastSuccessAt = iso(at);
    const failed = [...results.entries()].filter(([, r]) => !r.ok);
    stats.lastFailure = failed.length ? { at: iso(at), wallets: failed.map(([id]) => id), message: failed[0][1].message ?? failed[0][1].reason } : null;
    log(`roster pulse ${ok}/${prospects.length} live, credits used=${used} unused=${unused}`);
    last = { at: iso(at), results };
  }

  function view(pause) {
    const readAt = last?.at ?? null;
    const wallets = prospects.map(p => {
      const s = saved.get(p.id);
      const r = pause ? null : last?.results.get(p.id);
      // Judge 6: the stamp names the figure it dates (the trade count), so it is never read as the
      // tile's brag, which carries its own read label.
      const savedLabel = s.at ? `count: Nansen saved read ${savedAt(s.at)}` : 'no saved count';
      if (r?.ok) {
        return { id: p.id, live: true, status: 'live', trades7d: r.trades, coins7d: r.coins, readAt,
          figure: pulseFigure(r.trades, { live: true }), stamp: `count: Nansen, read live ${hhmm(readAt)}` };
      }
      const status = pause ? 'paused' : 'failed';
      const why = pause ? (PAUSE_WORDS[pause.code] ?? `live reads paused: ${pause.reason}`)
        : readAt ? `live read failed ${hhmm(readAt)}` : 'live read failed';
      return { id: p.id, live: false, status, code: pause?.code ?? 'read_failed', reason: pause?.reason ?? r?.reason ?? 'the live read failed',
        trades7d: s.trades, coins7d: s.coins, savedAt: s.at, readAt: pause ? null : readAt,
        figure: pulseFigure(s.trades), stamp: `${why} · ${savedLabel}` };
    });
    return {
      endpoint: PULSE_ENDPOINT, windowDays: PULSE_WINDOW_DAYS,
      refreshedAt: pause ? null : readAt,
      nextRefreshAfter: !pause && readAt ? iso(new Date(Date.parse(readAt) + ttlMs)) : null,
      creditsPerRefresh: cost, ttlMinutes: Math.round(ttlMs / 60_000),
      live: wallets.filter(w => w.live).length,
      wallets,
    };
  }

  return {
    /** The roster's pulse, refreshed first when the last attempt is older than ttlMs. Always resolves. */
    async get() {
      const fresh = last && now().getTime() - Date.parse(last.at) < ttlMs;
      if (!fresh) {
        const stop = budget.sharedBlocker(cost);
        // A refused refresh spends nothing, so it is re-checked on the next page load.
        if (stop) return view(stop);
        if (!inFlight) inFlight = refresh().catch(err => { log(`roster pulse failed: ${err.message}`); last = { at: iso(now()), results: new Map() }; }).finally(() => { inFlight = null; });
        await inFlight;
      }
      return view(null);
    },
    /** For /healthz: what the pulse spent and when it last read anything live. */
    status() {
      return {
        endpoint: PULSE_ENDPOINT, window_days: PULSE_WINDOW_DAYS, wallets: prospects.length,
        credits_per_refresh: cost, ttl_minutes: Math.round(ttlMs / 60_000),
        worst_case_credits_per_hour: Math.ceil(60 / (ttlMs / 60_000)) * cost,
        last_attempt_at: last?.at ?? null, last_success_at: stats.lastSuccessAt, last_failure: stats.lastFailure,
        refreshes_this_process: stats.refreshes, credits_this_process: stats.credits, unused_credits_this_process: stats.unusedCredits,
        blocked_by: budget.sharedBlocker(cost)?.code ?? null,
      };
    },
  };
}
