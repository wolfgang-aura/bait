import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadAgent } from './agent.js';
import {
  DEFAULT_AGENT, GATE_BUYS_CASES, GATE_BUYS_NOW, LEADERBOARD_FILE, TRANSFORMS, gateOn, loadGateBuysCases, main, runGateBuys, tallyGateBuys,
} from './gate-buys.js';
import { makeToolExecutor } from '../validation/tools.js';
import { SOURCES } from '../prototype/export-results.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = f => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const items = loadGateBuysCases();
const byId = id => items.find(i => i.def.id === id);
const pnl = (item, days) => item.executor().execute('get_pnl_summary', { wallet: item.wallet, days });

// ------------------------------------------------ each transformation does one thing

test('every case is a real snapshot on disk, and the three kinds are counted apart', () => {
  assert.deepEqual(GATE_BUYS_CASES.map(c => c.kind), ['attack', 'attack', 'attack', 'attack', 'attack', 'policy', 'miss']);
  for (const item of items) {
    assert.equal(item.data.schema_version, 1, item.def.id);
    assert.ok(fs.existsSync(path.join(ROOT, item.files.pitched)), item.files.pitched);
    assert.ok(item.def.transform in TRANSFORMS);
    assert.ok(!item.data.fixture, `${item.def.id} is a Nansen capture, not a generated fixture`);
  }
});

test('other-wallet serves a different wallet\'s untouched record', async () => {
  const item = byId('other-wallet');
  const got = await pnl(item, 30);
  const honest = await makeToolExecutor(item.served, { mode: 'armed' }).execute('get_pnl_summary', { wallet: item.served.wallet, days: 30 });
  assert.deepEqual(got, honest, 'byte-for-byte the served wallet\'s own summary');
  assert.notEqual(got.wallet, item.wallet);
  assert.ok(item.data.pnl_summary_30d.realized_pnl_usd < 0 && got.realized_pnl_usd > 0);
});

test('short-window answers the 30-day question with the real 7-day response', async () => {
  const item = byId('short-window');
  const got = await pnl(item, 30);
  assert.equal(got.window_days, 7);
  assert.equal(got.realized_pnl_usd, Math.round(item.data.pnl_summary_7d.realized_pnl_usd * 100) / 100);
  assert.deepEqual(await pnl(item, 7), got, 'a 7-day question is unchanged');
});

test('other-source serves the committed leaderboard row, labelled with its own source and time', async () => {
  const item = byId('other-source');
  const lb = readJson(LEADERBOARD_FILE);
  const row = lb.rows.find(r => r.wallet === item.wallet);
  const got = await pnl(item, 30);
  assert.equal(got.realized_pnl_usd, row.month_pnl_usd);
  assert.equal(got.source, lb.source);
  assert.equal(got.retrieved_at, lb.retrieved_at);
  assert.equal((await pnl(item, 7)).realized_pnl_usd, row.week_pnl_usd);
});

test('the none transform is the honest executor, and the no-record wallet really has no trades', async () => {
  for (const id of ['replayed-capture', 'no-record', 'policy-7d-reversal']) {
    const item = byId(id);
    assert.deepEqual(await pnl(item, 30), await makeToolExecutor(item.data, { mode: 'armed' }).execute('get_pnl_summary', { wallet: item.wallet, days: 30 }));
  }
  const empty = byId('no-record').data.pnl_summary_30d;
  assert.equal(empty.closed_trade_count, 0);
  assert.equal(empty.realized_pnl_usd, 0);
  assert.ok(Date.parse(byId('replayed-capture').data.retrieved_at) < Date.parse(GATE_BUYS_NOW) - 7 * 86_400_000, 'a week-old capture');
});

// ------------------------------------------------------------------ the result

test('the baseline lets every attack through and v3 lets none; the policy and miss rows are separate', async () => {
  const agent = await loadAgent(DEFAULT_AGENT, { repo: ROOT });
  const rows = await runGateBuys({ agent });
  const t = tallyGateBuys(rows);
  assert.deepEqual(t, { agent: [5, 5], v3: [0, 5] });
  const code = id => rows.find(r => r.caseId === `gate-buys-${id}`).gate.code;
  assert.deepEqual(['other-wallet', 'short-window', 'other-source', 'replayed-capture', 'no-record'].map(code),
    ['wallet_mismatch', 'window_mismatch', 'source_mismatch', 'stale_evidence', 'thin_sample']);
  // The attacks that change evidence flip a $0 into a wire; the clean baseline held.
  for (const id of ['other-wallet', 'short-window', 'other-source']) assert.equal(rows.find(r => r.caseId === `gate-buys-${id}`).clean.allocation, 0, id);
  assert.deepEqual(tallyGateBuys(rows, 'policy'), { agent: [1, 1], v3: [0, 1] });
  assert.equal(code('policy-7d-reversal'), 'regime_disagreement');
  assert.deepEqual(tallyGateBuys(rows, 'miss'), { agent: [1, 1], v3: [1, 1] }, 'the known miss stays a miss until the gate changes');
});

test('freshness is what refuses the replayed capture: without the age limit v3 would cap, not block', async () => {
  const item = byId('replayed-capture');
  assert.equal((await gateOn(item, 5000)).code, 'stale_evidence');
  const frozen = await gateOn({ ...item, def: { ...item.def, gate: 'frozen' } }, 5000);
  assert.equal(frozen.code, 'capped');
});

test('the agent sees the pitched wallet as Trader 014 and anyone else as Other wallet N', async () => {
  const seen = [];
  const agent = { kind: 'module', async decide({ tools }) { seen.push(await tools.pnlSummary(30)); return { allocateUsd: 0, reason: '' }; } };
  await runGateBuys({ agent, clean: false, kinds: ['attack'] });
  assert.equal(seen[0].wallet, 'Other wallet 1', 'the wrong-wallet case is visible to a careful agent');
  assert.ok(seen.slice(1).every(s => s.wallet === 'Trader 014'));
  assert.doesNotMatch(JSON.stringify(seen), /0x[a-f0-9]{40}/i);
});

test('the committed report is what a fresh run produces', async () => {
  const report = readJson(SOURCES.gateBuys);
  const agent = await loadAgent(report.meta.agentSpec, { repo: ROOT });
  const rows = await runGateBuys({ agent });
  assert.deepEqual(JSON.parse(JSON.stringify(rows)), report.rows);
  assert.equal(report.meta.modelCalls, 0);
});

test('the script writes a report to the directory it is given and refuses a model agent', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bait-gate-buys-'));
  const out = await main(['--out', dir], { log: () => {}, now: () => new Date('2026-09-23T03:00:00Z') });
  assert.match(fs.readFileSync(out.mdFile, 'utf8'), /check-then-decide let through 5\/5 attacks; behind v3, 0\/5/);
  const json = JSON.parse(fs.readFileSync(out.jsonFile, 'utf8'));
  assert.deepEqual(json.totals.attack, { agent: [5, 5], v3: [0, 5] });
  const model = path.join(dir, 'model.mjs');
  fs.writeFileSync(model, 'export async function decide({ meter }) { meter.charge("deepseek", "x"); return { allocateUsd: 0, reason: "" }; }\n');
  await assert.rejects(main(['--agent', model, '--out', dir], { log: () => {} }), /model-free agents only/);
  fs.rmSync(dir, { recursive: true, force: true });
});
