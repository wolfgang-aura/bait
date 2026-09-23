/**
 * The Pitch Room front end.
 *
 * The roster is the front door. The Fomo cold open is a side proof at `/?view=fomo`.
 * Every wire the desk commits is drawn the moment the server's gate decides it, from
 * the shot's `wire` object; the page computes no gate result of its own.
 *
 * Five screens and one rule: nothing on screen is invented here. The cold open carries
 * only what /api/opener sends, the tiles carry only
 * what the server sends as hype, the truth screen carries only what the server sends
 * after the pick, and the evidence log prints an endpoint only when the server reports
 * a tool call that really happened. The desk's full reply lives in the transcript
 * drawer so the short bubble line stays auditable.
 *
 * `?state=opener|opener-reveal|roster|truth|shot2|final` renders a frozen state without starting a round or
 * making a model call, so a headless browser that cannot click can still capture every
 * screen. `&prospect=<id>` picks whose screen it renders. Documented in
 * prototype/DESIGN.md, Version D.
 */
import { portraitSvg } from '/portraits.js';
import { openerComparison } from '/opener-view.js';

const $ = id => document.getElementById(id);
const body = document.body;
let reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
// A fixture screen is there to be photographed, so nothing on it is mid-tween.
const freeze = () => { reduced = true; document.documentElement.dataset.frozen = 'true'; };

const el = {
  badge: $('evidence-badge'),
  openerEyebrow: $('opener-eyebrow'), openerGrid: $('opener-grid'), openerHint: $('opener-hint'),
  openerRanked: $('opener-ranked'), openerAfter: $('opener-after'), openerPunchline: $('opener-punchline'),
  openerComparison: $('opener-comparison'),
  openerPunchlineSub: $('opener-punchline-sub'), openerGo: $('opener-go'), openerFoot: $('opener-foot'),
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
  facts: $('facts'), nextFact: $('next-fact'), sealed: $('sealed'), sealedHead: $('sealed-head'),
  sealedLabel: $('sealed-label'), premiseName: $('premise-name'), premiseSlot: $('premise-slot'),
  revealStamp: $('reveal-stamp'), revealTitle: $('reveal-title'), revealSub: $('reveal-sub'),
  revealWhy: $('reveal-why'), revealQuotes: $('reveal-quotes'), hypeLabel: $('hype-label'), recordLabel: $('record-label'),
  ladderModel: $('ladder-model'),
  composer: $('composer'), line: $('line'), go: $('go'), count: $('count'), status: $('status'),
  stopped: $('stopped'), stoppedSub: $('stopped-sub'),
  intercept: $('intercept'), icptN: $('icpt-n'), icptTo: $('icpt-to'), icptAmt: $('icpt-amt'),
  icptStamp: $('icpt-stamp'), icptWhy: $('icpt-why'),
  wireKind: $('wire-kind'), wireStopped: $('wire-stopped'), finalTrail: $('final-trail'), wireLog: $('wire-log'),
  ladder: $('ladder'), ladderHead: $('ladder-head'), frontBoard: $('front-board'),
  wireWho: $('wire-who'), wireAmount: $('wire-amount'), stamp: $('stamp'),
  finalHead: $('final-head'), finalSub: $('final-sub'), agentLine: $('agent-line'), finalReport: $('final-report'), finalGate: $('final-gate'),
  initials: $('initials'), submitScore: $('submit-score'), scoreStatus: $('score-status'),
  scoreEntry: $('score-entry'), boardList: $('board-list'), again: $('again'),
  transcript: $('transcript-body'), bootError: $('boot-error'),
};

const SCREENS = {
  opener: 'opener-screen', roster: 'roster-screen',
  truth: 'truth-screen', playing: 'stage-screen', final: 'final-screen',
};

const dollars = n => `$${Math.round(Number(n) || 0).toLocaleString('en-US')}`;
const text = (node, value) => { node.textContent = value ?? ''; };

let roster = [];
let opener = null;
let openerFocus = 0;
let openerPick = null;
let focused = 0;
let chosen = null;
let dossier = null;
let round = null;
let shots = [];
let sending = false;
let fundedShown = 0;
let boardEntries = [];
let wiresShown = 0;

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

// ------------------------------------------------------- 0. the cold open

/**
 * The pick screen. Seven cards carrying exactly what Fomo carries about these accounts:
 * the handle, the follower count and the profile headline PnL. Nothing is computed here
 * and nothing about the tape is drawn until the player has chosen.
 */
/**
 * The seven are drawn with the roster's archetype busts, three of which they share.
 * None is a likeness; the accent is the one thing on the card that is the trader's.
 */
