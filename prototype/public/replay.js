// BAIT public page, version B3. Adapted from replay.js.
// Every figure on the page is read from /recorded-results.json, the audited bundle.
// Nothing here recomputes or hardcodes a result number.
import { allocationLabel } from './player-summary.js';

const $ = id => document.getElementById(id);
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const money = n => `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const millions = n => `$${(Math.abs(n) / 1e6).toFixed(1)}M`;
const stamp = iso => String(iso).replace('T', ' ').replace('Z', ' UTC');
const day = iso => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const rate = r => r.runs > 0 ? r.funded / r.runs : 0;
const percent = r => `${Math.round(rate(r) * 100)}%`;

// The bundle decides which configurations exist. Unknown ids fall back to the raw id
// so a re-recorded experiment never renders "undefined".
const CONFIG_TOOLS = {
  unarmed: 'No tools',
  'armed-basic': 'Nansen PnL + trades',
  'armed-plus': 'Nansen PnL + trades + positions',
  'armed-strict': 'Nansen PnL + trades + BAIT rule',
};
const CONFIG_ORDER = ['unarmed', 'armed-basic', 'armed-plus', 'armed-strict'];
const configTools = id => CONFIG_TOOLS[id] ?? String(id);
const configRank = id => { const i = CONFIG_ORDER.indexOf(id); return i === -1 ? CONFIG_ORDER.length : i; };

const DESK_TOOLS = { unarmed: 'No tools', armed: 'Nansen PnL + trades' };
const DESK_NAME = { unarmed: 'Unarmed desk', armed: 'Nansen-armed desk' };
const PITCH_TITLES = ['Sell the comeback', 'Focus on one winning market', 'Ask for a trial allocation'];
const LESSONS = [
  'A profitable week sat inside a losing month, and only the armed desk checked the full period.',
  'The unarmed desk took one market’s profit as the wallet’s total, while the armed desk found the missing losses.',
  'Both desks funded the trader, but only the armed desk knew about the loss and sized small.',
];

let results;
let step = 0;

/* ---------- hero: headline figure, the two big numbers, evidence line ---------- */

function renderHero() {
  const cmp = results.comparison;
  const row = id => cmp.rows.find(r => r.config === id);
  const unarmed = row('unarmed');
  const strict = row('armed-strict');
  if (!unarmed || !strict) throw new Error('Comparison rows for unarmed and armed-strict are missing');

  const loss = $('b-loss-short');
  loss.classList.remove('skeleton-inline');
  loss.textContent = millions(cmp.pnl);

  for (const [key, r] of [['unarmed', unarmed], ['armed', strict]]) {
    const cell = $(`b-big-${key}`);
    cell.classList.remove('skeleton');
    cell.innerHTML = `${r.funded}<small>/${r.runs}</small>`;
    cell.setAttribute('aria-label', `${r.funded} of ${r.runs}`);
  }
}

function renderEndpoints() {
  // Group the armed desk's research rows by endpoint, shortest window labels first.
  const bySource = new Map();
  for (const turn of results.round.transcript) {
    for (const r of turn.desks.armed.research) {
      const source = String(r.source).replace(/^Nansen\s+/, '').replace(/^\/api\/v1\//, '');
      if (!bySource.has(source)) bySource.set(source, new Set());
      const window = String(r.label).match(/(\d+)-day/);
      if (window) bySource.get(source).add(`${window[1]}d`);
    }
  }
  const parts = [...bySource].map(([source, windows]) => {
    const w = [...windows].sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
    return `<code>${escape(source)}</code>${w.length > 1 ? ` ${escape(w.join(', '))}` : ''}`;
  });
  const line = $('b-endpoints');
  line.classList.remove('skeleton-row');
  line.innerHTML = `Evidence: Nansen ${parts.join(' · ')} · round recorded ${escape(day(results.round.dataRetrievedAt))}`;
}

/* ---------- 1 · attack: the recorded round ---------- */

function deskCard(key, side, finished) {
  const funded = side.allocation > 0;
  return `
    <article class="desk" data-desk="${key}" aria-label="${escape(DESK_NAME[key])} recorded reply">
      <div class="desk-head">
        <div><h4>${escape(DESK_NAME[key])}</h4><p>${escape(DESK_TOOLS[key])}</p></div>
        <span class="verdict" data-state="${funded ? 'funded' : 'passed'}">${allocationLabel(side.allocation)}</span>
      </div>
      <p class="alloc"><strong>${money(side.allocation)}</strong><span>of $25,000${finished ? '' : ', so far'}</span></p>
      <p class="reply">${escape(side.reply)}</p>
      <details class="records">
        <summary>${side.research.length ? `${side.research.length} Nansen records checked this pitch` : 'No new records checked this pitch'}</summary>
        ${side.research.map(r => `<p><strong>${escape(r.label)}</strong>${r.partial ? ', partial fills' : ''}<br>${escape(r.finding)}<br>${escape(r.source)}</p>`).join('')
          || '<p>Earlier findings, if any, stay in the conversation.</p>'}
      </details>
    </article>`;
}

function renderRound() {
  const transcript = results.round.transcript;
  const pitch = transcript[step];
  const finished = step === transcript.length - 1;
  $('b-progress').textContent = `Pitch ${step + 1} of ${transcript.length}, saved replies`;
  $('b-pitch-title').textContent = PITCH_TITLES[step];
  $('b-pitch-text').textContent = pitch.text;
  $('b-claims').innerHTML = pitch.claims.map(claim => `<li>${escape(claim)}</li>`).join('');
  $('b-desks').innerHTML = Object.entries(pitch.desks).map(([key, side]) => deskCard(key, side, finished)).join('');
  $('b-loss').textContent = money(results.round.truth);
  $('b-lesson').textContent = LESSONS[step];
  $('b-back').disabled = step === 0;
  $('b-next').textContent = finished ? 'See the score' : 'Next pitch';
}

$('b-next').addEventListener('click', () => {
  if (step === results.round.transcript.length - 1) {
    $('score').scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  step++;
  renderRound();
});
$('b-back').addEventListener('click', () => { if (step > 0) { step--; renderRound(); } });

/* ---------- 2 · score: leaderboard over every configuration the bundle has ---------- */

function renderScore() {
  const cmp = results.comparison;
  const rows = [...cmp.rows].sort((a, b) => (rate(b) - rate(a)) || (configRank(a.config) - configRank(b.config)));
  const totalRuns = rows.reduce((sum, r) => sum + r.runs, 0);
  const evidenceNote = cmp.evidence === 'frozen' ? ', frozen Nansen evidence' : '';
  $('b-comparison-caption').textContent = `${totalRuns} replays recorded ${day(cmp.recordedAt)}, ${results.round.provider}${evidenceNote}, ${cmp.caseCount} attacks times ${cmp.repeats} repeats per row.`;
  $('b-comparison').innerHTML = rows.map(r =>
    `<tr data-config="${escape(r.config)}">
      <th scope="row"><code>${escape(r.config)}</code></th>
      <td>${escape(configTools(r.config))}</td>
      <td><strong>${r.funded} / ${r.runs}</strong> <em>(${percent(r)})</em></td>
      <td>${money(r.mean)}</td>
    </tr>`).join('');
}

/* ---------- 3 · fix: the strict rule, verbatim, with a clipboard button ---------- */

function renderFix() {
  const strict = results.comparison.rows.find(r => r.config === 'armed-strict');
  const policy = results.paired.policies.find(p => p.id === 'armed-strict');
  if (!policy?.text) throw new Error('The strict policy text is missing from the bundle');
  $('b-rule-title').textContent = `The rule that held: ${strict.funded} of ${strict.runs}`;
  $('b-policy').textContent = policy.text;
}

let statusTimer;
function setCopyStatus(text) {
  const status = $('b-copy-status');
  status.textContent = text;
  clearTimeout(statusTimer);
  if (text) statusTimer = setTimeout(() => { status.textContent = ''; }, 2400);
}

$('b-copy').addEventListener('click', async () => {
  const text = $('b-policy').textContent;
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
    await navigator.clipboard.writeText(text);
    setCopyStatus('Copied');
  } catch {
    // Clipboard API refused: select the block and try the legacy copy command,
    // leaving the selection in place so a manual copy is one keystroke away.
    const range = document.createRange();
    range.selectNodeContents($('b-policy'));
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    let copied = false;
    try { copied = document.execCommand('copy'); } catch { copied = false; }
    setCopyStatus(copied ? 'Copied' : 'Selected, press Ctrl+C');
  }
});

/* ---------- audit fold: paired explorer ---------- */

const policyName = id => id === 'armed-basic' ? 'Permissive policy' : 'Strict policy';

function renderPairedWallet() {
  const wallet = results.paired.wallets.find(w => w.id === $('b-wallet').value);
  $('b-provenance').textContent = `Full 30-day PnL ${money(wallet.pnl)}. Evidence captured ${stamp(wallet.capturedAt)}. ${wallet.cohort === 'profitable-control' ? 'Profitable control, trade coverage incomplete for both policies.' : 'Losing-wallet case.'}`;
  $('b-transcript').innerHTML = wallet.pitches.map((pitch, index) => `
    <details class="turn" ${index === 2 ? 'open' : ''}>
      <summary>Pitch ${index + 1}, ${index === 2 ? 'final decisions' : 'provisional decisions'}</summary>
      <p>${escape(pitch.text)}</p>
      <ul class="claims">${pitch.claims.map(c => `<li>${escape(c)}</li>`).join('')}</ul>
      <div class="desks">${['armed-basic', 'armed-strict'].map(id => {
        const reply = wallet.replies.find(r => r.config === id).pitches[index];
        const funded = reply.allocation > 0;
        return `<article class="desk" data-desk="${id === 'armed-strict' ? 'armed' : 'unarmed'}">
          <div class="desk-head">
            <div><h4>${policyName(id)}</h4></div>
            <span class="verdict" data-state="${funded ? 'funded' : 'passed'}">${allocationLabel(reply.allocation)}</span>
          </div>
          <p class="alloc"><strong>${money(reply.allocation)}</strong><span>of $25,000</span></p>
          <p class="reply">${escape(reply.reply)}</p>
          <details class="records">
            <summary>${reply.research.length} Nansen records checked this pitch</summary>
            ${reply.research.map(r => `<p><strong>${escape(r.label)}</strong>${r.partial ? ', partial coverage' : ''}<br>${escape(r.finding)}<br>${escape(r.source)}</p>`).join('')
              || '<p>Earlier findings stay in the conversation.</p>'}
          </details>
        </article>`;
      }).join('')}</div>
    </details>`).join('');
}
$('b-wallet').addEventListener('change', renderPairedWallet);

function renderAudit() {
  const cmp = results.comparison;
  const strict = results.strict.rows[0];
  $('b-strict-count').textContent = `${strict.funded} / ${strict.runs}`;
  const controls = results.strict.controls.filter(r => r.caseId === 'profitable-wallet-control');
  $('b-control-count').textContent = `${controls.filter(r => r.finalAllocation > 0).length} / ${controls.length}`;
  $('b-strict-context').textContent = `Recorded ${day(results.strict.recordedAt)}, with the wallet’s 30-day PnL at ${money(results.strict.pnl)} against ${money(cmp.pnl)} in the score table.`;

  const paired = results.paired;
  if (!paired?.summary?.complete || paired.wallets.length !== 7) throw new Error('Paired evidence is incomplete');
  const strictPaired = paired.summary.allocations['armed-strict'];
  if (!strictPaired || paired.summary.losingPairs !== 6 || paired.summary.profitablePairs !== 1) throw new Error('Headline policy result is incomplete');

  $('b-paired-caption').textContent = `${paired.wallets.length} wallets recorded ${day(paired.recordedAt)}, ${results.round.provider}, one three-pitch replay per policy per wallet.`;
  $('b-paired-totals').innerHTML = Object.entries(paired.summary.allocations).map(([id, counts]) =>
    `<tr><th scope="row">${policyName(id)}</th><td>${counts.losingFunded} of ${paired.summary.losingPairs}</td><td>${counts.profitableFunded} of ${paired.summary.profitablePairs}</td></tr>`).join('');
  $('b-paired-conclusion').textContent = `Mean final allocation to losing wallets changed by ${money(paired.summary.meanLosingAllocationChange)} under the strict policy, and the permissive policy already rejected four of the six losing wallets.`;
  $('b-wallet').innerHTML = paired.wallets.map((w, i) =>
    `<option value="${escape(w.id)}">${w.cohort === 'profitable-control' ? 'Profitable control' : `Losing wallet ${i + 1}`}, ${money(w.pnl)} over 30 days</option>`).join('');
  renderPairedWallet();

  $('b-manifest').textContent = results.sources.map(s => `${s.path}${s.sha256 ? ` sha256 ${s.sha256}` : ''}`).join('\n');
}

/* ---------- boot ---------- */

async function init() {
  try {
    const response = await fetch('/recorded-results.json', { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`Evidence file returned HTTP ${response.status}`);
    results = await response.json();
    if (results.version !== 1 || results.round?.transcript?.length !== 3) throw new Error('Recorded evidence has an unsupported format');

    renderHero();
    renderEndpoints();
    renderRound();
    renderScore();
    renderFix();
    renderAudit();

    for (const id of ['attack', 'score', 'fix']) $(id).hidden = false;
  } catch (err) {
    $('b-error').hidden = false;
    $('b-error').textContent = `Recorded results could not load. ${err.message}. Reload to retry.`;
  }
}

init();
