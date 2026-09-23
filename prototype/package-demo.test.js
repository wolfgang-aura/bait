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
  // The product is introduced before the proof: what BAIT is, who it is for, then the ladder.
  assert.match(html, /BAIT is the check that runs before the money moves/);
  assert.match(html, /for teams that let AI agents allocate capital/);
  assert.ok(html.indexOf('BAIT is the check') < html.indexOf('class="ladder"'), 'the product line comes before the ladder');
  assert.match(html, /Runs where the AI alone backed a losing trader/);
  assert.match(html, /With Nansen tools in hand, it still did/);
  assert.match(html, /Behind BAIT&rsquo;s gate, no money reached a loser/);
  assert.match(html, /id="b-wallets"/, 'the per-wallet table is on the proof page');
  assert.match(js, /results\.wallets/);
  assert.match(html, /Model tested: <span id="b-model">/);
  assert.doesNotMatch(html, /process, not luck/);
  assert.match(html, /Checks wallet, 30-day window, source, freshness and realised PnL/);
  assert.match(html, /Does not do<\/span><strong>Pick wallets, predict returns or execute trades/);
  assert.match(html, /import \{ guardAllocation \} from '\.\/validation\/guard\.js';/);
  assert.match(html, /href="https:\/\/github\.com\/wolfgang-aura\/bait\/blob\/main\/docs\/WALLET_ALLOCATION_GUARD\.md"[^>]*>Integration contract</);
  assert.match(html, /Copy the snippet/);
  assert.doesNotMatch(html, /Copy the rule|3<\/span>Fix|BAIT rule|Red-team kit for AI trading agents/);
  // The page renders the per-wallet run; the superseded single-wallet headline is gone.
  assert.match(js, /Behind the gate: \$\{w\.losing\.guarded\[0\]\} of \$\{w\.losing\.guarded\[1\]\} losing runs funded/);
  assert.match(js, /capped \$\{c\.capped\[0\]\}/);
  assert.doesNotMatch(js + html, /24\/30|6\/30|0\/30|24 of 30|The guard that held/);
});
