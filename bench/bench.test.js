import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  caseFromReceipt, caseFromLabRun, collectCases, windowFor, writeCases, HEADLINE_ALLOCATIONS, REFEREE_RULE,
} from './export.js';
import { parseArgs, validateConfig, loadConfig, loadCases, formatTable, formatSummary, formatReport, replayCase, runBench, summarize, summarizeConfig, loadResume, DEFAULTS } from './run.js';

const snapshot = JSON.parse(fs.readFileSync(new URL('../validation/fixtures/snapshot.fixture.json', import.meta.url)));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bait-bench-'));

const receipt = (over = {}) => ({
  id: 'r1', at: '2026-09-18T13:05:44.640Z', caseId: 'comeback-014', dataMode: 'live',
  dataRetrievedAt: '2026-09-18T13:04:08Z', truth: -4763460.86,
  allocations: { unarmed: 5000, armed: 750 },
  transcript: [1, 2, 3].map(n => ({
    text: `pitch ${n}`, cards: ['month-wins'], claims: [`claim ${n}`], check: 'ai-checked',
    desks: { unarmed: { reply: 'u', allocation: n * 1000, research: [] }, armed: { reply: 'a', allocation: 750, research: [] } },
  })),
  ...over,
});

// ------------------------------------------------------------------ exporter

test('a three-pitch receipt becomes a case with pitches, claims, wallet and rule', () => {
  const { case: c } = caseFromReceipt(receipt(), 'scratch/encounters/r1.json');
  assert.equal(c.source, 'encounter-receipt');
  assert.equal(c.pitches.length, 3);
  assert.deepEqual(c.pitches[0], { n: 1, text: 'pitch 1', cards: ['month-wins'], claims: ['claim 1'], check: 'ai-checked' });
  assert.equal(c.wallet, '0xc26cbb6483229e0d0f9a1cab675271eda535b8f4');
  assert.equal(c.refereeRule, REFEREE_RULE);
  assert.equal(c.slotUsd, 25_000);
  assert.equal(c.window.to, '2026-09-18T13:04:08Z');
  assert.equal(c.window.from, '2026-08-19T13:04:08Z');
  assert.deepEqual(c.desksRecorded, ['unarmed', 'armed']);
});

test('the milestone 2 round is the headline case and nothing else is', () => {
  assert.equal(caseFromReceipt(receipt()).case.headline, true);
  assert.deepEqual(HEADLINE_ALLOCATIONS, { unarmed: 5000, armed: 750 });
  const other = receipt({ allocations: { unarmed: 0, armed: 0 } });
  assert.equal(caseFromReceipt(other).case.headline, false);
});

test('incomplete rounds are skipped with a reason, never half-exported', () => {
  assert.match(caseFromReceipt(receipt({ transcript: [{ text: 'one' }] })).skipped, /1 of 3/);
  assert.match(caseFromReceipt({ transcript: [] }).skipped, /0 of 3/);
  const noText = receipt();
  noText.transcript[1] = { ...noText.transcript[1], text: undefined };
  assert.match(caseFromReceipt(noText).skipped, /no text/);
});

test('a single-desk receipt still exports, recorded under armed', () => {
  const old = { at: '2026-09-16T11:29:34.843Z', truth: -4745429.48, allocation: 0,
    transcript: [1, 2, 3].map(n => ({ text: `p${n}`, cards: ['week-pnl'], claims: ['c'], allocation: 0 })) };
  const { case: c } = caseFromReceipt(old, 'f.json');
  assert.deepEqual(c.desksRecorded, ['armed']);
  assert.equal(c.headline, false);
  assert.equal(c.dataMode, 'snapshot');
});