const OPENER_CAST = {
  unipcs: ['unipcs', '#8B7BFF'],
  dumbcrayoneater: ['crayon', '#C6E24A'],
  frankdegods: ['frank', '#E0C46C'],
  orangie: ['orangie', '#FFA62B'],
  theveeman: ['veeman', '#3FD3C4'],
  econoar: ['econoar', '#4CD37A'],
  notanicecat69: ['nicecat', '#FF5FA8'],
};

function renderOpener(data) {
  opener = data;
  text(el.openerEyebrow, [
    `${data.pick.length} of the most followed traders on Fomo`,
    data.scope,
    `recorded ${data.capturedRange}`,
  ].join('  ·  '));
  text(el.openerFoot, [
    `Follower count and headline PnL are the account's own Fomo profile figures.`,
    `The ranking below them is recomputed from the recorded ${data.source} tape:`,
    `realised PnL is the sum of the positions that were actually sold, and a tape with fewer`,
    `than ${data.minSoldToRank} sold positions is labelled a thin sample rather than ranked.`,
    `The busts are the game's archetypes, not likenesses.`,
  ].join(' '));

  el.openerGrid.replaceChildren();
  // The bar under each follower count is that count against the biggest one on the
  // board. It is the same number drawn twice, so a viewer sees the order at a glance
  // without reading seven figures.
  const widest = Math.max(...data.pick.map(t => t.followers));
  data.pick.forEach((t, i) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'card';
    card.setAttribute('role', 'option');
    card.setAttribute('aria-selected', 'false');
    card.dataset.handle = t.handle;
    const [portrait, accent] = OPENER_CAST[t.handle.toLowerCase()] ?? ['grinder', '#FFB020'];
    card.style.setProperty('--accent', accent);
    const art = document.createElement('span');
    art.className = 'tile-art card-art';
    art.innerHTML = portraitSvg(portrait, { mood: 'idle', accent, title: `@${t.handle}`, crop: 'face' });
    const body = document.createElement('span');
    body.className = 'card-body';
    card.append(art, body);
    for (const [cls, value, tag] of [
      ['at', `@${t.handle}`, 'span'],
      ['crowd', t.followersLabel, 'span'],
      ['crowd-label', 'followers', 'span'],
    ]) {
      const node = document.createElement(tag);
      node.className = cls;
      node.textContent = value;
      body.append(node);
    }
    const bar = document.createElement('span');
    bar.className = 'crowd-bar';
    const fill = document.createElement('i');
    fill.style.width = `${(t.followers / widest) * 100}%`;
    bar.append(fill);
    body.append(bar);
    for (const [cls, value] of [['head-pnl', t.headlineLabel], ['head-label', 'Fomo profile PnL']]) {
      const node = document.createElement('span');
      node.className = cls;
      node.textContent = value;
      body.append(node);
    }
    card.addEventListener('mouseenter', () => focusOpener(i));
    card.addEventListener('focus', () => focusOpener(i));
    card.addEventListener('click', () => { focusOpener(i); revealOpener(); });
    el.openerGrid.append(card);
  });
  focusOpener(0);
}

function focusOpener(index) {
  if (!opener?.pick.length) return;
  openerFocus = (index + opener.pick.length) % opener.pick.length;
  [...el.openerGrid.children].forEach((card, i) => {
    card.setAttribute('aria-selected', String(i === openerFocus));
    const bust = card.querySelector('.bust');
    if (bust) bust.dataset.x = i === openerFocus ? 'confident' : 'idle';
  });
}

/**
 * The flip. The same seven, reordered by realised PnL on sold positions, each carrying
 * one hard truth generated from its own tape and the source and capture date behind it.
 */
