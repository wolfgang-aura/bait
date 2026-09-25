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
    assert.match(body, /<a href="https:\/\/bait-wyqr\.onrender\.com\/" data-host-link>Play<\/a>/, 'Play goes to the hosted room');
    assert.doesNotMatch(body, /play-against-the-models/);
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
  // The live-market finding leads, then what BAIT is, then the benchmark; the true-facts ladder follows in its own section.
  assert.match(html, /5 of the top 200 leaderboard wallets are the winning face of an owner who lost money/);
  assert.match(html, /BAIT is the gate before an AI agent copies a wallet/);
  assert.doesNotMatch(html, /blocks it when the record is losing/);
  assert.ok(html.indexOf('winning face of an owner') < html.indexOf('owners-table"') && html.indexOf('owners-table"') < html.indexOf('class="ladder"'), 'finding, then the five wallets, then the ladder');
  assert.match(html, /Runs where the AI alone backed a losing trader/);
  assert.match(html, /With Nansen tools in hand, it still did/);
  assert.match(html, /Behind the BAIT check, no money reached a loser/);
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

test('the proof page names the gate and date behind the panel counts, and they match the panel receipt', async () => {
  const { readFileSync } = await import('node:fs');
  const html = demoFiles().get('index.html');
  const receipt = JSON.parse(readFileSync(new URL('../bench/reports/robustness-panel-concentration.json', import.meta.url), 'utf8'));
  const { v1, v3 } = receipt.policies;
  assert.equal(receipt.periods, 102);
  assert.deepEqual([v3.blocked, v3.blocked_profitable, v3.allowed, v3.capped, v3.allowed_losing], [63, 40, 39, 6, 9]);
  assert.equal(v1.blocked, 38);
  assert.equal(receipt.policies.v4, undefined, 'the panel was never scored under v4');
  assert.equal(receipt.policies.v5, undefined, 'the panel was never scored under v5');
  assert.match(html, /Replayed on 23 Sep 2026 over 102 later seven-day periods on seven development wallets, gate v3 blocked 63 periods, and 40 of those were not losing the week after; it allowed 39 \(6 capped\), and 9 of those lost money\. Gate v1, the one-rule gate, blocked 38/);
  assert.match(html, /The panel was not re-run under v4 or v5, the current gate/);
  assert.doesNotMatch(html, /shipped gate blocked|older one-rule gate/);
});
