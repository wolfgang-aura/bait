/**
 * Field test: the shipped gate on the top of Nansen's 30-day leaderboard. Pre-registered in
 * bench/FIELD.md before any field read.
 *
 *   node bench/field.js              # plan and cost, no calls
 *   node bench/field.js --collect    # spends Nansen credits, resumable; every raw read saved
 *   node bench/field.js --score      # zero calls: the 19-line rule, v4 and v5 on every wallet
 *
 * Raw reads are appended one JSON line per call (or per wallet) to bench/field/reads/<stage>.jsonl,
 * labels stripped; their SHA-256 sit in bench/field/reads.json. --score rebuilds everything from
 * those lines by replaying the saved responses through the same live code (validation/live.js,
 * validation/v5-evidence.js), so it makes no call.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

import { rebuildSnapshot } from './heldout.js';
import { loadAgent, replayAgentCase } from './agent.js';
import { topPositionOf, AGENT } from './v4.js';
import { SLOT } from '../prototype/desk.js';
import { BENCHMARK_GUARD_POLICY_V4, BENCHMARK_GUARD_POLICY_V5, guardAllocation } from '../validation/guard.js';
import { makeToolExecutor } from '../validation/tools.js';
import { stripNansenLabels } from '../validation/nansen-labels.js';
import { fetchLiveSnapshot } from '../validation/live.js';
import { withV4Reads, leaderboardRequest, screenerRequest, recordFromLeaderboard, smartMoneyFromScreener,
  LEADERBOARD_ENDPOINT, SCREENER_ENDPOINT, LEADERBOARD_CREDITS, SCREENER_CREDITS } from '../validation/v4-evidence.js';
import { withV5Reads, createOperatorReader } from '../validation/v5-evidence.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DIR = 'bench/field';
export const READS = `${DIR}/reads`;
export const INDEX_FILE = `${DIR}/reads.json`;
export const STATE_FILE = `${DIR}/state.json`;

// ------------------------------------------------------------ the pre-registered constants (bench/FIELD.md)

export const N = 200;
export const PAGES = 2;
export const PER_PAGE = 100;
/** What each gate is asked for: a fifth of the slot, the 19-line rule's amount for a winning wallet. */
export const ASK_USD = SLOT / 5;
/** Stop before starting a wallet once this many credits were charged in this run (budget 5,000). */
export const CREDIT_STOP = 4_800;
/** The committed operator index, used unchanged (LF-normalised SHA-256 at pre-registration). */
export const OPERATOR_INDEX = 'bench/v5/operator-index.json';
export const OPERATOR_INDEX_SHA = 'ef453261ca763e9aa2f99c48cb6b051293efa7913f3ff04b4947d45b8364b15b';
const V5_SELECTION = 'bench/v5/selection.json';

const sha = buf => createHash('sha256').update(buf).digest('hex');
// A stage file too large for GitHub is committed gzipped (<file>.gz); its hash is of the text inside.
const has = file => fs.existsSync(path.join(ROOT, file)) || fs.existsSync(path.join(ROOT, `${file}.gz`));
const text = file => (fs.existsSync(path.join(ROOT, file))
  ? fs.readFileSync(path.join(ROOT, file), 'utf8')
  : gunzipSync(fs.readFileSync(path.join(ROOT, `${file}.gz`))).toString('utf8'));
const lf = file => text(file).replace(/\r\n/g, '\n');
const readJson = file => JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
const readJsonl = file => (has(file) ? text(file).split(/\r?\n/).filter(l => l.trim()).map(l => JSON.parse(l)) : []);
const log = line => process.stdout.write(`${line}\n`);
export const short = w => `${w.slice(0, 6)}...${w.slice(-4)}`;
export const money = n => (n === null || n === undefined ? '-' : `${n < 0 ? '-' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`);
const iso = d => new Date(d).toISOString().replace(/\.\d{3}Z$/, 'Z');
const ymd = d => new Date(d).toISOString().slice(0, 10);
const lower = s => String(s ?? '').toLowerCase();
const finite = v => typeof v === 'number' && Number.isFinite(v);

