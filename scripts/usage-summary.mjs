/**
 * Round 18: the public Nansen usage ledger. Summarises validation/call_ledger.jsonl (every
 * Nansen request this project made, kept in the dev repo) into bench/nansen-usage.json: calls,
 * successes and credits per endpoint and per day. No request bodies, addresses or headers.
 *
 *   node scripts/usage-summary.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function summarise(lines) {
  const byEndpoint = {};
  const byDay = {};
  let calls = 0; let ok = 0; let credits = 0; let first = null; let last = null;
  for (const line of lines) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    const endpoint = String(r.path ?? 'unknown');
    const c = Number(r.credits_charged) || 0;
    const good = r.status >= 200 && r.status < 300;
    const day = String(r.ts ?? '').slice(0, 10);
    calls++; credits += c; if (good) ok++;
    first = first && first < r.ts ? first : r.ts; last = last && last > r.ts ? last : r.ts;
    const e = (byEndpoint[endpoint] ??= { calls: 0, ok: 0, credits: 0 });
    e.calls++; e.credits += c; if (good) e.ok++;
    const d = (byDay[day] ??= { calls: 0, credits: 0 });
    d.calls++; d.credits += c;
  }
  return { source: 'validation/call_ledger.jsonl (dev repo), summarised by scripts/usage-summary.mjs', first, last, calls, ok, credits, byEndpoint, byDay };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const lines = fs.readFileSync(path.join(ROOT, 'validation', 'call_ledger.jsonl'), 'utf8').split(/\r?\n/);
  const out = summarise(lines);
  fs.writeFileSync(path.join(ROOT, 'bench', 'nansen-usage.json'), `${JSON.stringify(out, null, 1)}\n`);
  console.log(`${out.calls} calls, ${out.ok} ok, ${out.credits} credits, ${out.first} to ${out.last}`);
}
