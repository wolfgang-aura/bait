/**
 * A saved live Nansen read, frozen into a roster capture.
 *
 * The room's live path (prototype/live-evidence.js) saves every read it makes, as Nansen sent
 * it, to bench/live-reads/. This file replays one of those files through the same live code,
 * with a caller that answers each request from the saved response and makes no network call,
 * and keeps the result as a roster snapshot. So a keyless host, CI and the `?state=` captures
 * play the same record, v4 reads and v5 operator read the live round read, with the read's own
 * time on it and nothing typed by hand.
 *
 *   node prototype/frozen-read.js bench/live-reads/<file>.json   # writes the roster snapshot
 *
 * The snapshot is labelled a capture, never live: `live_read` is dropped, the open positions
 * and the fill tape lose their live flags, and `frozen_from` names the read file and its SHA-256.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createLiveEvidence, liveSnapshot, LIVE_ENDPOINT, FILLS_ENDPOINT, POSITIONS_ENDPOINT, SMART_MONEY_ENDPOINT, RECORD_ENDPOINT } from './live-evidence.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const FROZEN_DIR = path.join(ROOT, 'prototype', 'fixtures', 'frozen-reads');

/** Every saved request and its response, in the order the live path made them. */
function savedCalls(raw) {
  const r = raw.responses ?? {};
  const one = (endpoint, x) => (x ? [{ endpoint, request: x.request, status: x.status, header: x.credits_cost_header, body: x.body }] : []);
  return [
    ...one(LIVE_ENDPOINT, r['30d']), ...one(LIVE_ENDPOINT, r['7d']),
    ...(r.fills ?? []).flatMap(x => one(FILLS_ENDPOINT, x)),
    ...one(POSITIONS_ENDPOINT, r.positions), ...one(SMART_MONEY_ENDPOINT, r.smart_money), ...one(RECORD_ENDPOINT, r.leaderboard),
    ...(r.operator ?? []).flatMap(x => one(x.endpoint, x)),
  ];
}

/** A Nansen caller that answers only from the saved read, and fails loudly on anything else. */
export function replayCaller(raw) {
  const left = savedCalls(raw);
  return async (endpoint, request) => {
    const i = left.findIndex(c => c.endpoint === endpoint && JSON.stringify(c.request) === JSON.stringify(request));
    if (i < 0) throw new Error(`frozen read ${raw.wallet}: no saved response for ${endpoint} ${JSON.stringify(request).slice(0, 120)}`);
    const [c] = left.splice(i, 1);
    return { status: c.status, data: c.body, headers: { 'x-nansen-credits-cost': c.header } };
  };
}

/** The saved read, replayed through the live path at its own time. Zero calls, zero credits. */
export async function replayLiveRead(raw, { operatorIndex } = {}) {
  const at = new Date(raw.fetched_at);
  const live = createLiveEvidence({ enabled: true, keyPresent: true, call: replayCaller(raw), now: () => at,
    stateFile: null, rawDir: null, ...(operatorIndex !== undefined ? { operatorIndex } : {}) });
  const read = await live.read(raw.wallet);
  if (!read.live) throw new Error(`frozen read ${raw.wallet}: the replay did not rebuild a live read (${read.reason})`);
  return read;
}

/** The roster snapshot for a saved read: the live snapshot, relabelled as the capture it now is. */
export async function frozenSnapshot(file, { operatorIndex } = {}) {
  const body = fs.readFileSync(file);
  const raw = JSON.parse(body.toString('utf8'));
  const read = await replayLiveRead(raw, { operatorIndex });
  const stub = { wallet: raw.wallet, schema_version: 1, chain: 'hyperliquid', retrieved_at: read.fetchedAt, windows: read.windows,
    trades_30d: [], trades_pagination: { is_complete: true }, open_positions: null };
  const { live_read: _dropped, ...snap } = liveSnapshot(stub, read);
  const rel = path.relative(ROOT, path.resolve(file)).replace(/\\/g, '/');
  return {
    ...snap,
    source: 'capture',
    fills_coverage: { ...snap.fills_coverage, live: false },
    ...(snap.open_positions && !snap.open_positions.skipped ? { open_positions: { ...snap.open_positions, live: false } } : {}),
    frozen_from: { file: rel, sha256: createHash('sha256').update(body).digest('hex'), fetched_at: raw.fetched_at,
      note: 'A live room read of this wallet, replayed through prototype/live-evidence.js with no network call (prototype/frozen-read.js).' },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  if (!file) { console.error('usage: node prototype/frozen-read.js bench/live-reads/<file>.json'); process.exit(2); }
  const snap = await frozenSnapshot(file);
  const out = path.join(FROZEN_DIR, `${snap.wallet}.json`);
  fs.writeFileSync(out, `${JSON.stringify(snap, null, 2)}\n`);
  const op = snap.v5_reads?.operator;
  console.log(`wrote ${path.relative(ROOT, out)}: 30d ${snap.pnl_summary_30d.realized_pnl_usd}, operator siblings ${op?.siblings?.length ?? 0}, read ${snap.frozen_from.fetched_at}`);
}
