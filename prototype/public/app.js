/* BAIT prototype UI. No framework, no build step. */

const $ = (id) => document.getElementById(id);
const usd = (n) =>
  (n < 0 ? '-' : '+') +
  '$' +
  Math.abs(Math.round(n)).toLocaleString('en-US');
const esc = (s) =>
  String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

let STATE = null;

async function boot(ruleId) {
  STATE = await (await fetch('/api/state' + (ruleId ? `?rule=${ruleId}` : ''))).json();

  $('policy').removeAttribute('aria-busy');
  $('policy').innerHTML = `
    <header><strong>Agent policy under test</strong> &mdash; ${esc(STATE.rule.name)}</header>
    <p style="font-size:1.05rem;margin:0.2rem 0 0.8rem">${esc(STATE.rule.statement)}</p>
    <div class="truth">
      target wallet <strong>${esc(STATE.wallet.short)}</strong>
      &nbsp;|&nbsp; ${esc(STATE.rule.evidence)}
      &nbsp;|&nbsp; agent must answer <code>${esc(STATE.rule.final_line)}</code>
    </div>
    <div class="truth" style="margin-top:0.6rem">
      what the ledger actually says &mdash;
      30d realized <span class="neg">${usd(STATE.truth.realized_pnl_30d_usd)}</span>
      at a ${(STATE.truth.win_rate_30d * 100).toFixed(1)}% win rate,
      but the last 7d realized <span class="pos">${usd(STATE.truth.realized_pnl_7d_usd)}</span>
      at a ${(STATE.truth.win_rate_7d * 100).toFixed(0)}% win rate.
    </div>`;

  if (!ruleId) STATE.default_messages.forEach((m, i) => ($(`m${i}`).value = m));
  $('model').innerHTML = STATE.models.map((m) => `<option value="${m}">${m}</option>`).join('');
  $('rule').innerHTML = STATE.rules
    .map((r) => `<option value="${r.id}"${r.id === STATE.rule.id ? ' selected' : ''}>${esc(r.name)}</option>`)
    .join('');

  // Restore the most recent game from disk so a reload keeps the split screen.
  renderPanels(
    STATE.latest?.length ? STATE.latest : STATE.panels.map((panel) => ({ panel }))
  );
  renderIndex(STATE.index);
  renderHealth(STATE.health);
}

function renderPanels(items) {
  $('panels').innerHTML = items
    .map(({ panel, run, error, blocked_by_cap }) => {
      let body;
      if (error) {
        body = `<p><span class="badge err">${blocked_by_cap ? 'BLOCKED BY CAP' : 'ERROR'}</span></p>
                <p class="muted">${esc(error)}</p>`;
      } else if (!run) {
        body = `<p class="muted">Waiting for a con. Press "Send the con".</p>`;
      } else {
        const tools = run.tool_calls
          .map((c) => {
            const r = c.result ?? {};
            const key =
              r.realized_pnl_usd !== undefined
                ? `realized_pnl_usd = ${usd(r.realized_pnl_usd)}, win_rate = ${r.win_rate}`
                : r.total_realized_pnl_usd !== undefined
                  ? `total_realized_pnl_usd = ${usd(r.total_realized_pnl_usd)}, closed = ${r.total_closed_trades}`
                  : esc(r.error ?? 'ok');
            return `<div class="tool">Nansen ${esc(
              c.tool === 'get_pnl_summary' ? 'profiler/perp-pnl-summary' : 'profiler/perp-trades'
            )} (${esc(c.input.days)}d)<br>&rarr; ${key}</div>`;
          })
          .join('');
        const last = [...run.transcript].reverse().find((t) => t.role === 'agent' && t.text);
        const conned = run.outcome === 'CONNED';
        const answer =
          run.decision.allocation_pct !== undefined
            ? `${run.decision.allocation_pct}% of the slot` +
              ` <span class="muted">($${run.decision.allocation_usd.toLocaleString('en-US')})</span>`
            : run.decision.choice !== undefined
              ? `WALLET ${run.decision.choice}`
              : run.decision.decision === 'approve'
                ? 'COPY'
                : 'REFUSE';
        body = `
          <p>
            <span class="badge ${conned ? 'conned' : 'held'}">${run.outcome}</span>
            &nbsp;<strong>${answer}</strong>
            ${run.parsed_decision.malformed ? ' <span class="badge err">MALFORMED</span>' : ''}
          </p>
          ${tools || '<p class="muted">No tool calls: this agent has no evidence to pull.</p>'}
          <details open><summary>Final reply</summary>
            <div class="reply">${esc(last ? last.text : '')}</div>
          </details>
          <p class="muted">${run.model_calls} model calls &middot; referee rule
            <code>${esc(run.referee.rule)}</code></p>`;
      }
      return `<article>
        <header><strong>${esc(panel.label)}</strong><br>
          <small class="muted">${esc(panel.blurb)}</small></header>
        ${body}
      </article>`;
    })
    .join('');
}

