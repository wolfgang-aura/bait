/**
 * BAIT's execution gate for AI-proposed wallet allocations.
 *
 * The model proposes an amount. This module independently reads one authoritative
 * Nansen result and either preserves that amount or forces it to zero. It fails
 * closed when the request or evidence is invalid, mismatched, stale, unavailable,
 * or below the policy threshold.
 */

export const GUARD_WINDOW_DAYS = 30;
export const GUARD_SOURCE = 'Nansen /api/v1/profiler/perp-pnl-summary';
export const DEFAULT_GUARD_TIMEOUT_MS = 10_000;

export const PRODUCTION_GUARD_POLICY = Object.freeze({
  id: 'wallet-realized-pnl-30d-v1',
  windowDays: GUARD_WINDOW_DAYS,
  minimumRealizedPnlUsd: 0,
  maxEvidenceAgeMs: 15 * 60 * 1000,
  maxFutureSkewMs: 5 * 60 * 1000,
  source: GUARD_SOURCE,
});

export const BENCHMARK_GUARD_POLICY = Object.freeze({
  ...PRODUCTION_GUARD_POLICY,
  id: 'wallet-realized-pnl-30d-benchmark-v1',
  maxEvidenceAgeMs: null,
});

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

function normalizePolicy(policy = PRODUCTION_GUARD_POLICY) {
  const merged = { ...PRODUCTION_GUARD_POLICY, ...policy };
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
  return merged;
}

function emptyEvidence(policy) {
  return {
    wallet: null,
    window_days: policy.windowDays,
    realized_pnl_usd: null,
    realized_pnl_30d_usd: null,
    retrieved_at: null,
    source: policy.source,
  };
}

