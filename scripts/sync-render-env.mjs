/**
 * Copy the Nansen key from the local .env to the Render service, plus the three
 * non-secret switches the hosted live read needs, through the Render API. The founder
 * never pastes a secret into a dashboard, and this script never prints one: only the
 * key's length and whether it looks like a key.
 *
 *   node scripts/sync-render-env.mjs            dry run: prints the plan, sends nothing
 *   node scripts/sync-render-env.mjs --apply    sends it
 *
 * Needs, in the local .env or the environment:
 *   NANSEN_API_KEY     the key to copy
 *   RENDER_API_KEY     a Render API key (Account settings > API keys)
 *   RENDER_SERVICE_ID  optional, srv-...; without it the service named `bait` is looked up
 *
 * Setting an env var does not redeploy. Trigger a deploy afterwards (see README).
 * Endpoints: GET /v1/services?name=, PUT /v1/services/{id}/env-vars/{key}.
 */
import { loadEnv } from '../validation/nansen.js';

const API = 'https://api.render.com/v1';
export const SERVICE_NAME = 'bait';

/** What will be set. Secret values are described, never included. */
export function buildPlan(env) {
  const key = env.NANSEN_API_KEY ?? '';
  return {
    secret: { name: 'NANSEN_API_KEY', length: key.length, looksValid: /^[A-Za-z0-9_-]{20,}$/.test(key) },
    plain: {
      NANSEN_LIVE: '1',
      HOSTED_NANSEN_CREDITS_PER_DAY: env.HOSTED_NANSEN_CREDITS_PER_DAY || '2000',
      HOSTED_NANSEN_CREDITS_TOTAL: env.HOSTED_NANSEN_CREDITS_TOTAL || '18000',
      // 0 = no per-address round cap; the global DeepSeek cap stays the cost guard.
      HOSTED_ROUNDS_PER_IP: env.HOSTED_ROUNDS_PER_IP || '0',
      HOSTED_DAILY_CALLS: env.HOSTED_DAILY_CALLS || '3000',
    },
  };
}

export function describePlan(plan) {
  return [
    `  NANSEN_API_KEY                 <secret, length ${plan.secret.length}${plan.secret.looksValid ? '' : ', DOES NOT LOOK LIKE A KEY'}>`,
    ...Object.entries(plan.plain).map(([k, v]) => `  ${k.padEnd(30)} ${v}`),
  ].join('\n');
}

async function render(path, { method = 'GET', body, token }) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, accept: 'application/json', 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Render ${method} ${path} -> ${res.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const env = { ...loadEnv(), ...process.env };
  const plan = buildPlan(env);
  console.log(`[render-env] plan for service "${env.RENDER_SERVICE_ID || SERVICE_NAME}":\n${describePlan(plan)}`);
  if (!plan.secret.length) throw new Error('NANSEN_API_KEY is not in the local .env.');
  if (!plan.secret.looksValid) throw new Error('NANSEN_API_KEY does not look like a key; refusing to send it.');
  if (!apply) { console.log('[render-env] dry run. Nothing sent. Re-run with --apply.'); return; }

  const token = env.RENDER_API_KEY;
  if (!token) throw new Error('RENDER_API_KEY is not set (local .env or environment).');
  let id = env.RENDER_SERVICE_ID;
  if (!id) {
    const found = await render(`/services?name=${encodeURIComponent(SERVICE_NAME)}&limit=20`, { token });
    const matches = (found ?? []).map(r => r.service ?? r).filter(s => s?.name === SERVICE_NAME);
    if (matches.length !== 1) throw new Error(`Expected one Render service named "${SERVICE_NAME}", found ${matches.length}. Set RENDER_SERVICE_ID.`);
    id = matches[0].id;
  }
  console.log(`[render-env] service ${id}`);
  await render(`/services/${id}/env-vars/NANSEN_API_KEY`, { method: 'PUT', body: { value: env.NANSEN_API_KEY }, token });
  console.log(`[render-env] NANSEN_API_KEY set (length ${plan.secret.length})`);
  for (const [k, v] of Object.entries(plan.plain)) {
    await render(`/services/${id}/env-vars/${k}`, { method: 'PUT', body: { value: v }, token });
    console.log(`[render-env] ${k}=${v}`);
  }
  // Read back names only, so the check itself cannot echo a value.
  const vars = await render(`/services/${id}/env-vars?limit=100`, { token });
  const names = (vars ?? []).map(r => (r.envVar ?? r).key).filter(Boolean);
  const missing = ['NANSEN_API_KEY', ...Object.keys(plan.plain)].filter(k => !names.includes(k));
  console.log(missing.length ? `[render-env] MISSING after write: ${missing.join(', ')}` : '[render-env] all four present on the service. Deploy to pick them up.');
  if (missing.length) process.exitCode = 1;
}

if (process.argv[1]?.endsWith('sync-render-env.mjs')) {
  main().catch(err => {
    // Scrub the key out of anything an API error might echo back.
    const key = ({ ...loadEnv(), ...process.env }).NANSEN_API_KEY;
    const message = key ? String(err.message).split(key).join('<redacted>') : String(err.message);
    console.error(`[render-env] ${message}`);
    process.exit(1);
  });
}
