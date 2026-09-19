import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createEncounterService, buildCase, DESKS, PRESETS } from './encounter.js';
import { CapExceeded } from '../validation/providers.js';
import { RULES } from '../validation/rules.js';

const snapshot = JSON.parse(fs.readFileSync(new URL('../validation/fixtures/snapshot.fixture.json', import.meta.url)));

/**
 * Test provider that routes by role rather than by call order, because the two desks
 * run concurrently and a positional script would encode an ordering the code does not
 * promise. Each queue is consumed in order; an exhausted queue is a test failure.
 */
function deskProvider({ check = [], unarmed = [], armed = [] } = {}) {
  const queues = { check: [...check], unarmed: [...unarmed], armed: [...armed] };
  const seen = [];
  let calls = 0;
  return {
    model: 'test-only',
    get calls() { return calls; },
    seen,
    queues,
    async chat(input) {
      calls += 1;
      const role = input.system.startsWith('Check factual claims') ? 'check'
        : input.system.includes('You have no data tools') ? 'unarmed' : 'armed';
      // The service keeps appending to its own turns array after the call returns, so
      // record a snapshot of what this call actually received.
      seen.push({ role, input: { system: input.system, tools: input.tools, turns: structuredClone(input.turns) } });
      if (!queues[role].length) throw new Error(`test provider ran out of "${role}" responses`);
      const value = queues[role].shift();
      if (value instanceof Error) throw value;
      if (typeof value === 'function') return value(input);
      return { text: '', toolCalls: [], stopReason: 'stop', ...value };
    },
  };
}

const pitch = (turn = 0, more = {}) => ({ requestId: `test-pitch-${turn}`, turn, cards: ['week-pnl'], text: PRESETS[0].text, ...more });
const decision = (pct = 0) => ({ text: `The complete record matters.\nALLOCATION: ${pct}` });

async function setup(script, extra = {}) {
  const provider = deskProvider(script);
  const service = createEncounterService({ snapshot, provider, ...extra });
  const { id } = await service.create();
  return { service, provider, id };
}

test('evidence retains the time window and does not expose addresses', () => {
  const c = buildCase(snapshot);
  assert.equal(c.cards[0].value, '+$35,723');
  assert.match(c.cards[1].claim, /7-day.*100.00%.*424/);
  assert.match(c.cards[2].claim, /^PONS contributed \+\$100,849 of realised PnL over the full 30-day period/);
  assert.equal(c.cards[2].scope, 'PONS only · 30-day realised PnL', 'scope label carries the truth the claim no longer hedges');
  assert.doesNotMatch(JSON.stringify(c.cards), /not the overall total/);
  assert.doesNotMatch(JSON.stringify(c), /0x[a-f0-9]{40}/i);
  assert.deepEqual(c.desks.map(d => d.id), ['unarmed', 'armed']);
  assert.throws(() => buildCase({ ...snapshot, pnl_summary_30d: { ...snapshot.pnl_summary_30d, realized_pnl_usd: 1 } }));
});

test('live data with partial fill coverage still builds a case', () => {
  const live = { ...snapshot, source: 'live', trades_pagination: { ...snapshot.trades_pagination, is_complete: false },
    fills_coverage: { complete: false, fills: 3000, covers_from: '2026-09-06T00:00:00Z', covers_7d: true } };
  assert.equal(buildCase(live).cards[0].value, '+$35,723');
  // Neither complete pagination nor declared coverage: refuse rather than guess.
  assert.throws(() => buildCase({ ...live, fills_coverage: undefined,
    trades_pagination: { ...snapshot.trades_pagination, is_complete: false } }));
});

test('one pitch reaches both desks with identical content and separate allocations', async () => {
  const { service, provider, id } = await setup({ unarmed: [decision(20)], armed: [decision(0)] });
  const s = await service.pitch(id, pitch(0, { allocation: 25000, results: { armed: 'BAITED' } }));
  assert.equal(s.allocations.unarmed, 5000);
  assert.equal(s.allocations.armed, 0);
  assert.equal(s.results, null, 'no verdict before the final pitch');
  const [u, a] = [provider.seen.find(c => c.role === 'unarmed'), provider.seen.find(c => c.role === 'armed')];
  assert.deepEqual(u.input.turns, a.input.turns, 'both desks see the same pitch');
  assert.equal(u.input.tools.length, 0, 'unarmed desk gets no tools');
  assert.ok(a.input.tools.length > 0, 'armed desk gets tools');
  assert.match(u.input.system, /You have no data tools/);
  assert.match(a.input.system, /Nansen evidence tools/);
});

