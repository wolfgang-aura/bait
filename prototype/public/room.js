/**
 * The Pitch Room front end.
 *
 * Four screens and one rule: nothing on screen is invented here. The tiles carry only
 * what the server sends as hype, the truth screen carries only what the server sends
 * after the pick, and the evidence log prints an endpoint only when the server reports
 * a tool call that really happened. The desk's full reply lives in the transcript
 * drawer so the short bubble line stays auditable.
 *
 * `?state=roster|truth|shot2|final` renders a frozen state without starting a round or
 * making a model call, so a headless browser that cannot click can still capture every
 * screen. `&prospect=<id>` picks whose screen it renders. Documented in
 * prototype/DESIGN.md, Version D.
 */
import { portraitSvg } from '/portraits.js';

const $ = id => document.getElementById(id);
const body = document.body;
let reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
// A fixture screen is there to be photographed, so nothing on it is mid-tween.
const freeze = () => { reduced = true; document.documentElement.dataset.frozen = 'true'; };

const el = {
  badge: $('evidence-badge'),
  grid: $('roster-grid'), caller: $('caller'), callerLine: $('caller-line'), callerMeta: $('caller-meta'),
  truthScreen: $('truth-screen'), truthPortrait: $('truth-portrait'), truthName: $('truth-name'),
  truthHandle: $('truth-handle'), truthHype: $('truth-hype'), truthHypeCaption: $('truth-hype-caption'),
  truthHypeSource: $('truth-hype-source'), recordHalf: $('record-half'), turnCard: $('turn-card'),
  truthPnl: $('truth-pnl'), truthPnlCaption: $('truth-pnl-caption'), truthRows: $('truth-rows'),
  truthPaper: $('truth-paper'), truthEndpoint: $('truth-endpoint'), truthScope: $('truth-scope'),
  truthCaptured: $('truth-captured'), truthDisclosure: $('truth-disclosure'), truthReport: $('truth-report'),
  sell: $('sell'), back: $('back'),
  meter: $('meter-fill'), trail: $('meter-trail'), suspicion: $('suspicion'),
  funded: $('funded'), pop: $('pop'), slotSub: $('slot-sub'), pips: $('pips'),
  meridian: $('meridian-portrait'), bubble: $('bubble'), nansen: $('nansen'), ticker: $('ticker'),
  clientPortrait: $('client-portrait'), clientName: $('client-name'), clientSub: $('client-sub'),
  facts: $('facts'), buried: $('buried'), buriedValue: $('buried-value'), buriedLabel: $('buried-label'),
  clean: $('clean'),
  composer: $('composer'), line: $('line'), go: $('go'), count: $('count'), status: $('status'),
  wireWho: $('wire-who'), wireAmount: $('wire-amount'), stamp: $('stamp'),
  finalHead: $('final-head'), finalSub: $('final-sub'), agentLine: $('agent-line'), finalReport: $('final-report'),
  initials: $('initials'), submitScore: $('submit-score'), scoreStatus: $('score-status'),
  scoreEntry: $('score-entry'), boardList: $('board-list'), again: $('again'),
  transcript: $('transcript-body'), bootError: $('boot-error'),
};

const SCREENS = { roster: 'roster-screen', truth: 'truth-screen', playing: 'stage-screen', final: 'final-screen' };

const dollars = n => `$${Math.round(Number(n) || 0).toLocaleString('en-US')}`;
const text = (node, value) => { node.textContent = value ?? ''; };

let roster = [];
let focused = 0;
let chosen = null;
let dossier = null;
let round = null;
let shots = [];
let sending = false;
let fundedShown = 0;
let boardEntries = [];

// ------------------------------------------------------------- transport