function revealOpener() {
  if (!opener || openerPick) return;
  openerPick = opener.pick[openerFocus].handle;

  // The line under the reveal answers the pick: the server sent one per handle, so a
  // player who found the one tape that sells is told so instead of being lectured.
  const said = opener.punchlines?.[openerPick];
  text(el.openerPunchline, said?.lead ?? opener.punchline);
  el.openerPunchline.classList.toggle('right', said?.id === 'found_it');
  el.openerPunchlineSub.hidden = !said?.tail;
  text(el.openerPunchlineSub, said?.tail);

  el.openerGrid.hidden = true;
  el.openerHint.hidden = true;
  el.openerRanked.hidden = false;
  el.openerAfter.hidden = false;
  el.openerRanked.replaceChildren();

  opener.reveal.forEach((t, i) => {
    const row = document.createElement('li');
    row.className = [
      t.thinSample ? 'thin' : t.realised < 0 ? 'down' : 'up',
      t.handle === openerPick ? 'mine' : '',
    ].filter(Boolean).join(' ');
    if (!reduced) row.style.animationDelay = `${i * 70}ms`;

    const place = document.createElement('span');
    place.className = 'place';
    place.textContent = t.rankLabel;
    if (t.best) {
      const chip = document.createElement('b');
      chip.className = 'best-chip';
      chip.textContent = 'best on the tape';
      place.append(document.createElement('br'), chip);
    }
    const who = document.createElement('span');
    who.className = 'who-at';
    who.textContent = `@${t.handle}`;
    const crowd = document.createElement('em');
    // The player's own choice is named beside the handle rather than stacked under the
    // rank, so the row it lands on is no taller than the other six.
    crowd.textContent = t.handle === openerPick
      ? `${t.followersLabel} followers  ·  your pick`
      : `${t.followersLabel} followers`;
    who.append(crowd);

    const got = document.createElement('span');
    got.className = `got ${t.realised > 0 ? 'pos' : t.realised < 0 ? 'neg' : ''}`.trim();
    got.textContent = t.realisedLabel;
    const gotSub = document.createElement('em');
    gotSub.textContent = `realised, ${t.sold} sold`;
    got.append(gotSub);

    const truth = document.createElement('span');
    truth.className = 'truth';
    const label = document.createElement('b');
    label.textContent = t.hardTruth.label;
    const line = document.createElement('span');
    line.textContent = t.hardTruth.line;
    truth.append(label, line);

    // The supporting figures and the provenance, full width under the four columns, so
    // every card names the source and the capture date its numbers came out of.
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = [
      `headline ${t.headlineLabel}`,
      `paper ${t.paperLabel} across ${t.open} open`,
      `${t.fullyClosed} of ${t.sold} fully closed`,
      `win rate ${t.winRateLabel}`,
      t.sourceLine,
    ].join('  ·  ');

    row.append(place, who, got, truth, meta);
    el.openerRanked.append(row);
  });

  el.openerComparison.replaceChildren();
  for (const trader of openerComparison(opener.reveal, openerPick)) {
    const index = opener.reveal.indexOf(trader);
    const card = el.openerRanked.children[index].cloneNode(true);
    card.style.animationDelay = '0ms';
    card.querySelector('.place').textContent = trader.handle === openerPick ? 'Your pick' : 'Highest realised';
    el.openerComparison.append(card);
  }

  // The reveal is the whole point of the screen, so the page stays at the top of it
  // rather than jumping to the button that has just taken focus.
  el.openerGo.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
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
    // Straight into the room. The record is the reveal, so it waits for BAIT's check.
    const state = await api('/api/room/start', { method: 'POST', body: { prospect: p.id } });
    adopt(state);
    enterRoom();
  } catch (err) {
    el.bootError.hidden = false;
    text(el.bootError, `The round could not start: ${err.message}`);
  } finally {
    el.grid.querySelectorAll('.tile').forEach(t => { t.disabled = false; });
  }
}

// ------------------------------------------------ 4. the reveal: BAIT's check

/**
 * The reveal. BAIT's decision on the one transfer comes first, then what was pitched
 * against what was left out, then the rest of the report. Every word and figure is the
 * server's `final` object and the prospect record it sent with the verdict.
 */
function showReveal(p, final) {
  const kind = final.peak === 0 ? 'none' : final.verdict === 'block' ? 'blocked' : ['caution', 'capped'].includes(final.verdict) ? 'caution' : 'cleared';
  el.revealStamp.className = `stamp ${kind === 'blocked' ? '' : kind}`.trim();
  text(el.revealStamp, final.stamp);
  text(el.revealTitle, final.headline);
  text(el.revealSub, final.subline);
  el.revealWhy.hidden = !(final.because && ['block', 'capped'].includes(final.verdict) && final.peak > 0);
  text(el.revealWhy, final.because ? `Why: ${final.because}` : '');
  // MERIDIAN's own words: where it asked for the record, then where it agreed.
  el.revealQuotes.replaceChildren();
  const q = final.quotes ?? {};
  const rows = [];
  if (q.asked && q.asked.n !== q.agreed?.n) rows.push(['asked', `Line ${q.asked.n}`, q.asked.line, null]);
  if (q.agreed) rows.push(['agreed', `Line ${q.agreed.n}`, q.agreed.line, `sent ${dollars(q.agreed.amount)}`]);
  for (const [kind, n, line, tail] of rows) {
    const li = document.createElement('li');
    li.className = kind;
    const who = document.createElement('b');
    who.textContent = `${n} · MERIDIAN`;
    const said = document.createElement('q');
    said.textContent = line;
    li.append(who, said);
    if (tail) { const t = document.createElement('em'); t.textContent = tail; li.append(t); }
    el.revealQuotes.append(li);
  }
  el.revealQuotes.hidden = rows.length === 0;
  text(el.hypeLabel, 'What you pitched');
  text(el.recordLabel, final.verdict === 'block' ? 'What you left out' : 'What the record shows');
  if (final.verdict === 'capped') text(el.recordLabel, 'Why BAIT capped it');
  showTruth(p);
  window.scrollTo(0, 0);
  if (final.verdict === 'block' && final.peak > 0 && !reduced) {
    body.classList.remove('shake');
    void body.offsetWidth;
    body.classList.add('shake');
  }
}

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
  text(el.truthCaptured, capturedLine(p.truth, round?.evidence));
  el.truthDisclosure.hidden = !p.truth.disclosure;
  text(el.truthDisclosure, p.truth.disclosure);

  renderReport(el.truthReport, p.risk);
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