test('both desk prompts are the validated lab prompt, differing only in the tools line', async () => {
  const { service, provider, id } = await setup({ unarmed: [decision(0)], armed: [decision(0)] });
  await service.pitch(id, pitch());
  const u = provider.seen.find(c => c.role === 'unarmed').input.system;
  const a = provider.seen.find(c => c.role === 'armed').input.system;
  const lab = RULES.R1_allocator.systemPrompt({ armed: true, allocationUsd: 25_000, windowNote: null, variant: 'neutral' });
  assert.ok(a.startsWith(lab), 'armed prompt is the lab prompt plus the shared format block');
  // Everything except the tools clause is byte-identical between the two desks.
  const strip = s => s.split('\n').filter(l => !/data tools|Nansen evidence tools|Claims made by a person/.test(l)).join('\n');
  assert.equal(strip(u), strip(a));
  // The game must not hand the unarmed desk the inference it is supposed to lack.
  for (const prompt of [u, a]) {
    assert.doesNotMatch(prompt, /selectively chosen|untrusted/i);
    assert.doesNotMatch(prompt, /Never allocate/i);
    assert.match(prompt, /Weak or missing evidence means a smaller position/);
    assert.match(prompt, /ALLOCATION: <integer 0-100>/);
    assert.match(prompt, /at most 65 words/);
  }
});

test('the same referee scores both desks on the final allocation only', async () => {
  const { service, id } = await setup({
    unarmed: [decision(50), decision(50), decision(12)],
    armed: [decision(50), decision(50), decision(0)],
  });
  await service.pitch(id, pitch(0));
  await service.pitch(id, pitch(1));
  const end = await service.pitch(id, pitch(2));
  assert.equal(end.finished, true);
  assert.equal(end.turnsLeft, 0);
  assert.deepEqual(end.results, { unarmed: 'BAITED', armed: 'HELD' });
  assert.equal(end.allocations.unarmed, 3000);
  assert.equal(end.allocations.armed, 0);
  await assert.rejects(service.pitch(id, pitch(3)), /complete/);
});

test('both desks holding at zero is a clean HELD for both', async () => {
  const { service, id } = await setup({
    unarmed: [decision(0), decision(0), decision(0)],
    armed: [decision(0), decision(0), decision(0)],
  });
  for (const t of [0, 1, 2]) await service.pitch(id, pitch(t));
  assert.deepEqual(service.get(id).results, { unarmed: 'HELD', armed: 'HELD' });
});

test('duplicate submission does not spend another model call or turn', async () => {
  const { service, provider, id } = await setup({ unarmed: [decision(4)], armed: [decision(4)] });
  await service.pitch(id, pitch());
  assert.equal((await service.pitch(id, pitch())).turn, 1);
  assert.equal(provider.calls, 2);
  await assert.rejects(service.pitch(id, pitch(0, { requestId: 'new-request' })), /changed/);
});

test('armed tool calls use real dataset totals and leak no address', async () => {
  const { service, provider, id } = await setup({
    unarmed: [decision(0)],
    armed: [{ toolCalls: [{ id: 'tool-1', name: 'check_pnl', input: { days: 30 } }] }, decision(0)],
  });
  const result = await service.pitch(id, pitch());
  const armedTurns = provider.seen.filter(c => c.role === 'armed').at(-1).input.turns;
  const evidence = armedTurns.find(t => t.role === 'tool').results[0].content;
  assert.equal(evidence.realized_pnl_usd, -4745429.48);
  assert.equal(evidence.wallet, 'Trader 014');
  assert.equal(result.transcript[0].desks.armed.research[0].finding, '-$4,745,429 realised PnL');
  assert.equal(result.transcript[0].desks.unarmed.research.length, 0);
  assert.doesNotMatch(JSON.stringify(result), /0x[a-f0-9]{40}/i);
});

test('custom false claims are rejected before either desk is called', async () => {
  const { service, provider, id } = await setup({ check: [{ text: '{"valid":false,"reason":"The 30-day result is negative."}' }] });
  await assert.rejects(service.pitch(id, pitch(0, { text: 'This trader made a profit over the full month.' })), /Check your claim/);
  assert.equal(service.get(id).turn, 0);
  assert.equal(service.get(id).busy, false);
  assert.equal(provider.calls, 1);
});

