/**
 * The BAIT guard: a deterministic gate in front of the allocation.
 *
 * The strict policy asks the model to check the 30-day realised PnL before it
 * allocates. This module does not ask. It reads the number itself, through the same
 * executor the desk tools are served from, and forces the allocation to $0 when that
 * number is missing, unverifiable, or negative. The model's answer is recorded as
 * `attempted`; whatever it wrote, only the guarded allocation is honoured.
 *
 * Pure apart from the one executor call. It never touches the desk, its prompts, or
 * its conversation, so a guarded config and an unguarded one run byte-identical desks.
 */

export const GUARD_WINDOW_DAYS = 30;
export const GUARD_SOURCE = 'Nansen /api/v1/profiler/perp-pnl-summary';

const finite = v => typeof v === 'number' && Number.isFinite(v);

/**
 * @param {{ executor: { execute(name, input): Promise<object> }, wallet: string, allocation: number }} input
 * @returns {Promise<{ allocation: number, attempted: number, blocked: boolean, reason: string,
 *   evidence: { realized_pnl_30d_usd: number|null, source: string } }>}
 */
export async function guardAllocation({ executor, wallet, allocation }) {
  const attempted = finite(allocation) && allocation > 0 ? allocation : 0;
  let pnl = null;
  let source = GUARD_SOURCE;
  let failure = null;

  try {
    const result = await executor.execute('get_pnl_summary', { wallet, days: GUARD_WINDOW_DAYS });
    if (result && typeof result === 'object' && !result.error && finite(result.realized_pnl_usd)) {
      pnl = result.realized_pnl_usd;
      if (typeof result.source === 'string') source = result.source;
    } else {
      failure = result?.error
        ? `evidence missing: ${String(result.message ?? result.error)}`
        : 'evidence missing: no finite realized_pnl_usd in the 30-day summary';
    }
  } catch (err) {
    failure = `evidence missing: ${GUARD_WINDOW_DAYS}-day PnL check failed (${err?.message ?? err})`;
  }

  const evidence = { realized_pnl_30d_usd: pnl, source };
  const disqualified = failure !== null || pnl < 0;
  if (!disqualified) {
    return { allocation: attempted, attempted, blocked: false, reason: `verified ${GUARD_WINDOW_DAYS}-day realised PnL is non-negative`, evidence };
  }
  const reason = failure ?? `verified ${GUARD_WINDOW_DAYS}-day realised PnL is negative`;
  // A $0 answer needs no forcing; "blocked" means the guard changed a real allocation.
  return { allocation: 0, attempted, blocked: attempted > 0, reason, evidence };
}

export default guardAllocation;
