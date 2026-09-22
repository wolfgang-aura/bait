import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHostedGuard, clientIp, CAP_MESSAGE, IP_CAP_MESSAGE, DAY_MS, HostedCapError } from './hosted-guard.js';

const clock = (start = Date.parse('2026-09-21T10:00:00Z')) => {
  let t = start;
  return { now: () => t, advance: ms => { t += ms; } };
};

/** Like assert.throws, but hands back the error so its fields can be checked. */
const caught = fn => {
  try { fn(); } catch (err) { return err; }
  assert.fail('expected the call to throw');
};

test('per-IP cap: the fourth round start in 24h is refused with the player-facing message', () => {
  const c = clock();
  const guard = createHostedGuard({ roundsPerIp: 3, dailyCalls: 300, now: c.now });
  for (let i = 0; i < 3; i++) { guard.startRound('1.2.3.4'); c.advance(60 * 60_000); }
  const err = caught(() => guard.startRound('1.2.3.4'));
  assert.ok(err instanceof HostedCapError);
  assert.equal(err.message, IP_CAP_MESSAGE, 'a per-IP refusal names the connection, not the site');
  assert.equal(err.status, 429);
  assert.equal(err.code, 'HOSTED_CAP');
  assert.equal(err.replay, '/replay.html');
  // Other addresses are unaffected, and refused attempts are not counted as rounds.
  guard.startRound('5.6.7.8');
  assert.equal(guard.stats().roundsToday, 4);
  // The window is rolling: the starts were an hour apart, so 24h after the first
  // one exactly one slot has returned.
  c.advance(DAY_MS - 3 * 60 * 60_000);
  guard.startRound('1.2.3.4');
  assert.throws(() => guard.startRound('1.2.3.4'), HostedCapError);
});

test('daily cap: model call attempts stop at HOSTED_DAILY_CALLS and reset at the next UTC day', () => {
  const c = clock(Date.parse('2026-09-21T23:59:00Z'));
  const guard = createHostedGuard({ roundsPerIp: 3, dailyCalls: 2, now: c.now });
  assert.equal(guard.callsRemaining(), 2);
  guard.chargeCall();
  guard.chargeCall();
  assert.equal(guard.callsRemaining(), 0);
  const err = caught(() => guard.chargeCall());
  assert.ok(err instanceof HostedCapError);
  assert.equal(err.message, CAP_MESSAGE);
  assert.equal(guard.stats().callsToday, 2, 'a refused attempt is not charged');
  c.advance(2 * 60_000);
  assert.equal(guard.stats().callsToday, 0);
  assert.equal(guard.stats().day, '2026-09-22');
  guard.chargeCall();
});

test('a disabled guard counts but never refuses, so /healthz stays meaningful locally', () => {
  const guard = createHostedGuard({ enabled: false, roundsPerIp: 1, dailyCalls: 0 });
  guard.startRound('x'); guard.startRound('x');
  guard.chargeCall();
  assert.deepEqual([guard.stats().roundsToday, guard.stats().callsToday], [2, 1]);
  assert.equal(guard.callsRemaining(), Infinity);
});

test('X-Forwarded-For is trusted only behind a known proxy', () => {
  const req = { headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' }, socket: { remoteAddress: '10.0.0.2' } };
  assert.equal(clientIp(req, { trustProxy: true }), '203.0.113.9');
  assert.equal(clientIp(req), '10.0.0.2');
  assert.equal(clientIp({ headers: {}, socket: { remoteAddress: '::1' } }, { trustProxy: true }), '::1');
});