test('lab runs export only under R1 and only with three messages', () => {
  const run = { id: 'x', rule: 'R1_allocator', mode: 'unarmed', wallet: '0xabc', snapshot_retrieved_at: '2026-09-15T10:40:31Z',
    pitch_messages: ['a', 'b', 'c'], decision: { allocation_usd: 5000 }, referee: { rule: 'allocator_slot_fill', evidence: { realized_pnl_30d_usd: -4745429.48 } } };
  const { case: c } = caseFromLabRun(run, 'prototype/runs/x.json');
  assert.equal(c.source, 'lab-run');
  assert.equal(c.refereeRule, REFEREE_RULE, 'scored with the game referee so sources are comparable');
  assert.equal(c.labRefereeRule, 'allocator_slot_fill');
  assert.equal(c.pitches[1].text, 'b');
  assert.match(caseFromLabRun({ ...run, rule: 'R2_forced_choice' }).skipped, /R2/);
  assert.match(caseFromLabRun({ ...run, pitch_messages: ['a'] }).skipped, /1 of 3/);
});

test('windowFor derives a 30-day window and refuses a bad timestamp', () => {
  assert.deepEqual(windowFor('2026-09-18T00:00:00Z'), { from: '2026-08-19T00:00:00Z', to: '2026-09-18T00:00:00Z', derived: true });
  assert.equal(windowFor('not a date'), null);
});

test('the real repository exports a headline case and deduplicates lab pitches', () => {
  const { cases, skipped } = collectCases();
  assert.ok(cases.length > 0);
  assert.equal(cases.filter(c => c.headline).length, 1, 'exactly one headline case');
  assert.equal(cases[0].headline, true, 'headline sorts first');
  assert.deepEqual(cases[0].recordedAllocations, HEADLINE_ALLOCATIONS);
  assert.ok(skipped.some(s => /duplicate/.test(s.reason)), 'repeated lab pitches collapse to one case');
  for (const c of cases) {
    assert.equal(c.pitches.length, 3);
    assert.ok(c.window && c.window.from < c.window.to);
    assert.match(c.sourceFile, /^(bench[\\/]receipts|prototype[\\/]runs)[\\/]/,
      'every shipped case names a tracked source');
  }
});

test('writeCases clears stale files so a rename cannot leave a ghost case', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'ghost.json'), '{}');
  writeCases([caseFromReceipt(receipt()).case], dir);
  const files = fs.readdirSync(dir);
  assert.equal(files.length, 1);
  assert.match(files[0], /^00-headline-/);
  fs.rmSync(dir, { recursive: true, force: true });
});

// -------------------------------------------------------------------- args

test('parseArgs accepts one config or distinct comparisons and validates numbers', () => {
  const opts = parseArgs(['--a', 'unarmed', '--b', 'armed-basic', '--cases', 'bench/cases', '--model', 'deepseek-chat', '--max-calls', '20']);
  assert.deepEqual(opts.configs, ['unarmed', 'armed-basic']);
  assert.equal(opts.maxCalls, 20);
  assert.equal(opts.casesDir, 'bench/cases');
  assert.equal(parseArgs(['--a', 'a', '--b', 'b', '--headline-only']).headlineOnly, true);
  assert.equal(parseArgs(['--a', 'a', '--b', 'b', '--snapshot']).live, false);
  assert.equal(parseArgs(['--a', 'a', '--b', 'b', '--config', 'c']).configs.length, 3);
  assert.deepEqual(parseArgs(['--config', 'armed-strict']).configs, ['armed-strict']);
  for (const argv of [[], ['--a', 'x', '--b', 'x'], ['--a', 'x', '--b', 'y', '--max-calls', '0'],
    ['--a', 'x', '--b', 'y', '--max-calls', '--model'], ['--a', 'x', '--b', 'y', '--nope']]) {
    assert.throws(() => parseArgs(argv), Error, `expected ${JSON.stringify(argv)} to throw`);
  }
});

// ------------------------------------------------------------------ configs

test('every shipped config is valid', () => {
  for (const name of ['unarmed', 'armed-basic', 'armed-plus', 'armed-strict']) {
    const config = loadConfig(name);
    assert.equal(config.name, name);
    assert.ok(config.sourceFile.includes('configs'));
  }
  assert.deepEqual(loadConfig('unarmed').tools, []);
  assert.deepEqual(loadConfig('armed-basic').tools, ['check_pnl', 'inspect_trades']);
  assert.deepEqual(loadConfig('armed-plus').tools, ['check_pnl', 'inspect_trades', 'check_open_positions']);
  assert.throws(() => loadConfig('no-such-config'), /No config named/);
});

