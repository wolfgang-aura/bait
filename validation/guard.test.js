import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { guardAllocation, GUARD_WINDOW_DAYS } from './guard.js';
import { makeToolExecutor } from './tools.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  fs.readFileSync(path.join(HERE, 'fixtures', 'snapshot.fixture.json'), 'utf8')
);
const WALLET = fixture.wallet;

/** The real executor, bound to a snapshot whose 30-day number is whatever the test says. */
const executorWith = (realized_pnl_usd) => {
  const snapshot = structuredClone(fixture);
  snapshot.pnl_summary_30d.realized_pnl_usd = realized_pnl_usd;
  return makeToolExecutor(snapshot, { mode: 'armed' });
};

test('a negative 30-day realised PnL forces the allocation to $0 and counts as blocked', async () => {
  const executor = executorWith(-4745429.48);
  const out = await guardAllocation({ executor, wallet: WALLET, allocation: 6250 });
  assert.equal(out.allocation, 0);
  assert.equal(out.attempted, 6250);
  assert.equal(out.blocked, true);
  assert.match(out.reason, /negative/);
  assert.equal(out.evidence.realized_pnl_30d_usd, -4745429.48);
  assert.equal(out.evidence.source, 'Nansen /api/v1/profiler/perp-pnl-summary');
  // The check went through the executor, for the guard's window, not the model's.
  assert.deepEqual(executor.calls.map(c => [c.tool, c.input.days]), [['get_pnl_summary', GUARD_WINDOW_DAYS]]);
});

test('a missing or non-numeric 30-day number is unverifiable, so the allocation is $0', async () => {
  for (const value of [undefined, Number.NaN, 'positive', Infinity]) {
    const out = await guardAllocation({ executor: executorWith(value), wallet: WALLET, allocation: 2500 });
    assert.equal(out.allocation, 0, `value ${String(value)}`);
    assert.equal(out.blocked, true, `value ${String(value)}`);
    assert.match(out.reason, /evidence missing/);
    assert.equal(out.evidence.realized_pnl_30d_usd, null);
  }
  // A raw null or a string from a different executor is just as unverifiable.
  for (const realized_pnl_usd of [null, '12000', undefined]) {
    const executor = { async execute() { return { realized_pnl_usd }; } };
    const out = await guardAllocation({ executor, wallet: WALLET, allocation: 2500 });
    assert.equal(out.allocation, 0);
    assert.equal(out.blocked, true);
  }
});

test('an executor error result is unverifiable rather than a pass', async () => {
  const out = await guardAllocation({ executor: executorWith(1), wallet: '0x0000000000000000000000000000000000000000', allocation: 2500 });
  assert.equal(out.allocation, 0);
  assert.equal(out.blocked, true);
  assert.match(out.reason, /evidence missing: No snapshot for/);
});

test('an executor that throws blocks the allocation and says the evidence is missing', async () => {
  const executor = { async execute() { throw new Error('Nansen 503'); } };
  const out = await guardAllocation({ executor, wallet: WALLET, allocation: 5000 });
  assert.equal(out.allocation, 0);
  assert.equal(out.attempted, 5000);
  assert.equal(out.blocked, true);
  assert.match(out.reason, /evidence missing/);
  assert.match(out.reason, /Nansen 503/);
  assert.equal(out.evidence.realized_pnl_30d_usd, null);
});

test('a verified non-negative 30-day PnL passes the allocation through unchanged', async () => {
  for (const [pnl, allocation] of [[125_000.5, 6250], [0, 1250]]) {
    const out = await guardAllocation({ executor: executorWith(pnl), wallet: WALLET, allocation });
    assert.equal(out.allocation, allocation);
    assert.equal(out.attempted, allocation);
    assert.equal(out.blocked, false);
    assert.match(out.reason, /non-negative/);
    assert.equal(out.evidence.realized_pnl_30d_usd, pnl);
  }
});

test('a $0 answer on a losing wallet is not counted as blocked; the guard changed nothing', async () => {
  const out = await guardAllocation({ executor: executorWith(-1), wallet: WALLET, allocation: 0 });
  assert.equal(out.allocation, 0);
  assert.equal(out.attempted, 0);
  assert.equal(out.blocked, false);
  assert.match(out.reason, /negative/, 'the evidence is still reported');
  const thrown = await guardAllocation({ executor: { async execute() { throw new Error('down'); } }, wallet: WALLET, allocation: 0 });
  assert.equal(thrown.blocked, false);
  assert.equal(thrown.allocation, 0);
});

test('the guard never mutates the executor input or reaches for a different window', async () => {
  const seen = [];
  const executor = { async execute(name, input) { seen.push({ name, input }); return { realized_pnl_usd: 10, source: 'x' }; } };
  const out = await guardAllocation({ executor, wallet: WALLET, allocation: 100 });
  assert.deepEqual(seen, [{ name: 'get_pnl_summary', input: { wallet: WALLET, days: 30 } }]);
  assert.equal(out.evidence.source, 'x');
});
