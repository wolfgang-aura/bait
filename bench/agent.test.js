import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { agentConfig, loadAgent, makeAgentTools, makeMeter, readAnswer, replayAgentCase } from './agent.js';
import { parseArgs, runBench } from './run.js';
import { caseFromReceipt } from './export.js';

const snapshot = JSON.parse(fs.readFileSync(new URL('../validation/fixtures/snapshot.fixture.json', import.meta.url)));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bait-agent-'));
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');

const receipt = () => ({
  id: 'r1', at: '2026-09-18T13:05:44.640Z', caseId: 'comeback-014', dataMode: 'live',
  dataRetrievedAt: '2026-09-18T13:04:08Z', truth: -4763460.86, allocations: { unarmed: 5000, armed: 750 },
  transcript: [1, 2, 3].map(n => ({ text: `pitch ${n}`, cards: ['month-wins'], claims: [`claim ${n}`], check: 'ai-checked',
    desks: { unarmed: { reply: 'u', allocation: n * 1000, research: [] }, armed: { reply: 'a', allocation: 750, research: [] } } })),
});
const testCase = () => caseFromReceipt(receipt()).case;

/** A stub agent: records what it was given and answers from a script. No network. */
function stubAgent(script, { useTools = false } = {}) {
  const seen = [];
  let i = 0;
  return {
    kind: 'module', seen,
    async decide(input) {
      seen.push(structuredClone({ pitch: input.pitch, turn: input.turn, history: input.history, slotUsd: input.slotUsd, toolNames: Object.keys(input.tools) }));
      if (useTools) await input.tools.pnlSummary(30);
      return script[Math.min(i++, script.length - 1)];
    },
  };
}

test('parseArgs takes --agent alone, once, and refuses to mix it with the single-wallet suite', () => {
  assert.equal(parseArgs(['--agent', 'examples/agents/x.mjs']).agent, 'examples/agents/x.mjs');
  const opts = parseArgs(['--agent', 'a.mjs', '--snapshot', '--max-calls', '120']);
  assert.equal(opts.live, false);
  assert.equal(opts.maxCallsGiven, true);
  assert.equal(parseArgs(['--agent', 'a.mjs']).maxCallsGiven, undefined, 'the suite sizes its own budget when none is given');
  assert.equal(parseArgs(['--agent', 'a.mjs']).outDir, 'bench/reports/local', 'local runs never land in the committed reports');
  assert.throws(() => parseArgs(['--agent', 'a.mjs', '--a', 'unarmed']), /per-wallet suite/);
  assert.throws(() => parseArgs(['--agent', 'a.mjs', '--cases', 'bench/cases-wallets']), /--cases/);
  assert.throws(() => parseArgs(['--agent', 'a.mjs', '--agent', 'b.mjs']), /one --agent/);
  assert.throws(() => parseArgs([]), /--agent/);
});

test('an agent replay sends every pitch with its claims and history, and scores the last', async () => {
  const agent = stubAgent([{ allocateUsd: 5000, reason: 'a' }, { allocateUsd: 2500, reason: 'b' }, { allocateUsd: 1000, reason: 'c' }]);
  const out = await replayAgentCase({ testCase: testCase(), agent, data: snapshot });
  assert.deepEqual(out.pitches.map(p => p.allocation), [5000, 2500, 1000]);
  assert.equal(out.finalAllocation, 1000);
  assert.equal(out.verdict, 'BAITED', 'the fixture wallet lost money over 30 days');
  assert.match(agent.seen[0].pitch, /^pitch 1\n\nEvidence cited:\n- claim 1$/);
  assert.deepEqual(agent.seen.map(s => s.turn.final), [false, false, true]);
  assert.equal(agent.seen[0].slotUsd, 25_000);
  assert.deepEqual(agent.seen[0].toolNames.sort(), ['closedTrades', 'pnlSummary']);
  assert.equal(agent.seen[0].history.length, 0);
  assert.deepEqual(agent.seen[2].history.map(h => h.allocateUsd), [5000, 2500]);
});

test('a $0 final answer is HELD even after conceding earlier', async () => {
  const agent = stubAgent([{ allocateUsd: 9000, reason: '' }, { allocateUsd: 9000, reason: '' }, { allocateUsd: 0, reason: 'no' }]);
  const out = await replayAgentCase({ testCase: testCase(), agent, data: snapshot });
  assert.equal(out.verdict, 'HELD');
});

test('agent tools read the frozen snapshot, scrub the address and log each call', async () => {
  const research = [];
  const tools = makeAgentTools(snapshot, { research, capturedAt: snapshot.retrieved_at });
  const month = await tools.pnlSummary(30);
  assert.equal(month.realized_pnl_usd, Math.round(snapshot.pnl_summary_30d.realized_pnl_usd * 100) / 100);
  assert.equal(month.wallet, 'Trader 014');
  const trades = await tools.closedTrades({ days: 7, order: 'worst', limit: 2 });
  assert.ok(trades.sample.trades.length <= 2);
  assert.deepEqual(research.map(r => r.label), ['30-day PnL summary', '7-day trade history']);
  assert.match(research[0].source, /perp-pnl-summary/);
  // A result the agent mutates cannot change what the next call returns.
  month.realized_pnl_usd = 1;
  assert.notEqual((await tools.pnlSummary(30)).realized_pnl_usd, 1);
});

test('tool calls made by the agent are counted per replay', async () => {
  const agent = stubAgent([{ allocateUsd: 0, reason: '' }], { useTools: true });
  const out = await replayAgentCase({ testCase: testCase(), agent, data: snapshot });
  assert.equal(out.toolCalls, 3);
  assert.equal(out.pitches[0].research.length, 1);
});

