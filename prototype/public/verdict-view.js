/**
 * Round 15: the words the checkpoint and the reveal put on BAIT's decision, from the one
 * gate result, so no heading, row or report line can disagree with the stamp.
 * Pure functions: the page imports them, and the tests run them in Node.
 */

/** The checkpoint's heading follows the verdict: only a block is an interception. */
export function checkpointTitle(final) {
  if (final.whatIfOf) return 'What-if: the BAIT check on this record';
  if (final.checkOnly) return 'The BAIT check on this record';
  return final.verdict === 'block' ? 'BAIT intercepted the transfer' : 'BAIT checked the transfer';
}

const LABEL = { pass: 'PASS', fail: 'BLOCK', not_assessed: 'N/A', cap: 'CAP', caution: 'WATCH' };

/**
 * Judge 9: data words as people read them. Chain names are capitalised ("arbitrum 0x..." read as a
 * typo), and a HIP-3 market's dex prefix is said, not printed as an id: "xyz:SKHY" is
 * "SKHY (xyz market)", Hyperliquid's name for a market deployed by the xyz dex.
 */
const CHAINS = { ethereum: 'Ethereum', arbitrum: 'Arbitrum', base: 'Base', optimism: 'Optimism', polygon: 'Polygon', solana: 'Solana', bnb: 'BNB', avalanche: 'Avalanche' };
export const humanText = text => String(text ?? '')
  .replace(/\b(ethereum|arbitrum|base|optimism|polygon|solana|bnb|avalanche)(?= 0x)/g, c => CHAINS[c])
  .replace(/\b(ethereum|arbitrum)\b/g, c => CHAINS[c])
  .replace(/\b([a-z][a-z0-9]*):([A-Z0-9]{2,})\b/g, (_, dex, sym) => `${sym} (${dex} market)`);

/**
 * One gate row as shown. When a block wins, a lower-priority CAP row must not promise money
 * moving: it is marked superseded and its "the gate sends N%" sentence is replaced.
 */
export function checkRowView(check, verdict) {
  if (verdict === 'block' && check.result === 'cap') {
    const said = String(check.plain).replace(/\s*[^.]*\bthe gate sends\b[^.]*\./i, '').trim();
    return { result: 'superseded', label: 'CAP', plain: humanText(`${said} Superseded by the block: nothing is sent.`.trim()) };
  }
  return { result: check.result, label: LABEL[check.result] ?? check.result, plain: humanText(check.plain) };
}

/** The report's flag ids and the gate row that decides each one. */
export const ROW_FOR_FLAG = {
  realised_negative: 'realised_pnl_30d', low_win_rate: 'low_win_rate', thin_sample: 'thin_sample',
  concentration: 'concentration', max_drawdown: 'fills_drawdown', tail_loss: 'fills_worst_trade', paper_headline: 'paper_headline',
};

/**
 * The reveal's report lines. A flag labelled with its gate row's word; where the gate row
 * passed, the line is the gate row's own sentence, so a PASS never sits beside a line
 * that argues the opposite (round 15: HYPE's 81.4% share).
 */
export function reportRows(risk, checks = [], verdict = null) {
  const kind = { BLOCK: 'high', CAP: 'medium', WATCH: 'medium', PASS: 'low', 'N/A': 'low' };
  const rows = [];
  if (!risk.flags.length) rows.push({ kind: 'none', label: 'clear', line: 'Nothing on this record trips a BAIT check.' });
  for (const flag of risk.flags) {
    const row = checks.find(c => c.id === ROW_FOR_FLAG[flag.id]);
    if (!row) { rows.push({ kind: kind.WATCH, label: 'WATCH', line: humanText(flag.plain) }); continue; }
    const view = checkRowView(row, verdict);
    const label = view.result === 'caution' ? 'WATCH' : view.label;
    // A row the gate passed or could not judge says so in its own words (round 16: a drawdown
    // on 17 minutes of fills is N/A, not a finding).
    // Judge 9: a fills row (drawdown, worst trade) always says its gate row's sentence, which names
    // the base and the limit it broke, so the report and the check table state one measure.
    const line = ['pass', 'not_assessed'].includes(row.result) || view.result === 'superseded' || String(row.id).startsWith('fills_') ? view.plain : flag.plain;
    rows.push({ kind: view.result === 'superseded' ? 'low superseded' : kind[label] ?? 'medium', label, line: humanText(line) });
  }
  return rows;
}

/**
 * Judge 5: the checkpoint's "Reading Nansen ..." line. It names every endpoint this round's check
 * reads (the server's `gate.reads`) and the one read they come from (`gate.read.label`): "read live
 * 12:40 UTC", or "saved read 25 Sep 11:31 UTC" for a round that made no call.
 */