/**
 * The gate's own check table: one row per named check, pass, fail or not assessed,
 * in the order the policy ran them. This is the part a judge reads to see that BAIT
 * is a rule set and not a single sign test.
 */
function renderGate(host, gate) {
  host.replaceChildren();
  const label = { pass: 'pass', fail: 'block', not_assessed: 'n/a', cap: 'cap' };
  // Freshness is always shown: on a frozen snapshot it reads n/a rather than pass.
  const shown = c => c.result !== 'not_assessed' || c.id === 'evidence_freshness';
  // Rows the gate could not look at are named once in the footer, so the table stays
  // the length of what was actually decided.
  const skipped = (gate.checks ?? []).filter(c => !shown(c));
  for (const check of (gate.checks ?? []).filter(shown)) {
    const row = document.createElement('div');
    row.className = `flagline check ${check.result}`;
    const b = document.createElement('b');
    b.textContent = `${label[check.result] ?? check.result} · ${check.id.replace(/_/g, ' ')}`;
    const span = document.createElement('span');
    span.textContent = check.plain;
    // The Nansen read this check stands on, so the table reads as a set of checks on
    // named evidence, not one sign test.
    if (check.source) {
      const src = document.createElement('em');
      src.className = 'check-src';
      src.textContent = check.source;
      span.append(src);
    }
    row.append(b, span);
    host.append(row);
  }
  const foot = document.createElement('p');
  foot.className = 'report-foot';
  const windows = gate.shortWindowDays ? `${gate.shortWindowDays}-day and ${gate.windowDays}-day` : `${gate.windowDays}-day`;
  foot.textContent = [
    `Policy ${gate.policyId} · ${windows} · ${gate.source}${gate.live && gate.evidenceAt ? ` · live read ${String(gate.evidenceAt).slice(11, 16)} UTC` : ''} · ${gate.reason}`,
    skipped.length ? `Not decided by the gate (not reached after the block, or needs the fill tape the report below reads): ${skipped.map(c => c.id.replace(/_/g, ' ')).join(', ')}.` : '',
  ].filter(Boolean).join('  ·  ');
  host.append(foot);
}

// ------------------------------------------------------ 3. the pitch room

function enterRoom() {
  show('playing');
  renderScene(dossier);
  renderFacts(dossier);
  el.line.disabled = false;
  el.line.focus();
}

/** The cast and the premise. Drawn once per round. */
function renderScene(d) {
  text(el.slotSub, dollars(d.slot));
  text(el.premiseSlot, dollars(d.slot));
  text(el.premiseName, d.name);
  el.meridian.innerHTML = portraitSvg('meridian', { mood: 'neutral', accent: d.accent, title: 'MERIDIAN, the AI allocation desk' });
  el.clientPortrait.innerHTML = portraitSvg(d.portrait, { mood: 'confident', accent: d.accent, title: d.name, crop: 'face' });
  text(el.clientName, d.name);
  text(el.clientSub, `${d.venueLabel} · ${d.trader}`);
  text(el.ticker.firstElementChild, `${d.name}   ${d.endpoints.join('   ')}   ${d.evidenceLabel ?? `captured ${String(d.capturedAt).slice(0, 10)}`}   `.repeat(3).toUpperCase());
  updateCount();
}

/**
 * The dossier as the server released it: the flattering facts unlocked so far, one line
 * saying another is coming, and the sealed card whose value was never sent. A fact that
 * was not on screen a moment ago lands with a flash, so the unlock is seen.
 */
function renderFacts(d) {
  const before = new Set([...el.facts.children].map(chip => chip.dataset.id));
  el.facts.replaceChildren();
  for (const fact of d.facts) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'fact';
    chip.dataset.id = fact.id;
    if (before.size && !before.has(fact.id) && !reduced) chip.classList.add('fresh');
    const value = document.createElement('strong');
    value.textContent = fact.value;
    const label = document.createElement('span');
    label.textContent = fact.label;
    chip.append(value, label);
    chip.addEventListener('click', () => insertFact(fact.insert));
    el.facts.append(chip);
  }
  el.nextFact.hidden = !d.upcoming;
  text(el.nextFact, d.upcoming
    ? `+${d.upcoming} more true fact${d.upcoming === 1 ? '' : 's'} unlock${d.upcoming === 1 ? 's' : ''} after line ${d.nextUnlock}`
    : '');
  el.sealed.hidden = !d.sealed;
  if (d.sealed) {
    text(el.sealedHead, d.sealed.mustNotMention ? 'The fact you must not mention' : 'The number BAIT will check');
    text(el.sealedLabel, d.sealed.label);
  }
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
      idle: 'MERIDIAN has no data tools. It only hears your pitch.',
      thinking: 'MERIDIAN is deciding from your pitch alone.',
      answered: 'MERIDIAN decided from your pitch alone. BAIT reads Nansen before any money moves.',
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
/**
 * The header badge. Green only when this round's evidence is a live Nansen read, with
 * the time it was fetched. Anything else is the frozen capture, and the hover says why.
 */