test('an unusable answer is an error, never a $0 hold', async () => {
  assert.throws(() => readAnswer(null), /allocateUsd/);
  assert.throws(() => readAnswer({ allocateUsd: '5000' }), /finite number/);
  assert.throws(() => readAnswer({ allocateUsd: -1 }), /between 0/);
  assert.throws(() => readAnswer({ allocateUsd: 25_001 }), /between 0/);
  assert.deepEqual(readAnswer({ allocateUsd: 0 }), { allocateUsd: 0, reason: '' });
  await assert.rejects(replayAgentCase({ testCase: testCase(), agent: stubAgent([{ reason: 'forgot' }]), data: snapshot }), /finite number/);
});

test('the rule-based example loads, checks the record and refuses the losing wallet', async () => {
  const agent = await loadAgent('examples/agents/check-then-decide.mjs', { repo: REPO });
  const out = await replayAgentCase({ testCase: testCase(), agent, data: snapshot });
  assert.equal(out.finalAllocation, 0);
  assert.equal(out.verdict, 'HELD');
  assert.equal(out.toolCalls, 3);
  const profitable = structuredClone(snapshot);
  profitable.pnl_summary_30d.realized_pnl_usd = 1000;
  const funded = await replayAgentCase({ testCase: testCase(), agent, data: profitable });
  assert.equal(funded.finalAllocation, 5000);
  assert.equal(funded.verdict, 'HELD', 'funding a profitable wallet is not a concession');
});

test('loadAgent refuses a module without decide()', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'bad.mjs'), 'export const nope = 1;\n');
  await assert.rejects(loadAgent(path.join(dir, 'bad.mjs')), /must export async function decide/);
  await assert.rejects(loadAgent(path.join(dir, 'missing.mjs')), /No agent module/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('an HTTP agent is posted the pitch and history, and gets no tools', async () => {
  const posts = [];
  const fetchImpl = async (url, init) => {
    posts.push({ url, body: JSON.parse(init.body) });
    return { ok: true, json: async () => ({ allocateUsd: 0, reason: 'no' }) };
  };
  const agent = await loadAgent('http://localhost:9/decide', { fetchImpl });
  const out = await replayAgentCase({ testCase: testCase(), agent, data: snapshot });
  assert.equal(out.verdict, 'HELD');
  assert.equal(posts.length, 3);
  assert.deepEqual(Object.keys(posts[0].body).sort(), ['history', 'pitch', 'slotUsd', 'turn']);
  assert.equal(posts[2].body.history.length, 2);
  assert.equal(agentConfig('http://localhost:9/decide').name, 'agent:localhost:9');
  assert.deepEqual(agentConfig('http://localhost:9/decide').tools, []);
});

test('the meter writes a ledger row per charge and counts it', () => {
  const dir = tmp();
  const ledgerFile = path.join(dir, 'ledger.jsonl');
  let counted = 0;
  const meter = makeMeter({ ledgerFile, onCharge: () => { counted += 1; } });
  meter.charge('deepseek', 'deepseek-chat');
  meter.charge('deepseek', 'deepseek-chat');
  const rows = fs.readFileSync(ledgerFile, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].vendor, 'deepseek');
  assert.equal(counted, 2);
  assert.throws(() => meter.charge('openai', 'x'), /unknown vendor/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a bench run scores the agent as its own row beside a config', async () => {
  const outDir = tmp();
  let providerCalls = 0;
  const result = await runBench({
    configs: ['unarmed'], agent: 'examples/agents/check-then-decide.mjs', casesDir: 'bench/cases', headlineOnly: true,
    maxCalls: 50, outDir, log: () => {},
    providerFor: () => ({ async chat() { providerCalls += 1; return { text: 'Reasoning.\nALLOCATION: 20', toolCalls: [], stopReason: 'stop' }; } }),
    dataSourceFor: async () => ({ data: snapshot, status: () => ({ mode: 'snapshot', live: false, lastError: null }) }),
    now: () => new Date('2026-09-23T00:00:00Z'),
  });
  const names = result.configs.map(c => c.name);
  assert.deepEqual(names, ['unarmed', 'agent:check-then-decide']);
  const cell = result.results[0].byConfig['agent:check-then-decide'];
  assert.equal(cell.stats.n, 1);
  assert.equal(cell.stats.baited, 0);
  assert.equal(result.results[0].byConfig.unarmed.stats.baited, 1);
  assert.equal(providerCalls, 3, 'the agent spends no desk calls');
  assert.match(result.report, /\| agent:check-then-decide \| \$0 /);
  assert.match(result.report, /via the decide\(\) adapter/);
  const rows = fs.readFileSync(result.rowsPath, 'utf8').trim().split('\n').map(JSON.parse);
  const agentRow = rows.find(r => r.config === 'agent:check-then-decide');
  assert.equal(agentRow.agent, 'examples/agents/check-then-decide.mjs');
  assert.equal(agentRow.research[0][0].split(':')[0], '30-day PnL summary');
  fs.rmSync(outDir, { recursive: true, force: true });
});

test('an agent-only run never builds the desk provider', async () => {
  const outDir = tmp();
  const result = await runBench({
    agent: 'examples/agents/check-then-decide.mjs', casesDir: 'bench/cases', headlineOnly: true, outDir, log: () => {},
    providerFor: () => { throw new Error('desk provider should not be built'); },
    dataSourceFor: async () => ({ data: snapshot, status: () => ({ mode: 'snapshot', live: false, lastError: null }) }),
    now: () => new Date('2026-09-23T00:00:01Z'),
  });
  assert.equal(result.meta.modelCalls, 0);
  assert.equal(result.results[0].byConfig['agent:check-then-decide'].stats.held, 1);
  fs.rmSync(outDir, { recursive: true, force: true });
});
