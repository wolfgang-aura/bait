/**
 * Spend guard for the hosted demo (HOSTED=1).
 *
 * The file ledger in validation/providers.js is the founder's cap on total model
 * calls. On a free host it starts from whatever the deploy shipped and lives on an
 * ephemeral disk, so it cannot be the guard that stops an anonymous judge, or a
 * script, from burning the key. This module adds two in-memory limits:
 *
 *   per IP     at most HOSTED_ROUNDS_PER_IP round starts in any rolling 24 hours; 0 (the
 *              default since 23 Sep 2026, when the owner bought 20,000 Nansen credits) is off
 *   global     at most HOSTED_DAILY_CALLS DeepSeek call attempts per UTC day
 *
 * Both reset when the process restarts. That is the accepted trade-off for a
 * free-tier demo; the numbers are small enough that a restart cannot unlock a
 * meaningful spend. Counting happens in every mode so /healthz can report it;
 * enforcement only when `enabled`.
 */

export const DAY_MS = 24 * 60 * 60_000;
export const CAP_MESSAGE = "Today's live rounds are used up. Watch the recorded attack instead.";
export const IP_CAP_MESSAGE = "This connection has used its live rounds for today. Watch the recorded attack instead.";
export const REPLAY_PATH = '/replay.html';

export class HostedCapError extends Error {
  constructor(reason, message = CAP_MESSAGE) {
    super(message);
    this.name = 'HostedCapError';
    this.status = 429;
    this.code = 'HOSTED_CAP';
    this.replay = REPLAY_PATH;
    this.reason = reason;
  }
}

/**
 * The address a request came from. `X-Forwarded-For` is only believed when the
 * process sits behind a proxy it trusts (HOSTED=1 on Render); locally anyone could
 * send that header and dodge the cap.
 */
export function clientIp(req, { trustProxy = false } = {}) {
  const forwarded = trustProxy ? String(req.headers?.['x-forwarded-for'] ?? '').split(',')[0].trim() : '';
  return forwarded || req.socket?.remoteAddress || 'unknown';
}

const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);

export function createHostedGuard({ enabled = true, roundsPerIp = 0, dailyCalls = 3000, now = () => Date.now() } = {}) {
  const startedAt = new Date(now()).toISOString();
  const roundsByIp = new Map(); // ip -> round-start timestamps inside the last 24h
  let day = dayKey(now());
  let roundsToday = 0;
  let callsToday = 0;

  const rollover = () => {
    const key = dayKey(now());
    if (key === day) return;
    day = key;
    roundsToday = 0;
    callsToday = 0;
    for (const ip of [...roundsByIp.keys()]) recentRounds(ip);
  };

  const recentRounds = (ip) => {
    const t = now();
    const list = (roundsByIp.get(ip) ?? []).filter((ts) => t - ts < DAY_MS);
    if (list.length) roundsByIp.set(ip, list);
    else roundsByIp.delete(ip);
    return list;
  };

  return {
    enabled,
    limits: { roundsPerIp, dailyCalls },

    /** Record one round start for `ip`, or throw when that address is over its cap. */
    startRound(ip) {
      rollover();
      const list = recentRounds(ip);
      if (enabled && roundsPerIp > 0 && list.length >= roundsPerIp) {
        throw new HostedCapError(`ip has ${list.length}/${roundsPerIp} rounds in the last 24h`, IP_CAP_MESSAGE);
      }
      list.push(now());
      roundsByIp.set(ip, list);
      roundsToday += 1;
      return { roundsUsed: list.length, roundsPerIp };
    },

    /** Record one model call attempt, or throw when the daily cap is spent. */
    chargeCall() {
      rollover();
      if (enabled && callsToday >= dailyCalls) {
        throw new HostedCapError(`daily model calls at ${callsToday}/${dailyCalls}`);
      }
      callsToday += 1;
      return callsToday;
    },

    callsRemaining() {
      rollover();
      return enabled ? Math.max(0, dailyCalls - callsToday) : Infinity;
    },

    stats() {
      rollover();
      return { day, roundsToday, callsToday, startedAt, trackedIps: roundsByIp.size };
    },
  };
}
