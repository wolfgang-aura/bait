import { allocationLabel, evidenceReveal, receiptText } from './player-summary.js';
const $ = id => document.getElementById(id);
const escape = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const money = n => `$${Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const hhmm = iso => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
const dmy = iso => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const sessionKey = 'bait-encounter-v2';
const draftKey = 'bait-draft-v2';
let state;
let desks = [];
let selected = new Set();
let sending = false;
let polling;
let transcriptVersion = -1;
let storageAvailable = true;

function save(key, value) { try { localStorage.setItem(key, value); } catch { storageAvailable = false; } }
function read(key) { try { return localStorage.getItem(key); } catch { storageAvailable = false; return null; } }
function saveDraft() { save(draftKey, JSON.stringify({ session: state?.id, cards: [...selected], text: $('pitch').value })); }
async function request(path, body) {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(100_000),
  });
  const data = await response.json();
  if (!response.ok) {
    const err = new Error(data.error || 'The desks could not answer. Try again.');
    err.status = response.status; err.code = data.code; err.replay = data.replay;
    throw err;
  }
  return data;
}
// The hosted demo refuses with this text once its daily budget is spent. The server
// sends the replay path alongside; the prefix match covers the polled state.error copy.
const CAP_MESSAGE = "Today's live rounds are used up. Watch the recorded attack instead.";
function replayLink(href) { const a = document.createElement('a'); a.href = href; a.textContent = 'Open the recorded attack →'; return a; }
function showError(message, replay) {
  const el = $('pitch-error');
  el.textContent = message;
  const href = replay || (message && message.startsWith(CAP_MESSAGE) ? '/replay.html' : null);
  if (href) { el.append(' ', replayLink(href)); }
  el.hidden = !message;
}
const deskEl = (deskId, selector) => document.querySelector(`.desk[data-desk="${deskId}"] ${selector}`);

function syncControls() {
  const busy = sending || state?.busy;
  $('quick-start').disabled = busy || !state || state.turn > 0 || !state.health.ready;
  $('start-actions').hidden = !!state?.turn;
  $('pitch').disabled = busy || !state || state.finished;
  document.querySelectorAll('.evidence-card, .angle').forEach(el => { el.disabled = busy || !state || state.finished; });
  $('send').disabled = busy || !state || state.finished || selected.size === 0 || !state.health.ready;
  $('send').innerHTML = busy ? 'Both desks are thinking…' : `${state?.turn === 2 ? 'Make your final pitch' : 'Pitch to both desks'} <span aria-hidden="true">↗</span>`;
  $('send').setAttribute('aria-busy', String(!!busy));
  $('selection-count').textContent = `${selected.size} / 2`;
  $('char-count').textContent = `${$('pitch').value.length} / 600`;
  document.querySelectorAll('.evidence-card').forEach(el => el.setAttribute('aria-pressed', String(selected.has(el.dataset.id))));
  $('turn-status').hidden = !busy;
  if (busy) $('turn-status').textContent = state?.phase && state.phase !== 'Ready for your pitch' ? state.phase : 'Sending your pitch to both desks';
}

function researchBlock(research) {
  if (!research.length) return '<div class="research">No records checked this turn.</div>';
  return `<details class="research"><summary>Checked ${research.length} Nansen ${research.length === 1 ? 'record' : 'records'}</summary>${research.map(r =>
    `<p><strong>${escape(r.label)}</strong>${r.partial ? ' <span class="partial-tag">partial fills</span>' : ''}<br>${escape(r.finding)}<br>${escape(r.source)}</p>`).join('')}</details>`;
}

function renderTranscript() {
  if (transcriptVersion === state.turn) return;
  transcriptVersion = state.turn;
  if (!state.turn) return;
  for (const desk of desks) {
    deskEl(desk.id, '[data-log]').innerHTML = state.transcript.map((turn, i) => {
      const side = turn.desks[desk.id];
      return `<article class="turn-message">
      <div class="message-label">You · Pitch ${i + 1}</div>
      <p class="player-message">${escape(turn.text || 'Please consider this evidence for an allocation.')}</p>
      <div class="attachments">${turn.cards.map(id => {
        const card = state.case.cards.find(c => c.id === id);
        return `<span class="attachment" title="${escape(card.claim)}">${escape(card.value)} · ${escape(card.scope.split(' · ')[0])}</span>`;
      }).join('')}</div>
      ${desk.id === 'armed' ? researchBlock(side.research) : '<div class="research">No data tools. Nothing to check.</div>'}
      <div class="message-label agent-label">${escape(desk.label)} desk · ${money(side.allocation)} allocated</div>
      <p class="agent-reply">${escape(side.reply).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')}</p>
    </article>`;
    }).join('');
    const log = deskEl(desk.id, '[data-log]');
    log.scrollTop = log.scrollHeight;
  }
}

function renderDataLabel() {
  const d = state?.data ?? config?.data;
  if (!d) return;
  if (d.live) {
    $('data-badge').className = 'data-badge live';
    $('data-badge').textContent = `Live Nansen data · fetched ${hhmm(d.fetchedAt)} UTC`;
    $('capture-date').textContent = `Live Nansen data · fetched ${hhmm(d.fetchedAt)} UTC`;
  } else {
    $('data-badge').className = 'data-badge captured';
    $('data-badge').textContent = `Nansen snapshot · captured ${dmy(d.capturedAt)}`;
    $('capture-date').textContent = `Nansen snapshot · captured ${dmy(d.capturedAt)}`;
    $('data-badge').title = d.lastError ? `Live refresh unavailable: ${d.lastError}` : 'Serving the captured snapshot.';
  }
  const h = state?.health;
  if (h && typeof h.nansenCallsSince === 'number') {
    $('quota-line').textContent = `Nansen calls since Sep 14: ${h.nansenCallsSince}` +
      (h.nansenLastSuccess ? ` · last success: ${hhmm(h.nansenLastSuccess)} UTC` : ' · last success: none');
  }
}

function render() {
  $('game').setAttribute('aria-busy', 'false');
  for (const desk of desks) {
    const allocation = state.allocations[desk.id];
    deskEl(desk.id, '[data-alloc]').textContent = money(allocation);
    deskEl(desk.id, '[data-fill]').style.width = `${allocation / state.case.slot * 100}%`;
    const verdict = deskEl(desk.id, '[data-verdict]');
    verdict.textContent = state.finished ? allocationLabel(allocation) : '';
    verdict.className = `desk-verdict ${state.finished ? (state.results[desk.id] === 'BAITED' ? 'baited' : 'held') : ''}`;
  }
  $('pitch-label').textContent = ['Your opening pitch', 'Your second pitch', 'Your final pitch'][state.turn] || 'Round complete';
  document.querySelectorAll('.turns li').forEach((li, i) => {
    li.className = i < state.turn ? 'done' : i === state.turn ? 'current' : '';
    li.setAttribute('aria-label', `Pitch ${i + 1}${i < state.turn ? ', complete' : i === state.turn ? ', current' : ''}`);
    if (i === state.turn) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
  });
  $('pitch-form').hidden = state.finished;
  $('receipt').hidden = !state.finished;
  if (state.finished) {
    $('deck-hint').textContent = 'Round complete. The receipt includes both desks.';
    const baited = desks.filter(d => state.results[d.id] === 'BAITED');
    $('receipt-title').textContent = baited.length === desks.length
      ? 'Both desks backed a losing trader.'
        : baited.length ? `The ${baited.map(d => d.label.toLowerCase()).join(' and ')} desk funded your pitch.`
        : 'Both desks held at $0.';
    $('receipt-grid').innerHTML = desks.map(d => `<div class="receipt-cell">
      <span class="eyebrow">${escape(d.label)} desk</span>
      <strong>${money(state.allocations[d.id])}</strong>
      <span class="receipt-verdict ${state.results[d.id] === 'BAITED' ? 'baited' : 'held'}">${allocationLabel(state.allocations[d.id])}</span>
    </div>`).join('');
    $('receipt-copy').textContent = `The selected cards came from Nansen. The full 30-day record was ${state.case.lossLabel}. ` +
      `This measures persuasion under a permissive policy, not a policy violation.`;
  }
  $('connection').className = `connection ${state.health.ready ? 'ready' : 'offline'}`;
  $('connection').textContent = state.health.ready ? 'Live AI' : 'AI unavailable';
  if (!state.health.ready && !state.finished && !state.busy) {
    if (state.health.capReached) showError(CAP_MESSAGE, state.health.replay || '/replay.html');
    else showError('The AI is unavailable or its prototype call budget is exhausted. No turn has been spent.');
  }
  renderDataLabel();
  renderTranscript();
  const reveal = evidenceReveal(state);
  $('evidence-reveal').hidden = !reveal;
  if (reveal) {
    $('reveal-stage').textContent = state.finished ? 'Final allocations' : 'Provisional allocations';
    $('reveal-claims').innerHTML = reveal.claims.map(claim => `<li>${escape(claim)}</li>`).join('');
    $('reveal-loss').textContent = state.case.lossLabel;
    $('reveal-check').textContent = reveal.explanation;
    $('reveal-difference').textContent = reveal.difference === 0 ? 'Both desks allocated the same amount.'
      : `The armed desk allocated ${money(Math.abs(reveal.difference))} ${reveal.difference > 0 ? 'less' : 'more'} than the unarmed desk. One round does not establish a general effect.`;
  }
  syncControls();
}

function applyState(next) {
  const advanced = state && next.id === state.id && next.turn > state.turn;
  state = next;
  if (advanced) {
    selected.clear();
    $('pitch').value = '';
    saveDraft();
    showError('');
    $('deck-hint').textContent = state.finished ? 'The full record decided this round.' : 'Choose your next facts. You can reuse a card.';
  }
  render();
}

function stopPolling() { clearInterval(polling); polling = null; }
function startPolling() {
  if (polling) return;
  let inFlight = false;
  polling = setInterval(async () => {
    if (inFlight || !state) return;
    inFlight = true;
    try {
      const next = await request(`/api/encounter/${state.id}`);
      applyState(next);
      if (!next.busy && !sending) { stopPolling(); if (next.error) showError(next.error); }
    } catch { $('turn-status').textContent = 'Connection interrupted. Waiting to restore the round…'; }
    finally { inFlight = false; }
  }, 1600);
}

let config;

function populateCase(data) {
  desks = data.desks;
  $('true-loss').textContent = data.lossLabel;
  $('shared-policy-copy').textContent = data.policy;
  $('desks').innerHTML = desks.map(desk => `
    <section class="desk" data-desk="${escape(desk.id)}" aria-labelledby="desk-title-${escape(desk.id)}">
      <header class="desk-header">
        <div class="opponent">
          <div class="desk-icon" aria-hidden="true">${escape(desk.label[0])}</div>
          <div>
            <h2 id="desk-title-${escape(desk.id)}">${escape(desk.label)} desk</h2>
            <p>${escape(desk.blurb)}</p>
          </div>
        </div>
        <span class="desk-verdict" data-verdict></span>
      </header>
      <div class="allocation-row">
        <div>
          <span class="eyebrow">Allocation to your trader</span>
          <div class="allocation"><strong data-alloc>$0</strong><span>/ ${money(data.slot)}</span></div>
        </div>
      </div>
      <div class="allocation-track" aria-hidden="true"><div data-fill></div></div>
      <div class="conversation" data-log role="log" aria-label="${escape(desk.label)} desk conversation" aria-live="polite">
        <div class="opening">
          <p>${desk.id === 'armed' ? 'Can investigate the full trading record.' : 'Sees only the evidence you choose.'}</p>
          <p class="muted">Waiting for your opening pitch.</p>
        </div>
      </div>
    </section>`).join('');
  $('evidence').innerHTML = data.cards.map(card => `<button type="button" class="evidence-card" data-id="${escape(card.id)}" aria-pressed="false" aria-label="${escape(`${card.label}: ${card.value}, ${card.scope}`)}"><span class="card-label">${escape(card.label)}</span><span class="card-check" aria-hidden="true">✓</span><strong class="card-value">${escape(card.value)}</strong><span class="card-scope">${escape(card.scope)}</span></button>`).join('');
  $('angles').innerHTML = data.presets.map(p => `<button type="button" class="angle" data-id="${escape(p.id)}">${escape(p.label)}</button>`).join('');
  const start = new Date(data.window.from).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const end = new Date(data.window.to).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  $('source-description').textContent = `Nansen's Hyperliquid PnL summaries and closed perp trades. Evaluation period: ${start} to ${end}, UTC. Both desks see the selected evidence; only the armed desk can query the full record.`;
}

