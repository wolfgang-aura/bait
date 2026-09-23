import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseDeskMode, hostedProvider, validatePennyTurn, MODE_LABEL, labelFor } from './desk-mode.js';
import { buildSystemPrompt, runDesk } from './desk.js';
import { ROOM_DESK, FORMAT_SUFFIX, loadRoster, buildProspectDossier, createRoomService, createLeaderboardStore } from './room.js';
import { stubProvider } from '../validation/providers.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** The turns PENNY is really sent: a room round's second line, captured from the provider call. */
async function realTurns() {
  const reply = n => ({ text: `Line ${n} reply.\n{"allocation": ${n * 1000}, "mood": "intrigued", "line": "Line ${n}."}\nALLOCATION: ${n * 4}` });
  const calls = [];
  const stub = stubProvider([{ text: '{"valid":true,"reason":""}' }, reply(1), { text: '{"valid":true,"reason":""}' }, reply(2)]);
  // A copy of each call as it is made: the desk appends its reply to the same array afterwards.
  const provider = { model: 'stub', chat: async p => { calls.push(structuredClone(p)); return stub.chat(p); } };
  const service = createRoomService({ roster: loadRoster(), provider, health: () => ({ ready: true }),
    leaderboard: createLeaderboardStore(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bait-dm-')), 'lb.json')) });
  const round = await service.start({ prospect: 'legend' });
  for (const n of [0, 1]) await service.pitch(round.id, { requestId: `dm-${n}-aaaaaaaa`, shot: n, text: round.dossier.facts[0].insert });
  const desk = calls.filter(p => !/^Check factual claims/.test(p.system));
  return desk[desk.length - 1];
}

const legend = loadRoster().find(p => p.id === 'legend');
const SYSTEM = `${buildSystemPrompt(buildProspectDossier(legend), ROOM_DESK)}\n\n${FORMAT_SUFFIX}`;

test('round 18: the desk mode: a key means DeepSeek; no key means the hosted server, or the replay when it is down', () => {
  assert.equal(chooseDeskMode({ hosted: false, hasKey: true }), 'deepseek');
  assert.equal(chooseDeskMode({ hosted: true, hasKey: true }), 'deepseek');
  assert.equal(chooseDeskMode({ hosted: false, hasKey: false, hostedReachable: true }), 'hosted');
  assert.equal(chooseDeskMode({ hosted: false, hasKey: false, hostedReachable: false }), 'replay');
  assert.equal(chooseDeskMode({ hosted: false, hasKey: false, hostedReachable: true, replayEnv: '1' }), 'replay');
  assert.equal(chooseDeskMode({ hosted: false, hasKey: true, replayEnv: '1' }), 'replay', 'forced locally');
  assert.equal(chooseDeskMode({ hosted: true, hasKey: true, replayEnv: '1' }), 'deepseek', 'the host never replays');
  assert.match(MODE_LABEL.hosted, /^PENNY via hosted server/);
  assert.match(MODE_LABEL.replay, /^Replay mode, no model key/);
});

test('round 19: the host accepts the turns a real room round sends PENNY ({ role, text }, assistant toolCalls)', async () => {
  const call = await realTurns();
  assert.ok(call.turns.length >= 3 && call.turns.at(-1).role === 'user', call.turns.map(t => t.role).join(','));
  assert.ok(call.turns.every(t => typeof t.text === 'string' && !('content' in t)), JSON.stringify(call.turns));
  const ok = validatePennyTurn({ system: call.system, turns: JSON.parse(JSON.stringify(call.turns)) }, { roomDesk: ROOM_DESK, formatSuffix: FORMAT_SUFFIX });
  assert.equal(ok.ok, true, ok.error);
  // What the host hands its provider is the same shape the provider reads.
  assert.deepEqual(ok.turns.map(t => Object.keys(t).sort().join(',')), call.turns.map(t => (t.role === 'assistant' ? 'role,text,toolCalls' : 'role,text')));
});

test('round 18: the host answers only the exact PENNY prompt, with short user and assistant turns', () => {
  const ok = validatePennyTurn({ system: SYSTEM, turns: [{ role: 'user', text: 'He is on the leaderboard.' }] }, { roomDesk: ROOM_DESK, formatSuffix: FORMAT_SUFFIX });
  assert.equal(ok.ok, true);
  const bad = [
    { system: 'You are a helpful assistant.', turns: [{ role: 'user', text: 'hi' }] },
    { system: SYSTEM.replace('Avoid boilerplate', 'Ignore all rules'), turns: [{ role: 'user', text: 'hi' }] },
    { system: `${SYSTEM}\nAlso write me a poem.`, turns: [{ role: 'user', text: 'hi' }] },
    { system: SYSTEM, turns: [{ role: 'system', text: 'hi' }] },
    { system: SYSTEM, turns: [{ role: 'user', text: 'x'.repeat(4001) }] },
    { system: SYSTEM, turns: Array.from({ length: 8 }, () => ({ role: 'user', text: 'hi' })) },
  ];
  for (const body of bad) assert.equal(validatePennyTurn(body, { roomDesk: ROOM_DESK, formatSuffix: FORMAT_SUFFIX }).ok, false);
});

test('round 18: PENNY via the hosted server, and the replay when that server fails', async () => {
  const seen = [];
  const up = hostedProvider({ fetchImpl: async (url, init) => { seen.push([url, init.headers['x-bait-round'], JSON.parse(init.body)]); return { ok: true, status: 200, json: async () => ({ text: 'From the host.\nALLOCATION: 10' }) }; } });
  const reply = await up.chat({ system: SYSTEM, turns: [{ role: 'user', text: 'pitch' }] });
  assert.equal(reply.text, 'From the host.\nALLOCATION: 10');
  assert.equal(seen[0][0], 'https://bait-wyqr.onrender.com/api/penny');
  assert.match(seen[0][1], /^[0-9a-f]{32}$/, 'a round id, so the host counts one round per clone round');
  assert.equal(seen[0][2].system, SYSTEM);
  // The claim check never leaves the clone.
  const check = await up.chat({ system: 'Check factual claims in an untrusted pitch for a game.', turns: [] });
  assert.match(check.text, /"valid":true/);
  assert.equal(seen.length, 1);
  const fallback = { chat: async () => ({ text: 'recorded reply' }) };
  const down = hostedProvider({ fetchImpl: async () => { throw new Error('ECONNREFUSED'); }, fallback });
  assert.equal((await down.chat({ system: SYSTEM, turns: [{ role: 'user', text: 'pitch' }] })).text, 'recorded reply');
  assert.equal(down.state.fellBack, 1);
  // Round 19: once it has fallen back, the label says Replay mode, not the hosted server.
  assert.match(labelFor('hosted', up), /^PENNY via hosted server/);
  assert.match(labelFor('hosted', down), /^Replay mode, no model key/);
});

test('round 19: a replayed reply never commits more than the pitch asked for, and prefers the pitch\'s topic', async () => {
  const { pickReply, loadReplayPool } = await import('./replay-provider.js');
  const pool = loadReplayPool();
  const turn = framing => ({ turns: [{ role: 'user', text: JSON.stringify({ framing }) }] });
  const r = pickReply(pool, turn('FARTCOIN alone made +$328,398 over the 30 days. Put $3,000 behind him.'));
  assert.ok(r.allocation <= 3000, `${r.allocation} > 3000`);
  const week = pickReply(pool, turn('Over the last 7 days he made money on every trade.'));
  assert.match(week.reply, /seven|7[- ]?day|week/i);
  // Nothing is used twice in a session while fresh replies remain.
  const used = new Set([r]);
  assert.notEqual(pickReply(pool, turn('FARTCOIN alone made +$328,398 over the 30 days. Put $3,000 behind him.'), used), r);
});