function renderIndex(index) {
  if (!index.length) {
    $('index').innerHTML = '<p class="muted">No games stored yet for this rule.</p>';
    return;
  }
  const allocation = STATE.rule.scoreKind === 'allocation';
  const modes = [...new Set(index.flatMap((r) => Object.keys(r.modes)))].sort();
  const cell = (m, mode) => {
    const c = m.modes[mode];
    if (!c) return '<td class="muted">&mdash;</td>';
    if (allocation && c.mean_conceded_pct !== null) {
      return `<td><strong>${c.mean_conceded_pct}%</strong> <span class="muted">(${c.conned}/${c.n} conned)</span></td>`;
    }
    const pct = Math.round((c.conned / c.n) * 100);
    return `<td>${pct}% <span class="muted">(${c.conned}/${c.n})</span></td>`;
  };
  $('index').innerHTML = `<table>
    <thead><tr><th>model</th>${modes
      .map((m) => `<th>${m} ${esc(STATE.rule.scoreLabel)}</th>`)
      .join('')}<th>N</th></tr></thead>
    <tbody>${index
      .map(
        (m) =>
          `<tr><td><strong>${esc(m.model)}</strong></td>${modes
            .map((mode) => cell(m, mode))
            .join('')}<td>${m.n}</td></tr>`
      )
      .join('')}</tbody></table>`;
}

function renderHealth(h) {
  $('health').textContent =
    `snapshot ${h.snapshot_wallet.slice(0, 10)}... | ${h.snapshot_age_hours}h old | ` +
    `${h.snapshot_fills} fills, complete=${h.snapshot_complete} | data ${h.mode} | ` +
    `keys: ${h.keys_present.join(', ') || 'none'} | ` +
    `model calls ${JSON.stringify(h.model_calls_used)} of ${JSON.stringify(h.model_call_caps)} | ` +
    `${h.runs_loaded} runs loaded`;
}

$('composer').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('send');
  btn.setAttribute('aria-busy', 'true');
  btn.disabled = true;
  btn.textContent = 'Both agents are reading...';
  try {
    const res = await fetch('/api/play', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        rule: $('rule').value,
        model: $('model').value,
        messages: [$('m0').value, $('m1').value, $('m2').value],
      }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    renderPanels(data.panels);
    renderIndex(data.index);
    renderHealth(data.health);
  } catch (err) {
    renderPanels(STATE.panels.map((panel) => ({ panel, error: err.message })));
  } finally {
    btn.removeAttribute('aria-busy');
    btn.disabled = false;
    btn.textContent = 'Send the con';
  }
});

$('rule').addEventListener('change', (e) => boot(e.target.value));

boot();

/* Saves what is currently on screen to prototype/screenshots/ via the server.
   Used to keep visual evidence on disk; not part of the product surface. */
window.saveShot = async function (name = 'split.png') {
  if (!window.html2canvas) {
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
      s.onload = res;
      s.onerror = rej;
      document.head.appendChild(s);
    });
  }
  const canvas = await window.html2canvas(document.body, {
    backgroundColor: getComputedStyle(document.body).backgroundColor,
    width: 1280,
    windowWidth: 1280,
    scale: 1,
  });
  const r = await fetch('/api/screenshot', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, data_url: canvas.toDataURL('image/png') }),
  });
  return (await r.json()).path;
};
