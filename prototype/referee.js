/**
 * The Pitch Room's deterministic referee (judge 10, 26 Sep 2026).
 *
 * Judge 10 found false lines standing on the live build: "Nansen's 7-day summary shows +$594,869"
 * (a leaderboard figure), "The Hyperliquid leaderboard shows a 92.3% win rate" (Nansen's), a 7-day
 * figure said over 30 days. The source and window rules ran only after the model checker rejected,
 * and one way round. Here they run on every line, before the model is asked, and nothing the model
 * says can undo a strike.
 *
 * The round's record is a ledger of facts: {kind, value, measure, window, source, visible}, built
 * from the fact cards, every figure the tile prints, the round's two Nansen summaries and the
 * trader's public leaderboard row. For each figure a line types, the referee reads the window,
 * source, coin and measure the line gives that figure (its own words first, then its sentence, then
 * the line), finds the facts of this wallet with that value, and strikes when none of them was
 * stated that way. A value no fact of this wallet holds is named as another trader's figure when it
 * is one, else "not in the record". A sealed figure is never confirmed or placed: the strike says
 * only what the line claimed that is not so.
 */

// ------------------------------------------------------------------ figures as a player types them

const SUFFIX = '(?:k|m|mm|bn|million|thousand|grand|billion)';
const MULT = { k: 1e3, thousand: 1e3, grand: 1e3, m: 1e6, mm: 1e6, million: 1e6, bn: 1e9, billion: 1e9 };
const COUNT_RE = new RegExp(`(?<![\\w$.,])(\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.(\\d+))?(\\s?k)?\\s+((?:closed|winning)\\s+)?trades?\\b`, 'gi');
const PCT_RE = /(?<![\w.,])([+-])?(\d+(?:\.\d+)?)\s?%/g;
const MONEY_RE = new RegExp(`([+-])?\\$\\s?([+-])?(\\d(?:[\\d,]*\\d)?(?:\\.\\d+)?)(?:\\s?(${SUFFIX})\\b)?`, 'gi');
const BARE_RE = new RegExp(`(?<![\\w$.,+-])([+-])?(\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?(?=\\s?${SUFFIX}\\b))(?:\\s?(${SUFFIX})\\b)?`, 'gi');
/** A bare number followed by one of these is not a dollar figure. */
const NOT_MONEY_AFTER = /^\s*(?:closed\s+|winning\s+)?(?:trades?|fills?|days?|hours?|minutes?|weeks?|months?|years?|wallets?|positions?|markets?|coins?|times|x\b|users?|traders?|people|accounts?|orders?|%|percent|bps)/i;

/** The precision a typed number carries: "594k" is to the thousand, "$594,869" to the dollar. */
function unitOf(digits, decimals, mult, trailingZeros = true) {
  if (decimals) return 10 ** -decimals.length * mult;
  const zeros = trailingZeros ? (digits.match(/0+$/)?.[0].length ?? 0) : 0;
  return 10 ** Math.min(zeros, digits.length - 1) * mult;
}

/**
 * Every figure a line types, in order: { typed, kind: money|pct|count, n, unit, at, end, mode }.
 * `typed` is how the referee quotes it back ("+$594,869", "92.3%", "3,373 trades", "594k").
 * `mode` is 'eq', 'approx' ("about $190k"), 'ge' ("over $500k") or 'le' ("under $1m").
 */