$('evidence').addEventListener('click', e => {
  const card = e.target.closest('.evidence-card');
  if (!card || card.disabled) return;
  if (selected.has(card.dataset.id)) selected.delete(card.dataset.id);
  else if (selected.size < 2) selected.add(card.dataset.id);
  else { $('deck-hint').textContent = 'Two cards selected. Deselect one to swap it.'; return; }
  $('deck-hint').textContent = selected.size ? 'Selected facts will be attached to your pitch.' : 'Pick one or two cards, then make your case.';
  syncControls(); saveDraft();
});
$('angles').addEventListener('click', e => {
  const button = e.target.closest('.angle');
  if (!button || button.disabled) return;
  $('pitch').value = state.case.presets.find(p => p.id === button.dataset.id).text;
  $('pitch').focus(); syncControls(); saveDraft();
});
$('pitch').addEventListener('input', () => { syncControls(); saveDraft(); });
$('quick-start').addEventListener('click', () => {
  if ($('quick-start').disabled) return;
  selected = new Set(['week-pnl', 'week-wins']);
  $('pitch').value = state.case.presets.find(p => p.id === 'comeback').text;
  syncControls(); saveDraft();
  $('pitch-form').requestSubmit();
});
$('pitch').addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !$('send').disabled) $('pitch-form').requestSubmit(); });

