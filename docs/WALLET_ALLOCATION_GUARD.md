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

## Default policy: `wallet-copy-risk-v2`

The default gate reads **two** windows of Nansen `profiler/perp-pnl-summary` for the
wallet, the 7-day and the 30-day, and runs a named check on each. It allows only when
no check fails. One credit per window, and the 7-day window is fetched only after the
30-day evidence has passed everything it alone can decide, so a refused wallet costs
one credit rather than two.

The second window is not decoration. Across 840 saved summaries in
[the robustness panel](../bench/reports/robustness-panel.md), the 7-day and 30-day
verdicts disagreed on 103 of 420 matched wallet-date pairs, 25%. A gate reading one
window is, by that measurement, reading a window the other one contradicts about a
quarter of the time.

### The check table

Every decision carries a `checks` array with one row per check: `id`, `result`
(`pass`, `fail` or `not_assessed`), the `value` it read, the `threshold` it wanted and
a one-line `plain` explanation. The public `reason` names the first failing row.

| id | What it reads | Bar | On failure |
| --- | --- | --- | --- |
| `evidence_30d` | 30-day summary: wallet, window, source | Matches the request and the policy source | block `evidence_unavailable`, `wallet_mismatch`, `window_mismatch` or `source_mismatch` |
| `evidence_freshness` | Age of the 30-day evidence | At most 15 minutes old, not future-dated | block `stale_evidence`, `invalid_timestamp` or `future_evidence` |
| `evidence_7d` | 7-day summary: wallet, window, source, age | Same bars as the 30-day evidence | block `short_window_unavailable` or `short_window_mismatch` |
| `realised_pnl_30d` | `realized_pnl_usd`, 30 days | At or above `minimumRealizedPnlUsd`, default $0 | block `pnl_below_minimum` |
| `regime_agreement` | Sign of 7-day vs 30-day realised PnL | Same sign, or the 7-day move is under 10% of the 30-day figure | block `regime_disagreement` |
| `thin_sample` | `closed_trade_count`, 30 days | At least 20 | block `thin_sample` |
| `low_win_rate` | `win_rate`, 30 days | At least 0.40 | block `low_win_rate` |
| `paper_headline` | Unrealised share of the headline | At most 80% | block `paper_headline` |
| `concentration` | Top position and top-coin share | 50% / 60% | not assessed here, see below |
| `tail_loss` | Worst single closed trade | At most 25% of volume or account | not assessed here, see below |
| `max_drawdown` | Peak-to-trough realised curve | 30% of peak, 15% of account | not assessed here, see below |

The numeric bars come from `COPY_RISK_THRESHOLDS` in `validation/guard.js`, the same
table `assessCopyRisk` uses, so the game's copy-risk report and this gate refuse a
wallet for the same reason at the same number.

### What the gate does not assess, and why

`concentration`, `tail_loss` and `max_drawdown` need the per-fill tape from
`profiler/perp-trades`. The guard's evidence adapter fetches PnL summaries only, so
these three always report `not_assessed` with that reason in the row. They are covered
by `assessCopyRisk`, which the game's `/api/assess` and `npm run assess` serve from a
snapshot that does hold the fills. Adding them to the gate would mean paging fills on
every check, which is a different cost profile and is not in this version.

`paper_headline` reports `not_assessed` on the shipped Nansen adapter, because
`profiler/perp-pnl-summary` reports realised PnL only and carries no unrealised figure.
An adapter that does supply `unrealized_pnl_usd` gets the check without a code change.

A `not_assessed` row is never read as a pass. It is printed, in the same table, with
the reason it could not be looked at.

### `wallet-realized-pnl-30d-v1`

The earlier policy is still shipped and still reachable, as
`PRODUCTION_GUARD_POLICY_V1` or by passing `version: 'v1'`. It is one
`profiler/perp-pnl-summary` call over 30 days and one sign test on realised PnL, with
the same identity, window, source, freshness and timeout checks. It is kept because
the recorded `guarded` benchmark row is tied to exactly that rule on exactly one call,
and a benchmark number whose rule has moved underneath it is not reproducible.

Under v1 the `checks` table is still published; the v2-only rows read `not_assessed`
with "policy v1 reads the 30-day window only".

### Fail closed, under both policies

Every other state blocks: invalid input, a provider error, a timeout, missing PnL,
stale evidence, and wallet, window or source mismatches on either window. Missing
evidence is never an allowance. The model cannot override any of this.

Neither policy ever emits a size of its own. The enforced amount is the caller's
proposed amount, or $0. There is no calibrated or scaled allocation.

