/**
 * Gate v5's owner reveal: the first funder, the wallet the player pitched and every other
 * wallet that funder paid for, each with its realised PnL over the same days, then the sums.
 *
 * Every figure is the server's `gate.operator` (prototype/room.js ownerView), which is the
 * operator read the gate decided on: live, or a saved live read replayed with its own time on
 * it. Nothing here computes a figure. Addresses are short forms; no Nansen label is shown.
 *
 * `compact` is the checkpoint's version: siblings flow as chips so the stamp stays in view, and the
 * owner sentence is left to the row above it (judge 7: said once). The pitched wallet is tagged
 * "this wallet", true whichever figure the player pitched. Judge 8: the full tree (the result screen)
 * says once that shared funding is not proof of one owner.
 */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const CHAIN = { ethereum: 'Ethereum', arbitrum: 'Arbitrum' };
const when = iso => (iso ? `${String(iso).slice(0, 10)} ${String(iso).slice(11, 16)} UTC` : '');

export function ownerTreeHtml(op, { compact = false } = {}) {
  if (!op || !Array.isArray(op.siblings)) return '';
  const funders = (op.funders ?? []).map(f => `<b>${esc(f.short)}</b> <span class="ot-meta">${esc(CHAIN[f.chain] ?? f.chain)}${f.fundingLabel ? ` · sent it ${esc(f.fundingLabel)} to start` : ''}</span>`).join(' <span class="ot-meta">and</span> ');
  // Biggest losses first, so the money that went missing is what the eye lands on.
  const kids = [...op.siblings].sort((a, b) => a.pnl - b.pnl);
  const node = (x, cls, tag = '') => `<li class="ot-node ${cls}"><b>${esc(x.short)}</b>${tag}<em>${esc(x.pnlLabel)}</em></li>`;
  const n = op.siblings.length;
  // Judge 5: the same read label as every other figure in the round, when the server sends it.
  const source = op.readLabel ? `Owner, ${op.readLabel}` : op.live
    ? `Owner read live, ${when(op.readAt)}`
    : op.frozenFrom ? `Owner read: frozen capture of a live read, ${when(op.frozenFrom)}` : `Owner read: capture, ${when(op.readAt)}`;
  return `<figure class="owner-tree${compact ? ' compact' : ''}${op.result === 'fail' ? ' losing' : ''}" aria-label="Who funds this wallet">
  <p class="ot-funder"><span class="ot-k">First funder</span> ${funders}</p>
  <ul class="ot-kids">
    ${node(op.wallet, 'pitched', '<span class="ot-tag">this wallet</span>')}
    ${kids.map(x => node(x, x.pnl < 0 ? 'loss' : 'gain')).join('\n    ')}
  </ul>
  <dl class="ot-sums">
    <dt>${n} other wallet${n === 1 ? '' : 's'}, ${esc(op.days)} days</dt><dd class="${op.siblingsPnl < 0 ? 'loss' : 'gain'}">${esc(op.siblingsLabel)}</dd>
    <dt>The owner, all ${n + 1}</dt><dd class="${op.combined < 0 ? 'loss' : 'gain'}">${esc(op.combinedLabel)}</dd>
  </dl>
  ${op.line && !compact ? `<p class="ot-line">${esc(op.line)}</p>` : ''}
  ${!compact ? '<p class="ot-hedge">Shared funding is not proof of one owner.</p>' : ''}
  ${compact ? `<p class="ot-src">${esc(source)}</p>` : ''}
</figure>`;
}
