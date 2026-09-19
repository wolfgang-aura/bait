/** Produce an allowlisted recorded demo. No server, credentials or model endpoints. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildResults } from './export-results.js';

const root = fileURLToPath(new URL('../', import.meta.url));
export function demoFiles() {
  const files = new Map();
  const read = name => fs.readFileSync(path.join(root, 'prototype/public', name), 'utf8');
  const html = read('replay.html')
    .replaceAll('="/', '="./')
    .replace('href="./">Play your own round ↗', 'href="./RUN_LOCALLY.txt">Run the live game locally ↗')
    .replace('href="./" role="button">Try your own pitch ↗', 'href="./RUN_LOCALLY.txt" role="button">Run the live game locally ↗');
  files.set('index.html', html);
  files.set('replay.html', html);
  files.set('replay.js', read('replay.js').replace("fetch('/recorded-results.json'", "fetch('./recorded-results.json'"));
  for (const name of ['player-summary.js', 'encounter.css', 'vendor/pico.min.css', 'vendor/PICO-LICENSE.md']) files.set(name, read(name));
  files.set('recorded-results.json', JSON.stringify(buildResults(), null, 2) + '\n');
  files.set('RUN_LOCALLY.txt', fs.readFileSync(path.join(root, 'README.md'), 'utf8'));
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
