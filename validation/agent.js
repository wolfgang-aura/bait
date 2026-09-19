/**
 * Step 5 CLI: run BAIT games against a real model and score them with the referee.
 *
 *   node agent.js --unarmed --runs 3
 *   node agent.js --armed   --runs 3
 *   node agent.js --armed --provider deepseek --runs 1
 *
 * Traces land in validation/runs/ and are mirrored into prototype/runs/ so the
 * prototype's Gullibility Index is built from the same real games, not a second set.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { playGame } from './game.js';
import { providerByName, stubProvider, modelCallsUsed, CAPS, CapExceeded } from './providers.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUNS_DIR = path.join(HERE, 'runs');
const MIRROR_DIR = path.resolve(HERE, '..', 'prototype', 'runs');

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const has = (name) => argv.includes(`--${name}`);

const mode = has('armed') ? 'armed' : has('unarmed') ? 'unarmed' : flag('mode', 'unarmed');
const providerName = flag('provider', 'anthropic');
const runCount = Number(flag('runs', 1));
const walletArg = flag('wallet', null);
const variant = has('neutral') ? 'neutral' : 'strict';
const ruleId = flag('rule', 'R0_binary');

// R2 needs a second, profitable wallet on the table.
const controlFile = fs
  .readdirSync(path.join(HERE, 'snapshots'))
  .find((f) => f.startsWith('control_'));
const control =
  ruleId === 'R2_forced_choice' && controlFile
    ? JSON.parse(fs.readFileSync(path.join(HERE, 'snapshots', controlFile), 'utf8'))
    : null;

const snapshotFile =
  flag('snapshot', null) ??
  path.join(
    HERE,
    'snapshots',
    `${walletArg ?? fs.readdirSync(path.join(HERE, 'snapshots')).find((f) => f.startsWith('0x')).replace('.json', '')}.json`
  );
const snapshot = JSON.parse(fs.readFileSync(snapshotFile, 'utf8'));
const pitch = JSON.parse(fs.readFileSync(flag('pitch', path.join(HERE, 'pitch.json')), 'utf8'));

const provider = providerName === 'stub' ? stubProvider([]) : providerByName(providerName);

fs.mkdirSync(RUNS_DIR, { recursive: true });
fs.mkdirSync(MIRROR_DIR, { recursive: true });

console.log(`BAIT runs: rule=${ruleId} mode=${mode} variant=${variant} provider=${provider.vendor} model=${provider.model} runs=${runCount}`);
if (control) console.log(`Control wallet (B): ${control.wallet} 30d realized +${Math.round(control.pnl_summary_30d.realized_pnl_usd)}`);
console.log(`Snapshot: ${path.basename(snapshotFile)} (wallet ${snapshot.wallet})`);
console.log(`Model calls used so far: ${JSON.stringify(modelCallsUsed())} caps ${JSON.stringify(CAPS)}\n`);

const results = [];
for (let n = 1; n <= runCount; n++) {
  process.stdout.write(`[run ${n}/${runCount}] playing ...\n`);
  const t0 = Date.now();
  try {
    const run = await playGame({
      provider,
      mode,
      pitch,
      snapshot,
      variant,
      ruleId,
      control,
      onEvent: (e) => {
        if (e.type === 'tool_call') {
          const key =
            e.result?.realized_pnl_usd !== undefined
              ? `realized_pnl_usd=${e.result.realized_pnl_usd}`
              : e.result?.total_realized_pnl_usd !== undefined
                ? `total_realized_pnl_usd=${e.result.total_realized_pnl_usd}`
                : 'ok';
          process.stdout.write(`    tool ${e.name}(${JSON.stringify(e.input)}) -> ${key}\n`);
        }
      },
    });
    const file = `${run.rule}_${run.provider.vendor}_${run.provider.model}_${mode}_${n}_${run.id.split('-').pop()}.json`;
    fs.writeFileSync(path.join(RUNS_DIR, file), JSON.stringify(run, null, 2));
    fs.writeFileSync(path.join(MIRROR_DIR, file), JSON.stringify(run, null, 2));
    results.push(run);
    console.log(
      `    -> ${run.outcome}  ` +
        (run.decision.allocation_pct !== undefined
          ? `allocation=${run.decision.allocation_pct}%`
          : run.decision.choice !== undefined
            ? `choice=${run.decision.choice}`
            : `decision=${run.decision.decision}`) +
        `${run.parsed_decision.malformed ? ' (MALFORMED)' : ''}` +
        `  model_calls=${run.model_calls}  tools=${run.tool_calls.length}` +
        `  ${((Date.now() - t0) / 1000).toFixed(1)}s -> runs/${file}`
    );
  } catch (err) {
    if (err instanceof CapExceeded) {
      console.error(`\n${err.message}\nStopping. Remaining runs not attempted.`);
      break;
    }
    console.error(`    run failed: ${err.message}`);
  }
}

const conned = results.filter((r) => r.outcome === 'CONNED').length;
console.log(`\n${mode} / ${provider.model}: ${conned}/${results.length} CONNED`);
console.log(`Model calls used: ${JSON.stringify(modelCallsUsed())} caps ${JSON.stringify(CAPS)}`);