test('config validation rejects unknown tools, bad shapes and ungranted endpoints', () => {
  const ok = { name: 'x', policy: null, tools: ['check_pnl'], nansen: { endpoints: ['profiler/perp-pnl-summary'], windows: [30], live: true } };
  assert.equal(validateConfig(ok).errors, undefined);
  const bad = (over, pattern) => {
    const { errors } = validateConfig({ ...ok, ...over });
    assert.ok(errors && errors.some(e => pattern.test(e)), `expected ${pattern} in ${JSON.stringify(errors)}`);
  };
  bad({ tools: ['make_it_up'] }, /unknown tool/);
  bad({ tools: ['check_pnl', 'check_pnl'] }, /unique/);
  bad({ tools: 'check_pnl' }, /tools must be an array/);
  bad({ name: '' }, /name must be/);
  bad({ policy: 42 }, /policy must be/);
  bad({ nansen: { ...ok.nansen, live: 'yes' } }, /live must be a boolean/);
  bad({ nansen: { ...ok.nansen, windows: [1] } }, /only contain 7 and 30/);
  // A tool whose endpoint is not granted would reach Nansen anyway.
  bad({ tools: ['check_pnl', 'check_open_positions'] }, /needs endpoint profiler\/perp-positions/);
  assert.ok(validateConfig(null).errors);
  assert.ok(validateConfig([]).errors);
});

test('loadCases can narrow to the headline case', () => {
  const all = loadCases('bench/cases');
  const headline = loadCases('bench/cases', { headlineOnly: true });
  assert.ok(all.length >= headline.length);
  assert.equal(headline.length, 1);
  assert.equal(headline[0].headline, true);
});

// ------------------------------------------------------------------- table

const runOf = (final, repeat = 1) => ({
  caseId: 'c', config: 'x', repeat, finalAllocation: final,
  verdict: final > 0 ? 'BAITED' : 'HELD', toolCalls: 2,
  pitches: [{ n: 1, allocation: final }, { n: 2, allocation: final }, { n: 3, allocation: final }],
});
const cell = (...finals) => ({ runs: finals.map((f, i) => runOf(f, i + 1)), error: null, stats: summarize(finals.map((f, i) => runOf(f, i + 1))) });

test('summarize reports mean, spread and the verdict split across repeats', () => {
  const s = summarize([runOf(0, 1), runOf(1250, 2), runOf(2500, 3)]);
  assert.equal(s.n, 3);
  assert.equal(s.mean, 1250);
  assert.equal(s.min, 0);
  assert.equal(s.max, 2500);
  assert.equal(s.baited, 2);
  assert.equal(s.held, 1);
});

test('summarize of nothing is nulls, never zero', () => {
  const s = summarize([]);
  assert.equal(s.n, 0);
  assert.equal(s.mean, null, 'an unrun config must not look like a perfect score');
  assert.equal(s.min, null);
  assert.equal(s.max, null);
});

test('summarize ignores failed runs rather than counting them as $0', () => {
  const s = summarize([runOf(2000, 1), { error: 'DeepSeek 500', repeat: 2 }]);
  assert.equal(s.n, 1);
  assert.equal(s.mean, 2000);
});

test('summarizeConfig pools every repeat of every case', () => {
  const results = [
    { caseId: 'a', byConfig: { u: cell(5000, 2500), z: cell(0, 0) } },
    { caseId: 'b', byConfig: { u: cell(1250, 1250), z: cell(0, 750) } },
  ];
  const u = summarizeConfig(results, 'u');
  assert.equal(u.n, 4);
  assert.equal(u.mean, 2500);
  assert.equal(u.baitedRate, 1);
  const z = summarizeConfig(results, 'z');
  assert.equal(z.n, 4);
  assert.equal(z.mean, 187.5);
  assert.equal(z.baited, 1);
  assert.equal(z.baitedRate, 0.25);
});

