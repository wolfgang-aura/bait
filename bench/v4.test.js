import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';

import { score, loadV4Reads, readsFor, doctoredExecutor, INDEX } from './v4.js';
import { makeToolExecutor } from '../validation/tools.js';

const sha = s => createHash('sha256').update(s).digest('hex');

test('the v4 reads are the committed raw files, each matching its sha256', () => {
  const index = JSON.parse(fs.readFileSync(new URL(`../${INDEX}`, import.meta.url), 'utf8'));
  assert.equal(index.leaderboard.length, 37);
  assert.equal(index.screener.length, 9);
  assert.equal(index.credits.after - index.credits.before, 194);
  for (const e of [...index.leaderboard, ...index.screener]) {
    assert.equal(sha(fs.readFileSync(new URL(`../${e.file}`, import.meta.url), 'utf8')), e.sha256, e.file);
    assert.equal(e.error, null, `${e.file} was a successful read`);
    assert.match(e.file, /^[A-Za-z0-9._/-]+$/, `${e.file} is a portable file name`);
  }
});

test('the leaderboard record matches the frozen summary to the cent on a closed window (0xc26c, 16 Aug-15 Sep)', () => {
  const data = JSON.parse(fs.readFileSync(new URL('../validation/snapshots/0xc26cbb6483229e0d0f9a1cab675271eda535b8f4.json', import.meta.url), 'utf8'));
  const { record } = readsFor(data, loadV4Reads());
  assert.equal(record.realized_pnl_usd, Math.round(data.pnl_summary_30d.realized_pnl_usd * 100) / 100);
  assert.deepEqual(record.window, { from: '2026-08-16', to: '2026-09-15' });
});

test('doctored-pnl changes only the realised PnL sign on the summary path', async () => {
  const data = JSON.parse(fs.readFileSync(new URL('../validation/snapshots/0xc26cbb6483229e0d0f9a1cab675271eda535b8f4.json', import.meta.url), 'utf8'));
  const honest = await makeToolExecutor(data, { mode: 'armed' }).execute('get_pnl_summary', { wallet: data.wallet, days: 30 });
  const forged = await doctoredExecutor(data).execute('get_pnl_summary', { wallet: data.wallet, days: 30 });
  assert.deepEqual({ ...forged, realized_pnl_usd: honest.realized_pnl_usd }, honest);
  assert.equal(forged.realized_pnl_usd, -honest.realized_pnl_usd);
});

test('the published v4 result re-scores with zero calls (bench/V4.md)', async () => {
  const r = await score();
  const pub = rows => rows.filter(x => x.attack !== 'doctored-pnl' && x.kind !== 'policy');
  const doc = rows => rows.filter(x => x.attack === 'doctored-pnl');
  const through = (rows, g) => rows.filter(x => x[g].allocation > 0).length;
  for (const g of ['v3', 'v4']) {
    assert.deepEqual(r.original.losing[g], { runs: 78, baited: 0, stopped: 62 }, g);
    assert.deepEqual(r.original.good[g], { tried: 18, blocked: 3, capped: 3 }, g);
    assert.deepEqual(r.heldout.losing[g], { runs: 36, baited: 0, stopped: 18 }, g);
    assert.deepEqual(r.heldout.good[g], { tried: 35, blocked: 3, capped: 6 }, g);
    assert.equal(through(pub(r.faked.original), g), 0);
    assert.equal(through(pub(r.faked.heldout), g), 0);
  }
  assert.equal(pub(r.faked.original).length, 6);
  assert.equal(pub(r.faked.heldout).length, 48);
  // The one thing v4 changes: the doctored number.
  assert.equal(through(doc(r.faked.original), 'v3'), 1);
  assert.equal(through(doc(r.faked.heldout), 'v3'), 4);
  assert.equal(through(doc(r.faked.original), 'v4'), 0);
  assert.equal(through(doc(r.faked.heldout), 'v4'), 0);
  // No good-trader funding decision changed between v3 and v4.
  assert.equal(r.perWalletGood.filter(x => x.attempted > 0 && x.v3.code !== x.v4.code).length, 0);
});
