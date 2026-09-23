/**
 * BAIT's execution gate for AI-proposed wallet allocations.
 *
 * The model proposes an amount. This module independently reads authoritative Nansen
 * results and either preserves that amount or forces it to zero. It fails closed when
 * the request or evidence is invalid, mismatched, stale, unavailable, or below a
 * policy threshold.
 *
 * Two policies ship.
 *
 * `wallet-realized-pnl-30d-v1` is one `profiler/perp-pnl-summary` call and one sign
 * test on 30-day realised PnL. It is kept, by id, because the earlier recorded
 * single-wallet benchmark rows are tied to exactly that rule.
 *
 * `wallet-copy-risk-v2` is the default. It reads the 7-day AND the 30-day summary and
 * runs a named check per refusal, so a block says which number failed which bar. The
 * second window is not decoration: across 840 saved summaries the 7-day and 30-day
 * verdicts disagreed on 103 of 420 matched wallet-date pairs, 25%
 * (`bench/reports/robustness-panel.md`). A gate that reads one window is, by that
 * measurement, reading the wrong window a quarter of the time.
 *
 * v2 also judges top-coin concentration from the same 30-day summary's `top5_coins`,
 * at no extra call: a positive month whose best market made more than the whole month
 * is refused, because the rest of the book lost money (`gateMaxTopCoinPnlShare`).
 *
 * `wallet-copy-risk-v3` (default since 23 Sep 2026) keeps every v2 refusal but turns the
 * concentration check from a refusal into a size cap: a profitable month carried by one
 * market is real money made, so the gate lets a quarter of the request through and holds
 * the rest. Under v2 that check refused 3 of 18 funding decisions on profitable control
 * wallets (bench/reports/2026-09-23T00-47-45-126Z-wallets.md).
 *
 * v1 and v2 never emit a size of their own: the caller's amount or $0. v3 adds exactly
 * one: `concentrationCapShare` of the caller's amount when the concentration check caps.
 */

export const GUARD_WINDOW_DAYS = 30;
export const GUARD_SHORT_WINDOW_DAYS = 7;
export const GUARD_SOURCE = 'Nansen /api/v1/profiler/perp-pnl-summary';
export const DEFAULT_GUARD_TIMEOUT_MS = 10_000;

/** The measured reason the short window is read at all. Quoted in the refusal line. */
export const REGIME_DISAGREEMENT_RATE = '25%';

/**
 * Thresholds shared by the gate and by the game's copy-risk report. One table, so a
 * wallet the report calls thin is a wallet the gate refuses for the same reason at the
 * same number.
 */
export const COPY_RISK_THRESHOLDS = Object.freeze({
  paperShareOfHeadline: 0.8,
  paperShareOfTotal: 0.8,
  minClosedTrades: 20,
  minWinRate: 0.4,
  maxEarlyEntryShare: 0.2,
  maxTopPositionShare: 0.5,
  maxTopCoinPnlShare: 0.6,
  maxTailLossShare: 0.25,
  maxDrawdownShareOfPeak: 0.3,
  maxDrawdownShareOfAccount: 0.15,
  // The gate's bar for the same per-coin evidence, deliberately looser than the report's
  // 60% caution. Above 100%, the wallet's best market earned more than the whole month,
  // so everything else it traded lost money: one market rescued a losing book. That is a
  // refusal. Between 60% and 100% the report cautions and the gate lets it through,
  // because a trader who makes most of a month on BTC or HYPE is common and is not, by
  // itself, a losing strategy. Tuned once, from 0.6, on 23 Sep 2026: at 0.6 the gate
  // blocked 5 of the 6 profitable control wallets (15 of 18 funding decisions,
  // bench/reports/2026-09-23T00-47-45-126Z-wallets.md), which
  // is a gate nobody would keep switched on.
  gateMaxTopCoinPnlShare: 1.0,
});

export const PRODUCTION_GUARD_POLICY_V1 = Object.freeze({
  id: 'wallet-realized-pnl-30d-v1',
  version: 'v1',
  windowDays: GUARD_WINDOW_DAYS,
  shortWindowDays: null,
  minimumRealizedPnlUsd: 0,
  maxEvidenceAgeMs: 15 * 60 * 1000,
  maxFutureSkewMs: 5 * 60 * 1000,
  source: GUARD_SOURCE,
});

export const PRODUCTION_GUARD_POLICY_V2 = Object.freeze({
  id: 'wallet-copy-risk-v2',
  version: 'v2',
  windowDays: GUARD_WINDOW_DAYS,
  shortWindowDays: GUARD_SHORT_WINDOW_DAYS,
  minimumRealizedPnlUsd: 0,
  maxEvidenceAgeMs: 15 * 60 * 1000,
  maxFutureSkewMs: 5 * 60 * 1000,
  source: GUARD_SOURCE,
  minClosedTrades: COPY_RISK_THRESHOLDS.minClosedTrades,
  minWinRate: COPY_RISK_THRESHOLDS.minWinRate,
  maxPaperShareOfHeadline: COPY_RISK_THRESHOLDS.paperShareOfHeadline,
  // A week that moves against the month only counts as a regime change when it is
  // material: at least this share of the 30-day figure. Below it, the sign flip is
  // noise, and a gate that blocks on noise gets switched off.
  maxShortWindowGivebackShare: 0.10,
  // Share of the 30-day realised PnL carried by the single best market in the same
  // 30-day summary's top5_coins. Null switches the check off (not_assessed).
  maxTopCoinPnlShare: COPY_RISK_THRESHOLDS.gateMaxTopCoinPnlShare,
});

/**
 * v3: v2's checks and bars, with the concentration check capping instead of refusing.
 * The cap is a quarter of the request, the same fraction the game's copy-risk caution used
 * for its wire since 22 Sep: enough to follow a trader whose month is real, small enough
 * that one market going the other way costs a quarter, not the whole request.
 */
