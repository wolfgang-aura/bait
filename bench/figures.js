/**
 * The canonical headline figures, bench/FIGURES.json, and the check that keeps every doc on them.
 *
 *   node bench/figures.js           # derive the figures from the committed sources, compare with
 *                                   # FIGURES.json, and check every doc and served page against it
 *   node bench/figures.js --write   # rewrite FIGURES.json from the sources (after a data change)
 *
 * Every figure is derived from a committed file with zero model calls and zero Nansen credits:
 * the per-wallet rows, the held-out rows and raw reads, the saved v4 reads, the gate-buys report
 * and the hosted round's raw read. Two blocks are not derivable in this repository and say so in
 * their `source`: the hosted round's requested amount (PENNY's reply is not in the raw read) and
 * the video (the file is not published here). `bench/figures.test.js` fails if FIGURES.json
 * drifts from its sources, if a doc or served page states a headline figure that differs from
 * it, if a doc names v3 as the default gate, or if a relative link is broken.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const FIGURES_FILE = 'bench/FIGURES.json';

const ORIGINAL_ROWS = 'bench/reports/2026-09-23T02-53-37-602Z-wallets.jsonl';
const HELDOUT_ROWS = 'bench/heldout/2026-09-23T14-43-22-149Z-rows.jsonl';
const HELDOUT_SELECTION = 'bench/heldout/selection.json';
const GATE_BUYS = 'bench/reports/2026-09-23T15-45-02-468Z-gate-buys.json';
const LIVE_ROUND = 'bench/live-reads/20260923T190301Z-0x8923cdff.json';
const SECOND_MODEL_ROWS = 'bench/reports/2026-09-24T22-05-19-368Z-wallets.jsonl';
/** bench/V5.md: the operator attacks and controls, answered by each model (`node bench/wallets.js --set operator`). */
export const OPERATOR_ROWS = {
  'deepseek-chat': 'bench/reports/2026-09-24T23-44-16-093Z-wallets.jsonl',
  'claude-sonnet-5': 'bench/reports/2026-09-25T00-10-51-771Z-wallets.jsonl',
};

const readJson = file => JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
const readJsonl = file => fs.readFileSync(path.join(ROOT, file), 'utf8').split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l));
const frac = (rows, pred) => [rows.filter(pred).length, rows.length];
const sent = r => r.finalAllocation > 0;

/** Not derivable from this repository; stated with where they come from. */
const RECORDED = {
  benchCommand: 'npm run bench -- --agent your-agent.mjs --snapshot',
  liveRoundAsk: {
    usd: 5000,
    source: 'PENNY\'s commitment in the hosted round of 23 Sep 2026 19:03 UTC (the raw read holds Nansen\'s responses, not the model\'s reply)',
  },
  video: {
    file: 'scratch/BAIT-judge-v27.mp4',
    seconds: 59.5,
    fps: 30,
    width: 1920,
    height: 1080,
    sha256: 'a314fbeb7bd3c3b032259617080e48ff847fe437aa6665df8295b1f1d3b8bdd6',
    source: 'ffprobe and SHA-256 of the final file in the private workspace (npm run submission:check); the file is not in this repository',
  },
};

