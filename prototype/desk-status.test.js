import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deskStatus, DESK_MESSAGES } from './desk-status.js';

const base = { hasKey: true, remaining: 100, worstCase: 6, hosted: false, hostedRemaining: 100 };

test('a missing DeepSeek key says so, names the key, and points at the keyless bench', () => {
  const s = deskStatus({ ...base, hasKey: false });
  assert.deepEqual([s.ready, s.blocker], [false, 'no_key']);
  assert.match(s.message, /No DEEPSEEK_API_KEY in \.env/);
  assert.match(s.message, /npm run bench needs no keys/);
  assert.doesNotMatch(s.message, /offline/i);
});

test('the hosted daily cap stays its own message, separate from a missing key', () => {
  const s = deskStatus({ ...base, hosted: true, hostedRemaining: 2 });
  assert.deepEqual([s.ready, s.blocker, s.message], [false, 'hosted_cap', DESK_MESSAGES.hosted_cap]);
  assert.doesNotMatch(s.message, /DEEPSEEK_API_KEY/);
  // A missing key wins: a cap is not the reason when there is no key at all.
  assert.equal(deskStatus({ ...base, hasKey: false, hosted: true, hostedRemaining: 0 }).blocker, 'no_key');
});

test('a spent local budget and a ready desk', () => {
  assert.equal(deskStatus({ ...base, remaining: 3 }).blocker, 'local_cap');
  assert.deepEqual(deskStatus(base), { ready: true, blocker: null, message: null });
});

test('the room shows a missing key inline in the page flow, never as the toast that covered the stats', async () => {
  const fs = await import('node:fs');
  const client = fs.readFileSync(new URL('./public/room.js', import.meta.url), 'utf8');
  const html = fs.readFileSync(new URL('./public/room.html', import.meta.url), 'utf8');
  const branch = client.slice(client.indexOf("blocker === 'no_key'"), client.indexOf('}', client.indexOf("blocker === 'no_key'")));
  assert.match(branch, /el\.setupNote/);
  assert.doesNotMatch(branch, /bootError/);
  assert.match(html, /<p class="setup-note" id="setup-note" role="status" hidden><\/p>/);
  // The inline note sits in the roster header, before the grid, not in a fixed layer.
  assert.ok(html.indexOf('id="setup-note"') < html.indexOf('id="roster-grid"'));
});