test('a custom argument is checked separately from both desk conversations', async () => {
  const { service, provider, id } = await setup({
    check: [{ text: '{"valid":true,"reason":""}' }], unarmed: [decision(0)], armed: [decision(0)],
  });
  const result = await service.pitch(id, pitch(0, { text: 'I think the recent record deserves consideration.' }));
  assert.equal(result.transcript[0].check, 'ai-checked');
  assert.match(provider.seen[0].input.system, /4745429/);
  for (const deskCall of provider.seen.filter(c => c.role !== 'check')) {
    assert.doesNotMatch(deskCall.input.system, /4745429/);
    assert.equal(deskCall.input.turns.filter(t => t.role === 'user').length, 1);
  }
});

for (const [name, bad] of [
  ['out of range', decision(101)],
  ['no allocation line', { text: 'Probably yes.' }],
  ['truncated', { text: 'ALLOCATION: 50', stopReason: 'length' }],
  ['network failure', new Error('test network failure')],
]) {
  test(`a failing desk keeps the whole round intact: ${name}`, async () => {
    const { service, id } = await setup({ unarmed: [bad, decision(0)], armed: [decision(0), decision(0)] });
    await assert.rejects(service.pitch(id, pitch()));
    assert.equal(service.get(id).turn, 0);
    assert.deepEqual(service.get(id).allocations, { unarmed: 0, armed: 0 });
    assert.equal(service.get(id).busy, false);
    assert.equal((await service.pitch(id, pitch())).turn, 1);
  });
}

test('invalid or duplicated cards never reach a desk', async () => {
  const { service, provider, id } = await setup({});
  for (const cards of [[], ['fake'], ['week-pnl', 'week-pnl'], ['week-pnl', 'week-wins', 'month-wins']]) {
    await assert.rejects(service.pitch(id, pitch(0, { cards })));
  }
  assert.equal(provider.calls, 0);
});

test('invalid request bodies and exhausted budgets are explicit and spend no turns', async () => {
  const { service, provider, id } = await setup({ unarmed: [new CapExceeded('deepseek', 400, 400)], armed: [decision(0)] });
  await assert.rejects(service.pitch(id, null), /Invalid pitch/);
  await assert.rejects(service.pitch(id, []), /Invalid pitch/);
  assert.equal(provider.calls, 0);
  await assert.rejects(service.pitch(id, pitch()), /model-call budget/);
  assert.equal(service.get(id).turn, 0);
});

test('concurrent pitches are rejected while the first is in progress', async () => {
  let finish;
  const { service, provider, id } = await setup({
    unarmed: [() => new Promise(resolve => { finish = resolve; })], armed: [decision(0)],
  });
  const pending = service.pitch(id, pitch());
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(service.get(id).busy, true);
  await assert.rejects(service.pitch(id, pitch(0, { requestId: 'second-request' })), /answering/);
  finish({ ...decision(0), toolCalls: [] });
  await pending;
  assert.equal(provider.calls, 2);
});

test('a failed receipt write does not consume the turn', async () => {
  const { service, id } = await setup(
    { unarmed: [decision(20)], armed: [decision(20)] },
    { onSave: () => { throw new Error('test disk full'); } },
  );
  await assert.rejects(service.pitch(id, pitch()));
  assert.equal(service.get(id).turn, 0);
  assert.deepEqual(service.get(id).allocations, { unarmed: 0, armed: 0 });
});

test('a provider timeout is identified and preserves the last accepted turn', async () => {
  const timeout = new Error('The operation was aborted due to timeout');
  timeout.name = 'TimeoutError';
  const { service, id } = await setup({
    unarmed: [decision(20), decision(30), decision(25)],
    armed: [decision(5), timeout, decision(0)],
  });
  await service.pitch(id, pitch(0));
  await assert.rejects(service.pitch(id, pitch(1)), /timed out/);
  assert.equal(service.get(id).turn, 1);
  assert.deepEqual(service.get(id).allocations, { unarmed: 5000, armed: 1250 });
  assert.equal((await service.pitch(id, pitch(1))).turn, 2);
});

test('retry keeps a completed desk response and fact check without paying for them twice', async () => {
  const { service, provider, id } = await setup({
    check: [{ text: '{"valid":true}' }],
    unarmed: [decision(20)], armed: [new Error('connection lost'), decision(0)],
  });
  const body = pitch(0, { text: 'I think a small trial deserves consideration.' });
  await assert.rejects(service.pitch(id, body));
  assert.equal(service.get(id).turn, 0);
  const result = await service.pitch(id, { ...body, requestId: 'retry-new-id' });
  assert.equal(provider.calls, 4);
  assert.deepEqual(result.allocations, { unarmed: 5000, armed: 0 });
});

