import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadOpener } from './opener.js';
import { openerComparison } from './public/opener-view.js';

test('every pick retains its own evidence and compares with the strongest ranked tape', () => {
  const { reveal } = loadOpener();
  const original = structuredClone(reveal);
  const best = reveal.find(row => row.best);
  for (const picked of reveal) {
    const comparison = openerComparison(reveal, picked.handle);
    assert.equal(comparison[0], picked);
    assert.equal(comparison.length, picked === best ? 1 : 2);
    assert.equal(comparison.at(-1), best);
    assert.equal(new Set(comparison.map(row => row.handle)).size, comparison.length);
  }
  assert.deepEqual(reveal, original);
});

test('missing or tied evidence never invents a winner', () => {
  const tied = [{ handle: 'one', best: false }, { handle: 'two', best: false }];
  assert.deepEqual(openerComparison(tied, 'one'), [tied[0]]);
  assert.throws(() => openerComparison(tied, 'missing'), /no recorded evidence/);
});
