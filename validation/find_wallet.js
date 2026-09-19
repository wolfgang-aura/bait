/**
 * Step 2a: shortlist bait candidates.
 * One perp-leaderboard call (5 credits), sorted ascending by realized PnL over the
 * last 30 days, filtered to accounts large enough to be real but not mega-whales.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { call, creditsUsed, CREDIT_BUDGET } from './nansen.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ymd = (d) => d.toISOString().slice(0, 10);

const now = new Date();
const from = new Date(now.getTime() - 30 * 86400_000);

const body = {
  date: { from: ymd(from), to: ymd(now) },
  pagination: { page: 1, per_page: 30 },
  filters: { account_value: { min: 10_000, max: 5_000_000 } },
  order_by: [{ field: 'realized_pnl_usd', direction: 'ASC' }],
  premium_labels: false,
};

console.log(`Leaderboard window: ${body.date.from} -> ${body.date.to}`);
console.log(`Credits before: ${creditsUsed()}/${CREDIT_BUDGET}`);

const res = await call('perp-leaderboard', body, { note: 'bait candidate shortlist (30d, realized PnL ASC)' });
const rows = res.data?.data ?? [];
console.log(`\nRows returned: ${rows.length}\n`);

const table = rows.map((r) => ({
  addr: r.trader_address,
  label: r.trader_address_label,
  realized: Math.round(r.realized_pnl_usd),
  unrealized: Math.round(r.unrealized_pnl_usd),
  total: Math.round(r.total_pnl),
  roi: r.roi,
  trades: r.total_trades,
  volume: Math.round(r.volume_usd),
  account_value: Math.round(r.account_value),
}));
console.table(table);

fs.writeFileSync(
  path.join(HERE, 'snapshots', '_candidates.json'),
  JSON.stringify({ retrieved_at: new Date().toISOString(), request: body, rows }, null, 2)
);
console.log(`\nSaved shortlist. Credits used: ${creditsUsed()}/${CREDIT_BUDGET}`);
