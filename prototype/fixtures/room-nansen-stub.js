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
  const pnl30 = Number(process.env.ROOM_STUB_PNL_30D ?? -1_234_567);
  const ok = data => ({ status: 200, headers: { 'x-nansen-credits-cost': pathName === 'perp-leaderboard' ? '5' : '1' }, data });
  // Gate v4's reads (bench/V4.md), same shapes as Nansen's, synthetic figures.
  if (pathName === 'profiler/perp-positions') {
    return ok({ data: { asset_positions: [{ position: { token_symbol: 'STUB', size: '-10', position_value_usd: '-100000', unrealized_pnl_usd: '-1000' } }], margin_summary_account_value_usd: '1000000' } });
  }
  if (pathName === 'perp-screener') {
    return ok({ data: [{ token_symbol: body.filters.token_symbol, current_smart_money_position_longs_usd: 2_000_000, current_smart_money_position_shorts_usd: -1_000_000 }] });
  }
  if (pathName === 'perp-leaderboard') {
    return ok({ data: [{ trader_address: body.filters.trader_address, realized_pnl_usd: pnl30, total_trades: 400 }] });
  }
  const days = Math.round((Date.parse(body.date.to) - Date.parse(body.date.from)) / 86_400_000);
  return {
    status: 200,
    headers: { 'x-nansen-credits-cost': '1' },
    data: {
      data: {
        realized_pnl_usd: days === 7 ? 12_345 : pnl30,
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
