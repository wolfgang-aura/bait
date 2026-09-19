import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_ENCOUNTER_WALLET = '0xc26cbb6483229e0d0f9a1cab675271eda535b8f4';

export function encounterSnapshotPath(snapshotDir, configured = '') {
  const candidate = String(configured || '').toLowerCase();
  if (candidate && !/^0x[a-f0-9]{40}$/.test(candidate)) {
    throw new Error('ENCOUNTER_WALLET must be a 0x-prefixed 40-byte address.');
  }
  const wallet = candidate || DEFAULT_ENCOUNTER_WALLET;
  const file = path.join(snapshotDir, `${wallet}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(`No frozen fallback exists for ENCOUNTER_WALLET ${wallet}.`);
  }
  return file;
}