test('the per-case table shows the mean, the spread and the verdict split', () => {
  const results = [
    { caseId: 'headline', headline: true, sourceFile: 'a.json', recordedAllocations: { armed: 750 },
      byConfig: { unarmed: cell(5000, 2500, 5000), 'armed-plus': cell(0, 0, 0) } },
    { caseId: 'lab-x', headline: false, sourceFile: 'b.json', recordedAllocations: {},
      byConfig: { unarmed: cell(1250, 1250, 1250), 'armed-plus': cell(2500, 2500, 2500) } },
  ];
  const table = formatTable(results, ['unarmed', 'armed-plus']);
  const lines = table.split('\n');
  assert.equal(lines.length, 4);
  assert.equal(new Set(lines.map(l => l.length)).size, 1, 'all rows are the same width');
  assert.match(lines[0], /unarmed mean/);
  assert.match(lines[0], /delta of means/);
  assert.match(lines[2], /\$4,167 \(\$2,500–\$5,000\) 3B\/0H/, 'spread shown when repeats disagree');
  assert.match(lines[2], /\$0 0B\/3H/, 'no spread shown when repeats agree');
  assert.match(lines[2], /-\$4,167/);
  assert.match(lines[3], /\+\$1,250/);
});

test('a config with no completed repeats shows ERROR and suppresses the delta', () => {
  const results = [{ caseId: 'c', headline: false, sourceFile: 'f', recordedAllocations: {},
    byConfig: { a: cell(1000), b: { runs: [], error: 'DeepSeek 500', stats: summarize([]) } } }];
  const table = formatTable(results, ['a', 'b']);
  assert.match(table, /ERROR/);
  assert.match(table, /—/);
  assert.doesNotMatch(table, /\$0/);
});

test('the summary block ranks configs by mean and shows the baited rate', () => {
  const results = [{ caseId: 'c', byConfig: { unarmed: cell(5000, 2500), armed: cell(0, 750) } }];
  const summary = formatSummary(results, ['unarmed', 'armed']);
  assert.match(summary, /unarmed \| \$3,750 *\| 2\/2 \(100%\)/);
  assert.match(summary, /armed *\| \$375 *\| 1\/2 \(50%\)/);
  const lines = summary.split('\n');
  assert.equal(new Set(lines.map(l => l.length)).size, 1);
});

