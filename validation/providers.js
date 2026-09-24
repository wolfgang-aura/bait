/**
 * Model providers behind one normalised interface, so the game loop is written once
 * and runs against Claude, DeepSeek, or a scripted stub.
 *
 *   provider.chat({ system, turns, tools }) -> { text, toolCalls, stopReason, usage, raw }
 *
 * Normalised turn shapes (ours, not any vendor's):
 *   { role: 'user',      text }
 *   { role: 'assistant', text, toolCalls: [{ id, name, input }] }
 *   { role: 'tool',      results: [{ id, name, content }] }
 *
 * `provider.kind` is written into every trace. A trace tagged "stub" proves a code
 * path, never a claim about how a model behaves.
 *
 * Hard spend caps are enforced here and persisted to model_ledger.jsonl so they hold
 * across separate process runs, not just within one.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { loadEnv } from './nansen.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODEL_LEDGER = path.join(HERE, 'model_ledger.jsonl');

export const ANTHROPIC_MODEL = 'claude-sonnet-5';
export const DEEPSEEK_MODEL = 'deepseek-chat';
export const MAX_TOKENS = 1024;

/**
 * Hard caps for this spike. Exceeding one is a stop, not a warning.
 * Phase 3 raised these by +30 anthropic and +60 deepseek over the Phase 1/2 caps
 * of 30/40, which were fully spent (28 and 40 respectively).
 *
 * Milestone 1 raised deepseek 180 -> 400. Two desks answer every pitch, so one round
 * of three pitches costs 6 to 18 calls instead of 3 to 9.
 * Milestone 4 raised it 400 -> 650 for the full benchmark sweep: 10 cases x 3 configs
 * x 3 repeats is roughly 350 calls. The user set 650 as the ceiling; a run that would
 * exceed it stops and reports what completed rather than raising it.
 * Anthropic is untouched and is not used by the player flow.
 */
// User approved 800 total calls on 19 September for the paired evaluation and demo checks.
// Raised 20 Sep 2026 for the frozen-evidence strict sweep, founder-authorized.
// DeepSeek 1000 -> 1100 on 21 Sep 2026 for the frozen-evidence armed-basic rerun, founder-authorized.
// DeepSeek 1250 -> 5000 on 22 Sep 2026. The founder's instruction for the Pitch Room
// was "go free on the DeepSeek calls": it is the cheap model, it is the only model the
// player flow uses, and a playtest of one round costs up to twelve calls. Anthropic is
// deliberately untouched, so the expensive vendor still stops at 98.
// Anthropic 98 -> 580 on 25 Sep 2026 for one second-model run (claude-sonnet-5, AI alone
// and behind the gate, 468 calls, about $1.6), founder-authorized.
export const CAPS = { anthropic: 580, deepseek: 5000 };

export class CapExceeded extends Error {
  constructor(vendor, used, cap) {
    super(`BLOCKED-BY-CAP: ${vendor} is at ${used}/${cap} model calls.`);
    this.vendor = vendor;
    this.used = used;
    this.cap = cap;
  }
}

/**
 * Calls that could not be written to the ledger (read-only or ephemeral disk on a
 * host). They still count toward the cap for the life of this process, so a failed
 * write can never turn the cap off.
 */
const unwrittenCalls = { anthropic: 0, deepseek: 0 };
let ledgerWriteWarned = false;

export function modelCallsUsed(vendor = null) {
  const counts = { anthropic: unwrittenCalls.anthropic, deepseek: unwrittenCalls.deepseek };
  if (fs.existsSync(MODEL_LEDGER)) {
    for (const line of fs.readFileSync(MODEL_LEDGER, 'utf8').split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const r = JSON.parse(line);
        if (r.vendor in counts) counts[r.vendor] += 1;
      } catch {
        /* ignore */
      }
    }
  }
  return vendor ? counts[vendor] : counts;
}

function chargeCall(vendor, model, meta) {
  const used = modelCallsUsed(vendor);
  if (used >= CAPS[vendor]) throw new CapExceeded(vendor, used, CAPS[vendor]);
  const record = JSON.stringify({ ts: new Date().toISOString(), vendor, model, ...meta }) + '\n';
  try {
    fs.appendFileSync(MODEL_LEDGER, record, 'utf8');
  } catch (err) {
    unwrittenCalls[vendor] += 1;
    if (!ledgerWriteWarned) {
      ledgerWriteWarned = true;
      console.error(`[model-ledger] cannot write ${MODEL_LEDGER} (${err.code || err.message}); counting model calls in memory for this process.`);
    }
  }
  return used + 1;
}

function apiKey(name) {
  return process.env[name] || loadEnv()[name] || '';
}

// --------------------------------------------------------------- Anthropic

