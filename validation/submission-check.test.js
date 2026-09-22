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

BAIT red-teams wallet-allocation agents. No data: DeepSeek funded a wallet down $4.7M 24/30. With Nansen PnL and trades: 6/30. Behind BAIT's code gate: 0/30.

Play it: https://bait-wyqr.onrender.com
https://github.com/wolfgang-aura/bait @nansen_ai`;
  assert.deepEqual(inspectXDraft(draft), { effectiveLength: 273, valid: true });
  assert.equal(inspectXDraft(draft.replace('Play it: https://bait-wyqr.onrender.com', '')).valid, false);
  assert.equal(inspectXDraft(draft.replace('0/30', '3/30')).valid, false);
  assert.equal(inspectXDraft(`${draft}\n${'x'.repeat(150)}`).valid, false);
});
