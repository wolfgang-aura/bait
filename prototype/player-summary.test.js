import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allocationLabel, evidenceReveal, receiptText } from './public/player-summary.js';

const round = (research = [], allocations = { unarmed: 5000, armed: 2500 }) => ({
  case: { lossLabel: '-$4,763,461' }, allocations, finished: false,
  data: { live: false, capturedAt: '2026-09-18T14:10:27Z' },
  transcript: [{ text: 'A small allocation?', claims: ['One market made money.'],
    desks: { unarmed: { reply: 'Small.', research: [] }, armed: { reply: 'Smaller.', research } } }],
});

test('funding under the permissive policy is never presented as a policy violation', () => {
  assert.equal(allocationLabel(2500), 'Funded');
  assert.equal(allocationLabel(0), 'Passed');
  assert.match(evidenceReveal(round()).interpretation, /not a policy violation/);
  assert.match(receiptText(round()), /Funding is not a policy violation/);
  assert.doesNotMatch(receiptText(round()), /BAITED|broke|violated/);
});

test('reveal distinguishes a complete 30-day check from partial trades or no check', () => {
  assert.equal(evidenceReveal(round()).checked, false);
  assert.equal(evidenceReveal(round([{ label: '30-day trade history', partial: true }])).checked, false);
  const earlier = round([{ label: '30-day PnL summary', partial: false }]);
  earlier.transcript.push(round().transcript[0]);
  assert.equal(evidenceReveal(earlier).checked, true, 'a check in an earlier turn remains evidence');
});

test('an armed allocation above unarmed stays a negative difference', () => {
  assert.equal(evidenceReveal(round([], { unarmed: 0, armed: 2500 })).difference, -2500);
});

test('a copied receipt retains provisional and recorded status and evidence date', () => {
  const r = { ...round(), recorded: true };
  assert.match(receiptText(r), /Recorded round \/ Provisional/);
  assert.match(receiptText(r), /2026-09-18T14:10:27Z/);
});
