/**
 * Seed the Pitch Room's "Best cons" board with cons that really happened.
 *
 * Two sources, both raw and both already on disk:
 *   room   Pitch Room rounds the server saved to scratch/rooms/<id>.json while real
 *          DeepSeek rounds were played against PENNY (the judge-cut takes in
 *          scratch/video-judge/record-log.json are among them). Each used file is copied
 *          byte for byte into prototype/fixtures/recorded-rounds/ so the committed row
 *          and its raw source travel together.
 *   bench  The frozen-evidence attack suite with BAIT's gate,
 *          bench/reports/2026-09-20T18-10-24-277Z.jsonl, config `guarded`, where every
 *          proposal the model made was recorded with `attempted` and `guardBlocked`.
 *          The line is the recorded pitch from bench/cases.
 *
 * Only rounds where the desk committed money to a wallet BAIT's gate blocks are cons.
 * The gate is re-run here on the round's peak commitment against the same frozen
 * record the room plays, so a row cannot say "stopped" unless the gate says so today.
 * Nothing is typed by hand: no initials, no amounts, no lines.
 *
 * The line on every row is the player's or the attacker's own words, the `text` of the
 * pitch the desk answered with the wire. Never the desk's reply (`line`/`reply`).
 * Two rows never carry the same line: the same preset card played in ten rounds is one
 * con, kept at its best amount. A bench case on a wallet outside the roster is named by
 * its short address and gated against its own frozen capture in validation/snapshots/,
 * so the board is not all one trader when the recorded runs are not.
 *
 *   node scripts/seed-cons.mjs
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { guardAllocation, BENCHMARK_GUARD_POLICY } from '../validation/guard.js';
import { makeToolExecutor } from '../validation/tools.js';
import { loadRoster } from '../prototype/roster.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOMS = path.join(ROOT, 'scratch', 'rooms');
const COPIES = path.join(ROOT, 'prototype', 'fixtures', 'recorded-rounds');
const OUT = path.join(ROOT, 'prototype', 'fixtures', 'recorded-cons.json');
const BENCH_REPORT = 'bench/reports/2026-09-20T18-10-24-277Z.jsonl';

const rel = file => path.relative(ROOT, file).split(path.sep).join('/');
// LF-normalised, so a Windows checkout with autocrlf hashes the same as Linux.
const sha = buf => crypto.createHash('sha256').update(buf.toString('utf8').replace(/\r\n/g, '\n')).digest('hex');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = iso => { const d = new Date(iso); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const clip = (text, max = 200) => {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : `${t.slice(0, max - 3).replace(/\s+\S*$/, '')}...`;
};

const roster = loadRoster();
const SNAPSHOTS = path.join(ROOT, 'validation', 'snapshots');
const short = w => `${w.slice(0, 6)}...${w.slice(-4)}`;
/** Same line, same con: case, whitespace and a trailing ellipsis do not make a new one. */
export const lineKey = text => String(text ?? '').replace(/\s+/g, ' ').trim().replace(/\.\.\.$/, '').toLowerCase();

/**
 * A wallet a bench case attacked. A roster wallet is its prospect; any other is named by
 * its address and gated on its own frozen capture, never on a stand-in.
 */
function benchSubject(wallet) {
  const p = byWallet.get(String(wallet).toLowerCase());
  if (p) return p;
  const file = path.join(SNAPSHOTS, `${String(wallet).toLowerCase()}.json`);
  if (!fs.existsSync(file)) return null;
  const snapshot = JSON.parse(fs.readFileSync(file, 'utf8'));
  return {
    name: `wallet ${short(snapshot.wallet)}`, venueLabel: 'Hyperliquid', wallet: snapshot.wallet,
    snapshot, executor: null, guardPolicy: BENCHMARK_GUARD_POLICY,
    capturedAt: snapshot.retrieved_at,
  };
}
const byCapture = new Map(roster.map(p => [p.truth.capturedAt, p]));
const byWallet = new Map(roster.map(p => [p.wallet.toLowerCase(), p]));

async function gate(p, allocation) {
  const d = await guardAllocation({
    executor: p.executor ?? makeToolExecutor(p.snapshot, { mode: 'armed' }),
    wallet: p.wallet, allocation, policy: p.guardPolicy ?? BENCHMARK_GUARD_POLICY,
  });
  return { decision: d.decision, executed: Math.round(d.allocation), code: d.code };
}

const entries = [];
const skipped = { noPeak: 0, notBlocked: 0, unknownProspect: 0, notRoom: 0, duplicateLine: 0 };