export const PRODUCTION_GUARD_POLICY_V3 = Object.freeze({
  ...PRODUCTION_GUARD_POLICY_V2,
  id: 'wallet-copy-risk-v3',
  version: 'v3',
  // Revision 2, 23 Sep 2026: the gate checks the dates a summary covers, not only its
  // `window_days` label. Our own bench (bench/gate-buys.js, case "relabelled-window")
  // served the 7-day numbers labelled window_days: 30, and revision 1 funded the full
  // request. A summary must now carry its date range (`window`, or the request's own
  // `date`), the range must span the policy's days, and a `data_coverage` note saying
  // fewer days were retained is a refusal. A summary with no dates is a refusal too.
  revision: 2,
  revisionNotes: '2026-09-23 r2: evidence window verified from its dates (window_dates_mismatch), not only its window_days label.',
  verifyWindowDates: true,
  concentrationAction: 'cap',
  concentrationCapShare: 0.25,
});

/** The default gate. v1 and v2 stay reachable by name. */
export const PRODUCTION_GUARD_POLICY = PRODUCTION_GUARD_POLICY_V3;

export const BENCHMARK_GUARD_POLICY = Object.freeze({
  ...PRODUCTION_GUARD_POLICY_V1,
  id: 'wallet-realized-pnl-30d-benchmark-v1',
  maxEvidenceAgeMs: null,
});

export const BENCHMARK_GUARD_POLICY_V2 = Object.freeze({
  ...PRODUCTION_GUARD_POLICY_V2,
  id: 'wallet-copy-risk-benchmark-v2',
  maxEvidenceAgeMs: null,
});

export const BENCHMARK_GUARD_POLICY_V3 = Object.freeze({
  ...PRODUCTION_GUARD_POLICY_V3,
  id: 'wallet-copy-risk-benchmark-v3',
  maxEvidenceAgeMs: null,
});

const POLICY_BASES = { v1: PRODUCTION_GUARD_POLICY_V1, v2: PRODUCTION_GUARD_POLICY_V2, v3: PRODUCTION_GUARD_POLICY_V3 };

const finite = value => typeof value === 'number' && Number.isFinite(value);
const walletPattern = /^0x[a-fA-F0-9]{40}$/;
const safeError = error => error instanceof Error ? error.message : String(error);

async function within(promise, ms) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Merge a caller policy onto its own family's base. A policy declares its family with
 * `version`; without one it inherits the current default, which is v2. This is what
 * keeps `BENCHMARK_GUARD_POLICY` a one-window rule after the default moved: it carries
 * `version: 'v1'`, so no v2 field can leak into the recorded benchmark row.
 */
function normalizePolicy(policy) {
  const base = POLICY_BASES[policy?.version] ?? PRODUCTION_GUARD_POLICY;
  const merged = { ...base, ...policy };
  if (!merged.id || !Number.isInteger(merged.windowDays) || merged.windowDays < 1) {
    throw new TypeError('Guard policy needs an id and a positive integer windowDays');
  }
  if (!finite(merged.minimumRealizedPnlUsd)) {
    throw new TypeError('Guard policy minimumRealizedPnlUsd must be finite');
  }
  if (merged.maxEvidenceAgeMs !== null && (!finite(merged.maxEvidenceAgeMs) || merged.maxEvidenceAgeMs < 0)) {
    throw new TypeError('Guard policy maxEvidenceAgeMs must be null or a non-negative number');
  }
  if (!finite(merged.maxFutureSkewMs) || merged.maxFutureSkewMs < 0 || typeof merged.source !== 'string') {
    throw new TypeError('Guard policy source and maxFutureSkewMs are invalid');
  }
  if (merged.version === 'v3' && (!finite(merged.concentrationCapShare) || merged.concentrationCapShare <= 0 || merged.concentrationCapShare >= 1)) {
    throw new TypeError('Guard policy concentrationCapShare must be between 0 and 1');
  }
  if (merged.version === 'v2' || merged.version === 'v3') {
    if (!Number.isInteger(merged.shortWindowDays) || merged.shortWindowDays < 1 || merged.shortWindowDays >= merged.windowDays) {
      throw new TypeError('Guard policy shortWindowDays must be a positive integer shorter than windowDays');
    }
    for (const key of ['minClosedTrades', 'minWinRate', 'maxPaperShareOfHeadline']) {
      if (!finite(merged[key]) || merged[key] < 0) throw new TypeError(`Guard policy ${key} must be a non-negative number`);
    }
    if (merged.maxTopCoinPnlShare !== null && (!finite(merged.maxTopCoinPnlShare) || merged.maxTopCoinPnlShare <= 0)) {
      throw new TypeError('Guard policy maxTopCoinPnlShare must be null or a positive number');
    }
  }
  return merged;
}

// ------------------------------------------------------------- the check table

/**
 * Every check the gate can run, in the order it runs them, on every decision. A block
 * names the first row that failed. A row it could not look at says `not_assessed` with
 * the reason, so nobody reads a silent field as a green light.
 */
export const V2_CHECK_IDS = Object.freeze([
  'evidence_30d',
  'evidence_freshness',
  'evidence_7d',
  'realised_pnl_30d',
  'regime_agreement',
  'thin_sample',
  'low_win_rate',
  'paper_headline',
  'concentration',
  'tail_loss',
  'max_drawdown',
]);

/** Checks the guard's own evidence path cannot reach: they need per-fill history. */
const FILL_ONLY_CHECKS = {
  tail_loss: 'Not assessed. The worst single closed trade needs the individual trade fills, which this gate does not fetch. The copy-risk report covers it.',
  max_drawdown: 'Not assessed. Peak-to-trough drawdown needs the time-ordered trade fills, which this gate does not fetch. The copy-risk report covers it.',
};

/** Collect check rows in evaluation order and emit them in the canonical order. */
function checkTable() {
  const rows = new Map();
  return {
    set(id, result, value, threshold, plain) {
      rows.set(id, { id, result, value, threshold, plain });
    },
    pass(id, value, threshold, plain) { this.set(id, 'pass', value, threshold, plain); },
    fail(id, value, threshold, plain) { this.set(id, 'fail', value, threshold, plain); },
    skip(id, plain, value = null, threshold = null) { this.set(id, 'not_assessed', value, threshold, plain); },
    /** The first failing row, which is the one the public reason is allowed to name. */
    firstFailure() {
      for (const id of V2_CHECK_IDS) if (rows.get(id)?.result === 'fail') return rows.get(id);
      return null;
    },
    finish(fallback = 'Not assessed. An earlier check already decided this request.') {
      return V2_CHECK_IDS.map(id => rows.get(id) ?? { id, result: 'not_assessed', value: null, threshold: null, plain: fallback });
    },
  };
}

