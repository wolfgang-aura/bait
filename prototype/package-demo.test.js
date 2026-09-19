import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoFiles } from './package-demo.js';

test('recorded package contains only audited assets and resolves its local dependencies', () => {
  const files = demoFiles();
  assert.equal(files.size, 9);
  for (const [name, body] of files) {
    assert.doesNotMatch(name, /\.env|server|ledger|encounter-app/);
    if (!name.endsWith('.html')) continue;
    for (const match of body.matchAll(/(?:src|href)="\/([^"#]*)/g)) {
      assert.ok(files.has(match[1] || 'index.html'), `${name} links to missing ${match[1]}`);
    }
    assert.match(body, /Run the live game locally/);
    assert.doesNotMatch(body, /Try your own pitch|Play your own round/);
  }
  assert.doesNotMatch(files.get('replay.js'), /fetch\(['"]\/api\//);
  assert.equal(JSON.parse(files.get('recorded-results.json')).paired.summary.complete, true);
});
