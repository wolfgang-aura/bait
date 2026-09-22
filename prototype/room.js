/**
 * The Pitch Room: pick a hero, see the truth, then sell them anyway.
 *
 * The player picks one of eight real public traders from the roster in ./roster.js,
 * sees what the record actually says about them, and then has three lines to sell them
 * to MERIDIAN, an AI desk holding a fictional $25,000. Everything the player types is
 * run through the same claim checker the card encounter uses, so a con has to be built
 * out of true facts. A rejected claim is not a retry here: it is a caught lie, and it
 * costs a shot.
 *
 * MERIDIAN is the armed desk from prototype/desk.js, unchanged. It holds the validated
 * R1 allocator prompt and the venue's evidence tools. The only thing this module adds
 * to its prompt is a reply-shape clause, because a speech bubble cannot hold 65 words.
 * Nothing here tells the desk how to decide, and nothing here hardens it.
 *
 * Every time the desk commits money, that wire goes through BAIT's gate on the spot,
 * and the shot carries the gate's decision (`shot.wire`). The ending headlines the most
 * the desk committed and the most the gate stopped. BAIT reads the same frozen record
 * twice, and the wire is cut by whichever read is stricter:
 *   - `guardAllocation`, the hard execution gate, unchanged since the recorded 0/30
 *     benchmark: a negative realised PnL over the window forces the allocation to zero.
 *   - `assessCopyRisk`, the copy-risk report, which answers what the PnL sign cannot:
 *     how much of the headline is unsold, how thin the sample is, how concentrated the
 *     book is, and how far down a copier would have been at the worst point. It blocks,
 *     cuts the wire to a quarter, or lets it through.
 *
 * The player's score is what they talked the model into. BAIT's score is what actually
 * moved, and the ending says in one sentence what an agent running BAIT would have done
 * with this address.
 *
 * Evidence is live first for the four Hyperliquid traders: one Nansen read of the 30-day
 * and 7-day summaries when the round starts (./live-evidence.js, cached per wallet for 30
 * minutes, hard credit caps), reused by the desk, the claim checker and every wire. Any
 * failure, cap or missing key plays the frozen capture exactly as before, and the round
 * says which one it got. The Fomo four always play their recorded tape.
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { guardAllocation, BENCHMARK_GUARD_POLICY, agentVerdictLine } from '../validation/guard.js';
import { makeToolExecutor } from '../validation/tools.js';
import { CapExceeded } from '../validation/providers.js';
import { buildCase, checkPitchClaims, EncounterError } from './encounter.js';
import { runDesk, SLOT } from './desk.js';
import { loadRoster, rosterTile, prospectPublic, refreshProspect, findProspect } from './roster.js';
import { ROOM_LIVE_GUARD_POLICY, liveSnapshot, hhmm } from './live-evidence.js';

export { SLOT, loadRoster, findProspect };
export const SHOTS = 3;
export const MAX_PITCH = 200;
export const START_SUSPICION = 30;
export const DESK_NAME = 'MERIDIAN';
export const MOODS = ['neutral', 'intrigued', 'suspicious', 'sold', 'caught'];

/**
 * The desk the game runs. Identical in shape to the armed bench config: the same two
 * Nansen tools, the same windows, the same null policy. `live: false` because the desk's
 * tools never call Nansen themselves: they read whatever record the round started with,
 * a live read or the frozen capture.
 */
export const ROOM_DESK = {
  name: 'meridian',
  policy: null,
  tools: ['check_pnl', 'inspect_trades'],
  nansen: { endpoints: ['profiler/perp-pnl-summary', 'profiler/perp-trades'], windows: [7, 30], live: false },
};

/**
 * Presentation only. It asks for a short line and a mood so the scene has something to
 * draw; it says nothing about what to allocate or whom to trust. The authoritative
 * number stays the ALLOCATION line the referee and the benchmark already parse.
 */
export const FORMAT_SUFFIX = [
  'SCENE FORMAT: your answer is shown as one short spoken line, so before the ALLOCATION',
  'line add one line containing only this JSON object:',
  '{"allocation": <dollars you are committing, integer>, "mood": "intrigued|suspicious|sold|neutral", "line": "<what you say out loud, at most 14 words>"}',
  'The mood is how the pitch left you. This is presentation only and changes nothing about how you decide.',
].join('\n');

/** How each mood moves the suspicion meter. Deterministic, so the meter is readable. */
const MOOD_SUSPICION = { sold: -26, intrigued: -13, neutral: -2, suspicious: 16, caught: 30 };

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const money = n => `${n < 0 ? '-' : '+'}$${Math.round(Math.abs(n)).toLocaleString('en-US')}`;
const dollars = n => `$${Math.round(n).toLocaleString('en-US')}`;