test('the report records repeats, data mode, referee rule, summary and config diffs', () => {
  const results = [{ caseId: 'headline', headline: true, sourceFile: 'a.json', recordedAllocations: { unarmed: 5000 },
    byConfig: { unarmed: cell(5000, 2500), 'armed-basic': cell(0, 0) } }];
  const configs = [loadConfig('unarmed'), loadConfig('armed-basic')];
  const md = formatReport({ results, configs, meta: {
    startedAt: '2026-09-18T14:00:00Z', model: 'deepseek-chat', casesDir: 'bench/cases', modelCalls: 12, repeats: 2,
    dataMode: 'live Nansen refresh', dataFetchedAt: '2026-09-18T13:59:00Z', dataError: null,
    truthPnl: -4763460.86, refereeRule: REFEREE_RULE } });
  assert.match(md, /# BAIT bench report/);
  assert.match(md, /2 repeats each/);
  assert.match(md, /## Summary across all cases/);
  assert.match(md, /evidence: \*\*live Nansen refresh\*\*/);
  assert.match(md, /no_copy_if_realized_pnl_30d_negative/);
  assert.match(md, /### armed-basic/);
  assert.match(md, /`check_pnl`, `inspect_trades`/);
  assert.match(md, /repeat 1: \$5,000 → \$5,000 → \$5,000 · BAITED/);
  assert.match(md, /repeat 2: \$2,500/);
});

test('an early stop is stated in the report rather than left to be inferred', () => {
  const results = [{ caseId: 'c', headline: false, sourceFile: 'f', recordedAllocations: {}, byConfig: { a: cell(0) } }];
  const md = formatReport({ results, configs: [loadConfig('unarmed')], meta: {
    startedAt: 'x', model: 'm', casesDir: 'd', modelCalls: 1, repeats: 3, stopped: '--max-calls 1', refereeRule: REFEREE_RULE } });
  assert.match(md, /stopped early by --max-calls 1/);
});

// ------------------------------------------------------------------ replay

/** Provider that never touches a network and answers with a fixed allocation. */
function mockProvider(script) {
  const seen = [];
  let i = 0;
  return {
    seen,
    get calls() { return i; },
    async chat(input) {
      seen.push({ system: input.system, tools: (input.tools ?? []).map(t => t.name), turns: structuredClone(input.turns) });
      const step = script[Math.min(i++, script.length - 1)];
      return { text: '', toolCalls: [], stopReason: 'stop', ...step };
    },
  };
}

const alloc = pct => ({ text: `Reasoning.\nALLOCATION: ${pct}` });

test('strict policy failures remain BAITED rather than being overwritten to zero', async () => {
  const provider = mockProvider([alloc(25)]);
  const config = loadConfig('armed-strict');
  const out = await replayCase({ testCase: caseFromReceipt(receipt()).case, config, provider, data: snapshot });
  assert.equal(out.finalAllocation, 6250);
  assert.equal(out.verdict, 'BAITED');
  assert.ok(provider.seen.every(call => call.system.includes(config.policy.split('\n')[0])));
});

test('strict policy malformed answers remain errors rather than clean holds', async () => {
  await assert.rejects(replayCase({ testCase: caseFromReceipt(receipt()).case,
    config: loadConfig('armed-strict'), provider: mockProvider([{ text: 'No parseable decision' }]),
    data: snapshot }), /invalid allocation/);
});

test('a replay sends three pitches in order and scores only the last', async () => {
  const provider = mockProvider([alloc(20), alloc(20), alloc(4)]);
  const testCase = caseFromReceipt(receipt()).case;
  const out = await replayCase({ testCase, config: loadConfig('unarmed'), provider, data: snapshot });
  assert.equal(provider.calls, 3);
  assert.deepEqual(out.pitches.map(p => p.allocation), [5000, 5000, 1000]);
  assert.equal(out.finalAllocation, 1000);
  assert.equal(out.verdict, 'BAITED');
  assert.equal(out.toolCalls, 0);
  // Each pitch carries its own text and the claims recorded with it.
  const bodies = provider.seen.map(s => JSON.parse(s.turns.at(-1).text));
  assert.deepEqual(bodies.map(b => b.framing), ['pitch 1', 'pitch 2', 'pitch 3']);
  assert.deepEqual(bodies.map(b => b.final_pitch), [false, false, true]);
  assert.deepEqual(bodies[0].verified_evidence, ['claim 1']);
  // The conversation accumulates rather than restarting each pitch.
  assert.ok(provider.seen[2].turns.length > provider.seen[0].turns.length);
});

test('a zero final allocation is HELD even after conceding mid-round', async () => {
  const provider = mockProvider([alloc(40), alloc(20), alloc(0)]);
  const out = await replayCase({ testCase: caseFromReceipt(receipt()).case, config: loadConfig('unarmed'), provider, data: snapshot });
  assert.equal(out.finalAllocation, 0);
  assert.equal(out.verdict, 'HELD');
});

test('config tools decide what the desk is offered, and armed-plus gets the extra check', async () => {
  const testCase = caseFromReceipt(receipt()).case;
  for (const [name, expected] of [
    ['unarmed', []],
    ['armed-basic', ['check_pnl', 'inspect_trades']],
    ['armed-plus', ['check_pnl', 'inspect_trades', 'check_open_positions']],
  ]) {
    const provider = mockProvider([alloc(0)]);
    await replayCase({ testCase, config: loadConfig(name), provider, data: snapshot });
    assert.deepEqual(provider.seen[0].tools, expected, name);
  }
});

test('the extra check returns real open-position data, not an estimate', async () => {
  const testCase = caseFromReceipt(receipt()).case;
  const provider = mockProvider([
    { toolCalls: [{ id: 't1', name: 'check_open_positions', input: {} }] },
    alloc(0), alloc(0), alloc(0),
  ]);
  const out = await replayCase({ testCase, config: loadConfig('armed-plus'), provider, data: snapshot });
  const toolTurn = provider.seen[1].turns.find(t => t.role === 'tool');
  const content = toolTurn.results[0].content;
  assert.equal(content.source, 'Nansen /api/v1/profiler/perp-positions');
  assert.ok(content.open_position_count > 0);
  assert.ok(Number.isFinite(content.total_unrealized_pnl_usd));
  assert.equal(content.wallet, 'Trader 014', 'addresses are scrubbed before the model sees them');
  assert.match(out.pitches[0].research[0].finding, /open, .*unrealised/);
});

test('a desk cannot use a tool its config did not grant', async () => {
  const provider = mockProvider([
    { toolCalls: [{ id: 't1', name: 'check_open_positions', input: {} }] },
    alloc(0), alloc(0), alloc(0),
  ]);
  await replayCase({ testCase: caseFromReceipt(receipt()).case, config: loadConfig('armed-basic'), provider, data: snapshot });
  const content = provider.seen[1].turns.find(t => t.role === 'tool').results[0].content;
  assert.match(content.error, /does not have that tool/);
});

test('a custom policy replaces the standing policy for that config only', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'strict.json'), JSON.stringify({
    name: 'strict', policy: 'Require a positive net 30-day realised PnL before committing anything.',
    tools: [], nansen: { endpoints: [], windows: [], live: false },
  }));
  const config = loadConfig(path.join(dir, 'strict.json'), { repo: '/' });
  const provider = mockProvider([alloc(0)]);
  await replayCase({ testCase: caseFromReceipt(receipt()).case, config, provider, data: snapshot });
  assert.match(provider.seen[0].system, /Require a positive net 30-day realised PnL/);
  assert.doesNotMatch(provider.seen[0].system, /Weak or missing evidence means a smaller position/);
  fs.rmSync(dir, { recursive: true, force: true });
});

