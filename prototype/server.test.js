/**
 * Boots prototype/server.js as a child in hosted mode on a free port and drives it over
 * HTTP. Round starts make no model call, and the daily-cap case runs with a cap of 0,
 * so nothing here reaches DeepSeek or touches the model ledger.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PRESETS } from './encounter.js';
import { CAP_MESSAGE } from './hosted-guard.js';

const SERVER = fileURLToPath(new URL('./server.js', import.meta.url));
/** Stub Nansen client for the /api/guard route. Keeps these tests off the network. */
const GUARD_STUB = fileURLToPath(new URL('./fixtures/guard-call-stub.js', import.meta.url));
const LOSING_WALLET = '0xc26cbb6483229e0d0f9a1cab675271eda535b8f4';

async function startServer(extraEnv = {}) {
  const defaults = { ...process.env, PORT: '0', HOSTED: '1', DEEPSEEK_API_KEY: 'test' };
  delete defaults.NANSEN_LIVE;
  delete defaults.LIVE;
  // NANSEN_LIVE=0 keeps the startup account check off the network in local mode too.
  const env = { ...defaults, NANSEN_LIVE: '0', ...extraEnv };
  const child = spawn(process.execPath, [SERVER], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start in time:\n${log}`)), 20_000);
    const scan = chunk => {
      log += chunk;
      const m = log.match(/listening on\s+\S+:(\d+)/);
      if (m) { clearTimeout(timer); resolve(Number(m[1])); }
    };
    child.stdout.on('data', scan);
    child.stderr.on('data', chunk => { log += chunk; });
    child.on('exit', code => { clearTimeout(timer); reject(new Error(`server exited with ${code}:\n${log}`)); });
  });
  const base = `http://127.0.0.1:${port}`;
  const call = async (path, { method = 'GET', body, headers = {} } = {}) => {
    const res = await fetch(base + path, {
      method, headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };
  /** POST a body the JSON parser will refuse, so the 400 path can be checked. */
  const callRaw = async (path, raw) => {
    const res = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: raw });
    return { status: res.status, body: await res.json() };
  };
  const stop = () => new Promise(resolve => { child.once('exit', () => resolve(log)); child.kill(); });
  return { call, callRaw, stop, log: () => log };
}

test('/healthz reports frozen evidence and zero counters on a fresh hosted start', async () => {
  const s = await startServer();
  try {
    const { status, body } = await s.call('/healthz');
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.evidence, 'frozen', 'HOSTED=1 without NANSEN_LIVE=1 must not go live');
    assert.equal(body.roundsToday, 0);
    assert.equal(body.callsToday, 0);
    assert.ok(!Number.isNaN(Date.parse(body.startedAt)), 'startedAt is an ISO timestamp');
    assert.match(s.log(), /listening on\s+0\.0\.0\.0:\d+/, 'hosted mode binds all interfaces');
    assert.match(s.log(), /live refresh\s+disabled/);
  } finally { await s.stop(); }
});

test('per-IP cap: the fourth round start from one client is refused with the replay link', async () => {
  const s = await startServer({ HOSTED_ROUNDS_PER_IP: '3' });
  try {
    for (let i = 0; i < 3; i++) {
      const { status, body } = await s.call('/api/encounter', { method: 'POST', body: {} });
      assert.equal(status, 201, `round ${i + 1} starts`);
      assert.match(body.id, /^[a-f0-9-]{36}$/);
    }
    const refused = await s.call('/api/encounter', { method: 'POST', body: {} });
    assert.equal(refused.status, 429);
    assert.deepEqual(refused.body, { error: CAP_MESSAGE, code: 'HOSTED_CAP', replay: '/replay.html' });
    // Behind the proxy, X-Forwarded-For identifies the client, so another address is not blocked.
    const other = await s.call('/api/encounter', { method: 'POST', body: {}, headers: { 'x-forwarded-for': '203.0.113.7' } });
    assert.equal(other.status, 201);
    const health = await s.call('/healthz');
    assert.equal(health.body.roundsToday, 4, 'refused attempts are not counted as rounds');
    assert.equal(health.body.callsToday, 0, 'round starts make no model call');
  } finally { await s.stop(); }
});

