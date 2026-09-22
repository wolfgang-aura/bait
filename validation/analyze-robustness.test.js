import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateForwardHoldout, markdown, summarize, summarizeDynamics } from './analyze-robustness.js';

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

test('forward holdout matches a prior 30-day signal to a later seven-day outcome', () => {
  const wallet = '0x1111111111111111111111111111111111111111';
  const rows = [];
  for (let week = 0; week < 6; week += 1) {
    const at = new Date(Date.UTC(2026, 0, 1 + week * 7));
    const from30 = new Date(at.getTime() - 30 * 86400_000).toISOString();
    const to = at.toISOString();
    const next = new Date(at.getTime() + 7 * 86400_000).toISOString();
    rows.push(row(wallet, from30, to, week < 4 ? -10 : 10));
    rows.push(row(wallet, to, next, week === 4 ? -5 : 20));
  }
  const out = evaluateForwardHoldout(rows);
  assert.equal(out.wallets, 1);
  assert.equal(out.periods, 2, 'the latest third of six independent periods is held out');
  assert.equal(out.allowed, 2);
  assert.equal(out.allowed_profitable, 1);
  assert.equal(out.allowed_losing, 1);
  const report = markdown([], { forward: out });
  assert.match(report, /not an unseen-wallet test/);
  assert.match(report, /following week/);
});
