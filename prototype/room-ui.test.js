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
  assert.match(html, /Pitch again to raise it, then press <b>Wire it<\/b>/);
  assert.match(html, /Your score is the dollars you get wired\./);
  assert.match(html, /<button id="wire-it" type="button" class="wire-btn" hidden>Wire it<\/button>/);
  assert.match(js, /Wired: PENNY is sending \$\{amt\} to \$\{to\} after \$\{n\} line/);
  assert.ok(js.indexOf('await agreedBeat(') < js.indexOf('await barricade(') && js.indexOf('await barricade(') < js.indexOf('await playCheckpoint(result.prospect'),
    'beat, then the barricade, then the checkpoint');
  assert.match(js, /setTimeout\(done, final\?\.quotes\?\.agreed\?\.askedThenSent \|\| final\?\.quotes\?\.agreed\?\.noticedThenSent \? 3200 : 1500\)/);
  assert.match(js, /Noticed there was no track record ✓/);
  assert.doesNotMatch(js, /got none/, 'no claim the page cannot back');
  assert.doesNotMatch(js, /\(ALLOCATION: /, 'the raw token is humanised on screen');
  // PENNY's own words and the two marks: asked for the record, sent anyway.
  assert.match(js, /Asked for the record ✓/);
  assert.match(js, /Sent anyway ✗/);
  assert.match(js, /That's the failure BAIT exists for\./);
  // One verdict: the finding is claimed only when BAIT blocked or capped; no CAUTION stamp.
  assert.match(js, /final\.verdict === 'block' \|\| final\.verdict === 'capped'/);
  assert.match(js, /This record held up, so BAIT let the transfer through\./);
  assert.doesNotMatch(js, /CAUTION/);
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
  assert.match(js, /text\(el\.barHeld, `\$\{final\.peakLabel\} HELD`\)/);
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
  assert.match(page, /26 attacks on 6 losing wallets, 6 profitable controls and 6 attacks on the evidence itself/);
  assert.match(page, /A Pitch Room live read also takes the newest page of fills, 4 credits\./);
  assert.match(page, /Dated examples: five wallets read on 20 Sep 2026/);
  assert.match(rjs, /readRecord\s*\n\s*\? '<p class="asked-sent"><span class="ok">Read the record itself ✓<\/span>/);
});


test('round 15: the reveal states the score; the BAIT mark stays in the checkpoint; plain words; no blue', () => {
  assert.match(html, /<p class="reveal-score" id="reveal-score" hidden>/);
  assert.match(js, /Your score: \$\{final\.peakLabel\} wired/);
  assert.match(html, /<div class="cp-head">\s*<p class="cp-brand">/);
  const css = read('room.css');
  assert.match(css, /\.cp-head \{ position: sticky;/);
  assert.match(html, /PENNY backed losing traders in 63 of 78 tries in our benchmark\./);
  assert.doesNotMatch(html, /exact desk we benchmarked/);
  for (const f of ['room.css', 'replay.css', 'portraits.js']) assert.doesNotMatch(read(f), /#9FD8F0|#4DA3FF|#063845|#1D3440/i, f);
  const shown = [html, js, read('replay.html')].join('\n');
  assert.doesNotMatch(shown, /fill tape|noise band|% bar\b|Policy \$\{gate\.policyId\}/);
  // A block supersedes a cap in the final table as in the checkpoint.
  assert.match(js, /renderGate\(el\.finalGate, final\.gate, final\.verdict\)/);
  assert.match(js, /const v = checkRowView\(c, final\.verdict\);/);
});

test('round 16: nothing before the gate gives the verdict away; Enter submits a pasted wallet', () => {
  // One neutral accent for every trader until the reveal; the reveal takes the verdict's colour.
  assert.match(js, /export const NEUTRAL_ACCENT = '#C9C3B6';/);
  // The four roster portraits share one neutral backdrop (no red loser, green winner).
  assert.equal((read('portraits.js').match(/bg: \['#2A2724', '#0A0A0A'\]/g) ?? []).length, 4);
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
