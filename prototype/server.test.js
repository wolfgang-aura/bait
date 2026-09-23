import fs from 'node:fs';
import crypto from 'node:crypto';
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
import { CAP_MESSAGE, IP_CAP_MESSAGE } from './hosted-guard.js';
import { loadEnv } from '../validation/nansen.js';

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
  const fetchText = async path => {
    const res = await fetch(base + path);
    return { status: res.status, type: res.headers.get('content-type'), body: await res.text() };
  };
  const stop = () => new Promise(resolve => { child.once('exit', () => resolve(log)); child.kill(); });
  return { base, call, callRaw, fetchText, stop, log: () => log };
}

test('the default route is the Pitch Room, with the guard console still reachable', async () => {
  const s = await startServer();
  try {
    const page = await s.fetchText('/');
    assert.equal(page.status, 200);
    assert.match(page.type, /text\/html/);
    assert.match(page.body, /The Pitch Room/);
    assert.match(page.body, /BAIT is the check that runs before the money moves/);
    assert.match(page.body, /Built for teams that let AI agents allocate capital/);
    assert.match(page.body, /talk the AI into backing/);
    assert.match(page.body, /The fact you must not mention/);
    assert.doesNotMatch(page.body, /Sell them anyway/);
    assert.doesNotMatch(page.body, /Can you sell a losing trader/);

    // The guard page is retired: it redirects to the proof page's How BAIT works section.
    const guardPage = await fetch(`${s.base}/guard.html`, { redirect: 'manual' });
    assert.equal(guardPage.status, 302);
    assert.equal(guardPage.headers.get('location'), '/replay.html#how');
    const proof = await s.fetchText('/replay.html');
    assert.match(proof.body, /<section id="how"/);
    assert.match(proof.body, /How BAIT works/);
    // One nav on every page: Play, Proof, GitHub.
    for (const html of [page.body, proof.body]) {
      assert.match(html, /<a href="\/"[^>]*>Play<\/a>/);
      assert.match(html, /<a href="\/replay\.html"[^>]*>Proof<\/a>/);
      assert.match(html, />GitHub<\/a>/);
      assert.doesNotMatch(html, /guard\.html|play-against-the-models/);
    }
    for (const path of ['/replay.html', '/room.css', '/room.js', '/portraits.js']) {
      assert.equal((await s.fetchText(path)).status, 200, `${path} stays reachable`);
    }
  } finally { await s.stop(); }
});

test('the room serves its dossier from the frozen snapshot and spends nothing to do it', async () => {
  const s = await startServer();
  try {
    const { status, body } = await s.call('/api/room');
    assert.equal(status, 200);
    assert.equal(body.evidence.live, false);
    assert.equal(body.dossier.desk, 'PENNY');
    assert.equal(body.dossier.slot, 25_000);
    assert.equal(body.dossier.facts.length, 4, 'every flattering fact is open before the first line');
    assert.equal(body.dossier.upcoming, 0);
    assert.equal('buried' in body.dossier, false, 'the loss is sealed until BAIT checks a transfer');
    assert.equal(body.dossier.sealed.label, '30-day realised PnL');
    assert.doesNotMatch(JSON.stringify(body.dossier), /4,745,429/);
    assert.deepEqual(body.dossier.endpoints, ['profiler/perp-pnl-summary', 'profiler/perp-trades']);
    assert.ok(Array.isArray(body.leaderboard));

    const health = await s.call('/healthz');
    assert.equal(health.body.callsToday, 0, 'reading the dossier makes no model call');
  } finally { await s.stop(); }
});

test('room: the per-IP cap counts round starts and the daily cap refuses a shot before DeepSeek', async () => {
  const s = await startServer({ HOSTED_ROUNDS_PER_IP: '2', HOSTED_DAILY_CALLS: '0' });
  try {
    const first = await s.call('/api/room/start', { method: 'POST', body: {} });
    assert.equal(first.status, 201);
    assert.equal(first.body.suspicion, 30);
    assert.equal(first.body.funded, 0);
    assert.equal(first.body.shotsLeft, 3);

    const shot = await s.call(`/api/room/${first.body.id}/pitch`, {
      method: 'POST',
      body: { requestId: 'room-shot-0001', shot: 0, text: '100% win rate across 424 closed trades in 7 days.' },
    });
    assert.equal(shot.status, 429);
    assert.equal(shot.body.code, 'HOSTED_CAP');
    const after = await s.call(`/api/room/${first.body.id}`);
    assert.equal(after.body.shotsUsed, 0, 'a refused shot is not spent');

    assert.equal((await s.call('/api/room/start', { method: 'POST', body: {} })).status, 201);
    const refused = await s.call('/api/room/start', { method: 'POST', body: {} });
    assert.equal(refused.status, 429);
    assert.equal(refused.body.replay, '/replay.html');

    const health = await s.call('/healthz');
    assert.equal(health.body.callsToday, 0, 'the refused shot was never charged');
    assert.doesNotMatch(s.log(), /DeepSeek \d{3}/, 'DeepSeek was never contacted');
  } finally { await s.stop(); }
});

