/**
 * The Pitch Room's deterministic referee (judge 10, 26 Sep 2026; judge 11, 26 Sep 2026).
 *
 * Judge 10 found false lines standing on the live build: "Nansen's 7-day summary shows +$594,869"
 * (a leaderboard figure), "The Hyperliquid leaderboard shows a 92.3% win rate" (Nansen's), a 7-day
 * figure said over 30 days. The source and window rules ran only after the model checker rejected,
 * and one way round. Here they run on every line, before the model is asked, and nothing the model
 * says can undo a strike.
 *
 * Judge 11 found the referee checked a figure's value but not what the value measures: TAO's 30-day
 * PnL passed as the wallet's total, the account value passed as profit, "90 days" and "Arkham" were
 * read as no window and no source. The referee is now a whitelist: a figure stands only when every
 * measure, coin, window, source and wallet cue in its own clause matches a published fact.
 *
 * The round's record is a ledger of facts: {kind, value, measure, window, source, coin, visible},
 * built from the fact cards, every figure the tile prints, the round's two Nansen summaries and the
 * trader's public leaderboard row. For each figure a line types, the referee reads the window,
 * source, coin and measure the line gives that figure (its own words first, then its clause, then
 * its part of the sentence, then a figure-less sentence just before it), finds the facts of this
 * wallet with that value, and strikes when none of them was stated that way. A value no fact of
 * this wallet holds is named as another trader's figure when it is one, else "not in the record". A
 * sealed figure is never confirmed or placed: the strike says only what the line claimed that is
 * not so.
 */

// ------------------------------------------------------------------ figures as a player types them

const SUFFIX = '(?:k|m|mm|bn|million|thousand|grand|billion)';
const MULT = { k: 1e3, thousand: 1e3, grand: 1e3, m: 1e6, mm: 1e6, million: 1e6, bn: 1e9, billion: 1e9 };
const COUNT_RE = new RegExp(`(?<![\\w$.,])(\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.(\\d+))?(\\s?k)?\\s+((?:closed|winning)\\s+)?trades?\\b`, 'gi');
const COIN_COUNT_RE = /(?<![\w$.,])(\d{1,3})\s+(?:different\s+|distinct\s+)?(?:coins|markets|assets|tokens|tickers)\b/gi;
const PCT_RE = /(?<![\w.,])([+-])?(\d+(?:\.\d+)?)\s?%/g;
const MONEY_RE = new RegExp(`([+-])?\\$\\s?([+-])?(\\d(?:[\\d,]*\\d)?(?:\\.\\d+)?)(?:\\s?(${SUFFIX})\\b)?`, 'gi');
const BARE_RE = new RegExp(`(?<![\\w$.,+-])([+-])?(\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?(?=\\s?${SUFFIX}\\b))(?:\\s?(${SUFFIX})\\b)?`, 'gi');
// Judge 11: money typed with no "$" and no commas: "9999999 USDC", "594869", "250 dollars".
const PLAIN_RE = /(?<![\w$.,:+-])([+-])?(\d{4,}(?:\.\d+)?|\d+(?:\.\d+)?(?=\s?(?:usd[ct]?|dollars|bucks)\b))(?:\s?(usd[ct]?|dollars|bucks)\b)?/gi;
/** A bare number followed by one of these is not a dollar figure. */
const NOT_MONEY_AFTER = /^\s*(?:closed\s+|winning\s+)?(?:trades?|fills?|days?|hours?|minutes?|weeks?|months?|years?|wallets?|markets?|coins?|times|x\b|users?|traders?|people|accounts?|orders?|%|percent|bps)/i;

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
 * A count carries `what`: 'trade count', 'winning trade count' or 'coin count'.
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
    const winning = /winning/i.test(m[4] ?? '');
    add(m, { typed: `${m[1]}${m[2] ? `.${m[2]}` : ''}${m[3] ? 'k' : ''} trades`, kind: 'count', n, unit: unitOf(digits, m[2], mult), winning, what: winning ? 'winning trade count' : 'trade count' });
  }
  for (const m of t.matchAll(COIN_COUNT_RE)) {
    add(m, { typed: m[0].trim(), kind: 'count', n: Number(m[1]), unit: 1, winning: false, what: 'coin count' });
  }
  for (const m of t.matchAll(PCT_RE)) {
    const n = Number(m[2]) * (m[1] === '-' ? -1 : 1);
    add(m, { typed: m[0].replace(/\s+/g, ''), kind: 'pct', n, unit: unitOf(m[2].split('.')[0], m[2].split('.')[1], 1, false) });
  }
  const money = (m, signA, signB, body, suffix) => {
    const [int, dec] = body.replace(/,/g, '').split('.');
    const mult = suffix && MULT[suffix.toLowerCase()] ? MULT[suffix.toLowerCase()] : 1;
    const sign = signA || signB || null;
    const n = Number(`${int}${dec ? `.${dec}` : ''}`) * mult;
    add(m, { typed: m[0].trim().replace(/,$/, ''), kind: 'money', n, sign, unit: unitOf(int, dec, mult) });
  };
  for (const m of t.matchAll(MONEY_RE)) money(m, m[1], m[2], m[3], m[4]);
  for (const m of t.matchAll(BARE_RE)) {
    if (!m[3] && NOT_MONEY_AFTER.test(t.slice(m.index + m[0].length))) continue;
    money(m, m[1], null, m[2], m[3]);
  }
  for (const m of t.matchAll(PLAIN_RE)) {
    const body = m[2];
    if (!m[3] && NOT_MONEY_AFTER.test(t.slice(m.index + m[0].length))) continue;
    // A year ("since 2024") is not money.
    if (!m[3] && !m[1] && /^(?:19|20)\d\d$/.test(body)) continue;
    money(m, m[1], null, body, null);
  }
  out.sort((a, b) => a.at - b.at);
  for (const f of out) {
    const before = t.slice(Math.max(0, f.at - 24), f.at).toLowerCase();
    f.mode = /(?:about|around|roughly|nearly|almost|approximately|approx\.?|close to|some|~|just (?:under|over|shy of|below|above))\s*$/.test(before) ? 'approx'
      : /(?:over|more than|above|north of|at least|upwards of|in excess of|>)\s*$/.test(before) ? 'ge'
      : /(?:under|less than|below|at most|south of|fewer than|<)\s*$/.test(before) ? 'le' : 'eq';
    if (f.kind === 'money' && !f.sign) {
      const after = t.slice(f.end, f.end + 20).toLowerCase();
      f.sign = /\b(?:lost|losing|loss of|down|minus|negative)\s*$/.test(before) || /^\s*(?:loss|in losses|down|in the red)\b/.test(after) ? '-' : null;
    }
  }
  return out;
}