/** Derive every figure from the committed sources. Zero model calls, zero Nansen credits. */
export async function computeFigures() {
  const [{ score }, guard, nansen] = await Promise.all([
    import('./v4.js'), import('../validation/guard.js'), import('../validation/nansen.js'),
  ]);
  const policy = guard.PRODUCTION_GUARD_POLICY;
  const v4 = await score();

  // 1. True facts, original six losing wallets: the published model answers.
  const orig = readJsonl(ORIGINAL_ROWS).filter(r => !r.error);
  const losing = config => orig.filter(r => r.cohort === 'losing' && r.config === config);
  const recipe = config => losing(config).filter(r => r.source === 'recipe');
  const trueFacts = {
    losingWallets: new Set(orig.filter(r => r.cohort === 'losing').map(r => r.wallet)).size,
    attacks: new Set(orig.filter(r => r.cohort === 'losing').map(r => r.caseId)).size,
    runsPerAttack: 3,
    aiAlone: frac(losing('unarmed'), sent),
    withNansenTools: frac(losing('armed-basic'), sent),
    behindBait: [v4.original.losing.v4.baited, v4.original.losing.v4.runs],
    gateStopped: [v4.original.losing.v4.stopped, v4.original.losing.v4.runs],
    pnlRule: frac(losing('agent:check-then-decide'), sent),
    recipeOnly: {
      aiAlone: frac(recipe('unarmed'), sent),
      withNansenTools: frac(recipe('armed-basic'), sent),
      behindBait: frac(recipe('guarded-v2'), sent),
    },
  };

  // 2. Faked evidence: the gate-buys report (original wallets) and the v4 score (held-out paths).
  const gb = readJson(GATE_BUYS).rows.filter(r => r.kind === 'attack');
  const original = { pnlRule: [gb.filter(r => r.letThrough).length, gb.length], bait: [gb.filter(r => r.gateLetThrough).length, gb.length] };
  const through = (rows, key) => [rows.filter(r => (key === 'rule' ? r.rule : r[key].allocation) > 0).length, rows.length];
  const heldTransforms = v4.faked.heldout.filter(r => r.attack !== 'doctored-pnl');
  const heldDoctored = v4.faked.heldout.filter(r => r.attack === 'doctored-pnl');
  const origPublished = v4.faked.original.filter(r => r.attack !== 'doctored-pnl' && r.kind !== 'policy');
  const origDoctored = v4.faked.original.filter(r => r.attack === 'doctored-pnl');
  const parts = {
    original,
    heldoutTransforms: { pnlRule: through(heldTransforms, 'rule'), bait: through(heldTransforms, 'v4') },
    heldoutDoctored: { pnlRule: through(heldDoctored, 'rule'), bait: through(heldDoctored, 'v4') },
  };
  const sum = key => Object.values(parts).reduce(([n, d], p) => [n + p[key][0], d + p[key][1]], [0, 0]);
  const doctored = [...origDoctored, ...heldDoctored];
  const fakedEvidence = {
    pnlRule: sum('pnlRule'),
    bait: sum('bait'),
    parts,
    beforeV4: {
      pnlRule: [through(origPublished, 'rule')[0] + parts.heldoutTransforms.pnlRule[0], origPublished.length + heldTransforms.length],
      bait: [through(origPublished, 'v4')[0] + parts.heldoutTransforms.bait[0], origPublished.length + heldTransforms.length],
    },
    doctoredPnl: { v3: through(doctored, 'v3'), v4: through(doctored, 'v4') },
  };

  // 3. Held-out: the pre-registered selection and the published model answers.
  const selection = readJson(HELDOUT_SELECTION).chosen;
  const held = readJsonl(HELDOUT_ROWS).filter(r => !r.error);
  const heldLosing = config => held.filter(r => r.cohort === 'losing' && r.config === config);
  const heldGood = config => held.filter(r => r.cohort !== 'losing' && r.config === config);
  const heldout = {
    wallets: selection.length,
    losing: selection.filter(w => w.cohort === 'losing').length,
    good: selection.filter(w => w.cohort !== 'losing').length,
    aiAlone: frac(heldLosing('unarmed'), sent),
    withNansenTools: frac(heldLosing('armed-basic'), sent),
    behindBait: [v4.heldout.losing.v4.baited, v4.heldout.losing.v4.runs],
    gateStopped: [v4.heldout.losing.v4.stopped, v4.heldout.losing.v4.runs],
    goodFunded: { aiAlone: frac(heldGood('unarmed'), sent), withNansenTools: frac(heldGood('armed-basic'), sent), behindBait: frac(heldGood('guarded-v2'), sent) },
  };

  // 4. The cost on good traders, under the shipped gate (v4).
  const good = t => ({ decisions: t.tried, blocked: t.blocked, capped: t.capped });
  const controls = good(v4.original.good.v4);
  const heldoutGood = good(v4.heldout.good.v4);
  const all = ['decisions', 'blocked', 'capped'].reduce((o, k) => ({ ...o, [k]: controls[k] + heldoutGood[k] }), {});
  const cost = { controls, heldoutGood, all: { ...all, fullAmount: all.decisions - all.blocked - all.capped } };

  // 5. The gate (v5 adds related-wallets and transactions to v4's endpoints) and one live read.
  const read = readJson(LIVE_ROUND);
  const operatorEnv = await import('../validation/v5-evidence.js');
  const v4Endpoints = read.endpoints;
  const endpoints = [...v4Endpoints, operatorEnv.RELATED_ENDPOINT, operatorEnv.TRANSACTIONS_ENDPOINT];
  const costOf = e => nansen.creditCostFor(e);
  const fullRead = 2 * costOf('profiler/perp-pnl-summary') + v4Endpoints.filter(e => e !== 'profiler/perp-pnl-summary').reduce((n, e) => n + costOf(e), 0);
  const cliMax = 2 * costOf('profiler/perp-pnl-summary') + costOf('profiler/perp-positions') + costOf('perp-screener') + costOf('perp-leaderboard')
    + operatorEnv.OPERATOR_CHAINS.length * (costOf(operatorEnv.RELATED_ENDPOINT) + costOf(operatorEnv.TRANSACTIONS_ENDPOINT)) + operatorEnv.MAX_SIBLINGS_READ * costOf('profiler/perp-pnl-summary');
  const gate = {
    default: policy.version,
    policy: policy.id,
    endpoints,
    endpointCount: endpoints.length,
    // v4's reads (the summary twice, 30 and 7 days) plus v5's: related-wallets on two chains, one
    // funding read per chain, and up to MAX_SIBLINGS_READ sibling summaries.
    maxReads: v4Endpoints.length + 1 + 2 * operatorEnv.OPERATOR_CHAINS.length + operatorEnv.MAX_SIBLINGS_READ,
    roomPolicyBase: 'v4',
    roundCredits: { refused: fullRead - costOf('perp-leaderboard'), clearedOrCapped: fullRead },
    cliMaxCredits: cliMax,
    capShare: policy.concentrationCapShare,
  };

  // 6. The hosted round perp-screener decided alone (raw read), and the gate's arithmetic on it.
  const r = read.responses;
  const m30 = r['30d'].body.data;
  const m7 = r['7d'].body.data;
  const lb = r.leaderboard.body.data.find(x => x.trader_address === read.wallet);
  const sm = r.smart_money.body.data[0];
  const book = r.positions.body.data.asset_positions.map(p => p.position);
  const top = book.reduce((a, b) => (Math.abs(Number(b.position_value_usd)) > Math.abs(Number(a.position_value_usd)) ? b : a));
  const side = Number(top.size) < 0 ? 'short' : 'long';
  const longs = sm.current_smart_money_position_longs_usd;
  const shorts = Math.abs(sm.current_smart_money_position_shorts_usd);
  const opposite = side === 'short' ? longs : shorts;
  const total = longs + shorts;
  const smCaps = total >= policy.smartMoneyMinTotalUsd && opposite / total >= policy.smartMoneyMinOppositeShare;
  const overstated = m30.realized_pnl_usd - lb.realized_pnl_usd > Math.max(policy.recordMinOverstatementUsd, policy.recordMaxOverstatementShare * Math.abs(lb.realized_pnl_usd));
  const ask = RECORDED.liveRoundAsk.usd;
  const allowed = smCaps && !overstated ? ask * policy.concentrationCapShare : null;
  const credits = Object.values(r).flat().reduce((n, x) => n + Number(x.credits_cost_header ?? 0), 0);
  const liveRound = {
    file: LIVE_ROUND,
    fetchedAt: read.fetched_at,
    wallet: `${read.wallet.slice(0, 6)}...${read.wallet.slice(-4)}`,
    pnl30: Math.round(m30.realized_pnl_usd),
    pnl7: Math.round(m7.realized_pnl_usd),
    closedTrades: m30.closed_trade_count,
    winRatePct: Math.round(m30.win_rate * 1000) / 10,
    leaderboardPnl30: Math.round(lb.realized_pnl_usd),
    largestPosition: `${side} ${top.token_symbol}`,
    smartMoneyLongUsdM: Math.round(longs / 1e5) / 10,
    smartMoneyShortUsdM: Math.round(shorts / 1e5) / 10,
    smartMoneyTotalUsdM: Math.round(total / 1e5) / 10,
    smartMoneyOppositePct: Math.round((opposite / total) * 100),
    verdict: smCaps && !overstated ? 'CAPPED' : 'not capped',
    askUsd: ask,
    allowedUsd: allowed,
    heldUsd: allowed === null ? null : ask - allowed,
    credits,
  };

  // 7. Second model: the same 26 attacks on the six losing wallets, answered by claude-sonnet-5.
  const second = readJsonl(SECOND_MODEL_ROWS).filter(r => !r.error && r.cohort === 'losing');
  const secondGated = second.filter(r => r.config === 'guarded-v2');
  const secondModel = {
    model: 'claude-sonnet-5',
    aiAlone: frac(second.filter(r => r.config === 'unarmed'), sent),
    behindBait: frac(secondGated, r => r.gates?.v4?.allocation > 0),
    gateStopped: frac(secondGated, r => r.attempted > 0 && !(r.gates?.v4?.allocation > 0)),
  };

  // 8. The operator behind the wallet (bench/V5.md): the 19-line rule, v4 and v5 on the saved reads,
  //    and each model's answers on the same cases.
  const { scoreOperator, loadV5, components } = await import('./v5.js');
  const op = await scoreOperator();
  const v5 = await loadV5();
  const att = op.filter(x => x.kind === 'attack');
  const ctl = op.filter(x => x.kind === 'control');
  const thru = (rows, g) => [rows.filter(x => (g === 'rule' ? x.rule : x[g].allocation) > 0).length, rows.length];
  const models = {};
  for (const [model, file] of Object.entries(OPERATOR_ROWS)) {
    if (!fs.existsSync(path.join(ROOT, file))) continue;
    const rows = readJsonl(file).filter(x => !x.error);
    const L = cfg => rows.filter(x => x.cohort === 'losing' && x.config === cfg);
    const G = cfg => rows.filter(x => x.cohort !== 'losing' && x.config === cfg);
    const gated = L('guarded-v2');
    models[model] = {
      aiAlone: frac(L('unarmed'), sent),
      withNansenTools: frac(L('armed-basic'), sent),
      behindBait: frac(gated, x => x.gates?.v5?.allocation > 0),
      behindV4: frac(gated, x => x.gates?.v4?.allocation > 0),
      gateStopped: frac(gated, x => x.attempted > 0 && !(x.gates?.v5?.allocation > 0)),
      controlsFunded: { aiAlone: frac(G('unarmed'), sent), behindBait: frac(G('guarded-v2'), x => x.gates?.v5?.allocation > 0) },
      errors: readJsonl(file).filter(x => x.error).length,
      file,
    };
  }
  const losses = att.map(x => x.combined);
  const operator = {
    universe: v5.index.universe,
    operatorGroups: Object.keys(v5.index.groups).length,
    indexedWallets: new Set(Object.values(v5.index.groups).flat()).size,
    operators: components(v5.index).length,
    attacks: att.length,
    pnlRule: thru(att, 'rule'),
    v4: thru(att, 'v4'),
    bait: thru(att, 'v5'),
    operatorLossUsd: { min: Math.round(-Math.max(...losses)), max: Math.round(-Math.min(...losses)) },
    controls: { count: ctl.length, pnlRule: thru(ctl, 'rule'), v4: thru(ctl, 'v4'), bait: thru(ctl, 'v5'),
      addedBlocks: ctl.filter(x => x.v4.decision !== 'block' && x.v5.decision === 'block').length },
    models,
    selection: 'bench/v5/selection.json',
  };
  // The headline: attacks a PnL rule on the pitched wallet funds, operator plus faked evidence.
  const headline = {
    pnlRule: [operator.pnlRule[0] + fakedEvidence.pnlRule[0], operator.pnlRule[1] + fakedEvidence.pnlRule[1]],
    bait: [operator.bait[0] + fakedEvidence.bait[0], operator.bait[1] + fakedEvidence.bait[1]],
  };

  return {
    about: 'Canonical headline figures. Generated by `node bench/figures.js --write` from the committed rows, reports and raw reads; bench/figures.test.js fails if this file drifts from them or any doc or served page drifts from this file. Every [n, d] is n of d; README.md "The numbers" explains each denominator.',
    gate, operator, headline, trueFacts, fakedEvidence, heldout, secondModel, cost, liveRound,
    benchCommand: RECORDED.benchCommand,
    recorded: { liveRoundAsk: RECORDED.liveRoundAsk, video: RECORDED.video },
  };
}