export function readingLine(gate, who) {
  const reads = gate?.reads?.length ? gate.reads : ['perp-pnl-summary'];
  const list = reads.length > 1 ? `${reads.slice(0, -1).join(', ')} and ${reads.at(-1)}` : reads[0];
  const label = gate?.read?.label ?? (gate?.live ? 'read live' : 'saved read');
  return `Reading Nansen ${list} for ${who}: ${label}${gate?.read?.live ? '' : ', no call this round'}`;
}

/**
 * Judge 5: the result screen's "What you pitched" card, from the server's `final.pitched`: the
 * facts the player's lines used (or the round's lead fact, said as such), each from the round's
 * read, plus how far the tile's saved 7-day figure moved when a live read changed it. Null when
 * the round has no pitch (a pasted wallet with nothing flattering), so the tile's hype stays.
 */
export function pitchedView(final) {
  const p = final?.pitched;
  if (!p?.facts?.length) return null;
  const [lead, ...more] = p.facts;
  const also = more.slice(0, 2).map(f => `${f.value} ${f.label}`);
  const sources = [...new Set(p.facts.map(f => f.source))];
  return {
    value: lead.value,
    caption: [lead.label, ...also].join(' · '),
    source: [p.used ? sources.join(' · ') : `Your lines quoted no fact card; the round's lead fact · ${sources.join(' · ')}`, p.moved?.line].filter(Boolean).join(' · '),
  };
}

/**
 * Judge 6: "...; the wallet you pitched has the same first funder." said once on the result screen, under the owner
 * tree that marks the pitched wallet. The deciding line and the gate table keep the figures.
 */
export const oncePitched = line => humanText(line).replace(/;\s*the wallet you pitched has the same first funder\.?$/, '.');

/**
 * Judge 7: every row's name as people read it. The same names as the gate's CHECK_TITLE
 * (validation/guard.js), so a sentence naming another row and the row itself agree. A rule id
 * never reaches the screen: an id with no name reads as "BAIT check".
 */
export const CHECK_NAME = Object.freeze({
  evidence_30d: '30-day record is this wallet’s', evidence_freshness: 'Read is fresh', evidence_7d: '7-day record is this wallet’s',
  realised_pnl_30d: '30-day realised PnL', regime_agreement: '7-day and 30-day agree', thin_sample: 'Enough closed trades',
  low_win_rate: 'Win rate at least 40%', paper_headline: 'Headline is realised', concentration: 'Profitable without its best market', open_book: 'Open positions not deep underwater',
  smart_money_side: 'Smart money not against the open book', independent_record: 'Leaderboard record agrees',
  operator_record: 'Owner behind the wallet not losing',
  tail_loss: 'Worst single trade', max_drawdown: 'Drawdown',
  // The text says which fills: all of them in the window, the newest N over a span, or the N held.
  fills_drawdown: 'Drawdown in the fills read', fills_worst_trade: 'Worst trade in the fills read',
});
export const checkName = id => CHECK_NAME[id] ?? 'BAIT check';

/**
 * Judge 7: the one line under WATCH rows, true to the gate. Drawdown and worst trade come from
 * the copy-risk report on the fills; guardAllocation never reads the fills (FILL_ONLY_CHECKS), and
 * the round's verdict is the gate's alone, so a WATCH never blocks or caps.
 */
export const WATCH_NOTE = 'WATCH rows are measured on the trade fills by BAIT’s copy-risk report. The gate does not read the fills, so a WATCH neither blocks nor caps the transfer.';

/**
 * Judge 7: the fact cards grouped under the read each came from, in the cards' order. The
 * all-time card is a Hyperliquid leaderboard read, so it never sits under the Nansen heading.
 */
export function factGroups(facts = []) {
  const groups = [];
  for (const f of facts) {
    const source = f.source ?? '';
    const last = groups.at(-1);
    if (last && last.source === source) last.facts.push(f);
    else {
      const earlier = groups.find(g => g.source === source);
      if (earlier) earlier.facts.push(f); else groups.push({ source, facts: [f] });
    }
  }
  return groups;
}

/** Judge 8: the result screen's short form of WATCH_NOTE, said once under the report when a WATCH row shows. */
export const WATCH_NOTE_SHORT = 'WATCH rows come from the trade fills, which the gate does not read, so a WATCH neither blocks nor caps.';

/**
 * Judge 8: the big figure on the result's record card. A block or a cap headlines the figure of
 * the row that decided it (the server's `gate.decided`, every cap row for a cap); THE GRINDER's
 * capped card once headlined its passing 30 days under "Why BAIT capped it". The record's own
 * figure then stays on the card as a row, labelled as the one that passed. A clear, or a row with
 * no figure of its own, keeps the record's figure.
 */
