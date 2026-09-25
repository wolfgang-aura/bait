/**
 * The field test (bench/FIELD.md): the population request is the pre-registered one, the committed
 * reads are hash-checked and label-free, the offline replay rebuilds exactly the operator answer the
 * live reader returned at collection, and the score is internally consistent. Zero calls.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { populationRequest, windowAt, loadReads, loadField, operatorFromRead, scoreField, headline, replayCaller, N, ASK_USD,
  OPERATOR_INDEX, OPERATOR_INDEX_SHA, STATE_FILE } from './field.js';
import { hasNansenLabel } from '../validation/nansen-labels.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const collected = fs.existsSync(path.join(ROOT, STATE_FILE));

test('field: the population request is held-out source C re-dated to T, and the window ends at T', () => {
  const source = JSON.parse(fs.readFileSync(path.join(ROOT, 'bench/heldout/reads/source-C.json'), 'utf8')).body;
  const req = populationRequest('2026-09-25T06:04:09Z', 1);
  assert.deepEqual({ ...req, date: null }, { ...source, date: null });
  assert.deepEqual(req.date, { from: '2026-08-26', to: '2026-09-25' });
  assert.deepEqual(windowAt('2026-09-25T06:04:09Z'), { from: '2026-08-26T06:04:09Z', to: '2026-09-25T06:04:09Z' });
  assert.equal(ASK_USD, 5000);
  assert.equal(N, 200);
});

test('field: replay serves each saved response once and re-throws a saved error', async () => {
  const call = replayCaller([{ path: 'a', body: { x: 1 }, response: { ok: 1 } }, { path: 'b', body: {}, error: 'Nansen 429' }], 'w');
  assert.deepEqual(await call('a', { x: 1 }), { data: { ok: 1 } });
  await assert.rejects(call('a', { x: 1 }), /no saved response/);
  await assert.rejects(call('b', {}), /Nansen 429/);
});

test('field: committed reads match reads.json, carry no Nansen label, and use the pre-registered index', { skip: !collected && 'no field collection in this checkout' }, () => {
  const reads = loadReads({ verify: true });
  for (const [stage, lines] of Object.entries(reads)) assert.equal(lines.some(hasNansenLabel), false, `${stage} holds a Nansen label`);
  assert.ok(OPERATOR_INDEX_SHA.startsWith('ef453261'), OPERATOR_INDEX);
});

test('field: the offline replay rebuilds exactly the operator answer the live reader returned', { skip: !collected && 'no field collection in this checkout' }, async () => {
  const F = await loadField();
  assert.ok(F.wallets.length > 0);
  for (const w of F.wallets) assert.deepEqual(await operatorFromRead(w.operatorRead, F.index), w.operatorRead.answer, w.wallet);
});

test('field: the score is consistent (v5 never lets through more than v4; a flagged wallet the row reached is blocked)', { skip: !collected && 'no field collection in this checkout' }, async () => {
  const res = await scoreField();
  assert.equal(res.scored + res.unread.length + res.dropped.length, res.population);
  for (const g of ['v4', 'v5']) assert.equal(res[g].full + res[g].capped + res[g].blocked, res.scored);
  for (const r of res.rows) {
    assert.ok(r.v5.allocation <= r.v4.allocation, `${r.wallet}: v5 sent more than v4`);
    if (r.op.combined !== null && r.op.combined < 0 && r.v5.operatorRow && r.v5.operatorRow.result !== 'not_assessed') assert.equal(r.v5.code, 'operator_losing', r.wallet);
    if (r.v5.code === 'operator_losing') assert.ok(r.op.combined < 0, r.wallet);
  }
  assert.equal(res.v5.blockedBy.operator_losing ?? 0, res.operatorRowInV5.blocked ?? 0);
  assert.match(headline(res), new RegExp(`^Of ${res.scored} top leaderboard wallets, `));
});
