/**
 * The roster pulse: shared cache, spend under the room's caps, and a visible fallback.
 * Every Nansen call here is a stub; nothing reaches the network or spends a credit.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRosterPulse, PULSE_TTL_MS, pulseFigure } from './roster-pulse.js';
import { createLiveEvidence } from './live-evidence.js';
import { loadRoster } from './roster.js';

const ROSTER = loadRoster();

function setup({ fail = false, dailyCap = 100, enabled = true, keyPresent = true } = {}) {
  let t = Date.parse('2026-09-25T12:41:07Z');
  const now = () => new Date(t);
  const calls = [];
  const call = async (pathName, body) => {
    calls.push({ pathName, body });
    if (fail) throw Object.assign(new Error('Nansen 503: stubbed failure'), { status: 503 });
    return { status: 200, headers: { 'x-nansen-credits-cost': '1' },
      data: { data: { closed_trade_count: 1087, traded_coin_count: 16, realized_pnl_usd: -4242, win_rate: 0.5 } } };
  };
  // The room's own budget, with one round's read costing 2 credits (no fills, no positions).
  const live = createLiveEvidence({ enabled, keyPresent, call, now, dailyCap, totalCap: 1000, fillPages: 0, positions: false });
  const pulse = createRosterPulse({ prospects: ROSTER, call, budget: live, now });
  return { pulse, live, calls, tick: ms => { t += ms; } };
}

test('first load reads each roster wallet once, live and dated to the minute, charged to the room caps', async () => {
  const { pulse, live, calls } = setup();
  const view = await pulse.get();
  assert.equal(calls.length, ROSTER.length);
  assert.ok(calls.every(c => c.pathName === 'profiler/perp-pnl-summary'));
  const days = (Date.parse(calls[0].body.date.to) - Date.parse(calls[0].body.date.from)) / 86_400_000;
  assert.equal(days, 7);
  assert.equal(view.live, ROSTER.length);
  for (const w of view.wallets) {
    assert.equal(w.live, true);
    assert.equal(w.figure, '1,087 trades closed in the last 7 days');
    assert.equal(w.stamp, 'Nansen · read live 12:41 UTC');
  }
  assert.equal(live.status().credits_today, ROSTER.length, 'the pulse spends under the same counter as the rounds');
  assert.equal(pulse.status().worst_case_credits_per_hour, 20);
});

test('the pulse shows activity only: no realised PnL or win rate reaches the page', async () => {
  const { pulse } = setup();
  const printed = JSON.stringify(await pulse.get());
  assert.doesNotMatch(printed, /realized|realised|win_rate|4242|4,242/i);
});

test('page loads inside the TTL share one read; after the TTL one refresh follows', async () => {
  const { pulse, calls, tick } = setup();
  await Promise.all([pulse.get(), pulse.get(), pulse.get()]);
  assert.equal(calls.length, ROSTER.length, 'concurrent visitors share one in-flight refresh');
  tick(PULSE_TTL_MS - 1000);
  await pulse.get();
  assert.equal(calls.length, ROSTER.length, 'cached inside 15 minutes');
  tick(2000);
  const view = await pulse.get();
  assert.equal(calls.length, 2 * ROSTER.length);
  assert.equal(view.wallets[0].stamp, 'Nansen · read live 12:56 UTC');
});

test('a failed read falls back to the saved figure with its date, says so, and is not retried inside the TTL', async () => {
  const { pulse, live, calls, tick } = setup({ fail: true });
  const view = await pulse.get();
  assert.equal(view.live, 0);
  for (const [i, w] of view.wallets.entries()) {
    const saved = ROSTER[i].snapshot;
    assert.equal(w.live, false);
    assert.equal(w.status, 'failed');
    assert.equal(w.figure, pulseFigure(saved.pnl_summary_7d.closed_trade_count));
    assert.equal(w.stamp, `live read failed 12:41 UTC · Nansen ${saved.retrieved_at.slice(0, 10)} capture`);
  }
  assert.equal(pulse.status().last_failure.wallets.length, ROSTER.length);
  assert.equal(pulse.status().last_success_at, null);
  // A request that got an HTTP answer may be billed: counted as unused, still under the caps.
  assert.equal(live.status().credits_today, 0);
  assert.equal(live.status().credits_unused_today, ROSTER.length);
  tick(60_000);
  await pulse.get();
  assert.equal(calls.length, ROSTER.length, 'a failing provider is not hit again inside the TTL');
});

test('the caps refuse the pulse before a call leaves, and always keep one round in reserve', async () => {
  // 4 pulse credits + one 2-credit round read = 6 > 5: refused, so a pick can still read live.
  const { pulse, live, calls } = setup({ dailyCap: 5 });
  const view = await pulse.get();
  assert.equal(calls.length, 0);
  assert.equal(view.wallets[0].status, 'paused');
  assert.match(view.wallets[0].stamp, /^live reads paused: daily credit cap · Nansen \d{4}-\d\d-\d\d capture$/);
  assert.equal(live.available(), true, 'the round read still fits');
  assert.equal(pulse.status().blocked_by, 'daily_cap');
});

test('live reads off or no key: nothing is read and every tile says so', async () => {
  for (const [opts, words] of [[{ enabled: false }, 'live reads off'], [{ keyPresent: false }, 'live reads off: no Nansen key']]) {
    const { pulse, calls } = setup(opts);
    const view = await pulse.get();
    assert.equal(calls.length, 0);
    assert.ok(view.wallets.every(w => !w.live && w.stamp.startsWith(`${words} · Nansen `)));
  }
});

test('a live zero says the current week is quiet, so it does not deny a tile bragging about a dated week', () => {
  // Judge 4: THE GRINDER's "week to 15 Sep" tile sat over a live strip "0 trades closed in 7 days".
  assert.equal(pulseFigure(0, { live: true }), 'Quiet now: no trades closed in the last 7 days');
  assert.equal(pulseFigure(0), 'No trades closed in 7 days');
  assert.equal(pulseFigure(1, { live: true }), '1 trade closed in the last 7 days');
  assert.equal(pulseFigure(424), '424 trades closed in 7 days');
  assert.equal(pulseFigure(null), null);
});