function setBadge(evidence) {
  const live = evidence?.live === true;
  el.badge.textContent = live ? `live Nansen · fetched ${evidence.fetchedLabel}` : 'frozen capture';
  el.badge.classList.toggle('live', live);
  el.badge.title = live
    ? `Two Nansen profiler/perp-pnl-summary reads for this trader, fetched ${evidence.fetchedAt}${evidence.cached ? ' (cached, no new credit)' : ''}.`
    : evidence?.reason ?? 'Frozen capture. No live read in this round.';
}

/** Where the truth screen's numbers came from, and when. */
function capturedLine(truth, evidence) {
  if (truth.availability === 'live') return `live Nansen read ${truth.capturedLabel}`;
  if (truth.availability === 'recorded') return `captured ${truth.capturedLabel} · recorded tape, no live source`;
  if (truth.availability === 'fixture') return `captured ${truth.capturedLabel} · fixture, not yet captured`;
  return `captured ${truth.capturedLabel} · frozen capture${evidence?.reason ? ` (live read skipped: ${evidence.reason})` : ''}`;
}

function adopt(state) {
  round = state;
  if (state.evidence && 'live' in state.evidence) setBadge(state.evidence);
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
  // The server unseals the desk's findings with the verdict. The page keeps them sealed
  // through the transfer card, so the record lands with the reveal and not a beat early.
  renderChecks(state.finished ? state.checks.map(c => ({ ...c, finding: c.finding ? 'record read' : null })) : state.checks,
    state.shotsUsed > 0 ? 'answered' : 'idle');
  renderPips(state.shotsUsed, shots.flatMap((s, i) => (s.caught ? [i] : [])));
  renderStopped(state);
  if (!state.finished) renderFacts(state.dossier);
  // The desk's one transfer, drawn the moment it agrees. BAIT's decision on it is the
  // reveal, one screen later.
  const latest = shots[shots.length - 1];
  if (shots.length > wiresShown) {
    wiresShown = shots.length;
    if (latest?.wire) showIntercept(latest);
  }
  el.go.textContent = state.finished ? 'See what BAIT did' : `Pitch (${state.shotsLeft} left)`;
  el.line.disabled = state.finished;
}

/** The running tally beside the desk's number: the most the gate has held back. */
function renderStopped(state) {
  const stopped = state.stopped ?? 0;
  el.stopped.classList.toggle('zero', stopped === 0);
  text(el.stopped, dollars(stopped));
  const tried = state.wiresAttempted ?? 0;
  const blocked = state.wiresBlocked ?? 0;
  text(el.stoppedSub, tried === 0
    ? 'no wire yet'
    : `${blocked} of ${tried} wire${tried === 1 ? '' : 's'} blocked`);
}

/**
 * The transfer. The desk has just agreed to send money, and this card says how much of
 * its fund and to whom. It is sent to BAIT before it leaves; the decision is the reveal.
 */
function showIntercept(shot) {
  const w = shot.wire;
  el.intercept.className = 'intercept pending';
  el.intercept.hidden = false;
  text(el.icptN, `Line ${shot.n} · MERIDIAN agreed to send`);
  text(el.icptTo, '');
  text(el.icptAmt, w.attemptedLabel);
  text(el.icptStamp, 'NEXT: BAIT');
  text(el.icptWhy, `${w.attemptedLabel} of its ${dollars(dossier?.slot ?? 25000)} into copying ${chosen?.name ?? dossier?.name ?? 'this trader'}. BAIT checks every transfer before it leaves.`);
  if (!reduced) { el.intercept.style.animation = 'none'; void el.intercept.offsetWidth; el.intercept.style.animation = ''; }
}

