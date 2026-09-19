/**
 * Step 6: confirm the token-side endpoints work, for future token-based challenges.
 * Budget: flow-intelligence (1) + token-information (1) + holders (5) = 7 credits.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { call, creditsUsed, CREDIT_BUDGET } from './nansen.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// WETH on Ethereum: well known, deep liquidity, stable schema to record.
const TARGET = { chain: 'ethereum', token_address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2' };

const shape = (v, depth = 0) => {
  if (v === null) return 'null';
  if (Array.isArray(v)) return depth > 2 ? 'array' : [shape(v[0], depth + 1)];
  if (typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shape(x, depth + 1)]));
  }
  return typeof v;
};

const out = { retrieved_at: new Date().toISOString(), target: TARGET, endpoints: {} };
const plan = [
  ['tgm/token-information', { ...TARGET, timeframe: '1d' }, 1],
  ['tgm/flow-intelligence', { ...TARGET, timeframe: '1d' }, 1],
  ['tgm/holders', { ...TARGET, label_type: 'smart_money', pagination: { page: 1, per_page: 5 } }, 5],
];

console.log(`Reach check. Credits: ${creditsUsed()}/${CREDIT_BUDGET}\n`);
for (const [p, body, cost] of plan) {
  if (creditsUsed() + cost > CREDIT_BUDGET) {
    console.log(`SKIP ${p}: would exceed the ${CREDIT_BUDGET} credit budget.`);
    out.endpoints[p] = { skipped: 'budget' };
    continue;
  }
  process.stdout.write(`${p} ...\n`);
  try {
    const res = await call(p, body, { note: 'reach check' });
    const rows = res.data?.data;
    out.endpoints[p] = {
      status: res.status,
      credits: cost,
      request: body,
      row_count: Array.isArray(rows) ? rows.length : null,
      schema: shape(res.data),
      sample: JSON.parse(JSON.stringify(rows)).slice?.(0, 1) ?? rows,
    };
    console.log(`   OK, ${Array.isArray(rows) ? rows.length + ' rows' : 'object'}`);
  } catch (err) {
    out.endpoints[p] = { error: err.message, status: err.status ?? null };
    console.log(`   FAILED: ${err.message}`);
  }
}

fs.writeFileSync(path.join(HERE, 'endpoint_reach.json'), JSON.stringify(out, null, 2));
console.log(`\nWrote endpoint_reach.json. Credits: ${creditsUsed()}/${CREDIT_BUDGET}`);
