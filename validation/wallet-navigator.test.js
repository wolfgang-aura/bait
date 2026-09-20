import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { guardAllocation } from './guard.js';

const panel = JSON.parse(fs.readFileSync(new URL('./wallet-navigator.json', import.meta.url), 'utf8'));

test('wallet navigator contains five addresses per venue with a 3 allow / 2 block split', () => {
  assert.equal(panel.venues.length, 2);
  for (const venue of panel.venues) {
    assert.equal(venue.wallets.length, 5, venue.id);
    assert.equal(venue.wallets.filter(wallet => wallet.expected === 'allow').length, 3, venue.id);
    assert.equal(venue.wallets.filter(wallet => wallet.expected === 'block').length, 2, venue.id);
    assert.equal(new Set(venue.wallets.map(wallet => wallet.address.toLowerCase())).size, 5, venue.id);
  }
});

test('BAIT independently reproduces all ten recorded wallet decisions', async () => {
  for (const venue of panel.venues) {
    for (const wallet of venue.wallets) {
      const decision = await guardAllocation({
        executor: { execute: async () => wallet.evidence },
        wallet: wallet.address,
        allocation: 1_000,
        policy: {
          id: `wallet-realized-pnl-30d-${venue.id}-recorded-v1`,
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

test('Fomo rows disclose headline-versus-realised disagreement instead of hiding it', () => {
  const fomo = panel.venues.find(venue => venue.id === 'fomo');
  const misleading = fomo.wallets.filter(wallet => wallet.headline_pnl_usd > 0 && wallet.evidence.realized_pnl_usd < 0);
  assert.equal(misleading.length, 2);
  assert.match(fomo.coverage_note, /not every chain/i);
});
