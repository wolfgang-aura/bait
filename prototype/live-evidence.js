/**
 * Live Nansen evidence for the Pitch Room's four Hyperliquid traders.
 *
 * One read per round, taken when the round starts and reused for every wire in it:
 *   1 credit  profiler/perp-pnl-summary, 30 days  - the number the gate judges
 *   1 credit  profiler/perp-pnl-summary, 7 days   - the week the dossier and regime check use
 * Two credits per wallet read, cached per wallet for LIVE_EVIDENCE_TTL_MS, so a busy
 * wallet costs at most two credits every half hour however many rounds are played.
 *
 * Every call goes through `validation/nansen.js`, so it is written to the call ledger,
 * counted against CREDIT_BUDGET and refused below the account balance. On top of that
 * this module holds two hard caps of its own, checked before a read is attempted:
 *   HOSTED_NANSEN_CREDITS_PER_DAY  (default 2000)   credits per UTC day
 *   HOSTED_NANSEN_CREDITS_TOTAL    (default 18000)  credits for the life of the counter
 * (raised 23 Sep 2026 from 20 and 300 after the owner bought 20,000 credits)
 * The counter is written to a small JSON file when one is given. On a free host whose
 * disk is wiped on every restart or deploy that file does not survive, so there the
 * total cap is per process lifetime and the Nansen account balance is the backstop.
 *
 * Nothing here ever returns a number it did not read. A missing key, a cap, a timeout,
 * a provider error or a summary with a missing field is `{ live: false, reason }`, and
 * the room plays the frozen capture exactly as it did before this module existed.
 * The key itself never leaves `validation/nansen.js`: this file only learns whether one
 * is present.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { call as nansenCall, creditCostFor } from '../validation/nansen.js';
import { PRODUCTION_GUARD_POLICY_V3, PRODUCTION_GUARD_POLICY_V4, PRODUCTION_GUARD_POLICY_V5, guardAllocation, largestOpenPosition } from '../validation/guard.js';
import { makeToolExecutor } from '../validation/tools.js';
import { stripNansenLabels } from '../validation/nansen-labels.js';
import { leaderboardRequest, screenerRequest, recordFromLeaderboard, smartMoneyFromScreener,
  LEADERBOARD_ENDPOINT, SCREENER_ENDPOINT, withV4Reads } from '../validation/v4-evidence.js';
import { createOperatorReader, RELATED_ENDPOINT, TRANSACTIONS_ENDPOINT, SUMMARY_ENDPOINT, OPERATOR_CHAINS, MAX_SIBLINGS_READ } from '../validation/v5-evidence.js';
import { loadOperatorIndex } from '../validation/guard-live.js';

export const LIVE_ENDPOINT = 'profiler/perp-pnl-summary';
export const LIVE_EVIDENCE_TTL_MS = 30 * 60_000;
/** Two summaries per read. */
export const LIVE_READ_CREDITS = 2 * creditCostFor(LIVE_ENDPOINT);
/** The second live endpoint: the newest perp fills, newest first, one credit a page. */
export const FILLS_ENDPOINT = 'profiler/perp-trades';
export const FILLS_PER_PAGE = 1000;
/** Round 17: the third live endpoint, the wallet's current positions and account value. One credit. */
export const POSITIONS_ENDPOINT = 'profiler/perp-positions';
/** Pages of fills per read (round 11). 0 turns the fills read off. At most 3. */
export const DEFAULT_FILL_PAGES = 1;
export const DEFAULT_DAILY_CAP = 2000;
export const DEFAULT_TOTAL_CAP = 18000;
// Round 20: 8 s timed out on busy wallets (THE STREAK); 15 s, and one retry on a timeout.
export const DEFAULT_READ_TIMEOUT_MS = 15_000;

/**
 * The gate the room runs on a live read. The production two-window policy with one
 * change: evidence may be up to an hour old, because a read is cached for 30 minutes to
 * fit the credit caps and a round can take a while after it. `/api/guard` keeps the
 * 15-minute production limit. Past an hour the gate blocks as stale, which is fail
 * closed, not a pass.
 */
export const ROOM_LIVE_GUARD_POLICY = Object.freeze({
  ...PRODUCTION_GUARD_POLICY_V5,
  id: 'wallet-copy-risk-room-live-v5',
  maxEvidenceAgeMs: 60 * 60_000,
});

/**
 * Gate v4 (bench/V4.md): two more endpoints. perp-screener for the market of the largest open
 * position (1 credit), and perp-leaderboard for the same 30 days (5 credits), bought only when
 * v3's rules on this read would not already refuse: a refusal is never charged 5 credits.
 */