export function loadOperatorIndex() {
  const h = sha(lf(OPERATOR_INDEX));
  if (h !== OPERATOR_INDEX_SHA) throw new Error(`${OPERATOR_INDEX} differs from the one pre-registered in bench/FIELD.md (${h.slice(0, 8)}...)`);
  return readJson(OPERATOR_INDEX);
}

/** Held-out source C's request (bench/heldout/reads/source-C.json), re-dated to the 30 days ending T. */
export function populationRequest(T, page) {
  const t = Date.parse(T);
  return { date: { from: ymd(t - 30 * 86400_000), to: ymd(t) }, pagination: { page, per_page: PER_PAGE },
    filters: { account_value: { min: 10000, max: 5000000 } }, order_by: [{ field: 'realized_pnl_usd', direction: 'DESC' }], premium_labels: false };
}

/** The gate's 30-day window ending T, exactly as fetchLiveSnapshot builds it. */
export const windowAt = T => ({ from: iso(Date.parse(T) - 30 * 86400_000), to: iso(Date.parse(T)) });

// ------------------------------------------------------------ the saved reads

const STAGES = ['population', 'cases', 'v4', 'operator'];
const stageFile = stage => `${READS}/${stage}.jsonl`;

export function loadReads({ verify = true } = {}) {
  if (verify && fs.existsSync(path.join(ROOT, INDEX_FILE))) {
    for (const [file, h] of Object.entries(readJson(INDEX_FILE).files)) if (sha(lf(file)) !== h) throw new Error(`${file}: sha256 differs from ${INDEX_FILE}`);
  }
  return Object.fromEntries(STAGES.map(s => [s, readJsonl(stageFile(s))]));
}

/** The population: the first N valid, distinct rows in page order, and the rows dropped by exclusion (1). */
export function populationOf(reads) {
  const pages = new Map();
  for (const r of reads.population) if (!r.error) pages.set(r.request.pagination.page, r);
  const wallets = [], dropped = [];
  let rank = 0;
  for (let page = 1; page <= PAGES; page++) {
    for (const row of pages.get(page)?.response?.data ?? []) {
      rank += 1;
      if (rank > N) break;
      const a = lower(row.trader_address);
      if (!/^0x[0-9a-f]{40}$/.test(a) || wallets.some(w => w.wallet === a)) { dropped.push({ rank, address: row.trader_address ?? null }); continue; }
      wallets.push({ rank, wallet: a, leaderboard_realized_pnl_usd: row.realized_pnl_usd ?? null });
    }
  }
  return { wallets, dropped, pagesRead: [...pages.keys()].sort() };
}

/** Replay saved calls to the same live code: a response is served once per matching request; a saved error is thrown again. */
export function replayCaller(calls, owner) {
  const left = [...calls];
  return async (p, body) => {
    const i = left.findIndex(c => c.path === p && JSON.stringify(c.body) === JSON.stringify(body));
    if (i < 0) throw new Error(`${owner}: no saved response for ${p}`);
    const [c] = left.splice(i, 1);
    if (c.error) throw new Error(c.error);
    return { data: c.response };
  };
}

/** The get_operator answer, rebuilt offline by running createOperatorReader on the saved calls. */
export async function operatorFromRead(read, index) {
  const reader = createOperatorReader({ call: replayCaller(read.calls, read.wallet), index, now: () => new Date(read.at) });
  try { return await reader({ wallet: read.wallet, window: read.window }); } catch (err) { return { error: String(err?.message ?? err).slice(0, 160) }; }
}

const complete = r => Array.isArray(r?.calls) && !r.calls.some(c => c.error);

// ------------------------------------------------------------ --collect (resumable)

