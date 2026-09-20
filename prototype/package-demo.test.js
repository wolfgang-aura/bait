import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoFiles } from './package-demo.js';

test('recorded package contains only audited assets and resolves its local dependencies', () => {
  const files = demoFiles();
  assert.equal(files.size, 6);
  for (const [name, body] of files) {
    assert.doesNotMatch(name, /\.env|server|ledger|encounter-app/);
    if (!name.endsWith('.html')) continue;
    assert.doesNotMatch(body, /(?:src|href)="\//, `${name} must support subpath hosting`);
    for (const match of body.matchAll(/(?:src|href)="\.\/([^"#]*)/g)) {
      assert.ok(files.has(match[1] || 'index.html'), `${name} links to missing ${match[1]}`);
    }
    assert.match(body, /github\.com\/wolfgang-aura\/bait#play-against-the-models/);
    assert.doesNotMatch(body, /RUN_LOCALLY|Run the live game locally|Try your own pitch|Play your own round/);
  }
  assert.doesNotMatch(files.get('replay.js'), /fetch\(['"]\/api\//);
  assert.match(files.get('replay.js'), /fetch\('\.\/recorded-results\.json'/);
  assert.equal(JSON.parse(files.get('recorded-results.json')).paired.summary.complete, true);
});
