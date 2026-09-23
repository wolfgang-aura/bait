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
    const line = row.result === 'pass' || view.result === 'superseded' ? view.plain : flag.plain;
    rows.push({ kind: view.result === 'superseded' ? 'low superseded' : kind[label] ?? 'medium', label, line });
  }
  return rows;
}