export const SMART_MONEY_ENDPOINT = SCREENER_ENDPOINT;
export const RECORD_ENDPOINT = LEADERBOARD_ENDPOINT;
const PRECHECK_POLICY = Object.freeze({ ...PRODUCTION_GUARD_POLICY_V3, id: 'room-v4-precheck', maxEvidenceAgeMs: 60 * 60_000 });
/**
 * Gate v5 (bench/V5.md): the operator behind the wallet. Read only when v4's rules on this same
 * read would not already refuse, so a refused wallet is never charged for it. Most it can cost:
 * related-wallets on each chain, one funding transfer per chain, one summary per sibling.
 */
const V5_PRECHECK_POLICY = Object.freeze({ ...PRODUCTION_GUARD_POLICY_V4, id: 'room-v5-precheck', maxEvidenceAgeMs: 60 * 60_000 });
export const OPERATOR_ENDPOINTS = Object.freeze([RELATED_ENDPOINT, TRANSACTIONS_ENDPOINT, SUMMARY_ENDPOINT]);
export const V5_MAX_CREDITS = OPERATOR_CHAINS.length * (creditCostFor(RELATED_ENDPOINT) + creditCostFor(TRANSACTIONS_ENDPOINT)) + MAX_SIBLINGS_READ * creditCostFor(SUMMARY_ENDPOINT);

const iso = d => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
const finite = v => typeof v === 'number' && Number.isFinite(v);
const utcDay = d => d.toISOString().slice(0, 10);
export const hhmm = value => `${new Date(value).toISOString().slice(11, 16)} UTC`;

/** A summary the dossier, the truth screen and the gate can all read without guessing. */
/** A summary with no closed perp trade in the window: the wallet has no record to read. */
const noTrades = s => !s || s.closed_trade_count === 0 || s.closed_trade_count === null || s.closed_trade_count === undefined;

/** Every fresh read's two raw Nansen responses, one JSON file each, named by time and wallet. */
export const RAW_NAME = /^\d{8}T\d{6}Z-0x[0-9a-f]{8}\.json$/;
export function saveRawRead(dir, { wallet, fetchedAt, windows, responses }) {
  if (!dir) return null;
  const body = JSON.stringify({
    kind: 'nansen-live-read', endpoint: LIVE_ENDPOINT,
    // Every endpoint this file holds a response from (round 12). Files saved before then
    // carry `endpoint` only, though some also hold perp-trades fills: bench/live-reads/README.md.
    // From 25 Sep 2026 it also names each endpoint the owner read called (responses.operator:
    // related-wallets, transactions; the siblings' perp-pnl-summary is already listed first).
    endpoints: [...new Set([LIVE_ENDPOINT, ...(responses.fills ? ['profiler/perp-trades'] : []), ...(responses.positions ? [POSITIONS_ENDPOINT] : []),
      ...(responses.smart_money ? [SCREENER_ENDPOINT] : []), ...(responses.leaderboard ? [LEADERBOARD_ENDPOINT] : []),
      ...(Array.isArray(responses.operator) ? responses.operator.map(r => r?.endpoint).filter(e => typeof e === 'string') : [])])],
    wallet, fetched_at: fetchedAt, windows,
    // As Nansen sent them (status, the credit header and the whole JSON body, per window), minus
    // Nansen's address labels, which are not redistributed (validation/nansen-labels.js).
    responses: stripNansenLabels(responses),
  }, null, 2) + '\n';
  const name = `${fetchedAt.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}-${wallet.slice(0, 10)}.json`;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), body);
  return { file: name, sha256: createHash('sha256').update(body).digest('hex'), bytes: Buffer.byteLength(body) };
}

/** The saved reads in a directory, newest first, each with its SHA-256. */
export function listRawReads(dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => RAW_NAME.test(f)).sort().reverse().map(file => {
    const body = fs.readFileSync(path.join(dir, file));
    const j = JSON.parse(body.toString('utf8'));
    return { file, sha256: createHash('sha256').update(body).digest('hex'), bytes: body.length, wallet: j.wallet, fetched_at: j.fetched_at };
  });
}

function usableSummary(s) {
  return !!s && finite(s.realized_pnl_usd) && finite(s.win_rate) && Number.isInteger(s.closed_trade_count);
}

async function within(promise, ms) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error(`live read timed out after ${ms}ms`), { code: 'timeout' })), ms); }),
    ]);
  } finally { clearTimeout(timer); }
}

/**
 * @param {{
 *   enabled: boolean, keyPresent: boolean, call?: Function, now?: () => Date,
 *   ttlMs?: number, dailyCap?: number, totalCap?: number, timeoutMs?: number,
 *   stateFile?: string|null, log?: (line: string) => void,
 * }} options
 */
