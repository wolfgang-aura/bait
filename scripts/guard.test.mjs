/**
 * CLI contract for `npm run guard`. No network: the Nansen call is injected.
 *
 * The exit code is the integration surface. A shell that reads 0 may allocate; every
 * other code means it may not.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { USAGE, main, parseArgs } from './guard.mjs';

const WALLET = '0xc26cbb6483229e0d0f9a1cab675271eda535b8f4';
const NOW = () => new Date('2026-09-21T09:00:00.000Z');
const ENV = { NANSEN_API_KEY: 'test-key' };

/** Every window answers with the same numbers unless a test says otherwise. */
const pnl = (realized_pnl_usd, extra = { win_rate: 0.54, closed_trade_count: 4007 }) =>
  async () => ({ status: 200, headers: {}, data: { data: { realized_pnl_usd, ...extra } } });

function capture() {
  let text = '';
  return { write: chunk => { text += chunk; }, text: () => text };
}

test('parseArgs reads the wallet, the amount and the json flag', () => {
  assert.deepEqual(parseArgs(['--wallet', WALLET, '--allocation', '5000', '--json']), {
    wallet: WALLET, allocation: 5000, json: true, timeoutMs: 10_000, policy: 'v4',
  });
  assert.equal(parseArgs(['--wallet', WALLET, '--allocation', '5000', '--timeout', '2500']).timeoutMs, 2500);
  assert.equal(parseArgs(['--wallet', WALLET, '--allocation', '5000', '--policy', 'v1']).policy, 'v1');
  assert.equal(parseArgs(['--wallet', WALLET, '--allocation', '5000', '--policy', 'v4']).policy, 'v4');
  assert.match(parseArgs(['--wallet', WALLET, '--allocation', '5000', '--policy', 'v5']).error, /--policy must be v1, v2, v3 or v4/);
});

test('parseArgs refuses missing, unknown and non-numeric arguments', () => {
  assert.match(parseArgs([]).error, /--wallet is required/);
  assert.match(parseArgs(['--wallet', WALLET]).error, /--allocation is required/);
  assert.match(parseArgs(['--wallet', WALLET, '--allocation', 'lots']).error, /non-negative number/);
  assert.match(parseArgs(['--wallet', WALLET, '--allocation', '-5']).error, /non-negative number/);
  assert.match(parseArgs(['--walet', WALLET]).error, /Unknown argument/);
  assert.match(parseArgs(['--wallet']).error, /needs a value/);
  assert.match(parseArgs(['--wallet', WALLET, '--allocation', '5000', '--timeout', '0']).error, /positive number/);
});

test('a bad invocation prints the usage line and exits 2, never 0', async () => {
  const out = capture();
  const code = await main({ argv: ['--allocation', '5000'], env: ENV, write: out.write, now: NOW, call: pnl(1) });
  assert.equal(code, 2);
  assert.match(out.text(), /--wallet is required/);
  assert.ok(out.text().includes(USAGE));
});

test('a missing API key exits 3 with the one-line fix and makes no call', async () => {
  const out = capture();
  let called = 0;
  const code = await main({
    argv: ['--wallet', WALLET, '--allocation', '5000'],
    env: {},
    write: out.write,
    now: NOW,
    call: async () => { called += 1; return { data: { data: { realized_pnl_usd: 1 } } }; },
  });
  assert.equal(code, 3);
  assert.equal(called, 0);
  assert.match(out.text(), /NANSEN_API_KEY=<your key> to \.env/);
});

test('a profitable wallet prints ALLOW, the enforced amount and the credit line, and exits 0', async () => {
  const out = capture();
  const code = await main({
    argv: ['--wallet', WALLET, '--allocation', '5000'],
    env: ENV, write: out.write, now: NOW, call: pnl(2_450_809.467724999),
  });
  assert.equal(code, 0);
  assert.match(out.text(), /Fetching Nansen 7- and 30-day PnL summary and open positions, then smart money \(perp-screener\) and a second record \(perp-leaderboard\), at most 9 credits\.\.\./);
  assert.match(out.text(), /DECISION\s+ALLOW/);
  assert.match(out.text(), /enforced\s+\$5,000\.00/);
  assert.match(out.text(), /pnl 30d\s+\$2,450,809\.47/);
  assert.match(out.text(), /pnl 7d\s+\$2,450,809\.47/);
  // Two windows, the open positions and v4's leaderboard record (the stub holds no position,
  // so no screener read): eight credits, and the named check table.
  assert.match(out.text(), /credits\s+8 charged/);
  assert.match(out.text(), /policy\s+wallet-copy-risk-v4/);
  assert.match(out.text(), /CHECKS/);
  assert.match(out.text(), /PASS regime_agreement/);
  assert.match(out.text(), /PASS thin_sample/);
  assert.match(out.text(), /-  max_drawdown/);
});

