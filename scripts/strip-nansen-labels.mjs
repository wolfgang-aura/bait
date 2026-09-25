/**
 * Strip Nansen address labels from every committed read (validation/nansen-labels.js says why).
 *
 *   node scripts/strip-nansen-labels.mjs           dry run: which files hold labels, how many
 *   node scripts/strip-nansen-labels.mjs --write   rewrite them, then replace every recorded
 *                                                  SHA-256 of a rewritten file in the tracked tree
 *
 * A file is rewritten only when parsing and re-serialising it in its own format gives back its
 * exact bytes, so the only change is the labels. Ledgers stay local and are skipped.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stripNansenLabels, hasNansenLabel, NANSEN_LABEL_KEYS } from '../validation/nansen-labels.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const write = process.argv.includes('--write');
const sha = buf => createHash('sha256').update(buf).digest('hex');
const lf = s => s.replace(/\r\n/g, '\n');
const KEY_RE = new RegExp(`"(?:${NANSEN_LABEL_KEYS.join('|')})"\\s*:`);

const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).trim().split(/\r?\n/);
const data = tracked.filter(f => /\.jsonl?$/.test(f) && !/_ledger\.jsonl$/.test(f));

/** Serialisers to try, in order; the one that reproduces the file's bytes is its format. */
const FORMATS = [
  ['indent2+nl', v => `${JSON.stringify(v, null, 2)}\n`],
  ['indent2', v => JSON.stringify(v, null, 2)],
  ['compact', v => JSON.stringify(v)],
  ['compact+nl', v => `${JSON.stringify(v)}\n`],
  ['indent1+nl', v => `${JSON.stringify(v, null, 1)}\n`],
];

function rewrite(text, file) {
  const crlf = /\r\n/.test(text);
  const body = lf(text);
  if (file.endsWith('.jsonl')) {
    const lines = body.split('\n');
    const out = lines.map((line, i) => {
      if (!line.trim()) return line;
      const v = JSON.parse(line);
      if (JSON.stringify(v) !== line) throw new Error(`${file}:${i + 1} does not round-trip`);
      return JSON.stringify(stripNansenLabels(v));
    });
    const labelled = lines.filter(l => l.trim() && hasNansenLabel(JSON.parse(l))).length;
    const joined = out.join('\n');
    return { text: crlf ? joined.replace(/\n/g, '\r\n') : joined, labelled };
  }
  const v = JSON.parse(body);
  const fmt = FORMATS.find(([, f]) => f(v) === body);
  if (!fmt) throw new Error(`${file} does not round-trip in any known JSON format`);
  const joined = fmt[1](stripNansenLabels(v));
  return { text: crlf ? joined.replace(/\n/g, '\r\n') : joined, labelled: 1 };
}

const changed = [];
for (const file of data) {
  const abs = path.join(ROOT, file);
  const text = fs.readFileSync(abs, 'utf8');
  if (!KEY_RE.test(text)) continue;
  const { text: next, labelled } = rewrite(text, file);
  if (next === text) continue;
  const keys = Object.fromEntries(NANSEN_LABEL_KEYS.map(k => [k, (text.match(new RegExp(`"${k}"\\s*:`, 'g')) ?? []).length]).filter(([, n]) => n));
  changed.push({ file, labelled, keys, before: { raw: sha(Buffer.from(text)), lf: sha(lf(text)) }, after: { raw: sha(Buffer.from(next)), lf: sha(lf(next)) }, bytes: [Buffer.byteLength(text), Buffer.byteLength(next)] });
  if (write) fs.writeFileSync(abs, next);
  console.log(`${write ? 'stripped' : 'would strip'} ${file}: ${Object.entries(keys).map(([k, n]) => `${k} ${n}`).join(', ')} (${Buffer.byteLength(text)} -> ${Buffer.byteLength(next)} bytes)`);
}

// Every place the tree records a rewritten file's SHA-256 gets the new one.
const map = new Map();
for (const c of changed) { map.set(c.before.raw, c.after.raw); map.set(c.before.lf, c.after.lf); }
const texty = tracked.filter(f => /\.(jsonl?|md|js|mjs|cjs|html|txt|ya?ml)$/.test(f) && !/_ledger\.jsonl$/.test(f));
const refs = [];
for (const file of texty) {
  const abs = path.join(ROOT, file);
  if (!fs.existsSync(abs)) continue;
  let text = fs.readFileSync(abs, 'utf8');
  let n = 0;
  for (const [from, to] of map) {
    if (from === to || !text.includes(from)) continue;
    n += text.split(from).length - 1;
    text = text.split(from).join(to);
  }
  if (!n) continue;
  refs.push({ file, n });
  if (write) fs.writeFileSync(abs, text);
}
for (const r of refs) console.log(`${write ? 'updated' : 'would update'} ${r.n} SHA-256 reference(s) in ${r.file}`);

// Short prefixes (docs cite 8-12 characters) are listed for a person to check, never rewritten.
const short = [];
for (const file of texty) {
  const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
  for (const c of changed) for (const h of [c.before.raw, c.before.lf]) {
    const p = h.slice(0, 8);
    if (text.includes(p) && !text.includes(h)) short.push(`${file}: ${p}... (${c.file})`);
  }
}
for (const s of [...new Set(short)]) console.log(`CHECK short hash prefix ${s}`);
console.log(`${changed.length} file(s) ${write ? 'stripped' : 'to strip'}; ${refs.length} file(s) with SHA-256 references.`);
if (process.argv.includes('--json')) console.log(JSON.stringify(changed, null, 1));
