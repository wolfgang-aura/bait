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
 * One gate row as shown. When a block wins, a lower-priority CAP row must not promise money
 * moving: it is marked superseded and its "the gate sends N%" sentence is replaced.
 */
export function checkRowView(check, verdict) {
  if (verdict === 'block' && check.result === 'cap') {
    const said = String(check.plain).replace(/\s*[^.]*\bthe gate sends\b[^.]*\./i, '').trim();
    return { result: 'superseded', label: 'CAP', plain: `${said} Superseded by the block: nothing is sent.`.trim() };
  }
  return { result: check.result, label: LABEL[check.result] ?? check.result, plain: check.plain };
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
    if (!row) { rows.push({ kind: kind.WATCH, label: 'WATCH', line: flag.plain }); continue; }
    const view = checkRowView(row, verdict);
    const label = view.result === 'caution' ? 'WATCH' : view.label;
    // A row the gate passed or could not judge says so in its own words (round 16: a drawdown
    // on 17 minutes of fills is N/A, not a finding).
    const line = ['pass', 'not_assessed'].includes(row.result) || view.result === 'superseded' ? view.plain : flag.plain;
    rows.push({ kind: view.result === 'superseded' ? 'low superseded' : kind[label] ?? 'medium', label, line });
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
 * Judge 6: "...; this is the one being pitched." said once on the result screen, under the owner
 * tree that marks the pitched wallet. The deciding line and the gate table keep the figures.
 */
export const oncePitched = line => String(line ?? '').replace(/;\s*this is the one being pitched\.?$/, '.');
