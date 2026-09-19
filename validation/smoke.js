/** Step 1: prove auth works. Uses the 0-credit `account` endpoint. */
import { call, keyFingerprint, creditsUsed, CREDIT_BUDGET } from './nansen.js';

const fp = keyFingerprint();
console.log(`API key loaded: present=${fp.present} length=${fp.length ?? '-'} suffix=***${fp.suffix ?? ''}`);
console.log(`Credits used so far: ${creditsUsed()}/${CREDIT_BUDGET}`);

let ok = false;
for (const method of ['GET', 'POST']) {
  try {
    console.log(`\nTrying ${method} account ...`);
    const res = await call('account', method === 'POST' ? {} : null, {
      method,
      note: 'auth smoke test',
    });
    console.log(`  status ${res.status}`);
    console.log(`  rate-limit headers: ${JSON.stringify(res.headers, null, 2)}`);
    console.log(`  body: ${JSON.stringify(res.data, null, 2).slice(0, 2000)}`);
    ok = true;
    break;
  } catch (err) {
    console.log(`  ${err.message}`);
  }
}

console.log(`\nAuth smoke test: ${ok ? 'PASS' : 'FAIL'}`);
console.log(`Credits used: ${creditsUsed()}/${CREDIT_BUDGET}`);
process.exit(ok ? 0 : 1);