export function extractFigures(text) {
  const t = String(text ?? '');
  const taken = [];
  const free = (a, b) => !taken.some(([x, y]) => a < y && b > x);
  const out = [];
  const add = (m, fig) => {
    const at = m.index;
    const end = at + m[0].length;
    if (!free(at, end)) return;
    taken.push([at, end]);
    out.push({ ...fig, at, end });
  };
  for (const m of t.matchAll(COUNT_RE)) {
    const digits = m[1].replace(/,/g, '');
    const mult = m[3] ? 1e3 : 1;
    const n = Number(`${digits}${m[2] ? `.${m[2]}` : ''}`) * mult;
    add(m, { typed: `${m[1]}${m[2] ? `.${m[2]}` : ''}${m[3] ? 'k' : ''} trades`, kind: 'count', n, unit: unitOf(digits, m[2], mult), winning: /winning/i.test(m[4] ?? '') });
  }
  for (const m of t.matchAll(PCT_RE)) {
    const n = Number(m[2]) * (m[1] === '-' ? -1 : 1);
    add(m, { typed: m[0].replace(/\s+/g, ''), kind: 'pct', n, unit: unitOf(m[2].split('.')[0], m[2].split('.')[1], 1, false) });
  }
  const money = (m, signA, signB, body, suffix) => {
    const [int, dec] = body.replace(/,/g, '').split('.');
    const mult = suffix ? MULT[suffix.toLowerCase()] : 1;
    const sign = signA || signB || null;
    const n = Number(`${int}${dec ? `.${dec}` : ''}`) * mult;
    add(m, { typed: m[0].trim().replace(/,$/, ''), kind: 'money', n, sign, unit: unitOf(int, dec, mult) });
  };
  for (const m of t.matchAll(MONEY_RE)) money(m, m[1], m[2], m[3], m[4]);
  for (const m of t.matchAll(BARE_RE)) {
    if (!m[3] && NOT_MONEY_AFTER.test(t.slice(m.index + m[0].length))) continue;
    money(m, m[1], null, m[2], m[3]);
  }
  out.sort((a, b) => a.at - b.at);
  for (const f of out) {
    const before = t.slice(Math.max(0, f.at - 24), f.at).toLowerCase();
    f.mode = f.kind === 'count' ? 'eq'
      : /(?:about|around|roughly|nearly|almost|approximately|approx\.?|close to|some|~|just (?:under|over|shy of|below|above))\s*$/.test(before) ? 'approx'
      : /(?:over|more than|above|north of|at least|upwards of|in excess of|>)\s*$/.test(before) ? 'ge'
      : /(?:under|less than|below|at most|south of|<)\s*$/.test(before) ? 'le' : 'eq';
    if (f.kind === 'money' && !f.sign) {
      const after = t.slice(f.end, f.end + 20).toLowerCase();
      f.sign = /\b(?:lost|losing|loss of|down|minus|negative)\s*$/.test(before) || /^\s*(?:loss|in losses|down|in the red)\b/.test(after) ? '-' : null;
    }
  }
  return out;
}

// ---------------------------------------------------------------------- where each figure sits

