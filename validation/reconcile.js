/**
 * Reconcile a frozen snapshot's raw fills against Nansen's own PnL summary.
 *
 * Finding (2026-09-15, wallet 0xc26cbb...): the perp-pnl-summary endpoint EXCLUDES
 * Hyperliquid spot-index instruments (symbols of the form "@<number>"). Comparing
 * only the named instruments brings fills and summary to within 0.03% on PnL and
 * ~$6 on fees. Comparing raw fills to the summary without that exclusion produces a
 * misleading ~$12k gap.
 */

export const isSpotIndex = (symbol) => /^@\d+$/.test(String(symbol ?? ''));

const sum = (rows, key) => rows.reduce((acc, r) => acc + (Number(r[key]) || 0), 0);

export function reconcile(snapshot) {
  const fills = snapshot.trades_30d ?? [];
  const summary = snapshot.pnl_summary_30d ?? {};
  const named = fills.filter((t) => !isSpotIndex(t.token_symbol));
  const indexOnly = fills.filter((t) => isSpotIndex(t.token_symbol));

  const closing = named.filter((t) => Number(t.closed_pnl) !== 0);
  const winners = closing.filter((t) => Number(t.closed_pnl) > 0);

  const fillsPnl = sum(named, 'closed_pnl');
  const fillsFees = sum(named, 'fee_usd');
  const summaryPnl = Number(summary.realized_pnl_usd ?? 0);
  const summaryFees = Number(summary.fees_usd ?? 0);

  return {
    fills_fetched: fills.length,
    fills_complete: snapshot.trades_pagination?.is_complete === true,
    distinct_symbols: [...new Set(fills.map((t) => t.token_symbol))],
    excluded_spot_index_symbols: [...new Set(indexOnly.map((t) => t.token_symbol))],
    excluded_spot_index_fills: indexOnly.length,

    // headline comparison, named instruments only
    sum_closed_pnl_named_instruments: fillsPnl,
    summary_realized_pnl_usd: summaryPnl,
    pnl_delta_usd: summaryPnl - fillsPnl,
    pnl_relative_error: summaryPnl ? (summaryPnl - fillsPnl) / summaryPnl : null,

    sum_fee_usd_named_instruments: fillsFees,
    summary_fees_usd: summaryFees,
    fee_delta_usd: summaryFees - fillsFees,

    // fee treatment: realized PnL is reported GROSS of trading fees.
    // Subtracting fees would move the summary a further ~$8k negative.
    fee_treatment: 'summary realized_pnl_usd is gross of fees; fees_usd is reported separately',
    realized_pnl_net_of_fees_usd: summaryPnl - summaryFees,

    // trade counting differs: Nansen groups fills into logical trades
    nonzero_closed_pnl_fills: closing.length,
    summary_closed_trade_count: summary.closed_trade_count ?? null,
    winning_fills: winners.length,
    summary_winning_trade_count: summary.winning_trade_count ?? null,
    win_rate_from_fills: closing.length ? winners.length / closing.length : null,
    summary_win_rate: summary.win_rate ?? null,
    trade_count_note:
      'Nansen counts logical closed trades (order-level), not raw fills, so ' +
      'closed_trade_count > fills with non-zero closed_pnl. Win rates differ accordingly. ' +
      'The referee uses the summary figure, which is what a user would see in the product.',

    // per-symbol breakdown, computed from the frozen fills
    per_symbol: Object.entries(
      fills.reduce((acc, t) => {
        const s = (acc[t.token_symbol] ??= { pnl: 0, fees: 0, fills: 0, closing: 0, wins: 0 });
        s.pnl += Number(t.closed_pnl) || 0;
        s.fees += Number(t.fee_usd) || 0;
        s.fills += 1;
        if (Number(t.closed_pnl) !== 0) {
          s.closing += 1;
          if (Number(t.closed_pnl) > 0) s.wins += 1;
        }
        return acc;
      }, {})
    )
      .map(([symbol, v]) => ({ symbol, ...v }))
      .sort((a, b) => a.pnl - b.pnl),
  };
}
