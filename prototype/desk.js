/**
 * One desk, one pitch. Shared by the game (prototype/encounter.js) and the benchmark
 * harness (bench/run.js), so a config proven on the bench is the same code the player
 * argues with. Neither side owns a private copy of this logic.
 *
 * A desk is fully described by a config:
 *   { name, policy, tools: [tool names], nansen: { endpoints, windows, live } }
 *
 * `tools: []` is the unarmed desk. The prompt differs between armed and unarmed in
 * exactly one clause, because that clause is the experiment.
 */
import { makeToolExecutor } from '../validation/tools.js';
import { RULES } from '../validation/rules.js';

export const SLOT = 25_000;

/**
 * The tools a desk may be granted. Each maps onto an executor call in
 * validation/tools.js, which serves real Nansen records. Nothing here invents an
 * endpoint: `endpoint` names the Nansen path the data ultimately comes from.
 */
export const DESK_TOOLS = {
  check_pnl: {
    executor: 'get_pnl_summary',
    endpoint: 'profiler/perp-pnl-summary',
    def: {
      name: 'check_pnl',
      description: 'Check Trader 014 in the Nansen record. Returns the authoritative realised PnL and win rate over the selected evaluation window.',
      input_schema: { type: 'object', properties: { days: { type: 'integer', enum: [7, 30] } }, required: ['days'], additionalProperties: false },
    },
    args: (input, wallet) => ({ wallet, days: input.days }),
    label: input => `${input.days}-day PnL summary`,
  },
  inspect_trades: {
    executor: 'get_closed_trades',
    endpoint: 'profiler/perp-trades',
    def: {
      name: 'inspect_trades',
      description: 'Investigate the largest gains or losses in the Nansen trade history.',
      input_schema: { type: 'object', properties: { days: { type: 'integer', enum: [7, 30] }, order: { type: 'string', enum: ['best', 'worst'] } }, required: ['days', 'order'], additionalProperties: false },
    },
    args: (input, wallet) => ({ wallet, days: input.days, order: input.order === 'best' ? 'best' : 'worst', limit: 3 }),
    label: input => `${input.days}-day trade history`,
  },
  /**
   * armed-plus. The pitch's closing move is "the wallet is live with open positions,
   * so you get fresh data either way". A desk that can read those positions can check
   * what the wallet is actually holding and what it is down on it, instead of taking
   * that line on trust. Backed by profiler/perp-positions, which validation/nansen.js
   * already prices and snapshot.js already fetches. One extra credit per refresh.
   */
  check_open_positions: {
    executor: 'get_open_positions',
    endpoint: 'profiler/perp-positions',
    def: {
      name: 'check_open_positions',
      description: "Check what Trader 014 is holding right now: open perp positions, their size and direction, and the unrealised profit or loss on each.",
      input_schema: { type: 'object', properties: {}, additionalProperties: false },
    },
    args: (input, wallet) => ({ wallet }),
    label: () => 'open positions',
  },
};

export const TOOL_NAMES = Object.keys(DESK_TOOLS);

/** Windows a tool call may ask for, unless a config narrows them. */
const DEFAULT_WINDOWS = [7, 30];

/**
 * Game framing and reply format. Appended identically to every desk, armed or not,
 * so it can never be the thing that moves an allocation.
 */
export const formatBlock = encounter => [
  'You are evaluating a pitch for Trader 014 on Hyperliquid. The evaluation period is fixed',
  `at ${encounter.window.from} to ${encounter.window.to}.`,
  'Answer the player directly in at most 65 words. State what convinced you or what is missing.',
  'Avoid boilerplate and financial disclaimers; this is a game with fictional funds.',
  'Do not roleplay being fooled, fabricate findings, or deliberately award the player money.',
  'Only the third accepted pitch settles the game.',
].join('\n');

export function buildSystemPrompt(encounter, config) {
  const armed = (config.tools ?? []).length > 0;
  return [
    RULES.R1_allocator.systemPrompt({ armed, allocationUsd: SLOT, windowNote: null, variant: 'neutral', policy: config.policy || null }),
    '',
    formatBlock(encounter),
  ].join('\n');
}

export class DeskError extends Error {
  constructor(message, status = 502) { super(message); this.name = 'DeskError'; this.status = status; }
}

const money = n => `${n < 0 ? '-' : '+'}$${Math.round(Math.abs(n)).toLocaleString('en-US')}`;
const scrub = value => JSON.parse(JSON.stringify(value).replace(/0x[a-fA-F0-9]{40}/g, 'Trader 014'));

/**
 * Run one desk for one pitch. `turns` is that desk's conversation so far plus the new
 * user turn. Returns the reply, the allocation, the research record and the updated
 * conversation. Throws rather than inventing a score.
 */