const DAYS = { '7d': '7-day', '30d': '30-day', all: 'all-time', now: 'current' };
const WINDOW_CUES = [
  ['7d', /\b(?:7|seven)[- ]?days?\b|\b7d\b|\bweek(?:ly|'s)?\b/gi],
  ['30d', /\b(?:30|thirty)[- ]?days?\b|\b30d\b|\bmonth(?:ly|'s)?\b/gi],
  ['all', /\ball[- ]time\b|\blifetime\b|\bsince (?:inception|launch|day one)\b/gi],
  ['now', /\baccount(?:\s+value)?\b|\bbalance\b|\bequity\b/gi],
];
const SOURCE_CUES = [
  ['Nansen', /\bnansen(?:'s)?\b/gi],
  ['leaderboard', /\bleaderboard(?:'s)?\b|\bhyperliquid(?:'s)?\s+(?:shows?|says|lists|reports?|ranks?|has|puts|page|row|stats|data|profile|numbers)\b|\b(?:per|according to|from|via)\s+hyperliquid\b/gi],
];
// A cue followed by a noun describes the figure after it ("7-day summary shows +$X"); any other
// cue ("+$X this week", "+$X on the leaderboard") describes the figure before it.
const LINKING = /^\s+(?!(?:on|in|per|from|at|for|according|via|and|with|by|to|of|is|was|so|but|or|as|the)\b)[a-z]/i;

/** Sentence and clause bounds: a sentence ends at . ! ? ; · | (never inside a number). */
function bounds(t, clause) {
  // A comma, colon or full stop between two digits is part of a number ("594,869", "$594.9k", "21:56").
  const re = clause ? /(?<!\d)[.,:]|[.,:](?!\d)|[!?;·|\n]/g : /(?<!\d)\.|\.(?!\d)|[!?;·|\n]/g;
  const cuts = [0];
  for (const m of t.matchAll(re)) cuts.push(m.index + 1);
  cuts.push(t.length + 1);
  return pos => {
    let i = 0;
    while (i < cuts.length - 1 && cuts[i + 1] <= pos) i++;
    return [cuts[i], cuts[i + 1] - 1];
  };
}

function cuesIn(t, table) {
  const out = [];
  for (const [cls, re] of table) {
    for (const m of t.matchAll(re)) out.push({ cls, at: m.index, end: m.index + m[0].length, fwd: LINKING.test(t.slice(m.index + m[0].length)) });
  }
  return out.sort((a, b) => a.at - b.at);
}

const oneClass = cues => {
  const set = [...new Set(cues.map(c => c.cls))];
  return set.length === 1 ? set[0] : set.length ? 'many' : null;
};

/** Which window each figure is claimed over: its bound cue, else its clause, else its sentence. */
function windowsFor(t, figs) {
  const cues = cuesIn(t, WINDOW_CUES);
  const clause = bounds(t, true);
  const sentence = bounds(t, false);
  const bound = new Map(figs.map(f => [f, []]));
  for (const c of cues) {
    const [a, b] = clause(c.at);
    const inClause = figs.filter(f => f.at >= a && f.end <= b);
    const before = inClause.filter(f => f.end <= c.at).at(-1);
    const after = inClause.find(f => f.at >= c.end);
    const target = c.fwd ? (after ?? before) : (before ?? after);
    if (target) bound.get(target).push(c);
  }
  const within = ([a, b]) => cues.filter(c => c.at >= a && c.end <= b);
  return figs.map(f => {
    // Never from another sentence: "+$X this week. 53.9% win rate." says nothing about the 53.9%'s window.
    for (const set of [bound.get(f), within(clause(f.at)), within(sentence(f.at))]) {
      const cls = oneClass(set);
      if (cls === 'many') return null;
      if (cls) return cls;
    }
    return null;
  });
}

/** Which source each figure is credited to: its clause, else its sentence. */
function sourcesFor(t, figs) {
  const cues = cuesIn(t, SOURCE_CUES);
  const clause = bounds(t, true);
  const sentence = bounds(t, false);
  const pick = (set, f) => {
    const cls = oneClass(set);
    if (cls !== 'many') return cls;
    return (set.filter(c => c.end <= f.at).at(-1) ?? set.find(c => c.at >= f.end)).cls;
  };
  return figs.map(f => {
    for (const [a, b] of [clause(f.at), sentence(f.at)]) {
      const set = cues.filter(c => c.at >= a && c.end <= b);
      if (set.length) return pick(set, f);
    }
    return null;
  });
}

/** The coin a figure is said to be about: a known coin named in its clause, nearest figure only. */
function coinsFor(t, figs, coins) {
  if (!coins.length) return figs.map(() => null);
  const re = new RegExp(`\\b(${coins.map(c => c.replace(/[^A-Za-z0-9]/g, '')).filter(Boolean).join('|')})\\b`, 'g');
  const clause = bounds(t, true);
  const named = [...t.matchAll(re)].map(m => ({ coin: m[1], at: m.index }));
  return figs.map(f => {
    const [a, b] = clause(f.at);
    const here = named.filter(c => c.at >= a && c.at <= b);
    if (!here.length) return null;
    const c = here[0];
    const inClause = figs.filter(g => g.at >= a && g.end <= b);
    const nearest = inClause.reduce((x, g) => (Math.abs(g.at - c.at) < Math.abs(x.at - c.at) ? g : x));
    return nearest === f ? c.coin : null;
  });
}

const PNL_WORDS = /\b(?:made|making|profit|profits|pnl|p&l|realised|realized|earned|gain(?:ed|s)?)\b/i;
const ALLOCATION_BEFORE = /\b(?:send|sending|wire|wiring|allocate|allocating|give|giving|put|putting|commit|stake|bet|risk|invest|deploy|try|start with|ask(?:ing)? for|request(?:ing)?)\s+(?:(?:him|her|them|me|us|it|a|an|the|just|only|about|around|maybe)\s+){0,2}$/i;
const ALLOCATION_AFTER = /^\s*(?:of (?:the|your|my|our) (?:fund|book|bankroll|slot|capital|money|\$25,000)|allocation|position|ticket|probe|test|trial|stake|bet|to (?:start|test|try))\b/i;

// ---------------------------------------------------------------------------- the round's facts

const coinName = label => String(label ?? '').split(',')[0].trim();
const CARD = {
  'week-pnl': { window: '7d', money: '7-day realised PnL' },
  'week-wins': { window: '7d', pct: '7-day win rate', count: '7-day trade count' },
  'month-wins': { window: '30d', pct: '30-day win rate', count: '30-day trade count' },
  'best-market': { window: '30d' },
  'all-time': { window: 'all', money: 'all-time PnL' },
};

/** The tile's figure as the referee names it: "Hyperliquid leaderboard figure for the week to 21 Sep". */
export function publishedDesc(e) {
  const whose = e.from === 'Nansen' ? `Nansen ${DAYS[e.span] ?? ''}`.replace(/ $/, '') : 'Hyperliquid leaderboard';
  if (e.span === 'now') return `${whose} ${e.what ?? 'account value'} (${String(e.source ?? '').replace(/^Hyperliquid leaderboard /, '')})`;
  const noun = e.what === 'win rate' || e.what === 'trade count' ? e.what : 'figure';
  return e.span === 'all' ? `${whose} all-time ${noun} (${e.window})` : `${whose} ${noun} for the ${e.window}`;
}

/**
 * The round's ledger: every fact the referee may rule with. Summaries and the leaderboard row are
 * sealed unless a card or the tile shows the same figure; each card and tile figure is its own fact.
 */
export function ledgerOf(dossier, data) {
  const facts = [];
  const push = f => facts.push({ unsigned: false, coin: null, visible: false, ...f });
  const walk = (summary, window) => {
    if (!summary || typeof summary !== 'object') return;
    const one = (obj, coin) => {
      for (const [key, v] of Object.entries(obj)) {
        if (typeof v !== 'number' || !Number.isFinite(v)) continue;
        const base = { window, source: 'Nansen', origin: 'summary', coin };
        if (/_usd$/.test(key)) push({ ...base, kind: 'money', value: v, measure: key === 'realized_pnl_usd' ? (coin ? 'market PnL' : 'realised PnL') : key.replace(/_usd$/, '').replace(/_/g, ' '), unsigned: key !== 'realized_pnl_usd' });
        else if (key === 'win_rate' || /_(?:roi|percent)$/.test(key)) push({ ...base, kind: 'pct', value: v * 100, measure: key === 'win_rate' ? 'win rate' : 'return' });
        else if (/count$|^traded_times$/.test(key)) push({ ...base, kind: 'count', value: v, measure: key === 'winning_trade_count' ? 'winning trade count' : 'trade count' });
      }
    };
    one(summary, null);
    for (const c of summary.top5_coins ?? []) if (c?.coin) one(c, c.coin);
  };
  walk(data?.pnl_summary_7d, '7d');
  walk(data?.pnl_summary_30d, '30d');
  for (const f of dossier?.facts ?? []) {
    const spec = CARD[f.id] ?? {};
    const source = String(f.source ?? '').startsWith('Hyperliquid leaderboard') ? 'leaderboard' : 'Nansen';
    for (const fig of extractFigures(`${f.value ?? ''} ${f.label ?? ''}`)) {
      const coin = f.id === 'best-market' ? coinName(f.label) : null;
      const desc = coin ? `${coin} 30-day PnL` : spec[fig.kind] ?? f.label;
      push({ kind: fig.kind, value: fig.kind === 'money' && fig.sign === '-' ? -fig.n : fig.n, window: spec.window ?? null, source, origin: 'card', cardId: f.id,
        measure: fig.kind === 'pct' ? 'win rate' : fig.kind === 'count' ? 'trade count' : coin ? 'market PnL' : spec.window === 'all' ? 'all-time PnL' : 'realised PnL',
        coin, desc, visible: f.tone === 'positive' });
    }
  }
  for (const e of dossier?.published ?? []) {
    for (const fig of extractFigures(e.value)) {
      push({ kind: fig.kind, value: fig.kind === 'money' && fig.sign === '-' ? -fig.n : fig.n, window: e.span, source: e.from === 'Nansen' ? 'Nansen' : 'leaderboard', origin: 'tile', tile: e,
        measure: e.what === 'account value' ? 'account value' : e.what ?? 'PnL', unsigned: e.span === 'now', visible: true,
        desc: `${DAYS[e.span] ? `${DAYS[e.span]} ` : ''}${e.what ?? 'figure'} on the tile` });
    }
  }
  const row = dossier?.leaderboardRow;
  if (row) {
    const lb = (key, window, kind, measure, extra = {}) => Number.isFinite(row[key]) && push({ kind, value: kind === 'pct' ? row[key] * 100 : row[key], window, source: 'leaderboard', origin: 'row', measure, ...extra });
    lb('week_pnl_usd', '7d', 'money', 'PnL');
    lb('month_pnl_usd', '30d', 'money', 'PnL');
    lb('all_time_pnl_usd', 'all', 'money', 'PnL');
    lb('account_value_usd', 'now', 'money', 'account value', { unsigned: true });
    lb('month_volume_usd', '30d', 'money', 'volume', { unsigned: true });
    lb('week_roi', '7d', 'pct', 'ROI');
    lb('month_roi', '30d', 'pct', 'ROI');
    lb('all_time_roi', 'all', 'pct', 'ROI');
  }
  return facts;
}

/** Whether a typed figure has a fact's value, within the precision it was typed to. */
function sameValue(fig, fact) {
  if (fig.kind !== fact.kind) return false;
  const signed = fact.kind === 'money' && !fact.unsigned;
  const typed = signed && fig.sign === '-' ? -fig.n : fig.n;
  const v = signed ? fact.value : Math.abs(fact.value);
  if (fig.kind === 'money' && !signed && fig.sign === '-') return false;
  if (fig.mode === 'ge') return Math.sign(v) === Math.sign(typed || 1) && Math.abs(v) >= Math.abs(typed) * 0.999;
  if (fig.mode === 'le') return Math.sign(v) === Math.sign(typed || 1) && Math.abs(v) <= Math.abs(typed);
  const diff = Math.abs(v - typed);
  if (fig.kind === 'pct') return diff <= (fig.mode === 'approx' ? Math.max(fig.unit, 1) : fig.unit) + 1e-9;
  const cap = Math.max(1, 0.05 * Math.abs(v));
  const tol = fig.mode === 'approx' ? Math.max(Math.min(fig.unit, cap), 0.1 * Math.abs(v)) : Math.max(1, Math.min(fig.unit, cap));
  return diff <= tol + 1e-9;
}

/**
 * Every other roster wallet's visible figures (its tile and offered cards), so a figure borrowed
 * from another trader is named as theirs. `{ name, facts }` per wallet.
 */
export function othersFrom(list) {
  return (list ?? []).map(({ name, dossier, data }) => ({ name, facts: ledgerOf(dossier, data).filter(f => f.visible) }));
}

// ------------------------------------------------------------------------------------ the ruling

const listed = xs => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}` : xs[0]);
const spent = s => `Referee: ${s} The line is spent.`;
const aFigure = w => (w === 'all' ? 'an all-time figure' : w === 'now' ? 'the account value' : `a ${DAYS[w]} figure`);
const RANK = f => (f.visible ? (f.origin === 'card' ? 0 : f.origin === 'tile' ? 1 : 2) : 3);

/**
 * The deterministic strike for a line, or null when every figure it types is a fact stated as the
 * record states it (or no figure at all). `others` is othersFrom(...) for the rest of the roster.
 */
export function attributionStrike(text, dossier, data, { others = [] } = {}) {
  const t = String(text ?? '');
  const figs = extractFigures(t);
  if (!figs.length) return null;
  const facts = ledgerOf(dossier, data);
  const coins = [...new Set([...facts.map(f => f.coin), ...others.flatMap(o => o.facts.map(f => f.coin))].filter(Boolean))];
  const windows = windowsFor(t, figs);
  const sources = sourcesFor(t, figs);
  const coinOf = coinsFor(t, figs, coins);

  const problems = [];
  figs.forEach((fig, i) => {
    const W = windows[i];
    const S = sources[i];
    const coin = coinOf[i];
    const clause = bounds(t, true)(fig.at);
    const words = t.slice(clause[0], clause[1]);
    const pnlWord = PNL_WORDS.test(words);
    // An allocation the player asks for is not a claim about the record.
    if (ALLOCATION_BEFORE.test(t.slice(Math.max(0, fig.at - 40), fig.at)) || ALLOCATION_AFTER.test(t.slice(fig.end)) || (fig.kind === 'money' && fig.n === 25000)) return;
    const hits = facts.filter(f => sameValue(fig, f));
    if (!hits.length) {
      if (S === 'leaderboard' && fig.kind !== 'money') { problems.push({ type: 'lbNo', fig }); return; }
      const theirs = others.map(o => ({ name: o.name, f: [...o.facts].sort((a, b) => (a.origin === 'tile' ? -1 : 1) - (b.origin === 'tile' ? -1 : 1)).find(f => sameValue(fig, f)) })).find(x => x.f);
      problems.push(theirs ? { type: 'theirs', fig, ...theirs } : { type: 'absent', fig });
      return;
    }
    const passes = f => (W === null || f.window === W || (f.window === 'now' && W === 'now'))
      && (S === null || f.source === S)
      && (coin === null ? true : f.coin === coin)
      && !(f.measure === 'account value' && W === null && pnlWord)
      && !(f.measure === 'winning trade count' && !fig.winning) && !(fig.winning && f.measure !== 'winning trade count')
      && !(S === 'leaderboard' && f.source === 'leaderboard' && fig.kind === 'pct' && /win rate/i.test(words) && f.measure === 'ROI');
    if (hits.some(passes)) return;
    const c = [...hits].sort((a, b) => RANK(a) - RANK(b))[0];
    const windowBad = W !== null && c.window !== W;
    const sourceBad = S !== null && c.source !== S;
    if (!c.visible) {
      if (S === 'leaderboard' && fig.kind !== 'money') { problems.push({ type: 'lbNo', fig }); return; }
      problems.push({ type: 'sealed', fig, W, S, coin });
      return;
    }
    if (coin !== null && c.coin !== coin && !windowBad && !sourceBad) { problems.push({ type: 'coin', fig, c, coin }); return; }
    if (c.origin === 'card' && c.source === 'Nansen') {
      if (windowBad && !sourceBad) problems.push({ type: 'cardWindow', fig, c, W });
      else if (sourceBad && !windowBad) problems.push({ type: 'nansenAsLb', fig, c });
      else if (windowBad) problems.push({ type: 'one', fig, text: `${fig.typed} is Nansen's ${c.desc}, not a leaderboard ${DAYS[W]} figure.` });
      else problems.push({ type: 'one', fig, text: `${fig.typed} is Nansen's ${c.desc}, not ${pnlWord ? 'PnL' : 'the figure the line says'}.` });
      return;
    }
    if (c.origin === 'tile' && c.source === 'Nansen' && sourceBad && !windowBad) { problems.push({ type: 'nansenAsLb', fig, c }); return; }
    // A leaderboard card, or any tile figure: named with its own window and source.
    const what = c.origin === 'card' ? `the Hyperliquid leaderboard's ${c.desc}` : `the tile's ${publishedDesc(c.tile)}`;
    const claimW = W ?? (['7d', '30d'].includes(c.window) ? c.window : null);
    const claim = windowBad && sourceBad ? `a ${S === 'Nansen' ? 'Nansen' : 'leaderboard'} ${DAYS[W]} figure`
      : windowBad ? aFigure(W)
      : sourceBad ? (S === 'Nansen' ? (claimW && c.origin === 'tile' ? `Nansen's; Nansen's ${DAYS[claimW]} summary is a different figure` : 'a Nansen figure') : 'a leaderboard figure')
      : c.measure === 'account value' ? 'PnL' : 'the figure the line says';
    problems.push({ type: 'one', fig, text: `${fig.typed} is ${what}, not ${claim}.` });
  });
  if (!problems.length) return null;

  const first = type => problems.find(p => p.type === type);
  const absent = first('absent');
  if (absent) return spent(`${absent.fig.typed} is not in the record.`);
  const theirs = first('theirs');
  if (theirs) {
    const f = theirs.f;
    const desc = f.origin === 'tile' ? publishedDesc(f.tile) : f.coin ? `Nansen 30-day ${f.coin} PnL` : `${f.source === 'Nansen' ? 'Nansen' : 'Hyperliquid leaderboard'} ${f.desc}`;
    return spent(`${theirs.fig.typed} is ${theirs.name}'s ${desc}, not this trader's.`);
  }
  const cw = first('cardWindow');
  if (cw) {
    const group = problems.filter(p => p.type === 'cardWindow' && p.W === cw.W && p.c.window === cw.c.window).map(p => p.fig.typed);
    const many = group.length > 1;
    return spent(`${listed(group)} ${many ? 'are' : 'is'} ${many ? '' : 'a '}${DAYS[cw.c.window]} figure${many ? 's' : ''}, not ${DAYS[cw.W]}.`.replace('is a all-time', 'is an all-time'));
  }
  const one = first('one');
  if (one) return spent(one.text);
  const nl = problems.filter(p => p.type === 'nansenAsLb');
  if (nl.length) {
    const said = nl.map(p => `${p.fig.typed} is Nansen's ${p.c.desc}`);
    return spent(said.length === 1 ? `${said[0]}, not a leaderboard figure.` : `${listed(said)}; the leaderboard publishes ${said.length === 2 ? 'neither' : 'none of them'}.`);
  }
  const lbNo = first('lbNo');
  if (lbNo) return spent(`${lbNo.fig.typed} is not a leaderboard figure: the Hyperliquid leaderboard publishes no ${lbNo.fig.kind === 'pct' ? 'win rate' : 'trade count'}.`);
  const coin = first('coin');
  if (coin) return spent(`${coin.fig.typed} is ${coin.c.coin ? `${coin.c.coin}'s 30-day PnL` : `the ${coin.c.desc}`}, not ${coin.coin}'s.`);
  const sealed = first('sealed');
  const whose = sealed.S === 'Nansen' ? "Nansen's" : sealed.S === 'leaderboard' ? "the leaderboard's" : 'the';
  const w = sealed.W ? `${DAYS[sealed.W]} ` : sealed.coin ? `${sealed.coin} ` : '';
  return spent(`${sealed.fig.typed} is not ${whose} ${w}figure${sealed.S ? '' : ' in the record'}.`);
}