export function recordHeadline(final, truth) {
  const decided = ['block', 'capped'].includes(final?.verdict) ? (final?.gate?.decided ?? []) : [];
  const [first, ...also] = decided;
  if (!first || first.id === 'realised_pnl_30d') {
    return { id: first?.id ?? null, value: truth.pnlLabel, caption: truth.pnlCaption, bad: final?.verdict === 'block' || truth.pnl < 0, also, rows: [] };
  }
  const rows = first.id === 'operator_record' ? [] : [{ label: '30-day realised (passed)', value: truth.pnlLabel }];
  const human = r => ({ ...r, ...(r.caption ? { caption: humanText(r.caption) } : {}), ...(r.label ? { label: humanText(r.label) } : {}) });
  return { id: first.id, value: first.value, caption: humanText(first.caption), bad: true, also: also.map(human), rows };
}

const usd = n => `$${Math.round(Number(n) || 0).toLocaleString('en-US')}`;

/**
 * Judge 10: the every-check page's wire log, one row per line, each with a true label. A line that
 * committed money but was not the one wired ("Line 1 · $3,500 · undefined" on the live build) says
 * what happened to that commitment: withdrawn, lowered, raised or restated on a later line.
 */
export function wireLogRows(shots = []) {
  const said = shots.filter(s => !s.caught);
  return shots.map(shot => {
    const n = shot.n;
    if (shot.caught) return { cls: 'caught', text: `Line ${n} · struck by the referee, no wire` };
    const w = shot.wire;
    const before = said.filter(s => s.n < n).at(-1);
    const standing = Number(before?.allocation) || 0;
    if (!w) {
      return standing > 0
        ? { cls: 'none', text: `Line ${n} · PENNY withdrew its ${usd(standing)}, no wire` }
        : { cls: 'none', text: `Line ${n} · PENNY committed $0, no wire` };
    }
    const amount = w.attemptedLabel ?? usd(w.attempted ?? shot.allocation);
    if (w.stamp) {
      return { cls: w.decision === 'block' ? 'blocked' : w.verdict === 'capped' ? 'capped' : 'cleared',
        text: `Line ${n} · ${amount} · ${w.stamp}${w.decision === 'block' && w.stoppedLabel ? ` · ${w.stoppedLabel} stopped` : ''}` };
    }
    // Committed on this line, not wired: the next line that changed it says why.
    const later = said.find(s => s.n > n);
    const now = Number(later?.allocation) || 0;
    const then = Number(w.attempted ?? shot.allocation) || 0;
    const fate = !later ? 'committed, not wired'
      : now === 0 ? `committed, withdrawn on line ${later.n}`
      : now < then ? `committed, lowered to ${usd(now)} on line ${later.n}`
      : now > then ? `committed, raised to ${usd(now)} on line ${later.n}`
      : `committed, restated on line ${later.n}`;
    return { cls: 'none', text: `Line ${n} · ${amount} · ${fate}` };
  });
}

/**
 * Judge 10: the in-play card after a line, from that line and the commitment standing before it.
 * A raise or a first commitment is the transfer card; a lower commitment says it was lowered; a
 * drop to $0 says PENNY withdrew it (the LEGEND round kept "PENNY has committed $3,500" on screen
 * while the meter read $0). Null when nothing is or was committed.
 */
export function commitmentCard(shot, standing = 0, { to = 'this trader', slot = 25000, linesLeft = 0 } = {}) {
  if (!shot || shot.caught) return null;
  const now = Number(shot.wire?.attempted ?? shot.allocation) || 0;
  const prev = Number(standing) || 0;
  const fund = usd(slot);
  if (now === 0) {
    if (prev <= 0) return null;
    return { kind: 'withdrawn', title: `Line ${shot.n} · PENNY withdrew its ${usd(prev)} commitment to ${to}`, amount: '$0',
      why: linesLeft > 0 ? `Nothing is committed now. PENNY can commit again on your next line.` : 'That was your last line: nothing is committed, so nothing is wired.' };
  }
  const verb = prev <= 0 ? `has committed ${usd(now)} to ${to}` : now < prev ? `lowered its commitment to ${to} from ${usd(prev)} to ${usd(now)}`
    : now > prev ? `raised its commitment to ${to} from ${usd(prev)} to ${usd(now)}` : `still commits ${usd(now)} to ${to}`;
  return { kind: 'pending', title: `Line ${shot.n} · PENNY ${verb}`, amount: usd(now),
    why: linesLeft > 0
      ? `Committed from PENNY's ${fund} fund on your pitch alone. Each line can raise or lower it; press Wire it to send it.`
      : `Committed from PENNY's ${fund} fund on your pitch alone. That was your last line: it is wired.` };
}