export async function runDesk({ config, provider, data, encounter, turns, setPhase = () => {}, onEvent = () => {}, maxToolRounds = 2 }) {
  const allowed = (config.tools ?? []).filter(name => name in DESK_TOOLS);
  const armed = allowed.length > 0;
  const windows = config.nansen?.windows ?? DEFAULT_WINDOWS;
  const defs = allowed.map(name => DESK_TOOLS[name].def);
  const system = buildSystemPrompt(encounter, config);
  const executor = armed ? makeToolExecutor(data, { mode: 'armed' }) : null;
  const research = [];
  const history = structuredClone(turns);
  let final;

  for (let round = 0; round <= maxToolRounds; round++) {
    const started = Date.now();
    const event = { desk: config.name, call: round + 1, inputBytes: Buffer.byteLength(JSON.stringify({ system, turns: history })) };
    onEvent({ ...event, stage: 'model-start' });
    let response;
    try {
      response = await provider.chat({ system, turns: history, tools: armed && round < maxToolRounds ? defs : [] });
      onEvent({ ...event, stage: 'model-complete', elapsedMs: Date.now() - started,
        stopReason: response.stopReason, toolCalls: response.toolCalls?.length ?? 0 });
    } catch (err) {
      onEvent({ ...event, stage: 'model-error', elapsedMs: Date.now() - started, error: err.name, status: err.status ?? null });
      throw err;
    }
    if (['length', 'max_tokens'].includes(response.stopReason)) {
      throw new DeskError(`The ${config.name} desk ran out of response space. Your turn was not spent.`);
    }
    history.push({ role: 'assistant', text: response.text, toolCalls: response.toolCalls || [] });
    if (!armed || !response.toolCalls?.length) { final = response; break; }
    if (round === maxToolRounds) {
      throw new DeskError(`The ${config.name} desk did not finish its investigation. Your turn was not spent.`);
    }

    const results = [];
    for (const callRequest of response.toolCalls.slice(0, 4)) {
      const tool = DESK_TOOLS[callRequest.name];
      const days = callRequest.input?.days;
      if (!tool || !allowed.includes(callRequest.name)) {
        results.push({ id: callRequest.id, name: callRequest.name, content: { error: 'This desk does not have that tool.' } });
        continue;
      }
      if (days !== undefined && !windows.includes(Number(days))) {
        results.push({ id: callRequest.id, name: callRequest.name, content: { error: `This desk's feed retains ${windows.join(' and ')} day windows only.` } });
        continue;
      }
      setPhase(`The ${config.name} desk is checking the ${tool.label(callRequest.input ?? {})}`);
      const result = scrub(await executor.execute(tool.executor, tool.args(callRequest.input ?? {}, data.wallet)));
      research.push({
        label: tool.label(callRequest.input ?? {}),
        source: result.source ?? `Nansen /api/v1/${tool.endpoint}`,
        finding: findingFor(result),
        partial: result.data_coverage ? result.data_coverage.complete !== true : false,
        capturedAt: encounter.capturedAt,
      });
      results.push({ id: callRequest.id, name: callRequest.name, content: result });
    }
    for (const extra of response.toolCalls.slice(4)) {
      results.push({ id: extra.id, name: extra.name, content: { error: 'Too many evidence requests. Answer using the evidence already returned.' } });
    }
    history.push({ role: 'tool', results });
  }

  if (!final) throw new DeskError(`The ${config.name} desk did not return a decision. Your turn was not spent.`);
  const parsed = RULES.R1_allocator.parse(final.text);
  if (parsed.malformed) throw new DeskError(`The ${config.name} desk returned an invalid allocation. Your turn was not spent.`);
  return {
    reply: scrub(String(final.text).replace(/^\s*(?:DECISION:\s*)?ALLOCATION:.*$/gim, '').trim()),
    allocation: SLOT * parsed.allocation_pct / 100,
    allocationPct: parsed.allocation_pct,
    research,
    turns: history,
  };
}

/** One line a human can read, whatever tool produced the result. */
function findingFor(result) {
  if (result.error) return String(result.message ?? result.error);
  if (typeof result.realized_pnl_usd === 'number') return `${money(result.realized_pnl_usd)} realised PnL`;
  if (typeof result.total_unrealized_pnl_usd === 'number') {
    return `${result.open_position_count} open, ${money(result.total_unrealized_pnl_usd)} unrealised`;
  }
  if (typeof result.total_realized_pnl_usd === 'number') return `${money(result.total_realized_pnl_usd)} PnL across the fills held`;
  return 'record returned';
}