function emptyEvidence(policy) {
  return {
    wallet: null,
    window_days: policy.windowDays,
    realized_pnl_usd: null,
    realized_pnl_30d_usd: null,
    realized_pnl_7d_usd: null,
    closed_trade_count_30d: null,
    win_rate_30d: null,
    retrieved_at: null,
    short_window_days: policy.shortWindowDays ?? null,
    short_window_retrieved_at: null,
    source: policy.source,
  };
}

function result({ attempted, policy, evidence, code, reason, diagnostic = null, checks = [], cappedTo = null }) {
  const allowed = code === 'allowed' || code === 'capped';
  const allocation = code === 'capped' ? cappedTo : allowed ? attempted : 0;
  return {
    decision: allowed ? 'allow' : 'block',
    code,
    capped: code === 'capped',
    held: Math.max(0, attempted - allocation),
    // Never a size of its own: the caller's amount, or nothing. Issue #7 removed
    // implied calibrated sizing on purpose, and it is not coming back through here.
    allocation,
    attempted,
    blocked: !allowed && attempted > 0,
    execution_authorized: allowed,
    reason,
    diagnostic,
    checks,
    policy: {
      id: policy.id,
      version: policy.version ?? 'v1',
      revision: policy.revision ?? null,
      window_days: policy.windowDays,
      short_window_days: policy.shortWindowDays ?? null,
      minimum_realized_pnl_usd: policy.minimumRealizedPnlUsd,
      max_evidence_age_ms: policy.maxEvidenceAgeMs,
    },
    evidence,
  };
}

/** Sign test used by the regime check. Zero counts as non-negative, same as the gate. */
const signOf = n => (n < 0 ? 'negative' : 'non-negative');
const money = n => `${n < 0 ? '-' : '+'}$${Math.round(Math.abs(n)).toLocaleString('en-US')}`;
const pct = n => `${(n * 100).toFixed(1)}%`;

/** Slack on a window's span. A request built as "now minus N days" is exact to the ms. */
const WINDOW_SPAN_SLACK_MS = 60 * 60 * 1000;

/**
 * The dates a summary covers, checked against the days the policy asked for. The label
 * (`window_days`) is what the path says; the range is what it served. Reads `window`
 * (what the desk serves) or `date` (the live request's own params). Null when they agree.
 */
function windowDatesProblem(raw, days) {
  const range = raw?.window ?? raw?.date ?? null;
  const from = Date.parse(range?.from ?? '');
  const to = Date.parse(range?.to ?? '');
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    return { value: null, plain: `The summary is labelled ${days} days but carries no date range, so what it covers cannot be checked.` };
  }
  const span = to - from;
  const spanDays = Math.round((span / 86_400_000) * 10) / 10;
  const shown = `${String(range.from).slice(0, 10)} to ${String(range.to).slice(0, 10)}`;
  if (Math.abs(span - days * 86_400_000) > WINDOW_SPAN_SLACK_MS) {
    return { value: `${spanDays}d (${shown})`, plain: `The summary is labelled ${days} days, but its dates run ${shown}: ${spanDays} days.` };
  }
  const cov = raw?.data_coverage;
  if (cov && (cov.complete === false || (Number.isFinite(cov.retained_days) && cov.retained_days < days))) {
    return { value: `${cov.retained_days ?? '?'}d retained`, plain: `The summary is labelled ${days} days, but its own coverage note says only ${cov.retained_days ?? 'part of the window'} days were retained.` };
  }
  return null;
}

/**
 * Top-coin concentration, from evidence the gate already holds: the 30-day
 * perp-pnl-summary's own top-five markets by realised PnL (`top5_coins`, served by the
 * frozen desk executor as `top5_coins_by_pnl`). No extra call and no fill tape.
 *
 * share = best market's 30-day realised PnL / the wallet's 30-day realised PnL.
 * Judged only when the month made money; a losing month is already refused on its sign.
 * Above the bar, the rest of the book lost what the one market made, so the positive
 * month is one market's result, not the trader's.
 */
function concentrationCheck(t, policy, pnl30, raw) {
  const bar = policy.maxTopCoinPnlShare;
  const barText = bar === null ? null : `best market at most ${Math.round(bar * 100)}% of the ${policy.windowDays}-day realised PnL`;
  if (bar === null) {
    t.skip('concentration', `Not assessed. Policy ${policy.id} does not judge per-market concentration.`);
    return;
  }
  const coins = Array.isArray(raw?.top5_coins_by_pnl) ? raw.top5_coins_by_pnl
    : Array.isArray(raw?.top5_coins) ? raw.top5_coins : null;
  const listed = (coins ?? []).filter(c => c && typeof c.coin === 'string' && finite(c.realized_pnl_usd));
  if (!listed.length) {
    t.skip('concentration', 'Not assessed. The 30-day summary carried no per-market breakdown.', null, bar);
    return;
  }
  if (!(pnl30 > 0)) {
    t.skip('concentration', `Not assessed. The ${policy.windowDays}-day result is not a profit, so no profit can be concentrated in one market.`, null, bar);
    return;
  }
  const best = listed.reduce((a, c) => (c.realized_pnl_usd > a.realized_pnl_usd ? c : a));
  const share = Math.max(0, best.realized_pnl_usd) / pnl30;
  const value = `${best.coin} ${money(best.realized_pnl_usd)} of ${money(pnl30)}`;
  // Compared in dollars with a one-cent tolerance: the summary total arrives rounded to
  // cents and the per-market figures do not, so a one-market book would otherwise read
  // as 100.0000001% and fail a 100% bar on rounding alone.
  if (best.realized_pnl_usd - bar * pnl30 > 0.01) {
    const rest = pnl30 - best.realized_pnl_usd;
    const said = `${best.coin} alone made ${money(best.realized_pnl_usd)}, ${pct(share)} of the ${policy.windowDays}-day ${money(pnl30)}. `
      + `Everything else it traded came to ${money(rest)}, so one market carried a book that otherwise lost money.`;
    if (policy.concentrationAction === 'cap') {
      t.set('concentration', 'cap', value, barText,
        `${said} The month is real, so the gate sends ${Math.round(policy.concentrationCapShare * 100)}% of the request and holds the rest.`);
    } else {
      t.fail('concentration', value, barText, said);
    }
  } else {
    t.pass('concentration', value, barText,
      `The best market, ${best.coin}, made ${pct(share)} of the ${policy.windowDays}-day result, so the profit does not rest on one market alone.`);
  }
}