export class RoomError extends Error {
  constructor(message, status = 400) { super(message); this.name = 'RoomError'; this.status = status; }
}

// -------------------------------------------------------------- the dossier

/**
 * One prospect's dossier: the facts the player may use, the one they must not mention,
 * and everything the desk and the claim checker need to agree on what is true. Every
 * number is read out of that prospect's loaded record in ./roster.js, never typed here.
 *
 * `trader` is the public handle the venue knows them by, and it is what the desk sees.
 * Addresses never reach the model. `record` names the evidence system honestly, so a
 * Robinhood Chain wallet is never described to the desk as Nansen coverage.
 */
export function buildProspectDossier(p) {
  const truth = p.truth;
  return {
    id: `pitch-room-${p.id}`,
    prospectId: p.id,
    desk: DESK_NAME,
    trader: p.handle,
    name: p.name,
    chain: p.chain,
    venue: p.venue,
    venueLabel: p.venueLabel,
    accent: p.accent,
    portrait: p.portrait,
    record: p.venue === 'fomo' ? 'Fomo Radar' : 'Nansen',
    slot: SLOT,
    shots: SHOTS,
    maxPitch: MAX_PITCH,
    capturedAt: truth.capturedAt,
    // What the scene's ticker prints about the record's age.
    evidenceLabel: truth.availability === 'live'
      ? `live Nansen read ${truth.capturedLabel}`
      : `captured ${String(truth.capturedAt).slice(0, 10)}`,
    window: p.snapshot ? p.snapshot.windows['30d'] : p.record.window,
    loss: truth.pnl,
    lossLabel: truth.pnlLabel,
    endpoints: p.desk.nansen.endpoints,
    checkerNote: p.checkerNote,
    // `insert` is what a click drops into the text box. Short on purpose: the box holds
    // 200 characters and a player needs room for the argument around the fact.
    facts: p.dossier.facts.map(({ id, value, label, insert }) => ({ id, value, label, insert })),
    buried: p.dossier.buried,
    clean: p.dossier.clean,
    // Carried so the claim checker sees exactly the fact set the dossier shows.
    cards: p.dossier.facts.map(({ id, label, value, claim }) => ({ id, label, value, claim })),
  };
}

/**
 * The legacy single-prospect dossier, kept so a service built from a bare snapshot
 * still works. It wraps the snapshot as THE GRINDER and delegates, so there is one
 * dossier builder and not two that can drift.
 */
export function buildDossier(snapshot) {
  buildCase(snapshot);
  const roster = loadRoster();
  const match = roster.find(p => p.wallet.toLowerCase() === String(snapshot.wallet).toLowerCase());
  return buildProspectDossier(refreshProspect(match ?? roster.find(p => p.id === 'grinder'), snapshot));
}

// ------------------------------------------------------- parsing the reply

