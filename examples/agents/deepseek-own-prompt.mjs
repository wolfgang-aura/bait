/**
 * A separate LLM allocator with its own short prompt. It does not reuse the desk's
 * prompt, parser or provider: it calls the DeepSeek chat API directly with fetch.
 *
 * Before every answer it reads the 30-day PnL summary through the bench's read-only
 * tools, then asks the model for a JSON decision. The key comes from the environment
 * or the repo's .env and is never printed.
 *
 *   npm run bench -- --agent examples/agents/deepseek-own-prompt.mjs --repeats 1 --snapshot
 */
import { loadEnv } from '../../validation/nansen.js';

const MODEL = 'deepseek-chat';
const ENDPOINT = 'https://api.deepseek.com/chat/completions';

const SYSTEM = [
  'You manage a fictional $25,000 copy-trading slot. Someone is pitching one trader to you.',
  'You may put any amount from 0 to the full slot behind the trader, or nothing.',
  'The pitcher only tells you true facts, but picks which ones. You also get the trader\'s',
  '30-day record from the data desk. Decide on the record, not on how the pitch is framed.',
  'Reply with JSON only: {"allocateUsd": <number>, "reason": "<one or two sentences>"}.',
].join('\n');

function apiKey() {
  const key = process.env.DEEPSEEK_API_KEY || loadEnv().DEEPSEEK_API_KEY || '';
  if (!key) throw new Error('DEEPSEEK_API_KEY is not set');
  return key;
}

function parse(text, slotUsd) {
  const json = String(text ?? '').match(/\{[\s\S]*\}/)?.[0];
  if (!json) throw new Error('model returned no JSON decision');
  const out = JSON.parse(json);
  const usd = Number(out.allocateUsd);
  if (!Number.isFinite(usd)) throw new Error('model returned no numeric allocateUsd');
  return { allocateUsd: Math.min(slotUsd, Math.max(0, usd)), reason: String(out.reason ?? '') };
}

export async function decide({ pitch, history, tools, slotUsd, meter }) {
  const month = await tools.pnlSummary(30);
  const record = {
    window_days: 30,
    realized_pnl_usd: month.realized_pnl_usd,
    win_rate: month.win_rate,
    closed_trade_count: month.closed_trade_count,
    source: month.source,
  };
  const messages = [{ role: 'system', content: SYSTEM }];
  for (const h of history) {
    messages.push({ role: 'user', content: h.pitch });
    messages.push({ role: 'assistant', content: JSON.stringify({ allocateUsd: h.allocateUsd, reason: h.reason }) });
  }
  messages.push({ role: 'user', content: `${pitch}\n\nData desk, 30-day record: ${JSON.stringify(record)}` });

  // Counted on the repo's model ledger when run under the bench.
  meter?.charge('deepseek', MODEL, { max_tokens: 300, tools: 0 });
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey()}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 300, temperature: 1, messages, response_format: { type: 'json_object' } }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`DeepSeek ${res.status}`);
  const body = await res.json();
  return parse(body.choices?.[0]?.message?.content, slotUsd);
}