/**
 * @param {{
 *   executor: { execute(name: string, input: object): Promise<object> },
 *   wallet: string,
 *   allocation: number,
 *   policy?: object,
 *   timeoutMs?: number,
 *   now?: () => Date,
 * }} input
 */
export async function guardAllocation({
  executor,
  wallet,
  allocation,
  policy: policyInput,
  timeoutMs = DEFAULT_GUARD_TIMEOUT_MS,
  now = () => new Date(),
} = {}) {
  const policy = normalizePolicy(policyInput);
  const twoWindow = policy.version === 'v2' || policy.version === 'v3';
  const attempted = finite(allocation) && allocation > 0 ? allocation : 0;
  const blank = emptyEvidence(policy);
  const t = checkTable();

  const stop = (code, reason, evidence = blank, diagnostic = null) =>
    result({ attempted, policy, evidence, code, reason, diagnostic, checks: t.finish() });

  // ------------------------------------------------------- the request itself
  if (!walletPattern.test(String(wallet ?? ''))) {
    return stop('invalid_request', 'blocked: wallet must be a 0x-prefixed 20-byte address');
  }
  if (!finite(allocation) || allocation < 0) {
    return result({ attempted: 0, policy, evidence: blank, code: 'invalid_request', reason: 'blocked: allocation must be a non-negative finite number', checks: t.finish() });
  }
  if (!executor || typeof executor.execute !== 'function') {
    return stop('invalid_request', 'blocked: evidence executor is unavailable');
  }
  if (!finite(timeoutMs) || timeoutMs <= 0) {
    return stop('invalid_request', 'blocked: timeoutMs must be positive');
  }

  /** One summary fetch. A throw or a hang is unusable evidence, never a number. */
  const fetchSummary = async days => {
    try {
      return { raw: await within(Promise.resolve(executor.execute('get_pnl_summary', { wallet, days })), timeoutMs) };
    } catch (error) {
      const timedOut = /timed out/.test(safeError(error));
      return {
        failure: {
          code: timedOut ? 'evidence_timeout' : 'evidence_unavailable',
          reason: timedOut ? 'blocked: evidence check timed out' : 'blocked: required evidence is unavailable',
          diagnostic: safeError(error),
        },
      };
    }
  };

  // ------------------------------------------------------------ 30-day window
  const long = await fetchSummary(policy.windowDays);
  if (long.failure) {
    t.fail('evidence_30d', null, `${policy.windowDays}-day summary from ${policy.source}`,
      `The ${policy.windowDays}-day summary could not be read, so nothing below could be judged.`);
    return stop(long.failure.code, long.failure.reason, blank, long.failure.diagnostic);
  }
  const raw = long.raw;

  const evidence = {
    wallet: typeof raw?.wallet === 'string' ? raw.wallet : null,
    window_days: Number.isInteger(raw?.window_days) ? raw.window_days : null,
    realized_pnl_usd: finite(raw?.realized_pnl_usd) ? raw.realized_pnl_usd : null,
    realized_pnl_30d_usd: finite(raw?.realized_pnl_usd) ? raw.realized_pnl_usd : null,
    realized_pnl_7d_usd: null,
    closed_trade_count_30d: Number.isInteger(raw?.closed_trade_count) ? raw.closed_trade_count : null,
    win_rate_30d: finite(raw?.win_rate) ? raw.win_rate : null,
    retrieved_at: typeof raw?.retrieved_at === 'string' ? raw.retrieved_at : null,
    short_window_days: policy.shortWindowDays ?? null,
    short_window_retrieved_at: null,
    source: typeof raw?.source === 'string' ? raw.source : null,
  };
  const longBar = `${policy.windowDays}-day summary from ${policy.source}`;

  if (!raw || typeof raw !== 'object' || raw.error || evidence.realized_pnl_usd === null) {
    t.fail('evidence_30d', null, longBar, `The ${policy.windowDays}-day summary carried no usable realised PnL.`);
    return stop('evidence_unavailable', `blocked: verified ${policy.windowDays}-day realised PnL is unavailable`, evidence, raw?.message ?? raw?.error ?? null);
  }
  if (evidence.wallet?.toLowerCase() !== wallet.toLowerCase()) {
    t.fail('evidence_30d', evidence.wallet, wallet, 'The summary that came back belongs to a different wallet than the one being funded.');
    return stop('wallet_mismatch', 'blocked: evidence belongs to a different wallet', evidence);
  }
  if (evidence.window_days !== policy.windowDays) {
    t.fail('evidence_30d', evidence.window_days, policy.windowDays, `The summary covers ${evidence.window_days ?? 'an unstated number of'} days, not the ${policy.windowDays} the policy requires.`);
    return stop('window_mismatch', `blocked: evidence does not cover the required ${policy.windowDays}-day window`, evidence);
  }
  if (evidence.source !== policy.source) {
    t.fail('evidence_30d', evidence.source, policy.source, 'The summary did not come from the endpoint this policy trusts.');
    return stop('source_mismatch', 'blocked: evidence source does not match the policy', evidence);
  }
  if (policy.verifyWindowDates) {
    const bad = windowDatesProblem(raw, policy.windowDays);
    if (bad) {
      t.fail('evidence_30d', bad.value, `dates spanning ${policy.windowDays} days`, bad.plain);
      return stop('window_dates_mismatch', `blocked: evidence dates do not cover the required ${policy.windowDays}-day window`, evidence);
    }
  }
  t.pass('evidence_30d', `${policy.windowDays}d ${evidence.wallet}`, longBar,
    `The ${policy.windowDays}-day summary is for this wallet, covers ${policy.windowDays} days${policy.verifyWindowDates ? ' by its dates' : ''} and came from the approved endpoint.`);

  // ------------------------------------------------------------- freshness
  const retrievedAt = Date.parse(evidence.retrieved_at ?? '');
  const evaluatedAt = now().getTime();
  const ageBar = policy.maxEvidenceAgeMs === null ? 'no age limit (frozen evidence)' : `at most ${policy.maxEvidenceAgeMs} ms old`;
  if (!Number.isFinite(retrievedAt) || !Number.isFinite(evaluatedAt)) {
    t.fail('evidence_freshness', evidence.retrieved_at, ageBar, 'The evidence carries no readable timestamp, so its age cannot be checked.');
    return stop('invalid_timestamp', 'blocked: evidence timestamp is invalid', evidence);
  }
  const ageMs = evaluatedAt - retrievedAt;
  if (-ageMs > policy.maxFutureSkewMs) {
    t.fail('evidence_freshness', ageMs, ageBar, 'The evidence is dated in the future, which means a clock that cannot be trusted.');
    return stop('future_evidence', 'blocked: evidence timestamp is in the future', evidence);
  }
  if (policy.maxEvidenceAgeMs !== null && ageMs > policy.maxEvidenceAgeMs) {
    t.fail('evidence_freshness', ageMs, ageBar, `The evidence is ${Math.round(ageMs / 60_000)} minutes old, past the freshness limit for a live allocation.`);
    return stop('stale_evidence', 'blocked: evidence is stale', evidence);
  }
  if (policy.maxEvidenceAgeMs === null) {
    // A frozen replay has no age limit, so there is nothing to pass. Saying "pass" here
    // would read as "fresh"; the row says what was not checked and names the capture.
    t.skip('evidence_freshness', `N/A (snapshot): frozen capture dated ${String(evidence.retrieved_at).slice(0, 10)}; age is not checked.`, ageMs, ageBar);
  } else {
    t.pass('evidence_freshness', ageMs, ageBar, 'The evidence was retrieved recently enough to act on.');
  }

  // ------------------------------------------- what the 30-day window can answer
  // Everything the summary already in hand can decide is decided here, before a
  // second credit is spent. A wallet that fails one of these is refused on one call.
  const pnl30 = evidence.realized_pnl_30d_usd;
  if (pnl30 < policy.minimumRealizedPnlUsd) {
    t.fail('realised_pnl_30d', pnl30, policy.minimumRealizedPnlUsd,
      `Closed trades over ${policy.windowDays} days came to ${money(pnl30)}. Copying this wallet would have lost money.`);
  } else {
    t.pass('realised_pnl_30d', pnl30, policy.minimumRealizedPnlUsd,
      `Closed trades over ${policy.windowDays} days came to ${money(pnl30)}, at or above the policy minimum.`);
  }

  if (!twoWindow) {
    t.skip('concentration', `Not assessed. Policy ${policy.id} judges realised PnL alone.`);
    t.skip('thin_sample', `Not assessed. Policy ${policy.id} judges realised PnL alone.`);
    t.skip('low_win_rate', `Not assessed. Policy ${policy.id} judges realised PnL alone.`);
    t.skip('paper_headline', `Not assessed. Policy ${policy.id} judges realised PnL alone.`);
  } else {
    const closed = evidence.closed_trade_count_30d;
    if (closed === null) {
      t.skip('thin_sample', 'Not assessed. The summary carried no closed trade count.', null, policy.minClosedTrades);
    } else if (closed < policy.minClosedTrades) {
      t.fail('thin_sample', closed, policy.minClosedTrades,
        `Only ${closed.toLocaleString('en-US')} closed trades in ${policy.windowDays} days. A handful of round trips is luck or skill and the record cannot tell you which.`);
    } else {
      t.pass('thin_sample', closed, policy.minClosedTrades,
        `${closed.toLocaleString('en-US')} closed trades in ${policy.windowDays} days, enough of a record to judge.`);
    }

    const winRate = evidence.win_rate_30d;
    if (winRate === null) {
      t.skip('low_win_rate', 'Not assessed. The summary carried no win rate.', null, policy.minWinRate);
    } else if (winRate < policy.minWinRate) {
      t.fail('low_win_rate', winRate, policy.minWinRate,
        `${pct(winRate)} of closed trades were profitable. Copying this means sitting through long losing runs.`);
    } else {
      t.pass('low_win_rate', winRate, policy.minWinRate, `${pct(winRate)} of closed trades were profitable.`);
    }

    // Nansen's perp-pnl-summary reports realised PnL only, so on the shipped adapter
    // this reads not_assessed. An adapter that does carry the open book gets the check.
    const unrealized = finite(raw?.unrealized_pnl_usd) ? raw.unrealized_pnl_usd : null;
    const headline = finite(raw?.headline_pnl_usd) ? raw.headline_pnl_usd : (unrealized === null ? null : pnl30 + unrealized);
    if (unrealized === null) {
      t.skip('paper_headline', 'Not assessed. This summary endpoint reports realised PnL only, so no unsold gain is being counted as a result.', null, policy.maxPaperShareOfHeadline);
    } else if (unrealized <= 0) {
      t.pass('paper_headline', 0, policy.maxPaperShareOfHeadline, 'The open positions are at or below cost, so nothing unsold is inflating the headline.');
    } else {
      const share = headline && headline !== 0 ? unrealized / Math.abs(headline) : null;
      if (share !== null && share > policy.maxPaperShareOfHeadline) {
        t.fail('paper_headline', share, policy.maxPaperShareOfHeadline,
          `${pct(share)} of the headline is unsold: it sits in open positions and can move or vanish before anyone realises it.`);
      } else {
        t.pass('paper_headline', share, policy.maxPaperShareOfHeadline, 'Most of the headline is money already taken off the table.');
      }
    }

    concentrationCheck(t, policy, pnl30, raw);
  }

  // ------------------------------------------------------------- 7-day window
  const already = t.firstFailure();
  if (!twoWindow) {
    t.skip('evidence_7d', `Not assessed. Policy ${policy.id} reads the ${policy.windowDays}-day window only.`);
    t.skip('regime_agreement', `Not assessed. Policy ${policy.id} reads one window, so there is no second window to compare.`);
  } else if (already && policy.readAllWindows !== true) {
    // Refused already. Buying the second window would spend a credit to decorate a
    // decision that is made, so the table says plainly that it was not bought.
    const note = `Not assessed. The ${policy.windowDays}-day evidence already refused this request at "${already.id}", so the second window was not fetched.`;
    t.skip('evidence_7d', note);
    t.skip('regime_agreement', note);
  } else {
    // `readAllWindows` (the Pitch Room, whose round already holds both summaries, so the
    // week costs nothing) reads the second window even after a refusal. The decision is
    // unchanged, the first failure still decides it; the table is just complete.
    const shortBar = `${policy.shortWindowDays}-day summary from ${policy.source}`;
    const short = await fetchSummary(policy.shortWindowDays);
    if (short.failure) {
      t.fail('evidence_7d', null, shortBar, `The ${policy.shortWindowDays}-day summary could not be read. Missing evidence is a refusal, not an allowance.`);
      return stop(short.failure.code, short.failure.reason, evidence, short.failure.diagnostic);
    }
    const shortRaw = short.raw;
    const shortPnl = finite(shortRaw?.realized_pnl_usd) ? shortRaw.realized_pnl_usd : null;
    evidence.realized_pnl_7d_usd = shortPnl;
    evidence.short_window_retrieved_at = typeof shortRaw?.retrieved_at === 'string' ? shortRaw.retrieved_at : null;

    if (!shortRaw || typeof shortRaw !== 'object' || shortRaw.error || shortPnl === null) {
      t.fail('evidence_7d', null, shortBar, `The ${policy.shortWindowDays}-day summary carried no usable realised PnL, so the recent week is unknown.`);
      return stop('short_window_unavailable', `blocked: verified ${policy.shortWindowDays}-day realised PnL is unavailable`, evidence, shortRaw?.message ?? shortRaw?.error ?? null);
    }
    const mismatch = String(shortRaw.wallet ?? '').toLowerCase() !== wallet.toLowerCase() ? 'wallet'
      : shortRaw.window_days !== policy.shortWindowDays ? 'window'
        : shortRaw.source !== policy.source ? 'source'
          : policy.verifyWindowDates && windowDatesProblem(shortRaw, policy.shortWindowDays) ? 'dates' : null;
    if (mismatch) {
      t.fail('evidence_7d', mismatch, shortBar, `The ${policy.shortWindowDays}-day summary has the wrong ${mismatch}, so it cannot speak for this wallet's recent week.`);
      return stop('short_window_mismatch', `blocked: ${policy.shortWindowDays}-day evidence does not match the requested wallet, window or source`, evidence);
    }
    const shortAge = evaluatedAt - Date.parse(evidence.short_window_retrieved_at ?? '');
    if (!Number.isFinite(shortAge) || -shortAge > policy.maxFutureSkewMs
      || (policy.maxEvidenceAgeMs !== null && shortAge > policy.maxEvidenceAgeMs)) {
      t.fail('evidence_7d', shortAge, ageBar, `The ${policy.shortWindowDays}-day summary is stale or wrongly dated, so the two windows are not comparable.`);
      return stop('short_window_mismatch', `blocked: ${policy.shortWindowDays}-day evidence is stale or wrongly dated`, evidence);
    }
    t.pass('evidence_7d', `${policy.shortWindowDays}d ${shortRaw.wallet}`, shortBar,
      `The ${policy.shortWindowDays}-day summary is for this wallet, covers ${policy.shortWindowDays} days and came from the approved endpoint.`);

    const noiseShare = finite(policy.maxShortWindowGivebackShare) ? policy.maxShortWindowGivebackShare : 0;
    const noisePct = `${Math.round(noiseShare * 100)}%`;
    const giveback = pnl30 === 0 ? Infinity : Math.abs(shortPnl) / Math.abs(pnl30);
    const givebackPct = Number.isFinite(giveback) ? `${(giveback * 100).toFixed(1)}%` : 'all';
    const bar = noiseShare > 0
      ? `${policy.shortWindowDays}-day and ${policy.windowDays}-day signs agree, or the ${policy.shortWindowDays}-day move is under ${noisePct} of the ${policy.windowDays}-day figure`
      : `${policy.shortWindowDays}-day and ${policy.windowDays}-day signs agree`;
    const pair = `${policy.shortWindowDays}d ${money(shortPnl)} vs ${policy.windowDays}d ${money(pnl30)}`;
    const opposite = signOf(shortPnl) !== signOf(pnl30);
    if (opposite && giveback < noiseShare) {
      t.pass('regime_agreement', pair, bar,
        `The week (${money(shortPnl)}) is small against the month: ${givebackPct} of the ${policy.windowDays}-day ${money(pnl30)}, under ${noisePct}, so the two agree.`);
    } else if (opposite) {
      t.fail('regime_agreement', pair, bar,
        `The two windows tell opposite stories: ${money(shortPnl)} over ${policy.shortWindowDays} days against ${money(pnl30)} over ${policy.windowDays}. `
        + `Across 840 saved summaries the two verdicts disagreed on ${REGIME_DISAGREEMENT_RATE} of matched wallet-dates, which is why one window is not enough.`);
    } else {
      t.pass('regime_agreement', pair, bar,
        `Both windows point the same way, so this is not a ${policy.windowDays}-day verdict the last week already contradicts.`);
    }
  }

  for (const [id, plain] of Object.entries(FILL_ONLY_CHECKS)) t.skip(id, plain);

  const failure = t.firstFailure();
  if (failure) {
    const code = {
      realised_pnl_30d: 'pnl_below_minimum',
      regime_agreement: 'regime_disagreement',
      thin_sample: 'thin_sample',
      low_win_rate: 'low_win_rate',
      paper_headline: 'paper_headline',
      concentration: 'top_coin_concentration',
    }[failure.id];
    const reason = {
      realised_pnl_30d: policy.minimumRealizedPnlUsd === 0
        ? `blocked: verified ${policy.windowDays}-day realised PnL is negative`
        : `blocked: verified ${policy.windowDays}-day realised PnL is below the policy minimum`,
      regime_agreement: `blocked: regime disagreement, the ${policy.shortWindowDays}-day and ${policy.windowDays}-day realised PnL have opposite signs`,
      thin_sample: `blocked: fewer than ${policy.minClosedTrades} closed trades in ${policy.windowDays} days`,
      low_win_rate: `blocked: ${policy.windowDays}-day win rate is below the policy minimum`,
      paper_headline: 'blocked: most of the headline PnL is unsold paper',
      concentration: `blocked: one market carries more than ${Math.round(policy.maxTopCoinPnlShare * 100)}% of the ${policy.windowDays}-day realised PnL`,
    }[failure.id];
    return result({ attempted, policy, evidence, code, reason, checks: t.finish() });
  }

  const cap = t.finish().find(c => c.id === 'concentration' && c.result === 'cap');
  if (cap) {
    const cappedTo = Math.floor(attempted * policy.concentrationCapShare);
    return result({ attempted, policy, evidence, code: 'capped', cappedTo, checks: t.finish(),
      reason: `capped: one market carries more than ${Math.round(policy.maxTopCoinPnlShare * 100)}% of the ${policy.windowDays}-day realised PnL, so ${Math.round(policy.concentrationCapShare * 100)}% of the request is allowed` });
  }

  const reason = twoWindow
    ? `allowed: the ${policy.shortWindowDays}-day and ${policy.windowDays}-day evidence passed every check in the policy`
    : `allowed: verified ${policy.windowDays}-day realised PnL meets the policy minimum`;
  return result({ attempted, policy, evidence, code: 'allowed', reason, checks: t.finish() });
}

