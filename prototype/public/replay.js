import { allocationLabel, evidenceReveal, receiptText } from './player-summary.js';
const $ = id => document.getElementById(id);
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const money = n => `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
let results;
let step = 0;

const policyName = id => id === 'armed-basic' ? 'Permissive policy' : 'Strict policy';
function renderPairedWallet() {
  const wallet = results.paired.wallets.find(w => w.id === $('paired-wallet').value);
  $('paired-provenance').textContent = `Full 30-day PnL: ${money(wallet.pnl)}. Evidence captured ${wallet.capturedAt.replace('T', ' ').replace('Z', ' UTC')}. ${wallet.cohort === 'profitable-control' ? 'Profitable control; trade coverage is incomplete for both policies.' : 'Losing-wallet case.'}`;
  $('paired-transcript').innerHTML = wallet.pitches.map((pitch, index) => `
    <details ${index === 2 ? 'open' : ''} class="paired-turn">
      <summary>Pitch ${index + 1} · ${index === 2 ? 'final decisions' : 'provisional decisions'}</summary>
      <p>${escape(pitch.text)}</p><ul>${pitch.claims.map(c => `<li>${escape(c)}</li>`).join('')}</ul>
      <div class="desks">${['armed-basic', 'armed-strict'].map(id => {
        const reply = wallet.replies.find(r => r.config === id).pitches[index];
        return `<section class="desk"><header class="desk-header"><h4>${policyName(id)}</h4></header>
          <div class="recorded-reply"><strong>${money(reply.allocation)} · ${allocationLabel(reply.allocation)}</strong><p>${escape(reply.reply)}</p>
          <details class="research"><summary>${reply.research.length} records checked this pitch</summary>${reply.research.map(r => `<p>${escape(r.label)}${r.partial ? ' · partial coverage' : ''}<br>${escape(r.finding)}<br>${escape(r.source)}</p>`).join('') || '<p>Earlier findings remain in the conversation.</p>'}</details></div></section>`;
      }).join('')}</div>
    </details>`).join('');
}
$('paired-wallet').addEventListener('change', renderPairedWallet);

function currentRound() {
  const r = results.round;
  return { recorded: true, finished: step === r.transcript.length - 1,
    case: { lossLabel: money(r.truth) },
    data: { live: false, capturedAt: r.dataRetrievedAt },
    transcript: r.transcript.slice(0, step + 1),
    allocations: Object.fromEntries(Object.entries(r.transcript[step].desks).map(([key, side]) => [key, side.allocation])),
  };
}

function renderRound() {
  const round = currentRound();
  const pitch = round.transcript.at(-1);
  $('replay-progress').textContent = `Pitch ${step + 1} of ${results.round.transcript.length}`;
  $('recorded-pitch-title').textContent = ['Sell the comeback', 'Focus on one winning market', 'Ask for a trial allocation'][step];
  $('recorded-pitch-text').textContent = pitch.text;
  $('recorded-claims').innerHTML = pitch.claims.map(claim => `<li>${escape(claim)}</li>`).join('');
  $('recorded-desks').innerHTML = Object.entries(pitch.desks).map(([key, side]) => `
    <section class="desk" data-desk="${key}" aria-label="${key === 'armed' ? 'Nansen-armed' : 'Unarmed'} recorded reply">
      <header class="desk-header"><div class="opponent"><h2>${key === 'armed' ? 'Nansen-armed desk' : 'Unarmed desk'}</h2></div><span class="desk-verdict">${allocationLabel(side.allocation)}</span></header>
      <div class="allocation-row"><div><span class="eyebrow">${round.finished ? 'Final' : 'Provisional'} allocation</span><div class="allocation"><strong>${money(side.allocation)}</strong><span>/ $25,000</span></div></div></div>
      <div class="recorded-reply"><p class="agent-reply">${escape(side.reply)}</p>
      <details class="research"><summary>${side.research.length ? `${side.research.length} records checked this pitch` : 'No new records checked this pitch'}</summary>${side.research.map(r => `<p><strong>${escape(r.label)}</strong>${r.partial ? ' · partial fills' : ''}<br>${escape(r.finding)}<br>${escape(r.source)}</p>`).join('') || '<p>Earlier findings, if any, remain in the conversation.</p>'}</details></div>
    </section>`).join('');
  $('recorded-loss').textContent = round.case.lossLabel;
  $('recorded-stage').textContent = round.finished ? 'Final result' : 'Provisional result';
  $('recorded-lesson').textContent = [
    'A profitable week can coexist with a losing month. The armed desk checked the full period and still chose a small allocation.',
    'The unarmed desk mistook one market’s $100,849 profit for the wallet’s total. The armed desk identified the missing losses.',
    'Both desks funded the trader. The armed desk knew about the loss and took a smaller position, as its policy allowed.',
  ][step];
  $('recorded-check').textContent = evidenceReveal(round).explanation;
  $('replay-back').disabled = step === 0;
  $('replay-next').textContent = round.finished ? 'Compare the experiments ↓' : 'Next pitch →';
  $('replay-copy-status').textContent = '';
}

$('replay-next').addEventListener('click', () => {
  if (step === results.round.transcript.length - 1) {
    location.hash = 'results';
    return;
  }
  step++; renderRound();
});
$('replay-back').addEventListener('click', () => { if (step > 0) { step--; renderRound(); } });
$('replay-copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(receiptText(currentRound())); $('replay-copy-status').textContent = 'Receipt copied with its date and recorded status.'; }
  catch { $('replay-copy-status').textContent = 'Clipboard unavailable. Use the evidence download below to save the full recorded round.'; }
});

async function init() {
  try {
    const response = await fetch('/recorded-results.json', { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`Evidence file returned HTTP ${response.status}`);
    results = await response.json();
    if (results.version !== 1 || results.round?.transcript?.length !== 3) throw new Error('Recorded evidence has an unsupported format');
    $('replay-date').textContent = `Nansen evidence fetched ${results.round.dataRetrievedAt.replace('T', ' ').replace('Z', ' UTC')}`;
    const labels = { unarmed: 'No tools', 'armed-basic': 'PnL + trade history', 'armed-plus': 'PnL + trades + open positions' };
    $('comparison-rows').innerHTML = results.comparison.rows.map(r => `<tr><th scope="row">${escape(labels[r.config])}</th><td>${money(r.mean)}</td><td>${r.funded} / ${r.runs} <span class="muted">· ${Math.round(r.funded / r.runs * 100)}%</span></td></tr>`).join('');
    const strict = results.strict.rows[0];
    $('strict-count').textContent = `${strict.funded} / ${strict.runs}`;
    const controls = results.strict.controls.filter(r => r.caseId === 'profitable-wallet-control');
    $('control-count').textContent = `${controls.filter(r => r.finalAllocation > 0).length} / ${controls.length}`;
    $('strict-context').textContent = `Recorded later on 18 Sep. The wallet's 30-day PnL changed from ${money(results.comparison.pnl)} to about ${money(results.strict.pnl)}. The policy also changed. This is not a paired comparison with the table above.`;
    $('source-manifest').textContent = results.sources.map(s => s.path).join(' · ');
    const paired = results.paired;
    if (!paired?.summary?.complete || paired.wallets.length !== 7) throw new Error('Paired evidence is incomplete');
    const strictPaired = paired.summary.allocations['armed-strict'];
    if (!strictPaired || paired.summary.losingPairs !== 6 || paired.summary.profitablePairs !== 1) throw new Error('Headline policy result is incomplete');
    $('headline-strict').textContent = `${strictPaired.losingFunded} / ${paired.summary.losingPairs}`;
    $('headline-control').textContent = `${strictPaired.profitableFunded} / ${paired.summary.profitablePairs}`;
    $('headline-result').hidden = false;
    $('paired-totals').innerHTML = Object.entries(paired.summary.allocations).map(([id, counts]) => `<tr><th scope="row">${policyName(id)}</th><td>${counts.losingFunded} / ${paired.summary.losingPairs}</td><td>${counts.profitableFunded} / ${paired.summary.profitablePairs}</td></tr>`).join('');
    $('paired-conclusion').textContent = `Mean final allocation to losing wallets changed by ${money(paired.summary.meanLosingAllocationChange)} under the strict policy. The permissive policy already rejected four of the six losing wallets.`;
    $('paired-wallet').innerHTML = paired.wallets.map((w, i) => `<option value="${escape(w.id)}">${w.cohort === 'profitable-control' ? 'Profitable control' : `Losing wallet ${i + 1}`} · ${money(w.pnl)} over 30 days</option>`).join('');
    $('paired-policy').textContent = paired.policies.find(p => p.id === 'armed-strict').text;
    renderPairedWallet();
    renderRound();
    $('recorded-round').hidden = false;
    $('results').hidden = false;
    if (location.hash === '#results') $('results').scrollIntoView();
  } catch (err) {
    $('replay-error').hidden = false;
    $('replay-error').textContent = `Recorded results could not load. ${err.message}. Reload to retry.`;
  }
}
init();