test('--policy v1 reruns the recorded one-window rule at one credit', async () => {
  const out = capture();
  const code = await main({
    argv: ['--wallet', WALLET, '--allocation', '5000', '--policy', 'v1'],
    env: ENV, write: out.write, now: NOW, call: pnl(2_450_809.467724999),
  });
  assert.equal(code, 0);
  assert.match(out.text(), /Fetching Nansen 30-day PnL summary, at most 1 credit\.\.\./);
  assert.match(out.text(), /credits\s+1 charged/);
  assert.match(out.text(), /policy\s+wallet-realized-pnl-30d-v1/);
});

test('a 7-day window that contradicts the 30-day window blocks with a named reason', async () => {
  const out = capture();
  let n = 0;
  const code = await main({
    argv: ['--wallet', WALLET, '--allocation', '5000'],
    env: ENV, write: out.write, now: NOW,
    call: async () => ({ status: 200, headers: {}, data: { data: {
      realized_pnl_usd: ++n === 1 ? 900_000 : -120_000, win_rate: 0.54, closed_trade_count: 4007,
    } } }),
  });
  assert.equal(code, 2);
  assert.match(out.text(), /code\s+regime_disagreement/);
  assert.match(out.text(), /enforced\s+\$0\.00/);
  assert.match(out.text(), /FAIL regime_agreement/);
});

test('a losing wallet prints BLOCK with a zero enforced amount and exits 2', async () => {
  const out = capture();
  const code = await main({
    argv: ['--wallet', WALLET, '--allocation', '5000'],
    env: ENV, write: out.write, now: NOW, call: pnl(-4_745_429.48),
  });
  assert.equal(code, 2);
  assert.match(out.text(), /DECISION\s+BLOCK/);
  assert.match(out.text(), /code\s+pnl_below_minimum/);
  assert.match(out.text(), /enforced\s+\$0\.00/);
  assert.match(out.text(), /pnl 30d\s+-\$4,745,429\.48/);
});

test('a provider failure exits 2 with a blocked decision, not 0 and not a crash', async () => {
  const out = capture();
  const code = await main({
    argv: ['--wallet', WALLET, '--allocation', '5000'],
    env: ENV, write: out.write, now: NOW,
    call: async () => { throw new Error('Nansen 503 on profiler/perp-pnl-summary'); },
  });
  assert.equal(code, 2);
  assert.match(out.text(), /DECISION\s+BLOCK/);
  assert.match(out.text(), /code\s+evidence_unavailable/);
  assert.match(out.text(), /enforced\s+\$0\.00/);
});

test('--json prints the decision object only and keeps the same exit code', async () => {
  const out = capture();
  const code = await main({
    argv: ['--wallet', WALLET, '--allocation', '5000', '--json'],
    env: ENV, write: out.write, now: NOW, call: pnl(-1),
  });
  assert.equal(code, 2);
  const printed = out.text().slice(out.text().indexOf('{'));
  const decision = JSON.parse(printed);
  assert.equal(decision.decision, 'block');
  assert.equal(decision.allocation, 0);
  assert.equal(decision.evidence.source, 'Nansen /api/v1/profiler/perp-pnl-summary');
  // The 30-day window already refused, so the second window was never bought.
  assert.equal(decision.creditsCharged, 1);
  assert.equal(decision.execution_authorized, false);
  assert.ok(Array.isArray(decision.checks) && decision.checks.length > 0);
});

test('the guard deadline is honoured, so a hanging provider cannot hang the command', async () => {
  const out = capture();
  const code = await main({
    argv: ['--wallet', WALLET, '--allocation', '5000', '--timeout', '30'],
    env: ENV, write: out.write, now: NOW,
    call: () => new Promise(resolve => setTimeout(resolve, 5000).unref?.()),
  });
  assert.equal(code, 2);
  assert.match(out.text(), /code\s+evidence_timeout/);
});