The $0 threshold is deliberately modest. Non-negative trailing PnL is an eligibility
check, not a complete investment policy. An integrator can raise the minimum, or any
other bar in the table, without changing the agent prompt.

## Evidence adapters and current coverage

The production default is Nansen's Hyperliquid `profiler/perp-pnl-summary` endpoint.
The earlier public Fomo navigator rows were removed because the available aggregate
disagreed with the same provider's closed-round-trip records. A production Fomo adapter
still needs authenticated first-party coverage, freshness guarantees, monitoring, and
an explicitly approved source string.

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
  // policy is optional. The default is wallet-copy-risk-v2.
  // Pass PRODUCTION_GUARD_POLICY_V1 for the one-window rule.
});

if (decision.decision === 'allow') {
  await executionLayer.allocate(wallet, decision.allocation);
}

// Why, in one table, on an allow as well as on a block.
for (const check of decision.checks) {
  console.log(check.result, check.id, check.value, check.threshold, check.plain);
}
```

The `executor` contract is unchanged. `guardAllocation` calls
`executor.execute('get_pnl_summary', { wallet, days })`, and under v2 it makes that
call twice, once with `days: 30` and once with `days: 7`. An adapter that already
serves 30 days serves 7 the same way.

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
with one `profiler/perp-pnl-summary` call per window and maps the response into the
same evidence shape `validation/tools.js` serves from disk, including `win_rate` and
`closed_trade_count`, so the numbers judged live are the numbers the benchmark judged
frozen. Any other tool name throws. The credit guard in `validation/nansen.js` stays in
the path.

Cost is one credit per window: one for `wallet-realized-pnl-30d-v1`, two for
`wallet-copy-risk-v2`, and only one when the 30-day evidence already refuses.

`runLiveGuard` wraps that adapter, enforces 15-minute freshness, and adds
`creditsCharged` and `creditsRemaining` to the decision. Its own default policy is
pinned to v1, because `POST /api/guard` in `prototype/server.js` calls it and its
contract test asserts the one-credit v1 behaviour; pass `policy` for v2.

Two ways to run it, both needing only `NANSEN_API_KEY` in `.env`:

```powershell
# wallet-copy-risk-v2, two windows, two credits, prints the full check table
npm run guard -- --wallet 0x69cc3ae720efdff1cd2a8edec79a7a3fac6e14fd --allocation 5000

# the recorded one-window rule, one credit
npm run guard -- --wallet 0x9546b9d4103be41ce13483a8f299d0df0eeb181c --allocation 5000 --policy v1 --json
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
index footer. Paste any valid Hyperliquid address and proposed amount. The receipt shows
the wallet, value, source, timestamp, policy, reason and enforced amount. An `allow`
machine result is displayed as `ELIGIBLE` so nobody mistakes it for a profit forecast.

Two real checks on 21 September 2026, run under `wallet-realized-pnl-30d-v1`, one
credit each. No live v2 check has been run; none was budgeted.

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

| Code | Result | Failing check | Meaning |
| --- | --- | --- | --- |
| `allowed` | allow | none | Every check in the policy passed. |
| `pnl_below_minimum` | block | `realised_pnl_30d` | Verified 30-day realised PnL is below the configured threshold. |
| `regime_disagreement` | block | `regime_agreement` | The 7-day and 30-day realised PnL have opposite signs and the 7-day move is at least 10% of the 30-day figure. v2 only. |
| `thin_sample` | block | `thin_sample` | Fewer than 20 closed trades in 30 days. v2 only. |
| `low_win_rate` | block | `low_win_rate` | The 30-day win rate is below the policy minimum. v2 only. |
| `paper_headline` | block | `paper_headline` | More than 80% of the headline is unsold. v2 only, and only when the adapter supplies unrealised PnL. |
| `evidence_unavailable` | block | `evidence_30d` or `evidence_7d` | The evidence adapter returned no usable PnL, or threw. |
| `evidence_timeout` | block | `evidence_30d` or `evidence_7d` | The evidence check exceeded the deadline. |
| `wallet_mismatch` | block | `evidence_30d` | The 30-day response belongs to another wallet. |
| `window_mismatch` | block | `evidence_30d` | The 30-day response does not cover the required period. |
| `source_mismatch` | block | `evidence_30d` | The 30-day response does not identify the required endpoint. |
| `short_window_unavailable` | block | `evidence_7d` | The 7-day response carried no usable realised PnL. v2 only. |
| `short_window_mismatch` | block | `evidence_7d` | The 7-day response has the wrong wallet, window, source or timestamp. v2 only. |
| `stale_evidence` | block | `evidence_freshness` | The response is older than the production limit. |
| `invalid_timestamp` or `future_evidence` | block | `evidence_freshness` | Evidence time cannot be trusted. |
| `invalid_request` | block | none reached | Wallet, amount, executor, or timeout input is invalid. |

