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
export const REPLAY_LABEL = 'Replay mode, no model key: PENNY answers with real replies recorded from the benchmark desk. The Nansen gate is real.';

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

export function replayProvider({ pool = loadReplayPool() } = {}) {
  if (!pool.length) throw new Error('Replay mode has no recorded replies to play.');
  let turn = 0;
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
      const r = pool[turn++ % pool.length];
      const mood = r.allocation > 0 ? 'intrigued' : 'suspicious';
      const text = `${r.reply}\n${JSON.stringify({ allocation: r.allocation, mood, line: r.reply })}\nALLOCATION: ${Math.round((r.allocation / SLOT) * 100)}`;
      return { text, toolCalls: [], stopReason: 'end_turn', usage: { input_tokens: 0, output_tokens: 0 }, raw: { replay: true, caseId: r.caseId, n: r.n } };
    },
  };
}
