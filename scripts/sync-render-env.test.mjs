import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan, describePlan } from './sync-render-env.mjs';

test('the Render sync plan describes the key by length and never carries its value', () => {
  const key = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const plan = buildPlan({ NANSEN_API_KEY: key });
  assert.equal(plan.secret.length, 36);
  assert.equal(plan.secret.looksValid, true);
  assert.deepEqual(plan.plain, { NANSEN_LIVE: '1', HOSTED_NANSEN_CREDITS_PER_DAY: '2000', HOSTED_NANSEN_CREDITS_TOTAL: '18000', HOSTED_ROUNDS_PER_IP: '0', HOSTED_DAILY_CALLS: '3000' });
  const printed = describePlan(plan) + JSON.stringify(plan);
  assert.ok(!printed.includes(key));
  assert.ok(!printed.includes(key.slice(-4)));
  assert.match(describePlan(plan), /<secret, length 36>/);
  assert.equal(buildPlan({}).secret.length, 0);
  assert.equal(buildPlan({ NANSEN_API_KEY: 'short' }).secret.looksValid, false);
});
