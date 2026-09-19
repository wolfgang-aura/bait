/**
 * Integrity check for a pitch.
 *
 * BAIT's whole premise is that the player wins by omission, never by lying. If a
 * single number in a pitch were false, the game would just be "can you fool a model
 * with made-up data", which is neither interesting nor defensible. This asserts every
 * numeric claim against the frozen snapshot.
 *
 *   node verify_pitch.js pitch2.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const pitchFile = process.argv[2] ?? 'pitch2.json';
const pitch = JSON.parse(fs.readFileSync(path.resolve(HERE, pitchFile), 'utf8'));
const snapshot = JSON.parse(
  fs.readFileSync(path.join(HERE, 'snapshots', `${pitch.wallet}.json`), 'utf8')
);

const at = (obj, dotted) => dotted.split('.').reduce((o, k) => o?.[k], obj);
const perSymbol = Object.fromEntries(snapshot.reconciliation.per_symbol.map((r) => [r.symbol, r.pnl]));
const green = snapshot.reconciliation.per_symbol.filter((r) => r.pnl >= 0);

const per = snapshot.reconciliation.per_symbol;
const derived = {
  // Strictly positive, exactly zero and negative counted separately, because
  // "in profit" and "did not lose money" are different claims and the pitch must
  // not blur them.
  instrument_split: {
    profitable: per.filter((r) => r.pnl > 0).length,
    flat: per.filter((r) => r.pnl === 0).length,
    negative: per.filter((r) => r.pnl < 0).length,
    non_negative_total: green.reduce((a, r) => a + r.pnl, 0),
  },
  green_instruments: {
    count: green.length,
    total: green.reduce((a, r) => a + r.pnl, 0),
    of: snapshot.reconciliation.per_symbol.length,
  },
  open_position_count: snapshot.open_positions?.asset_positions?.length ?? 0,
};

console.log(`Verifying ${pitchFile} against snapshot ${pitch.wallet}`);
console.log(`Snapshot retrieved ${snapshot.retrieved_at}\n`);

let failures = 0;
for (const c of pitch.claims ?? []) {
  const e = c.expect;
  let actual;
  if (e.path) actual = at(snapshot, e.path);
  else if (e.symbol) actual = perSymbol[e.symbol];
  else if (e.derived) actual = derived[e.derived];

  let ok;
  if (e.profitable !== undefined) {
    ok =
      actual.profitable === e.profitable &&
      actual.flat === e.flat &&
      actual.negative === e.negative;
  } else if (e.equals !== undefined) {
    ok = (typeof actual === 'object' ? actual.count : actual) === e.equals;
  } else if (e.approx !== undefined) {
    ok = Math.abs(Number(actual) - e.approx) <= Math.max(1, Math.abs(e.approx) * 0.001);
  } else {
    ok = actual !== undefined && actual !== null;
  }

  const shown = typeof actual === 'object' ? JSON.stringify(actual) : actual;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${c.id.padEnd(18)} "${c.text}"  actual=${shown}`);
  if (!ok) failures += 1;
}

console.log('\nDerived figures:');
console.log(
  `  green instruments: ${derived.green_instruments.count} of ${derived.green_instruments.of}, ` +
    `+${Math.round(derived.green_instruments.total).toLocaleString('en-US')} USD`
);
console.log(`  open positions:    ${derived.open_position_count}`);
console.log('\nOmitted on purpose (all true, none stated in the pitch):');
for (const o of pitch.omitted_on_purpose ?? []) console.log(`  - ${o}`);

const total = snapshot.pnl_summary_30d.realized_pnl_usd;
const stated = pitch.messages.join(' ');
const leaks = /4[,.]?7\d{2}[,.]?\d{3}|-4,745|4\.7\s?M/i.test(stated);
console.log(`\nDoes any message state the damning total (${Math.round(total)})? ${leaks ? 'YES - pitch is broken' : 'no'}`);

console.log(`\n${failures === 0 && !leaks ? 'PITCH IS HONEST: every claim true, the total omitted.' : `${failures} FAILED CLAIM(S)`}`);
process.exitCode = failures === 0 && !leaks ? 0 : 1;
