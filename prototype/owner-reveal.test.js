/**
 * THE STEADY HAND: a live-market wallet from the field test that the PnL rule and gate v4 fund
 * in full, and gate v5 blocks on its owner. Its frozen record is a saved live room read,
 * replayed; the reveal shows the funder and every sibling from that read and nothing else.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { frozenSnapshot, FROZEN_DIR } from './frozen-read.js';
import { loadRoster } from './roster.js';
import { createRoomService, frozenV4ReadsOf, frozenV5ReadsOf, FROZEN_V5_READS } from './room.js';
import { ownerTreeHtml } from './public/owner-tree.js';
import { guardAllocation, BENCHMARK_GUARD_POLICY_V4, BENCHMARK_GUARD_POLICY_V5 } from '../validation/guard.js';
import { makeToolExecutor } from '../validation/tools.js';
import { withV4Reads } from '../validation/v4-evidence.js';
import { withV5Reads } from '../validation/v5-evidence.js';
import { loadAgent, replayAgentCase } from '../bench/agent.js';
import { AGENT } from '../bench/v4.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WALLET = '0x20438cfdd36d75e185d6601697eb1973f4aee79d';
const FROZEN = path.join(FROZEN_DIR, `${WALLET}.json`);
const committed = JSON.parse(fs.readFileSync(FROZEN, 'utf8'));
const card = () => loadRoster().find(p => p.id === 'steadyhand');

test('the frozen record is the saved live read, replayed through the live path: nothing typed by hand', async () => {
  const raw = path.join(ROOT, committed.frozen_from.file);
  assert.match(committed.frozen_from.file, /^bench\/live-reads\/\d{8}T\d{6}Z-0x20438cfd\.json$/);
  assert.equal(createHash('sha256').update(fs.readFileSync(raw)).digest('hex'), committed.frozen_from.sha256);
  const rebuilt = JSON.parse(JSON.stringify(await frozenSnapshot(raw)));
  assert.deepEqual(rebuilt, committed, 'node prototype/frozen-read.js rebuilds the committed capture byte for byte');
  // Labelled a capture, never live, and it carries no Nansen address label.
  assert.equal(committed.source, 'capture');
  assert.equal('live_read' in committed, false);
  assert.equal(committed.open_positions.live, false);
  assert.doesNotMatch(fs.readFileSync(FROZEN, 'utf8'), /"address_label"|"label":/);
});

test('the card is a real field-test wallet: the PnL rule and v4 fund it in full, v5 blocks it on the owner', async () => {
  const p = card();
  assert.equal(p.wallet, WALLET);
  assert.equal(p.truthAvailable, 'capture');
  const data = p.snapshot;
  const now = () => new Date(data.retrieved_at);
  const exec = () => withV4Reads(makeToolExecutor(data, { mode: 'armed' }), frozenV4ReadsOf(data));

  const agent = await loadAgent(AGENT, { repo: ROOT });
  const pitch = { id: 'owner-card', cohort: 'data-path', refereeRule: 'no_copy_if_realized_pnl_30d_negative',
    pitches: [{ n: 1, text: 'Back this trader. Their record is on the data desk.', claims: [] }] };
  const rule = await replayAgentCase({ testCase: pitch, agent, data, executor: makeToolExecutor(data, { mode: 'armed' }), timeoutMs: 45_000 });
  assert.ok(rule.finalAllocation > 0, 'the PnL rule funds it');

  const v4 = await guardAllocation({ executor: exec(), wallet: WALLET, allocation: 1000, policy: BENCHMARK_GUARD_POLICY_V4, now });
  assert.equal(v4.decision, 'allow');
  assert.equal(v4.allocation, 1000, 'v4 funds it in full');

  const v5 = await guardAllocation({ executor: withV5Reads(exec(), frozenV5ReadsOf(data)), wallet: WALLET, allocation: 1000, policy: BENCHMARK_GUARD_POLICY_V5, now });
  assert.equal(v5.decision, 'block');
  assert.equal(v5.code, 'operator_losing');
  assert.equal(v5.checks.filter(c => c.result === 'fail').map(c => c.id).join(), 'operator_record', 'the owner is the only refusal');
  // One word on screen (judge 3): the reason says owner; the rule id keeps its name.
  const row = v5.checks.find(c => c.id === 'operator_record');
  assert.match(row.plain, /with this wallet the owner is at -\$869,807\./);
  assert.doesNotMatch(JSON.stringify(v5.checks.map(c => c.plain)), /operator/i);
  assert.doesNotMatch(v5.reason ?? '', /operator/i);
});

test('user-facing prose says owner, never operator, outside code, rule ids and file names (judge 3)', () => {
  const prose = text => text.split(/\r?\n/).map(l => l.replace(/`[^`]*`/g, '')).join('\n')
    .replace(/operator_(record|losing)|operator-index\.json|operator-flagged|operatorLive|operatorRead|get_operator|gate\.operator|\.operator\b/g, '');
  const files = ['JUDGE.md', 'docs/EVIDENCE.md', 'prototype/public/replay.html', 'prototype/public/room.html'];
  for (const f of files) assert.doesNotMatch(prose(fs.readFileSync(path.join(ROOT, f), 'utf8')), /\boperators?\b/i, f);
  // FIELD.md: the results; the pre-registration above them and the pre-registered headline keep their words.
  const field = fs.readFileSync(path.join(ROOT, 'bench', 'FIELD.md'), 'utf8').split('## Results')[1]
    .split(/\r?\n/).filter(l => !l.startsWith('**Of 200 top leaderboard wallets')).join('\n');
  assert.doesNotMatch(prose(field), /\boperators?\b/i, 'bench/FIELD.md results');
  // The checkpoint row title in the game.
  const roomJs = fs.readFileSync(path.join(ROOT, 'prototype', 'public', 'room.js'), 'utf8');
  assert.match(roomJs, /operator_record: 'Owner behind the wallet not losing'/);
});

test('only a capture frozen from a live read carries operator reads into a frozen round', () => {
  assert.deepEqual(frozenV5ReadsOf(card().snapshot), { operator: committed.v5_reads.operator });
  const other = loadRoster().find(p => p.id === 'grinder');
  assert.equal(frozenV5ReadsOf(other.snapshot), FROZEN_V5_READS);
});

test('the gate hands the reveal the funder and every sibling, each figure from the operator read', async () => {
  const service = createRoomService({ liveEvidence: null });
  const { gate } = await service.fixture('steadyhand');
  assert.equal(gate.decision, 'block');
  assert.equal(gate.failed, 'operator_record');
  const op = gate.operator;
  const read = committed.v5_reads.operator;
  const counted = read.funders.filter(f => f.counts);
  assert.deepEqual(op.funders.map(f => [f.short, f.chain, f.fundingUsd]),
    counted.map(f => [`${f.funder.slice(0, 6)}...${f.funder.slice(-4)}`, f.chain, f.funding_usd]));
  assert.deepEqual(op.siblings.map(s => s.pnl), read.siblings.map(s => s.realized_pnl_usd));
  const sum = read.siblings.reduce((a, s) => a + s.realized_pnl_usd, 0);
  assert.ok(Math.abs(op.siblingsPnl - sum) < 0.01);
  assert.ok(Math.abs(op.combined - (sum + committed.pnl_summary_30d.realized_pnl_usd)) < 0.01);
  assert.equal(op.wallet.short, '0x2043...e79d');
  assert.equal(op.frozenFrom, committed.frozen_from.fetched_at);
  assert.equal(op.live, false);
  // Judge 5: hedged like the home and proof pages; shared funding is not proof of one owner.
  assert.equal(op.line, `Its first funder also funds ${read.siblings.length} wallets that lost $${Math.round(Math.abs(sum)).toLocaleString('en-US')}; this is the one being pitched.`);
  assert.doesNotMatch(JSON.stringify(gate), /survivor|showing you/);
  // A wallet the operator row never read has no owner block.
  assert.equal((await service.fixture('grinder')).gate.operator, null);
});

test('the owner tree draws the funder, the pitched wallet, every sibling, both sums and the line', async () => {
  const { gate } = await createRoomService({ liveEvidence: null }).fixture('steadyhand');
  const op = gate.operator;
  const html = ownerTreeHtml(op);
  assert.match(html, /First funder<\/span> <b>0xeb26\.\.\.d4cf<\/b> <span class="ot-meta">Ethereum · sent it \$4,307 to start<\/span>/);
  assert.match(html, /<li class="ot-node pitched"><b>0x2043\.\.\.e79d<\/b><span class="ot-tag">you pitched<\/span><em>\+\$358,593<\/em><\/li>/);
  for (const s of op.siblings) {
    assert.ok(html.includes(`<li class="ot-node ${s.pnl < 0 ? 'loss' : 'gain'}"><b>${s.short}</b><em>${s.pnlLabel}</em></li>`), s.short);
  }
  assert.ok(html.includes(`${op.siblings.length} other wallets, 30 days</dt><dd class="loss">${op.siblingsLabel}</dd>`));
  assert.ok(html.includes(`The owner, all ${op.siblings.length + 1}</dt><dd class="loss">${op.combinedLabel}</dd>`));
  assert.ok(html.includes('; this is the one being pitched.'));
  // The losses come first; the reveal names no read time the checkpoint also prints.
  const order = [...html.matchAll(/<li class="ot-node (?:loss|gain)"><b>[^<]+<\/b><em>([^<]+)<\/em>/g)].map(m => Number(m[1].replace(/[$,+]/g, '')));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.doesNotMatch(html, /ot-src/);
  assert.match(ownerTreeHtml(op, { compact: true }), /class="owner-tree compact losing"[\s\S]*Owner, saved read 25 Sep 11:31 UTC/);
  // Escaped, and nothing without a read.
  assert.doesNotMatch(ownerTreeHtml({ ...op, wallet: { ...op.wallet, short: '<script>' } }), /<script>/);
  assert.equal(ownerTreeHtml(null), '');
});

test('the page draws the tree under the owner row on the checkpoint and in place of the rows on the reveal', () => {
  const js = fs.readFileSync(path.join(ROOT, 'prototype', 'public', 'room.js'), 'utf8');
  const html = fs.readFileSync(path.join(ROOT, 'prototype', 'public', 'room.html'), 'utf8');
  assert.match(js, /import \{ ownerTreeHtml \} from '\/owner-tree\.js';/);
  assert.match(js, /if \(c\.id === 'operator_record' && c\.result === 'fail' && gate\.operator\)/);
  assert.match(js, /tree\.innerHTML = ownerTreeHtml\(gate\.operator, \{ compact: true \}\);/);
  assert.match(js, /final\.gate\?\.failed === 'operator_record' \? final\.gate\.operator : null/);
  assert.match(js, /el\.ownerTree\.innerHTML = owner \? ownerTreeHtml\(owner\) : '';/);
  assert.match(js, /text\(el\.truthPnl, owner\.combinedLabel\);/);
  assert.match(html, /<div id="owner-tree" hidden><\/div>/);
});

test('the proof page and FIELD.md state both reads of this wallet, each with its time, from the raw reads', () => {
  const money = n => `${n < 0 ? '-' : '+'}$${Math.round(Math.abs(n)).toLocaleString('en-US')}`;
  const sum = xs => xs.reduce((a, b) => a + b, 0);
  // The field read (30 days to 06:04 UTC): the operator answer and the wallet's own summary.
  const fieldOp = fs.readFileSync(path.join(ROOT, 'bench', 'field', 'reads', 'operator.jsonl'), 'utf8')
    .split('\n').filter(Boolean).map(l => JSON.parse(l)).find(r => r.wallet === WALLET);
  const fieldSiblings = sum(fieldOp.answer.siblings.map(s => s.realized_pnl_usd));
  // The game's live read (11:31 UTC), the raw file the frozen card replays.
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, committed.frozen_from.file), 'utf8'));
  const liveSiblings = sum(raw.responses.operator.filter(c => c.endpoint === 'profiler/perp-pnl-summary')
    .map(c => c.body.data.realized_pnl_usd));
  const own = raw.responses['30d'].body.data;
  assert.equal(money(own.realized_pnl_usd), '+$358,593');
  assert.equal(own.closed_trade_count, 2661);
  assert.equal(money(fieldSiblings), '-$1,234,554');
  assert.equal(money(liveSiblings), '-$1,228,400');
  assert.equal(money(own.realized_pnl_usd + liveSiblings), '-$869,807');

  const page = fs.readFileSync(path.join(ROOT, 'prototype', 'public', 'replay.html'), 'utf8');
  assert.match(page, /0x2043\.\.\.e79d \(195\)<\/td><td[^>]*>\+\$358,593<\/td><td[^>]*>4 wallets, -\$1,234,554<sup>\*<\/sup>/);
  // Judge 4: "unchanged" read as current after a later live read; each figure is tied to its read.
  assert.match(page, /<sup>\*<\/sup> Field read, 30 days to 06:04 UTC: own \+\$358,593, owner&rsquo;s 4 other wallets -\$1,234,554\. Game read [^<]*30 days to 11:31 UTC: own \+\$358,593 \(2,661 closed trades in both windows\), 4 other wallets -\$1,228,400[^<]*Each figure is as of its read; live figures move after every trade\./);
  assert.doesNotMatch(page, /unchanged/);
  const field = fs.readFileSync(path.join(ROOT, 'bench', 'FIELD.md'), 'utf8');
  assert.match(field, /30 days to 11:31 UTC[\s\S]{0,120}\+\$358,593 \(2,661 closed trades in both windows\), 4 siblings -\$1,228,400, owner -\$869,807[\s\S]{0,120}Each figure is as of its read/);
});
