import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { countJsonl, inspectPrivateSubmission, inspectVideo, inspectXDraft } from './submission-check.js';

test('submission video inspection enforces the published X format and duration', () => {
  const valid = inspectVideo({
    format: { duration: '45.000' },
    streams: [
      { codec_type: 'video', codec_name: 'h264', width: 1280, height: 720, pix_fmt: 'yuv420p' },
      { codec_type: 'audio', codec_name: 'aac' },
    ],
  });
  assert.equal(valid.validDuration, true);
  assert.equal(valid.validFormat, true);
  assert.equal(inspectVideo({ format: { duration: '61' }, streams: [] }).validDuration, false);
  const hf = inspectVideo({ format: { duration: '46.0' }, streams: [{ codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080, pix_fmt: 'yuv420p' }] });
  assert.equal(hf.validFormat, true, 'a 1080p cut with no audio track is accepted');
});

test('private submission inspection distinguishes preparation from final receipts', () => {
  assert.deepEqual(inspectPrivateSubmission({
    nansen_account_email: 'builder@example.com',
    x_post_url: 'https://x.com/builder/status/1234567890',
    form_submitted: true,
  }), { emailReady: true, xPostReady: true, formSubmitted: true });
  assert.deepEqual(inspectPrivateSubmission({ nansen_account_email: 'bad' }), {
    emailReady: false,
    xPostReady: false,
    formSubmitted: false,
  });
});

test('submission panel count ignores blank lines', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bait-submission-'));
  const file = path.join(dir, 'panel.jsonl');
  fs.writeFileSync(file, '{}\n\n{}\n', 'utf8');
  assert.equal(countJsonl(file), 2);
  assert.equal(countJsonl(path.join(dir, 'missing.jsonl')), 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('X draft states the product, guard result and required links within the limit', () => {
  const draft = `Can true facts sell a losing trader to an AI?

BAIT gates wallet-allocation agents. 6 losing wallets, 26 true-fact attacks: the AI alone backed a loser 63/78, with Nansen tools 19/78, behind BAIT's gate 0/78.

Play it: https://bait-wyqr.onrender.com
https://github.com/wolfgang-aura/bait @nansen_ai`;
  assert.equal(inspectXDraft(draft).valid, true);
  assert.ok(inspectXDraft(draft).effectiveLength <= 280);
  assert.equal(inspectXDraft(draft.replace('Play it: https://bait-wyqr.onrender.com', '')).valid, false);
  assert.equal(inspectXDraft(draft.replace('0/78', '3/78')).valid, false);
  assert.equal(inspectXDraft(`${draft}\n${'x'.repeat(150)}`).valid, false);
});
