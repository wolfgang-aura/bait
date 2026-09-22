import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoFiles } from './package-demo.js';

test('recorded package contains only audited assets and resolves its local dependencies', () => {
  const files = demoFiles();
  assert.equal(files.size, 7);
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
  assert.match(files.get('replay.js'), /fetch\('\.\/wallets\.json'/);
  assert.equal(JSON.parse(files.get('recorded-results.json')).paired.summary.complete, true);
  const walletPanel = JSON.parse(files.get('wallets.json'));
  assert.equal(walletPanel.version, 2);
  assert.equal(walletPanel.venues.flatMap(v => v.wallets).length, 5);
});

test('recorded page ships the guard as section 3 and reads the guarded row from the bundle', () => {
  const files = demoFiles();
  const html = files.get('index.html');
  const js = files.get('replay.js');
  const guarded = JSON.parse(files.get('recorded-results.json')).comparison.rows.find(r => r.config === 'guarded');
  assert.equal(typeof guarded?.blocked, 'number');
  assert.match(html, /<span class="sec-num">3<\/span>Guard</);
  assert.match(html, /A win rate that holds across a sample that size is a process, not luck/);
  assert.match(html, /baited · no data/);
  assert.match(html, /baited · with Nansen data, no rule/);
  assert.match(html, /baited · behind BAIT&rsquo;s gate/);
  assert.match(html, /Checks wallet, 30-day window, source, freshness and realised PnL/);
  assert.match(html, /Does not do<\/span><strong>Pick wallets, predict returns or execute trades/);
  assert.match(html, /import \{ guardAllocation \} from '\.\/validation\/guard\.js';/);
  assert.match(html, /href="https:\/\/github\.com\/wolfgang-aura\/bait\/blob\/main\/docs\/WALLET_ALLOCATION_GUARD\.md"[^>]*>Integration contract</);
  assert.match(html, /Copy the snippet/);
  assert.doesNotMatch(html, /Copy the rule|3<\/span>Fix|BAIT rule|Red-team kit for AI trading agents/);
  assert.match(js, /row\('guarded'\)/);
  assert.match(js, /The guard that held: \$\{guarded\.funded\} of \$\{guarded\.runs\}\. Blocked \$\{guarded\.blocked\} attempts\./);
  assert.match(js, /guarded: 'BAIT guard · code, no model tools'/);
  assert.match(js, /typeof r\.blocked === 'number'/);
});