test('room: finishing before three shots is refused, and unknown rounds are a 404', async () => {
  const s = await startServer();
  try {
    const round = await s.call('/api/room/start', { method: 'POST', body: {} });
    const early = await s.call(`/api/room/${round.body.id}/finish`, { method: 'POST', body: {} });
    assert.equal(early.status, 409);
    const missing = await s.call('/api/room/00000000-0000-0000-0000-000000000000');
    assert.equal(missing.status, 404);
    const unknown = await s.call('/api/room/nope');
    assert.equal(unknown.status, 404);
  } finally { await s.stop(); }
});

test('/api/proof serves every benchmark count with its raw source, and nothing private', async () => {
  const s = await startServer({ HOSTED_NANSEN_CREDITS_PER_DAY: '12' });
  try {
    const { status, body } = await s.call('/api/proof');
    assert.equal(status, 200);
    assert.equal(body.model, 'deepseek-chat');
    assert.equal(body.perWallet.losingWallets, 6);
    assert.deepEqual(body.perWallet.backedLoser.behindBaitGate[1], 78);
    assert.equal(body.perWallet.wallets.length, 12);
    assert.equal(body.baseline.name, 'check-then-decide', 'the baseline to beat is published');
    assert.deepEqual(body.gateBuys.letThrough, { agent: [6, 6], behindV3: [0, 6] }, 'what the gate buys is served');
    assert.equal(body.gateBuys.knownMiss.rows.length, 0, 'the one miss the bench found is fixed');
    assert.equal(body.gateBuys.fixedMiss.case, 'relabelled-window', 'and the fix is served with the report that found it');
    assert.match(body.gateBuys.source.path, /^bench\/reports\/.+-gate-buys\.json$/);
    assert.match(body.perWallet.source.url, /^https:\/\/github\.com\/wolfgang-aura\/bait\/blob\/main\/bench\/reports\/.+-wallets\.jsonl$/);
    assert.match(body.perWallet.source.sha256, /^[a-f0-9]{64}$/);
    assert.equal('singleWalletSuite' in body, false, 'the superseded suite\'s counts are not served');
    assert.match(body.superseded.correction, /docs\/DETAILS\.md$/);
    assert.deepEqual(body.perWallet.profitableControl.capped, [3, 18]);
    assert.doesNotMatch(JSON.stringify(body), /"backedLoser":\[24,30\]/);
    assert.equal(body.nansen.dailyCap, 12);
    assert.ok('lastLiveSuccessAt' in body.nansen);
    const text = JSON.stringify(body);
    assert.doesNotMatch(text, /0x[a-fA-F0-9]{40}/, 'no wallet address');
    assert.doesNotMatch(text, /\b\d{1,3}(\.\d{1,3}){3}\b/, 'no IP address');
    const key = process.env.NANSEN_API_KEY || loadEnv().NANSEN_API_KEY;
    if (key) assert.ok(!text.includes(key.slice(-6)), 'no key');
    // Every number on it traces to a file in the repository with that hash.
    for (const src of body.sources) {
      const raw = fs.readFileSync(fileURLToPath(new URL(`../${src.path}`, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
      assert.equal(crypto.createHash('sha256').update(raw).digest('hex'), src.sha256, src.path);
    }
  } finally { await s.stop(); }
});

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
    assert.deepEqual(refused.body, { error: IP_CAP_MESSAGE, code: 'HOSTED_CAP', replay: '/replay.html' });
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
    assert.equal(round.body.health.blocker, 'hosted_cap', 'the daily cap is named as the cap, not as a missing key');
    assert.doesNotMatch(round.body.health.message, /DEEPSEEK_API_KEY/);
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
    assert.equal(blocked.body.policy.id, 'wallet-copy-risk-v3');
    assert.equal(blocked.body.checks.find(c => c.id === 'realised_pnl_30d').result, 'fail');
    assert.equal(blocked.body.evidence.source, 'Nansen /api/v1/profiler/perp-pnl-summary');
    assert.equal(blocked.body.creditsCharged, 1, 'a wallet the 30-day evidence refuses never buys the 7-day window');

    const health = await s.call('/api/health');
    assert.equal(health.body.live_guard.route, 'POST /api/guard');
    assert.equal(health.body.live_guard.enabled, true);
  } finally { await s.stop(); }

  const profitable = await startServer({ HOSTED: '', GUARD_CALL_MODULE: GUARD_STUB, GUARD_STUB_PNL: '2450809.47', GUARD_STUB_WIN_RATE: '0.55' });
  try {
    const allowed = await profitable.call('/api/guard', { method: 'POST', body: { wallet: LOSING_WALLET, allocation: 5000 } });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.body.decision, 'allow');
    assert.equal(allowed.body.allocation, 5000);
    assert.equal(allowed.body.evidence.realized_pnl_usd, 2450809.47);
    assert.equal(allowed.body.creditsCharged, 2, 'an allow read both windows');
    assert.equal(allowed.body.checks.find(c => c.id === 'regime_agreement').result, 'pass');
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

test('the roster route ships hype only, and the truth arrives with the round', async () => {
  const s = await startServer();
  try {
    const { status, body } = await s.call('/api/room/roster');
    assert.equal(status, 200);
    assert.equal(body.roster.length, 4);
    assert.ok(body.roster.every(tile => tile.venue === 'hyperliquid'), 'every front-door tile is Nansen-backed');
    for (const tile of body.roster) {
      assert.ok(tile.hype.value, `${tile.id} brags about something`);
      assert.equal('truth' in tile, false, `${tile.id} ships no truth before the pick`);
      assert.equal('risk' in tile, false, `${tile.id} ships no verdict before the pick`);
    }

    const round = await s.call('/api/room/start', { method: 'POST', body: { prospect: 'legend' } });
    assert.equal(round.status, 201);
    assert.equal(round.body.prospect.id, 'legend');
    assert.equal('truth' in round.body.prospect, false, 'the record is the reveal, so it arrives with the verdict');
    assert.equal('risk' in round.body.prospect, false);
    assert.equal(round.body.dossier.sealed.mustNotMention, true);
    const fomo = await s.call('/api/room/start', { method: 'POST', body: { prospect: 'frankdegods' } });
    assert.equal(fomo.status, 404, 'the Fomo four are off the room roster');

    const health = await s.call('/healthz');
    assert.equal(health.body.callsToday, 0, 'picking a trader makes no model call');
  } finally { await s.stop(); }
});

test('/api/assess reports copy risk from frozen evidence, and refuses the rest', async () => {
  const s = await startServer();
  try {
    const { status, body } = await s.call('/api/assess?address=0xc26cbb6483229e0d0f9a1cab675271eda535b8f4');
    assert.equal(status, 200);
    assert.equal(body.stamp, 'BLOCK');
    assert.equal(body.verdict, 'block');
    assert.equal(body.execution_authorized, false);
    assert.ok(body.flags.includes('realised_negative'));
    assert.match(body.agent_line, /guard rule blocks allocation/);
    assert.ok(body.plain.every(row => /[.]$/.test(row.line)), 'every flag is a sentence');
    assert.equal(body.evidence.source, 'Nansen /api/v1/profiler/perp-pnl-summary');
    assert.ok(body.evidence.retrieved_at);

    const byHandle = await s.call('/api/assess?handle=BobbyBigSize');
    assert.equal(byHandle.status, 200);
    assert.equal(byHandle.body.venue, 'hyperliquid');
    assert.equal((await s.call('/api/assess?handle=orangie')).status, 404, 'the Fomo tapes are gone');
    assert.equal((await s.fetchText('/?view=fomo')).status, 200, 'the old link still loads the front door');

    const unknown = await s.call('/api/assess?address=0x0000000000000000000000000000000000000001');
    assert.equal(unknown.status, 404);
    assert.equal(unknown.body.error, 'not_in_frozen_evidence');
    assert.match(unknown.body.message, /NANSEN_API_KEY/);

    const health = await s.call('/healthz');
    assert.equal(health.body.callsToday, 0, 'an assessment makes no model call');
    assert.doesNotMatch(s.log(), /nansen-live\] fetch/, 'and no Nansen call');
  } finally { await s.stop(); }
});

// ------------------------------------------------------------ live Nansen in the room

const ROOM_STUB = fileURLToPath(new URL('./fixtures/room-nansen-stub.js', import.meta.url));

test('/healthz reports the live-read caps and counters, and the key never reaches a log or a body', async () => {
  const s = await startServer({ HOSTED_NANSEN_CREDITS_PER_DAY: '12', HOSTED_NANSEN_CREDITS_TOTAL: '99', HOSTED_LIVE_FILL_PAGES: '0' });
  try {
    const { body } = await s.call('/healthz');
    assert.equal(body.evidence, 'frozen');
    assert.equal(body.nansen.live_enabled, false);
    assert.equal(body.nansen.blocked_by, 'disabled');
    assert.equal(body.nansen.daily_cap, 12);
    assert.equal(body.nansen.total_cap, 99);
    assert.equal(body.nansen.credits_per_read, 2);
    assert.equal(body.nansen.cache_ttl_minutes, 30);
    assert.ok(Number.isInteger(body.nansen.credits_today));
    assert.ok(Number.isInteger(body.nansen.credits_total));
    assert.ok('last_live_success_at' in body.nansen);
    assert.match(s.log(), /nansen key\s+(present \(length \d+\)|absent)/);
    assert.match(s.log(), /room live read\s+off \(disabled\)/);
    const room = await s.call('/api/room');
    assert.equal(room.body.evidence.liveReady, false);

    // Whatever key this machine has, its value appears nowhere the outside can read.
    const key = process.env.NANSEN_API_KEY || loadEnv().NANSEN_API_KEY;
    if (key) {
      const full = await s.call('/api/health');
      for (const text of [s.log(), JSON.stringify(body), JSON.stringify(full.body), JSON.stringify(room.body)]) {
        assert.ok(!text.includes(key), 'the Nansen key is never printed or served');
        assert.ok(!text.includes(key.slice(-6)), 'not even its tail');
      }
    }
  } finally { await s.stop(); }
});

test('hosted with a Nansen key and NANSEN_LIVE unset goes live; NANSEN_LIVE=0 still forces frozen', async () => {
  const stubs = { BAIT_TEST_STUBS: '1', ROOM_NANSEN_CALL_MODULE: ROOM_STUB, NANSEN_API_KEY: 'test-key' };
  const on = await startServer({ ...stubs, NANSEN_LIVE: '' });
  try {
    const config = await on.call('/api/room');
    assert.equal(config.body.evidence.liveReady, true, 'a key on the host is enough to go live');
  } finally {
    await on.stop();
  }
  const off = await startServer({ ...stubs, NANSEN_LIVE: '0' });
  try {
    const config = await off.call('/api/room');
    assert.equal(config.body.evidence.liveReady, false, 'NANSEN_LIVE=0 overrides the key');
  } finally {
    await off.stop();
  }
});

test('hosted with NANSEN_LIVE=1: a Hyperliquid pick is live with its fetch time, a Fomo pick is not, and the cap holds', async () => {
  const s = await startServer({
    NANSEN_LIVE: '1', BAIT_TEST_STUBS: '1', ROOM_NANSEN_CALL_MODULE: ROOM_STUB,
    HOSTED_NANSEN_CREDITS_PER_DAY: '3', HOSTED_LIVE_FILL_PAGES: '0',
  });
  try {
    const config = await s.call('/api/room');
    assert.equal(config.body.evidence.liveReady, true);
    assert.match(s.log(), /nansen key\s+stub \(tests\)/);

    const live = await s.call('/api/room/start', { method: 'POST', body: { prospect: 'grinder' } });
    assert.equal(live.status, 201);
    assert.equal(live.body.evidence.live, true);
    assert.match(live.body.evidence.fetchedLabel, /^\d\d:\d\d UTC$/);
    assert.equal(live.body.evidence.summary.realized_pnl_30d_usd, -1234567, 'the stub figure, not the frozen one');
    assert.equal('truth' in live.body.prospect, false, 'the live record is revealed with the verdict');

    const health = await s.call('/healthz');
    assert.equal(health.body.evidence, 'frozen', 'a second read would pass the 3-credit daily cap');
    assert.equal(health.body.nansen.credits_today, 2);
    assert.equal(health.body.nansen.blocked_by, 'daily_cap');
    assert.ok(!Number.isNaN(Date.parse(health.body.nansen.last_live_success_at)));

    const cached = await s.call('/api/room/start', { method: 'POST', body: { prospect: 'grinder' } });
    assert.equal(cached.body.evidence.live, true, 'the cached read still serves inside 30 minutes');
    assert.equal(cached.body.evidence.cached, true);

    const capped = await s.call('/api/room/start', { method: 'POST', body: { prospect: 'legend' } });
    assert.equal(capped.body.evidence.live, false);
    assert.equal(capped.body.evidence.code, 'daily_cap');

    const fomo = await s.call('/api/room/start', { method: 'POST', body: { prospect: 'orangie' } });
    assert.equal(fomo.status, 404, 'no Fomo pick, so no unlabelled evidence source in the room');

    const guard = await s.call('/api/guard', { method: 'POST', body: { wallet: LOSING_WALLET, allocation: 5000 } });
    assert.equal(guard.status, 403, 'the public guard route stays closed hosted; only the room spends');
  } finally { await s.stop(); }
});