async function api(path, options = {}) {
  const res = await fetch(path, {
    method: options.method ?? 'GET',
    headers: options.body ? { 'content-type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(payload.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return payload;
}

function show(phase) {
  body.dataset.phase = phase;
  for (const [name, id] of Object.entries(SCREENS)) $(id).hidden = name !== phase;
}

/** One accent drives the tile, the wash, the rim light and the name plate. */
function setAccent(accent) {
  document.documentElement.style.setProperty('--accent', accent);
}

// ------------------------------------------------------- 1. pick a hero

function renderRoster(tiles) {
  roster = tiles;
  el.grid.replaceChildren();
  tiles.forEach((p, i) => {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'tile';
    tile.style.setProperty('--accent', p.accent);
    tile.setAttribute('role', 'option');
    tile.setAttribute('aria-selected', 'false');
    tile.dataset.id = p.id;
    const art = document.createElement('span');
    art.className = 'tile-art';
    art.innerHTML = portraitSvg(p.portrait, { mood: 'idle', accent: p.accent, title: p.name, crop: 'face' });
    const chip = document.createElement('span');
    chip.className = 'venue-chip';
    chip.textContent = p.venueLabel;
    art.append(chip);

    const info = document.createElement('span');
    info.className = 'tile-info';
    const value = document.createElement('b');
    value.textContent = p.hype.value;
    const caption = document.createElement('i');
    caption.textContent = [p.hype.caption, p.hype.sub].filter(Boolean).join(' · ');
    const name = document.createElement('strong');
    name.textContent = p.name;
    const sub = document.createElement('span');
    sub.textContent = p.handle ? `${p.handle} · ${p.short}` : p.short;
    info.append(value, caption, name, sub);

    tile.append(art, info);
    tile.addEventListener('mouseenter', () => focus(i));
    tile.addEventListener('focus', () => focus(i));
    tile.addEventListener('click', () => { focus(i); pick(); });
    el.grid.append(tile);
  });
  focus(0);
}

function focus(index) {
  focused = (index + roster.length) % roster.length;
  const p = roster[focused];
  [...el.grid.children].forEach((tile, i) => {
    tile.setAttribute('aria-selected', String(i === focused));
    const bust = tile.querySelector('.bust');
    if (bust) bust.dataset.x = i === focused ? 'confident' : 'idle';
  });
  setAccent(p.accent);
  el.caller.style.setProperty('--accent', p.accent);
  text(el.callerLine, p.voice);
  text(el.callerMeta, [
    // The venue and the chain are the same word on Hyperliquid, so say it once.
    p.chain === p.venueLabel ? p.venueLabel : `${p.venueLabel} · ${p.chain}`,
    p.hype.source,
    { capture: 'truth from a Nansen capture', fixture: 'truth is a fixture, not yet captured', recorded: 'truth from a recorded Fomo Radar response' }[p.truth_available],
  ].join('  ·  '));
}

async function pick() {
  const p = roster[focused];
  el.grid.querySelectorAll('.tile').forEach(t => { t.disabled = true; });
  try {
    const state = await api('/api/room/start', { method: 'POST', body: { prospect: p.id } });
    adopt(state);
    showTruth(state.prospect);
  } catch (err) {
    el.bootError.hidden = false;
    text(el.bootError, `The round could not start: ${err.message}`);
  } finally {
    el.grid.querySelectorAll('.tile').forEach(t => { t.disabled = false; });
  }
}

// ---------------------------------------------------------- 2. the truth

function showTruth(p) {
  chosen = p;
  setAccent(p.accent);
  show('truth');
  // The camera follows the number, not the verdict: a losing record catches them in
  // the light, a gain leaves them smiling. The verdict speaks through the report below.
  const losing = p.truth.pnl < 0;
  el.truthPortrait.innerHTML = portraitSvg(p.portrait, {
    mood: losing ? 'caught' : 'confident', accent: p.accent, title: p.name, crop: 'face',
  });
  text(el.truthName, p.name);
  text(el.truthHandle, p.handle ? `${p.handle} · ${p.short}` : `no display name · ${p.short}`);
  text(el.truthHype, p.hype.value);
  text(el.truthHypeCaption, [p.hype.caption, p.hype.sub].filter(Boolean).join(' · '));
  text(el.truthHypeSource, p.hype.source);

  el.recordHalf.classList.toggle('bad', losing);
  el.recordHalf.classList.toggle('good', !losing);

  text(el.truthPnl, p.truth.pnlLabel);
  text(el.truthPnlCaption, p.truth.pnlCaption);
  el.truthRows.replaceChildren();
  for (const row of p.truth.rows) {
    const dt = document.createElement('dt');
    dt.textContent = row.label;
    const dd = document.createElement('dd');
    dd.textContent = row.value;
    el.truthRows.append(dt, dd);
  }

  // The Fomo four get the three numbers on one line: that is the reveal.
  el.truthPaper.hidden = !p.truth.paper;
  if (p.truth.paper) {
    el.truthPaper.replaceChildren();
    for (const [label, value] of [
      [p.truth.paper.headlineLabel, p.truth.paper.headlineValue],
      [p.truth.paper.realisedLabel, p.truth.paper.realisedValue],
      [p.truth.paper.label, p.truth.paper.value],
    ]) {
      const strong = document.createElement('b');
      strong.textContent = value;
      const span = document.createElement('span');
      span.textContent = ` ${label}. `;
      el.truthPaper.append(strong, span);
    }
  }
  text(el.truthEndpoint, p.truth.endpointLine);
  text(el.truthScope, p.truth.scope);
  text(el.truthCaptured, `captured ${p.truth.capturedLabel}${p.truth.availability === 'fixture' ? ' · fixture, not yet captured' : ''}`);
  el.truthDisclosure.hidden = !p.truth.disclosure;
  text(el.truthDisclosure, p.truth.disclosure);

  renderReport(el.truthReport, p.risk);
  text(el.sell, p.risk.verdict === 'block' ? 'Sell them anyway' : 'Sell them');
  if (!reduced) { el.turnCard.style.animation = 'none'; void el.turnCard.offsetWidth; el.turnCard.style.animation = ''; }
}

/**
 * BAIT's copy-risk report, in the words the server wrote. A check that could not run
 * says so; it is never quietly counted as a pass.
 */
function renderReport(host, risk) {
  host.replaceChildren();
  const add = (kind, label, line) => {
    const row = document.createElement('div');
    row.className = `flagline ${kind}`;
    const b = document.createElement('b');
    b.textContent = label;
    const span = document.createElement('span');
    span.textContent = line;
    row.append(b, span);
    host.append(row);
  };
  if (!risk.flags.length) {
    add('none', 'clear', 'Nothing on this record trips a BAIT check.');
  }
  for (const flag of risk.flags) add(flag.severity, flag.severity, flag.plain);

  const foot = document.createElement('p');
  foot.className = 'report-foot';
  foot.textContent = [
    `${risk.source}, captured ${risk.capturedLabel}`,
    risk.basis,
    risk.coverage,
    risk.not_assessed.length ? `Not assessed: ${risk.not_assessed.map(n => n.id.replace(/_/g, ' ')).join(', ')}.` : '',
  ].filter(Boolean).join('  ·  ');
  host.append(foot);
}

// ------------------------------------------------------ 3. the pitch room

function enterRoom() {
  show('playing');
  renderDossier(dossier);
  el.line.disabled = false;
  el.line.focus();
}

function renderDossier(d) {
  text(el.slotSub, dollars(d.slot));
  el.meridian.innerHTML = portraitSvg('meridian', { mood: 'neutral', accent: d.accent, title: 'MERIDIAN, the AI allocation desk' });
  el.clientPortrait.innerHTML = portraitSvg(d.portrait, { mood: 'confident', accent: d.accent, title: d.name, crop: 'face' });
  text(el.clientName, d.name);
  text(el.clientSub, `${d.venueLabel} · ${d.trader}`);
  text(el.ticker.firstElementChild, `${d.name}   ${d.endpoints.join('   ')}   captured ${String(d.capturedAt).slice(0, 10)}   `.repeat(3).toUpperCase());

  el.facts.replaceChildren();
  for (const fact of d.facts) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'fact';
    const value = document.createElement('strong');
    value.textContent = fact.value;
    // A fact is ammunition whichever way it points, but a loss is never printed green.
    if (fact.value.startsWith('-')) value.classList.add('down');
    const label = document.createElement('span');
    label.textContent = fact.label;
    chip.append(value, label);
    chip.addEventListener('click', () => insertFact(fact.insert));
    el.facts.append(chip);
  }
  el.buried.hidden = !d.buried;
  if (d.buried) {
    text(el.buriedValue, d.buried.value);
    text(el.buriedLabel, d.buried.label);
  }
  el.clean.hidden = !d.clean;
  text(el.clean, d.clean);
  updateCount();
}

function insertFact(sentence) {
  if (el.line.disabled) return;
  const current = el.line.value.trim();
  el.line.value = (current ? `${current} ${sentence}` : sentence).slice(0, dossier?.maxPitch ?? 200);
  el.line.focus();
  updateCount();
}

function updateCount() {
  text(el.count, `${el.line.value.length} / ${dossier?.maxPitch ?? 200}`);
}

/** Count the funded figure up to its new value, and pop the damage number. */
function rollFunded(to) {
  const from = fundedShown;
  fundedShown = to;
  el.funded.classList.toggle('zero', to === 0);
  if (to > from) {
    text(el.pop, `+${dollars(to - from)}`);
    el.pop.classList.remove('go');
    void el.pop.offsetWidth;
    el.pop.classList.add('go');
  }
  if (reduced || from === to) { text(el.funded, dollars(to)); return; }
  const started = performance.now();
  const step = now => {
    const t = Math.min(1, (now - started) / 700);
    text(el.funded, dollars(from + (to - from) * (1 - Math.pow(1 - t, 3))));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function setSuspicion(value) {
  el.meter.style.width = `${value}%`;
  el.trail.style.width = `${value}%`;
  el.meter.classList.toggle('hot', value >= 66);
  el.meter.classList.toggle('warm', value >= 34 && value < 66);
  text(el.suspicion, String(value));
}

function setMood(mood) {
  const bust = el.meridian.querySelector('.bust');
  if (bust) bust.dataset.x = mood;
  const client = el.clientPortrait.querySelector('.bust');
  if (client) client.dataset.x = mood === 'caught' ? 'caught' : mood === 'sold' ? 'sold' : 'confident';
  body.dataset.mood = mood;
}

function say(line, { thinking = false } = {}) {
  el.bubble.classList.toggle('thinking', thinking);
  text(el.bubble, line);
  if (!reduced) { el.bubble.style.animation = 'none'; void el.bubble.offsetWidth; el.bubble.style.animation = ''; }
}

/**
 * The evidence log. Every row corresponds to a tool call the desk actually made, and
 * an empty log says so plainly rather than implying a lookup that never happened.
 */
function renderChecks(checks, when = 'idle') {
  el.nansen.replaceChildren();
  if (!checks?.length) {
    const idle = document.createElement('span');
    idle.className = 'nansen-idle';
    idle.textContent = {
      idle: 'Evidence checks appear here when the desk goes looking.',
      thinking: 'Waiting to see whether MERIDIAN checks the record.',
      answered: 'MERIDIAN answered without checking the record.',
    }[when];
    el.nansen.append(idle);
    return;
  }
  for (const check of checks) {
    const row = document.createElement('div');
    const head = document.createElement('span');
    head.textContent = check.finding ? 'read ' : 'checking ';
    const endpoint = document.createElement('b');
    endpoint.textContent = check.endpoint;
    row.append(head, endpoint);
    if (check.finding) {
      const found = document.createElement('span');
      found.className = 'done';
      found.textContent = ` · ${check.finding}`;
      row.append(found);
    }
    el.nansen.append(row);
  }
}

function renderPips(used, burned) {
  [...el.pips.children].forEach((pip, i) => {
    pip.className = '';
    if (burned.includes(i)) pip.classList.add('burned');
    else if (i < used) pip.classList.add('spent');
    else if (i === used) pip.classList.add('live');
  });
}

/** Take a round state and draw everything that follows from it. */
function adopt(state) {
  round = state;
  shots = state.shots ?? [];
  dossier = state.dossier;
  if (state.prospect) { chosen = state.prospect; setAccent(state.prospect.accent); }
  return state;
}

function renderState(state) {
  adopt(state);
  rollFunded(state.funded);
  setSuspicion(state.suspicion);
  setMood(state.mood);
  say(state.line);
  renderChecks(state.checks, state.shotsUsed > 0 ? 'answered' : 'idle');
  renderPips(state.shotsUsed, shots.flatMap((s, i) => (s.caught ? [i] : [])));
  el.go.textContent = state.finished ? 'See the damage' : `Pitch (${state.shotsLeft} left)`;
  el.line.disabled = state.finished;
}

async function pitch() {
  if (sending || !round) return;
  const line = el.line.value.trim();
  if (!line) { fail('Say something first.'); return; }
  sending = true;
  el.go.disabled = true;
  el.line.disabled = true;
  text(el.go, 'Sending...');
  text(el.status, '');
  el.status.classList.remove('bad');
  say('Reading your line...', { thinking: true });
  renderChecks([], 'thinking');
  const stop = watch(round.id);
  try {
    const state = await api(`/api/room/${round.id}/pitch`, {
      method: 'POST',
      body: {
        requestId: `shot-${round.id.slice(0, 8)}-${round.shotsUsed}-${Date.now()}`,
        shot: round.shotsUsed,
        text: line,
      },
    });
    stop();
    renderState(state);
    el.line.value = '';
    updateCount();
    const last = state.shots[state.shots.length - 1];
    if (last?.caught) text(el.status, 'Caught. That claim is not in the record.');
    if (state.finished) await finish();
  } catch (err) {
    stop();
    fail(err.message);
    say(round.line);
    renderChecks(round.checks, round.shotsUsed > 0 ? 'answered' : 'idle');
    text(el.go, round ? `Pitch (${round.shotsLeft} left)` : 'Pitch');
  } finally {
    sending = false;
    el.go.disabled = false;
    el.line.disabled = !!round?.finished;
    if (!round?.finished) el.line.focus();
  }
}

/** Poll the round while a shot is in flight, so the evidence log fills in live. */
function watch(id) {
  const timer = setInterval(async () => {
    try {
      const state = await api(`/api/room/${id}`);
      if (!state.busy) return;
      renderChecks(state.checks);
      say(state.phase ? `${state.phase}...` : 'Reading your line...', { thinking: true });
    } catch { /* a dropped poll is not a game error */ }
  }, 700);
  return () => clearInterval(timer);
}

// ----------------------------------------------------------- 4. the gate

async function finish() {
  const result = await api(`/api/room/${round.id}/finish`, { method: 'POST', body: {} });
  showFinal(result.final, result.leaderboard);
  renderTranscript();
}

function showFinal(final, entries, mineAt = null) {
  show('final');
  text(el.wireWho, final.prospect.name);
  text(el.wireAmount, final.fundedLabel);
  el.stamp.className = `stamp ${final.verdict === 'caution' ? 'caution' : final.verdict === 'allow' ? 'cleared' : ''}`;
  text(el.stamp, final.stamp);
  text(el.finalHead, final.headline);
  text(el.finalSub, final.subline);
  text(el.agentLine, final.agentLine);
  renderReport(el.finalReport, final.risk);
  renderBoard(entries, mineAt);
  if (final.verdict === 'block' && !reduced) {
    body.classList.remove('shake');
    void body.offsetWidth;
    body.classList.add('shake');
  }
}

function renderBoard(entries, mineAt = null) {
  el.boardList.replaceChildren();
  if (!entries?.length) {
    const empty = document.createElement('li');
    empty.className = 'board-empty';
    empty.textContent = 'No cons posted yet. Be the first.';
    el.boardList.append(empty);
    return;
  }
  entries.forEach((entry, i) => {
    const row = document.createElement('li');
    if (mineAt && entry.at === mineAt) row.classList.add('mine');
    for (const [cls, value] of [
      ['rank', String(i + 1).padStart(2, '0')],
      ['who-i', entry.initials],
      ['amt', dollars(entry.amount)],
      ['sold', entry.prospect],
      ['said', entry.line || '(no line)'],
    ]) {
      const cell = document.createElement('span');
      cell.className = cls;
      cell.textContent = value;
      row.append(cell);
    }
    el.boardList.append(row);
  });
}

function renderTranscript() {
  el.transcript.replaceChildren();
  for (const shot of shots) {
    const block = document.createElement('div');
    block.className = 'transcript-shot';
    const you = document.createElement('p');
    you.className = 'said-you';
    you.textContent = `${shot.n}. You: ${shot.text}`;
    const desk = document.createElement('p');
    desk.textContent = `MERIDIAN: ${shot.full || shot.line}`;
    const meta = document.createElement('code');
    meta.textContent = [
      `allocation ${dollars(shot.allocation)}`,
      `mood ${shot.mood}`,
      `suspicion ${shot.suspicionBefore} to ${shot.suspicion}`,
      ...(shot.checks ?? []).map(c => c.endpoint),
      shot.caught ? 'claim rejected' : shot.check,
    ].join(' · ');
    block.append(you, desk, meta);
    el.transcript.append(block);
  }
}

async function postScore() {
  if (!round) return;
  const initials = el.initials.value.trim();
  if (!initials) { text(el.scoreStatus, 'Type up to three characters.'); return; }
  el.submitScore.disabled = true;
  try {
    const result = await api(`/api/room/${round.id}/finish`, { method: 'POST', body: { initials } });
    renderBoard(result.leaderboard, result.placed?.at ?? null);
    text(el.scoreStatus, result.placed ? `Posted as ${result.placed.initials}.` : 'Already posted.');
    el.scoreEntry.querySelectorAll('input, button').forEach(node => { node.disabled = true; });
  } catch (err) {
    text(el.scoreStatus, err.message);
    el.submitScore.disabled = false;
  }
}

function fail(message) {
  text(el.status, message);
  el.status.classList.add('bad');
}

// --------------------------------------------------------------- fixtures

/**
 * Frozen states for capture. No round is started, no model call is made and no
 * leaderboard row is written. The prospect's real hype, truth and copy-risk report are
 * read from /api/room/roster and a second frozen read, so the only invented part of
 * these screens is the conversation.
 */
async function fixture(name, prospectId) {
  freeze();
  const target = roster.find(p => p.id === prospectId) ?? roster[0];
  focus(roster.indexOf(target));
  if (name === 'roster') return;

  const assessed = await api(`/api/assess?address=${encodeURIComponent(target.wallet ?? target.id)}&handle=${encodeURIComponent(target.handle ?? target.id)}`)
    .catch(() => null);
  const state = await api('/api/room/start', { method: 'POST', body: { prospect: target.id } });
  adopt(state);

  if (name === 'truth') { showTruth(state.prospect); return; }

  if (name === 'shot2') {
    renderState({
      ...state, shotsUsed: 2, shotsLeft: 1, funded: 3750, suspicion: 24, mood: 'intrigued',
      line: 'A win rate over that sample is a process, not luck.',
      checks: [
        { endpoint: state.dossier.endpoints[0], label: 'evidence read', finding: `${state.dossier.lossLabel} realised PnL` },
        ...(state.dossier.endpoints[1] ? [{ endpoint: state.dossier.endpoints[1], label: 'trade history', finding: 'record returned' }] : []),
      ],
    });
    enterRoom();
    el.line.value = state.dossier.facts[0].insert;
    el.line.disabled = false;
    updateCount();
    return;
  }

  if (name === 'final') {
    const risk = state.prospect.risk;
    const funded = 6250;
    const executed = risk.verdict === 'block' ? 0 : funded;
    shots = state.dossier.facts.slice(0, 3).map((fact, i) => ({
      n: i + 1, text: fact.insert, full: 'Reasoning about the record.', line: 'Reasoning about the record.',
      mood: 'neutral', allocation: executed, suspicionBefore: 30, suspicion: 42, checks: [], check: 'ai-checked', caught: false,
    }));
    showFinal({
      funded, fundedLabel: dollars(funded), executed, executedLabel: dollars(executed),
      verdict: risk.verdict, blocked: risk.verdict === 'block',
      stamp: { block: 'BLOCKED', caution: 'CAUTION', allow: 'CLEARED' }[risk.verdict],
      prospect: { id: target.id, name: target.name, handle: target.handle, venueLabel: target.venueLabel },
      headline: risk.verdict === 'block'
        ? `You conned MERIDIAN out of ${dollars(funded)}.`
        : `You sold MERIDIAN ${dollars(funded)} of ${target.name}.`,
      subline: { block: `BAIT let through ${dollars(executed)}.`, caution: `The guard allowed ${dollars(executed)}. The recorded report still found concerns.`, allow: 'BAIT let it through. Nothing to catch.' }[risk.verdict],
      agentLine: assessed?.agent_line ?? '',
      risk,
    }, boardEntries);
    renderTranscript();
  }
}

// ------------------------------------------------------------------- boot

async function boot() {
  el.line.addEventListener('input', updateCount);
  el.line.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); el.composer.requestSubmit(); }
  });
  el.composer.addEventListener('submit', event => { event.preventDefault(); pitch(); });
  el.grid.addEventListener('keydown', event => {
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 4, ArrowUp: -4 }[event.key];
    if (step) { event.preventDefault(); focus(focused + step); el.grid.children[focused].focus(); return; }
    if (event.key === 'Home') { event.preventDefault(); focus(0); el.grid.children[0].focus(); }
    if (event.key === 'End') { event.preventDefault(); focus(roster.length - 1); el.grid.children[focused].focus(); }
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); pick(); }
  });
  el.sell.addEventListener('click', enterRoom);
  el.back.addEventListener('click', () => { show('roster'); focus(focused); });
  el.submitScore.addEventListener('click', postScore);
  el.again.addEventListener('click', () => { window.location.href = window.location.pathname; });

  try {
    const config = await api('/api/room');
    renderRoster(config.roster);
    boardEntries = config.leaderboard ?? [];
    renderBoard(boardEntries);
    const live = config.evidence.live;
    el.badge.textContent = live ? 'live Nansen' : 'frozen capture';
    el.badge.classList.toggle('live', live);
    if (config.health && config.health.ready === false) {
      fail(config.health.capReached ? 'Today’s live rounds are used up.' : 'The desk is offline right now.');
    }
  } catch (err) {
    el.bootError.hidden = false;
    text(el.bootError, `The room could not load: ${err.message}`);
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const state = params.get('state');
  if (state) await fixture(state, params.get('prospect'));
}

boot();
