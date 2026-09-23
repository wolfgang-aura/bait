import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addFact, isUsed } from './public/fact-cards.js';

const S = '+$94,310,198 all time on the public Hyperliquid leaderboard.';

test('spam-clicking a fact card pastes it once, not four times', () => {
  let line = '';
  for (let i = 0; i < 4; i++) {
    const next = addFact(line, S);
    if (next !== null) line = next;
  }
  assert.equal(line, S);
  assert.equal(line.split(S).length - 1, 1);
  assert.equal(isUsed(line, S), true, 'the card shows as used');
});

test('deleting the sentence frees the card again; another card still appends', () => {
  const line = addFact('Back him.', S);
  assert.equal(line, `Back him. ${S}`);
  assert.equal(isUsed('Back him.', S), false, 'text deleted: usable again');
  assert.equal(addFact('Back him.', S), line);
  assert.equal(addFact(line, 'TAO made +$83,994.'), `${line} TAO made +$83,994.`);
});

test('the page wires the rule: a used card is disabled and the input event re-checks it', async () => {
  const fs = await import('node:fs');
  const client = fs.readFileSync(new URL('./public/room.js', import.meta.url), 'utf8');
  assert.match(client, /from '\/fact-cards\.js'/);
  assert.match(client, /addFact\(/);
  assert.match(client, /refreshFactCards/);
  assert.match(client, /addEventListener\('input'/);
  assert.doesNotMatch(client, /unlock(s)? after line/, 'the unlock drip copy is gone');
});
