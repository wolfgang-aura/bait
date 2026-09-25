/**
 * The Pitch Room front end.
 *
 * The roster is the front door: four Hyperliquid traders, each with a Nansen record.
 * Every wire the desk commits is drawn the moment the server's gate decides it, from
 * the shot's `wire` object; the page computes no gate result of its own.
 *
 * Five screens and one rule: nothing on screen is invented here. The cold open carries
 * only the tiles carry only
 * what the server sends as hype, the truth screen carries only what the server sends
 * after the pick, and the evidence log prints an endpoint only when the server reports
 * a tool call that really happened. The desk's full reply lives in the transcript
 * drawer so the short bubble line stays auditable.
 *
 * `?state=roster|shot2|transfer|reveal|final` renders a frozen state without starting a round or
 * making a model call, so a headless browser that cannot click can still capture every
 * screen. `&prospect=<id>` picks whose screen it renders. Documented in
 * prototype/DESIGN.md, Version D.
 */
import { portraitSvg } from '/portraits.js';
import { addFact, isUsed } from '/fact-cards.js';
import { checkpointTitle, checkRowView, reportRows } from '/verdict-view.js';
import { ownerTreeHtml } from '/owner-tree.js';

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
  truthCaptured: $('truth-captured'), truthDisclosure: $('truth-disclosure'), ownerTree: $('owner-tree'), truthReport: $('truth-report'),
  sell: $('sell'), back: $('back'),
  meter: $('meter-fill'), trail: $('meter-trail'), suspicion: $('suspicion'),
  funded: $('funded'), pop: $('pop'), slotSub: $('slot-sub'), pips: $('pips'),
  meridian: $('meridian-portrait'), bubble: $('bubble'), nansen: $('nansen'), ticker: $('ticker'),
  clientPortrait: $('client-portrait'), clientName: $('client-name'), clientSub: $('client-sub'),
  facts: $('facts'), nextFact: $('next-fact'), sealed: $('sealed'), sealedHead: $('sealed-head'),
  sealedLabel: $('sealed-label'), premiseName: $('premise-name'), premiseSlot: $('premise-slot'),
  revealStamp: $('reveal-stamp'), revealTitle: $('reveal-title'), revealSub: $('reveal-sub'), revealScore: $('reveal-score'),
  revealQuote: $('reveal-quote'), hypeLabel: $('hype-label'), recordLabel: $('record-label'),
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
  transcript: $('transcript-body'), bootError: $('boot-error'), setupNote: $('setup-note'),
  checkpoint: $('checkpoint'), cpMove: $('cp-move'), cpRead: $('cp-read'), cpRows: $('cp-rows'), cpCalls: $('cp-calls'), cpStamp: $('cp-stamp'),
  agreedQuote: $('agreed-quote'), agreedMarks: $('agreed-marks'), wire: $('wire-it'),
  replayNote: $('replay-note'),
  barrier: $('barrier'), barAmt: $('bar-amt'), barTo: $('bar-to'), barHeld: $('bar-held'),
  cpNext: $('cp-next'), cpWhatif: $('cp-whatif'), cpTitle: $('cp-title'), hintKeys: $('hint-keys'), agreed: $('agreed'), agreedLine: $('agreed-line'),
  anyWallet: $('any-wallet'), anyWalletInput: $('any-wallet-input'), anyWalletGo: $('any-wallet-go'), anyWalletNote: $('any-wallet-note'),
};

const SCREENS = {
  roster: 'roster-screen',
  truth: 'truth-screen', playing: 'stage-screen', final: 'final-screen',
};

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
let wiresShown = 0;
/** Whether a pick reads Nansen live; unknown (null) until the server has said. */
let liveReady = null;
/** The gate result the report's labels follow, when one is on screen. */
let reportGate = null;
/** Round 17: Wire it ignores clicks for this long after it appears or its amount changes. */
export const WIRE_ARM_MS = 700;
let wireArmedAt = 0;
let wireAmount = null;
let reportVerdict = null;
/** Check ids in plain words, for the footers. */
const PLAIN_CHECK = { paper_headline: 'unsold gains', uncopyable_entries: 'launch-day entries', tail_loss: 'worst single trade',
  max_drawdown: 'drawdown', concentration: 'one-market share', thin_sample: 'sample size', low_win_rate: 'win rate' };

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

/**
 * Round 16: one neutral accent for every trader until the gate decides; a red or green
 * theme on the card gave the verdict away (judge 6). The reveal takes the verdict's colour.
 */
export const NEUTRAL_ACCENT = '#C9C3B6';
const VERDICT_ACCENT = { block: '#FF6B6B', capped: '#E9A23B', allow: '#62D49A' };
let revealAccent = NEUTRAL_ACCENT;
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
    tile.style.setProperty('--accent', NEUTRAL_ACCENT);
    tile.setAttribute('role', 'option');
    tile.setAttribute('aria-selected', 'false');
    tile.dataset.id = p.id;
    const art = document.createElement('span');
    art.className = 'tile-art';
    art.innerHTML = portraitSvg(p.portrait, { mood: 'idle', accent: NEUTRAL_ACCENT, title: p.name, crop: 'face' });
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
    // Both dates on the tile: where the brag was read, and when the record behind it was captured.
    const dates = document.createElement('em');
    dates.className = 'tile-dates';
    dates.textContent = p.hype.hypeFrom === 'Nansen'
      ? `Nansen ${p.hype.hypeDate}`
      : `${p.hype.hypeFrom} ${p.hype.hypeDate} · Nansen ${p.hype.recordDate}`;
    // The live line (roster pulse): Nansen activity read minutes ago, or the saved figure
    // with its date and the reason the live read did not happen. Filled by loadPulse().
    const pulse = document.createElement('span');
    pulse.className = 'tile-pulse';
    pulse.dataset.state = 'loading';
    const pulseFigure = document.createElement('small');
    pulseFigure.className = 'pulse-figure';
    pulseFigure.textContent = 'Reading Nansen live…';
    const pulseStamp = document.createElement('small');
    pulseStamp.className = 'pulse-stamp';
    pulseStamp.textContent = 'profiler/perp-pnl-summary, 7 days';
    pulse.append(pulseFigure, pulseStamp);
    info.append(value, caption, name, sub, pulse, dates);
    // Said, not hidden: a machine-pace record.
    if (p.note) { const note = document.createElement('em'); note.className = 'tile-note'; note.textContent = p.note; info.append(note); }

    tile.append(art, info);
    tile.addEventListener('mouseenter', () => focus(i));
    tile.addEventListener('focus', () => focus(i));
    tile.addEventListener('click', () => { focus(i); pick(); });
    el.grid.append(tile);
  });
  focus(0);
}