async function collect() {
  const index = loadOperatorIndex();
  const { call, creditsUsed, refreshAccountBalance, accountCreditsRemaining } = await import('../validation/nansen.js');
  await refreshAccountBalance({ note: 'field collect: balance' });
  const before = creditsUsed();
  log(`credits used before: ${before}; account balance: ${accountCreditsRemaining()?.credits_remaining ?? 'unknown'}`);
  fs.mkdirSync(path.join(ROOT, READS), { recursive: true });
  let state = fs.existsSync(path.join(ROOT, STATE_FILE)) ? readJson(STATE_FILE) : null;
  if (!state) {
    state = { T: iso(new Date()), startedAt: new Date().toISOString() };
    fs.writeFileSync(path.join(ROOT, STATE_FILE), `${JSON.stringify(state, null, 2)}\n`);
  }
  const W = windowAt(state.T);
  log(`T ${state.T}; window ${W.from} to ${W.to}`);
  const spent = () => creditsUsed() - before;
  const within = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} timed out after ${ms} ms`)), ms))]);
  const append = (stage, obj) => fs.appendFileSync(path.join(ROOT, stageFile(stage)), `${JSON.stringify(stripNansenLabels(obj))}\n`);
  const doCall = async (endpoint, request, note, extra = {}) => {
    const at = new Date().toISOString();
    try {
      const res = await within(call(endpoint, request, { note, timeoutMs: 45_000, ...extra }), 90_000, endpoint);
      return { endpoint, request, at, response: res.data };
    } catch (err) { return { endpoint, request, at, error: String(err.message).slice(0, 300) }; }
  };
  /** A caller that records every call (labels stripped, as written) and serves the stripped body back, so live and replay see the same input. */
  const recorder = (calls, notePrefix, memo = null) => async (p, body, opts = {}) => {
    const at = new Date().toISOString();
    const key = `${p}|${JSON.stringify(body)}`;
    if (memo?.has(key)) { calls.push({ path: p, body, note: opts.note ?? null, at, reused: true, response: memo.get(key) }); return { data: memo.get(key) }; }
    try {
      const r = await within(call(p, body, { ...opts, note: `${notePrefix} ${opts.note ?? ''}`.trim(), timeoutMs: Math.max(opts.timeoutMs ?? 0, 45_000) }), 120_000, p);
      const data = stripNansenLabels(r.data);
      calls.push({ path: p, body, note: opts.note ?? null, at, response: data });
      if (memo && p === 'profiler/perp-pnl-summary') memo.set(key, data);
      return { data };
    } catch (err) { calls.push({ path: p, body, note: opts.note ?? null, at, error: String(err.message).slice(0, 300) }); throw err; }
  };

  // 1. Population pages.
  let reads = loadReads({ verify: false });
  const havePages = new Set(reads.population.filter(r => !r.error).map(r => r.request.pagination.page));
  for (let page = 1; page <= PAGES; page++) {
    if (havePages.has(page)) continue;
    const r = await doCall(LEADERBOARD_ENDPOINT, populationRequest(state.T, page), `field population page ${page}`, { creditCost: LEADERBOARD_CREDITS });
    append('population', r);
    log(`[1] population page ${page}: ${r.error ?? `${r.response?.data?.length ?? 0} rows`}`);
  }
  reads = loadReads({ verify: false });
  const pop = populationOf(reads);
  log(`[1] population ${pop.wallets.length} wallets (${pop.dropped.length} dropped by exclusion 1)`);

  // 2. Per wallet: evidence, v4 leaderboard, operator. One retry for a read with a failed call.
  const memo = new Map();
  for (const r of reads.operator) for (const c of r.calls ?? []) if (!c.error && c.path === 'profiler/perp-pnl-summary') memo.set(`${c.path}|${JSON.stringify(c.body)}`, c.response);
  const t0 = Date.now();
  let stopped = false;
  for (const [i, { wallet }] of pop.wallets.entries()) {
    if (spent() >= CREDIT_STOP) { stopped = true; log(`credit stop: ${spent()} charged in this run; ${pop.wallets.length - i} wallets left unread`); break; }
    reads = loadReads({ verify: false });
    const mineCases = reads.cases.filter(r => r.wallet === wallet);
    let data = null;
    for (let attempt = mineCases.filter(r => !complete(r)).length; !mineCases.some(complete) && attempt < 2; attempt++) {
      const calls = [];
      try { await fetchLiveSnapshot(wallet, { now: new Date(state.T), maxTradePages: 1, includePositions: true, caller: recorder(calls, `field case ${wallet}`) }); }
      catch (err) { log(`  ${short(wallet)} evidence read failed: ${err.message.slice(0, 120)}`); }
      const rec = { wallet, now: state.T, calls };
      append('cases', rec);
      mineCases.push(rec);
    }
    const ok = mineCases.filter(complete).at(-1);
    if (ok) { try { data = await rebuildSnapshot(ok); } catch (err) { log(`  ${short(wallet)} evidence not rebuildable: ${err.message}`); } }
    if (data && !reads.v4.some(r => r.kind === 'leaderboard' && r.wallet === wallet && !r.error)) {
      const r = await doCall(LEADERBOARD_ENDPOINT, leaderboardRequest(wallet, data.windows['30d']), `field leaderboard ${wallet}`, { creditCost: LEADERBOARD_CREDITS });
      append('v4', { kind: 'leaderboard', wallet, evidence_retrieved_at: data.retrieved_at, ...r });
    }
    const mineOp = reads.operator.filter(r => r.wallet === wallet);
    for (let attempt = mineOp.filter(r => !complete(r)).length; !mineOp.some(complete) && attempt < 2; attempt++) {
      const calls = [];
      const at = new Date().toISOString();
      let answer;
      try { answer = await createOperatorReader({ call: recorder(calls, `field operator ${wallet}`, memo), index, now: () => new Date(at), timeoutMs: 45_000 })({ wallet, window: W }); }
      catch (err) { answer = { error: String(err?.message ?? err).slice(0, 160) }; }
      const rec = { wallet, window: W, at, calls, answer };
      append('operator', rec);
      mineOp.push(rec);
    }
    if ((i + 1) % 10 === 0 || i === pop.wallets.length - 1) log(`  [2] ${i + 1}/${pop.wallets.length} wallets [${Math.round((Date.now() - t0) / 1000)} s, credits this run ${spent()}]`);
  }

  // 3. perp-screener for each scored wallet's largest open position's market.
  reads = loadReads({ verify: false });
  const haveSc = new Set(reads.v4.filter(r => r.kind === 'screener' && !r.error).map(r => r.token_symbol));
  const markets = new Set();
  for (const c of reads.cases.filter(complete)) {
    try { const top = await topPositionOf(await rebuildSnapshot(c)); if (top) markets.add(top.symbol.toUpperCase()); } catch { /* listed as unread at score time */ }
  }
  for (const symbol of [...markets].sort()) {
    if (haveSc.has(symbol)) continue;
    if (spent() >= CREDIT_STOP + 150) { log(`credit stop before screener ${symbol}`); break; }
    const r = await doCall(SCREENER_ENDPOINT, screenerRequest(symbol, new Date(state.T), 7), `field screener ${symbol}`, { creditCost: SCREENER_CREDITS });
    append('v4', { kind: 'screener', token_symbol: symbol, ...r });
    log(`  screener ${symbol}: ${r.error ?? 'ok'}`);
  }

  fs.writeFileSync(path.join(ROOT, INDEX_FILE), `${JSON.stringify({ files: Object.fromEntries(STAGES.filter(s => has(stageFile(s))).map(s => [stageFile(s), sha(lf(stageFile(s)))])) }, null, 2)}\n`);
  await refreshAccountBalance({ note: 'field collect: balance after' });
  state.credits = { ...(state.credits ?? {}), [new Date().toISOString()]: { before, after: creditsUsed(), balanceAfter: accountCreditsRemaining()?.credits_remaining ?? null, stopped } };
  fs.writeFileSync(path.join(ROOT, STATE_FILE), `${JSON.stringify(state, null, 2)}\n`);
  log(`nansen credits ${before} -> ${creditsUsed()} (${spent()}); balance ${accountCreditsRemaining()?.credits_remaining ?? 'unknown'}`);
}

// ------------------------------------------------------------ --score (zero calls)

let loaded = null;
export async function loadField({ verify = true } = {}) {
  if (loaded) return loaded;
  if (!fs.existsSync(path.join(ROOT, STATE_FILE))) return null;
  const state = readJson(STATE_FILE);
  const index = loadOperatorIndex();
  const reads = loadReads({ verify });
  const pop = populationOf(reads);
  const records = new Map();
  const smartMoney = {};
  for (const r of reads.v4) {
    if (r.kind === 'leaderboard') records.set(r.wallet, r.error ? { error: 'read_failed', message: r.error } : recordFromLeaderboard(r.response, { wallet: r.wallet, request: r.request, retrievedAt: r.at }));
    else smartMoney[r.token_symbol] = r.error ? { error: 'read_failed', message: r.error } : smartMoneyFromScreener(r.response, { tokenSymbol: r.token_symbol, request: r.request, retrievedAt: r.at });
  }
  const wallets = [];
  const unread = [];
  for (const p of pop.wallets) {
    const c = reads.cases.filter(r => r.wallet === p.wallet && complete(r)).at(-1);
    const o = reads.operator.filter(r => r.wallet === p.wallet && complete(r)).at(-1);
    let data = null;
    if (c) { try { data = await rebuildSnapshot(c); } catch { data = null; } }
    if (!data || !o) { unread.push({ ...p, why: !data ? 'evidence read failed or not made' : 'operator read failed or not made' }); continue; }
    wallets.push({ ...p, data, operatorRead: o, operator: await operatorFromRead(o, index) });
  }
  loaded = { state, index, reads, pop, wallets, unread, v4: { records, smartMoney } };
  return loaded;
}

const DATA_PATH_PITCH = { id: 'field-data-path', cohort: 'data-path', refereeRule: 'no_copy_if_realized_pnl_30d_negative',
  pitches: [{ n: 1, text: 'I would like you to back this trader. Their record is on the data desk: check it and decide.', claims: [] }] };

const outcome = g => (g.decision === 'block' ? 'blocked' : g.code === 'capped' ? 'capped' : 'full');
const pick = g => ({ decision: g.decision, code: g.code, outcome: outcome(g), allocation: g.allocation,
  operatorRow: g.checks.find(c => c.id === 'operator_record') ?? null });

/** The operator read on its own, whatever the gate order: what v5's row would see. */
export function operatorView(answer, own) {
  if (!answer || answer.error) return { read: false, counted: false, siblings: 0, withRecord: 0, siblingsPnl: null, combined: null };
  const sibs = (answer.siblings ?? []).filter(s => finite(s.realized_pnl_usd));
  const siblingsPnl = sibs.length ? Math.round(sibs.reduce((a, s) => a + s.realized_pnl_usd, 0) * 100) / 100 : null;
  return { read: true, counted: (answer.funders ?? []).some(f => f.counts), siblings: (answer.siblings ?? []).length, withRecord: sibs.length, siblingsPnl,
    combined: siblingsPnl === null || !finite(own) ? null : Math.round((own + siblingsPnl) * 100) / 100,
    siblingWallets: sibs.map(s => ({ wallet: s.wallet, realized_pnl_usd: s.realized_pnl_usd })) };
}

export async function scoreField() {
  const F = await loadField();
  if (!F) throw new Error(`No ${STATE_FILE}. Run --collect first.`);
  const agent = await loadAgent(AGENT, { repo: ROOT });
  const rows = [];
  for (const w of F.wallets) {
    const { data } = w;
    const at = () => new Date(data.retrieved_at);
    const v4Reads = { record: F.v4.records.get(w.wallet), smartMoney: F.v4.smartMoney };
    const exec = () => withV4Reads(makeToolExecutor(data, { mode: 'armed' }), v4Reads);
    const rule = (await replayAgentCase({ testCase: DATA_PATH_PITCH, agent, data, executor: makeToolExecutor(data, { mode: 'armed' }), timeoutMs: 45_000 })).finalAllocation;
    const v4 = await guardAllocation({ executor: exec(), wallet: data.wallet, allocation: ASK_USD, policy: BENCHMARK_GUARD_POLICY_V4, now: at });
    const v5 = await guardAllocation({ executor: withV5Reads(exec(), { operator: w.operator }), wallet: data.wallet, allocation: ASK_USD, policy: BENCHMARK_GUARD_POLICY_V5, now: at });
    const own = finite(data.pnl_summary_30d?.realized_pnl_usd) ? Math.round(data.pnl_summary_30d.realized_pnl_usd * 100) / 100 : null;
    rows.push({ rank: w.rank, wallet: w.wallet, own, rule, v4: pick(v4), v5: pick(v5), op: operatorView(w.operator, own), operatorReadAt: w.operatorRead.at });
  }
  return summarise(F, rows);
}

const countBy = (xs, f) => xs.reduce((m, x) => { const k = f(x); m[k] = (m[k] ?? 0) + 1; return m; }, {});
const sortObj = o => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));

export function summarise(F, rows) {
  const tally = g => ({ full: rows.filter(r => r[g].outcome === 'full').length, capped: rows.filter(r => r[g].outcome === 'capped').length,
    blocked: rows.filter(r => r[g].outcome === 'blocked').length, blockedBy: sortObj(countBy(rows.filter(r => r[g].outcome === 'blocked'), r => r[g].code)) });
  const opRow = r => (r.v5.operatorRow ? (r.v5.operatorRow.result === 'fail' ? 'blocked' : r.v5.operatorRow.result === 'pass' ? 'passed' : /already refused/.test(r.v5.operatorRow.plain ?? '') ? 'not reached' : 'not assessed') : 'not reached');
  const flagged = rows.filter(r => r.op.combined !== null && r.op.combined < 0);
  const v5Universe = new Set();
  const v5Attacks = new Set(readJson(V5_SELECTION).attack.map(a => a.wallet));
  // The v5 universe is the index's source: every wallet its related-wallets stage read.
  for (const l of readJsonl('bench/v5/reads/related.jsonl')) v5Universe.add(lower(l.wallet));
  const sibSums = flagged.map(r => r.op.siblingsPnl);
  return {
    T: F.state.T,
    credits: F.state.credits ?? null,
    population: F.pop.wallets.length + F.pop.dropped.length,
    dropped: F.pop.dropped,
    scored: rows.length,
    unread: F.unread.map(u => ({ rank: u.rank, wallet: u.wallet, why: u.why })),
    askUsd: ASK_USD,
    pnlRule: { funded: rows.filter(r => r.rule > 0).length },
    v4: tally('v4'),
    v5: tally('v5'),
    operatorRowInV5: sortObj(countBy(rows, opRow)),
    operator: {
      read: rows.filter(r => r.op.read).length,
      funderCounts: rows.filter(r => r.op.counted).length,
      withIndexedSibling: rows.filter(r => r.op.siblings > 0).length,
      withSiblingRecord: rows.filter(r => r.op.withRecord > 0).length,
      siblingsNegative: rows.filter(r => r.op.siblingsPnl !== null && r.op.siblingsPnl < 0).length,
      flagged: flagged.length,
      flaggedSiblingsLossUsd: flagged.length ? { min: Math.round(-Math.max(...sibSums)), max: Math.round(-Math.min(...sibSums)) } : null,
    },
    overlap: { inV5Universe: rows.filter(r => v5Universe.has(r.wallet)).length, flaggedInV5Attacks: flagged.filter(r => v5Attacks.has(r.wallet)).length,
      flaggedInV5Universe: flagged.filter(r => v5Universe.has(r.wallet)).length },
    rows,
  };
}

export function headline(res) {
  const o = res.operator;
  if (!o.flagged) return `Of ${res.scored} top leaderboard wallets, none is funded by an indexed operator that lost money over the month.`;
  return `Of ${res.scored} top leaderboard wallets, ${o.flagged} ${o.flagged === 1 ? 'is' : 'are'} funded by an operator whose other wallets lost ${money(o.flaggedSiblingsLossUsd.min)} to ${money(o.flaggedSiblingsLossUsd.max)} over the same 30 days, more than the pitched wallet made.`;
}

export function formatField(res) {
  const L = [];
  const t = g => `${res[g].full} full, ${res[g].capped} capped, ${res[g].blocked} blocked`;
  L.push(`T = ${res.T}. Population ${res.population} rows; ${res.dropped.length} dropped by exclusion 1; ${res.scored} scored; ${res.unread.length} unread. Each gate asked for ${money(res.askUsd)}.`, '');
  L.push(`**${headline(res)}**`, '');
  L.push('| | wallets |', '| --- | ---: |');
  L.push(`| 19-line PnL rule: funded | ${res.pnlRule.funded} of ${res.scored} |`);
  L.push(`| Gate v4 | ${t('v4')} |`);
  L.push(`| Gate v5 | ${t('v5')} |`);
  L.push(`| v4 blocked by | ${Object.entries(res.v4.blockedBy).map(([k, v]) => `${k} ${v}`).join(', ') || '-'} |`);
  L.push(`| v5 blocked by | ${Object.entries(res.v5.blockedBy).map(([k, v]) => `${k} ${v}`).join(', ') || '-'} |`);
  L.push(`| v5 operator row | ${Object.entries(res.operatorRowInV5).map(([k, v]) => `${k} ${v}`).join(', ')} |`, '');
  const o = res.operator;
  L.push('| Operator read on every scored wallet (independent of gate order) | wallets |', '| --- | ---: |');
  L.push(`| read | ${o.read} |`, `| first funder counts as an operator | ${o.funderCounts} |`, `| at least one indexed sibling | ${o.withIndexedSibling} |`,
    `| at least one sibling with a 30-day record | ${o.withSiblingRecord} |`, `| siblings' 30-day sum below $0 | ${o.siblingsNegative} |`, `| wallet plus siblings below $0 (operator-flagged) | ${o.flagged} |`, '');
  L.push(`Overlap: ${res.overlap.inV5Universe} of ${res.scored} scored wallets were in the v5 universe; ${res.overlap.flaggedInV5Universe} of ${o.flagged} flagged were; ${res.overlap.flaggedInV5Attacks} of ${o.flagged} flagged are among V5.md's operator attacks.`, '');
  const shown = res.rows.filter(r => r.op.withRecord > 0).sort((a, b) => a.rank - b.rank);
  L.push('Every wallet with a sibling record:', '', '| rank | wallet | own 30d | siblings | siblings 30d | operator 30d | rule | v4 | v5 | operator read at |', '| ---: | --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |');
  for (const r of shown) L.push(`| ${r.rank} | ${short(r.wallet)} | ${money(r.own)} | ${r.op.withRecord} | ${money(r.op.siblingsPnl)} | ${money(r.op.combined)} | ${money(r.rule)} | ${r.v4.code} | ${r.v5.code} | ${r.operatorReadAt} |`);
  if (res.unread.length) L.push('', `Unread: ${res.unread.map(u => `${u.rank} ${short(u.wallet)} (${u.why})`).join('; ')}`);
  return L.join('\n');
}