// ---------------------------------------------------------- copy-risk report

/**
 * BAIT's second answer, for the question the PnL sign cannot answer on its own:
 * would copying this wallet have been survivable?
 *
 * `guardAllocation` above is untouched and stays the hard execution gate, because the
 * recorded benchmark rows depend on exactly that function. `assessCopyRisk` is
 * additive and deterministic: same evidence in, same verdict out. No model, no network,
 * no clock. It reads only fields a caller has already pulled out of a frozen snapshot
 * or a recorded venue response.
 *
 * It has two readers and it is written for both. A person about to copy an address gets
 * one plain sentence per flag, including the drawdown they would have sat through. An
 * agent with BAIT installed gets `summary`, a flat object it can branch on.
 */

// COPY_RISK_THRESHOLDS is declared at the top of this file, beside the policies, so
// the gate and this report cannot drift apart on a number.

const usd = n => `$${Math.round(Math.abs(n)).toLocaleString('en-US')}`;
const signedUsd = n => `${n < 0 ? '-' : '+'}${usd(n)}`;
const asShare = n => `${(n * 100).toFixed(1)}%`;
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Peak to trough of cumulative realised PnL, from time-ordered closed trades, oldest
 * first. This is the number a copier actually lives through: not where the window ends,
 * but the worst point between the high and the end.
 */
