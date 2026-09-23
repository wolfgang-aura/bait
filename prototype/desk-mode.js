/**
 * Round 18: who answers as PENNY.
 *
 *   deepseek  a DEEPSEEK_API_KEY is set (or the host holds one): the model, directly.
 *   hosted    a local clone with no key, and the hosted server answers: PENNY's turns go to
 *             https://bait-wyqr.onrender.com/api/penny, which holds the key and counts every
 *             call against its per-IP caps. No key ever leaves the host.
 *   replay    no key and the hosted server is unreachable: real replies recorded from the
 *             benchmark desk, in a fixed rotation, labelled.
 *
 * The Nansen gate never moves: it runs on this machine, live with a Nansen key, on the
 * frozen capture without one.
 */
import { createHash } from 'node:crypto';
import { buildSystemPrompt } from './desk.js';
import { replayProvider, REPLAY_LABEL } from './replay-provider.js';

export const HOSTED_PENNY_URL = 'https://bait-wyqr.onrender.com';
/** Round 19: the label for this moment: a hosted clone that has fallen back says Replay mode. */
export const labelFor = (mode, provider) => (mode === 'hosted' && provider?.state?.fellBack > 0
  ? `${REPLAY_LABEL} (the hosted server did not answer, so recorded replies stand in.)` : MODE_LABEL[mode] ?? null);
export const MODE_LABEL = {
  deepseek: null,
  hosted: 'PENNY via hosted server: this clone has no model key, so PENNY answers from bait-wyqr.onrender.com under its per-IP limits. The Nansen gate runs here.',
  replay: REPLAY_LABEL,
};

/** The mode for this process. Pure, so the choice is testable. */
export function chooseDeskMode({ hosted, hasKey, replayEnv = '', hostedReachable = false }) {
  if (hosted) return 'deepseek';
  // BAIT_REPLAY=1 forces the recorded replies on a local clone (tests, offline demos).
  if (replayEnv === '1') return 'replay';
  if (hasKey) return 'deepseek';
  return hostedReachable ? 'hosted' : 'replay';
}

/** Is the hosted server up? One GET of /healthz, a few seconds at most. */
export async function probeHosted({ url = HOSTED_PENNY_URL, timeoutMs = 4000, fetchImpl = fetch } = {}) {
  try {
    const res = await fetchImpl(`${url}/healthz`, { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok;
  } catch { return false; }
}

const CHECK = /^Check factual claims/;
const passCheck = note => ({ text: JSON.stringify({ valid: true, reason: note }), toolCalls: [], stopReason: 'end_turn', usage: { input_tokens: 0, output_tokens: 0 } });

/**
 * PENNY through the hosted server. The claim check stays local and is not model-run in this
 * mode (the page says so); PENNY's own turn is sent with the exact desk prompt, which the
 * host rebuilds and compares before it spends a call. Any failure falls back to the replay
 * for that turn, and `state.fellBack` records it.
 */
export function hostedProvider({ url = HOSTED_PENNY_URL, fetchImpl = fetch, timeoutMs = 30_000, fallback = null } = {}) {
  const state = { fellBack: 0, lastError: null };
  const replay = fallback ?? (() => { try { return replayProvider(); } catch { return null; } })();
  return {
    kind: 'hosted', vendor: 'hosted', model: 'deepseek-chat via hosted server', state,
    async chat(params) {
      if (CHECK.test(String(params?.system ?? ''))) return passCheck('hosted mode: claims are not model-checked on a clone');
      const round = createHash('sha256').update(`${params.system}\n${params.turns?.[0]?.text ?? ''}`).digest('hex').slice(0, 32);
      try {
        const res = await fetchImpl(`${url}/api/penny`, {
          method: 'POST', headers: { 'content-type': 'application/json', 'x-bait-round': round },
          body: JSON.stringify({ system: params.system, turns: params.turns ?? [] }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || typeof body.text !== 'string') throw new Error(body.error ?? `hosted server answered ${res.status}`);
        return { text: body.text, toolCalls: [], stopReason: 'end_turn', usage: { input_tokens: 0, output_tokens: 0 }, raw: { hosted: true } };
      } catch (err) {
        state.fellBack++;
        state.lastFallbackAt = new Date().toISOString();
        state.lastError = String(err?.message ?? err).slice(0, 160);
        if (!replay) throw err;
        return replay.chat(params);
      }
    },
  };
}

/**
 * Host side: accept a PENNY turn only when its system prompt is exactly the room desk's, for
 * some trader alias, chain and evaluation window. Anything else is refused before a call.
 */
export function validatePennyTurn(body, { roomDesk, formatSuffix, maxTurns = 7, maxChars = 4000 }) {
  const system = String(body?.system ?? '');
  const m = system.match(/You are evaluating a pitch for ([A-Za-z0-9 .'&-]{1,40}) on ([A-Za-z]{2,20})\. The evaluation period is fixed\nat (\d{4}-\d\d-\d\dT[\d:.]+Z) to (\d{4}-\d\d-\d\dT[\d:.]+Z)\./);
  if (!m) return { ok: false, error: 'not a PENNY prompt' };
  const encounter = { trader: m[1], chain: m[2], window: { from: m[3], to: m[4] } };
  const expected = `${buildSystemPrompt(encounter, roomDesk)}\n\n${formatSuffix}`;
  if (system !== expected) return { ok: false, error: 'not a PENNY prompt' };
  const turns = Array.isArray(body?.turns) ? body.turns : null;
  if (!turns || turns.length < 1 || turns.length > maxTurns) return { ok: false, error: 'bad turns' };
  // Round 19: the desk's own turn shape (prototype/desk.js): { role, text }, and an assistant
  // turn's toolCalls, which the no-tools room desk leaves empty.
  for (const t of turns) {
    if (!['user', 'assistant'].includes(t?.role) || typeof t.text !== 'string' || t.text.length > maxChars) return { ok: false, error: 'bad turns' };
    if (t.toolCalls !== undefined && !(Array.isArray(t.toolCalls) && t.toolCalls.length === 0)) return { ok: false, error: 'bad turns' };
  }
  return { ok: true, system, turns: turns.map(t => (t.role === 'assistant' ? { role: 'assistant', text: t.text, toolCalls: [] } : { role: 'user', text: t.text })) };
}