$('pitch-form').addEventListener('submit', async e => {
  e.preventDefault();
  if (sending || !state || state.busy || state.finished || !selected.size) return;
  sending = true;
  showError('');
  syncControls();
  startPolling();
  if (window.innerWidth < 741) $('desks').scrollIntoView({ behavior: 'auto', block: 'start' });
  const id = state.id;
  try {
    const next = await request(`/api/encounter/${id}/pitch`, { requestId: crypto.randomUUID(), turn: state.turn, text: $('pitch').value, cards: [...selected] });
    applyState(next);
  } catch (err) {
    showError(err.status ? err.message : 'Connection interrupted. Your pitch is saved. Checking whether the desks finished…', err.replay);
    try { applyState(await request(`/api/encounter/${id}`)); }
    catch { showError('The local server is unreachable. Your pitch is saved in this browser. Reload after reconnecting.'); }
  } finally {
    sending = false;
    syncControls();
    if (!state.busy) stopPolling();
    if (state.error) showError(state.error);
  }
});

$('rules-open').addEventListener('click', () => $('rules-dialog').showModal());
$('rules-close').addEventListener('click', () => $('rules-dialog').close());
$('rules-play').addEventListener('click', () => $('rules-dialog').close());
$('rules-dialog').addEventListener('click', e => { if (e.target === $('rules-dialog')) $('rules-dialog').close(); });
$('restart').addEventListener('click', async () => {
  $('restart').disabled = true;
  try {
    const next = await request('/api/encounter', {});
    populateCase(next.case);
    state = next; selected.clear(); transcriptVersion = -1;
    $('pitch').value = ''; $('copy-status').textContent = '';
    save(sessionKey, state.id); saveDraft(); showError('');
    $('deck-hint').textContent = 'Pick one or two cards, then make your case.';
    render();
  } catch (err) { showError(err.message, err.replay); }
  finally { $('restart').disabled = false; }
});
$('copy-receipt').addEventListener('click', async () => {
  const lines = receiptText(state).split('\n');
  try { await navigator.clipboard.writeText(lines.join('\n')); $('copy-status').textContent = 'Receipt copied, including both desks and all three pitches.'; }
  catch {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/plain' })); link.download = 'bait-receipt.txt'; link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000); $('copy-status').textContent = 'Clipboard unavailable. Receipt downloaded instead.';
  }
});

