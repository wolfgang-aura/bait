/**
 * Minimal Nansen API client for the BAIT validation spike.
 *
 * Responsibilities:
 *  - load NANSEN_API_KEY from ../.env without ever printing it
 *  - enforce free-tier rate limits (15 req/s, 300 req/min) plus per-endpoint caps
 *  - append every call to validation/call_ledger.jsonl (endpoint, status, credits, headers)
 *  - refuse to exceed the hard credit budget for this spike
 *
 * Docs consulted (2026-09-15):
 *  https://docs.nansen.ai/getting-started/authentication.md  -> base URL + `apikey` header
 *  https://docs.nansen.ai/getting-started/credits.md         -> per-endpoint credit tiers
 *  https://docs.nansen.ai/getting-started/rate-limits.md     -> limits + rate-limit headers
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');
const LEDGER_PATH = path.join(HERE, 'call_ledger.jsonl');

export const BASE_URL = 'https://api.nansen.ai/api/v1';
/**
 * Spike budget history: Phase 1/2 was 70 (used 25), Phase 3 raised it to 82.
 * The buildathon entry needs a live data path and 1,000+ logged calls, so the local
 * ceiling is now 1049. The final 21-credit extension was explicitly authorized by
 * the ten-wallet navigator: three Hyperliquid discovery calls and six independent
 * 30-day PnL confirmations. The second losing discovery was necessary because total
 * PnL and realised PnL disagreed for one candidate. A final 3-credit extension to 1052
 * was authorized on 21 September for the live guard path (`validation/guard-live.js`):
 * one end-to-end check against the losing encounter wallet, one against a wallet the
 * navigator marks allow, and one spare. The local ceiling is the weaker
 * of the two guards: the real
 * stop is `accountCreditsRemaining()`, refreshed from the free `account` endpoint, so
 * the key can never be overspent even if this constant is wrong.
 */
// Raised from 1,100 to 19,000 on 23 Sep 2026: the owner authorized it after buying 20,000
// Nansen credits. The account balance check below stays the real stop.
export const CREDIT_BUDGET = 19000;

/** First ledger timestamp that counts toward the buildathon's 1,000-call requirement. */
export const QUOTA_WINDOW_START = '2026-09-14T00:00:00Z';

/** Credit cost per path, from docs.nansen.ai/getting-started/credits.md. */
const CREDIT_COSTS = {
  'account': 0,
  'search/general': 0,
  'search/entity-name': 0,
  'profiler/perp-pnl-summary': 1,
  'profiler/perp-trades': 1,
  'profiler/perp-positions': 1,
  'tgm/flow-intelligence': 1,
  'tgm/token-information': 1,
  'tgm/holders': 5,
  'perp-leaderboard': 5,
  // Gate v4 (bench/V4.md): smart money's positions in one market. Verified 1 credit, 23 Sep 2026.
  'perp-screener': 1,
  // Wallet identity and history (docs.nansen.ai credits table, 25 Sep 2026).
  'profiler/address/related-wallets': 1,
  'profiler/address/transactions': 1,
  'profiler/address/current-balance': 1,
  'profiler/address/historical-balances': 1,
  'profiler/address/pnl-summary': 1,
  'profiler/address/counterparties': 5,
  'smart-money/perp-trades': 5,
  'tgm/perp-positions': 5,
};

/** Endpoints with a stricter cap than the global 300/min. */
const ENDPOINT_RPM = {
  'profiler/perp-trades': 5,
  'tgm/perp-trades': 60,
  'search/web-search': 15,
  'search/web-fetch': 15,
};

/** Endpoints this spike must never touch (credit bombs). */
const FORBIDDEN = [
  'profiler/address/labels',
  'profiler/address/premium-labels',
  'agent/fast',
  'agent/expert',
];

// ---------------------------------------------------------------- env loading

