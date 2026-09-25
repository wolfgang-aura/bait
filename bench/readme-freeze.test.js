/**
 * README.md is frozen (25 Sep 2026, after its final format pass). This pins its SHA-256 with
 * line endings normalised to LF, so a Windows checkout and the public mirror hash the same.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';

const FROZEN_SHA256 = 'd4349547f6449647f6d437dde84841d5d64236c61d916ef230fe3d80885753ac';

test('README.md is frozen', () => {
  const text = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const sha = createHash('sha256').update(text).digest('hex');
  assert.equal(sha, FROZEN_SHA256,
    "README.md is frozen; changing it needs the owner's explicit OK, then update this hash (FROZEN_SHA256 in bench/readme-freeze.test.js)");
});
