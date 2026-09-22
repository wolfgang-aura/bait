/**
 * A stand-in for validation/nansen.js `call`, used only by prototype/server.test.js to
 * drive the Pitch Room's live read without a network or a credit. The server loads it
 * only when BAIT_TEST_STUBS=1 and ROOM_NANSEN_CALL_MODULE points here.
 *
 * The shape is the real one: body.data.data holds the PnL summary. The figures are
 * obviously synthetic (a round -1,234,567) so a capture of a stubbed round cannot be
 * mistaken for Nansen data. ROOM_STUB_FAIL=1 makes the provider throw.
 */
export async function call(pathName, body) {
  if (process.env.ROOM_STUB_FAIL === '1') throw Object.assign(new Error(`Nansen 503 on ${pathName}: stubbed failure`), { status: 503 });
  const days = Math.round((Date.parse(body.date.to) - Date.parse(body.date.from)) / 86_400_000);
  return {
    status: 200,
    headers: { 'x-nansen-credits-cost': '1' },
    data: {
      data: {
        realized_pnl_usd: days === 7 ? 12_345 : Number(process.env.ROOM_STUB_PNL_30D ?? -1_234_567),
        realized_pnl_percent: 0,
        win_rate: 0.5,
        closed_trade_count: 400,
        winning_trade_count: 200,
        fees_usd: 10,
        traded_coin_count: 3,
        top5_coins: [{ coin: 'STUB', realized_pnl_usd: 1_000 }],
      },
    },
  };
}

export default call;