test('daily cap: a pitch is refused before any model call once HOSTED_DAILY_CALLS is spent', async () => {
  const s = await startServer({ HOSTED_DAILY_CALLS: '0' });
  try {
    const round = await s.call('/api/encounter', { method: 'POST', body: {} });
    assert.equal(round.status, 201);
    assert.equal(round.body.health.capReached, true);
    assert.equal(round.body.health.ready, false);
    const pitch = await s.call(`/api/encounter/${round.body.id}/pitch`, {
      method: 'POST',
      body: { requestId: 'test-pitch-0000', turn: 0, cards: ['week-pnl'], text: PRESETS[0].text },
    });
    assert.equal(pitch.status, 429);
    assert.deepEqual(pitch.body, { error: CAP_MESSAGE, code: 'HOSTED_CAP', replay: '/replay.html' });
    const after = await s.call(`/api/encounter/${round.body.id}`);
    assert.equal(after.body.turn, 0, 'no turn was spent');
    assert.equal(after.body.error, CAP_MESSAGE);
    const health = await s.call('/healthz');
    assert.equal(health.body.callsToday, 0, 'the refused attempt was not charged');
    assert.doesNotMatch(s.log(), /DeepSeek \d{3}/, 'DeepSeek was never contacted');
  } finally { await s.stop(); }
});

test('POST /api/guard blocks a losing wallet and allows a profitable one, on stubbed evidence', async () => {
  const s = await startServer({ HOSTED: '', GUARD_CALL_MODULE: GUARD_STUB });
  try {
    const blocked = await s.call('/api/guard', { method: 'POST', body: { wallet: LOSING_WALLET, allocation: 5000 } });
    assert.equal(blocked.status, 200);
    assert.equal(blocked.body.decision, 'block');
    assert.equal(blocked.body.code, 'pnl_below_minimum');
    assert.equal(blocked.body.allocation, 0, 'a blocked check never returns the proposed amount');
    assert.equal(blocked.body.attempted, 5000);
    assert.equal(blocked.body.policy.id, 'wallet-realized-pnl-30d-v1');
    assert.equal(blocked.body.evidence.source, 'Nansen /api/v1/profiler/perp-pnl-summary');
    assert.equal(blocked.body.creditsCharged, 1);

    const health = await s.call('/api/health');
    assert.equal(health.body.live_guard.route, 'POST /api/guard');
    assert.equal(health.body.live_guard.enabled, true);
  } finally { await s.stop(); }

  const profitable = await startServer({ HOSTED: '', GUARD_CALL_MODULE: GUARD_STUB, GUARD_STUB_PNL: '2450809.47' });
  try {
    const allowed = await profitable.call('/api/guard', { method: 'POST', body: { wallet: LOSING_WALLET, allocation: 5000 } });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.body.decision, 'allow');
    assert.equal(allowed.body.allocation, 5000);
    assert.equal(allowed.body.evidence.realized_pnl_usd, 2450809.47);
  } finally { await profitable.stop(); }
});

test('POST /api/guard fails closed on a provider error, a bad wallet and malformed JSON', async () => {
  const s = await startServer({ HOSTED: '', GUARD_CALL_MODULE: GUARD_STUB, GUARD_STUB_FAIL: '1' });
  try {
    const failed = await s.call('/api/guard', { method: 'POST', body: { wallet: LOSING_WALLET, allocation: 5000 } });
    assert.equal(failed.status, 200);
    assert.equal(failed.body.decision, 'block');
    assert.equal(failed.body.code, 'evidence_unavailable');
    assert.equal(failed.body.allocation, 0);

    const bad = await s.call('/api/guard', { method: 'POST', body: { wallet: 'nope', allocation: 5000 } });
    assert.equal(bad.status, 200, 'a rejected input is still a guard decision');
    assert.equal(bad.body.code, 'invalid_request');
    assert.equal(bad.body.allocation, 0);

    const malformed = await s.callRaw('/api/guard', '{not json');
    assert.equal(malformed.status, 400);
    assert.equal(malformed.body.error, 'invalid_json');
  } finally { await s.stop(); }
});

test('hosted mode refuses the live guard route so anonymous visitors cannot spend credits', async () => {
  const s = await startServer({ GUARD_CALL_MODULE: GUARD_STUB });
  try {
    const refused = await s.call('/api/guard', { method: 'POST', body: { wallet: LOSING_WALLET, allocation: 5000 } });
    assert.equal(refused.status, 403);
    assert.equal(refused.body.error, 'guard_disabled_hosted');
    assert.match(refused.body.message, /locally with your own NANSEN_API_KEY/);
    const health = await s.call('/api/health');
    assert.equal(health.body.live_guard.enabled, false);
    assert.equal(health.body.live_guard.route, null);
  } finally { await s.stop(); }
});

test('hosted mode refuses the lab runner and screenshot routes', async () => {
  const s = await startServer();
  try {
    const play = await s.call('/api/play', { method: 'POST', body: { messages: ['a', 'b', 'c'] } });
    assert.equal(play.status, 404);
    const shot = await s.call('/api/screenshot', { method: 'POST', body: { data_url: 'data:,x' } });
    assert.equal(shot.status, 404);
  } finally { await s.stop(); }
});