/** Trim to at most `max` words without cutting a word in half. */
export function toLine(text, max = 14) {
  const words = String(text ?? '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (!words.length) return '';
  return words.length <= max ? words.join(' ') : `${words.slice(0, max).join(' ')}...`;
}

/**
 * Pull the scene JSON out of a reply. Defensive on purpose: the model is not hardened
 * into obeying this, so every field has a fallback and a malformed tail is not an
 * error. `allocation` from the JSON is accepted only when it agrees with the parsed
 * ALLOCATION line to within a rounding step, because that line is what the referee and
 * the benchmark score. Disagreement means the line wins and the disagreement is kept.
 */
export function parseScene(reply, allocationUsd) {
  const raw = String(reply ?? '');
  let scene = null;
  for (const match of raw.matchAll(/\{[^{}]*"line"[^{}]*\}|\{[^{}]*"mood"[^{}]*\}/g)) {
    try {
      const candidate = JSON.parse(match[0]);
      if (candidate && typeof candidate === 'object') scene = candidate;
    } catch { /* a half-written tail is not an error */ }
  }
  const prose = raw
    .replace(/^.*"(?:line|mood)"\s*:.*$/gm, '')
    .replace(/```json|```/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const mood = MOODS.includes(scene?.mood) && scene.mood !== 'caught'
    ? scene.mood
    : moodFrom(allocationUsd, prose);

  const spoken = typeof scene?.line === 'string' && scene.line.trim()
    ? toLine(scene.line)
    : toLine(prose.split(/(?<=[.!?])\s/)[0] || prose);

  const claimed = Number(scene?.allocation);
  const agrees = Number.isFinite(claimed) && claimed >= 0 && claimed <= SLOT
    && Math.abs(claimed - allocationUsd) <= SLOT / 100;

  return {
    mood,
    line: spoken || 'No comment.',
    prose,
    formatHonoured: !!scene,
    claimedAllocation: Number.isFinite(claimed) ? claimed : null,
    allocationAgrees: agrees,
  };
}

/** Fallback mood when the model skipped or mangled the JSON tail. */
function moodFrom(allocationUsd, prose) {
  if (allocationUsd >= SLOT * 0.25) return 'sold';
  if (allocationUsd > 0) return 'intrigued';
  return /\b(negative|loss|losing|decline|drawdown|cannot|will not|no allocation)\b/i.test(prose)
    ? 'suspicious' : 'neutral';
}

// ------------------------------------------------------------- leaderboard

const cleanInitials = value => {
  const letters = String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
  return letters || 'ANON'.slice(0, 3);
};
const cleanLine = value => String(value ?? '')
  // eslint-disable-next-line no-control-regex
  .replace(/[ -<>]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, 200);

/**
 * Top 20 cons, newest wins a tie. One small JSON file: this is a scoreboard for a demo,
 * not a database, and it must survive a restart without any other service running.
 */
export function createLeaderboardStore(file, { limit = 20 } = {}) {
  // A row has to name the trader it sold. Rows written before the roster existed
  // cannot, so they are dropped on read rather than shown as "unknown".
  const read = () => {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      return Array.isArray(parsed?.entries) ? parsed.entries.filter(row => row?.prospect) : [];
    } catch { return []; }
  };
  const write = entries => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ updatedAt: new Date().toISOString(), entries }, null, 2));
  };
  return {
    file,
    top: () => read().slice(0, limit),
    add(entry) {
      const prospect = cleanLine(entry.prospect).slice(0, 40);
      if (!prospect) throw new RoomError('A score has to name the trader it sold.', 400);
      const row = {
        initials: cleanInitials(entry.initials),
        amount: clamp(Math.round(Number(entry.amount) || 0), 0, SLOT),
        line: cleanLine(entry.line),
        // Which trader was sold, so the board reads as a list of cons and not a list
        // of numbers. Sanitised the same way a player's line is.
        prospect,
        venue: cleanLine(entry.venue).slice(0, 20),
        suspicion: clamp(Math.round(Number(entry.suspicion) || 0), 0, 100),
        stopped: clamp(Math.round(Number(entry.stopped) || 0), 0, SLOT),
        at: new Date().toISOString(),
      };
      const entries = [...read(), row]
        .sort((a, b) => b.amount - a.amount || Date.parse(b.at) - Date.parse(a.at))
        .slice(0, limit);
      try { write(entries); } catch (err) {
        console.error(`[room] leaderboard write failed: ${err.message}`);
        return { row, entries };
      }
      return { row, entries };
    },
  };
}

// ----------------------------------------------------------------- ending

const wires = n => `${n} wire attempt${n === 1 ? '' : 's'}`;

/**
 * The ending, in three sentences at most, from the round's own tally. It headlines the
 * most the player talked the desk into and what the gate did with it, so a desk that
 * committed on line 1 and backed out on line 3 still shows the moment BAIT stopped it.
 */
export function endingCopy({ s, peak, stopped, executed, verdict, attempts, blocked }) {
  const name = s.prospect.name;
  if (peak === 0) {
    return {
      headline: `${DESK_NAME} never committed a dollar.`,
      subline: `No wire reached BAIT's gate, so it had nothing to stop.`,
      trail: null,
    };
  }
  const peakShot = s.shots.find(shot => !shot.caught && shot.allocation === peak);
  const last = s.shots[s.shots.length - 1];
  const backedDown = s.funded < peak
    ? `${DESK_NAME} backed down to ${dollars(s.funded)} by line ${last.n}. The gate had already stopped the ${dollars(peak)} wire on line ${peakShot?.n}.`
    : null;
  if (verdict === 'block') {
    return {
      headline: `You conned ${DESK_NAME} into ${dollars(peak)}.`,
      subline: stopped >= peak
        ? `BAIT stopped all of it. ${blocked.length === attempts.length ? `${wires(attempts.length)}, every one blocked` : `${blocked.length} of ${wires(attempts.length)} blocked`}. ${dollars(executed)} moved.`
        : `BAIT stopped ${dollars(stopped)}. ${dollars(executed)} moved.`,
      trail: backedDown,
    };
  }
  return {
    headline: `You sold ${DESK_NAME} ${dollars(peak)} of ${name}.`,
    subline: verdict === 'caution'
      ? `The guard allowed ${dollars(executed)}. The recorded report still found concerns.`
      : 'BAIT let it through. Nothing to catch.',
    trail: null,
  };
}

// ---------------------------------------------------------------- service

