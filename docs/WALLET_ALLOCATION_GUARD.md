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

## Run it live

`validation/guard-live.js` is the evidence adapter that points the guard at Nansen
instead of at a frozen snapshot. `createLiveGuardExecutor` serves `get_pnl_summary`
with exactly one `profiler/perp-pnl-summary` call and maps the response into the same
evidence shape `validation/tools.js` serves from disk, so the number judged live is the
number the benchmark judged frozen. Any other tool name throws. One check costs one
credit, and the credit guard in `validation/nansen.js` stays in the path.

`runLiveGuard` wraps that adapter with the production policy, so evidence freshness is
enforced at 15 minutes, and adds `creditsCharged` and `creditsRemaining` to the decision.

Three ways to run it, all needing only `NANSEN_API_KEY` in `.env`:

```powershell
npm run guard -- --wallet 0x69cc3ae720efdff1cd2a8edec79a7a3fac6e14fd --allocation 5000
npm run guard -- --wallet 0x9546b9d4103be41ce13483a8f299d0df0eeb181c --allocation 5000 --json
```

The CLI exits 0 on allow, 2 on block or bad usage, 3 with no API key, and 1 on an
unexpected crash. Every Nansen request carries the guard's 10-second deadline, so the
command cannot hang.

`POST /api/guard` on the local prototype takes `{ wallet, allocation }` and returns the
same decision object with status 200. A rejected wallet or amount is still a guard
decision, so it returns 200 with an `invalid_request` block; only unreadable JSON is a
400. Under `HOSTED=1` the route returns 403 `guard_disabled_hosted`, because a public
visitor must not be able to spend the key's credits. `/api/health` reports the route,
the page and the policy id under `live_guard`.

`prototype/public/guard.html` is the form for the same route, linked from the local
index footer.

Two real checks on 21 September 2026, one credit each:

| Wallet | Realised PnL, 30d | Decision | Code | Enforced | Retrieved |
| --- | ---: | --- | --- | ---: | --- |
| `0x69cc3ae720efdff1cd2a8edec79a7a3fac6e14fd` | -$847,025.38 | block | `pnl_below_minimum` | $0.00 | `2026-09-20T22:13:01.052Z` |
| `0x9546b9d4103be41ce13483a8f299d0df0eeb181c` | $995,387.17 | allow | `allowed` | $5,000.00 | `2026-09-20T22:12:53.217Z` |

A third live check, on the encounter wallet
`0xc26cbb6483229e0d0f9a1cab675271eda535b8f4`, returned allow with a realised 30-day PnL
of $247,619.77 at `2026-09-20T22:11:37.570Z`. That wallet lost $4.7M over the frozen 15
September window. The guard reports what the current window says, not what the recorded
round says. The recorded benchmark numbers are unchanged, because they are tied to the
frozen snapshot, and a wallet that has climbed back above water is a real outcome rather
than a fault.

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

## Decision output fields

| Field | Meaning |
| --- | --- |
| `decision` | `allow` or `block`. The only field an execution layer needs to branch on. |
| `code` | Stable machine code from the table above. |
| `allocation` | The enforced amount. Send this, never `attempted`. |
| `attempted` | What the caller proposed, kept for the audit trail. |
| `blocked` | True when a positive proposal was forced to zero. |
| `reason` | One operator-safe sentence. Contains no provider detail. |
| `diagnostic` | Provider detail on a failure, or null. Log it, do not show it. |
| `policy` | `id`, `window_days`, `minimum_realized_pnl_usd`, `max_evidence_age_ms`. |
| `evidence` | `wallet`, `window_days`, `realized_pnl_usd`, `realized_pnl_30d_usd`, `retrieved_at`, `source`. Every field is null when the check could not read it. |
| `creditsCharged` | Nansen credits this check spent. Added by `runLiveGuard`, one per check. |
| `creditsRemaining` | Account balance last reported by Nansen, or null if unknown. |

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
node --test validation/guard.test.js validation/guard-live.test.js scripts/guard.test.mjs
```

The tests cover the allow path and every fail-closed branch listed above. The live
tests stub the Nansen client, so they make no network call and spend no credits.