/** The block bench/figures.js puts in FIGURES.json. */
export async function fieldFigures() {
  if (!fs.existsSync(path.join(ROOT, STATE_FILE))) return null;
  const r = await scoreField();
  return { T: r.T, scored: r.scored, unread: r.unread.length, askUsd: r.askUsd, pnlRule: [r.pnlRule.funded, r.scored],
    v4: { full: r.v4.full, capped: r.v4.capped, blocked: r.v4.blocked }, v5: { full: r.v5.full, capped: r.v5.capped, blocked: r.v5.blocked, operatorBlocks: r.v5.blockedBy.operator_losing ?? 0 },
    operator: { ...r.operator }, overlap: r.overlap, headline: headline(r), source: 'bench/field/reads (bench/FIELD.md)' };
}

// ------------------------------------------------------------ plan and main

function plan() {
  log(JSON.stringify({ population: `${PAGES} perp-leaderboard pages (${PAGES * LEADERBOARD_CREDITS} credits), first ${N} rows`,
    perWallet: `4 evidence + ${LEADERBOARD_CREDITS} leaderboard + 2 related-wallets + funding (0-2) + sibling summaries (0-8, reused within the run)`,
    screener: `${SCREENER_CREDITS} per distinct market`, creditStop: CREDIT_STOP, operatorIndex: `${OPERATOR_INDEX} (${OPERATOR_INDEX_SHA.slice(0, 8)}...)`, modelCalls: 0 }, null, 2));
}

export async function main(argv = process.argv.slice(2)) {
  if (argv[0] === '--collect') return collect();
  if (argv[0] === '--score') {
    const res = await scoreField();
    const text = formatField(res);
    log(text);
    const json = argv.indexOf('--json');
    if (json >= 0) fs.writeFileSync(path.resolve(ROOT, argv[json + 1]), `${JSON.stringify(res, null, 2)}\n`);
    return res;
  }
  if (argv.length) throw new Error('Usage: node bench/field.js [--collect | --score [--json file.json]]');
  return plan();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(err => { console.error(err.stack ?? err.message); process.exitCode = 1; });
}
