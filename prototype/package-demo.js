/** Produce an allowlisted recorded demo. No server, credentials or model endpoints. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildResults } from './export-results.js';

const root = fileURLToPath(new URL('../', import.meta.url));
export function demoFiles() {
  const files = new Map();
  const read = name => fs.readFileSync(path.join(root, 'prototype/public', name), 'utf8');
  // On GitHub Pages "/" is not the game: Play goes to the hosted room, Proof to this page.
  const html = read('replay.html')
    .replaceAll('href="/" data-host-link', 'href="https://bait-wyqr.onrender.com/" data-host-link')
    .replaceAll('href="/#any-wallet" data-host-link', 'href="https://bait-wyqr.onrender.com/#any-wallet" data-host-link')
    .replaceAll('href="/api/live-reads" data-host-link', 'href="https://bait-wyqr.onrender.com/api/live-reads" data-host-link')
    .replaceAll('href="/replay.html" data-host-link', 'href="./index.html" data-host-link')
    .replaceAll('="/', '="./');
  files.set('index.html', html);
  files.set('replay.html', html);
  files.set('replay.js', read('replay.js')
    .replace("fetch('/recorded-results.json'", "fetch('./recorded-results.json'")
    .replace("fetch('/wallets.json'", "fetch('./wallets.json'"));
  for (const name of ['replay.css', 'player-summary.js']) files.set(name, read(name));
  files.set('recorded-results.json', JSON.stringify(buildResults(), null, 2) + '\n');
  // No third-party entity labels on the published copy (same rule as the server).
  const nav = JSON.parse(fs.readFileSync(path.join(root, 'validation', 'wallet-navigator.json'), 'utf8'));
  nav.venues = nav.venues.map(v => ({ ...v, wallets: v.wallets.map(({ label, ...w }) => w) }));
  files.set('wallets.json', JSON.stringify(nav, null, 2) + String.fromCharCode(10));
  return files;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = path.join(root, 'scratch', 'bait-recorded-demo');
  fs.mkdirSync(out, { recursive: true });
  // Never leave unreviewed leftovers in a distribution directory.
  const existing = fs.readdirSync(out, { recursive: true, withFileTypes: true }).filter(e => e.isFile());
  const files = demoFiles();
  for (const entry of existing) {
    const relative = path.relative(out, path.join(entry.parentPath, entry.name)).replaceAll('\\', '/');
    if (!files.has(relative)) throw new Error(`Unexpected output file: ${relative}. Choose a clean output before packaging.`);
  }
  for (const [name, body] of files) {
    const target = path.join(out, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, body);
  }
  console.log(`Recorded demo prepared: ${files.size} files in ${out}. No API calls. Not deployed.`);
}