export function createLiveEvidence({
  enabled, keyPresent, call = nansenCall, now = () => new Date(),
  ttlMs = LIVE_EVIDENCE_TTL_MS, dailyCap = DEFAULT_DAILY_CAP, totalCap = DEFAULT_TOTAL_CAP,
  timeoutMs = DEFAULT_READ_TIMEOUT_MS, stateFile = null, log = () => {}, rawDir = null,
  fillPages = DEFAULT_FILL_PAGES, fillsTimeoutMs = 15_000, positions = true,
  embargoMs = LIVE_EVIDENCE_TTL_MS, v4Reads = positions, v5Reads = v4Reads, operatorIndex = undefined,
} = {}) {
  // The operator index the v5 row looks siblings up in (bench/v5/operator-index.json). Without one
  // the row says so and nothing is read.
  const index = v5Reads ? (operatorIndex === undefined ? loadOperatorIndex() : operatorIndex) : null;
  // Round 17: a fresh read's raw file holds the numbers the round keeps sealed, so it is
  // hidden from /api/live-reads until a gate has run on it (release), or embargoMs passes
  // for a round nobody finished. Receipts stay public; they just arrive with the verdict.
  const sealedRaw = new Map();
  const pages = Math.max(0, Math.min(3, Math.round(fillPages)));
  // What one read can cost: two summaries and up to `pages` pages of fills.
  // v4 adds at most one screener and one leaderboard read; the cap reserves the most a read can cost.
  const V4_CREDITS = v4Reads ? creditCostFor(SMART_MONEY_ENDPOINT) + creditCostFor(RECORD_ENDPOINT) : 0;
  const V5_CREDITS = v5Reads && v4Reads ? V5_MAX_CREDITS : 0;
  const READ_CREDITS = LIVE_READ_CREDITS + pages * creditCostFor(FILLS_ENDPOINT) + (positions ? creditCostFor(POSITIONS_ENDPOINT) : 0) + V4_CREDITS + V5_CREDITS;
  const cache = new Map();
  const inFlight = new Map();
  // Round 20: creditsToday/Total count only reads that succeeded and were used. Credits a failed or
  // timed-out read may have been billed for are kept apart (unusedToday/Total), still counted
  // against the caps so a flaky provider can never overspend, and reported under their own name.
  const counter = { day: utcDay(now()), creditsToday: 0, creditsTotal: 0, unusedToday: 0, unusedTotal: 0, lastSuccessAt: null, lastFailure: null, reads: 0, retries: 0 };

  if (stateFile) {
    try {
      const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      if (Number.isFinite(saved.creditsTotal)) counter.creditsTotal = saved.creditsTotal;
      if (saved.day === counter.day && Number.isFinite(saved.creditsToday)) counter.creditsToday = saved.creditsToday;
      if (typeof saved.lastSuccessAt === 'string') counter.lastSuccessAt = saved.lastSuccessAt;
      if (Number.isFinite(saved.unusedTotal)) counter.unusedTotal = saved.unusedTotal;
      if (saved.day === counter.day && Number.isFinite(saved.unusedToday)) counter.unusedToday = saved.unusedToday;
    } catch { /* no file yet, or a wiped disk: start from zero and say so in /healthz */ }
  }
  const persist = () => {
    if (!stateFile) return;
    try {
      fs.mkdirSync(path.dirname(stateFile), { recursive: true });
      fs.writeFileSync(stateFile, JSON.stringify({ ...counter, lastFailure: undefined, savedAt: new Date().toISOString() }, null, 2));
    } catch (err) { log(`credit counter write failed: ${err.message}`); }
  };
  const rollDay = () => {
    const today = utcDay(now());
    if (counter.day !== today) { counter.day = today; counter.creditsToday = 0; counter.unusedToday = 0; }
  };

  /** Why a read of `cost` credits would not be attempted right now, or null when it would. */
  function blocker(cost = READ_CREDITS) {
    if (!enabled) return { code: 'disabled', reason: 'live reads are off on this host' };
    if (!keyPresent) return { code: 'no_key', reason: 'no Nansen key is configured' };
    rollDay();
    const today = counter.creditsToday + counter.unusedToday;
    const total = counter.creditsTotal + counter.unusedTotal;
    if (today + cost > dailyCap) {
      return { code: 'daily_cap', reason: `today's live Nansen credits are used up (${today} of ${dailyCap})` };
    }
    if (total + cost > totalCap) {
      return { code: 'total_cap', reason: `the live Nansen credit allowance is used up (${total} of ${totalCap})` };
    }
    return null;
  }

  const charge = n => {
    if (!n) return;
    rollDay();
    counter.creditsToday += n;
    counter.creditsTotal += n;
  };

  async function fetchRead(wallet) {
    const at = now();
    const windows = {
      '30d': { from: iso(new Date(at.getTime() - 30 * 86_400_000)), to: iso(at) },
      '7d': { from: iso(new Date(at.getTime() - 7 * 86_400_000)), to: iso(at) },
    };
    // Reserve both credits before the first request leaves, so two rounds starting at
    // once cannot both squeeze under the cap. What did not reach Nansen is refunded.
    charge(READ_CREDITS);
    let charged = 0;
    const responses = {};
    const one = async days => {
      try {
        const request = { address: wallet, date: windows[`${days}d`] };
        const res = await call(LIVE_ENDPOINT, request, { note: `room live ${days}d summary`, timeoutMs });
        const raw = res?.headers?.['x-nansen-credits-cost'];
        const header = raw === undefined || raw === null || raw === '' ? NaN : Number(raw);
        charged += Number.isFinite(header) ? header : creditCostFor(LIVE_ENDPOINT);
        responses[`${days}d`] = { request, status: res?.status ?? null, credits_cost_header: raw ?? null, body: res?.data ?? null };
        return res?.data?.data ?? null;
      } catch (err) {
        // The ledger charges a request that got an HTTP answer and nothing else. Match it.
        if (err?.status) charged += creditCostFor(LIVE_ENDPOINT);
        throw err;
      }
    };
    let timedOut = false;
    let ok = false;
    try {
      // allSettled, so both requests have finished and been counted before any refund.
      const settled = await within(Promise.allSettled([one(30), one(7)]), timeoutMs)
        .catch(err => { if (err?.code === 'timeout') timedOut = true; throw err; });
      const failed = settled.find(r => r.status === 'rejected');
      if (failed) throw failed.reason;
      const [summary30, summary7] = settled.map(r => r.value);
      // The second endpoint: the newest fills, live. A failure here keeps the summaries
      // live and says the fills were not read; it never invents a fill.
      let fills = null;
      if (pages > 0 && !(noTrades(summary30) && noTrades(summary7))) {
        const rows = [];
        responses.fills = [];
        try {
          for (let page = 1; page <= pages; page++) {
            const request = { address: wallet, date: windows['30d'], pagination: { page, per_page: FILLS_PER_PAGE }, order_by: [{ field: 'timestamp', direction: 'DESC' }] };
            let res;
            try {
              res = await within(call(FILLS_ENDPOINT, request, { note: `room live fills page ${page}`, timeoutMs: fillsTimeoutMs }), fillsTimeoutMs);
            } catch (err) { if (err?.status) charged += creditCostFor(FILLS_ENDPOINT); throw err; }
            const hdr = res?.headers?.['x-nansen-credits-cost'];
            const n = hdr === undefined || hdr === null || hdr === '' ? NaN : Number(hdr);
            charged += Number.isFinite(n) ? n : creditCostFor(FILLS_ENDPOINT);
            responses.fills.push({ request, status: res?.status ?? null, credits_cost_header: hdr ?? null, body: res?.data ?? null });
            const got = Array.isArray(res?.data?.data) ? res.data.data : [];
            rows.push(...got);
            const last = res?.data?.pagination?.is_last_page === true || got.length < FILLS_PER_PAGE;
            if (last) { fills = { rows, complete: true, pages: page }; break; }
            if (page === pages) fills = { rows, complete: false, pages: page };
          }
        } catch (err) {
          fills = { rows: [], complete: false, pages: 0, error: String(err?.message ?? err).slice(0, 160) };
          log(`live fills failed wallet=${wallet.slice(0, 10)}: ${fills.error}`);
        }
      }
      // Round 17: the third read, the open positions and account value. A failure keeps
      // everything else live and leaves the gate's open-book check not assessed.
      let book = null;
      if (positions && !(noTrades(summary30) && noTrades(summary7))) {
        const request = { address: wallet };
        try {
          const res = await within(call(POSITIONS_ENDPOINT, request, { note: 'room live open positions', timeoutMs: fillsTimeoutMs }), fillsTimeoutMs);
          const hdr = res?.headers?.['x-nansen-credits-cost'];
          const n = hdr === undefined || hdr === null || hdr === '' ? NaN : Number(hdr);
          charged += Number.isFinite(n) ? n : creditCostFor(POSITIONS_ENDPOINT);
          responses.positions = { request, status: res?.status ?? null, credits_cost_header: hdr ?? null, body: res?.data ?? null };
          const d = res?.data?.data ?? res?.data ?? null;
          book = Array.isArray(d?.asset_positions) ? d : { error: 'no asset_positions in the response' };
        } catch (err) {
          if (err?.status) charged += creditCostFor(POSITIONS_ENDPOINT);
          book = { error: String(err?.message ?? err).slice(0, 160) };
          log(`live positions failed wallet=${wallet.slice(0, 10)}: ${book.error}`);
        }
      }
      // Gate v4: smart money in the market of the largest open position, then the second record.
      // Each failure is kept as an error the gate reads as not assessed; neither can raise an amount.
      let smartMoney = null;
      let record = null;
      let operator = null;
      let operatorCredits = 0;
      const paid = async (endpoint, request, note) => {
        let res;
        try {
          res = await within(call(endpoint, request, { note, timeoutMs: fillsTimeoutMs, creditCost: creditCostFor(endpoint) }), fillsTimeoutMs);
        } catch (err) { if (err?.status) charged += creditCostFor(endpoint); throw err; }
        const hdr = res?.headers?.['x-nansen-credits-cost'];
        const n = hdr === undefined || hdr === null || hdr === '' ? NaN : Number(hdr);
        charged += Number.isFinite(n) ? n : creditCostFor(endpoint);
        return { res, hdr };
      };
      if (v4Reads && !(noTrades(summary30) && noTrades(summary7))) {
        const probe = { wallet, retrieved_at: iso(at), windows, pnl_summary_30d: { ...summary30, top5_coins: summary30?.top5_coins ?? [] },
          pnl_summary_7d: { ...summary7, top5_coins: summary7?.top5_coins ?? [] }, open_positions: book && !book.error ? book : null, trades_30d: [] };
        const tools = makeToolExecutor(probe, { mode: 'armed' });
        const top = book && !book.error ? largestOpenPosition(await tools.execute('get_open_positions', { wallet })) : null;
        if (top) {
          const request = screenerRequest(top.symbol, at, PRODUCTION_GUARD_POLICY_V4.smartMoneyWindowDays);
          try {
            const { res, hdr } = await paid(SMART_MONEY_ENDPOINT, request, 'room live v4 smart money');
            responses.smart_money = { request, status: res?.status ?? null, credits_cost_header: hdr ?? null, body: res?.data ?? null };
            smartMoney = { [top.symbol.toUpperCase()]: smartMoneyFromScreener(res?.data, { tokenSymbol: top.symbol, request, retrievedAt: iso(at) }) };
          } catch (err) {
            smartMoney = { [top.symbol.toUpperCase()]: { error: 'read_failed', message: String(err?.message ?? err).slice(0, 160) } };
            log(`live smart money failed wallet=${wallet.slice(0, 10)}: ${smartMoney[top.symbol.toUpperCase()].message}`);
          }
        }
        // The leaderboard is bought only when v3's rules on this same read would not refuse.
        let pre = null;
        try {
          if (usableSummary(summary30) && usableSummary(summary7)) {
            pre = await guardAllocation({ executor: tools, wallet, allocation: 1, policy: PRECHECK_POLICY, now: () => at });
          }
        } catch { pre = null; }
        if (pre && pre.decision !== 'block') {
          const request = leaderboardRequest(wallet, windows['30d']);
          try {
            const { res, hdr } = await paid(RECORD_ENDPOINT, request, 'room live v4 leaderboard record');
            responses.leaderboard = { request, status: res?.status ?? null, credits_cost_header: hdr ?? null, body: res?.data ?? null };
            record = recordFromLeaderboard(res?.data, { wallet, request, retrievedAt: iso(at) });
          } catch (err) {
            record = { error: 'read_failed', message: String(err?.message ?? err).slice(0, 160) };
            log(`live leaderboard failed wallet=${wallet.slice(0, 10)}: ${record.message}`);
          }
        } else {
          const why = pre ? `the ${pre.checks.find(c => c.result === 'fail')?.id === 'realised_pnl_30d' ? '30-day record' : `"${pre.checks.find(c => c.result === 'fail')?.id}" check`} already refuses this wallet` : 'the summaries were not usable';
          record = { error: 'not_read', skipped: true, message: `Not read: ${why}, so a second record (5 credits) could not change the decision.` };
        }
        // Gate v5: the operator behind the wallet, bought only when v4 on this read would not refuse.
        if (V5_CREDITS) {
          let pre4 = null;
          try {
            if (pre && pre.decision !== 'block') {
              pre4 = await guardAllocation({ executor: withV4Reads(tools, { record, smartMoney: smartMoney ?? {} }), wallet, allocation: 1, policy: V5_PRECHECK_POLICY, now: () => at });
            }
          } catch { pre4 = null; }
          if (!index) {
            operator = { error: 'not_read', message: 'Not assessed: this host has no owner index (bench/v5/operator-index.json), so no sibling wallet can be looked up.' };
          } else if (pre4 && pre4.decision !== 'block') {
            responses.operator = [];
            const counted = async (endpoint, request, opts = {}) => {
              let res;
              try {
                res = await within(call(endpoint, request, { note: `room live v5 ${opts.note ?? endpoint}`, timeoutMs: fillsTimeoutMs, creditCost: creditCostFor(endpoint) }), fillsTimeoutMs);
              } catch (err) { if (err?.status) { charged += creditCostFor(endpoint); operatorCredits += creditCostFor(endpoint); } throw err; }
              const hdr = res?.headers?.['x-nansen-credits-cost'];
              const n = hdr === undefined || hdr === null || hdr === '' ? NaN : Number(hdr);
              const cost = Number.isFinite(n) ? n : creditCostFor(endpoint);
              charged += cost;
              operatorCredits += cost;
              responses.operator.push({ endpoint, request, status: res?.status ?? null, credits_cost_header: hdr ?? null, body: res?.data ?? null });
              return res;
            };
            try {
              operator = await createOperatorReader({ call: counted, index, now: () => at, timeoutMs: fillsTimeoutMs })({ wallet, window: windows['30d'] });
            } catch (err) {
              operator = { error: 'read_failed', message: String(err?.message ?? err).slice(0, 160) };
              log(`live operator failed wallet=${wallet.slice(0, 10)}: ${operator.message}`);
            }
          } else {
            const failed = (pre4 ?? pre)?.checks?.find(c => c.result === 'fail')?.id;
            operator = { error: 'not_read', skipped: true, message: `Not read: ${failed ? `the "${failed}" check already refuses this wallet` : 'the summaries were not usable'}, so the owner's other wallets could not change the decision.` };
          }
        }
      }
      // Every response that reached us and was paid for is kept, whatever it says.
      let raw = null;
      try { raw = saveRawRead(rawDir, { wallet, fetchedAt: iso(at), windows, responses }); } catch (err) { log(`raw read save failed: ${err.message}`); }
      if (raw?.file) sealedRaw.set(raw.file, now().getTime() + embargoMs);
      if (noTrades(summary30) && noTrades(summary7)) {
        throw Object.assign(new Error('No closed Hyperliquid perp trade in the last 30 days'), { code: 'no_history', raw });
      }
      if (!usableSummary(summary30) || !usableSummary(summary7)) {
        throw Object.assign(new Error('Nansen returned a summary without realised PnL, win rate or closed trade count'), { code: 'unusable' });
      }
      const result = {
        live: true, wallet, fetchedAt: iso(at), windows,
        summary30: { ...summary30, top5_coins: Array.isArray(summary30.top5_coins) ? summary30.top5_coins : [] },
        summary7: { ...summary7, top5_coins: Array.isArray(summary7.top5_coins) ? summary7.top5_coins : [] },
        endpoint: LIVE_ENDPOINT,
        fills,
        positions: book,
        // Gate v4's two reads, as the gate's tools answer them; null when v4 reads are off.
        v4: v4Reads ? { smartMoney: smartMoney ?? {}, record, smartMoneyRead: !!responses.smart_money, recordRead: !!responses.leaderboard } : null,
        // Gate v5's operator read, as get_operator answers it; null when v5 reads are off.
        v5: V5_CREDITS ? { operator, operatorRead: !!responses.operator?.length, credits: operatorCredits,
          endpoints: [...new Set((responses.operator ?? []).map(r => r.endpoint))] } : null,
        credits: charged,
        raw,
      };
      ok = true;
      return result;
    } finally {
      // A timed-out read can still be billed after we stop waiting, so its reservation is
      // kept. Otherwise refund what never reached Nansen. Over-counting only makes the
      // cap stricter; under-counting could overspend it.
      const refund = timedOut ? 0 : Math.max(0, READ_CREDITS - charged);
      counter.creditsToday = Math.max(0, counter.creditsToday - refund);
      counter.creditsTotal = Math.max(0, counter.creditsTotal - refund);
      // Round 20: a read that failed was not used; what it may have cost moves to the unused count.
      if (!ok) {
        const kept = READ_CREDITS - refund;
        counter.creditsToday = Math.max(0, counter.creditsToday - kept);
        counter.creditsTotal = Math.max(0, counter.creditsTotal - kept);
        counter.unusedToday += kept;
        counter.unusedTotal += kept;
      }
    }
  }

  return {
    ttlMs,
    policy: ROOM_LIVE_GUARD_POLICY,

    /** Round 17: the gate has run on this read, so its raw file may be listed and fetched. */
    release(file) { if (file) sealedRaw.delete(file); },
    /** True while a raw file is embargoed (no gate has run on it yet, and embargoMs has not passed). */
    isSealed(file) {
      const until = sealedRaw.get(file);
      if (until === undefined) return false;
      if (now().getTime() >= until) { sealedRaw.delete(file); return false; }
      return true;
    },

    /** True when a Hyperliquid pick would try a live read right now. */
    available: () => blocker() === null,

    /**
     * Another reader sharing these caps (the roster pulse, prototype/roster-pulse.js). It is
     * refused unless one round's full read still fits after it, so the front door can never
     * spend the credits a pick needs.
     */
    sharedBlocker: credits => blocker(credits + READ_CREDITS),
    /**
     * Reserve `credits` against the caps before the requests leave; `settle` then keeps what
     * was used, moves what a failed request may have been billed for to the unused count, and
     * refunds the rest.
     */
    reserve(credits) {
      charge(credits);
      let settled = false;
      return {
        settle({ used = 0, unused = 0 } = {}) {
          if (settled) return;
          settled = true;
          const refund = Math.max(0, credits - used - unused);
          counter.creditsToday = Math.max(0, counter.creditsToday - refund - unused);
          counter.creditsTotal = Math.max(0, counter.creditsTotal - refund - unused);
          counter.unusedToday += unused;
          counter.unusedTotal += unused;
          persist();
        },
      };
    },

    /**
     * The live read for one wallet: from the 30-minute cache, or two fresh summaries.
     * Always resolves. `{ live: false, code, reason }` means play the frozen capture.
     */
    async read(walletInput) {
      const wallet = String(walletInput ?? '').toLowerCase();
      const hit = cache.get(wallet);
      if (hit && now().getTime() - Date.parse(hit.fetchedAt) < ttlMs) return { ...hit, cached: true };
      const stop = blocker();
      if (stop) return { live: false, ...stop };
      if (inFlight.has(wallet)) return inFlight.get(wallet);
      const job = (async () => {
        try {
          let read;
          try { read = await fetchRead(wallet); } catch (err) {
            // Round 20: one retry after a timeout, if the caps still allow a read.
            const timeout = err?.code === 'timeout' || /timeout|timed out|aborted/i.test(String(err?.message));
            if (!timeout || blocker()) throw err;
            counter.retries += 1;
            log(`live read timed out wallet=${wallet.slice(0, 10)}; retrying once`);
            read = await fetchRead(wallet);
          }
          cache.set(wallet, read);
          counter.lastSuccessAt = new Date().toISOString();
          counter.lastFailure = null;
          counter.reads += 1;
          log(`live read ok wallet=${wallet.slice(0, 10)} fetched=${read.fetchedAt} credits_today=${counter.creditsToday}/${dailyCap} total=${counter.creditsTotal}/${totalCap}`);
          return { ...read, cached: false };
        } catch (err) {
          const code = err?.code === 'timeout' || /timeout|timed out|aborted/i.test(String(err?.message)) ? 'timeout'
            : err?.code === 'unusable' ? 'unusable' : err?.code === 'no_history' ? 'no_history' : 'provider_error';
          const reason = code === 'timeout' ? 'the live Nansen read timed out'
            : code === 'unusable' ? 'the live Nansen summary was incomplete'
              : code === 'no_history' ? 'Nansen has no closed Hyperliquid perp trade for this wallet in the last 30 days'
                : 'the live Nansen read failed';
          counter.lastFailure = { at: new Date().toISOString(), code, message: String(err?.message ?? err).slice(0, 200) };
          log(`live read failed wallet=${wallet.slice(0, 10)} code=${code} message=${counter.lastFailure.message}`);
          return { live: false, code, reason, raw: err?.raw ?? null };
        } finally {
          persist();
          inFlight.delete(wallet);
        }
      })();
      inFlight.set(wallet, job);
      return job;
    },

    status() {
      rollDay();
      const stop = blocker();
      return {
        enabled: !!enabled,
        key_present: !!keyPresent,
        available: stop === null,
        blocked_by: stop?.code ?? null,
        // What one round's read can cost, by outcome (gate v4). A round the 30-day record already
        // refuses skips perp-leaderboard; one the gate clears or caps buys it. Both are maxima: no
        // open position means no perp-screener read, and a fill page is only read when there are trades.
        credits_per_round: {
          refused: READ_CREDITS - (v4Reads ? creditCostFor(RECORD_ENDPOINT) : 0) - V5_CREDITS,
          full: READ_CREDITS,
          note: v4Reads
            ? `At most. refused: the 30-day record already refuses, perp-leaderboard and the owner read are not bought. full: the gate clears or caps, perp-leaderboard (5) is bought${V5_CREDITS ? `, and the owner read (gate v5, at most ${V5_CREDITS}: related-wallets on 2 chains, a funding transfer per chain only when the funder has indexed siblings, one perp-pnl-summary per sibling, at most ${MAX_SIBLINGS_READ})` : ''}. No open position: no perp-screener (1). A cached read costs 0.`
            : 'At most. A cached read costs 0.',
        },
        fill_pages_per_read: pages,
        // Credits of reads that succeeded and were used by a round.
        credits_today: counter.creditsToday,
        credits_total: counter.creditsTotal,
        // Credits a failed or timed-out read may have been billed for; not used by any round,
        // still counted against the caps.
        credits_unused_today: counter.unusedToday,
        credits_unused_total: counter.unusedTotal,
        retries_this_process: counter.retries,
        daily_cap: dailyCap,
        total_cap: totalCap,
        day_utc: counter.day,
        reads_this_process: counter.reads,
        last_live_success_at: counter.lastSuccessAt,
        last_live_failure: counter.lastFailure,
        cache_ttl_minutes: Math.round(ttlMs / 60_000),
        cached_wallets: [...cache.values()].map(r => ({ wallet: `${r.wallet.slice(0, 6)}...${r.wallet.slice(-4)}`, fetched_at: r.fetchedAt })),
        counter_persistence: stateFile ? 'file (lost if the host wipes its disk on restart)' : 'memory (resets on restart)',
      };
    },
  };
}

