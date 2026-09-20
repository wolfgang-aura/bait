# BAIT wallet-allocation guard

## Product boundary

BAIT protects one decision: an AI agent proposes allocating capital to a tracked
perpetual-trading wallet. BAIT checks that proposal against an independently fetched
evidence record before an execution system may honour it.

The buyer is an agent developer, copy-trading platform, wallet, managed vault, fund,
or DAO that automates wallet selection. A discretionary trader who already reviews
every allocation manually does not need BAIT.

BAIT does not execute trades, predict returns, rank wallets, guarantee future profit,
or replace portfolio risk controls. Passing the guard means the proposal satisfies one
minimum eligibility rule. It does not mean the wallet is safe or worth copying.

## Default policy

The production policy `wallet-realized-pnl-30d-v1` allows a proposed allocation only
when one Nansen `profiler/perp-pnl-summary` response proves all of the following:

- the response belongs to the requested wallet;
- the response covers the required 30-day window;
- the response came from the expected Nansen endpoint;
- the response is no more than 15 minutes old and not implausibly future-dated;
- realised PnL is a finite number at or above $0.

Every other state blocks. That includes invalid input, a provider error, a timeout,
missing PnL, stale evidence, and wallet, window, or source mismatches. The model cannot
override this decision.

The threshold is deliberately modest. Non-negative trailing PnL is an eligibility
check, not a complete investment policy. An integrator can raise the minimum without
changing the agent prompt.

## Evidence adapters and current coverage

The production default remains Nansen's Hyperliquid
`profiler/perp-pnl-summary` endpoint. The ten-wallet navigator also exercises the same
guard contract against recorded Fomo-linked Robinhood Chain results from Fomo Radar's
public API. That adapter is demonstration evidence, not a first-party Fomo production
integration. A production Fomo adapter still needs authenticated first-party coverage,
freshness guarantees, monitoring, and an explicitly approved source string.

The guard itself is venue-neutral: an integrator supplies the permitted source in the
policy, and the guard checks wallet, period, source, timestamp, and realised PnL. It
does not silently treat profile headline PnL, unrealised gains, or leaderboard total
PnL as realised PnL.

## Integration contract

```js
import { guardAllocation } from './validation/guard.js';

const decision = await guardAllocation({
  executor,                  // adapter that serves the Nansen PnL summary
  wallet,                    // 0x-prefixed 20-byte address
  allocation: proposedUsd,  // non-negative finite number
});

if (decision.decision === 'allow') {
  await executionLayer.allocate(wallet, decision.allocation);
}
```

The caller receives the proposed amount, enforced amount, stable decision code,
operator-safe reason, policy snapshot, and evidence snapshot. Provider diagnostics are
separate from the public reason. The caller owns authentication, authorization,
idempotency, order execution, persistence, and monitoring.

The guard returns a decision. It never submits a transaction itself. Integrators must
send only `decision.allocation` to their execution layer and must never fall back to the
model's proposed amount after an error.

## Decision codes

| Code | Result | Meaning |
| --- | --- | --- |
| `allowed` | allow | Matching, fresh evidence meets the policy minimum. |
| `pnl_below_minimum` | block | Verified realised PnL is below the configured threshold. |
| `evidence_unavailable` | block | The configured evidence adapter returned no usable PnL. |
| `evidence_timeout` | block | The evidence check exceeded the deadline. |
| `wallet_mismatch` | block | The response belongs to another wallet. |
| `window_mismatch` | block | The response does not cover the required period. |
| `source_mismatch` | block | The response does not identify the required endpoint. |
| `stale_evidence` | block | The response is older than the production limit. |
| `invalid_timestamp` or `future_evidence` | block | Evidence time cannot be trusted. |
| `invalid_request` | block | Wallet, amount, executor, or timeout input is invalid. |

## Benchmark versus production

The benchmark uses tracked frozen evidence so every agent sees byte-identical facts.
Its named benchmark policy disables only the age limit. Wallet, period, source, and
numeric checks still run. The production policy requires fresh evidence by default.
The public page labels its results as recorded and never presents frozen evidence as a
live authorization.

## Threat model

BAIT covers selective truthful claims, prompt persuasion, model tool refusal, malformed
evidence, wrong-wallet responses, wrong-period responses, stale results, provider
failures, and hanging evidence calls.

BAIT does not cover a compromised Nansen account, a malicious executor adapter, market
moves after the check, wallet key theft, execution slippage, liquidation risk, or every
reason a previously profitable wallet may lose money. Those need separate controls.

## Operational requirements

A production integration should log the decision code, policy id, evidence timestamp,
requested amount, and enforced amount. Alert on provider failures, timeouts, stale
evidence, and mismatches. The existing `/healthz` route reports data mode and shared
prototype limits; a real integration should add its own last-success timestamp and
blocked-decision counts.

Run the contract tests with:

```powershell
node --test validation/guard.test.js
```

The tests cover the allow path and every fail-closed branch listed above.
