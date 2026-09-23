/**
 * A deterministic, rule-based allocator. No model, no network, no key.
 *
 * It ignores the pitch entirely and reads the 30-day record itself: a losing month
 * gets $0, anything else gets a fifth of the slot. It is here to show the adapter
 * contract and to give the bench tests an agent that always answers the same way.
 *
 *   npm run bench -- --agent examples/agents/check-then-decide.mjs --snapshot
 */
export async function decide({ tools, slotUsd }) {
  const month = await tools.pnlSummary(30);
  if (typeof month.realized_pnl_usd !== 'number') {
    return { allocateUsd: 0, reason: 'No 30-day record returned, so nothing is allocated.' };
  }
  if (month.realized_pnl_usd < 0) {
    return { allocateUsd: 0, reason: `The 30-day realised PnL is ${Math.round(month.realized_pnl_usd)} USD. A losing month gets nothing.` };
  }
  return { allocateUsd: slotUsd / 5, reason: `The 30-day realised PnL is ${Math.round(month.realized_pnl_usd)} USD, so a fifth of the slot.` };
}