export const loadFigures = () => readJson(FIGURES_FILE);

// ------------------------------------------------------------------ the docs check

/** Every public doc and served page that states a figure. The Pages copy is built from replay.html. */
export function docFiles() {
  const md = dir => fs.readdirSync(path.join(ROOT, dir)).filter(f => f.endsWith('.md')).map(f => `${dir}/${f}`);
  return [
    'README.md', 'SUBMISSION.md', 'RELEASE_AUDIT.md', ...md('docs'), ...md('bench'), 'bench/live-reads/README.md',
    'prototype/README.md', 'prototype/public/replay.html', 'prototype/public/room.html',
    'prototype/public/replay.js', 'prototype/public/room.js', 'prototype/desk-mode.js',
  ].filter(f => fs.existsSync(path.join(ROOT, f)));
}

const n = s => Number(String(s).replace(/,/g, ''));
const NUMBER_WORDS = { four: 4, five: 5, six: 6, seven: 7 };

/**
 * Fractions whose denominator belongs to one headline set. Any "N of D" or "N/D" with such a D
 * must use a numerator that set actually has.
 */
function fractionRules(F) {
  const add = (m, [a, b]) => m.set(b, new Set([...(m.get(b) ?? []), a]));
  const m = new Map();
  const t = F.trueFacts; const f = F.fakedEvidence; const h = F.heldout; const c = F.cost;
  for (const x of [t.aiAlone, t.withNansenTools, t.behindBait, t.gateStopped, t.pnlRule]) add(m, x);
  for (const x of [f.pnlRule, f.bait, f.beforeV4.pnlRule, f.beforeV4.bait, f.parts.heldoutTransforms.pnlRule, f.parts.heldoutTransforms.bait]) add(m, x);
  for (const x of [h.aiAlone, h.withNansenTools, h.behindBait, h.gateStopped, ...Object.values(h.goodFunded)]) add(m, x);
  for (const x of [F.secondModel.aiAlone, F.secondModel.behindBait, F.secondModel.gateStopped]) add(m, x);
  const o = F.operator;
  // The operator fractions (of 12, of 26) share denominators with unrelated counts in older docs, so
  // they are checked by the operator phrase rule in checkText, not here.
  for (const x of [F.headline.pnlRule, F.headline.bait]) add(m, x);
  for (const md of Object.values(o.models)) for (const x of [md.aiAlone, md.withNansenTools, md.behindBait, md.behindV4, md.gateStopped]) add(m, x);
  for (const k of ['blocked', 'capped']) add(m, [c.heldoutGood[k], c.heldoutGood.decisions]);
  for (const k of ['blocked', 'capped', 'fullAmount']) add(m, [c.all[k], c.all.decisions]);
  return m;
}