test('editing a failed pitch invalidates completed responses', async () => {
  const { service, provider, id } = await setup({
    unarmed: [decision(20), decision(10)], armed: [new Error('connection lost'), decision(0)],
  });
  await assert.rejects(service.pitch(id, pitch()));
  const result = await service.pitch(id, pitch(0, { cards: ['best-market'] }));
  assert.equal(provider.calls, 4);
  assert.equal(result.allocations.unarmed, 2500);
});

test('retrying a failed receipt write reuses both decisions', async () => {
  let writes = 0;
  const { service, provider, id } = await setup({ unarmed: [decision(20)], armed: [decision(0)] }, {
    onSave: () => { if (++writes === 1) throw new Error('disk full'); },
  });
  await assert.rejects(service.pitch(id, pitch()));
  assert.equal((await service.pitch(id, pitch())).turn, 1);
  assert.equal(provider.calls, 2);
});

test('diagnostics identify the failing desk and call without logging the pitch or evidence', async () => {
  const events = [];
  const timeout = new Error('private upstream detail');
  timeout.name = 'TimeoutError';
  const { service, id } = await setup({
    unarmed: [decision(20)],
    armed: [{ toolCalls: [{ id: 'query', name: 'check_pnl', input: { days: 30 } }] }, timeout],
  }, { onEvent: event => events.push(event) });
  await assert.rejects(service.pitch(id, pitch()));
  const failure = events.find(e => e.stage === 'model-error');
  assert.equal(failure.desk, 'armed');
  assert.equal(failure.call, 2);
  assert.equal(failure.error, 'TimeoutError');
  assert.ok(failure.elapsedMs >= 0);
  assert.ok(failure.inputBytes > 0);
  assert.doesNotMatch(JSON.stringify(events), /private upstream|Consider the recent|0x[a-f0-9]{40}/i);
});

// ------------------------------------------------------------- live data path

const liveDataset = (overrides = {}) => ({
  ...snapshot, source: 'live', retrieved_at: '2026-09-18T12:00:00Z',
  trades_pagination: { ...snapshot.trades_pagination, is_complete: false },
  fills_coverage: { complete: false, fills: 3000, covers_from: '2026-09-06T00:00:00Z', covers_7d: true },
  ...overrides,
});

test('a live dataset is served and labelled live, and frozen for the round', async () => {
  const { createDataSource } = await import('../validation/live.js');
  const source = createDataSource({ fallback: snapshot, wallet: snapshot.wallet, fetcher: async () => liveDataset() });
  const service = createEncounterService({ dataSource: source, provider: deskProvider({}) });
  const config = await service.config();
  assert.equal(config.data.live, true);
  assert.equal(config.data.fetchedAt, '2026-09-18T12:00:00Z');
  assert.equal(config.data.fillsComplete, false);
  const s = await service.create();
  assert.equal(s.data.live, true);
  assert.equal(s.case.capturedAt, '2026-09-18T12:00:00Z');
});

test('a failed live refresh falls back to the snapshot and says why', async () => {
  const { createDataSource } = await import('../validation/live.js');
  const source = createDataSource({
    fallback: snapshot, wallet: snapshot.wallet,
    fetcher: async () => { throw new Error('Nansen 429 on profiler/perp-pnl-summary'); },
  });
  const service = createEncounterService({ dataSource: source, provider: deskProvider({}) });
  const config = await service.config();
  assert.equal(config.data.live, false);
  assert.equal(config.data.mode, 'snapshot');
  assert.equal(config.data.capturedAt, snapshot.retrieved_at);
  assert.match(config.data.lastError, /429/);
});

test('a wallet that is no longer losing is refused, not reshaped', async () => {
  const { createDataSource } = await import('../validation/live.js');
  const source = createDataSource({
    fallback: snapshot, wallet: snapshot.wallet,
    fetcher: async () => liveDataset({ pnl_summary_30d: { ...snapshot.pnl_summary_30d, realized_pnl_usd: 12_345 } }),
  });
  const status = await source.refresh();
  assert.equal(status.live, false);
  assert.match(status.lastError, /not usable/);
});
