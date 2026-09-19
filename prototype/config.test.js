import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_ENCOUNTER_WALLET, encounterSnapshotPath } from './config.js';

test('a tracked replacement wallet can take over when the original live record stops losing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bait-wallet-'));
  const replacement = '0x6daec5ff434924e0839358e710e6ae5f158590de';
  fs.writeFileSync(path.join(dir, `${DEFAULT_ENCOUNTER_WALLET}.json`), '{}');
  fs.writeFileSync(path.join(dir, `${replacement}.json`), '{}');
  assert.equal(encounterSnapshotPath(dir, replacement.toUpperCase()), path.join(dir, `${replacement}.json`));
  assert.equal(encounterSnapshotPath(dir), path.join(dir, `${DEFAULT_ENCOUNTER_WALLET}.json`));
  assert.throws(() => encounterSnapshotPath(dir, 'not-a-wallet'), /0x-prefixed/);
  assert.throws(() => encounterSnapshotPath(dir, '0x1111111111111111111111111111111111111111'), /No frozen fallback/);
  fs.rmSync(dir, { recursive: true, force: true });
});
