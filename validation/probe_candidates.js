/**
 * Step 2b: probe shortlisted wallets with the 1-credit perp-pnl-summary.
 * We want: realized 30d PnL clearly NEGATIVE, but a flattering true fact
 * (high win rate, or a strong 7-day window).
 * Only low-fill-count wallets are probed so the full trade snapshot stays affordable.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { call, creditsUsed, CREDIT_BUDGET } from './nansen.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const candidates = JSON.parse(fs.readFileSync(path.join(HERE, 'snapshots', '_candidates.json'), 'utf8'));

const MAX_FILLS = 6000; // keeps full pagination under ~6 pages / 6 credits
const picks = candidates.rows
  .filter((r) => r.total_trades <= MAX_FILLS)
  .slice(0, 6);

console.log(`Probing ${picks.length} candidates (<= ${MAX_FILLS} fills). Credits: ${creditsUsed()}/${CREDIT_BUDGET}\n`);

export const now = new Date(candidates.retrieved_at);
const iso = (d) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
const W30 = { from: iso(new Date(now.getTime() - 30 * 86400_000)), to: iso(now) };

const results = [];
for (const [i, c] of picks.entries()) {
  process.stdout.write(`[${i + 1}/${picks.length}] ${c.trader_address} (${c.trader_address_label})\n`);
  try {
    const res = await call('profiler/perp-pnl-summary', { address: c.trader_address, date: W30 }, {
      note: `candidate probe 30d ${c.trader_address}`,
    });
    const d = res.data?.data ?? {};
    results.push({ ...c, summary30d: d });
    console.log(
      `      realized_pnl=${Math.round(d.realized_pnl_usd)} win_rate=${d.win_rate} ` +
        `closed=${d.closed_trade_count} winners=${d.winning_trade_count} fees=${Math.round(d.fees_usd)}`
    );
  } catch (err) {
    console.log(`      FAILED: ${err.message}`);
    results.push({ ...c, error: err.message });
  }
}

fs.writeFileSync(
  path.join(HERE, 'snapshots', '_probes.json'),
  JSON.stringify({ retrieved_at: new Date().toISOString(), window_30d: W30, results }, null, 2)
);

console.log('\n--- ranked by win rate, realized 30d PnL negative ---');
const viable = results
  .filter((r) => r.summary30d && r.summary30d.realized_pnl_usd < 0)
  .sort((a, b) => b.summary30d.win_rate - a.summary30d.win_rate);
console.table(
  viable.map((r) => ({
    addr: r.trader_address,
    label: r.trader_address_label,
    realized30d: Math.round(r.summary30d.realized_pnl_usd),
    win_rate: r.summary30d.win_rate,
    closed_trades: r.summary30d.closed_trade_count,
    coins: r.summary30d.traded_coin_count,
    fills: r.total_trades,
  }))
);
console.log(`Credits used: ${creditsUsed()}/${CREDIT_BUDGET}`);
