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

export default guardAllocation;