async function init() {
  try {
    config = await request('/api/encounter');
    populateCase(config.case);
    renderDataLabel();
    const savedId = read(sessionKey);
    let expired = false;
    if (savedId) {
      try { state = await request(`/api/encounter/${savedId}`); }
      catch (err) { if (err.status === 404) expired = true; else throw err; }
    }
    if (!state) state = await request('/api/encounter', {});
    populateCase(state.case);
    save(sessionKey, state.id);
    try {
      const draft = JSON.parse(read(draftKey));
      if (draft && (draft.session === state.id || expired) && !state.finished) {
        $('pitch').value = String(draft.text || '').slice(0, 600);
        selected = new Set((draft.cards || []).filter(id => state.case.cards.some(c => c.id === id)).slice(0, 2));
      }
    } catch { /* An old draft must not prevent a new game. */ }
    render();
    if (expired) showError('The server restarted, so this is a fresh round. Your saved draft is still here.');
    else if (state.error) showError(state.error);
    if (!storageAvailable) showError('Browser storage is unavailable. Keep this tab open to preserve your round.');
    if (state.busy) startPolling();
  } catch (err) {
    $('startup-error').hidden = false;
    if (err.code === 'HOSTED_CAP') {
      // The page itself loaded; this visitor is over the hosted round cap.
      $('connection').textContent = 'Rounds used up'; $('connection').className = 'connection offline';
      $('startup-error').textContent = err.message;
      $('startup-error').append(' ', replayLink(err.replay || '/replay.html'));
    } else {
      $('connection').textContent = 'Desks offline'; $('connection').className = 'connection offline';
      $('startup-error').innerHTML = `Could not load the encounter. Check the local server and retry.<br><button id="retry-start">Retry connection</button>`;
      $('retry-start').addEventListener('click', () => { $('startup-error').hidden = true; init(); });
    }
    $('game').setAttribute('aria-busy', 'false');
  }
}
init();
