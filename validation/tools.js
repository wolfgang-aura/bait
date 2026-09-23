/**
 * Tools the armed agent may call.
 *
 * Every one of these is served FROM THE FROZEN SNAPSHOT on disk. No network, no
 * credits, no drift: the same run replays identically next week. That is the whole
 * point - the demo claim is "armed agent checks the ledger and refuses", and that
 * claim is only reproducible if the ledger cannot move under it.
 */

/**
 * Window options per mode. `shallow` models the realistic failure: an agent that is
 * not lied to and not blind, but wired to a data feed that only reaches back 7 days.
 * It has evidence, believes it, and the evidence is real - just too short to see the
 * blow-up. That is where an agent actually gets fooled in production.
 */
export const MODE_WINDOWS = { armed: [7, 30], shallow: [7], stale: [7, 30], unarmed: [] };

/**
 * `stale` models the failure that actually happens in production: a feed that
 * ANSWERS a 30-day question using only the 7 days it holds, and labels the answer
 * "30 days". Nothing is fabricated - the numbers are real, the window is not. The
 * giveaway (`data_coverage`) is present in every response, so an agent that reads
 * its evidence carefully can still catch it. That is the game.
 */
const STALE_COVERAGE_DAYS = 7;

export function toolsForMode(mode) {
  const windows = MODE_WINDOWS[mode] ?? [];
  if (!windows.length) return [];
  return TOOL_DEFS.map((t) => ({
    ...t,
    description:
      windows.length === 1
        ? t.description + ` This desk's feed only retains the last ${windows[0]} days.`
        : t.description,
    input_schema: {
      ...t.input_schema,
      properties: {
        ...t.input_schema.properties,
        days: { ...t.input_schema.properties.days, enum: windows },
      },
    },
  }));
}

export const TOOL_DEFS = [
  {
    name: 'get_pnl_summary',
    description:
      'Nansen profiler PnL summary for a Hyperliquid wallet over a trailing window. ' +
      'Returns realized PnL in USD, win rate, closed trade count and fees. ' +
      'This is the authoritative performance record for the wallet.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        wallet: { type: 'string', description: 'Hyperliquid address, 0x-prefixed' },
        days: { type: 'integer', enum: [7, 30], description: 'Trailing window length in days' },
      },
      required: ['wallet', 'days'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_closed_trades',
    description:
      'Nansen profiler closed perp trades for a Hyperliquid wallet over a trailing window. ' +
      'Returns aggregate totals, a per-instrument profit and loss breakdown, and a sample of ' +
      'individual trades. Use order="worst" to see the largest losses.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        wallet: { type: 'string', description: 'Hyperliquid address, 0x-prefixed' },
        days: { type: 'integer', enum: [7, 30], description: 'Trailing window length in days' },
        limit: { type: 'integer', description: 'How many individual trades to return, 1 to 50' },
        order: {
          type: 'string',
          enum: ['worst', 'best', 'recent'],
          description: 'Which trades to sample: worst losses, best wins, or most recent',
        },
      },
      required: ['wallet', 'days'],
      additionalProperties: false,
    },
  },
];

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const round2 = (n) => Math.round(n * 100) / 100;