// ------------------------------------------------------------------ rooms
fs.mkdirSync(COPIES, { recursive: true });
const roomFiles = fs.existsSync(ROOMS) ? fs.readdirSync(ROOMS).filter(f => f.endsWith('.json')).sort() : [];
for (const f of roomFiles) {
  const raw = fs.readFileSync(path.join(ROOMS, f));
  const round = JSON.parse(raw.toString('utf8'));
  if (round.kind !== 'room' || !/deepseek/i.test(round.model ?? '')) { skipped.notRoom++; continue; }
  const p = (round.prospect && roster.find(r => r.id === round.prospect)) ?? byCapture.get(round.capturedAt);
  if (!p) { skipped.unknownProspect++; continue; }
  const shots = (round.shots ?? []).filter(s => !s.caught);
  const peak = Math.max(0, ...shots.map(s => s.allocation));
  if (peak <= 0) { skipped.noPeak++; continue; }
  const shot = shots.find(s => s.allocation === peak);
  // A round played on a live Nansen read was judged on that read, which this script
  // cannot buy again, so its row stands on the wire decision recorded in the round.
  // A frozen round is re-gated on the same frozen record, as before.
  const live = round.evidence?.live === true;
  const g = live
    ? { decision: shot.wire?.decision ?? 'none', executed: shot.wire?.executed ?? peak, code: shot.wire?.code ?? null }
    : await gate(p, peak);
  if (g.decision !== 'block') { skipped.notBlocked++; continue; }
  const copy = path.join(COPIES, f);
  fs.writeFileSync(copy, raw);
  entries.push({
    initials: null,
    amount: peak,
    line: clip(shot.text),
    prospect: p.name,
    venue: p.venueLabel,
    stopped: peak - g.executed,
    at: round.at,
    deskLine: clip(shot.line, 120),
    recorded: {
      kind: 'room',
      label: `recorded round · ${day(round.at)}`,
      date: round.at.slice(0, 10),
      model: round.model,
      evidence: live ? `live Nansen read ${round.evidence.fetchedAt}` : `frozen capture ${String(round.capturedAt).slice(0, 10)}`,
      gate: g.code,
      source: { file: rel(copy), sha256: sha(raw), round: round.id, shot: shot.n },
    },
  });
}

// ------------------------------------------------------------------ bench
const reportRaw = fs.readFileSync(path.join(ROOT, BENCH_REPORT));
const bestPerCase = new Map();
for (const row of reportRaw.toString('utf8').trim().split('\n').map(JSON.parse)) {
  if (row.config !== 'guarded') continue;
  for (const pitch of row.pitches ?? []) {
    if (!(pitch.attempted > 0) || !pitch.guardBlocked || pitch.allocation !== 0) continue;
    const prev = bestPerCase.get(row.caseId);
    if (!prev || pitch.attempted > prev.pitch.attempted) bestPerCase.set(row.caseId, { row, pitch });
  }
}
const caseFiles = fs.readdirSync(path.join(ROOT, 'bench', 'cases'));
for (const [caseId, { row, pitch }] of bestPerCase) {
  const caseFile = caseFiles.find(f => f.endsWith(`${caseId}.json`));
  if (!caseFile) continue;
  const caseRaw = fs.readFileSync(path.join(ROOT, 'bench', 'cases', caseFile));
  const c = JSON.parse(caseRaw.toString('utf8'));
  const p = benchSubject(c.wallet);
  if (!p) { skipped.unknownProspect++; continue; }
  // The recorded run said blocked; the gate has to agree today on the same frozen record.
  const g = await gate(p, pitch.attempted);
  if (g.decision !== 'block') { skipped.notBlocked++; continue; }
  entries.push({
    initials: null,
    amount: pitch.attempted,
    line: clip(c.pitches[pitch.n - 1].text),
    prospect: p.name,
    venue: p.venueLabel,
    stopped: pitch.attempted,
    at: row.at,
    deskLine: null,
    recorded: {
      kind: 'bench',
      label: `benchmark replay · ${day(row.at)}`,
      date: row.at.slice(0, 10),
      model: 'deepseek-chat',
      evidence: `frozen suite, no tools, gate on; capture ${String(p.snapshot?.retrieved_at ?? p.truth?.capturedAt ?? '').slice(0, 10)}`,
      gate: g.code,
      source: {
        file: BENCH_REPORT, sha256: sha(reportRaw), case: caseId, repeat: row.repeat, pitch: pitch.n,
        caseFile: `bench/cases/${caseFile}`, caseSha256: sha(caseRaw),
      },
    },
  });
}

entries.sort((a, b) => b.amount - a.amount || Date.parse(b.at) - Date.parse(a.at));
// Best amount first, so the row a duplicate line keeps is its biggest con.
const seenLines = new Set();
const kept = entries.filter(e => {
  const key = lineKey(e.line);
  if (!key || seenLines.has(key)) { skipped.duplicateLine++; return false; }
  seenLines.add(key);
  return true;
});
entries.length = 0;
entries.push(...kept);
fs.writeFileSync(OUT, `${JSON.stringify({
  generator: 'scripts/seed-cons.mjs',
  rule: 'Real rounds only. A row is a con when the desk committed money to a wallet BAIT\'s gate blocks; the gate is re-run on the peak commitment against the same frozen record.',
  counts: { room: entries.filter(e => e.recorded.kind === 'room').length, bench: entries.filter(e => e.recorded.kind === 'bench').length, skipped },
  entries,
}, null, 2)}\n`);

console.log(`[seed-cons] ${roomFiles.length} room files read, ${bestPerCase.size} bench cases with a blocked proposal`);
console.log(`[seed-cons] wrote ${entries.length} rows to ${rel(OUT)}; skipped ${JSON.stringify(skipped)}`);
for (const e of entries) console.log(`  $${e.amount.toLocaleString('en-US').padStart(6)}  ${e.recorded.label.padEnd(32)} ${e.prospect}  ${e.line.slice(0, 60)}`);
