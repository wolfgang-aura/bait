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

test('the round rule is said up front, and the agreement gets its own beat before BAIT', () => {
  assert.match(html, /The round ends the moment PENNY agrees to send money\. You have up to three lines\./);
  assert.match(js, /PENNY agreed after \$\{n\} line\$\{n === 1 \? '' : 's'\}: sending/);
  assert.match(js, /setTimeout\(done, 1500\)/);
  assert.ok(js.indexOf('await agreedBeat(') < js.indexOf('await playCheckpoint(result.prospect'), 'beat, then checkpoint');
});

test('the checkpoint stays until the player clicks "See what happened"', () => {
  assert.match(html, /id="cp-next"[^>]*>See what happened &rarr;<\/button>/);
  const body = js.slice(js.indexOf('async function playCheckpoint'), js.indexOf('function showReveal'));
  assert.match(body, /el\.cpNext\.addEventListener\('click', resolve, \{ once: true \}\)/);
  assert.doesNotMatch(body, /sleep\(reduced \? 1800/, 'no auto-dismiss');
});

test('one BAIT badge: nav, checkpoint and stamps use it; its colour is used for nothing else', () => {
  assert.match(html, /<a class="mark"[^>]*><span class="bait-badge">BAIT<\/span><\/a>/);
  assert.match(html, /<p class="cp-brand"><span class="bait-badge">BAIT<\/span>/);
  assert.match(js, /node\.append\(`\$\{m\[1\]\} BY `, baitBadge\(\)\)/);
  const css = read('room.css');
  assert.match(css, /--bait: #4DA3FF;/);
  assert.equal((css.match(/#4DA3FF/gi) ?? []).length, 1, 'the hex lives in one token');
  assert.doesNotMatch(css, /--(red|green|accent):\s*#4DA3FF/i);
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
  assert.match(beat, /<div class="agreed-card">\s*<p class="agreed-line" id="agreed-line"><\/p>\s*<p class="agreed-hint">/);
  assert.match(read('room.css'), /\.agreed-card \{[^}]*background: var\(--panel\)/);
});