export function drawdownOf(series = []) {
  const rows = (Array.isArray(series) ? series : []).map(num).filter(v => v !== null);
  if (!rows.length) {
    return { max_drawdown_usd: null, peak_usd: null, trough_usd: null, final_usd: null, share_of_peak: null, trades: 0 };
  }
  let cumulative = 0;
  let peak = 0;
  let peakAtTrough = 0;
  let trough = 0;
  let worst = 0;
  for (const value of rows) {
    cumulative += value;
    if (cumulative > peak) peak = cumulative;
    const fall = peak - cumulative;
    if (fall > worst) { worst = fall; trough = cumulative; peakAtTrough = peak; }
  }
  const round = n => Math.round(n * 100) / 100;
  // A curve that never fell has no peak it fell from, so report the high it did reach
  // and a drawdown share of zero. A curve that fell reports the peak it fell from.
  const from = worst > 0 ? peakAtTrough : peak;
  return {
    max_drawdown_usd: round(worst),
    peak_usd: round(from),
    trough_usd: round(worst > 0 ? trough : peak),
    final_usd: round(cumulative),
    share_of_peak: from > 0 ? worst / from : null,
    trades: rows.length,
  };
}

/**
 * @param {{
 *   address?: string, venue?: string, source?: string, retrieved_at?: string,
 *   window_days?: number, window?: object,
 *   realized_pnl_usd?: number, unrealized_pnl_usd?: number, headline_pnl_usd?: number,
 *   closed_trade_count?: number, win_rate?: number,
 *   realised_series?: number[],
 *   top_position_share?: number, top_coin_pnl_share?: number,
 *   worst_trade_usd?: number, volume_usd?: number, account_value_usd?: number,
 *   early_entry_share?: number,
 * }} evidence
 */