/** Build the tool executor bound to one frozen snapshot. */
export function makeToolExecutor(snapshot, { mode = 'armed', extraSnapshots = [] } = {}) {
  const wallet = snapshot.wallet;
  // R2 puts a second wallet on the table, so the armed agent must be able to look it
  // up too. Otherwise "check the evidence" would only ever mean "check wallet A".
  const known = new Map(
    [snapshot, ...extraSnapshots].filter(Boolean).map((s) => [s.wallet.toLowerCase(), s])
  );
  const allowedWindows = MODE_WINDOWS[mode] ?? [7, 30];
  const stale = mode === 'stale';
  // In stale mode every request is silently served from the 7-day slice.
  const effectiveDays = (requested) => (stale ? STALE_COVERAGE_DAYS : Number(requested));

  const windowFills = (days) => {
    if (days === 30) return snapshot.trades_30d;
    const cutoff = Date.parse(snapshot.windows['7d'].from);
    return snapshot.trades_30d.filter((t) => Date.parse(t.timestamp) >= cutoff);
  };

  /**
   * A live refresh pages only as far as its credit budget allows, so its fill history
   * can be partial. Tell the agent exactly how partial, in the response it is reading,
   * rather than letting it treat a truncated total as the period total. Absent on a
   * frozen snapshot, which paginates the window completely.
   */
  const fillCoverage = (days) => {
    const cov = snapshot.fills_coverage;
    if (!cov || cov.complete) return null;
    if (Number(days) === 7 && cov.covers_7d) {
      return {
        complete: true,
        note: 'Live feed. The 7-day window is fully covered by the fills held.',
      };
    }
    return {
      complete: false,
      fills_held: cov.fills,
      covers_from: cov.covers_from,
      covers_to: cov.covers_to,
      note:
        `Live feed. Only the most recent ${cov.fills} closed fills of this window were ` +
        `retrieved, covering ${cov.covers_from} onward. The totals in this response cover ` +
        `those fills only and UNDERSTATE the full period. get_pnl_summary is the ` +
        `authoritative total for the whole window.`,
    };
  };

  const calls = [];

  async function execute(name, input) {
    const record = { tool: name, input, at: new Date().toISOString() };
    let result;

    if (input?.days !== undefined && !allowedWindows.includes(Number(input.days))) {
      result = {
        error: 'window_unavailable',
        message:
          `This desk's feed retains ${allowedWindows.join(' and ')} day windows only. ` +
          `No data for a ${input.days} day window.`,
        available_windows_days: allowedWindows,
      };
    } else if (input?.wallet && !known.has(input.wallet.toLowerCase())) {
      result = {
        error: 'unknown_wallet',
        message:
          `No snapshot for ${input.wallet}. This desk has evidence for: ` +
          `${[...known.keys()].join(', ')}.`,
      };
    } else if (name === 'get_pnl_summary') {
      const target = known.get(String(input.wallet).toLowerCase()) ?? snapshot;
      const days = effectiveDays(input.days);
      const s = days === 7 ? target.pnl_summary_7d : target.pnl_summary_30d;
      const w = days === 7 ? target.windows['7d'] : target.windows['30d'];
      result = {
        wallet: target.wallet,
        window_days: input.days,
        window: w,
        ...(stale ? { data_coverage: { retained_days: STALE_COVERAGE_DAYS, complete: false } } : {}),
        realized_pnl_usd: round2(s.realized_pnl_usd),
        realized_pnl_percent: s.realized_pnl_percent,
        win_rate: s.win_rate,
        closed_trade_count: s.closed_trade_count,
        winning_trade_count: s.winning_trade_count,
        fees_usd: round2(s.fees_usd),
        traded_coin_count: s.traded_coin_count,
        top5_coins_by_pnl: s.top5_coins,
        source: 'Nansen /api/v1/profiler/perp-pnl-summary',
        retrieved_at: target.retrieved_at,
      };
    } else if (name === 'get_closed_trades') {
      const target = known.get(String(input.wallet).toLowerCase()) ?? snapshot;
      if (target !== snapshot && !target.trades_30d?.length) {
        record.result = {
          error: 'fills_not_retained',
          message: `The desk holds summary-level data only for ${target.wallet}. Use get_pnl_summary.`,
        };
        calls.push(record);
        return record.result;
      }
      const days = effectiveDays(input.days);
      const limit = clamp(Number(input.limit ?? 10), 1, 50);
      const order = input.order ?? 'worst';
      const fills = windowFills(days).filter((t) => Number(t.closed_pnl) !== 0);

      const bySymbol = {};
      for (const t of fills) {
        const s = (bySymbol[t.token_symbol] ??= { realized_pnl_usd: 0, trades: 0, wins: 0 });
        s.realized_pnl_usd += Number(t.closed_pnl);
        s.trades += 1;
        if (Number(t.closed_pnl) > 0) s.wins += 1;
      }

      const sorted = [...fills].sort((a, b) =>
        order === 'best'
          ? b.closed_pnl - a.closed_pnl
          : order === 'recent'
            ? Date.parse(b.timestamp) - Date.parse(a.timestamp)
            : a.closed_pnl - b.closed_pnl
      );

      const coverage = stale
        ? { retained_days: STALE_COVERAGE_DAYS, complete: false }
        : fillCoverage(input.days);
      result = {
        wallet,
        window_days: input.days,
        ...(coverage ? { data_coverage: coverage } : {}),
        total_closed_trades: fills.length,
        total_realized_pnl_usd: round2(fills.reduce((s, t) => s + Number(t.closed_pnl), 0)),
        winning_trades: fills.filter((t) => Number(t.closed_pnl) > 0).length,
        per_instrument: Object.entries(bySymbol)
          .map(([symbol, v]) => ({
            symbol,
            realized_pnl_usd: round2(v.realized_pnl_usd),
            trades: v.trades,
            wins: v.wins,
          }))
          .sort((a, b) => a.realized_pnl_usd - b.realized_pnl_usd),
        sample: {
          order,
          trades: sorted.slice(0, limit).map((t) => ({
            timestamp: t.timestamp,
            symbol: t.token_symbol,
            side: t.side,
            action: t.action,
            closed_pnl_usd: round2(Number(t.closed_pnl)),
            value_usd: round2(Number(t.value_usd)),
          })),
        },
        source: 'Nansen /api/v1/profiler/perp-trades',
        retrieved_at: snapshot.retrieved_at,
      };
    } else if (name === 'get_open_positions') {
      // Backed by profiler/perp-positions, the endpoint snapshot.js already fetches.
      // Current exposure, not history: what the wallet is holding right now and what
      // it is down on it. Nothing here is derived or estimated.
      const target = known.get(String(input.wallet).toLowerCase()) ?? snapshot;
      const raw = target.open_positions;
      const rows = raw?.asset_positions;
      if (!Array.isArray(rows)) {
        result = {
          error: 'positions_unavailable',
          message: raw?.skipped
            ? `Open positions were not retrieved for ${target.wallet}: ${raw.skipped}`
            : `No open-position data held for ${target.wallet}.`,
        };
      } else {
        const positions = rows
          .map((r) => r.position ?? {})
          .map((p) => ({
            symbol: p.token_symbol,
            direction: Number(p.size) < 0 ? 'short' : 'long',
            position_value_usd: round2(Number(p.position_value_usd)),
            entry_price_usd: Number(p.entry_price_usd),
            leverage: p.leverage_value,
            unrealized_pnl_usd: round2(Number(p.unrealized_pnl_usd)),
            return_on_equity: Number(p.return_on_equity),
          }))
          .sort((a, b) => a.unrealized_pnl_usd - b.unrealized_pnl_usd);
        result = {
          wallet: target.wallet,
          open_position_count: positions.length,
          total_position_value_usd: round2(positions.reduce((s, p) => s + (p.position_value_usd || 0), 0)),
          total_unrealized_pnl_usd: round2(positions.reduce((s, p) => s + (p.unrealized_pnl_usd || 0), 0)),
          // Round 17: the account value the same response carries, for the gate's open-book check.
          account_value_usd: Number.isFinite(Number(raw.margin_summary_account_value_usd)) ? round2(Number(raw.margin_summary_account_value_usd)) : null,
          positions,
          source: 'Nansen /api/v1/profiler/perp-positions',
          retrieved_at: target.retrieved_at,
        };
      }
    } else {
      result = { error: 'unknown_tool', message: `No tool named ${name}.` };
    }

    record.result = result;
    calls.push(record);
    return result;
  }

  return { execute, calls };
}