function result({ attempted, policy, evidence, code, reason, diagnostic = null }) {
  const allowed = code === 'allowed';
  const allocation = allowed ? attempted : 0;
  return {
    decision: allowed ? 'allow' : 'block',
    code,
    allocation,
    attempted,
    blocked: !allowed && attempted > 0,
    reason,
    diagnostic,
    policy: {
      id: policy.id,
      window_days: policy.windowDays,
      minimum_realized_pnl_usd: policy.minimumRealizedPnlUsd,
      max_evidence_age_ms: policy.maxEvidenceAgeMs,
    },
    evidence,
  };
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
  const attempted = finite(allocation) && allocation > 0 ? allocation : 0;
  const blank = emptyEvidence(policy);

  if (!walletPattern.test(String(wallet ?? ''))) {
    return result({ attempted, policy, evidence: blank, code: 'invalid_request', reason: 'blocked: wallet must be a 0x-prefixed 20-byte address' });
  }
  if (!finite(allocation) || allocation < 0) {
    return result({ attempted: 0, policy, evidence: blank, code: 'invalid_request', reason: 'blocked: allocation must be a non-negative finite number' });
  }
  if (!executor || typeof executor.execute !== 'function') {
    return result({ attempted, policy, evidence: blank, code: 'invalid_request', reason: 'blocked: evidence executor is unavailable' });
  }
  if (!finite(timeoutMs) || timeoutMs <= 0) {
    return result({ attempted, policy, evidence: blank, code: 'invalid_request', reason: 'blocked: timeoutMs must be positive' });
  }

  let raw;
  try {
    raw = await within(
      Promise.resolve(executor.execute('get_pnl_summary', { wallet, days: policy.windowDays })),
      timeoutMs,
    );
  } catch (error) {
    const timedOut = /timed out/.test(safeError(error));
    return result({
      attempted,
      policy,
      evidence: blank,
      code: timedOut ? 'evidence_timeout' : 'evidence_unavailable',
      reason: timedOut ? 'blocked: evidence check timed out' : 'blocked: required evidence is unavailable',
      diagnostic: safeError(error),
    });
  }

  const evidence = {
    wallet: typeof raw?.wallet === 'string' ? raw.wallet : null,
    window_days: Number.isInteger(raw?.window_days) ? raw.window_days : null,
    realized_pnl_usd: finite(raw?.realized_pnl_usd) ? raw.realized_pnl_usd : null,
    realized_pnl_30d_usd: finite(raw?.realized_pnl_usd) ? raw.realized_pnl_usd : null,
    retrieved_at: typeof raw?.retrieved_at === 'string' ? raw.retrieved_at : null,
    source: typeof raw?.source === 'string' ? raw.source : null,
  };

  if (!raw || typeof raw !== 'object' || raw.error || evidence.realized_pnl_usd === null) {
    return result({ attempted, policy, evidence, code: 'evidence_unavailable', reason: 'blocked: verified 30-day realised PnL is unavailable', diagnostic: raw?.message ?? raw?.error ?? null });
  }
  if (evidence.wallet?.toLowerCase() !== wallet.toLowerCase()) {
    return result({ attempted, policy, evidence, code: 'wallet_mismatch', reason: 'blocked: evidence belongs to a different wallet' });
  }
  if (evidence.window_days !== policy.windowDays) {
    return result({ attempted, policy, evidence, code: 'window_mismatch', reason: `blocked: evidence does not cover the required ${policy.windowDays}-day window` });
  }
  if (evidence.source !== policy.source) {
    return result({ attempted, policy, evidence, code: 'source_mismatch', reason: 'blocked: evidence source does not match the policy' });
  }

  const retrievedAt = Date.parse(evidence.retrieved_at ?? '');
  const evaluatedAt = now().getTime();
  if (!Number.isFinite(retrievedAt) || !Number.isFinite(evaluatedAt)) {
    return result({ attempted, policy, evidence, code: 'invalid_timestamp', reason: 'blocked: evidence timestamp is invalid' });
  }
  if (retrievedAt - evaluatedAt > policy.maxFutureSkewMs) {
    return result({ attempted, policy, evidence, code: 'future_evidence', reason: 'blocked: evidence timestamp is in the future' });
  }
  if (policy.maxEvidenceAgeMs !== null && evaluatedAt - retrievedAt > policy.maxEvidenceAgeMs) {
    return result({ attempted, policy, evidence, code: 'stale_evidence', reason: 'blocked: evidence is stale' });
  }
  if (evidence.realized_pnl_usd < policy.minimumRealizedPnlUsd) {
    const reason = policy.minimumRealizedPnlUsd === 0
      ? `blocked: verified ${policy.windowDays}-day realised PnL is negative`
      : `blocked: verified ${policy.windowDays}-day realised PnL is below the policy minimum`;
    return result({ attempted, policy, evidence, code: 'pnl_below_minimum', reason });
  }

  return result({ attempted, policy, evidence, code: 'allowed', reason: `allowed: verified ${policy.windowDays}-day realised PnL meets the policy minimum` });
}

// ---------------------------------------------------------- copy-risk report

/**
 * BAIT's second answer, for the question the PnL sign cannot answer on its own:
 * would copying this wallet have been survivable?
 *
 * `guardAllocation` above is untouched and stays the hard execution gate, because the
 * recorded 0/30 benchmark result depends on exactly that function. `assessCopyRisk` is
 * additive and deterministic: same evidence in, same verdict out. No model, no network,
 * no clock. It reads only fields a caller has already pulled out of a frozen snapshot
 * or a recorded venue response.
 *
 * It has two readers and it is written for both. A person about to copy an address gets
 * one plain sentence per flag, including the drawdown they would have sat through. An
 * agent with BAIT installed gets `summary`, a flat object it can branch on.
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
});

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
    skip('paper_headline', 'the open book is marked at or below cost, so no unsold gain is being counted as a result');
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
      ? which && `${which} is ${asShare(topPosition)} of the open book.`
      : which && `${which} alone carries ${asShare(topCoin)} of the realised result.`;
    add('concentration', 'medium',
      `One bag decides the outcome.${named ? ` ${named}` : ''} The result rests on a single position rather than on anything repeatable.`,
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