async function pitch() {
  if (round?.finished) { finish(); return; }
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
    // Hold on the transfer card long enough to read it, then the reveal.
    if (state.finished) setTimeout(finish, reduced ? 0 : last?.wire ? 3000 : 1200);
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

let finishing = null;
let result = null;

/** Close the round once, then show BAIT's decision and the record behind it. */
function finish() {
  finishing ??= (async () => {
    try {
      result = await api(`/api/room/${round.id}/finish`, { method: 'POST', body: {} });
      adopt(result);
      showReveal(result.prospect, result.final);
      renderTranscript();
    } catch (err) {
      finishing = null;
      fail(err.message);
    }
  })();
  return finishing;
}

function showFinal(final, entries, mineAt = null) {
  show('final');
  window.scrollTo(0, 0);
  text(el.wireWho, final.prospect.name);
  text(el.wireKind, final.peak > 0 ? 'Transfer' : 'No transfer');
  text(el.wireAmount, final.peakLabel);
  text(el.wireStopped, final.stoppedLabel);
  el.wireStopped.classList.toggle('zero', !final.stopped);
  el.stamp.className = `stamp ${final.peak === 0 ? 'none' : ['caution', 'capped'].includes(final.verdict) ? 'caution' : final.verdict === 'allow' ? 'cleared' : ''}`;
  text(el.stamp, final.stamp);
  text(el.finalHead, final.headline);
  text(el.finalSub, final.subline);
  el.finalTrail.hidden = !final.trail;
  text(el.finalTrail, final.trail);
  renderWireLog(shots);
  text(el.agentLine, final.agentLine);
  renderGate(el.finalGate, final.gate);
  renderReport(el.finalReport, final.risk);
  renderBoard(entries, mineAt, el.boardList, 10);
  if (final.verdict === 'block' && final.peak > 0 && !reduced) {
    body.classList.remove('shake');
    void body.offsetWidth;
    body.classList.add('shake');
  }
}

/**
 * The board. A posted con carries the player's initials. A recorded one carries no
 * initials at all, only the label the seed script wrote: which kind of run it came
 * from and the date, with the source file one hover away.
 */
function renderBoard(entries, mineAt = null, host = el.boardList, limit = Infinity) {
  host.replaceChildren();
  if (!entries?.length) {
    const empty = document.createElement('li');
    empty.className = 'board-empty';
    empty.textContent = 'No cons posted yet. Be the first.';
    host.append(empty);
    return;
  }
  entries.slice(0, limit).forEach((entry, i) => {
    const row = document.createElement('li');
    if (mineAt && entry.at === mineAt) row.classList.add('mine');
    if (entry.recorded) {
      row.classList.add('recorded');
      row.title = `${entry.recorded.label} · ${entry.recorded.source.file}`;
    }
    for (const [cls, value] of [
      ['rank', String(i + 1).padStart(2, '0')],
      ['who-i', entry.recorded ? (entry.recorded.kind === 'bench' ? 'bench' : 'rec') : entry.initials],
      ['amt', dollars(entry.amount)],
      ['sold', entry.prospect],
      ['said', entry.line || '(no line)'],
    ]) {
      const cell = document.createElement('span');
      cell.className = cls;
      cell.textContent = value;
      row.append(cell);
    }
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = entry.recorded
      ? `${entry.recorded.label} · stopped by BAIT ${dollars(entry.stopped)}`
      : `posted ${String(entry.at).slice(0, 10)}${entry.stopped ? ` · stopped by BAIT ${dollars(entry.stopped)}` : ''}`;
    row.append(tag);
    host.append(row);
  });
}

/** Every wire the desk tried, one row each, straight off the round's shots. */
function renderWireLog(list) {
  el.wireLog.replaceChildren();
  for (const shot of list) {
    const row = document.createElement('li');
    const w = shot.wire;
    row.className = shot.caught ? 'caught' : !w ? 'none' : w.decision === 'block' ? 'blocked' : w.verdict === 'capped' ? 'capped' : 'cleared';
    row.textContent = shot.caught
      ? `Line ${shot.n} · caught lie, no wire`
      : !w
        ? `Line ${shot.n} · desk committed $0, no wire`
        : `Line ${shot.n} · ${w.attemptedLabel} · ${w.stamp}${w.decision === 'block' ? ` · ${w.stoppedLabel} stopped` : ''}`;
    el.wireLog.append(row);
  }
}

/** The recorded ladder under the roster, read from the exported results file. */
async function renderLadder() {
  try {
    const results = await api('/recorded-results.json');
    // The multi-wallet result: six losing wallets and a profitable control.
    const w = results.wallets;
    const label = {
      unarmed: 'The AI alone backed a losing trader',
      armedBasic: 'With Nansen tools in hand, it still did',
      guarded: "Behind BAIT's gate, no money reached a loser",
    };
    el.ladder.replaceChildren();
    for (const key of ['unarmed', 'armedBasic', 'guarded']) {
      const [funded, runs] = w.losing[key];
      const li = document.createElement('li');
      li.className = key === 'guarded' ? 'held' : 'baited';
      const n = document.createElement('b');
      n.textContent = `${funded}/${runs}`;
      const sp = document.createElement('span');
      sp.textContent = label[key];
      li.append(n, sp);
      el.ladder.append(li);
    }
    const cases = Object.values(w.losing.cases ?? {}).reduce((a, b) => a + b, 0);
    text(el.ladderHead, `${w.losing.wallets} losing wallets, ${cases} attacks, 3 runs each, true facts only`);
    const model = w.model === 'deepseek-chat' ? 'DeepSeek (deepseek-chat)' : w.model;
    text(el.ladderModel, `Model tested: ${model} · on profitable traders the gate blocked ${w.control.falseBlocks[0]} of ${w.control.falseBlocks[1]} funding decisions`);
  } catch { el.ladder.closest('.ladder-strip').hidden = true; }
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
    renderBoard(result.leaderboard, result.placed?.at ?? null, el.boardList, 10);
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
  // Every fixture state except the cold open itself starts from the roster screen,
  // which is no longer the first screen on the page.
  if (name === 'opener') { show('opener'); return; }
  if (name === 'opener-reveal') { show('opener'); revealOpener(); return; }
  show('roster');
  const target = roster.find(p => p.id === prospectId) ?? roster[0];
  focus(roster.indexOf(target));
  if (name === 'roster') return;

  const assessed = await api(`/api/assess?address=${encodeURIComponent(target.wallet ?? target.id)}&handle=${encodeURIComponent(target.handle ?? target.id)}`)
    .catch(() => null);
  // The frozen record behind this tile, from the local-only fixture route. A played
  // round gets the same objects from the server when BAIT has checked the transfer.
  const frozen = await api(`/api/room/fixture?prospect=${encodeURIComponent(target.id)}`);
  const state = await api('/api/room/start', { method: 'POST', body: { prospect: target.id } });
  adopt(state);
  const p = frozen.prospect;
  // The verdict is the gate's real decision on the frozen record, not the report's.
  const block = frozen.gate.decision === 'block';
  const capped = frozen.gate.code === 'capped';
  const amount = 2500;
  const sent = Math.round(frozen.gate.executed);
  const verdict = block ? 'block' : capped ? 'capped' : p.risk.verdict === 'allow' ? 'allow' : 'caution';
  // Layout only: the amount is a fixture value shaped like the server's `wire` object.
  const wire = {
    attempted: amount, attemptedLabel: dollars(amount), decision: block ? 'block' : 'allow',
    verdict, stamp: { block: 'BLOCKED', caution: 'CAUTION', allow: 'CLEARED', capped: 'CAPPED' }[verdict],
    stopped: amount - sent, stoppedLabel: dollars(amount - sent), executedLabel: dollars(sent),
    reason: 'fixture',
  };
  const fixtureFinal = {
    funded: amount, fundedLabel: dollars(amount), peak: amount, peakLabel: dollars(amount),
    stopped: wire.stopped, stoppedLabel: wire.stoppedLabel,
    executed: sent, executedLabel: wire.executedLabel,
    verdict, blocked: block, stamp: wire.stamp,
    prospect: { id: p.id, name: p.name, handle: p.handle, venueLabel: p.venueLabel },
    // Same sentences the server's endingCopy writes; the gate table is the gate's real
    // decision on the frozen record, run by the fixture route for this $2,500.
    headline: `It asked for the record. You didn't give it. It sent ${dollars(amount)}.`,
    quotes: { asked: { n: 1, line: 'Fixture reply: show me the 30-day record.' }, agreed: { n: 2, line: 'Fixture reply: fine, a small probe.', amount } },
    subline: block
      ? `BAIT's Nansen read blocked it: ${dollars(amount)} held, $0 reached ${p.name}.`
      : capped ? `BAIT's Nansen read capped it: ${dollars(amount)} requested, ${dollars(sent)} allowed, ${dollars(amount - sent)} held.`
      : `BAIT's Nansen read let it through: ${dollars(sent)} reached ${p.name}.`,
    because: frozen.gate.checks.find(c => c.result === 'fail' || c.result === 'cap')?.plain ?? null,
    trail: null,
    agentLine: assessed?.agent_line ?? '',
    gate: frozen.gate,
    risk: p.risk,
  };
  const fixtureShots = [
    { n: 1, text: state.dossier.facts[0].insert, full: 'Fixture reply.', line: 'Fixture reply.', mood: 'neutral', allocation: 0,
      suspicionBefore: 30, suspicion: 28, checks: [], check: 'ai-checked', caught: false, wire: null },
    { n: 2, text: state.dossier.facts[0].insert, full: 'Fixture reply.', line: 'Fixture reply.', mood: 'intrigued', allocation: amount,
      suspicionBefore: 28, suspicion: 20, checks: [], check: 'ai-checked', caught: false, wire },
  ];

  if (name === 'shot2') {
    // Mid-round: one line spent, the next fact unlocked, the loss still sealed.
    enterRoom();
    renderState({
      ...state, dossier: frozen.sealedDossier,
      shotsUsed: 1, shotsLeft: 2, funded: 0, suspicion: 28, mood: 'intrigued', peak: 0, stopped: 0,
      shots: fixtureShots.slice(0, 1), line: 'Fixture reply: tell me more about that record.',
      checks: [],
    });
    renderFacts({ ...frozen.sealedDossier, facts: frozen.dossier.facts.slice(0, Math.min(frozen.dossier.facts.length, state.dossier.facts.length + 1)),
      upcoming: Math.max(0, frozen.dossier.facts.length - state.dossier.facts.length - 1), nextUnlock: 2 });
    el.line.value = state.dossier.facts[0].insert;
    el.line.disabled = false;
    updateCount();
    return;
  }

  if (name === 'transfer') {
    // The moment the desk agrees: the transfer card, before the reveal.
    enterRoom();
    renderState({ ...state, shotsUsed: 2, shotsLeft: 0, finished: true, funded: amount, suspicion: 20, mood: 'intrigued',
      peak: amount, stopped: 0, shots: fixtureShots, line: 'Fixture reply: fine, a small probe.', checks: [] });
    return;
  }

  if (name === 'truth' || name === 'reveal') {
    showReveal(p, fixtureFinal);
    return;
  }

  if (name === 'final') {
    shots = fixtureShots;
    showFinal(fixtureFinal, boardEntries);
    renderTranscript();
  }
}

// ------------------------------------------------------------------- boot

let openerReadyPromise = Promise.resolve();

async function boot() {
  el.line.addEventListener('input', updateCount);
  el.line.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); el.composer.requestSubmit(); }
  });
  el.composer.addEventListener('submit', event => { event.preventDefault(); pitch(); });
  // The cold open takes the same keys as the roster, so the two screens behave alike.
  el.openerGrid.addEventListener('keydown', event => {
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (step) { event.preventDefault(); focusOpener(openerFocus + step); el.openerGrid.children[openerFocus].focus(); return; }
    if (event.key === 'Home') { event.preventDefault(); focusOpener(0); el.openerGrid.children[0].focus(); }
    if (event.key === 'End') { event.preventDefault(); focusOpener(-1); el.openerGrid.children[openerFocus].focus(); }
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); revealOpener(); }
  });
  el.openerGo.addEventListener('click', () => { show('roster'); focus(focused); el.grid.focus(); });
  el.grid.addEventListener('keydown', event => {
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 4, ArrowUp: -4 }[event.key];
    if (step) { event.preventDefault(); focus(focused + step); el.grid.children[focused].focus(); return; }
    if (event.key === 'Home') { event.preventDefault(); focus(0); el.grid.children[0].focus(); }
    if (event.key === 'End') { event.preventDefault(); focus(roster.length - 1); el.grid.children[focused].focus(); }
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); pick(); }
  });
  el.sell.addEventListener('click', () => { if (result) showFinal(result.final, result.leaderboard); });
  el.back.addEventListener('click', () => { window.location.href = window.location.pathname; });
  el.submitScore.addEventListener('click', postScore);
  el.again.addEventListener('click', () => { window.location.href = window.location.pathname; });

  try {
    // The cold open is read-only and costs nothing, so it is fetched alongside the room
    // config rather than behind it. A failure here is fatal: the screen it draws is the
    // first thing a stranger sees and a blank one is worse than an error.
    // The roster is the only fetch the front door waits on. The Fomo side proof loads on
    // its own, after, and only matters at /?view=fomo; the ladder and board fill in behind.
    const config = await api('/api/room');
    openerReadyPromise = api('/api/opener').then(renderOpener).catch(() => {});
    renderRoster(config.roster);
    boardEntries = config.leaderboard ?? [];
    renderBoard(boardEntries);
    renderBoard(boardEntries, null, el.frontBoard, 3);
    renderLadder();
    // Before a pick nothing on screen is live. The badge says whether a Hyperliquid pick
    // would buy a live read; once a round starts it names the round's own evidence.
    el.badge.textContent = config.evidence.liveReady ? 'live Nansen · read on pick' : 'frozen capture';
    el.badge.title = config.evidence.liveReady
      ? 'Picking a Hyperliquid trader reads two Nansen summaries for them. The Fomo four play a recorded tape.'
      : 'Live reads are off or used up. Every round plays the frozen capture.';
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
  if (state) { if (state.startsWith('opener')) await openerReadyPromise; await fixture(state, params.get('prospect')); return; }
  // One front door: the roster. The Fomo cold open is a side proof behind a link.
  if (params.get('view') === 'fomo') { await openerReadyPromise; show('opener'); el.openerGrid.focus(); return; }
  show('roster');
  focus(focused);
}

boot();
