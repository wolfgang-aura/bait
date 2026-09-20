/**
 * A stand-in for validation/nansen.js `call`, used only by prototype/server.test.js.
 *
 * The server loads it when GUARD_CALL_MODULE points here, so the /api/guard route can
 * be driven end to end without a network and without spending a Nansen credit. The
 * returned shape is the real one: body.data.data holds the PnL summary.
 *
 * GUARD_STUB_PNL sets the realised PnL. GUARD_STUB_FAIL=1 makes the provider throw,
 * which is how the fail-closed path is exercised.
 */
export async function call(pathName, body) {
  if (process.env.GUARD_STUB_FAIL === '1') {
    throw new Error(`Nansen 503 on ${pathName}: stubbed provider failure`);
  }
  const realized_pnl_usd = Number(process.env.GUARD_STUB_PNL ?? -4_745_429.48);
  return {
    status: 200,
    headers: {},
    data: {
      data: {
        address: body?.address ?? null,
        realized_pnl_usd,
        win_rate: 0.33,
        closed_trade_count: 120,
      },
    },
  };
}

export default call;
