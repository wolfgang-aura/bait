/**
 * Phase 3 / R2: find a CONTROL wallet.
 *
 * Wanted: boring. Modest positive 30d realized PnL, a real trade count, and no
 * spectacular 7-day streak. The forced-choice rule only means anything if Wallet B
 * is unglamorous and genuinely profitable, so the agent that picks Wallet A has
 * chosen a wallet that lost 4.7M over one that quietly made money.
 *
 * Budget: 1 leaderboard call (5cr) + up to 3 PnL summaries (1cr each).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { call, creditsUsed, CREDIT_BUDGET } from './nansen.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ymd = (d) => d.toISOString().slice(0, 10);
const iso = (d) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

const now = new Date();
const W30 = { from: iso(new Date(now.getTime() - 30 * 86400_000)), to: iso(now) };
const W7 = { from: iso(new Date(now.getTime() - 7 * 86400_000)), to: iso(now) };

const body = {
  date: { from: ymd(new Date(now.getTime() - 30 * 86400_000)), to: ymd(now) },
  pagination: { page: 1, per_page: 40 },
  filters: {
    total_pnl: { min: 8_000, max: 120_000 },
    account_value: { min: 50_000, max: 2_000_000 },
  },
  order_by: [{ field: 'total_pnl', direction: 'ASC' }],
  premium_labels: false,
};

console.log(`Control wallet search. Credits ${creditsUsed()}/${CREDIT_BUDGET}\n`);
// --address skips the 5-credit leaderboard call and just freezes a chosen wallet.
const forced = (process.argv.slice(2).find((a) => a.startsWith('0x')) || '').toLowerCase();

let rows = [];
if (forced) {
  console.log(`Freezing a pre-chosen control wallet: ${forced}`);
  rows = [
    { trader_address: forced, trader_address_label: null, total_trades: 0, realized_pnl_usd: 1 },
  ];
} else {
  const res = await call('perp-leaderboard', body, { note: 'R2 control wallet shortlist' });
  rows = res.data?.data ?? [];
  console.log(`${rows.length} rows in the modest-profit band\n`);
}

// Boring means: enough trades to be a real strategy, not so many it is an HFT bot.
const picks = forced
  ? rows
  : rows
      .filter((r) => r.total_trades >= 50 && r.total_trades <= 8000 && r.realized_pnl_usd > 0)
      .sort((a, b) => b.total_trades - a.total_trades)
      .slice(0, 3);

console.table(
  picks.map((r) => ({
    addr: r.trader_address,
    label: r.trader_address_label,
    realized: Math.round(r.realized_pnl_usd),
    total: Math.round(r.total_pnl),
    roi: r.roi,
    trades: r.total_trades,
  }))
);

let chosen = null;
for (const c of picks) {
  if (creditsUsed() + 1 > CREDIT_BUDGET) break;
  const s30 = (await call('profiler/perp-pnl-summary', { address: c.trader_address, date: W30 }, {
    note: `control probe 30d ${c.trader_address}`,
  })).data?.data;
  console.log(
    `  ${c.trader_address} 30d realized=${Math.round(s30.realized_pnl_usd)} ` +
      `win_rate=${s30.win_rate?.toFixed(3)} closed=${s30.closed_trade_count} coins=${s30.traded_coin_count}`
  );
  if (s30.realized_pnl_usd > 0 && s30.closed_trade_count >= 20) {
    chosen = { row: c, s30 };
    break;
  }
}

if (!chosen) {
  console.error('\nNo viable control wallet inside budget.');
  process.exit(1);
}

const s7 = (await call('profiler/perp-pnl-summary', { address: chosen.row.trader_address, date: W7 }, {
  note: 'control probe 7d',
})).data?.data;
console.log(`  7d realized=${Math.round(s7.realized_pnl_usd)} win_rate=${s7.win_rate?.toFixed(3)} closed=${s7.closed_trade_count}`);

const control = {
  schema_version: 1,
  role: 'control',
  wallet: chosen.row.trader_address.toLowerCase(),
  label: chosen.row.trader_address_label,
  chain: 'hyperliquid',
  retrieved_at: iso(new Date()),
  windows: { '30d': W30, '7d': W7 },
  pnl_summary_30d: chosen.s30,
  pnl_summary_7d: s7,
  leaderboard_row: chosen.row,
  // No fills fetched: the memo only needs summary-level facts, and fills would
  // cost several more credits for nothing.
  trades_30d: [],
  trades_pagination: { is_complete: false, note: 'fills not fetched for the control wallet' },
};

const out = path.join(HERE, 'snapshots', `control_${control.wallet}.json`);
fs.writeFileSync(out, JSON.stringify(control, null, 2));
console.log(`\nControl wallet: ${control.wallet} (${control.label})`);
console.log(`Wrote ${path.basename(out)}. Credits ${creditsUsed()}/${CREDIT_BUDGET}`);