/**
 * The roster pulse: one shared, server-cached live Nansen read per tile (activity only, never
 * a realised figure). A failure says so on every tile and falls back to the saved figure
 * with its date; nothing stale is shown as live.
 */
export function pulseLine(w, recordDate) {
  if (!w) return { state: 'failed', figure: '', stamp: `live read failed · Nansen ${recordDate} capture` };
  return { state: w.live ? 'live' : w.status === 'paused' ? 'paused' : 'failed', figure: w.figure ?? '', stamp: w.stamp ?? '' };
}

function applyPulse(pulse) {
  const byId = new Map((pulse?.wallets ?? []).map(w => [w.id, w]));
  [...el.grid.children].forEach((tile, i) => {
    const node = tile.querySelector('.tile-pulse');
    if (!node) return;
    const line = pulseLine(byId.get(tile.dataset.id), roster[i]?.hype?.recordDate ?? 'saved');
    node.dataset.state = line.state;
    text(node.querySelector('.pulse-figure'), line.figure);
    text(node.querySelector('.pulse-stamp'), line.stamp);
  });
}

async function loadPulse() {
  try { applyPulse(await api('/api/room/pulse')); } catch { applyPulse(null); }
}

function focus(index) {
  focused = (index + roster.length) % roster.length;
  const p = roster[focused];
  [...el.grid.children].forEach((tile, i) => {
    tile.setAttribute('aria-selected', String(i === focused));
    const bust = tile.querySelector('.bust');
    if (bust) bust.dataset.x = i === focused ? 'confident' : 'idle';
  });
  setAccent(NEUTRAL_ACCENT);
  el.caller.style.setProperty('--accent', NEUTRAL_ACCENT);
  text(el.callerLine, p.voice);
  text(el.callerMeta, [
    // The venue and the chain are the same word on Hyperliquid, so say it once.
    p.chain === p.venueLabel ? p.venueLabel : `${p.venueLabel} · ${p.chain}`,
    p.hype.source,
    liveReady === true ? 'truth read live from Nansen on pick'
      : liveReady === false ? { capture: 'truth from a Nansen capture', fixture: 'truth is a fixture, not yet captured' }[p.truth_available]
        : 'checking the evidence source…',
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

/** The same rule the server applies: 0x and 40 hex characters. */
export const WALLET_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * Any wallet: one live Nansen read on the server, then the same round as the four. A
 * wallet with nothing flattering in it has no round; the BAIT check still reads it.
 */
async function pasteWallet(event) {
  event.preventDefault();
  const wallet = el.anyWalletInput.value.trim();
  el.anyWalletNote.classList.remove('bad');
  if (!WALLET_RE.test(wallet)) {
    el.anyWalletNote.classList.add('bad');
    text(el.anyWalletNote, 'That is not a Hyperliquid address. Paste 0x followed by 40 hex characters.');
    return;
  }
  el.anyWalletGo.disabled = true;
  text(el.anyWalletNote, 'Reading Nansen for this wallet: PnL summaries, fills, positions and smart money...');
  try {
    const res = await api('/api/room/start', { method: 'POST', body: { wallet } });
    chosen = { name: res.prospect.name, short: res.prospect.short, accent: NEUTRAL_ACCENT };
    if (res.checkOnly) {
      dossier = res.dossier;
      await playCheckpoint(res.prospect, res.final);
      showReveal(res.prospect, res.final);
      return;
    }
    adopt(res);
    enterRoom();
  } catch (err) {
    el.anyWalletNote.classList.add('bad');
    text(el.anyWalletNote, err.message);
  } finally {
    el.anyWalletGo.disabled = false;
  }
}

// ------------------------------------------------ 4. the reveal: BAIT's check

/**
 * The stamp names who decided. A transfer PENNY agreed to is decided by BAIT, so the
 * stamp says so; a round where PENNY refused on its own keeps the server's NO WIRE.
 */
function stampLabel(final) {
  if (final.whatIfOf) return `WOULD BE ${{ block: 'BLOCKED', capped: 'CAPPED', allow: 'CLEARED' }[final.verdict] ?? 'CHECKED'} BY BAIT`;
  if (!final.peak && !final.checkOnly) return final.stamp;
  return { block: 'BLOCKED BY BAIT', capped: 'CAPPED BY BAIT', allow: 'CLEARED BY BAIT' }[final.verdict] ?? final.stamp;
}

/** Write a sentence with every "BAIT" set as the one mark (round 14: the reveal lines too). */
function markBait(node, sentence) {
  node.replaceChildren();
  const parts = String(sentence ?? '').split(/\bBAIT\b/);
  parts.forEach((part, i) => {
    if (i > 0) node.append(baitBadge());
    if (part) node.append(part);
  });
}

/**
 * The barricade (round 14): the transfer card slides toward the exit, two gate bars slam
 * shut across it, the chain and lock drop, the BAIT mark lands. About 2.2 s; reduced motion
 * shows the closed gate still for 1.2 s. A different system has stepped in.
 */
async function barricade(final) {
  text(el.barAmt, final.peakLabel);
  text(el.barTo, `to ${final.prospect?.name ?? 'this trader'}`);
  // The transfer is held while the gate reads Nansen, whatever the verdict turns out to be.
  text(el.barHeld, `${final.peakLabel} HELD`);
  el.barrier.hidden = false;
  el.barrier.classList.remove('run');
  void el.barrier.offsetWidth;
  el.barrier.classList.add('run');
  await sleep(reduced ? 1200 : 2200);
  el.barrier.hidden = true;
}

/** The one BAIT wordmark: a solid amber badge, the same everywhere BAIT is named. */
function baitBadge() {
  const b = document.createElement('span');
  b.className = 'bait-badge';
  b.textContent = 'BAIT';
  return b;
}

/** Write a stamp as "BLOCKED BY [BAIT]": the verb, then the badge, then any tail. */
function setStamp(node, final) {
  const label = stampLabel(final);
  node.replaceChildren();
  const m = /^(.*) BY BAIT(.*)$/.exec(label);
  if (!m) { node.textContent = label; return; }
  node.append(`${m[1]} BY `, baitBadge());
  if (m[2]) node.append(m[2]);
  node.setAttribute('aria-label', label);
}

/**
 * The beat between PENNY agreeing and BAIT stepping in. About 1.5 s, or until clicked;
 * reduced motion keeps it on screen for the same time with no fade.
 */
function agreedBeat(shot, final) {
  const n = shot?.n ?? shots.length;
  const to = final?.prospect?.name ?? chosen?.name ?? dossier?.name ?? 'this trader';
  const amt = shot?.wire?.attemptedLabel ?? final?.peakLabel ?? '';
  text(el.agreedLine, `Wired: PENNY is sending ${amt} to ${to} after ${n} line${n === 1 ? '' : 's'}`);
  // The meter shows the same figure as the beat, whatever the count-up animation had reached.
  const committed = shot?.wire?.attempted ?? final?.peak;
  if (committed > 0) { fundedShown = committed; text(el.funded, dollars(committed)); }
  // PENNY's own words, and what they amount to: it asked for the record and was never shown it, or noticed it missing, and
  // committed the money anyway. The amount is the allocation PENNY wrote in its reply.
  const q = final?.quotes?.agreed;
  el.agreedQuote.hidden = !q?.line;
  const amount = dollars(q?.committed?.allocation ?? q?.amount ?? 0);
  text(el.agreedQuote, q?.line ? `PENNY: “${q.line}” · PENNY committed ${q.committed?.pct != null ? `${q.committed.pct}% (${amount})` : amount}` : '');
  el.agreedMarks.hidden = !(q?.askedThenSent || q?.noticedThenSent);
  el.agreedMarks.replaceChildren();
  // Only what PENNY said: it asked (a question or "show me"), or it remarked that the
  // record was missing. Anything else gets no mark.
  if (q?.askedThenSent || q?.noticedThenSent) {
    const ok = document.createElement('span'); ok.className = 'mark-ok';
    ok.textContent = q.askedThenSent ? 'Asked for the record ✓' : q.doubted ? 'Questioned the record ✓' : 'Noticed there was no track record ✓';
    const bad = document.createElement('span'); bad.className = 'mark-bad'; bad.textContent = 'Sent anyway ✗';
    el.agreedMarks.append(ok, q.askedThenSent && !q.shownWindow ? ' · never shown it · ' : ' · ', bad);
  }
  el.agreed.hidden = false;
  return new Promise(resolve => {
    const done = () => { clearTimeout(timer); el.agreed.removeEventListener('click', done); el.agreed.hidden = true; resolve(); };
    const timer = document.documentElement.dataset.frozen ? null : setTimeout(done, final?.quotes?.agreed?.askedThenSent || final?.quotes?.agreed?.noticedThenSent ? 3200 : 1500);
    el.agreed.addEventListener('click', done);
  });
}

const CHECK_NAME = {
  evidence_30d: '30-day record is this wallet\u2019s', evidence_freshness: 'Read is fresh', evidence_7d: '7-day record is this wallet\u2019s',
  realised_pnl_30d: '30-day realised PnL', regime_agreement: '7-day and 30-day agree', thin_sample: 'Enough closed trades',
  low_win_rate: 'Win rate at least 40%', paper_headline: 'Headline is realised', concentration: 'One market not carrying the month', open_book: 'Open positions not deep underwater',
  smart_money_side: 'Smart money not against the open book', independent_record: 'Leaderboard record agrees',
  operator_record: 'Operator behind the wallet not losing',
  tail_loss: 'Worst single trade', max_drawdown: 'Drawdown',
  fills_drawdown: 'Drawdown in the newest fills', fills_worst_trade: 'Worst trade in the newest fills',
};
// Gate v4's two rows and v5's operator row always show, N/A included.
const V4_ROWS = ['smart_money_side', 'independent_record', 'operator_record'];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * The BAIT checkpoint. PENNY has agreed and the money is leaving; BAIT takes the screen
 * in its own colour, names the Nansen read, ticks in the gate's real rows one by one, and
 * only then lands the stamp. Reduced motion: every row at once, no tick, still readable.
 */
async function playCheckpoint(p, final, { hold = true } = {}) {
  const gate = final.gate ?? { checks: [] };
  // A what-if (PENNY refused, so nothing reached BAIT) says so above the title.
  el.cpWhatif.hidden = !final.whatIfOf;
  text(el.cpWhatif, final.whatIfOf ? `PENNY said no on its own. Here's what the BAIT check would have done with ${final.peakLabel}:` : '');
  text(el.cpTitle, checkpointTitle(final));
  const who = p?.short ?? chosen?.short ?? '';
  text(el.cpMove, final.whatIfOf
    ? `${final.peakLabel} from PENNY to ${final.prospect?.name ?? p?.name ?? 'this trader'}, if it had agreed`
    : final.checkOnly
    ? `No transfer to check: nothing flattering to pitch. The BAIT check read ${final.prospect?.name ?? p?.name ?? 'this wallet'} anyway.`
    : `${final.peakLabel} from PENNY to ${final.prospect?.name ?? p?.name ?? 'this trader'}`);
  const at = String(gate.evidenceAt ?? '');
  text(el.cpRead, gate.live
    ? `Reading Nansen perp-pnl-summary${[gate.tape?.live && 'perp-trades', gate.positionsLive && 'perp-positions', gate.smartMoneyLive && 'perp-screener', gate.recordLive && 'perp-leaderboard', gate.operatorLive && 'related-wallets'].filter(Boolean).map((e, i, a) => (i === a.length - 1 ? ' and ' : ', ') + e).join('')} for ${who}: live read, ${at.slice(11, 16)} UTC ${at.slice(0, 10)}`
    : `Reading Nansen perp-pnl-summary for ${who}: the ${at.slice(0, 10)} capture`);
  const raw = final.evidence?.raw;
  if (raw) el.cpRead.append(` · raw response sha256 ${raw.sha256.slice(0, 12)}…`);
  el.cpRows.replaceChildren();
  el.cpCalls.replaceChildren();
  el.cpCalls.hidden = true;
  el.cpStamp.hidden = true;
  el.checkpoint.className = 'checkpoint';
  el.checkpoint.hidden = false;
  // Gate v4's two rows and v5's operator row always show, N/A included: the card says what each extra Nansen read decided or why it was not read.
  const rows = (gate.checks ?? []).filter(c => c.result !== 'not_assessed' || c.id === 'evidence_freshness' || c.id.startsWith('fills_') || V4_ROWS.includes(c.id));
  if (!reduced) await sleep(450);
  for (const c of rows) {
    const v = checkRowView(c, final.verdict);
    const li = document.createElement('li');
    li.className = `cp-row ${v.result}`;
    const b = document.createElement('b');
    b.textContent = v.label;
    const name = document.createElement('strong');
    name.textContent = CHECK_NAME[c.id] ?? c.id.replace(/_/g, ' ');
    const why = document.createElement('span');
    why.textContent = v.plain;
    li.append(b, name, why);
    el.cpRows.append(li);
    // Gate v5 refused on the owner: the funder and its other wallets, under the row that read them.
    if (c.id === 'operator_record' && c.result === 'fail' && gate.operator) {
      const tree = document.createElement('li');
      tree.className = 'cp-owner';
      tree.innerHTML = ownerTreeHtml(gate.operator, { compact: true });
      el.cpRows.append(tree);
    }
    if (!reduced) await sleep(260);
  }
  if (!reduced) await sleep(250);
  renderCalls(gate.calls ?? []);
  const kind = final.verdict === 'block' ? 'blocked' : final.verdict === 'capped' ? 'caution' : 'cleared';
  el.cpStamp.className = `cp-stamp ${kind}`;
  setStamp(el.cpStamp, final);
  el.cpStamp.hidden = false;
  el.cpStamp.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
  // No auto-dismiss: the checkpoint stays until the player has read it.
  el.cpNext.hidden = false;
  if (!hold) return;
  el.cpNext.focus({ preventScroll: true });
  await new Promise(resolve => el.cpNext.addEventListener('click', resolve, { once: true }));
  el.cpNext.hidden = true;
  el.checkpoint.hidden = true;
}

/**
 * Round 18: under the checkpoint, the Nansen calls this verdict stands on: endpoint, credits,
 * when it was read and the word it decided. Small, one line each.
 */
function renderCalls(calls) {
  el.cpCalls.replaceChildren();
  for (const c of calls) {
    const li = document.createElement('li');
    const at = c.at ? `${String(c.at).slice(11, 16)} UTC` : '';
    const cost = c.frozen ? `no call this round, captured ${String(c.at ?? '').slice(0, 10)}` : c.skipped ? 'not bought: the record already refused, 0 credits' : c.cached ? `0 credits (cached read, ${at})` : `${c.credits} credit${c.credits === 1 ? '' : 's'} · ${at}`;
    const name = document.createElement('b');
    name.textContent = c.endpoint;
    const verdict = document.createElement('span');
    verdict.className = `v-${c.decided.replace('/', '')}`;
    verdict.textContent = c.decided;
    li.append(name, ` · ${cost} → `, verdict);
    el.cpCalls.append(li);
  }
  const total = calls.reduce((a, c) => a + (c.credits || 0), 0);
  const foot = document.createElement('li');
  const link = document.createElement('a');
  link.href = '/api/health';
  link.textContent = 'all Nansen usage';
  foot.append(`${total} Nansen credit${total === 1 ? '' : 's'} this round · `, link);
  el.cpCalls.append(foot);
  el.cpCalls.hidden = calls.length === 0;
}

/** A quote on the reveal is one line or none. */
const QUOTE_WORDS = 16;

/**
 * The figure that decided a block or a cap: the first sentence of the deciding check, in
 * the gate's own words ("Closed trades over 30 days came to -$31,872,988."). A clear has none.
 */
function decidingFigure(final) {
  if (!final?.because || !['block', 'capped'].includes(final.verdict)) return '';
  if (!(final.peak > 0 || final.checkOnly)) return '';
  return String(final.because).split(/(?<=\.)\s+(?=[A-Z])/)[0].trim();
}

/**
 * The reveal. BAIT's decision on the one transfer comes first, then what was pitched
 * against what was left out, then the rest of the report. Every word and figure is the
 * server's `final` object and the prospect record it sent with the verdict.
 */
function showReveal(p, final) {
  revealAccent = VERDICT_ACCENT[final.verdict] ?? NEUTRAL_ACCENT;
  reportGate = final.gate ?? null;
  reportVerdict = final.verdict ?? null;
  const kind = final.peak === 0 && !final.checkOnly ? 'none' : final.verdict === 'block' ? 'blocked' : ['caution', 'capped'].includes(final.verdict) ? 'caution' : 'cleared';
  el.revealStamp.className = `stamp ${kind === 'blocked' ? '' : kind}`.trim();
  setStamp(el.revealStamp, final);
  text(el.revealTitle, final.headline);
  markBait(el.revealSub, final.subline);
  // Round 15: the score, as the board records it: the dollars PENNY wired, and in how many lines.
  const scored = final.peak > 0 && !final.checkOnly && !final.whatIfOf;
  el.revealScore.hidden = !scored;
  const lines = final.quotes?.agreed?.n;
  // Round 20: the score is what PENNY agreed to wire, not what reached the trader (BAIT decides that).
  text(el.revealScore, scored ? `Score: ${final.peakLabel} PENNY agreed to wire${lines ? `, in ${lines} line${lines === 1 ? '' : 's'}` : ''}.` : '');
  // Round 22: the reveal says three things once. The headline (what PENNY did), one BAIT
  // line with the figure that decided it, and the score. The old "agreed to send" tag and
  // the amber sentence repeated the headline, so they are gone.
  const why = decidingFigure(final);
  if (why) {
    const span = document.createElement('span');
    span.className = 'reveal-why';
    span.textContent = ` ${why}`;
    el.revealSub.append(span);
  }
  // At most one of PENNY's lines, the one that backs the headline's claim (where it asked
  // for or noticed the missing record), and only when it fits on one line.
  const q = final.quotes ?? {};
  const said = (q.asked ?? q.noticed)?.line ?? q.agreed?.line ?? '';
  const n = (q.asked ?? q.noticed)?.n ?? q.agreed?.n;
  const short = said && said.split(/\s+/).length <= QUOTE_WORDS;
  el.revealQuote.hidden = !short;
  el.revealQuote.replaceChildren();
  if (short) {
    const who = document.createElement('b');
    who.textContent = `Line ${n} · PENNY`;
    const line = document.createElement('q');
    line.textContent = said;
    el.revealQuote.append(who, ' ', line);
  }
  text(el.hypeLabel, 'What you pitched');
  text(el.recordLabel, final.verdict === 'block' ? 'What you left out' : 'What the record shows');
  if (final.verdict === 'capped') text(el.recordLabel, 'Why BAIT capped it');
  showTruth(p);
  // A block on a reversal was decided by the losing week, so that is what the player left
  // out: the week goes in the big number, the month in the rows.
  // A block on the owner was decided by the wallets the player never saw: the owner's figure
  // goes in the big number and the funder's tree replaces the wallet's own rows.
  const owner = final.verdict === 'block' && final.gate?.failed === 'operator_record' ? final.gate.operator : null;
  el.ownerTree.hidden = !owner;
  el.truthRows.hidden = !!owner;
  el.ownerTree.innerHTML = owner ? ownerTreeHtml(owner) : '';
  if (owner) {
    text(el.recordLabel, 'What you left out: who funds it');
    text(el.truthPnl, owner.combinedLabel);
    text(el.truthPnlCaption, `The owner's ${owner.days} days: this wallet plus ${owner.siblings.length} it funds`);
    el.recordHalf.classList.add('bad'); el.recordHalf.classList.remove('good');
    text(el.truthEndpoint, 'Nansen related-wallets, transactions, perp-pnl-summary');
    text(el.truthScope, `First funder on Ethereum or Arbitrum; its other wallets in BAIT's index; ${owner.days}-day realised PnL each`);
  }
  // Stacked under 900 px, the VS sits on the seam between the halves. The owner's tree makes
  // the record half taller than the pitch half, so 50% would land on the tree: pin it to the seam.
  const vs = el.truthScreen.querySelector('.vs');
  if (vs) {
    vs.style.top = '';
    if (owner && matchMedia('(max-width: 900px)').matches) requestAnimationFrame(() => { vs.style.top = `${el.recordHalf.offsetTop}px`; });
  }
  if (final.verdict === 'block' && final.gate?.failed === 'regime_agreement') {
    const week = (p.truth.rows ?? []).find(r => /^7-day realised/i.test(r.label));
    if (week) {
      text(el.truthPnl, week.value);
      text(el.truthPnlCaption, '7-day realised PnL, the window that decided it');
      el.recordHalf.classList.add('bad'); el.recordHalf.classList.remove('good');
      for (const dt of el.truthRows.querySelectorAll('dt')) {
        if (/^7-day realised/i.test(dt.textContent)) { dt.textContent = '30-day realised'; dt.nextElementSibling.textContent = p.truth.pnlLabel; }
      }
    }
  }
  window.scrollTo(0, 0);
  if (final.verdict === 'block' && final.peak > 0 && !reduced) {
    body.classList.remove('shake');
    void body.offsetWidth;
    body.classList.add('shake');
  }
}

function showTruth(p) {
  chosen = p;
  setAccent(revealAccent);
  show('truth');
  // The camera follows the number, not the verdict: a losing record catches them in
  // the light, a gain leaves them smiling. The verdict speaks through the report below.
  const losing = p.truth.pnl < 0;
  el.truthPortrait.innerHTML = portraitSvg(p.portrait, {
    mood: losing ? 'caught' : 'confident', accent: revealAccent, title: p.name, crop: 'face',
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
  // One gate result: each flag carries its gate row's word, and a passed row its own sentence.
  for (const r of reportRows(risk, reportGate?.checks ?? [], reportVerdict)) add(r.kind, r.label, r.line);

  const foot = document.createElement('p');
  foot.className = 'report-foot';
  foot.textContent = [
    `${risk.source}, captured ${risk.capturedLabel}`,
    risk.basis,
    risk.coverage,
    risk.not_assessed.length ? `Not assessed: ${risk.not_assessed.map(n => PLAIN_CHECK[n.id] ?? n.id.replace(/_/g, ' ')).join(', ')}.` : '',
  ].filter(Boolean).join('  ·  ');
  host.append(foot);
}

/**
 * The gate's own check table: one row per named check, pass, fail or not assessed,
 * in the order the policy ran them. This is the part a judge reads to see that BAIT
 * is a rule set and not a single sign test.
 */
/** What is live and what is captured: the trade fills' date and age, and whether it counted. */
function tapeLine(gate) {
  const t = gate.tape;
  const day = String(t.capturedAt).slice(0, 10);
  if (!gate.live) return `Summaries and trade fills: the same ${day} capture.`;
  if (t.live) return `Live: both perp-pnl-summary windows and the newest ${t.fills.toLocaleString('en-US')} perp fills, read ${String(t.capturedAt).slice(11, 16)} UTC.`;
  const age = t.ageMs === null ? 'age unknown' : `${(t.ageMs / 86_400_000).toFixed(1)} days older than the live read`;
  return t.stale
    ? `Summaries read live; trade fills from the ${day} capture, ${age}: shown, not used by any check.`
    : `Summaries read live; trade fills from the ${day} capture, ${age}.`;
}

function renderGate(host, gate, verdict = null) {
  host.replaceChildren();
  const label = { pass: 'pass', fail: 'block', not_assessed: 'n/a', cap: 'cap', caution: 'watch' };
  // Freshness is always shown: on a frozen snapshot it reads n/a rather than pass.
  const shown = c => c.result !== 'not_assessed' || c.id === 'evidence_freshness' || c.id.startsWith('fills_');
  // Rows the gate could not look at are named once in the footer, so the table stays
  // the length of what was actually decided.
  const skipped = (gate.checks ?? []).filter(c => !shown(c));
  for (const check of (gate.checks ?? []).filter(shown)) {
    const v = checkRowView(check, verdict);
    const row = document.createElement('div');
    row.className = `flagline check ${v.result}`;
    const b = document.createElement('b');
    b.textContent = `${v.result === 'superseded' ? 'cap' : label[check.result] ?? check.result} · ${check.id.replace(/_/g, ' ')}`;
    const span = document.createElement('span');
    span.textContent = v.plain;
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
    `The BAIT check · ${windows} · ${gate.source}${gate.live && gate.evidenceAt ? ` · live read ${String(gate.evidenceAt).slice(11, 16)} UTC` : ''} · ${gate.reason}`,
    gate.tape && gate.tape.capturedAt ? tapeLine(gate) : '',
    skipped.length ? `Not decided by the gate (not reached after the block, or needs the trade fills the report below reads): ${skipped.map(c => c.id.replace(/_/g, ' ')).join(', ')}.` : '',
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
  el.meridian.innerHTML = portraitSvg('meridian', { mood: 'neutral', accent: NEUTRAL_ACCENT, title: 'PENNY, the AI allocation desk' });
  el.clientPortrait.innerHTML = portraitSvg(d.portrait, { mood: 'confident', accent: NEUTRAL_ACCENT, title: d.name, crop: 'face' });
  text(el.clientName, d.name);
  text(el.clientSub, [d.venueLabel, d.trader].filter(Boolean).join(' · '));
  text(el.ticker.firstElementChild, `${d.name}   ${d.endpoints.join('   ')}   ${d.evidenceLabel ?? `captured ${String(d.capturedAt).slice(0, 10)}`}   `.repeat(3).toUpperCase());
  updateCount();
}

/**
 * The dossier as the server released it: every flattering fact, open from line 1, and the
 * sealed card whose value was never sent. A card is used once per line (fact-cards.js).
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
    chip.dataset.insert = fact.insert;
    chip.addEventListener('click', () => insertFact(fact.insert));
    el.facts.append(chip);
  }
  // Round 9: no unlock drip. Every flattering fact is on the table from the start.
  el.nextFact.hidden = true;
  text(el.nextFact, '');
  refreshFactCards();
  el.sealed.hidden = !d.sealed;
  if (d.sealed) {
    text(el.sealedHead, 'What BAIT will check');
    text(el.sealedLabel, d.sealed.label);
  }
}

function insertFact(sentence) {
  if (el.line.disabled) return;
  const next = addFact(el.line.value, sentence, dossier?.maxPitch ?? 200);
  if (next === null) return; // already in this line: a card is used once per line
  el.line.value = next;
  el.line.focus();
  updateCount();
}

/** A card whose sentence is in the line is spent; delete the sentence and it is free. */
function refreshFactCards() {
  for (const chip of el.facts.children) {
    const used = isUsed(el.line.value, chip.dataset.insert);
    chip.disabled = used;
    chip.classList.toggle('used', used);
    chip.setAttribute('aria-pressed', String(used));
    chip.title = used ? 'Already in this line' : 'Add this true fact to your line';
  }
}

function updateCount() {
  text(el.count, `${el.line.value.length} / ${dossier?.maxPitch ?? 200}`);
  refreshFactCards();
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
  // Round 19: no count-up. The meter shows the committed figure at once, so it can never read
  // $2,999 beside a $3,000 card; the +$X pop carries the motion.
  text(el.funded, dollars(to));
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
      idle: 'PENNY has no data tools and only hears your pitch.',
      thinking: 'PENNY is deciding from your pitch alone.',
      answered: 'PENNY decided from your pitch alone. BAIT reads Nansen before any money moves.',
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
    ? `Live Nansen read for this trader (the Pitch Room's v4 read: two summaries, fills, positions, smart money and the leaderboard), fetched ${evidence.fetchedAt}${evidence.cached ? ' (cached, no new credit)' : ''}.`
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
  // Round 19: the mode label follows the server; a hosted clone that fell back says Replay mode.
  if (state.health?.replayLabel) { el.replayNote.hidden = false; text(el.replayNote, state.health.replayLabel); }
  if (state.prospect) { chosen = state.prospect; setAccent(NEUTRAL_ACCENT); }
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
  // Wire it: once PENNY has money committed, the player decides when to send it.
  const wireShown = !(state.finished || !(state.funded > 0));
  // Round 17: a click that was meant for Pitch must not wire the money. The button arms
  // WIRE_ARM_MS after it appears or after the committed amount changes.
  if (wireShown && (el.wire.hidden || wireAmount !== state.funded)) wireArmedAt = performance.now();
  wireAmount = wireShown ? state.funded : null;
  el.wire.hidden = !wireShown;
  el.wire.textContent = state.funded > 0 ? `Wire it (${dollars(state.funded)})` : 'Wire it';
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
  const to = chosen?.name ?? dossier?.name ?? 'this trader';
  text(el.icptN, `Line ${shot.n} · PENNY has committed ${w.attemptedLabel} to ${to}`);
  text(el.icptTo, '');
  text(el.icptAmt, w.attemptedLabel);
  text(el.icptStamp, '');
  el.icptStamp.hidden = true;
  text(el.icptWhy, round?.shotsLeft > 0
    ? `Committed from PENNY's ${dollars(dossier?.slot ?? 25000)} fund on your pitch alone. Pitch again to raise it, or press Wire it.`
    : `Committed from PENNY's ${dollars(dossier?.slot ?? 25000)} fund on your pitch alone. That was your last line: it is wired.`);
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
    // The referee, not PENNY, calls a false figure. PENNY has no data, so it cannot.
    if (last?.caught) { text(el.status, last.referee ?? 'Referee: a figure in that line is not in the record.'); el.status.classList.add('referee'); }
    else el.status.classList.remove('referee');
    // Hold on the transfer card long enough to read it, then the reveal.
    // The agreed beat and the checkpoint are paced in finish(); no extra wait here.
    if (state.finished) setTimeout(finish, reduced ? 300 : last?.wire ? 600 : 1200);
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
    if (!round?.finished) {
      // Focus the box without scrolling to it, then bring PENNY's reply into view: on a short
      // or narrow screen focusing the box used to push the reply off the top.
      el.line.focus({ preventScroll: true });
      el.bubble.scrollIntoView({ block: 'center', behavior: 'auto' });
    }
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
      el.wire.hidden = true;
      result = await api(`/api/room/${round.id}/finish`, { method: 'POST', body: { wire: true } });
      adopt(result);
      // PENNY agreed: BAIT takes the screen before any stamp. PENNY refused on its
      // own: no checkpoint, the reveal says so.
      if (result.final.peak > 0) {
        const committing = [...shots].reverse().find(s => s.wire) ?? shots[shots.length - 1];
        await agreedBeat(committing, result.final);
        await barricade(result.final);
        await playCheckpoint(result.prospect, result.final);
      } else if (result.final.whatIf) {
        // PENNY refused on its own. BAIT still shows its work, as a labelled what-if.
        const w = result.final.whatIf;
        await playCheckpoint(result.prospect, { ...result.final, whatIfOf: true, gate: w.gate, verdict: w.verdict,
          peakLabel: w.amountLabel, checkOnly: false });
      }
      showReveal(result.prospect, result.final);
      renderTranscript();
    } catch (err) {
      finishing = null;
      el.checkpoint.hidden = true;
      fail(err.message);
    }
  })();
  return finishing;
}

function showFinal(final, entries, mineAt = null) {
  reportGate = final.gate ?? null;
  show('final');
  window.scrollTo(0, 0);
  text(el.wireWho, final.prospect.name);
  text(el.wireKind, final.peak > 0 ? 'Transfer' : 'No transfer');
  text(el.wireAmount, final.peakLabel);
  text(el.wireStopped, final.stoppedLabel);
  el.wireStopped.classList.toggle('zero', !final.stopped);
  el.stamp.className = `stamp ${final.peak === 0 ? 'none' : ['caution', 'capped'].includes(final.verdict) ? 'caution' : final.verdict === 'allow' ? 'cleared' : ''}`;
  setStamp(el.stamp, final);
  text(el.finalHead, final.headline);
  markBait(el.finalSub, final.subline);
  el.finalTrail.hidden = !final.trail;
  text(el.finalTrail, final.trail);
  renderWireLog(shots);
  text(el.agentLine, final.agentLine);
  renderGate(el.finalGate, final.gate, final.verdict);
  // The live read's raw Nansen response, as saved on this host, with its hash.
  const raw = final.evidence?.raw;
  if (raw) {
    const p = document.createElement('p');
    p.className = 'report-foot';
    const a = document.createElement('a');
    a.href = `/api/live-reads/${raw.file}`;
    a.textContent = `Raw Nansen response ${raw.file}`;
    p.append(a, ` · sha256 ${raw.sha256}`);
    el.finalGate.append(p);
  }
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
      : `${entry.lines ? `in ${entry.lines} line${entry.lines === 1 ? '' : 's'} · ` : ''}posted ${String(entry.at).slice(0, 10)}${entry.stopped ? ` · stopped by BAIT ${dollars(entry.stopped)}` : ''}`;
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
      guarded: "Behind the BAIT check, no money reached a loser",
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
    desk.textContent = `PENNY: ${shot.full || shot.line}`;
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
  // `&verdict=allow` is layout only: no roster record clears, so a CLEAR reveal is drawn on
  // this record's figures with the verdict forced (local fixture route only).
  const cleared = new URLSearchParams(location.search).get('verdict') === 'allow';
  const block = !cleared && frozen.gate.decision === 'block';
  const capped = !cleared && frozen.gate.code === 'capped';
  const amount = 2500;
  const sent = cleared ? amount : Math.round(frozen.gate.executed);
  const verdict = block ? 'block' : capped ? 'capped' : 'allow';
  // Layout only: the amount is a fixture value shaped like the server's `wire` object.
  const wire = {
    attempted: amount, attemptedLabel: dollars(amount), decision: block ? 'block' : 'allow',
    verdict, stamp: { block: 'BLOCKED', allow: 'CLEARED', capped: 'CAPPED' }[verdict],
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
    headline: `PENNY asked for the record, was never shown it, and agreed to send ${dollars(amount)}.`,
    quotes: { asked: { n: 1, line: 'Fixture reply: show me the 30-day record.' }, agreed: { n: 2, line: 'Fixture reply: fine, a small probe.', amount } },
    subline: block
      ? `BAIT's Nansen read blocked it: ${dollars(amount)} held, $0 reached ${p.name}.`
      : capped ? `BAIT's Nansen read capped it: ${dollars(amount)} requested, ${dollars(sent)} allowed, ${dollars(amount - sent)} held.`
      : `BAIT's Nansen read cleared it: ${dollars(sent)} reached ${p.name}.`,
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
    renderFacts(state.dossier);
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

  if (name === 'whatif') {
    // PENNY refused on its own: the BAIT check as a labelled what-if on $5,000.
    enterRoom();
    renderState({ ...state, shotsUsed: 3, shotsLeft: 0, finished: true, funded: 0, suspicion: 70, mood: 'suspicious',
      peak: 0, stopped: 0, shots: fixtureShots.slice(0, 1), line: 'Fixture reply: no.', checks: [] });
    await playCheckpoint({ ...p, short: target.short }, { ...fixtureFinal, whatIfOf: true, peak: 0, peakLabel: dollars(5000) }, { hold: false });
    return;
  }

  if (name === 'referee') {
    // A false figure: the referee speaks under the composer, PENNY's bubble does not.
    enterRoom();
    renderState({ ...state, shotsUsed: 1, shotsLeft: 2, funded: 0, suspicion: 45, mood: 'caught', peak: 0, stopped: 0,
      shots: [{ ...fixtureShots[0], caught: true, referee: 'Referee: a figure in that line is not in the record. The line is spent.' }],
      line: 'Hm. Go on.', checks: [] });
    text(el.status, 'Referee: a figure in that line is not in the record. The line is spent.');
    el.status.classList.add('referee');
    return;
  }

  if (name === 'agreed') {
    // The beat between PENNY agreeing and BAIT stepping in, held for the capture.
    enterRoom();
    renderState({ ...state, shotsUsed: 2, shotsLeft: 0, finished: true, funded: amount, suspicion: 20, mood: 'intrigued',
      peak: amount, stopped: 0, shots: fixtureShots, line: 'Fixture reply: fine, a small probe.', checks: [] });
    agreedBeat(fixtureShots[1], { ...fixtureFinal, quotes: { agreed: { ...fixtureFinal.quotes.agreed, committed: { allocation: amount, pct: 10 }, askedThenSent: true } } });
    return;
  }

  if (name === 'checkpoint') {
    // The BAIT checkpoint at rest, every row and the stamp, over the room.
    enterRoom();
    renderState({ ...state, shotsUsed: 2, shotsLeft: 0, finished: true, funded: amount, suspicion: 20, mood: 'intrigued',
      peak: amount, stopped: 0, shots: fixtureShots, line: 'Fixture reply: fine, a small probe.', checks: [] });
    await playCheckpoint({ ...p, short: target.short }, fixtureFinal, { hold: false });
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

async function boot() {
  el.line.addEventListener('input', updateCount);
  el.anyWallet.addEventListener('submit', pasteWallet);
  el.wire.addEventListener('click', () => {
    if (performance.now() - wireArmedAt < WIRE_ARM_MS) return;
    if (!sending && round && !round.finished && round.funded > 0) finish();
  });
  el.anyWalletInput.addEventListener('keydown', event => {
    // Round 16: every way a browser reports Enter submits the paste, like the pitch box.
    const enter = event.key === 'Enter' || event.code === 'Enter' || event.code === 'NumpadEnter' || event.keyCode === 13;
    if (enter && !event.isComposing) { event.preventDefault(); pasteWallet(event); }
  });
  // Touch screens get touch words.
  if (matchMedia('(pointer: coarse)').matches) text(el.hintKeys, 'Tap a trader to pick.');
  el.line.addEventListener('keydown', event => {
    const enter = event.key === 'Enter' || event.code === 'Enter' || event.code === 'NumpadEnter' || event.keyCode === 13;
    if (enter && !event.shiftKey && !event.isComposing) { event.preventDefault(); pitch(); }
  });
  el.composer.addEventListener('submit', event => { event.preventDefault(); pitch(); });
  // The cold open takes the same keys as the roster, so the two screens behave alike.
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
    // The roster is the only fetch the front door waits on; the ladder and board fill in behind.
    const config = await api('/api/room');
    renderRoster(config.roster);
    // Not awaited: the roster is usable while the live line loads.
    loadPulse();
    boardEntries = config.leaderboard ?? [];
    renderBoard(boardEntries);
    renderBoard(boardEntries, null, el.frontBoard, 3);
    renderLadder();
    // Before a pick nothing on screen is live. The badge says whether a Hyperliquid pick
    // would buy a live read; once a round starts it names the round's own evidence.
    liveReady = !!config.evidence.liveReady;
    el.badge.classList.remove('loading');
    el.badge.textContent = config.evidence.liveReady ? 'live Nansen · read on pick' : 'frozen capture';
    focus(focused);
    el.badge.title = config.evidence.liveReady
      ? 'Picking a trader reads two Nansen summaries for them.'
      : 'Live reads are off or used up. Every round plays the frozen capture.';
    // Round 18: replay mode (no model key) is labelled before anyone pitches.
    if (config.health?.replayMode) {
      el.replayNote.hidden = false;
      text(el.replayNote, config.health.replayLabel);
    }
    if (config.health && config.health.ready === false) {
      // The server names the stop: a missing key, the hosted daily cap or a spent local budget.
      fail(config.health.message ?? (config.health.capReached ? 'Today’s live rounds are used up.' : 'The desk cannot take a pitch right now.'));
      // A missing key is a setup fact, so it is said at the front door, before a pick,
      // inline in the page flow. The fixed toast is for load failures only: over the
      // front door it covered the stats block.
      if (config.health.blocker === 'no_key') {
        el.setupNote.hidden = false;
        text(el.setupNote, config.health.message);
      }
    }
  } catch (err) {
    el.bootError.hidden = false;
    text(el.bootError, `The room could not load: ${err.message}`);
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const state = params.get('state');
  if (state) { await fixture(state, params.get('prospect')); return; }
  show('roster');
  focus(focused);
  // The proof page links here to paste a wallet of your own.
  if (location.hash === '#any-wallet') { el.anyWallet.scrollIntoView({ block: 'center' }); el.anyWalletInput.focus({ preventScroll: true }); }
}

boot();