export function assessCopyRisk(evidence = {}) {
  const t = COPY_RISK_THRESHOLDS;
  const realized = num(evidence.realized_pnl_usd);
  const unrealized = num(evidence.unrealized_pnl_usd);
  const headline = num(evidence.headline_pnl_usd);
  const closed = num(evidence.closed_trade_count);
  const winRate = num(evidence.win_rate);
  const topPosition = num(evidence.top_position_share);
  const topCoin = num(evidence.top_coin_pnl_share);
  const worstTrade = num(evidence.worst_trade_usd);
  const volume = num(evidence.volume_usd);
  const account = num(evidence.account_value_usd);
  const earlyEntries = num(evidence.early_entry_share);
  const drawdown = drawdownOf(evidence.realised_series);

  // This is a recorded risk report, not an execution authorization. These four fields
  // are the minimum needed to say what was measured, over which window, when and from
  // where. Missing them produces an explicit insufficient result instead of a green
  // light assembled from checks that never ran.
  const required = [];
  if (!evidence.address || !walletPattern.test(String(evidence.address))) required.push('address');
  if (realized === null) required.push('realized_pnl_usd');
  if (!Number.isInteger(evidence.window_days) || evidence.window_days < 1) required.push('window_days');
  if (!evidence.source || typeof evidence.source !== 'string') required.push('source');
  if (!evidence.retrieved_at || !Number.isFinite(Date.parse(evidence.retrieved_at))) required.push('retrieved_at');

  const flags = [];
  const notAssessed = [];
  const add = (id, severity, plain, detail) => flags.push({ id, severity, plain, evidence: detail });
  const skip = (id, reason) => notAssessed.push({ id, reason });

  if (realized === null) skip('realised_negative', 'no realised PnL in the evidence');
  else if (realized < 0) {
    add('realised_negative', 'high',
      `Closed trades lost money over this window: ${signedUsd(realized)}. Copying this wallet would have lost money too.`,
      { realized_pnl_usd: realized });
  }

  if (unrealized === null) skip('paper_headline', 'no unrealised PnL in the evidence');
  else if (unrealized <= 0) {
    skip('paper_headline', 'the open positions are at or below cost, so no unsold gain is being counted as a result');
  } else {
    const total = Math.abs(realized ?? 0) + unrealized;
    const ofHeadline = headline && headline !== 0 ? unrealized / Math.abs(headline) : null;
    const ofTotal = total > 0 ? unrealized / total : null;
    if ((ofHeadline !== null && ofHeadline > t.paperShareOfHeadline) || (ofTotal !== null && ofTotal > t.paperShareOfTotal)) {
      add('paper_headline', 'high',
        `Most of this number is unsold: ${usd(unrealized)} sits in open positions and can move or vanish before anyone realises it.`,
        { unrealized_pnl_usd: unrealized, headline_pnl_usd: headline, share_of_headline: ofHeadline, share_of_total: ofTotal });
    }
  }

  if (closed === null) skip('thin_sample', 'no closed trade count in the evidence');
  else if (closed < t.minClosedTrades) {
    add('thin_sample', 'medium',
      `Not enough closed trades to judge: ${closed} in this window. A handful of round trips is luck or skill and the record cannot tell you which.`,
      { closed_trade_count: closed, minimum: t.minClosedTrades });
  }

  if (winRate === null) skip('low_win_rate', 'no win rate in the evidence');
  else if (winRate < t.minWinRate) {
    add('low_win_rate', 'medium',
      `Most trades lose and the winners carry it: ${asShare(winRate)} of closed trades were profitable. Copying this means sitting through long losing runs.`,
      { win_rate: winRate, minimum: t.minWinRate });
  }

  if (earlyEntries === null) {
    skip('uncopyable_entries', 'the evidence carries no token launch times, so the share of launch-window entries cannot be derived');
  } else if (earlyEntries > t.maxEarlyEntryShare) {
    add('uncopyable_entries', 'high',
      `Entries you cannot copy with any lag: ${asShare(earlyEntries)} of buys land inside ten minutes of a token going live.`,
      { early_entry_share: earlyEntries, maximum: t.maxEarlyEntryShare });
  }

  if (topPosition === null && topCoin === null) skip('concentration', 'no position or per-coin breakdown in the evidence');
  else if ((topPosition !== null && topPosition > t.maxTopPositionShare)
    || (topCoin !== null && topCoin > t.maxTopCoinPnlShare)) {
    // Name the bag. "One position carries this" is a claim a reader cannot check; the
    // ticker and the share are both already in the evidence that tripped the check.
    const byPosition = topPosition !== null && topPosition > t.maxTopPositionShare;
    const which = byPosition ? evidence.top_position_coin : evidence.top_coin;
    const named = byPosition
      ? which && `${which} is ${asShare(topPosition)} of the open positions.`
      : which && `${which} alone carries ${asShare(topCoin)} of the realised result.`;
    add('concentration', 'medium',
      `One market carried the result.${named ? ` ${named}` : ''} The result rests on a single position rather than on anything repeatable.`,
      { top_position_share: topPosition, top_coin_pnl_share: topCoin, coin: which ?? null });
  }

  const tailBase = [volume, account].filter(v => v !== null && v > 0);
  if (worstTrade === null || !tailBase.length) skip('tail_loss', 'no worst trade, volume or account value in the evidence');
  else {
    const worstShare = Math.max(...tailBase.map(base => Math.abs(worstTrade) / base));
    if (worstShare > t.maxTailLossShare) {
      add('tail_loss', 'medium',
        `One trade can take a quarter of the book: the worst single closed trade here was ${signedUsd(worstTrade)}.`,
        { worst_trade_usd: worstTrade, share_of_base: worstShare, maximum: t.maxTailLossShare });
    }
  }

  if (drawdown.max_drawdown_usd === null) skip('max_drawdown', 'no time-ordered closed trades in the evidence');
  else {
    const ofPeak = drawdown.share_of_peak;
    const ofAccount = account && account > 0 ? drawdown.max_drawdown_usd / account : null;
    if ((ofPeak !== null && ofPeak > t.maxDrawdownShareOfPeak) || (ofAccount !== null && ofAccount > t.maxDrawdownShareOfAccount)) {
      add('max_drawdown', 'high',
        `At the worst point you would have been down ${usd(drawdown.max_drawdown_usd)} from the top of this window.`,
        { ...drawdown, share_of_account: ofAccount });
    }
  }

  const hardBlock = flags.some(f => f.id === 'realised_negative');
  const verdict = required.length ? 'insufficient'
    : hardBlock ? 'block'
      : flags.length > 0 ? 'caution'
        : 'allow';

  return {
    verdict,
    execution_authorized: false,
    required_missing: required,
    flags,
    not_assessed: notAssessed,
    max_drawdown: drawdown,
    thresholds: t,
    // The flat object an agent branches on: everything needed to decide whether to
    // follow an address, plus where the numbers came from and when.
    summary: {
      address: evidence.address ?? null,
      venue: evidence.venue ?? null,
      verdict,
      execution_authorized: false,
      required_missing: required,
      realised_30d: realized,
      unrealised: unrealized,
      headline,
      closed_trades: closed,
      win_rate: winRate,
      max_drawdown: drawdown.max_drawdown_usd,
      max_drawdown_share_of_peak: drawdown.share_of_peak,
      flags: flags.map(f => f.id),
      evidence: {
        source: evidence.source ?? null,
        retrieved_at: evidence.retrieved_at ?? null,
        window: evidence.window ?? null,
        window_days: num(evidence.window_days),
      },
    },
  };
}

/** What an agent running BAIT would have done with this address, in one sentence. */
export function agentVerdictLine(verdict) {
  return {
    allow: 'The recorded assessment found no configured risk flag. Run the execution guard on fresh evidence before allocating.',
    caution: 'The recorded assessment found risk flags. It does not prescribe a position size.',
    block: 'The recorded assessment found negative realised PnL. The matching guard rule blocks allocation.',
    insufficient: 'The record is missing required evidence. BAIT cannot assess it.',
  }[verdict] ?? 'The assessment result is unknown. BAIT cannot authorize an allocation.';
}

export default guardAllocation;