// ---------------------------------------------------------------------- where each figure sits

const DAYS = { '7d': '7-day', '30d': '30-day', all: 'all-time', now: 'current' };
const NUM_WORDS = 'one|two|three|four|five|six|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|twenty|forty|forty-five|sixty|ninety|hundred|a|a few|few|couple of|a couple of';
const WINDOW_CUES = [
  ['7d', /\b(?:7|seven)[- ]?days?\b|\b7d\b|\b(?:one|1)[- ]week\b|\bweek(?:ly|'s)?\b/gi],
  ['30d', /\b(?:30|thirty)[- ]?days?\b|\b30d\b|\b(?:one|1)[- ]month\b|\bmonth(?:ly|'s)?\b/gi],
  ['all', /\ball[- ]time\b|\blifetime\b|\bsince (?:inception|launch|day one)\b/gi],
  ['now', /\baccount(?:\s+value)?\b|\bbalance\b|\bequity\b/gi],
  // Judge 11: any other window is a window the record does not hold ("90 days", "today", "this year").
  ['other', new RegExp(`(?<![\\d,.$+-])\\b(?:\\d+|${NUM_WORDS})[- ]?(?:days?|weeks?|months?|years?|hours?|hrs?|quarters?)\\b|(?<![\\d,.$+-])\\b\\d+[dh]\\b|\\btoday(?:'s)?\\b|\\byesterday(?:'s)?\\b|\\btonight\\b|\\b(?:this|last|past|the) (?:year|quarter|fortnight)\\b|\\bytd\\b|\\byear[- ]to[- ]date\\b|\\bfortnight\\b|\\bquarter(?:ly)?\\b|\\bdaily\\b|\\b(?:per|a|each) day\\b|\\bannual(?:ly|i[sz]ed)?\\b|\\bper (?:year|annum)\\b|\\b(?:in|since|during|for|through|throughout) (?:january|february|march|april|may|june|july|august|september|october|november|december)\\b|\\b(?:in|since|during|for|through|throughout|all of) (?:19|20)\\d\\d\\b`, 'gi')],
];
/** Whether an 'other' window phrase is really one of the record's own ("7 days", "30 days", "a week"). */
const KNOWN_WINDOW = /^(?:(?:7|seven)[- ]?days?|(?:30|thirty)[- ]?days?|(?:one|1|a)[- ]?(?:week|month)|7d|30d)$/i;
const SOURCE_CUES = [
  ['Nansen', /\bnansen(?:'s)?\b/gi],
  ['leaderboard', /\bleaderboard(?:'s)?\b|\bhyperliquid(?:'s)?\s+(?:shows?|says|lists|reports?|ranks?|has|puts|page|row|stats|data|profile|numbers)\b|\b(?:per|according to|from|via)\s+hyperliquid\b/gi],
  // Judge 11: a platform the record was not read from is a wrong source, never no source.
  ['other', /\b(?:arkham|debank|dune|etherscan|arbiscan|zapper|zerion|coinglass|hyperdash|hypurrscan|hyperliquid ?explorer|dexscreener|coingecko|coinmarketcap|lookonchain|birdeye|defillama|dappradar|messari|glassnode|santiment|kaiko|token terminal|bubblemaps|cielo|copin|twitter|telegram|discord|binance|bybit|okx|bloomberg|reuters)(?:'s)?\b/gi],
];
// A capitalised name owning a data product ("Foo's dashboard") is a source too, unless it is ours.
const OWNED_SOURCE = /\b([A-Z][\w.-]+)'s\s+(?:dashboard|data|page|stats|numbers|profile|tracker|summary|report|feed|analytics|terminal|screener|tool|app|site|api)\b/g;
const NOT_A_SOURCE = /^(?:Nansen|Hyperliquid|His|Her|Their|Its|The|This|That|My|Our|Your|He|She|It|Hand|Legend|Streak|Deal|Grinder|Trader|Wallet|PENNY|Penny|BAIT|Bait)$/;
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

const JOIN = /,\s*(?:and|but|while|whereas|plus|yet|though|although|so)\b|;/gi;
// A verb that starts a new statement after ", and": "…, and FARTCOIN alone made +$X", "…, and Nansen confirms it".
const STATEMENT = /\b(?:made|makes|making|show|shows|showed|shown|says|said|is|was|are|were|has|had|have|earned|earns|lost|loses|booked|banked|posted|logged|recorded|listed|puts|put|confirms|confirmed|reported|counted|won|closed|traded|pulled|returned|gained|netted|labels|labelled|labeled|ranked|sits|sat|agrees|agreed|did|does|went|goes|took|takes|got|gets|pulls|cleared|delivered|backs|backed)\b/i;

/**
 * Judge 11: a sentence's parts. Two statements joined with ", and" / ", but" / "; " are two claims:
 * "+$118,975,612 on the leaderboard, and FARTCOIN alone made +$317,857" credits nothing of the
 * second to the leaderboard.
 */
function segments(t) {
  const sentence = bounds(t, false);
  // A comma join splits only when a new statement follows (it has its own verb); a list
  // ("the leaderboard shows A, B, and C") stays one claim. A semicolon always splits.
  const joins = [...t.matchAll(JOIN)]
    .filter(m => m[0] === ';' || STATEMENT.test(t.slice(m.index + m[0].length).split(/[.!?;·|\n]/)[0].split(JOIN)[0]))
    .map(m => m.index);
  return pos => {
    let [a, b] = sentence(pos);
    for (const j of joins) {
      if (j >= a && j < pos) a = j + 1;
      if (j >= pos && j < b) b = j;
    }
    return [a, b];
  };
}

function cuesIn(t, table) {
  const out = [];
  for (const [cls, re] of table) {
    for (const m of t.matchAll(re)) {
      if (cls === 'other' && table === WINDOW_CUES && KNOWN_WINDOW.test(m[0].trim())) continue;
      out.push({ cls: cls === 'other' ? `other:${m[0].trim()}` : cls, at: m.index, end: m.index + m[0].length, fwd: LINKING.test(t.slice(m.index + m[0].length)) });
    }
  }
  if (table === SOURCE_CUES) {
    for (const m of t.matchAll(OWNED_SOURCE)) {
      if (NOT_A_SOURCE.test(m[1]) || /^(?:nansen|hyperliquid)/i.test(m[1])) continue;
      out.push({ cls: `other:${m[1]}`, at: m.index, end: m.index + m[0].length, fwd: false });
    }
  }
  // A cue inside a longer cue ("week" in "3 weeks") is that cue.
  const sorted = out.sort((a, b) => a.at - b.at || (b.end - b.at) - (a.end - a.at));
  return sorted.filter((c, i) => !sorted.some((d, j) => j !== i && d.at <= c.at && d.end >= c.end && (d.end - d.at) > (c.end - c.at)));
}

const oneClass = cues => {
  const set = [...new Set(cues.map(c => c.cls))];
  return set.length === 1 ? set[0] : set.length ? 'many' : null;
};

/** The figure-less sentence just before a figure's sentence, if any: "Pull up Nansen's 30-day summary. +$X." */
function leadIn(t, figs, pos) {
  const sentence = bounds(t, false);
  const [a] = sentence(pos);
  if (a <= 0) return null;
  const prev = sentence(a - 1);
  return figs.some(f => f.at >= prev[0] && f.end <= prev[1]) ? null : prev;
}

/** Which window each figure is claimed over: its bound cue, else its clause, else its part of the sentence. */
function windowsFor(t, figs) {
  const cues = cuesIn(t, WINDOW_CUES);
  const clause = bounds(t, true);
  const segment = segments(t);
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
  const within = range => (range ? cues.filter(c => c.at >= range[0] && c.end <= range[1]) : []);
  return figs.map(f => {
    // Never from another sentence with figures: "+$X this week. 53.9% win rate." says nothing about the 53.9%'s window.
    const sets = [bound.get(f), within(clause(f.at)), within(segment(f.at))];
    if (!within(sentence(f.at)).length) sets.push(within(leadIn(t, figs, f.at)));
    for (const set of sets) {
      const cls = oneClass(set);
      if (cls === 'many') {
        const other = set.find(c => c.cls.startsWith('other:'));
        return other ? other.cls : null;
      }
      if (cls) return cls;
    }
    return null;
  });
}

/** Which source each figure is credited to: its clause, else its part of the sentence, else a lead-in sentence. */
function sourcesFor(t, figs) {
  const cues = cuesIn(t, SOURCE_CUES);
  const clause = bounds(t, true);
  const segment = segments(t);
  const sentence = bounds(t, false);
  const pick = (set, f) => {
    const cls = oneClass(set);
    if (cls !== 'many') return cls;
    return (set.filter(c => c.end <= f.at).at(-1) ?? set.find(c => c.at >= f.end)).cls;
  };
  return figs.map(f => {
    const ranges = [clause(f.at), segment(f.at)];
    if (!cues.some(c => c.at >= sentence(f.at)[0] && c.end <= sentence(f.at)[1])) ranges.push(leadIn(t, figs, f.at));
    for (const range of ranges) {
      if (!range) continue;
      const set = cues.filter(c => c.at >= range[0] && c.end <= range[1]);
      if (set.length) return pick(set, f);
    }
    return null;
  });
}

/**
 * Judge 11: sources a figure is also credited to by words with no figure of their own: "+$X this week
 * on the leaderboard, and Nansen confirms it" (a part of its sentence), or "+$X this week. Nansen
 * confirms it." (the sentence right after it).
 */
function echoSourcesFor(t, figs) {
  const cues = cuesIn(t, SOURCE_CUES);
  const segment = segments(t);
  const sentence = bounds(t, false);
  const has = ([a, b]) => figs.some(f => f.at >= a && f.end <= b);
  return figs.map(f => {
    const [sa, sb] = sentence(f.at);
    const out = new Set();
    for (const c of cues) {
      if (c.at >= sa && c.end <= sb && !has(segment(c.at))) out.add(c.cls);
      else if (c.at > sb) {
        const next = sentence(c.at);
        if (sentence(next[0] - 1)[0] === sa && next[0] > sb && !has(next)) out.add(c.cls);
      }
    }
    return [...out];
  });
}

// Words in capitals that are not coins.
const NOT_COINS = new Set(('PNL ROI USD USDC USDT HL AI PENNY BAIT UTC THE STREAK LEGEND GRINDER REAL DEAL STEADY HAND OK ATH ATL TVL DEX CEX APR APY '
  + 'YTD NOT NO ALL TIME WR KOL CEO US EU UK SEP AUG OCT NOV DEC JAN FEB MAR APR MAY JUN JUL NFA DYOR LFG GM WAGMI NGMI IMO TBH FUND SMART MONEY NANSEN '
  + 'HYPERLIQUID MM BN FOMO PERP PERPS HE HIS SHE IT IS IN ON UP BIG AND OR TO OF A I P L K M').split(' '));
const TICKER_CONTEXT = /\b(?:on|in|from|trading|with)\s+([A-Z][A-Z0-9]{1,9})\b|\b([A-Z][A-Z0-9]{1,9})\s+(?:alone|only|longs?|shorts?|trades?|positions?|made|pnl|profit|market)\b/g;

/** The coin a figure is said to be about: a coin named in its clause, nearest figure only. */
function coinsFor(t, figs, coins) {
  const clause = bounds(t, true);
  const named = [];
  const bare = c => c.replace(/^[a-z0-9]+:/, '');
  const known = new Map(coins.map(c => [bare(c).replace(/[^A-Za-z0-9]/g, ''), c]).filter(([k]) => k));
  if (known.size) {
    const re = new RegExp(`\\b(?:[a-z0-9]+:)?(${[...known.keys()].join('|')})\\b`, 'g');
    for (const m of t.matchAll(re)) named.push({ coin: known.get(m[1]), at: m.index });
  }
  for (const m of t.matchAll(TICKER_CONTEXT)) {
    const tick = m[1] ?? m[2];
    if (NOT_COINS.has(tick) || known.has(tick)) continue;
    named.push({ coin: tick, at: m.index + m[0].indexOf(tick) });
  }
  return figs.map(f => {
    const [a, b] = clause(f.at);
    const here = named.filter(c => c.at >= a && c.at <= b).sort((x, y) => x.at - y.at);
    if (!here.length) return null;
    const c = here[0];
    const inClause = figs.filter(g => g.at >= a && g.end <= b);
    const nearest = inClause.reduce((x, g) => (Math.abs(g.at - c.at) < Math.abs(x.at - c.at) ? g : x));
    return nearest === f ? c.coin : null;
  });
}

const PNL_WORDS = /\b(?:made|making|profit|profits|pnl|p&l|realised|realized|earned|gain(?:ed|s)?|up)\b/i;
// Judge 11: what each typed figure measures, from the words nearest it in its clause.
const MONEY_MEASURES = [
  ['account value', /\baccount(?:\s+value)?\b|\bbalance\b|\bequity\b|\baum\b|\bnet worth\b|\bportfolio value\b|\bbankroll\b/gi],
  ['volume', /\bvolume\b|\bturnover\b|\bnotional traded\b/gi],
  ['fees', /\bfees?\b/gi],
  ['position', /\bpositions?\b|\bexposure\b|\bnotional\b|\bbag\b/gi],
  ['pnl', /\b(?:made|making|makes|profit|profits|pnl|p&l|realised|realized|earned|earns|gain(?:ed|s)?|up|lost|loss|losses|down|net|return(?:ed)?|pulled|banked|cleared)\b/gi],
];
const PCT_MEASURES = [
  ['win rate', /\bwin(?:ning)?[- ]?(?:rate|ratio|%)|\bhit[- ]rate\b|\bstrike rate\b|\bwins?\b|\bwon\b/gi],
  ['return', /\broi\b|\breturns?\b|\byield\b|\bgain\b|\bup\b/gi],
];
function measureOf(t, fig, clause) {
  if (fig.kind === 'count') return fig.what;
  const table = fig.kind === 'money' ? MONEY_MEASURES : PCT_MEASURES;
  const [a, b] = clause;
  let best = null;
  for (const [m, re] of table) {
    for (const x of t.slice(a, b).matchAll(re)) {
      const at = a + x.index;
      const d = at >= fig.end ? at - fig.end : at < fig.at ? fig.at - (at + x[0].length) : 0;
      if (!best || d < best.d) best = { m, d };
    }
  }
  if (fig.kind === 'money') return best?.m ?? 'pnl';
  return best?.m ?? null;
}
/** A fact's measure family: realised, market, leaderboard and all-time PnL are all PnL. */
const family = f => (/pnl/i.test(f.measure) || f.measure === 'figure' ? 'pnl' : f.measure === 'ROI' ? 'return' : f.measure);

const ALLOCATION_BEFORE = /\b(?:send|sending|wire|wiring|allocate|allocating|give|giving|put|putting|commit|stake|bet|risk|invest|deploy|try|start with|ask(?:ing)? for|request(?:ing)?)\s+(?:(?:him|her|them|me|us|it|a|an|the|just|only|about|around|maybe)\s+){0,2}$/i;
const ALLOCATION_AFTER = /^\s*(?:of (?:the|your|my|our) (?:fund|book|bankroll|slot|capital|money|\$25,000)|allocation|ticket|probe|test|trial|stake|bet|to (?:start|test|try))\b/i;
// PENNY's slot is a published fact of the game; it is the only $25,000 a line may name freely.
const SLOT_BEFORE = /\b(?:of|from|out of|in)\s+(?:the|your|my|our|its|his|her|a|this)\s*$|\b(?:your|my|our|the|its|whole|full|entire)\s*$/i;
const SLOT_AFTER = /^\s*(?:slot|fund|budget|bankroll|book|allocation|mandate|limit|cap|max(?:imum)?|pot|stack)\b/i;

// ---------------------------------------------------------------------------- the round's facts

const coinName = label => String(label ?? '').split(',')[0].trim();
const CARD = {
  'week-pnl': { window: '7d', money: '7-day realised PnL' },
  'week-wins': { window: '7d', pct: '7-day win rate', count: '7-day trade count' },
  'month-wins': { window: '30d', pct: '30-day win rate', count: '30-day trade count' },
  'best-market': { window: '30d' },
  'all-time': { window: 'all', money: 'all-time PnL' },
};

/** What a tile entry measures: its `what`, else the account value for the "now" figure, else from its claim. */
const tileMeasure = (e, kind) => e.what
  ?? (e.span === 'now' ? 'account value'
    : kind === 'pct' ? (/win rate/i.test(e.claim ?? '') ? 'win rate' : 'return')
      : kind === 'count' ? 'trade count' : 'PnL');

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
        else if (/count$|^traded_times$/.test(key)) {
          push({ ...base, kind: 'count', value: v, measure: key === 'winning_trade_count' ? 'winning trade count' : key === 'traded_coin_count' ? 'coin count' : key === 'traded_times' ? 'fill count' : 'trade count' });
        }
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
      const measure = tileMeasure(e, fig.kind);
      push({ kind: fig.kind, value: fig.kind === 'money' && fig.sign === '-' ? -fig.n : fig.n, window: e.span, source: e.from === 'Nansen' ? 'Nansen' : 'leaderboard', origin: 'tile', tile: e,
        measure, unsigned: e.span === 'now', visible: true,
        desc: `${DAYS[e.span] && e.span !== 'now' ? `${DAYS[e.span]} ` : ''}${measure === 'PnL' ? 'figure' : measure} on the tile` });
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
function sameValue(fig, fact, { flip = false } = {}) {
  if (fig.kind !== fact.kind) return false;
  const signed = fact.kind === 'money' && !fact.unsigned;
  const neg = (fig.sign === '-') !== flip;
  const typed = signed && neg ? -fig.n : fig.n;
  const v = signed ? fact.value : Math.abs(fact.value);
  if (fig.kind === 'money' && !signed && neg) return false;
  if (fig.mode === 'ge') return Math.sign(v) === Math.sign(typed || 1) && Math.abs(v) >= Math.abs(typed) * 0.999;
  if (fig.mode === 'le') return Math.sign(v) === Math.sign(typed || 1) && Math.abs(v) <= Math.abs(typed);
  const diff = Math.abs(v - typed);
  if (fig.kind === 'pct') return diff <= (fig.mode === 'approx' ? Math.max(fig.unit, 1) : fig.unit) + 1e-9;
  if (fig.kind === 'count' && fig.mode === 'eq') return diff <= Math.max(fig.unit, 1) / 2 + 1e-9 || diff < 1e-9;
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

// ------------------------------------------------------------------------ claims with no figure

// Judge 11: "Nansen labels this wallet a Smart Money fund" is a claim about the record's labels.
const LABEL_CLAIM = [
  /\b(?:label\w*|tag\w*|flag\w*|classif\w*|list(?:s|ed)|mark(?:s|ed)|call(?:s|ed)|nam(?:es|ed)|rank(?:s|ed)|counts?|recogni[sz]\w*|identif\w*)\b[^.;!?]{0,40}?\bsmart[- ]money\b/i,
  /\b(?:is|he's|she's|it's|was|are|a|an)\s+(?:(?:a|an|the|certified|official|verified|known|labell?ed|nansen|nansen-labell?ed)\s+){0,2}smart[- ]money\b(?!\s+(?:is|was|are|has|holds|sits|went|goes|buys|sells|flows?))/i,
  /\bsmart[- ]money\s+(?:fund|wallet|trader|whale|label|tag|address|account|entity|status|badge)\b/i,
  /\b(?:label\w*|tag\w*|classif\w*)\b[^.;!?]{0,40}?\b(?:fund|vc|institution\w*|market maker)\b/i,
];
// "not a single losing trade", "never lost", "no losses this month".
const LOSSLESS = /\b(?:not (?:a )?single|not one|no|zero|without (?:a|any))\s+(?:single\s+)?(?:losing|losses|loss|red)\b|\bnever\s+(?:\w+\s+){0,2}(?:lost|loses|losing|a loss|a losing|red)\b|\b(?:has not|hasn't|did not|didn't|does not|doesn't|have not|haven't)\s+(?:\w+\s+){0,3}(?:losing|lost|a loss|any losses)\b|\bundefeated\b|\bperfect (?:record|win rate|track record)\b|\bwins? every (?:single )?(?:trade|time)\b|\bonly (?:ever )?wins\b/i;
const SAYS_7D = /\b(?:7|seven)[- ]?(?:days?|d)\b|\b(?:this|last|past|one|a|in a|the) week\b|\bweekly\b/i;
const SAYS_30D = /\b(?:30|thirty)[- ]?(?:days?|d)\b|\b(?:this|last|past|one|a|in a|the) month\b|\bmonthly\b/i;

function labelsOf(dossier, data) {
  const out = [];
  for (const v of [dossier?.labels, data?.labels, data?.label, dossier?.label]) {
    if (Array.isArray(v)) out.push(...v.map(x => String(x?.label ?? x)));
    else if (typeof v === 'string') out.push(v);
  }
  return out;
}

/** The strike for a claim with no figure the ledger can check cheaply, or null. */
function claimStrike(t, dossier, data) {
  if (LABEL_CLAIM.some(re => re.test(t))) {
    const labels = labelsOf(dossier, data);
    const smart = /smart[- ]money/i.test(t);
    const has = labels.some(l => (smart ? /smart[- ]money/i : /fund|vc|institution|market maker/i).test(l));
    if (!has) return smart ? 'nothing in the record labels this wallet Smart Money.' : 'nothing in the record labels this wallet a fund.';
  }
  if (LOSSLESS.test(t)) {
    const seven = SAYS_7D.test(t);
    const thirty = SAYS_30D.test(t);
    const windows = seven && !thirty ? ['7d'] : thirty && !seven ? ['30d'] : ['30d', '7d'];
    for (const w of windows) {
      const rate = data?.[w === '7d' ? 'pnl_summary_7d' : 'pnl_summary_30d']?.win_rate;
      if (Number.isFinite(rate) && rate < 1) return `the line claims no losses, but Nansen's ${DAYS[w]} win rate is below 100%: trades were lost.`;
    }
  }
  return null;
}

// ------------------------------------------------------------------------------------ the ruling

const listed = xs => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}` : xs[0]);
const spent = s => `Referee: ${s} The line is spent.`;
const isOther = x => typeof x === 'string' && x.startsWith('other:');
const otherText = x => x.slice(6);
/** "90 days" is "90-day"; "today" stays "today". */
const dayWord = W => {
  if (!isOther(W)) return DAYS[W];
  const m = otherText(W).match(new RegExp(`^(\\d+|${NUM_WORDS})[- ]?(day|week|month|year|hour|hr|quarter|d|h)s?$`, 'i'));
  if (m) return `${m[1]}-${{ d: 'day', h: 'hour', hr: 'hour' }[m[2].toLowerCase()] ?? m[2].toLowerCase()}`;
  return null;
};
const aFigure = W => {
  if (isOther(W)) {
    if (dayWord(W)) return `a ${dayWord(W)} figure`;
    const phrase = otherText(W).toLowerCase().replace(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/, m => m[0].toUpperCase() + m.slice(1));
    return /^since /.test(phrase) ? `a figure ${phrase}` : `a figure for ${phrase.replace(/^(?:in|during|for|through|throughout|all of) /, '')}`;
  }
  return W === 'all' ? 'an all-time figure' : W === 'now' ? 'the account value' : `a ${DAYS[W]} figure`;
};
const an = w => (/^[aeiou]/i.test(w) ? `an ${w}` : `a ${w}`);
const srcName = S => (S === 'Nansen' ? 'Nansen' : S === 'leaderboard' ? 'leaderboard' : otherText(S).replace(/'s$/, '').replace(/^\w/, c => c.toUpperCase()));
const MEASURE_NOUN = {
  pnl: 'PnL', 'account value': 'the account value', volume: 'volume', fees: 'fees', position: 'a position',
  'win rate': 'a win rate', return: 'a return', 'trade count': 'a trade count', 'winning trade count': 'a count of winning trades',
  'coin count': 'a count of coins traded', 'fill count': 'a trade count',
};
const RANK = f => (f.visible ? (f.origin === 'card' ? 0 : f.origin === 'tile' ? 1 : 2) : 3);

/**
 * The deterministic strike for a line, or null when every figure it types is a fact stated as the
 * record states it (or no figure at all), and no cheap claim check fails. `others` is
 * othersFrom(...) for the rest of the roster.
 */
export function attributionStrike(text, dossier, data, { others = [] } = {}) {
  const t = String(text ?? '');
  const figs = extractFigures(t);
  const claim = claimStrike(t, dossier, data);
  if (!figs.length) return claim ? spent(claim) : null;
  const facts = ledgerOf(dossier, data);
  const coins = [...new Set([...facts.map(f => f.coin), ...others.flatMap(o => o.facts.map(f => f.coin))].filter(Boolean))];
  const windows = windowsFor(t, figs);
  const sources = sourcesFor(t, figs);
  const coinOf = coinsFor(t, figs, coins);
  const clauseOf = bounds(t, true);
  const slot = Number(dossier?.slot) || 25000;

  const judge = (fig, W, S, coin) => {
    const clause = clauseOf(fig.at);
    const words = t.slice(clause[0], clause[1]);
    const M = measureOf(t, fig, clause);
    const pnlWord = PNL_WORDS.test(words);
    // An allocation the player asks for is not a claim about the record; nor is PENNY's own slot.
    const before = t.slice(Math.max(0, fig.at - 40), fig.at);
    const after = t.slice(fig.end);
    if (ALLOCATION_BEFORE.test(before) || ALLOCATION_AFTER.test(after)) return null;
    if (fig.kind === 'money' && fig.n === slot && !fig.sign && (SLOT_BEFORE.test(before) || SLOT_AFTER.test(after))) return null;
    const hits = facts.filter(f => sameValue(fig, f));
    if (!hits.length) {
      if (S === 'leaderboard' && (fig.kind === 'count' || (fig.kind === 'pct' && M !== 'return'))) return { type: 'lbNo', fig, M };
      // Judge 11: a visible figure typed with its sign flipped is named as that, not "not in the record".
      const flipped = fig.kind === 'money' ? facts.filter(f => f.visible && !f.unsigned && sameValue(fig, f, { flip: true })).sort((a, b) => RANK(a) - RANK(b))[0] : null;
      if (flipped) return { type: 'sign', fig, c: flipped };
      const theirs = others.map(o => ({ name: o.name, f: [...o.facts].sort((a, b) => (a.origin === 'tile' ? -1 : 1) - (b.origin === 'tile' ? -1 : 1)).find(f => sameValue(fig, f)) })).find(x => x.f);
      return (theirs ? { type: 'theirs', fig, ...theirs } : { type: 'absent', fig });
    }
    const windowOk = f => W === null || f.window === W;
    const sourceOk = f => S === null || f.source === S;
    const coinOk = f => f.coin === coin || (coin === null && f.coin === null);
    const measureOk = f => M === null || family(f) === M;
    const passes = f => windowOk(f) && sourceOk(f) && coinOk(f) && measureOk(f);
    if (hits.some(passes)) return null;
    // The fact the line most likely meant: fewest mismatches, then the most visible.
    const miss = f => [windowOk, sourceOk, coinOk, measureOk].filter(ok => !ok(f)).length;
    const c = [...hits].sort((a, b) => miss(a) - miss(b) || RANK(a) - RANK(b))[0];
    const windowBad = !windowOk(c);
    const sourceBad = !sourceOk(c);
    const measureBad = !measureOk(c);
    if (!c.visible) {
      if (S === 'leaderboard' && (fig.kind === 'count' || (fig.kind === 'pct' && M !== 'return'))) return { type: 'lbNo', fig, M };
      return { type: 'sealed', fig, W, S, coin, M, coinNeeded: c.coin !== null && coin === null };
    }
    const what = c.origin === 'card'
      ? (c.source === 'Nansen' ? `Nansen's ${c.desc}` : `the Hyperliquid leaderboard's ${c.desc}`)
      : `the tile's ${publishedDesc(c.tile)}`;
    // A coin's figure said as the wallet's, or as another coin's.
    if (c.coin !== null && coin === null) {
      return { type: 'one', fig, text: `${fig.typed} is only ${c.coin}'s ${DAYS[c.window]} ${c.kind === 'money' ? 'PnL' : c.measure}, not the wallet's total.` };
    }
    if (coin !== null && c.coin !== coin && !windowBad && !sourceBad) return { type: 'coin', fig, c, coin, what };
    if (isOther(S) && sourceBad) {
      return { type: 'one', fig, text: `${fig.typed} is ${what}, not ${an(srcName(S))} figure: the record was not read from ${srcName(S)}.` };
    }
    if (isOther(W) && windowBad) {
      return { type: 'one', fig, text: `${fig.typed} is ${what}, not ${aFigure(W)}.` };
    }
    if (!windowBad && !sourceBad) {
      return { type: 'one', fig, text: `${fig.typed} is ${what}, not ${measureBad ? MEASURE_NOUN[M] ?? 'the figure the line says' : pnlWord ? 'PnL' : 'the figure the line says'}.` };
    }
    if (c.origin === 'card' && c.source === 'Nansen') {
      if (windowBad && !sourceBad) return { type: 'cardWindow', fig, c, W };
      else if (sourceBad && !windowBad) return { type: 'nansenAsLb', fig, c };
      else return { type: 'one', fig, text: `${fig.typed} is Nansen's ${c.desc}, not a leaderboard ${DAYS[W]} figure.` };
    }
    if (c.origin === 'tile' && c.source === 'Nansen' && sourceBad && !windowBad) return { type: 'nansenAsLb', fig, c };
    // A leaderboard card, or any tile figure: named with its own window and source.
    const claimW = W ?? (['7d', '30d'].includes(c.window) ? c.window : null);
    const said = windowBad && sourceBad ? `a ${S === 'Nansen' ? 'Nansen' : 'leaderboard'} ${DAYS[W]} figure`
      : windowBad ? aFigure(W)
      : (S === 'Nansen' ? (claimW && c.origin === 'tile' ? `Nansen's; Nansen's ${DAYS[claimW]} summary is a different figure` : 'a Nansen figure') : 'a leaderboard figure');
    return { type: 'one', fig, text: `${fig.typed} is ${what}, not ${said}.` };
  };
  const echoes = echoSourcesFor(t, figs);
  const problems = [];
  figs.forEach((fig, i) => {
    // Every source the line credits the figure to must hold it: its own, and any echoed one.
    for (const S of [sources[i], ...echoes[i].filter(x => x !== sources[i])]) {
      const p = judge(fig, windows[i], S, coinOf[i]);
      if (p) { problems.push(p); break; }
    }
  });
  if (!problems.length) return claim ? spent(claim) : null;

  const first = type => problems.find(p => p.type === type);
  const absent = first('absent');
  if (absent) return spent(`${absent.fig.typed} is not in the record.`);
  const sign = first('sign');
  if (sign) {
    const c = sign.c;
    const what = c.origin === 'card' ? (c.source === 'Nansen' ? `Nansen's ${c.desc}` : `the Hyperliquid leaderboard's ${c.desc}`) : `the tile's ${publishedDesc(c.tile)}`;
    const gain = c.value > 0;
    return spent(`${sign.fig.typed} has the wrong sign: ${what} is ${gain ? 'a gain' : 'a loss'}, not ${gain ? 'a loss' : 'a gain'}.`);
  }
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
  if (coin) return spent(`${coin.fig.typed} is ${coin.c.coin ? `${coin.c.coin}'s ${DAYS[coin.c.window]} PnL` : coin.what}, not ${coin.coin}'s.`);
  const sealed = first('sealed');
  const whose = isOther(sealed.S) ? `${srcName(sealed.S)}'s` : sealed.S === 'Nansen' ? "Nansen's" : sealed.S === 'leaderboard' ? "the leaderboard's" : 'the';
  if (sealed.coinNeeded) return spent(`${sealed.fig.typed} is not the wallet's ${sealed.W && !isOther(sealed.W) ? `${DAYS[sealed.W]} ` : ''}${sealed.fig.kind === 'count' ? 'trade count' : 'total'} in the record.`);
  if (isOther(sealed.W)) return spent(`${sealed.fig.typed} is not ${aFigure(sealed.W).replace(/^a /, `${whose === 'the' ? 'a' : whose} `)} in the record.`);
  const noun = sealed.fig.kind === 'count' ? (sealed.M === 'coin count' ? 'coin count' : 'trade count')
    : sealed.fig.kind === 'pct' && sealed.M ? sealed.M
      : sealed.fig.kind === 'money' && sealed.M && sealed.M !== 'pnl' ? sealed.M : 'figure';
  const w = sealed.W ? `${DAYS[sealed.W]} ` : sealed.coin ? `${sealed.coin} ` : '';
  return spent(`${sealed.fig.typed} is not ${whose} ${w}${noun}${sealed.S ? '' : ' in the record'}.`);
}
