import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('the keep-warm workflow pings /healthz every 10 minutes, with a timeout, and never fails the repo', () => {
  const y = fs.readFileSync(new URL('../.github/workflows/keep-warm.yml', import.meta.url), 'utf8');
  assert.match(y, /cron: "\*\/10 \* \* \* \*"/);
  assert.match(y, /https:\/\/bait-wyqr\.onrender\.com\/healthz/);
  assert.match(y, /--max-time \d+/);
  assert.match(y, /timeout-minutes: \d+/);
  assert.match(y, /continue-on-error: true/);
  assert.match(y, /permissions:\s*\n\s*contents: read/);
});

test('the front door waits on one fetch before it can paint the roster', () => {
  const js = fs.readFileSync(new URL('../prototype/public/room.js', import.meta.url), 'utf8');
  assert.match(js, /const config = await api\('\/api\/room'\);/);
  assert.doesNotMatch(js, /Promise\.all\(\[api\('\/api\/room'\), api\('\/api\/opener'\)\]\)/, 'the Fomo side proof no longer blocks the roster');
});