/** Parse a .env file into an object. Never logs values. */
export function loadEnv(envPath = path.join(REPO_ROOT, '.env')) {
  const out = {};
  if (!fs.existsSync(envPath)) return out;
  for (const rawLine of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const ENV = loadEnv();
const API_KEY = process.env.NANSEN_API_KEY || ENV.NANSEN_API_KEY || '';

/** Safe, non-secret description of the key so we can prove it loaded. */
export function keyFingerprint() {
  if (!API_KEY) return { present: false };
  return {
    present: true,
    length: API_KEY.length,
    // last 4 chars only, enough to distinguish two keys without leaking one
    suffix: API_KEY.slice(-4),
  };
}

// ------------------------------------------------------------- rate limiting

const secondWindow = [];
const minuteWindow = [];
const endpointWindows = new Map();

/**
 * Seed the limiter from the ledger.
 *
 * The windows used to live only in memory, so running three freeze scripts back to
 * back sailed past the 5-per-minute cap on profiler/perp-trades and earned a 429.
 * The ledger already records the timestamp of every call, so replaying the last
 * minute of it makes the limits hold across separate processes.
 */
const LINE_BREAK = /\r?\n/;

function seedWindowsFromLedger() {
  if (!fs.existsSync(LEDGER_PATH)) return;
  const now = Date.now();
  let lines;
  try {
    lines = fs.readFileSync(LEDGER_PATH, 'utf8').split(LINE_BREAK).slice(-400);
  } catch {
    return;
  }
  for (const line of lines) {
    if (!line.trim()) continue;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    const t = Date.parse(rec.ts);
    if (!Number.isFinite(t) || now - t >= 60_000) continue;
    minuteWindow.push(t);
    if (now - t < 1000) secondWindow.push(t);
    if (ENDPOINT_RPM[rec.path]) {
      if (!endpointWindows.has(rec.path)) endpointWindows.set(rec.path, []);
      endpointWindows.get(rec.path).push(t);
    }
  }
  minuteWindow.sort((a, b) => a - b);
  secondWindow.sort((a, b) => a - b);
  for (const w of endpointWindows.values()) w.sort((a, b) => a - b);
}
seedWindowsFromLedger();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function prune(arr, windowMs, now) {
  while (arr.length && now - arr[0] >= windowMs) arr.shift();
}

async function waitForSlot(pathName) {
  for (;;) {
    const now = Date.now();
    prune(secondWindow, 1000, now);
    prune(minuteWindow, 60_000, now);

    let waitMs = 0;
    if (secondWindow.length >= 15) waitMs = Math.max(waitMs, 1000 - (now - secondWindow[0]) + 25);
    if (minuteWindow.length >= 300) waitMs = Math.max(waitMs, 60_000 - (now - minuteWindow[0]) + 25);

    const rpm = ENDPOINT_RPM[pathName];
    if (rpm) {
      let w = endpointWindows.get(pathName);
      if (!w) endpointWindows.set(pathName, (w = []));
      prune(w, 60_000, now);
      if (w.length >= rpm) waitMs = Math.max(waitMs, 60_000 - (now - w[0]) + 250);
    }

    if (waitMs <= 0) {
      const stamp = Date.now();
      secondWindow.push(stamp);
      minuteWindow.push(stamp);
      if (rpm) endpointWindows.get(pathName).push(stamp);
      return;
    }
    process.stdout.write(`  [rate-limit] waiting ${Math.ceil(waitMs / 1000)}s for ${pathName}...\n`);
    await sleep(Math.min(waitMs, 65_000));
  }
}

// -------------------------------------------------------------- credit ledger

/** Sum credits already recorded in the ledger file (survives across scripts). */
export function creditsUsed() {
  if (!fs.existsSync(LEDGER_PATH)) return 0;
  let total = 0;
  for (const line of fs.readFileSync(LEDGER_PATH, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line);
      total += rec.credits_charged || 0;
    } catch {
      /* ignore malformed line */
    }
  }
  return total;
}

/**
 * Read the ledger once and report what the buildathon cares about: how many calls
 * this key has logged since the campaign opened, and when one last succeeded.
 */
export function ledgerStats(since = QUOTA_WINDOW_START) {
  const cut = Date.parse(since);
  const out = {
    since,
    total_calls: 0,
    calls_since: 0,
    successful_calls_since: 0,
    billable_calls_since: 0,
    credits_used_since: 0,
    credits_used_total: 0,
    last_success_at: null,
    last_call_at: null,
  };
  if (!fs.existsSync(LEDGER_PATH)) return out;
  for (const line of fs.readFileSync(LEDGER_PATH, 'utf8').split(LINE_BREAK)) {
    if (!line.trim()) continue;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    out.total_calls += 1;
    out.credits_used_total += rec.credits_charged || 0;
    const t = Date.parse(rec.ts);
    if (!Number.isFinite(t)) continue;
    if (!out.last_call_at || t > Date.parse(out.last_call_at)) out.last_call_at = rec.ts;
    if (rec.status >= 200 && rec.status < 300) {
      if (!out.last_success_at || t > Date.parse(out.last_success_at)) out.last_success_at = rec.ts;
    }
    if (t >= cut) {
      out.calls_since += 1;
      if (rec.status >= 200 && rec.status < 300) out.successful_calls_since += 1;
      if ((rec.credits_charged || 0) > 0) out.billable_calls_since += 1;
      out.credits_used_since += rec.credits_charged || 0;
    }
  }
  return out;
}

// -------------------------------------------------------- account credit guard

/**
 * Nansen's own view of the balance. Any response that carries `credits_remaining`
 * updates it; the free `account` endpoint is the cheapest way to seed it. While it is
 * known, `call()` refuses anything that would take it below zero, so a wrong local
 * CREDIT_BUDGET can never overspend the key.
 */
let accountRemaining = null;
let accountCheckedAt = null;

export function accountCreditsRemaining() {
  return accountRemaining === null ? null : { credits_remaining: accountRemaining, checked_at: accountCheckedAt };
}

/** Call the 0-credit account endpoint and seed the guard. Returns the account body. */
export async function refreshAccountBalance({ timeoutMs = 20_000, note = 'credit guard' } = {}) {
  const res = await call('account', null, { note, timeoutMs });
  return res.data;
}

function noteRemaining(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return;
  accountRemaining = value;
  accountCheckedAt = new Date().toISOString();
}

function appendLedger(record) {
  fs.appendFileSync(LEDGER_PATH, JSON.stringify(record) + '\n', 'utf8');
}

/** Headers worth keeping: rate-limit + anything mentioning credits. Never auth. */
function interestingHeaders(headers) {
  const out = {};
  for (const [k, v] of headers.entries()) {
    const lk = k.toLowerCase();
    if (lk.includes('ratelimit') || lk.includes('credit') || lk === 'retry-after') {
      out[k] = v;
    }
  }
  return out;
}

export function creditCostFor(pathName) {
  if (pathName in CREDIT_COSTS) return CREDIT_COSTS[pathName];
  throw new Error(`No known credit cost for "${pathName}". Check the docs and add it to CREDIT_COSTS.`);
}

// ------------------------------------------------------------------ the call

export class BudgetExceeded extends Error {}

/**
 * Make one authenticated Nansen call.
 * @param {string} pathName   path after /api/v1/, e.g. "profiler/perp-pnl-summary"
 * @param {object|null} body  JSON body (null => GET)
 * @param {object} opts       { method, note, timeoutMs, creditCost }
 */
export async function call(pathName, body = null, opts = {}) {
  if (!API_KEY) throw new Error('NANSEN_API_KEY missing from .env');
  if (FORBIDDEN.includes(pathName)) {
    throw new Error(`Refusing to call "${pathName}" - forbidden in this spike (credit bomb).`);
  }

  const method = opts.method || (body ? 'POST' : 'GET');
  const cost = opts.creditCost ?? creditCostFor(pathName);
  const before = creditsUsed();
  if (before + cost > CREDIT_BUDGET) {
    throw new BudgetExceeded(
      `Budget stop: ${before} credits used, "${pathName}" costs ${cost}, cap is ${CREDIT_BUDGET}.`
    );
  }
  // The account balance is the authoritative stop. It is only consulted when known,
  // so a script that never called `account` still gets the local cap above.
  if (accountRemaining !== null && cost > accountRemaining) {
    throw new BudgetExceeded(
      `Balance stop: Nansen reports ${accountRemaining} credits remaining (checked ${accountCheckedAt}); ` +
        `"${pathName}" costs ${cost}.`
    );
  }

  await waitForSlot(pathName);

  const url = `${BASE_URL}/${pathName}`;
  const started = Date.now();
  let status = 0;
  let headersOut = {};
  let json = null;
  let errorText = null;

  try {
    const res = await fetch(url, {
      method,
      headers: {
        apikey: API_KEY,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 45_000),
    });
    status = res.status;
    headersOut = interestingHeaders(res.headers);
    const text = await res.text();
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      errorText = text.slice(0, 500);
    }
    if (!res.ok && !errorText) errorText = JSON.stringify(json).slice(0, 500);
  } catch (err) {
    errorText = `${err.name}: ${err.message}`;
  }

  // The API reports the true cost in `x-nansen-credits-cost`; trust it over our table.
  // A request that never reached the API (network/timeout) is not charged.
  // Trust the API's own cost header. With no header, a 2xx is assumed to have cost
  // the documented amount and an error response is assumed free: a 429 is refused
  // before any work happens, so charging our table's 1 credit for it overstates spend.
  const reported = headersOut['x-nansen-credits-cost'];
  const charged =
    status === 0
      ? 0
      : reported !== undefined && reported !== ''
        ? Number(reported)
        : status >= 400
          ? 0
          : cost;

  // Nansen's own view of the balance, when the endpoint reports it.
  const remaining =
    json && typeof json === 'object' && typeof json.credits_remaining === 'number'
      ? json.credits_remaining
      : null;
  if (remaining !== null) noteRemaining(remaining);
  else if (accountRemaining !== null && charged) noteRemaining(accountRemaining - charged);

  appendLedger({
    ts: new Date().toISOString(),
    path: pathName,
    method,
    status,
    credits_charged: charged,
    credits_cost_header: reported ?? null,
    credits_remaining_reported: remaining,
    estimated_cost: cost,
    duration_ms: Date.now() - started,
    request_body: body,
    rate_limit_headers: headersOut,
    note: opts.note || null,
    error: errorText,
  });

  const after = before + charged;
  process.stdout.write(
    `  [nansen] ${method} ${pathName} -> ${status || 'NETWORK-FAIL'} ` +
      `(+${charged} cr, total ${after}/${CREDIT_BUDGET}` +
      `${accountRemaining === null ? '' : `, balance ${accountRemaining}`})\n`
  );

  if (status === 0) throw new Error(`Request failed: ${errorText}`);
  if (status >= 400) {
    const e = new Error(`Nansen ${status} on ${pathName}: ${errorText}`);
    e.status = status;
    e.body = json;
    throw e;
  }
  return { status, headers: headersOut, data: json };
}

export const LEDGER_FILE = LEDGER_PATH;
