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

async function startServer(extraEnv = {}) {
  const env = { ...process.env, PORT: '0', HOSTED: '1', DEEPSEEK_API_KEY: 'test', ...extraEnv };
  delete env.NANSEN_LIVE;
  delete env.LIVE;
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
  const stop = () => new Promise(resolve => { child.once('exit', () => resolve(log)); child.kill(); });
  return { call, stop, log: () => log };
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

test('hosted mode refuses the lab runner and screenshot routes', async () => {
  const s = await startServer();
  try {
    const play = await s.call('/api/play', { method: 'POST', body: { messages: ['a', 'b', 'c'] } });
    assert.equal(play.status, 404);
    const shot = await s.call('/api/screenshot', { method: 'POST', body: { data_url: 'data:,x' } });
    assert.equal(shot.status, 404);
  } finally { await s.stop(); }
});