/**
 * The round's snapshot for a live read: the two live summaries and their windows over the
 * frozen capture's fill tape. The fills are not live and the snapshot says so, with the
 * capture's own dates, so no drawdown or trade figure is presented as part of the live read.
 */
/**
 * Judge 5: a live round is one read. The capture's own v4 and v5 answers (a frozen saved read
 * carries them) and its frozen_from pointer never ride along under live summaries; only what this
 * read bought is kept, so the owner row cannot mix a saved sibling read with a live own record.
 */
const withoutSavedReads = ({ v4_reads: _v4, v5_reads: _v5, frozen_from: _from, ...rest }) => rest;

export function liveSnapshot(capture, read) {
  const frozen = withoutSavedReads(capture);
  const liveFills = read.fills && !read.fills.error;
  const fills = [...(liveFills ? read.fills.rows : (frozen.trades_30d ?? []))].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  if (liveFills) {
    // Round 11: the fill tape is read live too. Its coverage is what the pages held.
    return {
      ...frozen,
      schema_version: frozen.schema_version ?? 1, source: 'live', fixture: false,
      wallet: String(frozen.wallet).toLowerCase(), retrieved_at: read.fetchedAt, windows: read.windows,
      pnl_summary_30d: read.summary30, pnl_summary_7d: read.summary7,
      trades_30d: fills,
      trades_pagination: { per_page: FILLS_PER_PAGE, pages_fetched: read.fills.pages, is_complete: read.fills.complete },
      fills_coverage: {
        complete: read.fills.complete, fills: fills.length, live: true,
        covers_from: read.fills.complete ? read.windows['30d'].from : (fills[0]?.timestamp ?? null),
        covers_to: fills[fills.length - 1]?.timestamp ?? null,
        covers_7d: read.fills.complete || (fills.length > 0 && Date.parse(fills[0].timestamp) <= Date.parse(read.windows['7d'].from)),
        from_capture: read.fetchedAt,
      },
      live_read: {
        fetched_at: read.fetchedAt, endpoint: read.endpoint, endpoints: [read.endpoint, FILLS_ENDPOINT, ...(read.positions ? [POSITIONS_ENDPOINT] : []),
          ...(read.v4?.smartMoneyRead ? [SMART_MONEY_ENDPOINT] : []), ...(read.v4?.recordRead ? [RECORD_ENDPOINT] : []),
          ...(read.v5?.operatorRead ? read.v5.endpoints.filter(e => e !== LIVE_ENDPOINT) : [])],
        credits: read.cached ? 0 : LIVE_READ_CREDITS + read.fills.pages + (read.positions ? 1 : 0) + (read.v4?.smartMoneyRead ? 1 : 0) + (read.v4?.recordRead ? 5 : 0) + (read.v5?.credits ?? 0), cached: !!read.cached,
        fills_live: true, fills_from_capture: null,
      },
      reconciliation: { skipped: 'live fills are the newest pages only; not reconciled against the summary' },
      ...openPositionsOf(read),
      ...(read.v4 ? { v4_reads: read.v4 } : {}),
      ...(read.v5 ? { v5_reads: read.v5 } : {}),
    };
  }
  return {
    ...frozen,
    schema_version: frozen.schema_version ?? 1,
    source: 'live',
    fixture: false,
    wallet: String(frozen.wallet).toLowerCase(),
    retrieved_at: read.fetchedAt,
    windows: read.windows,
    pnl_summary_30d: read.summary30,
    pnl_summary_7d: read.summary7,
    trades_30d: fills,
    trades_pagination: { ...(frozen.trades_pagination ?? {}), is_complete: false },
    fills_coverage: {
      complete: false,
      fills: fills.length,
      covers_from: fills[0]?.timestamp ?? null,
      covers_to: fills[fills.length - 1]?.timestamp ?? null,
      covers_7d: false,
      from_capture: frozen.retrieved_at,
    },
    live_read: {
      fetched_at: read.fetchedAt,
      endpoint: read.endpoint,
      credits: read.cached ? 0 : LIVE_READ_CREDITS + (read.positions ? 1 : 0) + (read.v4?.smartMoneyRead ? 1 : 0) + (read.v4?.recordRead ? 5 : 0) + (read.v5?.credits ?? 0),
      cached: !!read.cached,
      fills_from_capture: frozen.retrieved_at,
    },
    reconciliation: { skipped: 'live summaries over a frozen fill tape are not reconciled' },
    ...openPositionsOf(read),
    ...(read.v4 ? { v4_reads: read.v4 } : {}),
    ...(read.v5 ? { v5_reads: read.v5 } : {}),
  };
}

/**
 * Round 17: the live open positions replace the capture's, so the gate's open-book check and
 * the account value the fill rows are measured against come from this read. A failed read
 * says so; the capture's old positions are never passed off as current.
 */
function openPositionsOf(read) {
  if (!read.positions) return {};
  if (read.positions.error) return { open_positions: { skipped: `live positions read failed: ${read.positions.error}` } };
  return { open_positions: { ...read.positions, live: true, fetched_at: read.fetchedAt } };
}