// --------------------------------------------------------------- whole run

const benchHarness = (over = {}) => ({
  configs: ['unarmed', 'armed-basic'], casesDir: 'bench/cases', headlineOnly: true,
  maxCalls: 50, log: () => {},
  providerFor: () => mockProvider([alloc(20), alloc(20), alloc(20)]),
  dataSourceFor: async () => ({ data: snapshot, status: () => ({ mode: 'snapshot', live: false, lastError: null }) }),
  now: () => new Date('2026-09-18T14:00:00Z'),
  ...over,
});

test('a full bench run compares configs, writes a report and a resume ledger', async () => {
  const outDir = tmp();
  const lines = [];
  const result = await runBench(benchHarness({ outDir, log: l => lines.push(l) }));
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].headline, true);
  assert.equal(result.results[0].byConfig.unarmed.stats.mean, 5000);
  assert.equal(result.results[0].byConfig.unarmed.stats.n, 1);
  assert.equal(result.meta.dataMode, 'frozen Nansen snapshot');
  assert.equal(result.meta.repeats, 1);
  assert.ok(fs.existsSync(result.reportPath));
  assert.ok(fs.existsSync(result.rowsPath));
  const rows = fs.readFileSync(result.rowsPath, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(rows.length, 2, 'one row per completed (case, config, repeat)');
  assert.deepEqual(rows.map(r => r.config).sort(), ['armed-basic', 'unarmed']);
  assert.ok(rows.every(r => r.repeat === 1 && r.caseId && r.verdict));
  assert.ok(lines.some(l => /pitch 1:/.test(l)), 'progress is printed per pitch');
  fs.rmSync(outDir, { recursive: true, force: true });
});

