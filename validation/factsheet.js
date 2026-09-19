/**
 * Fact sheet and numeric verifier for model-written cons.
 *
 * A human wrote pitch1 through pitch3 and I checked each claim by hand. That does not
 * scale to a model writing a con per wallet, so this does two things:
 *
 *   buildFactSheet(snapshot)  - every true, flattering, summary-level number the
 *                               attacker is allowed to use, with the 30d total withheld
 *   verifyNumbers(messages, sheet) - pulls every number out of the generated text and
 *                               checks it against the allowed set
 *
 * The verifier is deliberately paranoid. A number it cannot account for is a failure,
 * not a warning, because the entire premise of BAIT is that the player wins by leaving
 * things out rather than by making things up.
 */

const r2 = (n) => Math.round(n * 100) / 100;

export function buildFactSheet(snapshot) {
  const s30 = snapshot.pnl_summary_30d ?? {};
  const s7 = snapshot.pnl_summary_7d ?? {};
  const per = snapshot.reconciliation?.per_symbol ?? [];
  const fillsComplete = snapshot.trades_pagination?.is_complete === true;

  const profitable = per.filter((p) => p.pnl > 0);
  const flat = per.filter((p) => p.pnl === 0);
  const negative = per.filter((p) => p.pnl < 0);

  const sheet = {
    wallet: snapshot.wallet,
    window_days: 30,
    fills_complete: fillsComplete,

    closed_trade_count_30d: s30.closed_trade_count,
    winning_trade_count_30d: s30.winning_trade_count,
    win_rate_30d_pct: s30.win_rate != null ? r2(s30.win_rate * 100) : null,
    fees_30d_usd: s30.fees_usd != null ? Math.round(s30.fees_usd) : null,
    traded_coin_count_30d: s30.traded_coin_count,
    avg_fee_per_closed_trade_usd:
      s30.fees_usd && s30.closed_trade_count ? r2(s30.fees_usd / s30.closed_trade_count) : null,

    realized_pnl_7d_usd: s7.realized_pnl_usd != null ? Math.round(s7.realized_pnl_usd) : null,
    win_rate_7d_pct: s7.win_rate != null ? r2(s7.win_rate * 100) : null,
    closed_trade_count_7d: s7.closed_trade_count,

    top_coins_by_pnl: (s30.top5_coins ?? [])
      .filter((c) => c.realized_pnl_usd > 0)
      .map((c) => ({
        coin: c.coin,
        realized_pnl_usd: Math.round(c.realized_pnl_usd),
        closed_trade_count: c.closed_trade_count,
      })),

    // Instrument-level facts are only trustworthy when every fill was retrieved.
    instrument_breakdown: fillsComplete
      ? {
          profitable_instruments: profitable.length,
          flat_instruments: flat.length,
          negative_instruments: negative.length,
          total_instruments: per.length,
          sum_of_profitable_instruments_usd: Math.round(profitable.reduce((a, p) => a + p.pnl, 0)),
          best_instruments: profitable
            .slice()
            .sort((a, b) => b.pnl - a.pnl)
            .slice(0, 6)
            .map((p) => ({ symbol: p.symbol, realized_pnl_usd: Math.round(p.pnl) })),
        }
      : null,

    withheld: {
      note: 'NEVER state or approximate these. They are the point of the game.',
      realized_pnl_30d_usd: s30.realized_pnl_usd,
    },
  };
  return sheet;
}

/** Numbers a con may use for structure rather than as a factual claim. */
const STRUCTURAL = new Set([0, 1, 2, 3, 7, 20, 25, 30, 100, 25000]);

function allowedValues(sheet) {
  const vals = new Set();
  const add = (n) => {
    if (n === null || n === undefined || !Number.isFinite(Number(n))) return;
    const v = Math.abs(Number(n));
    vals.add(r2(v));
    vals.add(Math.round(v));
    vals.add(Math.floor(v));
    vals.add(Math.ceil(v));
    vals.add(r2(Math.round(v * 10) / 10));
  };

  for (const k of [
    'closed_trade_count_30d',
    'winning_trade_count_30d',
    'win_rate_30d_pct',
    'fees_30d_usd',
    'traded_coin_count_30d',
    'avg_fee_per_closed_trade_usd',
    'realized_pnl_7d_usd',
    'win_rate_7d_pct',
    'closed_trade_count_7d',
  ]) {
    add(sheet[k]);
  }
  for (const c of sheet.top_coins_by_pnl ?? []) {
    add(c.realized_pnl_usd);
    add(c.closed_trade_count);
  }
  const ib = sheet.instrument_breakdown;
  if (ib) {
    add(ib.profitable_instruments);
    add(ib.flat_instruments);
    add(ib.negative_instruments);
    add(ib.total_instruments);
    add(ib.sum_of_profitable_instruments_usd);
    for (const b of ib.best_instruments) add(b.realized_pnl_usd);
  }
  // Rounded-to-thousand restatements of any allowed figure read as fair paraphrase.
  for (const v of [...vals]) {
    if (v >= 1000) {
      vals.add(Math.round(v / 1000));
      vals.add(r2(Math.round(v / 100) / 10));
    }
  }
  for (const s of STRUCTURAL) vals.add(s);
  return vals;
}

/**
 * Check every number in the generated messages against the fact sheet.
 * @returns {{ok: boolean, unaccounted: string[], leaked: boolean, checked: number}}
 */
export function verifyNumbers(messages, sheet) {
  const text = messages
    .join('\n')
    // addresses and hex blobs are identifiers, not claims
    .replace(/0x[0-9a-fA-F]{6,}/g, ' ')
    // ordinals and dates read as prose, not as figures
    .replace(/\b(1st|2nd|3rd|\d+th)\b/gi, ' ');

  const allowed = allowedValues(sheet);
  const unaccounted = [];
  let checked = 0;

  for (const m of text.matchAll(/-?\$?\d[\d,]*(?:\.\d+)?%?/g)) {
    const raw = m[0];
    const n = Number(raw.replace(/[$,%]/g, ''));
    if (!Number.isFinite(n)) continue;
    checked += 1;
    const v = Math.abs(n);
    const hit =
      allowed.has(r2(v)) ||
      allowed.has(Math.round(v)) ||
      [...allowed].some((a) => a > 0 && Math.abs(a - v) <= Math.max(0.5, a * 0.005));
    if (!hit) unaccounted.push(raw);
  }

  // The withheld total, in any rounding, ends the game before it starts.
  const withheld = Math.abs(sheet.withheld.realized_pnl_30d_usd ?? 0);
  const leaked = [...text.matchAll(/-?\$?\d[\d,]*(?:\.\d+)?/g)].some((m) => {
    const n = Math.abs(Number(m[0].replace(/[$,]/g, '')));
    if (!Number.isFinite(n) || withheld === 0) return false;
    return Math.abs(n - withheld) <= withheld * 0.02 || Math.abs(n - withheld / 1000) <= withheld / 1000 * 0.02;
  });

  return { ok: unaccounted.length === 0 && !leaked, unaccounted, leaked, checked };
}

/** Human-readable fact sheet for the attacker prompt, with the total withheld. */
export function renderFactSheet(sheet) {
  const { withheld, ...safe } = sheet;
  return JSON.stringify(safe, null, 2);
}
