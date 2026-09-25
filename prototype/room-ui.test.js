import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = f => fs.readFileSync(new URL(`./public/${f}`, import.meta.url), 'utf8');
const html = read('room.html');
const js = read('room.js');

test('the target is PENNY, named as someone else\'s agent; no page shows MERIDIAN', () => {
  assert.match(html, /PENNY · the target: a third-party AI agent, not BAIT/);
  for (const f of ['room.html', 'room.js', 'replay.html', 'replay.js']) assert.doesNotMatch(read(f), /MERIDIAN/, f);
});

test('the round rule is said up front: raise the commitment, then Wire it; the wire gets its beat, then the barricade', () => {
  // Judge 10: PENNY can lower or withdraw a commitment too, and the rule says so.
  assert.match(html, /Each line can raise or lower it, down to nothing; press <b>Wire it<\/b> to send what is committed\./);
  assert.match(html, /Your score is the dollars PENNY agrees to wire\./);
  assert.match(html, /<button id="wire-it" type="button" class="wire-btn" hidden>Wire it<\/button>/);
  assert.match(js, /Wired: PENNY is sending \$\{amt\} to \$\{to\} after \$\{n\} line/);
  assert.ok(js.indexOf('await agreedBeat(') < js.indexOf('await barricade(') && js.indexOf('await barricade(') < js.indexOf('await playCheckpoint(result.prospect'),
    'beat, then the barricade, then the checkpoint');
  assert.match(js, /setTimeout\(done, final\?\.quotes\?\.agreed\?\.askedThenSent \|\| final\?\.quotes\?\.agreed\?\.noticedThenSent \? 3200 : 1500\)/);
  assert.match(js, /Noted a gap in the record ✓/);
  assert.doesNotMatch(js, /got none/, 'no claim the page cannot back');
  assert.doesNotMatch(js, /\(ALLOCATION: /, 'the raw token is humanised on screen');
  // PENNY's own words and the two marks: asked for the record, sent anyway.
  assert.match(js, /Asked for the record ✓/);
  assert.match(js, /Sent anyway ✗/);
  // One verdict: the deciding figure is claimed only when BAIT blocked or capped; no CAUTION stamp.
  assert.match(js, /if \(!final\?\.because \|\| !\['block', 'capped'\]\.includes\(final\.verdict\)\) return '';/);
  assert.doesNotMatch(js, /CAUTION/);
});

test('the footer is two short lines: seven Nansen endpoints, live or a dated saved read, and where they are listed', () => {
  // Judge 5: the old footer was one ~90-word sentence. The seven endpoints are listed on the proof
  // page's "How BAIT works" (replay.html#how), which the footer links to.
  const foot = html.slice(html.indexOf('<p class="foot">'), html.indexOf('</p>', html.indexOf('<p class="foot">')));
  const words = foot.replace(/<[^>]+>/g, ' ').trim().split(/\s+/);
  assert.ok(words.length <= 35, `${words.length} words`);
  assert.equal((foot.match(/<br>/g) ?? []).length, 1, 'two lines');
  assert.match(foot, /The BAIT check reads seven Nansen endpoints, live when this host has a key, else a dated saved read\./);
  assert.match(foot, /<a href="\/replay\.html#how">/);
  const how = fs.readFileSync(new URL('./public/replay.html', import.meta.url), 'utf8');
  const steps = how.slice(how.indexOf('id="how"'), how.indexOf('</section>', how.indexOf('id="how"')));
  for (const e of ['perp-pnl-summary', 'perp-trades', 'perp-positions', 'perp-screener', 'perp-leaderboard', 'related-wallets', 'transactions']) assert.ok(steps.includes(e), e);
});

test('round 22: the reveal says each thing once, and the stamp never sits on its text', () => {
  const css = read('room.css');
  const reveal = js.slice(js.indexOf('function showReveal'), js.indexOf('function showTruth'));
  // Three lines: the headline, one BAIT line carrying the deciding figure, the score.
  assert.match(reveal, /text\(el\.revealTitle, final\.headline\)/);
  assert.match(reveal, /markBait\(el\.revealSub, final\.subline\)/);
  assert.match(reveal, /const why = decidingFigure\(final\);[\s\S]*el\.revealSub\.append\(span\)/, 'the Why rides on the BAIT line');
  assert.match(reveal, /text\(el\.revealScore, scored \? `Score: /);
  // The repeat sentence, the separate "agreed to send" tag and the "Why:" line are gone.
  assert.doesNotMatch(js, /exists for/);
  assert.doesNotMatch(js, /let the transfer through/);
  assert.doesNotMatch(reveal, /agreed to send \$\{/);
  assert.doesNotMatch(reveal, /`Why: /);
  assert.doesNotMatch(html + js, /reveal-quotes|reveal-why" id=|revealWhy|revealQuotes/);
  // At most one of PENNY's lines, and only a short one.
  assert.match(js, /const QUOTE_WORDS = 16;/);
  assert.match(html, /<p class="reveal-quote" id="reveal-quote" hidden>/);
  // The stamp is not in the text column: it lives in the pitch half, in a grid cell of its own.
  const head = html.slice(html.indexOf('id="reveal-head"'), html.indexOf('id="splash"'));
  assert.doesNotMatch(head, /reveal-stamp/, 'no stamp in the reveal head');
  const pitch = html.slice(html.indexOf('class="half hype-half"'), html.indexOf('class="half-art"'));
  assert.match(pitch, /<p class="stamp" id="reveal-stamp">/, 'the stamp sits over "What you pitched"');
  assert.match(css, /#reveal-stamp \{\s*grid-column: 2; grid-row: 2;/);
  assert.match(css, /\.hype-half \.half-text \{ grid-column: 2; grid-row: 3; \}/, 'the name and figure take the row below it');
  assert.doesNotMatch(css, /#reveal-stamp[^}]*position: absolute/);
  assert.doesNotMatch(css, /\.reveal-head \{[^}]*grid-template-columns/, 'no stamp column beside the text');
  // Its entry never grows it past 1.12x, so it cannot swell over the headline.
  assert.match(css, /@keyframes reveal-stamp \{ from \{ opacity: 0; transform: rotate\(-6deg\) scale\(1\.12\); \}/);
});

test('the checkpoint stays until the player clicks "See what happened"', () => {
  assert.match(html, /id="cp-next"[^>]*>See what happened &rarr;<\/button>/);
  const body = js.slice(js.indexOf('async function playCheckpoint'), js.indexOf('function showReveal'));
  assert.match(body, /el\.cpNext\.addEventListener\('click', resolve, \{ once: true \}\)/);
  assert.doesNotMatch(body, /sleep\(reduced \? 1800/, 'no auto-dismiss');
});

test('one BAIT mark: a solid amber badge in nav, checkpoint, stamps, the reveal lines and the barricade', () => {
  assert.match(html, /<a class="mark"[^>]*><span class="bait-badge">BAIT<\/span><\/a>/);
  assert.match(html, /<p class="cp-brand"><span class="bait-badge">BAIT<\/span>/);
  assert.match(js, /node\.append\(`\$\{m\[1\]\} BY `, baitBadge\(\)\)/);
  const css = read('room.css');
  assert.match(css, /--bait: #FFB020;/);
  assert.doesNotMatch(css + read('replay.css'), /#4DA3FF/i, 'the blue is gone everywhere');
  assert.match(css, /\.bait-badge \{[^}]*background: var\(--bait\)/);
  assert.match(js, /markBait\(el\.revealSub, final\.subline\)/, "the reveal's second line carries the mark");
  assert.match(html, /<div class="bar-stamp"><span class="bait-badge">BAIT<\/span><b id="bar-held">/);
  // Round 18: two panels, a hazard band on the seam, a large lock, grain; no blue anywhere.
  assert.equal((html.match(/class="bar-panel (left|right)"><i class="bar-hazard"><\/i>/g) ?? []).length, 2);
  assert.match(css, /\.bar-lock \{[^}]*height: 19vh/);
  assert.match(js, /text\(el\.barHeld, `\$\{final\.wiredLabel\} HELD`\)/);
  assert.match(js, /await sleep\(reduced \? 1200 : 2200\)/);
  assert.match(css, /\.barrier\.run, \.barrier\.run \* \{ animation: none !important; \}/, 'reduced motion: the gate is shown still');
});

test('the Play page offers any wallet, validated like the server', async () => {
  assert.match(html, /<label for="any-wallet-input">Or paste any Hyperliquid wallet<\/label>/);
  const { WALLET_PATTERN } = await import('./roster.js');
  assert.equal(String(WALLET_PATTERN), String(/^0x[0-9a-fA-F]{40}$/));
  assert.match(js, /export const WALLET_RE = \/\^0x\[0-9a-fA-F\]\{40\}\$\//);
});

test('the agreed beat is one card: its hint sits inside it, not over the room', () => {
  const start = html.indexOf('id="agreed"');
  const beat = html.slice(start, html.indexOf('<div class="boot-error"', start));
  assert.match(beat, /<div class="agreed-card">\s*<p class="agreed-line" id="agreed-line"><\/p>[\s\S]*?<p class="agreed-hint">[\s\S]*?<\/div>/);
  assert.match(read('room.css'), /\.agreed-card \{[^}]*background: var\(--panel\)/);
});


test('public pages show short addresses and no third-party entity labels', async () => {
  const replay = read('replay.html') + read('replay.js');
  assert.doesNotMatch(replay, /HL Perps Whale|0x69cc3ae720efdff1cd2a8edec79a7a3fac6e14fd<\/code>/);
  const { demoFiles } = await import('./package-demo.js');
  const nav = JSON.parse(demoFiles().get('wallets.json'));
  assert.ok(nav.venues.flatMap(v => v.wallets).every(w => !('label' in w)), 'no entity labels in the published copy');
  assert.match(fs.readFileSync(new URL('./server.js', import.meta.url), 'utf8'), /publicNavigator\(JSON\.parse/);
});

test('the meter agrees with the card and the beat: it shows the committed figure at once (round 19)', () => {
  const roll = js.slice(js.indexOf('function rollFunded'), js.indexOf('function rollFunded') + 900);
  assert.match(roll, /text\(el\.funded, dollars\(to\)\);\r?\n\}/);
  assert.doesNotMatch(roll, /requestAnimationFrame|Math\.pow/);
  const beat = js.slice(js.indexOf('function agreedBeat'), js.indexOf('function agreedBeat') + 1400);
  assert.match(beat, /fundedShown = committed; text\(el\.funded, dollars\(committed\)\)/);
});

test('the Proof page is current: per-wallet suite, two summaries, real credit counts, dated examples, and no "never shown it" after the armed desk read the record', () => {
  const page = read('replay.html');
  const rjs = read('replay.js');
  assert.doesNotMatch(page, /10 recorded attacks|One Nansen call|one credit per check|Five wallets, with evidence|-\$847,025\.38/);
  assert.match(page, /26 attacks on 6 losing wallets, 6 profitable controls and 7 attacks on the evidence itself/);
  assert.match(page, /A Pitch Room live read also takes the newest page of fills: 5 credits when the record refuses, 10 when the gate clears or caps, plus 1 to 12 for the owner read when nothing earlier refuses \(22 at most\)\./);
  // Gate v4's five endpoints and both findings are static text, so the Pages copy carries them.
  for (const e of ['perp-pnl-summary', 'perp-trades', 'perp-positions', 'perp-screener', 'perp-leaderboard']) assert.match(page, new RegExp(e));
  assert.match(page, /the AI alone backed one in 63 of 78 runs\. Behind BAIT: <strong>0 of 78<\/strong>/);
  assert.match(page, /A simple PnL rule let 49 of 67 faked records through\. BAIT let <strong>0<\/strong>/);
  assert.match(page, /<a class="live-strip" href="https:\/\/bait-wyqr\.onrender\.com\/">/);
  // Judge 4: section 4 is the 20 Sep run under gate v1 (validation/wallet-navigator.test.js judges it
  // by the v1 rule), labelled as such, and says the current gate also reads the owner.
  // Judge 5: it is collapsed, closed by default, under a summary that says it is earlier.
  assert.match(page, /<details class="earlier-run" id="earlier-run">\s*<summary class="sec-head">\s*<h2 id="wallets-title"><span class="sec-num">4<\/span>Earlier: the 20 Sep run under gate v1<\/h2>/);
  assert.doesNotMatch(page, /<details class="earlier-run"[^>]*open/);
  assert.match(page, /The current gate, v5, also reads the owner/);
  assert.match(rjs, /Allowed by gate v1: its 30-day realised PnL is not negative\./);
  assert.doesNotMatch(page + rjs, /independently observed realised PnL is non-negative/);
  assert.match(rjs, /readRecord\s*\n\s*\? '<p class="asked-sent"><span class="ok">Read the record itself ✓<\/span>/);
});


test('round 15: the reveal states the score; the BAIT mark stays in the checkpoint; plain words; no blue', () => {
  assert.match(html, /<p class="reveal-score" id="reveal-score" hidden>/);
  // Round 20: never "wired" beside "$0 reached"; the score is what PENNY agreed to wire.
  assert.match(js, /Score: \$\{final\.wiredLabel\} PENNY agreed to wire/);
  assert.doesNotMatch(js + html, /Your score: |dollars you get wired/);
  assert.match(html, /Best cons: what PENNY agreed to wire/);
  assert.match(html, /<div class="cp-head">\s*<p class="cp-brand">/);
  const css = read('room.css');
  assert.match(css, /\.cp-head \{ position: sticky;/);
  // Judge 4: the benchmark line says what it counts: runs, true facts only, losing traders.
  assert.match(html, /In our benchmark, pitched only true facts about six losing traders, PENNY agreed to back one in 63 of 78 runs\./);
  assert.doesNotMatch(html, /exact desk we benchmarked/);
  for (const f of ['room.css', 'replay.css', 'portraits.js']) assert.doesNotMatch(read(f), /#9FD8F0|#4DA3FF|#063845|#1D3440/i, f);
  const shown = [html, js, read('replay.html')].join('\n');
  assert.doesNotMatch(shown, /fill tape|noise band|% bar\b|Policy \$\{gate\.policyId\}/);
  // A block supersedes a cap in the final table as in the checkpoint.
  assert.match(js, /renderGate\(el\.finalGate, final\.gate, final\.verdict\)/);
  assert.match(js, /const v = checkRowView\(c, verdict\);/);
});

test('round 16: nothing before the gate gives the verdict away; Enter submits a pasted wallet', () => {
  // One neutral accent for every trader until the reveal; the reveal takes the verdict's colour.
  assert.match(js, /export const NEUTRAL_ACCENT = '#C9C3B6';/);
  // The five roster portraits share one neutral backdrop (no red loser, green winner).
  assert.equal((read('portraits.js').match(/bg: \['#2A2724', '#0A0A0A'\]/g) ?? []).length, 5);
  assert.doesNotMatch(js, /setAccent\(p\.accent\)|accent: p\.accent|accent: d\.accent|--accent', p\.accent/);
  assert.match(js, /revealAccent = VERDICT_ACCENT\[final\.verdict\] \?\? NEUTRAL_ACCENT;/);
  // One sealed card, worded the same for everyone.
  assert.match(html, /<span class="sealed-head" id="sealed-head">What BAIT will check<\/span>/);
  assert.doesNotMatch(html + js, /must not mention|numbers BAIT will check/);
  assert.doesNotMatch(read('room.css'), /\.sealed-head \{[^}]*var\(--red\)/);
  // Enter in the paste field submits, however the browser reports the key.
  const paste = js.slice(js.indexOf("el.anyWalletInput.addEventListener('keydown'"), js.indexOf("el.anyWalletInput.addEventListener('keydown'") + 400);
  assert.match(paste, /event\.code === 'NumpadEnter' \|\| event\.keyCode === 13/);
  assert.match(paste, /pasteWallet\(event\)/);
});

test('round 17: Wire it never sits where Pitch was, and ignores clicks for 700 ms after it appears or changes', () => {
  const row = html.slice(html.indexOf('<div class="composer-row">'), html.indexOf('</div>', html.indexOf('<div class="composer-row">')));
  assert.doesNotMatch(row, /wire-it/, 'the composer row holds only the line and Pitch');
  const card = html.slice(html.indexOf('id="intercept"'), html.indexOf('<div class="nansen"'));
  assert.match(card, /<button id="wire-it" type="button" class="wire-btn" hidden>Wire it<\/button>/);
  assert.match(js, /export const WIRE_ARM_MS = 700;/);
  assert.match(js, /if \(performance\.now\(\) - wireArmedAt < WIRE_ARM_MS\) return;/);
  assert.match(js, /if \(wireShown && \(el\.wire\.hidden \|\| wireAmount !== state\.funded\)\) wireArmedAt = performance\.now\(\);/);
});

test('the front door hooks with one line and the benchmark headline; the live-market finding sits under the grid; the owner card is marked', () => {
  const roster = html.slice(html.indexOf('id="roster-screen"'), html.indexOf('</section>', html.indexOf('id="roster-screen"')));
  const lead = roster.slice(0, roster.indexOf('id="roster-grid"'));
  // Outside review, 26 Sep: a short hook, then one big number, then the start button, before the grid.
  const hook = lead.match(/<h1 class="hook-line" id="roster-title">([^<]+)<\/h1>/);
  assert.ok(hook, 'the hook is the page h1');
  assert.ok(hook[1].split(/\s+/).length <= 14, `hook is ${hook[1].split(/\s+/).length} words`);
  assert.doesNotMatch(lead, /of 78|26 attacks|6 losing wallets/, 'the true-facts benchmark stays in the room, not above the grid');
  assert.ok(lead.indexOf('id="hook-number"') < lead.indexOf('id="start-round"'), 'number, then the start button');
  assert.doesNotMatch(roster, /id="ladder"|26 attacks|6 losing wallets/);
  assert.equal((roster.match(/of 78/g) ?? []).length, 2, 'one true-facts benchmark line: 63 of 78 and 0 of 78');
  // The live-market finding moved under the grid, beside its five rows.
  const below = roster.slice(roster.indexOf('id="roster-grid"'));
  assert.match(below, /5 of the top 200 wallets are the winning face of an owner whose other wallets lost more than it made\./);
  assert.match(below, /rule funds all five\. BAIT blocks all five: four on the owner, one for too few trades\./);
  assert.ok(roster.indexOf('owners-list') > roster.indexOf('id="roster-grid"'), 'the five sit below the grid');
  // The five rows are the Proof page's owners table, figure for figure.
  const page = read('replay.html');
  const proofRows = [...page.matchAll(/<tr><td[^>]*>(0x[0-9a-f]{4}\.\.\.[0-9a-f]{4}) \(\d+\)<\/td><td[^>]*>([^<]+)<\/td><td[^>]*>([^<]+?)(?:<sup>\*<\/sup>)?<\/td><td[^>]*><strong>blocks: ([^<]+)<\/strong>/g)]
    .map(m => [m[1], m[2], m[3], m[4] === 'fewer than 20 trades' ? 'too few trades' : m[4]]);
  const roomRows = [...roster.matchAll(/<li><b>([^<]+)<\/b><span class="pos">([^<]+)<\/span><span class="neg">([^<]+)<\/span><em>([^<]+)<\/em><\/li>/g)].map(m => m.slice(1));
  assert.equal(roomRows.length, 5);
  assert.deepEqual(roomRows, proofRows);
  assert.equal(roomRows.filter(r => r[3] === 'owner lost').length, 4);
  assert.match(js, /if \(p\.start\) \{ const start = document\.createElement\('span'\); start\.className = 'tile-start'; start\.textContent = 'Start here';/);
  assert.doesNotMatch(js, /renderLadder|ladderHead/);
});

test('the home number is the benchmark headline as recorded in bench/FIGURES.json, never typed from memory', () => {
  const F = JSON.parse(fs.readFileSync(new URL('../bench/FIGURES.json', import.meta.url), 'utf8'));
  const [n, d] = F.headline.pnlRule;
  const [b, bd] = F.headline.bait;
  const lead = html.slice(html.indexOf('id="concept"'), html.indexOf('id="roster-grid"'));
  assert.ok(lead.includes(`<b id="hook-number">${n} of ${d}</b>`), `home number is ${n} of ${d}`);
  assert.match(lead, /benchmark attacks got money past a simple &ldquo;don&rsquo;t copy a wallet that lost money&rdquo; rule\./);
  assert.ok(lead.includes(`Behind BAIT: <strong>${b} of ${bd}</strong>.`), `BAIT figure is ${b} of ${bd}`);
  // The README's table states the same two figures (README is frozen; this only reads it).
  const readme = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  assert.ok(readme.includes(`| **${n} of ${d}** |`));
  assert.ok(readme.includes(`| BAIT | **${b} of ${bd}** |`));
});

test('one click starts a round: the start button and every card mark the pick at once, then the pitch box is scrolled to and focused', () => {
  assert.match(html, /<button type="button" class="primary start-round" id="start-round">Start a round<\/button>/);
  assert.match(js, /el\.startRound\.addEventListener\('click', \(\) => \{ if \(!roster\.length\) return; focus\(startIndex\(\)\); pick\(\); \}\);/);
  assert.match(js, /const startIndex = \(\) => Math\.max\(0, roster\.findIndex\(p => p\.start\)\);/);
  assert.match(js, /tile\.addEventListener\('click', \(\) => \{ focus\(i\); pick\(\); \}\);/);
  const pick = js.slice(js.indexOf('async function pick()'), js.indexOf('/** The picked card'));
  // The picked state lands before the server is asked, and comes off if the start fails.
  assert.ok(pick.indexOf('markPicked(tile, true)') > 0 && pick.indexOf('markPicked(tile, true)') < pick.indexOf("api('/api/room/start'"), 'marked before the request');
  assert.match(pick, /catch \(err\) \{\s*markPicked\(tile, false\);/);
  assert.match(pick, /if \(picking\) return;/, 'a double click starts one round');
  assert.match(js, /flag\.textContent = 'Picked · starting the round…';/);
  assert.match(js, /tile\.classList\.toggle\('picked', on\);/);
  const css = read('room.css');
  assert.match(css, /\.tile\.picked \{ border-color: var\(--amber\);/);
  // The room opens on the pitch box: focused without a jump, its bottom edge in view, flashed once.
  const enter = js.slice(js.indexOf('function enterRoom()'), js.indexOf('/** The cast and the premise.'));
  assert.match(enter, /el\.line\.focus\(\{ preventScroll: true \}\);\s*el\.composer\.scrollIntoView\(\{ block: 'end', behavior: 'auto' \}\);/);
  assert.match(enter, /el\.composer\.classList\.add\('ready'\);/);
  assert.match(css, /\.composer\.ready #line \{ animation: composer-ready/);
});

test('the checkpoint opens on the outcome and the one deciding row; every check is folded behind "See every check"', async () => {
  const card = html.slice(html.indexOf('id="checkpoint"'), html.indexOf('id="barrier"'));
  // Stamp, then the deciding row, then the folded list with the Nansen calls inside it.
  assert.ok(card.indexOf('id="cp-stamp"') < card.indexOf('id="cp-decider"') && card.indexOf('id="cp-decider"') < card.indexOf('id="cp-all"'));
  assert.match(card, /<details class="cp-all" id="cp-all">\s*<summary id="cp-all-summary">See every check<\/summary>\s*<ol class="cp-rows" id="cp-rows"><\/ol>/);
  assert.ok(card.indexOf('id="cp-calls"') > card.indexOf('id="cp-all"'), 'the calls fold with the rows');
  assert.doesNotMatch(card, /<details class="cp-all"[^>]*open/, 'folded by default');
  const cp = js.slice(js.indexOf('async function playCheckpoint'), js.indexOf('function checkpointRow'));
  assert.match(cp, /el\.cpAll\.open = false;/);
  assert.match(cp, /const decider = decidingCheck\(gate, final\.verdict\);/);
  assert.match(cp, /if \(decider\) el\.cpDecider\.append\(checkpointRow\(decider, final\.verdict, gate, \{ tree: true \}\)\);/);
  assert.match(cp, /none\.textContent = 'No check blocked or capped it\.';/);
  assert.match(cp, /text\(el\.cpAllSummary, `See every check \(\$\{rows\.length\}\)`\);/);
  assert.doesNotMatch(cp, /sleep\(260\)/, 'no row ticks in one by one');
  // The deciding row, from the gate's own rows.
  const { decidingCheck } = await import('./public/verdict-view.js');
  const checks = [
    { id: 'evidence_30d', result: 'pass' }, { id: 'thin_sample', result: 'cap' },
    { id: 'realised_pnl_30d', result: 'fail' }, { id: 'operator_record', result: 'fail' },
  ];
  assert.equal(decidingCheck({ checks, failed: 'operator_record' }, 'block').id, 'operator_record', 'the row the gate names');
  assert.equal(decidingCheck({ checks }, 'block').id, 'realised_pnl_30d', 'else the first BLOCK row');
  assert.equal(decidingCheck({ checks: checks.filter(c => c.result !== 'fail') }, 'capped').id, 'thin_sample');
  assert.equal(decidingCheck({ checks: [{ id: 'evidence_30d', result: 'pass' }] }, 'allow'), null, 'a clear has no deciding row');
  assert.equal(decidingCheck(null, 'block'), null);
});

test('on a phone the first card face is on the first screen and PENNY speaks after one job line (judge 4)', () => {
  const css = read('room.css');
  const phone = css.slice(css.lastIndexOf('@media (max-width: 599px)'));
  assert.match(phone, /\.lead \.for-whom, \.roster-head \.truth-credit \{ display: none; \}/);
  assert.match(phone, /\.premise \.premise-how, \.premise \.premise-data, \.premise \.premise-score \{ display: none; \}/);
  assert.doesNotMatch(phone, /\.concept|\.lead-lab|\.premise-job/, 'the finding headline and the job line stay');
});
