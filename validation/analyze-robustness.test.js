import test from 'node:test';
import assert from 'node:assert/strict';
import { markdown, summarize } from './analyze-robustness.js';

const row = (wallet, from, to, pnl) => ({ wallet, window: { from, to }, data: { data: { realized_pnl_usd: pnl } } });

test('robustness summary separates windows and reports profitability without hiding losses', () => {
  const rows = [
    row('0x1111111111111111111111111111111111111111', '2026-09-01', '2026-09-08', -100),
    row('0x1111111111111111111111111111111111111111', '2026-09-08', '2026-09-15', 20),
    row('0x1111111111111111111111111111111111111111', '2026-08-16', '2026-09-15', -40),
  ];
  const summary = summarize(rows);
  assert.equal(summary.length, 2);
  assert.deepEqual(summary.find(item => item.days === 7), {
    wallet: '0x1111111111111111111111111111111111111111',
    days: 7,
    observations: 2,
    non_negative: 1,
    non_negative_rate: 0.5,
    median_pnl_usd: -40,
    min_pnl_usd: -100,
    max_pnl_usd: 20,
  });
  const report = markdown(summary, { rows: 3 });
  assert.match(report, /1\/2 \(50%\)/);
  assert.match(report, /not an unseen test set/);
});