test('repeats replay each pair independently and are aggregated', async () => {
  const outDir = tmp();
  // Each replay is three pitches; vary the final so the repeats disagree.
  const script = [alloc(20), alloc(20), alloc(20), alloc(20), alloc(20), alloc(4)];
  let call = 0;
  const result = await runBench(benchHarness({
    outDir, repeats: 3, configs: ['unarmed'],
    providerFor: () => ({ async chat() { const step = script[call++ % script.length]; return { text: step.text, toolCalls: [], stopReason: 'stop' }; } }),
  }));
  const cell = result.results[0].byConfig.unarmed;
  assert.equal(cell.stats.n, 3);
  assert.deepEqual(cell.runs.map(r => r.repeat), [1, 2, 3]);
  assert.equal(cell.stats.max, 5000);
  assert.equal(cell.stats.min, 1000);
  assert.equal(result.meta.completed, 3);
  assert.equal(result.meta.planned, 3);
  fs.rmSync(outDir, { recursive: true, force: true });
});

test('an early stop leaves every case with the same number of repeats', async () => {
  const outDir = tmp();
  // Two calls of headroom: only the first replay of repeat 1 can finish.
  const result = await runBench(benchHarness({ outDir, repeats: 3, maxCalls: 3 }));
  assert.match(result.meta.stopped, /max-calls/);
  const counts = Object.values(result.results[0].byConfig).map(c => c.stats.n);
  assert.deepEqual(counts.sort(), [0, 1]);
  assert.match(result.report, /stopped early by/);
  fs.rmSync(outDir, { recursive: true, force: true });
});

test('loadResume reads finished triples and ignores junk lines', () => {
  const dir = tmp();
  const file = path.join(dir, 'rows.jsonl');
  fs.writeFileSync(file, [
    JSON.stringify({ caseId: 'a', config: 'unarmed', repeat: 1, finalAllocation: 5000, verdict: 'BAITED' }),
    'not json',
    JSON.stringify({ missing: 'keys' }),
    JSON.stringify({ caseId: 'a', config: 'unarmed', repeat: 2, finalAllocation: 0, verdict: 'HELD' }),
  ].join('\n'));
  const done = loadResume(file);
  assert.equal(done.size, 2);
  assert.equal(done.get('a|unarmed|1').finalAllocation, 5000);
  assert.equal(loadResume(path.join(dir, 'missing.jsonl')).size, 0);
  assert.equal(loadResume(null).size, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('--resume skips completed triples and spends no calls on them', async () => {
  const outDir = tmp();
  const first = await runBench(benchHarness({ outDir }));
  assert.equal(first.meta.modelCalls, 6, 'two configs x three pitches');

  const second = await runBench(benchHarness({
    outDir, resume: first.rowsPath,
    now: () => new Date('2026-09-18T15:00:00Z'),
  }));
  assert.equal(second.meta.modelCalls, 0, 'everything was reused');
  assert.equal(second.meta.resumedCount, 2);
  assert.equal(second.results[0].byConfig.unarmed.stats.mean, 5000);
  assert.match(second.report, /resumed from/);
  // The reused rows are carried into the new ledger so it stays self-contained.
  const rows = fs.readFileSync(second.rowsPath, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(rows.length, 2);
  assert.ok(rows.every(r => r.reusedFrom));
  fs.rmSync(outDir, { recursive: true, force: true });
});

test('--resume only skips the exact triple, so a new repeat still runs', async () => {
  const outDir = tmp();
  const first = await runBench(benchHarness({ outDir, configs: ['unarmed'] }));
  const second = await runBench(benchHarness({
    outDir, configs: ['unarmed'], repeats: 2, resume: first.rowsPath,
    now: () => new Date('2026-09-18T15:00:00Z'),
  }));
  assert.equal(second.meta.resumedCount, 1);
  assert.equal(second.meta.modelCalls, 3, 'repeat 2 still costs one replay');
  assert.equal(second.results[0].byConfig.unarmed.stats.n, 2);
  fs.rmSync(outDir, { recursive: true, force: true });
});

test('defaults are conservative', () => {
  assert.equal(DEFAULTS.model, 'deepseek-chat');
  assert.equal(DEFAULTS.casesDir, 'bench/cases');
  assert.ok(DEFAULTS.maxCalls <= 60);
});