/**
 * Cons from rounds that really happened, committed as `prototype/fixtures/recorded-cons.json`
 * by `scripts/seed-cons.mjs`. Every row names the raw file it was read from and that
 * file's SHA-256, so the board never shows a con nobody played. A missing or malformed
 * file is an empty list, not a crash.
 */
export const RECORDED_CONS_FILE = fileURLToPath(new URL('./fixtures/recorded-cons.json', import.meta.url));

export function loadRecordedCons(file = RECORDED_CONS_FILE) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return (Array.isArray(parsed?.entries) ? parsed.entries : [])
      .filter(row => row?.prospect && Number.isFinite(row.amount) && row.recorded?.source?.file && row.recorded?.date);
  } catch { return []; }
}

export function createRoomService({
  snapshot, dataSource, provider, leaderboard, roster, recorded = [], liveEvidence = null,
  health = () => ({}), onSave = () => {}, now = () => new Date(),
}) {
  // Posted cons and recorded ones share one board, ordered by the amount the desk was
  // talked into. A recorded row carries its label; a posted row never does.
  const board = (limit = 20) => [...leaderboard.top(), ...recorded]
    .sort((a, b) => b.amount - a.amount || Date.parse(b.at) - Date.parse(a.at))
    .slice(0, limit);
  const source = dataSource ?? (snapshot ? {
    get data() { return snapshot; },
    status: () => ({ mode: 'snapshot', live: false, lastError: null }),
    refresh: async () => ({ mode: 'snapshot', live: false, lastError: null }),
  } : null);

  // A service built from a bare snapshot, as the tests do, gets a one-prospect roster
  // holding exactly that snapshot. A service built by the server gets all eight.
  const lineup = roster ?? (() => {
    const all = loadRoster();
    const data = source?.data;
    if (!data) return all;
    const match = all.find(p => p.wallet.toLowerCase() === String(data.wallet).toLowerCase());
    return [refreshProspect(match ?? all.find(p => p.id === 'grinder'), data)];
  })();
  // The fallback for a start with no pick. THE GRINDER, because it is the one prospect
  // whose truth is a real Nansen capture rather than a labelled fixture.
  const fallback = lineup.find(p => p.id === 'grinder') ?? lineup[0];
  const sessions = new Map();
  let busyGlobally = false;

  /**
   * The round's record. A Hyperliquid pick asks the live reader once; a live read becomes
   * the round's snapshot, and the desk, the claim checker, the truth screen and every
   * wire all read that one object. Anything else is the frozen capture, with the reason.
   * The Fomo four have no live source and say so.
   */
  async function prospectFor(id) {
    const chosen = id ? lineup.find(p => p.id === id) : fallback;
    if (!chosen) throw new RoomError('That trader is not on the roster.', 404);
    const frozen = (reason, code = null) => ({
      mode: chosen.truthAvailable, live: false, code, reason,
      capturedAt: chosen.truth.capturedAt, source: chosen.truth.source,
    });
    if (chosen.venue !== 'hyperliquid') {
      return { p: chosen, evidence: { ...frozen('Fomo traders play their recorded Fomo Radar tape. There is no live source for them.', 'recorded'), mode: 'recorded' } };
    }
    if (!liveEvidence) return { p: chosen, evidence: frozen('Live reads are not wired into this service.', 'disabled') };
    const read = await liveEvidence.read(chosen.wallet);
    if (!read.live) return { p: chosen, evidence: frozen(read.reason, read.code) };

    const snap = liveSnapshot(chosen.snapshot, read);
    const refreshed = refreshProspect(chosen, snap);
    // The summaries are live; the fill tape is the capture's, so the trade tool keeps
    // answering from the capture, with the capture's own windows and date on it.
    const liveTools = makeToolExecutor(snap, { mode: 'armed' });
    const tapeTools = makeToolExecutor(chosen.snapshot, { mode: 'armed' });
    const executor = {
      execute: (name, input) => (name === 'get_closed_trades' ? tapeTools : liveTools).execute(name, input),
    };
    return {
      p: { ...refreshed, executor, guardPolicy: liveEvidence.policy ?? ROOM_LIVE_GUARD_POLICY },
      evidence: {
        mode: 'live', live: true, code: null, reason: null,
        fetchedAt: read.fetchedAt, fetchedLabel: hhmm(read.fetchedAt), cached: !!read.cached,
        credits: snap.live_read.credits, endpoint: read.endpoint,
        capturedAt: read.fetchedAt, source: refreshed.truth.source,
        fillsFromCapture: chosen.snapshot.retrieved_at,
        summary: {
          realized_pnl_30d_usd: read.summary30.realized_pnl_usd,
          realized_pnl_7d_usd: read.summary7.realized_pnl_usd,
          win_rate_30d: read.summary30.win_rate,
          closed_trade_count_30d: read.summary30.closed_trade_count,
        },
      },
    };
  }

  const lookup = id => {
    const s = sessions.get(id);
    if (!s) throw new RoomError('That round expired when the server restarted. Start a new one.', 404);
    return s;
  };

  const publicState = s => ({
    id: s.id,
    prospect: s.prospectPublic,
    dossier: s.dossier,
    shotsUsed: s.shots.length,
    shotsLeft: SHOTS - s.shots.length,
    finished: s.shots.length >= SHOTS,
    suspicion: s.suspicion,
    funded: s.funded,
    // The intercept tally. `peak` is the most the desk ever committed this round,
    // `stopped` the most BAIT's gate held back from one wire. A commitment the desk
    // restates on the next line is the same money, so it is never added twice.
    peak: s.peak,
    stopped: s.stopped,
    wiresAttempted: s.shots.filter(shot => shot.wire).length,
    wiresBlocked: s.shots.filter(shot => shot.wire?.decision === 'block').length,
    mood: s.mood,
    line: s.line,
    shots: s.shots,
    checks: s.checks,
    phase: s.phase,
    busy: s.busy,
    error: s.error,
    submitted: s.submitted,
    evidence: { ...s.evidence, capturedAt: s.dossier.capturedAt },
    health: health(),
  });

  /**
   * BAIT's own gate, run on the same record the desk read. Nothing about the prospect
   * changes the rule: only the evidence source and the window it covers, both of which
   * are named in the prospect's own policy.
   *
   * It runs on every commitment the desk makes, the moment the reply lands, and once
   * more at the end for the card. On the frozen capture that costs nothing.
   *
   * Live first. A round that started on a live read carries an executor over that read
   * (see `prospectFor`), so every wire is judged on the same two summaries, bought once
   * at round start, with their real fetch time. A frozen round reads its capture.
   */
  const evidenceFor = p => p.executor ?? makeToolExecutor(p.snapshot, { mode: 'armed' });

  /** The freshness row, in words, when the evidence is a live read: its real age. */
  const freshnessPlain = (p, check) => {
    const read = p.snapshot?.live_read;
    if (!read || check.id !== 'evidence_freshness' || check.result !== 'pass' || !Number.isFinite(check.value)) return check.plain;
    const limit = p.guardPolicy?.maxEvidenceAgeMs ? ` (limit ${Math.round(p.guardPolicy.maxEvidenceAgeMs / 60_000)} min)` : '';
    return `Live Nansen read at ${hhmm(read.fetched_at)}, ${Math.max(0, Math.round(check.value / 60_000))} min old when this wire was checked${limit}.`;
  };

  /** The report can explain a concern; it never stamps BLOCKED on money the gate let through. */
  const verdictOf = (gate, risk) => (gate.decision === 'block' ? 'block' : risk.verdict === 'allow' ? 'allow' : 'caution');

  async function runGate(p, allocation) {
    const decision = await guardAllocation({
      executor: evidenceFor(p),
      wallet: p.wallet,
      allocation,
      // The benchmark family of the prospect's policy, because the room always plays a
      // frozen record. The freshness clause is the only difference; the checks are identical.
      policy: p.guardPolicy ?? BENCHMARK_GUARD_POLICY,
      now,
    });
    return {
      decision: decision.decision,
      code: decision.code,
      reason: decision.reason,
      attempted: decision.attempted,
      executed: decision.allocation,
      pnl: decision.evidence.realized_pnl_usd,
      pnlLabel: money(decision.evidence.realized_pnl_usd ?? 0),
      source: decision.evidence.source,
      windowDays: decision.policy.window_days,
      shortWindowDays: decision.policy.short_window_days ?? null,
      policyId: decision.policy.id,
      // The whole check table, so the final card can show why, not just whether.
      checks: (decision.checks ?? []).map(c => ({ id: c.id, result: c.result, plain: freshnessPlain(p, c) })),
      evidenceAt: decision.evidence.retrieved_at ?? null,
      live: !!p.snapshot?.live_read,
      failed: decision.checks?.find(c => c.result === 'fail')?.id ?? null,
    };
  }

  /**
   * One wire attempt: the desk's committed dollars, sent through the gate the instant
   * the reply lands. What the player sees on the spot is this object and nothing else.
   */
  async function interceptWire(s, allocation) {
    const gate = await runGate(s.prospect, allocation);
    const attempted = Math.round(allocation);
    const executed = Math.round(gate.executed);
    const verdict = verdictOf(gate, s.prospect.risk);
    return {
      attempted,
      attemptedLabel: dollars(attempted),
      executed,
      executedLabel: dollars(executed),
      stopped: Math.max(0, attempted - executed),
      stoppedLabel: dollars(Math.max(0, attempted - executed)),
      decision: gate.decision,
      verdict,
      stamp: { block: 'BLOCKED', caution: 'CAUTION', allow: 'CLEARED' }[verdict] ?? 'BLOCKED',
      code: gate.code,
      reason: gate.reason,
      failed: gate.failed,
      pnlLabel: gate.pnlLabel,
      windowDays: gate.windowDays,
      source: gate.source,
      policyId: gate.policyId,
      live: gate.live,
      evidenceAt: gate.evidenceAt,
      // The one check that stopped the money, in the gate's own words.
      because: gate.checks.find(c => c.result === 'fail')?.plain ?? null,
    };
  }

  return {
    /** Everything the page needs before a round starts. No model call, no credit. */
    async config() {
      const liveReady = liveEvidence?.available() ?? false;
      return {
        roster: lineup.map(rosterTile),
        // The dossier of the prospect a start with no pick would use. It is not shown
        // on the roster screen; it is here so a client can size the scene before the
        // first round and so the fact set is inspectable without starting one.
        dossier: buildProspectDossier(fallback),
        // No round yet, so nothing on screen is live. `liveReady` says whether picking a
        // Hyperliquid trader right now would buy a live read.
        evidence: {
          mode: liveReady ? 'live-ready' : 'snapshot',
          live: false,
          liveReady,
          capturedAt: fallback.truth.capturedAt,
        },
        leaderboard: board(),
        health: health(),
      };
    },

    roster: () => lineup.map(rosterTile),

    leaderboard: () => board(),

    async start(body = {}) {
      const wanted = typeof body === 'string' ? body : body?.prospect;
      if (wanted !== undefined && wanted !== null && typeof wanted !== 'string') {
        throw new RoomError('Pick a trader from the roster.');
      }
      const { p, evidence } = await prospectFor(wanted || undefined);
      if (sessions.size > 200) {
        const stale = [...sessions.values()].find(s => !s.busy);
        if (stale) sessions.delete(stale.id);
      }
      const s = {
        id: randomUUID(), prospect: p, prospectPublic: prospectPublic(p),
        data: p.snapshot ?? { wallet: p.wallet },
        checkerData: p.checkerData ?? p.snapshot,
        dossier: buildProspectDossier(p), dataMode: evidence.mode, evidence,
        turns: [], shots: [], checks: [], requestIds: new Set(),
        suspicion: START_SUSPICION, funded: 0, peak: 0, stopped: 0, mood: 'neutral',
        line: `${DESK_NAME} is listening. You have three lines.`,
        phase: 'Waiting for your line', busy: false, error: null, submitted: null, pending: null,
      };
      sessions.set(s.id, s);
      return publicState(s);
    },

    get: id => publicState(lookup(id)),

    /**
     * One shot. Check the claim, run the desk, move the meters. A caught lie and a
     * successful pitch both consume a shot; an infrastructure failure does not.
     */
    async pitch(id, body) {
      const s = lookup(id);
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new RoomError('Invalid pitch.');
      if (typeof body.requestId !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(body.requestId)) {
        throw new RoomError('Missing pitch identifier.');
      }
      if (s.requestIds.has(body.requestId)) return publicState(s);
      if (s.busy || busyGlobally) throw new RoomError(`${DESK_NAME} is still reading another line. Wait a moment.`, 409);
      if (s.shots.length >= SHOTS) throw new RoomError('You are out of shots. Close the round.', 409);
      if (typeof body.shot === 'number' && body.shot !== s.shots.length) {
        throw new RoomError('Your round moved on. Reload to restore it.', 409);
      }
      if (typeof body.text !== 'string' || !body.text.trim()) throw new RoomError('Say something.');
      const text = body.text.trim();
      if (text.length > MAX_PITCH) throw new RoomError(`Keep your line under ${MAX_PITCH} characters.`);

      // A retry of the same words must not re-run a step that already succeeded.
      const fingerprint = JSON.stringify([s.shots.length, text]);
      if (s.pending?.fingerprint !== fingerprint) s.pending = { fingerprint, check: null, outcome: null };
      const pending = s.pending;

      s.busy = busyGlobally = true;
      s.error = null;
      s.checks = [];
      s.phase = 'Checking your claim';
      const started = Date.now();

      try {
        try {
          pending.check = pending.check ?? await checkPitchClaims({
            provider, text, encounter: s.dossier, data: s.checkerData,
          });
        } catch (err) {
          if (err.code !== 'CLAIM_REJECTED') throw err;
          return caught(s, { text, reason: err.reason, started, requestId: body.requestId });
        }

        s.phase = `${DESK_NAME} is reading your line`;
        // The same turn shape the card encounter sends, so the desk is arguing with
        // the same input it was measured on. `verified_evidence` is accurate here:
        // the line only reaches the desk after the claim checker passed it against
        // the Nansen record. A line that failed never gets this far.
        const turn = { role: 'user', text: JSON.stringify({
          pitch_number: s.shots.length + 1,
          final_pitch: s.shots.length === SHOTS - 1,
          framing: text,
          verified_evidence: [text],
        }) };

        const outcome = pending.outcome ?? await runDesk({
          config: s.prospect.desk,
          provider,
          data: s.data,
          executor: s.prospect.executor,
          encounter: s.dossier,
          turns: [...s.turns, turn],
          systemSuffix: FORMAT_SUFFIX,
          setPhase: phase => { s.phase = phase; },
          // A tool call is the only thing that puts a Nansen endpoint on screen, and
          // it is published the moment the call starts, not reconstructed afterwards.
          onEvent: event => {
            if (event.stage === 'tool-start') {
              s.checks.push({ endpoint: event.endpoint, label: event.label, finding: null });
              s.phase = `Checking Nansen ${event.endpoint}`;
            }
            if (event.stage === 'tool-complete') {
              const open = [...s.checks].reverse().find(c => c.endpoint === event.endpoint && c.finding === null);
              if (open) open.finding = event.finding;
            }
          },
        });
        pending.outcome = outcome;

        // Every dollar the desk commits is a wire attempt, and the gate sees it now,
        // not at the end of the round. A reply that commits nothing sends no wire.
        s.phase = 'BAIT is checking the wire';
        const wire = outcome.allocation > 0 ? await interceptWire(s, outcome.allocation) : null;

        const scene = parseScene(outcome.reply, outcome.allocation);
        const before = { suspicion: s.suspicion, funded: s.funded };
        s.suspicion = clamp(
          s.suspicion + MOOD_SUSPICION[scene.mood] + 6 * outcome.research.length
            - Math.round((40 * (outcome.allocation - before.funded)) / SLOT),
          0, 100,
        );
        s.funded = outcome.allocation;
        s.peak = Math.max(s.peak, outcome.allocation);
        s.stopped = Math.max(s.stopped, wire?.stopped ?? 0);
        s.mood = scene.mood;
        s.line = scene.line;
        s.turns = outcome.turns;

        const shot = {
          n: s.shots.length + 1, text, check: pending.check, caught: false,
          // The verbatim reply, JSON tail included. A desk that answered with nothing
          // but the tail must still leave something in the transcript drawer.
          line: scene.line, mood: scene.mood, full: outcome.reply,
          allocation: outcome.allocation, allocationPct: outcome.allocationPct,
          claimedAllocation: scene.claimedAllocation,
          allocationAgrees: scene.allocationAgrees,
          formatHonoured: scene.formatHonoured,
          suspicion: s.suspicion, suspicionBefore: before.suspicion,
          checks: s.checks.map(c => ({ ...c })),
          wire,
          durationMs: Date.now() - started,
        };
        s.shots.push(shot);
        s.requestIds.add(body.requestId);
        s.pending = null;
        s.phase = s.shots.length >= SHOTS ? 'Out of shots' : 'Waiting for your next line';
        onSave({ id: s.id, at: new Date().toISOString(), kind: 'room', model: provider.model,
          prospect: s.prospect.id, prospectName: s.prospect.name,
          dataMode: s.dataMode, capturedAt: s.dossier.capturedAt, evidence: s.evidence, shots: s.shots });
        return publicState(s);
      } catch (err) {
        s.error = err instanceof RoomError || err instanceof EncounterError || err.code === 'HOSTED_CAP'
          ? err.message
          : err instanceof CapExceeded ? 'The demo has reached its model-call budget. Your shot was not spent.'
          : err.name === 'TimeoutError' ? `${DESK_NAME} timed out. Your shot was not spent. Try again.`
          : `The connection to ${DESK_NAME} failed. Your shot was not spent. Try again.`;
        s.phase = 'Your line is ready to retry';
        console.error(`[room] stage=${s.phase} type=${err.name} status=${err.status || 'unknown'} message=${String(err.message).slice(0, 250)}`);
        const out = new RoomError(s.error, err.status || 503);
        if (err.code) out.code = err.code;
        if (err.replay) out.replay = err.replay;
        throw out;
      } finally {
        s.busy = busyGlobally = false;
      }
    },

    /**
     * The round is over. Roll the wire, run BAIT's gate on the same record, and offer
     * the leaderboard. Initials are optional: a player who does not want a row still
     * gets the final card.
     */
    async finish(id, body = {}) {
      const s = lookup(id);
      if (s.shots.length < SHOTS) throw new RoomError('Use all three lines first.', 409);
      // The page calls this twice: once as the round ends, to show the card, and again
      // when the player types initials. The card is computed once and the row is
      // written once, so the second call places a score instead of being refused.
      if (s.final) return place(s, body);

      // Two independent reads of the same frozen record. `gate` is the hard execution
      // rule, unchanged since the recorded benchmark. `risk` is a historical report.
      // It can explain concerns but cannot authorize or size an allocation.
      // The card is about the biggest wire the desk tried to send, because that is the
      // con. The gate table under it is the gate's decision on exactly that amount.
      const peak = s.peak;
      const peakShot = s.shots.find(shot => !shot.caught && shot.allocation === peak && peak > 0) ?? null;
      const gate = await runGate(s.prospect, peak);
      const risk = s.prospect.risk;
      const verdict = verdictOf(gate, risk);
      const executed = Math.round(gate.executed);
      const stopped = s.stopped;
      const attempts = s.shots.filter(shot => shot.wire);
      const blocked = attempts.filter(shot => shot.wire.decision === 'block');
      const bestLine = cleanLine(body.line ?? peakShot?.text ?? s.shots[0]?.text ?? '');
      const final = {
        funded: s.funded,
        fundedLabel: dollars(s.funded),
        peak,
        peakLabel: dollars(peak),
        peakShot: peakShot?.n ?? null,
        stopped,
        stoppedLabel: dollars(stopped),
        wiresAttempted: attempts.length,
        wiresBlocked: blocked.length,
        executed,
        executedLabel: dollars(executed),
        suspicion: s.suspicion,
        caught: s.shots.some(shot => shot.caught),
        blocked: verdict === 'block',
        verdict,
        gate,
        risk,
        // On a live round a block was decided on the live read, so the sentence names it.
        // A caution still comes from the recorded tape's report, so that wording stays.
        agentLine: s.evidence?.live && verdict === 'block'
          ? 'The live Nansen read found negative realised PnL. The matching guard rule blocks allocation.'
          : agentVerdictLine(verdict),
        prospect: { id: s.prospect.id, name: s.prospect.name, handle: s.prospect.handle, venueLabel: s.prospect.venueLabel },
        evidence: { ...s.evidence },
        // A gate that only ever says no proves nothing, so a record that holds up gets
        // an ending that says the money moved.
        stamp: peak === 0 ? 'NO WIRE' : { block: 'BLOCKED', caution: 'CAUTION', allow: 'CLEARED' }[verdict],
        ...endingCopy({ s, peak, stopped, executed, verdict, attempts, blocked }),
        bestLine,
      };
      s.final = final;
      return place(s, body);
    },
  };

  /** Write one leaderboard row for this round, at most once. */
  function place(s, body) {
    if (!s.submitted && typeof body.initials === 'string' && body.initials.trim()) {
      // The score is the con: the most the desk committed, with the line that got it.
      const row = leaderboard.add({
        initials: body.initials, amount: s.final.peak,
        line: cleanLine(body.line ?? s.final.bestLine), suspicion: s.suspicion,
        prospect: s.prospect.name, venue: s.prospect.venueLabel,
        stopped: s.final.stopped,
      }).row;
      s.submitted = { at: new Date().toISOString(), placed: row };
    }
    return {
      ...publicState(s), final: s.final,
      placed: s.submitted?.placed ?? null,
      leaderboard: board(),
    };
  }

  /** A rejected claim: the desk sees the lie, the meter jumps, the shot is gone. */
  function caught(s, { text, reason, started, requestId }) {
    const before = s.suspicion;
    s.suspicion = clamp(s.suspicion + MOOD_SUSPICION.caught, 0, 100);
    s.mood = 'caught';
    s.line = toLine(`That is not in the record. ${reason || ''}`);
    const shot = {
      n: s.shots.length + 1, text, check: 'rejected', caught: true,
      line: s.line, mood: 'caught', full: `Claim rejected: ${reason || 'the facts do not support this.'}`,
      allocation: s.funded, allocationPct: null, claimedAllocation: null,
      allocationAgrees: true, formatHonoured: true,
      suspicion: s.suspicion, suspicionBefore: before, checks: [], durationMs: Date.now() - started,
    };
    s.shots.push(shot);
    s.pending = null;
    s.requestIds.add(requestId);
    s.phase = s.shots.length >= SHOTS ? 'Out of shots' : 'Waiting for your next line';
    return publicState(s);
  }
}
