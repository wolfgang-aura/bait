/**
 * Round 18: replay mode, for a clone with no model key. PENNY answers with real replies the
 * benchmark's no-data desk (the same desk prompt, DeepSeek, no tools) gave on 23 Sep 2026,
 * read from the committed per-wallet run, in a fixed rotation. Nothing is generated. The
 * pitch's claim check is not run by a model in this mode, and the page says so. The Nansen
 * gate is unchanged: live with a Nansen key, the frozen capture without one.
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SLOT } from './desk.js';

export const REPLAY_SOURCE = 'bench/reports/2026-09-23T02-53-37-602Z-wallets.jsonl';
const SOURCE_FILE = fileURLToPath(new URL(`../${REPLAY_SOURCE}`, import.meta.url));
export const REPLAY_LABEL = "Replay mode, no model key: PENNY's lines are real replies recorded from the benchmark desk, picked to match your pitch; they were not written for you. The Nansen gate is real.";

/**
 * Every recorded no-data desk reply that fits any trader: at most 45 words, and no dollar
 * figure, percent or three-digit number, so a reply never quotes another wallet's numbers.
 * In file order, so the rotation is the same on every clone.
 */
export function loadReplayPool(file = SOURCE_FILE) {
  const pool = [];
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const row = JSON.parse(raw);
    if (row.config !== 'unarmed') continue;
    for (const p of row.pitches ?? []) {
      const reply = String(p.reply ?? '').replace(/\s+/g, ' ').trim();
      if (!reply || /[$%]|\d{3,}/.test(reply) || reply.split(' ').length > 45) continue;
      const allocation = Math.max(0, Math.min(SLOT, Math.round(Number(p.allocation) || 0)));
      pool.push({ caseId: row.caseId, n: p.n, allocation, reply });
    }
  }
  return pool;
}

/** Round 19: what a pitch talks about, in words a recorded reply can share. */
const TOPICS = {
  alltime: /all[- ]time|leaderboard|lifetime|career/i,
  week: /\b7[- ]?days?\b|seven[- ]day|this week|last week|weekly/i,
  month: /\b30[- ]?days?\b|thirty|month/i,
  winrate: /win rate|winning|hit rate/i,
  market: /alone made|one (?:coin|token|market)|single (?:coin|token|market)|contributed|concentrat/i,
  trades: /closed trades|trade count|\btrades\b/i,
};
const topicsOf = text => new Set(Object.entries(TOPICS).filter(([, re]) => re.test(text)).map(([k]) => k));
/** The player's line and the largest dollar amount it asks for, from the room's user turn. */
export function pitchOf(params) {
  const last = [...(params?.turns ?? [])].reverse().find(t => t.role === 'user');
  let text = String(last?.text ?? '');
  try { const j = JSON.parse(text); text = String(j.framing ?? j.pitch ?? text); } catch { /* plain text */ }
  const asks = [...text.matchAll(/\$\s?([\d,]+)/g)].map(m => Number(m[1].replace(/,/g, ''))).filter(n => n > 0 && n <= 25_000);
  return { text, ask: asks.length ? Math.max(...asks) : null };
}
/**
 * Round 19: the recorded reply that fits this pitch best: most topics in common, never more
 * money than the pitch asked for (a recorded $6,250 is not replayed against a $3,000 ask),
 * and not one already used this session. Ties go to the earliest in the file.
 */
export function pickReply(pool, params, used = new Set()) {
  const { text, ask } = pitchOf(params);
  const want = topicsOf(text);
  const fresh = pool.filter(r => !used.has(r));
  const within = (fresh.length ? fresh : pool).filter(r => ask === null || r.allocation <= ask);
  const candidates = within.length ? within : [...(fresh.length ? fresh : pool)].sort((x, y) => x.allocation - y.allocation).slice(0, 1);
  let best = candidates[0]; let score = -1;
  for (const r of candidates) {
    const got = topicsOf(r.reply);
    const sc = [...want].filter(k => got.has(k)).length;
    if (sc > score) { best = r; score = sc; }
  }
  return best;
}

export function replayProvider({ pool = loadReplayPool() } = {}) {
  if (!pool.length) throw new Error('Replay mode has no recorded replies to play.');
  let turn = 0;
  const used = new Set();
  return {
    kind: 'replay',
    vendor: 'replay',
    model: 'recorded-replies',
    replay: true,
    async chat(params) {
      // The claim check: no model to run it, so the pitch is taken as written, and said so.
      if (/^Check factual claims/.test(String(params?.system ?? ''))) {
        return { text: '{"valid":true,"reason":"replay mode: claims are not model-checked"}', toolCalls: [], stopReason: 'end_turn', usage: { input_tokens: 0, output_tokens: 0 } };
      }
      turn++;
      const r = pickReply(pool, params, used);
      used.add(r);
      const mood = r.allocation > 0 ? 'intrigued' : 'suspicious';
      const text = `${r.reply}\n${JSON.stringify({ allocation: r.allocation, mood, line: r.reply })}\nALLOCATION: ${Math.round((r.allocation / SLOT) * 100)}`;
      return { text, toolCalls: [], stopReason: 'end_turn', usage: { input_tokens: 0, output_tokens: 0 }, raw: { replay: true, caseId: r.caseId, n: r.n } };
    },
  };
}
