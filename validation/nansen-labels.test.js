import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stripNansenLabels, hasNansenLabel } from './nansen-labels.js';
import { firstFunderFrom, funderExclusion } from './v5-evidence.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

test('labels go, addresses and amounts stay, and a First Funder keeps only whether its label is excluded', () => {
  const body = { data: [
    { address: '0x' + 'a'.repeat(40), address_label: 'Binance 14', relation: 'First Funder', transaction_hash: '0x1', block_timestamp: '2024-01-01T00:00:00Z', chain: 'ethereum' },
    { address: '0x' + 'b'.repeat(40), address_label: 'Some Whale', relation: 'Sent To', chain: 'ethereum' },
    { trader_address: '0x' + 'c'.repeat(40), trader_address_label: 'HL Perps Whale', realized_pnl_usd: 12.5, tokens_sent: [{ from_address: '0x1', from_address_label: 'x', to_address_label: 'y', value_usd: 3 }] },
  ] };
  const out = stripNansenLabels(body);
  assert.equal(hasNansenLabel(out), false);
  assert.equal(out.data[0].funder_excluded_by_label, true);
  assert.equal(out.data[0].address, body.data[0].address);
  assert.equal('funder_excluded_by_label' in out.data[1], false, 'only a First Funder row carries the boolean');
  assert.equal(out.data[2].realized_pnl_usd, 12.5);
  assert.deepEqual(out.data[2].tokens_sent[0], { from_address: '0x1', value_usd: 3 });
  // The gate reads the same answer from either form.
  const before = firstFunderFrom(body, { chain: 'ethereum' });
  const after = firstFunderFrom(out, { chain: 'ethereum' });
  assert.deepEqual(after, before);
  assert.match(funderExclusion({ labelExcluded: after.label_excluded }), /label/);
  const plain = stripNansenLabels({ data: [{ ...body.data[0], address_label: 'High Activity' }] });
  assert.equal(plain.data[0].funder_excluded_by_label, false);
  assert.equal(funderExclusion({ labelExcluded: firstFunderFrom(plain).label_excluded }), null);
});

test('an empty label (null or "") is kept as it is, so a file without a label is unchanged', () => {
  const row = { trader_address: '0x1', trader_address_label: null, address_label: '' };
  assert.deepEqual(stripNansenLabels(row), row);
});

test('no committed read carries a Nansen address label', () => {
  const files = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).trim().split(/\r?\n/)
    .filter(f => /\.jsonl?$/.test(f) && !/_ledger\.jsonl$/.test(f) && fs.existsSync(new URL(`../${f}`, import.meta.url)));
  const labelled = /"(?:address_label|trader_address_label|from_address_label|to_address_label)"\s*:\s*"[^"]/;
  const hits = files.filter(f => labelled.test(fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')));
  assert.deepEqual(hits, [], 'run node scripts/strip-nansen-labels.mjs --write');
});
