/**
 * Step 3: freeze an immutable evidence snapshot for one wallet.
 * Contents: 30d + 7d PnL summaries, current perp positions, every perp fill in the
 * 30d window (paginated), retrieval timestamps, and a reconciliation block.
 *
 * Usage: node snapshot.js 0x<address> [--max-pages N]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { call, creditsUsed, CREDIT_BUDGET } from './nansen.js';
import { reconcile } from './reconcile.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const address = (args.find((a) => a.startsWith('0x')) || '').toLowerCase();
if (!address) {
  console.error('Usage: node snapshot.js 0x<address> [--max-pages N]');
  process.exit(1);
}
const maxPagesIdx = args.indexOf('--max-pages');
const MAX_PAGES = maxPagesIdx !== -1 ? Number(args[maxPagesIdx + 1]) : 8;
const PER_PAGE = 1000;

const iso = (d) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
const now = new Date();
const W30 = { from: iso(new Date(now.getTime() - 30 * 86400_000)), to: iso(now) };
const W7 = { from: iso(new Date(now.getTime() - 7 * 86400_000)), to: iso(now) };

console.log(`Snapshot for ${address}`);
console.log(`  30d window: ${W30.from} -> ${W30.to}`);
console.log(`   7d window: ${W7.from} -> ${W7.to}`);
console.log(`  credits: ${creditsUsed()}/${CREDIT_BUDGET}\n`);

const snapshot = {
  schema_version: 1,
  wallet: address,
  chain: 'hyperliquid',
  retrieved_at: iso(now),
  windows: { '30d': W30, '7d': W7 },
  pnl_summary_30d: null,
  pnl_summary_7d: null,
  open_positions: null,
  trades_30d: [],
  trades_pagination: { per_page: PER_PAGE, pages_fetched: 0, is_complete: false, max_pages: MAX_PAGES },
  sources: [],
};

function source(pathName, body, note) {
  snapshot.sources.push({ path: pathName, body, note, at: iso(new Date()) });
}

// --- 1. PnL summaries -------------------------------------------------------
console.log('[1/4] 30d PnL summary ...');
snapshot.pnl_summary_30d = (await call('profiler/perp-pnl-summary', { address, date: W30 }, {
  note: 'snapshot 30d summary',
})).data?.data ?? null;
source('profiler/perp-pnl-summary', { address, date: W30 }, '30d summary');

console.log('[2/4] 7d PnL summary ...');
snapshot.pnl_summary_7d = (await call('profiler/perp-pnl-summary', { address, date: W7 }, {
  note: 'snapshot 7d summary',
})).data?.data ?? null;
source('profiler/perp-pnl-summary', { address, date: W7 }, '7d summary');

// --- 2. Open positions ------------------------------------------------------
// --no-positions skips a 1-credit call the game tools never read. Used when
// freezing a batch of wallets on a tight credit budget.
const skipPositions = args.includes('--no-positions');
console.log(`[3/4] open perp positions ${skipPositions ? '(skipped)' : '...'}`);
if (skipPositions) {
  snapshot.open_positions = { skipped: 'not fetched (--no-positions)' };
} else try {
  const pos = await call('profiler/perp-positions', { address }, { note: 'snapshot open positions' });
  snapshot.open_positions = pos.data?.data ?? pos.data ?? null;
  source('profiler/perp-positions', { address }, 'open positions');
} catch (err) {
  console.log(`      positions unavailable: ${err.message}`);
  snapshot.open_positions = { error: err.message };
}

// --- 3. Perp fills for the 30d window (5 req/min endpoint) ------------------
console.log(`[4/4] perp fills, up to ${MAX_PAGES} pages of ${PER_PAGE} (5 req/min cap, expect waits) ...`);
for (let page = 1; page <= MAX_PAGES; page++) {
  const body = {
    address,
    date: W30,
    pagination: { page, per_page: PER_PAGE },
    order_by: [{ field: 'timestamp', direction: 'ASC' }],
  };
  const t0 = Date.now();
  const res = await call('profiler/perp-trades', body, { note: `snapshot fills page ${page}`, timeoutMs: 90_000 });
  const rows = res.data?.data ?? [];
  snapshot.trades_30d.push(...rows);
  snapshot.trades_pagination.pages_fetched = page;
  const isLast = res.data?.pagination?.is_last_page === true || rows.length < PER_PAGE;
  console.log(
    `      page ${page}: ${rows.length} fills in ${Date.now() - t0}ms ` +
      `(running total ${snapshot.trades_30d.length}, is_last_page=${res.data?.pagination?.is_last_page})`
  );
  source('profiler/perp-trades', body, `fills page ${page}`);
  if (isLast) {
    snapshot.trades_pagination.is_complete = true;
    break;
  }
}
if (!snapshot.trades_pagination.is_complete) {
  console.log(`      WARNING: stopped at page cap ${MAX_PAGES}; fill history is INCOMPLETE.`);
}

// --- 4. Reconciliation ------------------------------------------------------
snapshot.reconciliation = reconcile(snapshot);

const outPath = path.join(HERE, 'snapshots', `${address}.json`);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2));

console.log('\n--- reconciliation ---');
console.log(JSON.stringify(snapshot.reconciliation, null, 2));
console.log(`\nWrote ${outPath}`);
console.log(`Credits used: ${creditsUsed()}/${CREDIT_BUDGET}`);
