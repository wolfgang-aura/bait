import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { checkpointTitle, checkRowView, reportRows, transcriptSaid, transcriptCheck } from './public/verdict-view.js';

const client = fs.readFileSync(new URL('./public/room.js', import.meta.url), 'utf8');

test('round 15: the checkpoint heading follows the verdict; only a block is an interception', () => {
  assert.equal(checkpointTitle({ verdict: 'block' }), 'BAIT intercepted the transfer');
  assert.equal(checkpointTitle({ verdict: 'allow' }), 'BAIT checked the transfer');
  assert.equal(checkpointTitle({ verdict: 'capped' }), 'BAIT checked the transfer');
  assert.match(client, /text\(el\.cpTitle, checkpointTitle\(final\)\)/);
});

test('round 15: a PASS row and its report line say the same thing (HYPE 81.4% on the clear path)', () => {
  // The gate's concentration row, as validation/guard.js words a pass, and the report's
  // flag for the same market, as it words a flag: before round 15 the reveal put the
  // second sentence beside the first row's PASS.
  const gatePlain = 'The best market, HYPE, made 81.4% of the 30-day result, so the profit does not rest on one market alone.';
  const checks = [{ id: 'concentration', result: 'pass', plain: gatePlain }];
  const risk = { flags: [{ id: 'concentration', plain: 'One market carried the result. HYPE alone carries 81.4% of the realised result. The result rests on a single position rather than on anything repeatable.' }] };
  const [row] = reportRows(risk, checks, 'allow');
  assert.equal(row.label, 'PASS');
  assert.equal(row.line, gatePlain, 'a PASS row carries the gate\'s own sentence');
  assert.doesNotMatch(row.line, /single position/);
  assert.match(client, /reportRows\(risk, reportGate\?\.checks \?\? \[\], reportVerdict\)/);
});

test('round 15: under a block, a CAP row no longer promises money moving', () => {
  const cap = {
    id: 'concentration', result: 'cap',
    plain: 'ETH alone made +$66,393, 139.1% of the 30-day +$47,744. Everything else it traded came to -$18,648, so one market carried a book that otherwise lost money. The month is real, so the gate sends 25% of the request and holds the rest.',
  };
  const shown = checkRowView(cap, 'block');
  assert.equal(shown.result, 'superseded');
  assert.doesNotMatch(shown.plain, /gate sends/);
  assert.match(shown.plain, /Superseded by the block: nothing is sent\.$/);
  assert.match(shown.plain, /^ETH alone made \+\$66,393/);
  // A cap that decides the round keeps its words.
  assert.equal(checkRowView(cap, 'capped').plain, cap.plain);
  assert.equal(checkRowView(cap, 'capped').label, 'CAP');
});

test('judge 11: the transcript shows PENNY\'s words and player labels, never raw JSON or internal check ids', () => {
  const full = 'Seven days is thin, but fine.\n{"allocation": 18000, "mood": "sold", "line": "Deal."}\nALLOCATION: 72';
  assert.equal(transcriptSaid(full, 'Deal.'), 'Seven days is thin, but fine.');
  assert.equal(transcriptSaid('```json\n{"allocation": 0, "mood": "suspicious", "line": "No."}\n```\nALLOCATION: 0', 'No.'), 'No.');
  assert.equal(transcriptSaid('', ''), 'No comment.');
  assert.equal(transcriptCheck({ caught: true }), 'struck by the referee');
  for (const check of ['ai-checked', 'preset', 'published', 'on the record']) {
    assert.equal(transcriptCheck({ caught: false, check }), 'passed the referee');
  }
  assert.match(client, /transcriptSaid\(shot\.full, shot\.line\)/);
  assert.doesNotMatch(client, /shot\.caught \? 'claim rejected' : shot\.check/);
});
