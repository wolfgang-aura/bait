import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appendObservation, completedObservationKeys, parseArgs, planSteps, runQuota, walletsOnDisk, DEFAULTS, ENCOUNTER_WALLET } from './quota.js';
import { BudgetExceeded } from './nansen.js';

const WALLETS = ['0x1111111111111111111111111111111111111111', ENCOUNTER_WALLET];

test('parseArgs reads the documented flags', () => {
  assert.deepEqual(parseArgs([]), { ...DEFAULTS, wallets: [] });
  const opts = parseArgs(['--max-calls', '10', '--daily-cap', '250', '--timeout', '9000', '--output', 'scratch/panel.jsonl', '--dry-run', '--wallet', ENCOUNTER_WALLET.toUpperCase()]);
  assert.equal(opts.maxCalls, 10);
  assert.equal(opts.dailyCap, 250);
  assert.equal(opts.timeoutMs, 9000);
  assert.equal(opts.dryRun, true);
  assert.equal(opts.output, path.resolve('scratch/panel.jsonl'));
  assert.deepEqual(opts.wallets, [ENCOUNTER_WALLET]);
});

test('parseArgs refuses bad input instead of silently defaulting', () => {
  for (const argv of [['--max-calls'], ['--max-calls', '0'], ['--max-calls', '-3'], ['--max-calls', 'abc'],
    ['--daily-cap', '1.5'], ['--output'], ['--wallet', 'not-an-address'], ['--nope']]) {
    assert.throws(() => parseArgs(argv), Error, `expected ${JSON.stringify(argv)} to throw`);
  }
});

test('the plan only uses endpoints the prototype actually reads', () => {
  const steps = planSteps(WALLETS, { now: new Date('2026-09-18T12:00:00Z'), rounds: 2 });
  assert.equal(steps.length, 2 * WALLETS.length * 2);
  assert.deepEqual([...new Set(steps.map(s => s.path))], ['profiler/perp-pnl-summary']);
  assert.ok(steps.every(s => /^0x[a-f0-9]{40}$/.test(s.body.address)));
  const windowDays = steps
    .filter(s => s.path === 'profiler/perp-pnl-summary')
    .map(s => Math.round((Date.parse(s.body.date.to) - Date.parse(s.body.date.from)) / 86400_000));
  assert.deepEqual([...new Set(windowDays)].sort((a, b) => a - b), [7, 30]);
  assert.equal(Date.parse(steps[0].body.date.to) - Date.parse(steps[WALLETS.length * 2].body.date.to), 7 * 86400_000);
});

test('walletsOnDisk puts the encounter wallet first and dedupes', () => {
  const wallets = walletsOnDisk();
  assert.equal(wallets[0], ENCOUNTER_WALLET);
  assert.equal(new Set(wallets).size, wallets.length);
  assert.ok(wallets.every(w => /^0x[a-f0-9]{40}$/.test(w)));
});

test('saved observations are resumable and keep the response body', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bait-quota-'));
  const output = path.join(dir, 'panel.jsonl');
  const step = planSteps([ENCOUNTER_WALLET], { now: new Date('2026-09-20T12:34:00Z'), rounds: 1 })[0];
  appendObservation(output, step, { data: { realized_pnl_usd: -42 } }, '2026-09-20T13:00:00Z');
  const row = JSON.parse(fs.readFileSync(output, 'utf8').trim());
  assert.equal(row.data.realized_pnl_usd, -42);
  assert.equal(completedObservationKeys(output).size, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

const harness = (overrides = {}) => {
  const lines = [];
  return {
    lines,
    opts: {
      wallets: WALLETS,
      accountCheck: async () => ({ plan: 'free', credits_remaining: 900 }),
      balance: () => ({ credits_remaining: 900, checked_at: '2026-09-18T12:00:00Z' }),
      stats: () => ({ calls_since: 61, successful_calls_since: 60, credits_used_total: 74, last_success_at: '2026-09-18T12:00:00Z' }),
      today: () => 0,
      log: l => lines.push(l),
      ...overrides,
    },
  };
};

test('--max-calls is the hard stop on a run', async () => {
  const calls = [];
  const h = harness({ maxCalls: 4, caller: async (p, body) => { calls.push(p); return { status: 200, data: {} }; } });
  const result = await runQuota(h.opts);
  assert.equal(calls.length, 4);
  assert.equal(result.attempted, 4);
  assert.equal(result.ok, 4);
  assert.equal(result.stoppedBy, '--max-calls 4');
  assert.ok(h.lines.some(l => l.includes('calls since 2026-09-14T00:00:00Z')));
  assert.ok(h.lines.some(l => l.includes('credits remaining    900')));
});

test('--daily-cap stops a run before it starts and mid-run', async () => {
  let calls = 0;
  const caller = async () => { calls += 1; return { status: 200, data: {} }; };
  const blocked = await runQuota(harness({ maxCalls: 50, dailyCap: 10, today: () => 10, caller }).opts);
  assert.equal(calls, 0);
  assert.match(blocked.stoppedBy, /daily cap/);

  calls = 0;
  const partial = await runQuota(harness({ maxCalls: 50, dailyCap: 10, today: () => 7, caller }).opts);
  assert.equal(calls, 3, 'only the three calls left under the daily cap');
  assert.equal(partial.stoppedBy, '--daily-cap 10');
});

test('a dry run plans without calling Nansen', async () => {
  let calls = 0;
  const h = harness({ maxCalls: 3, dryRun: true, caller: async () => { calls += 1; } , accountCheck: async () => { throw new Error('must not be called'); } });
  const result = await runQuota(h.opts);
  assert.equal(calls, 0);
  assert.equal(result.attempted, 3);
  assert.equal(h.lines.filter(l => l.includes('DRY-RUN')).length, 3);
});

test('a failing call is counted and reported, not swallowed', async () => {
  let n = 0;
  const h = harness({ maxCalls: 3, caller: async () => { n += 1; if (n === 2) throw new Error('Nansen 429 on profiler/perp-pnl-summary'); return { status: 200, data: {} }; } });
  const result = await runQuota(h.opts);
  assert.equal(result.attempted, 3);
  assert.equal(result.ok, 2);
  assert.equal(result.failed, 1);
  assert.match(result.errors[0], /429/);
  assert.ok(h.lines.some(l => l.includes('FAIL')));
});

test('a budget stop ends the run immediately', async () => {
  const h = harness({ maxCalls: 20, caller: async () => { throw new BudgetExceeded('Budget stop: cap reached'); } });
  const result = await runQuota(h.opts);
  assert.equal(result.attempted, 1);
  assert.equal(result.stoppedBy, 'credit budget');
});

test('a hung call is cut off by the per-step timeout', async () => {
  const h = harness({ maxCalls: 1, timeoutMs: 20, caller: () => new Promise(() => {}) });
  const result = await runQuota(h.opts);
  assert.equal(result.failed, 1);
  assert.match(result.errors[0], /timed out/);
});
