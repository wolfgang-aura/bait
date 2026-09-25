/** npm run verify: every headline row passes on the committed sources, and a changed figure fails. */
import test from 'node:test';
import assert from 'node:assert/strict';

import { compare, format, get, HEADLINE_ROWS } from './verify.mjs';
import { computeFigures, loadFigures } from '../bench/figures.js';

test('verify: every headline number re-derives from the committed sources (zero calls)', async () => {
  const derived = await computeFigures();
  const result = compare(derived, loadFigures());
  assert.equal(result.ok, true, `\n${format(result)}`);
  for (const [, , key] of HEADLINE_ROWS) assert.notEqual(get(loadFigures(), key), undefined, `FIGURES.json has no ${key}`);
});

test('verify: a changed headline figure or a doc problem fails', async () => {
  const derived = await computeFigures();
  const committed = structuredClone(loadFigures());
  committed.headline.bait = [1, 79];
  const bad = compare(derived, committed);
  assert.equal(bad.ok, false);
  assert.equal(bad.rows.find(r => r.key === 'headline.bait').ok, false);
  assert.ok(bad.rows.find(r => r.key === '*').drift.includes('headline.bait'));
  assert.equal(compare(derived, loadFigures(), ['README.md:3: stale']).ok, false);
});
