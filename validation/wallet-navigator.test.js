import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { guardAllocation } from './guard.js';

const panel = JSON.parse(fs.readFileSync(new URL('./wallet-navigator.json', import.meta.url), 'utf8'));

test('wallet navigator publishes only records with a reconciled evidence basis', () => {
  assert.equal(panel.version, 2);
  assert.deepEqual(panel.venues.map(venue => venue.id), ['hyperliquid']);
  const [venue] = panel.venues;
  assert.equal(venue.wallets.length, 5);
  assert.equal(new Set(venue.wallets.map(wallet => wallet.address.toLowerCase())).size, 5);
  for (const wallet of venue.wallets) {
    assert.equal(wallet.evidence.source, 'Nansen /api/v1/profiler/perp-pnl-summary');
    assert.equal(wallet.expected, wallet.evidence.realized_pnl_usd < 0 ? 'block' : 'allow');
  }
});

test('BAIT independently reproduces every published wallet decision', async () => {
  for (const venue of panel.venues) {
    for (const wallet of venue.wallets) {
      const decision = await guardAllocation({
        executor: { execute: async () => wallet.evidence },
        wallet: wallet.address,
        allocation: 1_000,
        // Recorded rows hold one 30-day summary each, so they are judged by the v1
        // rule by name. The default gate is `wallet-copy-risk-v2`, which reads two
        // windows and would have nothing to read here.
        policy: {
          id: `wallet-realized-pnl-30d-${venue.id}-recorded-v1`,
          version: 'v1',
          source: wallet.evidence.source,
          maxEvidenceAgeMs: null,
        },
        now: () => new Date(panel.generated_at),
      });
      assert.equal(decision.decision, wallet.expected, `${venue.id}:${wallet.address}`);
      assert.equal(decision.allocation, wallet.expected === 'allow' ? 1_000 : 0);
      assert.equal(decision.evidence.wallet.toLowerCase(), wallet.address.toLowerCase());
    }
  }
});

test('the removed Fomo basis is disclosed instead of silently relabelled', () => {
  assert.match(panel.notice, /Fomo rows were removed/i);
  assert.match(panel.notice, /aggregate disagreed/i);
});