export function anthropicProvider({ model = ANTHROPIC_MODEL, maxTokens = MAX_TOKENS } = {}) {
  const key = apiKey('ANTHROPIC_API_KEY');
  if (!key) {
    const e = new Error('ANTHROPIC_API_KEY missing from .env');
    e.code = 'NO_API_KEY';
    throw e;
  }
  const client = new Anthropic({ apiKey: key });

  const toAnthropic = (turns) =>
    turns.map((t) => {
      if (t.role === 'tool') {
        return {
          role: 'user',
          content: t.results.map((r) => ({
            type: 'tool_result',
            tool_use_id: r.id,
            content: typeof r.content === 'string' ? r.content : JSON.stringify(r.content),
          })),
        };
      }
      if (t.role === 'assistant') {
        const content = [];
        if (t.text) content.push({ type: 'text', text: t.text });
        for (const c of t.toolCalls ?? []) {
          content.push({ type: 'tool_use', id: c.id, name: c.name, input: c.input });
        }
        return { role: 'assistant', content };
      }
      return { role: 'user', content: t.text };
    });

  return {
    kind: 'anthropic',
    vendor: 'anthropic',
    model,
    async chat({ system, turns, tools }) {
      chargeCall('anthropic', model, { max_tokens: maxTokens, tools: (tools ?? []).length });
      const res = await client.messages.create({
        model,
        max_tokens: maxTokens,
        system,
        messages: toAnthropic(turns),
        ...(tools?.length
          ? {
              tools: tools.map((t) => ({
                name: t.name,
                description: t.description,
                input_schema: t.input_schema,
              })),
              tool_choice: { type: 'auto' },
            }
          : {}),
        // Keep reasoning short so a decision fits inside a 1024-token cap.
        output_config: { effort: 'low' },
      });
      return {
        text: res.content
          .filter((b) => b.type === 'text')
          .map((b) => b.text)
          .join(''),
        toolCalls: res.content
          .filter((b) => b.type === 'tool_use')
          .map((b) => ({ id: b.id, name: b.name, input: b.input })),
        stopReason: res.stop_reason,
        usage: res.usage,
        raw: res,
      };
    },
  };
}

// ---------------------------------------------------------------- DeepSeek

export function deepseekProvider({ model = DEEPSEEK_MODEL, maxTokens = MAX_TOKENS, timeoutMs = 90_000 } = {}) {
  const key = apiKey('DEEPSEEK_API_KEY');
  if (!key) {
    const e = new Error('DEEPSEEK_API_KEY missing from .env');
    e.code = 'NO_API_KEY';
    throw e;
  }

  const toOpenAI = (system, turns) => {
    const out = [{ role: 'system', content: system }];
    for (const t of turns) {
      if (t.role === 'tool') {
        for (const r of t.results) {
          out.push({
            role: 'tool',
            tool_call_id: r.id,
            content: typeof r.content === 'string' ? r.content : JSON.stringify(r.content),
          });
        }
      } else if (t.role === 'assistant') {
        out.push({
          role: 'assistant',
          content: t.text || null,
          ...(t.toolCalls?.length
            ? {
                tool_calls: t.toolCalls.map((c) => ({
                  id: c.id,
                  type: 'function',
                  function: { name: c.name, arguments: JSON.stringify(c.input) },
                })),
              }
            : {}),
        });
      } else {
        out.push({ role: 'user', content: t.text });
      }
    }
    return out;
  };

  return {
    kind: 'deepseek',
    vendor: 'deepseek',
    model,
    async chat({ system, turns, tools }) {
      chargeCall('deepseek', model, { max_tokens: maxTokens, tools: (tools ?? []).length });
      const res = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          messages: toOpenAI(system, turns),
          ...(tools?.length
            ? {
                tools: tools.map((t) => ({
                  type: 'function',
                  function: {
                    name: t.name,
                    description: t.description,
                    parameters: t.input_schema,
                  },
                })),
                tool_choice: 'auto',
              }
            : {}),
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        throw new Error(`DeepSeek ${res.status}: ${(await res.text()).slice(0, 400)}`);
      }
      const json = await res.json();
      const msg = json.choices?.[0]?.message ?? {};
      return {
        text: msg.content ?? '',
        toolCalls: (msg.tool_calls ?? []).map((c) => ({
          id: c.id,
          name: c.function.name,
          input: safeParse(c.function.arguments),
        })),
        stopReason: json.choices?.[0]?.finish_reason ?? null,
        usage: json.usage,
        raw: json,
      };
    },
  };
}

function safeParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

// -------------------------------------------------------------------- Stub

/**
 * Scripted provider for tests. Each script entry is { text } and/or
 * { toolCalls: [{ name, input }] }. Costs nothing and touches no ledger.
 */
export function stubProvider(script, { model = 'stub-model' } = {}) {
  let i = 0;
  const seen = [];
  return {
    kind: 'stub',
    vendor: 'stub',
    model,
    get calls() {
      return i;
    },
    get seen() {
      return seen;
    },
    async chat(params) {
      seen.push(params);
      const step = script[i++];
      if (!step) throw new Error(`stubProvider ran out of script at call ${i}`);
      return {
        text: step.text ?? '',
        toolCalls: (step.toolCalls ?? []).map((c, n) => ({
          id: `stub_tool_${i}_${n}`,
          name: c.name,
          input: c.input,
        })),
        stopReason: step.toolCalls?.length ? 'tool_use' : 'end_turn',
        usage: { input_tokens: 0, output_tokens: 0 },
        raw: { stub: true, step },
      };
    },
  };
}

export function providerByName(name) {
  if (name === 'anthropic' || name === ANTHROPIC_MODEL) return anthropicProvider();
  if (name === 'deepseek' || name === DEEPSEEK_MODEL) return deepseekProvider();
  throw new Error(`unknown provider "${name}"`);
}

export const MODEL_LEDGER_FILE = MODEL_LEDGER;