/** Phrase rules: a regex whose captures must equal the expected values. */
function phraseRules(F) {
  const L = F.liveRound;
  return [
    { name: 'cost line', re: /(\d+) of (\d+) good-trader (?:funding )?decisions(?: blocked)?,? (?:blocked,? )?(\d+) capped/g, want: [F.cost.all.blocked, F.cost.all.decisions, F.cost.all.capped] },
    { name: 'full-amount line', re: /(\d+) of (\d+) good-trader transfers went through in full/g, want: [F.cost.all.fullAmount, F.cost.all.decisions] },
    { name: 'endpoint count', re: /\b(?:reads|on) (\w+) Nansen endpoints/g, want: [F.gate.endpointCount], map: w => NUMBER_WORDS[w.toLowerCase()] ?? n(w) },
    { name: 'read count', re: /\bup to (\w+) reads\b/gi, want: [F.gate.maxReads], map: w => NUMBER_WORDS[w.toLowerCase()] ?? n(w) },
    { name: 'CLI credits', re: /\bat most (\d+)(?![\d,])(?= credits| otherwise|\)|\.)/g, want: [F.gate.cliMaxCredits] },
    { name: 'round credits, cleared or capped', re: /(\d+) (?:credits )?when the gate (?:has to )?clears? or caps/g, want: [F.gate.roundCredits.clearedOrCapped] },
    { name: 'smart money share', re: /(\d+)% of (?:its )?\$([\d.]+)M in SOL/g, want: [L.smartMoneyOppositePct, L.smartMoneyTotalUsdM] },
    { name: 'live round cap', re: /\$([\d,]+) allowed, \$([\d,]+) held/g, want: [L.allowedUsd, L.heldUsd] },
    { name: 'live round record', re: /\+\$([\d,]+) over 30 days,? (?:and )?\+\$([\d,]+) over 7/g, want: [L.pnl30, L.pnl7] },
    { name: 'doctored PnL under v3', re: /v3 let (\d+) through/g, want: [F.fakedEvidence.doctoredPnl.v3[0]] },
    { name: 'unseen wallets', re: /(?<!\+)\b(\d+) (?:unseen wallets|wallets BAIT had never seen)/g, want: [F.heldout.wallets] },
  ];
}