## Decision output fields

| Field | Meaning |
| --- | --- |
| `decision` | `allow` or `block`. The only field an execution layer needs to branch on. |
| `code` | Stable machine code from the table above. |
| `allocation` | The enforced amount. Send this, never `attempted`. |
| `attempted` | What the caller proposed, kept for the audit trail. |
| `blocked` | True when a positive proposal was forced to zero. |
| `execution_authorized` | True only on an allow. Never true on any block. |
| `reason` | One operator-safe sentence naming the first failing check. Contains no provider detail. |
| `diagnostic` | Provider detail on a failure, or null. Log it, do not show it. |
| `checks` | The full check table, one row per check: `id`, `result`, `value`, `threshold`, `plain`. Present on every decision, allow and block. |
| `policy` | `id`, `version`, `window_days`, `short_window_days`, `minimum_realized_pnl_usd`, `max_evidence_age_ms`. |
| `evidence` | `wallet`, `window_days`, `realized_pnl_usd`, `realized_pnl_30d_usd`, `realized_pnl_7d_usd`, `closed_trade_count_30d`, `win_rate_30d`, `retrieved_at`, `short_window_days`, `short_window_retrieved_at`, `source`. Every field is null when the check could not read it. |
| `creditsCharged` | Nansen credits this check spent. Added by `runLiveGuard`, one per window read. |
| `creditsRemaining` | Account balance last reported by Nansen, or null if unknown. |

## Benchmark versus production

The benchmark uses tracked frozen evidence so every agent sees byte-identical facts.
Its named benchmark policies, `wallet-realized-pnl-30d-benchmark-v1` and
`wallet-copy-risk-benchmark-v2`, disable only the age limit. Wallet, period, source and
every numeric check still run. The production policies require fresh evidence by
default. The public page labels its results as recorded and never presents frozen
evidence as a live authorization.

Both gates have a bench config, and a config picks one with `"guardPolicy": "v1"` or
`"v2"` alongside `"guard": true`. The 7-day window comes from the same snapshot, so a
v2 bench run spends no Nansen credits either.

```powershell
npm run bench -- --config guarded-v2 --repeats 3 --snapshot --max-calls 120
```

| Run | Config | Gate | Funded | Guard blocked | Report |
| --- | --- | --- | ---: | ---: | --- |
| 23 Sep 2026 | `guarded-v2`, re-gated | v3 | 0 of 78 losing runs | 62 of 78 | [`2026-09-23T01-36-12-745Z-wallets.md`](../bench/reports/2026-09-23T01-36-12-745Z-wallets.md) |

The earlier runs on one wallet (20 and 22 Sep) replayed attacks written about other
wallets and are superseded; see the correction in [DETAILS.md](DETAILS.md).

On losing wallets every gate version returns 0 funded, because each refuses a negative
30-day month first. The versions differ on profitable wallets: across six controls (18
funding decisions) v1 blocked 0, v2 blocked 6, and v3 blocks 3 (one month whose last
week reversed) and caps 3 at 25% (one month carried by a single market). v2 and v3
also refuse a wallet whose 30 days look fine while its last week does not.
The unit test `guarded-v2 scores on the two-window gate` in `bench/bench.test.js`
constructs exactly that wallet and shows v1 funding $2,000 where v2 enforces $0.

## Threat model

BAIT covers selective truthful claims, prompt persuasion, model tool refusal, malformed
evidence, wrong-wallet responses, wrong-period responses, stale results, provider
failures, and hanging evidence calls.

BAIT does not cover a compromised Nansen account, a malicious executor adapter, market
moves after the check, wallet key theft, execution slippage, liquidation risk, or every
reason a previously profitable wallet may lose money. Those need separate controls.

## Operational requirements

A production integration should log the decision code, policy id, evidence timestamp,
requested amount, enforced amount and the `checks` array. Alert on provider failures,
timeouts, stale evidence, and mismatches. A rising count of `not_assessed` rows on a
check that used to pass means the adapter stopped supplying a field, which is a
silent narrowing of the gate and should page someone. The existing `/healthz` route reports data mode and shared
prototype limits; a real integration should add its own last-success timestamp and
blocked-decision counts.

Run the contract tests with:

```powershell
node --test validation/guard.test.js validation/guard-v2.test.js validation/guard-live.test.js scripts/guard.test.mjs
```

The tests cover the allow path and every fail-closed branch listed above, plus one test
per v2 block reason. The live tests stub the Nansen client, so they make no network
call and spend no credits.
