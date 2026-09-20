import test from 'node:test';
import assert from 'node:assert/strict';
import { markdown, summarize, summarizeDynamics } from './analyze-robustness.js';

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

test('robustness dynamics count matched-window disagreements and chronological sign flips', () => {
  const rows = [
    row('0x1111111111111111111111111111111111111111', '2026-09-01', '2026-09-08', 10),
    row('0x1111111111111111111111111111111111111111', '2026-08-09', '2026-09-08', -20),
    row('0x1111111111111111111111111111111111111111', '2026-09-02', '2026-09-09', -5),
    row('0x1111111111111111111111111111111111111111', '2026-08-10', '2026-09-09', -30),
  ];
  const dynamics = summarizeDynamics(rows);
  assert.deepEqual(dynamics, {
    matched_pairs: 2,
    window_disagreements: 1,
    transitions: 2,
    sign_flips: 1,
    series: 2,
    series_with_flip: 1,
  });
  const report = markdown(summarize(rows), { rows: rows.length, dynamics });
  assert.match(report, /disagreed on 1 of 2/);
  assert.match(report, /sign flipped on 1 of 2/);
});