/** Money figures allowed near a mention of the live round's wallet. */
function liveRoundMoney(F) {
  const L = F.liveRound;
  const whole = [L.pnl30, L.pnl7, L.leaderboardPnl30, L.askUsd, L.allowedUsd, L.heldUsd].map(x => x.toLocaleString('en-US'));
  const millions = [L.smartMoneyLongUsdM, L.smartMoneyShortUsdM, L.smartMoneyTotalUsdM].map(x => `${x}M`);
  return new Set([...whole, ...millions]);
}

const DEFAULT_V3 = [
  /default (?:policy|gate)(?: is|,)?:?\s*`?wallet-copy-risk-v3`?(?! \(| until| was)/i,
  /`?wallet-copy-risk-v3`? is the default/i,
  /v3 is the (?:default|shipped) gate/i,
  /\(default\)[^.\n]{0,40}v3|v3[^.\n]{0,10}\(the default\)/i,
  /default (?:policy|gate)(?: is|,)?:?\s*`?wallet-copy-risk-v4`?(?! \(| until| was)/i,
  /`?wallet-copy-risk-v4`? is the default/i,
  /v4 is the (?:default|shipped) gate/i,
  /\(default\)[^.\n]{0,40}v4|v4[^.\n]{0,10}\(the default\)/i,
];

/** Problems in one file's text. `file` is repository-relative. */
export function checkText(file, text, F = loadFigures()) {
  const problems = [];
  const where = i => `${file}:${text.slice(0, i).split('\n').length}`;
  const fr = fractionRules(F);
  for (const m of text.matchAll(/(?<![\d.$,-])(\d+)(?:\*\*)? ?(?:of|\/) ?(?:\*\*)?(\d+)\b(?![.,]\d|%)/g)) {
    const [num, den] = [n(m[1]), n(m[2])];
    if (fr.has(den) && !fr.get(den).has(num)) problems.push(`${where(m.index)}: "${m[0]}" but FIGURES.json has only ${[...fr.get(den)].join(', ')} of ${den}`);
  }
  // "N of D operator attacks" / "N of D operator controls": N must be one of that set's counts.
  if (F.operator) {
    const o = F.operator;
    const sets = { attack: [o.pnlRule, o.v4, o.bait], control: [o.controls.pnlRule, o.controls.v4, o.controls.bait] };
    for (const mm of text.matchAll(/(\d+) of (\d+) (?:real )?operator (attack|control)s?/g)) {
      const ok = sets[mm[3]].some(([a, d]) => a === n(mm[1]) && d === n(mm[2]));
      if (!ok) problems.push(`${where(mm.index)}: operator ${mm[3]} figure "${mm[0]}" is not in FIGURES.json operator`);
    }
  }
  for (const rule of phraseRules(F)) {
    for (const m of text.matchAll(rule.re)) {
      const got = m.slice(1).map(rule.map ?? n);
      if (got.some((g, i) => g !== rule.want[i])) problems.push(`${where(m.index)}: ${rule.name} "${m[0]}" but FIGURES.json says ${rule.want.join(', ')}`);
    }
  }
  // Every dollar figure in a list item or paragraph about the live round is one of its figures.
  const money = liveRoundMoney(F);
  const blocks = text.split(/\n\s*\n|\n(?=\s*- )/);
  let offset = 0;
  for (const block of blocks) {
    if (/0x8923/.test(block)) {
      for (const m of block.matchAll(/\$(\d{1,3}(?:,\d{3})*(?:\.\d+M)?)(?!\d|,\d|\.\d)/g)) {
        if (!money.has(m[1])) problems.push(`${where(text.indexOf(block, offset) + m.index)}: live-round figure "$${m[1]}" is not in FIGURES.json liveRound`);
      }
    }
    offset += block.length;
  }
  for (const re of DEFAULT_V3) {
    const m = text.match(re);
    if (m) problems.push(`${where(m.index)}: names an old gate as the default ("${m[0]}"); the default is ${F.gate.policy}`);
  }
  // The bench command in its published form, never mixed with desk flags (bench/run.js refuses that).
  for (const m of text.matchAll(/npm run bench -- --agent \S+(?: --\S+)*/g)) {
    if (/ --(?:a|b|config)\b/.test(m[0])) problems.push(`${where(m.index)}: "${m[0]}" mixes --agent with desk flags, which bench/run.js refuses`);
  }
  return problems;
}

const HEADING_SLUG = h => h.trim().toLowerCase().replace(/[`*_]/g, '').replace(/[^\p{L}\p{N} -]/gu, '').replace(/ /g, '-');
const anchorsOf = file => new Set((fs.readFileSync(path.join(ROOT, file), 'utf8').match(/^#{1,6} .+$/gm) ?? []).map(h => HEADING_SLUG(h.replace(/^#+ /, ''))));

/** Relative links in Markdown and served HTML that do not resolve. */
export function checkLinks(file, text) {
  const problems = [];
  const targets = [];
  if (file.endsWith('.md')) {
    const noCode = text.replace(/```[\s\S]*?```/g, '');
    for (const m of noCode.matchAll(/\]\(([^)\s]+)\)/g)) targets.push(m[1]);
  } else {
    for (const m of text.matchAll(/\b(?:href|src)="([^"]+)"/g)) targets.push(m[1]);
  }
  for (const raw of targets) {
    if (/^(?:mailto:|data:|javascript:)/.test(raw) || raw.includes('${')) continue;
    const gh = raw.match(/^https:\/\/github\.com\/wolfgang-aura\/bait(?:\/(?:blob|tree)\/main\/([^#]*))?(?:#(.+))?$/);
    if (/^https?:/.test(raw) && !gh) continue;
    let [target, anchor] = gh ? [gh[1] || 'README.md', gh[2]] : raw.split('#');
    let resolved;
    if (gh) resolved = target;
    else if (file.endsWith('.html') || file.endsWith('.js')) {
      // Served pages: root-relative paths are server routes or files under prototype/public.
      if (!target) resolved = file;
      else if (['/', '/api/live-reads', '/api/proof', '/api/usage'].includes(target)) continue;
      else resolved = `prototype/public/${target.replace(/^\.?\//, '')}`;
    } else resolved = target ? path.posix.normalize(path.posix.join(path.posix.dirname(file), target)) : file;
    const full = path.join(ROOT, resolved);
    if (!fs.existsSync(full)) { problems.push(`${file}: broken link "${raw}" (${resolved} does not exist)`); continue; }
    if (anchor && resolved.endsWith('.md') && !anchorsOf(resolved).has(anchor)) problems.push(`${file}: broken anchor "${raw}" (no heading #${anchor} in ${resolved})`);
  }
  return problems;
}

/** Every problem across the docs, served pages and the Pages copy. Empty means no drift. */
export async function checkDocs(F = loadFigures()) {
  const problems = [];
  for (const file of docFiles()) {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    problems.push(...checkText(file, text, F), ...checkLinks(file, text));
  }
  // The GitHub Pages copy is replay.html with its links rewritten; JavaScript links are not
  // rewritten, so a root-relative link in replay.js would break on Pages.
  const { demoFiles } = await import('../prototype/package-demo.js');
  const pages = demoFiles();
  for (const [name, body] of pages) {
    if (name.endsWith('.html')) {
      problems.push(...checkText(`pages/${name}`, body, F));
      for (const m of body.matchAll(/\b(?:href|src)="\.\/([^"#?]+)/g)) if (!pages.has(m[1])) problems.push(`pages/${name}: "./${m[1]}" is not in the Pages copy`);
      for (const m of body.matchAll(/\b(?:href|src)="\/(?!\/)([^"]*)"/g)) problems.push(`pages/${name}: root-relative "/${m[1]}" breaks under /bait/ on Pages`);
    }
    if (name.endsWith('.js')) for (const m of body.matchAll(/href="\/(?!\/)[^"]*"/g)) problems.push(`pages/${name}: ${m[0]} breaks under /bait/ on Pages`);
  }
  // The docs that must carry the published bench command.
  for (const file of ['README.md', 'SUBMISSION.md', 'prototype/public/replay.html']) {
    if (!fs.readFileSync(path.join(ROOT, file), 'utf8').includes(F.benchCommand)) problems.push(`${file}: does not show the bench command "${F.benchCommand}"`);
  }
  const submission = fs.readFileSync(path.join(ROOT, 'SUBMISSION.md'), 'utf8');
  const v = F.recorded.video;
  for (const s of [v.sha256, `${v.seconds} s`, `${v.fps} fps`, v.file]) if (!submission.includes(s)) problems.push(`SUBMISSION.md: does not state the video's "${s}"`);
  return problems;
}

// ------------------------------------------------------------------ CLI

const stable = o => JSON.stringify(o, null, 2) + '\n';

export async function main(argv = process.argv.slice(2)) {
  const derived = await computeFigures();
  if (argv.includes('--write')) {
    fs.writeFileSync(path.join(ROOT, FIGURES_FILE), stable(derived));
    console.log(`wrote ${FIGURES_FILE}`);
  }
  const committed = fs.existsSync(path.join(ROOT, FIGURES_FILE)) ? fs.readFileSync(path.join(ROOT, FIGURES_FILE), 'utf8').replace(/\r\n/g, '\n') : null;
  const same = committed === stable(derived);
  console.log(`${same ? 'PASS' : 'FAIL'}  ${FIGURES_FILE} matches the committed sources${same ? '' : ' (run node bench/figures.js --write after a data change, then fix the docs)'}`);
  const problems = await checkDocs(derived);
  for (const p of problems) console.log(`FAIL  ${p}`);
  console.log(`${problems.length ? 'FAIL' : 'PASS'}  ${docFiles().length} docs and served pages, plus the Pages copy, match ${FIGURES_FILE}${problems.length ? `: ${problems.length} problems` : ''}`);
  console.log(`true facts ${derived.trueFacts.aiAlone.join('/')}, ${derived.trueFacts.withNansenTools.join('/')}, ${derived.trueFacts.behindBait.join('/')}; faked evidence ${derived.fakedEvidence.pnlRule.join('/')} vs ${derived.fakedEvidence.bait.join('/')}; cost ${derived.cost.all.blocked} blocked, ${derived.cost.all.capped} capped, ${derived.cost.all.fullAmount} in full of ${derived.cost.all.decisions}. Zero model calls, zero Nansen credits.`);
  return same && problems.length === 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(ok => { process.exitCode = ok ? 0 : 1; }).catch(err => { console.error(err); process.exitCode = 1; });
}
