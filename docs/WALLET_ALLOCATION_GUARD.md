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

## Default policy since 25 Sep 2026: `wallet-copy-risk-v5`

`wallet-copy-risk-v5` (`PRODUCTION_GUARD_POLICY`, pre-registered in
[bench/V5.md](../bench/V5.md)) keeps every v4 rule below and adds `operator_record`, read only
when nothing earlier refused. `profiler/address/related-wallets` names the wallet's first funder on
Ethereum and on Arbitrum (1 credit each). A funder counts as an operator unless its label is an
exchange, bridge, router or service, it first-funded more than 10 indexed wallets, or the funding
transfer (`profiler/address/transactions`, 1 credit) was under $100. The other wallets in
`bench/v5/operator-index.json` with the same first funder are its siblings; each one's 30-day
`profiler/perp-pnl-summary` over the same window is read (1 credit, up to 8). When this wallet plus
its siblings lost money, the gate refuses (`operator_losing`). Anything it cannot read is
`not_assessed` and changes nothing. The executor answers one more tool, `get_operator({ wallet,
days, window })`. `PRODUCTION_GUARD_POLICY_V4` or `--policy v4` runs v4.

## `wallet-copy-risk-v4` (default 23-25 Sep 2026)

`wallet-copy-risk-v4` (pre-registered in
[bench/V4.md](../bench/V4.md)) keeps every v3 rule below and adds two reads, both only when
nothing earlier refused: `perp-screener` (1 credit), which caps at 25% when at least two thirds
of at least $1M of smart money's open positions in the wallet's largest open position's market
sit on the other side, and `perp-leaderboard` (5 credits), which refuses a 30-day summary that
claims more realised PnL than the leaderboard's record of the same days (`record_disagreement`).
Either read failing is `not_assessed` and changes nothing. `PRODUCTION_GUARD_POLICY_V3` or
`--policy v3` runs v3.

## `wallet-copy-risk-v3` (default until 23 Sep 2026)

`wallet-copy-risk-v3` is v2 below with two changes: a profitable month that one market
carried is capped at 25% of the request instead of refused, and (revision 3, 23 Sep 2026)
one more Nansen read, `profiler/perp-positions` (1 credit), runs once the summaries pass:
when the open positions are down more than 25% of the account value, the request is capped
at 25% (`open_book`). A failed positions read is `not_assessed` and changes nothing.
Re-scoring the per-wallet benchmark under revision 3 changed no decision
(`bench/reports/2026-09-23T11-56-45-011Z-wallets.md`, zero model calls); the frozen control
captures predate this read, so `open_book` is not assessed on them. From v2 on, the gate reads **two** windows of Nansen `profiler/perp-pnl-summary` for the
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
| `concentration` | Best market in the 30-day summary's `top5_coins` | Made more than the whole 30-day realised PnL | cap at 25% (`capped`; v2 refused) |
| `open_book` | `profiler/perp-positions` (v3 r3) | Open positions down at most 25% of the account value | cap at 25% (`capped`) |
| `smart_money_side` | `perp-screener`, smart money, the largest open position's market (v4) | Under two thirds of at least $1M on the other side | cap at 25% (`capped`) |
| `independent_record` | `perp-leaderboard`, the same 30 calendar days (v4) | The summary claims no more than this record plus max($1,000, 25% of it) | block `record_disagreement` |
| `operator_record` | `profiler/address/related-wallets` (first funder), `profiler/address/transactions` (funding size), siblings' `profiler/perp-pnl-summary` (v5) | This wallet plus its indexed siblings made at least $0 over the same 30 days | block `operator_losing` |
| `tail_loss` | Worst single closed trade | At most 25% of volume or account | not assessed here, see below |
| `max_drawdown` | Peak-to-trough realised curve | 30% of peak, 15% of account | not assessed here, see below |

A cap never stacks: any number of cap rows send 25% of the request. A failed or empty read on
`open_book`, `smart_money_side` or `independent_record` is `not_assessed` and changes nothing.

The numeric bars come from `COPY_RISK_THRESHOLDS` in `validation/guard.js`, the same
table `assessCopyRisk` uses, so the game's copy-risk report and this gate refuse a
wallet for the same reason at the same number.

### What the gate does not assess, and why

`tail_loss` and `max_drawdown` need the per-trade fills from `profiler/perp-trades`. The
guard does not read fills, so these two always report `not_assessed` with that reason in the
row. They are covered by `assessCopyRisk`, which the game's `/api/assess` and `npm run assess`
serve from a snapshot that does hold the fills, and the Pitch Room shows them from its live
fill page as watch rows that never decide.

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

No policy emits a size of its own. The enforced amount is the caller's proposed amount,
25% of it when a cap row fires (v3 and v4), or $0. There is no calibrated allocation, and
the enforced amount is never above the proposal.

The $0 threshold is deliberately modest. Non-negative trailing PnL is an eligibility
check, not a complete investment policy. An integrator can raise the minimum, or any
other bar in the table, without changing the agent prompt.

## Evidence adapters and current coverage

The production default reads Nansen's Hyperliquid `profiler/perp-pnl-summary` (the record
every rule is judged on), plus `profiler/perp-positions`, `perp-screener` and
`perp-leaderboard` under v4.
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
  // policy is optional. The default is wallet-copy-risk-v5.
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

`guardAllocation` calls `executor.execute('get_pnl_summary', { wallet, days })`, twice
from v2 on, once with `days: 30` and once with `days: 7`. v3 adds
`get_open_positions({ wallet })`; v4 adds `get_smart_money_market({ token_symbol, days })`
and `get_independent_record({ wallet, days, window })`. An adapter that throws or does not
serve one of the later three leaves its row `not_assessed`.

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
frozen. It also serves `get_open_positions` (`profiler/perp-positions`),
`get_smart_money_market` (`perp-screener`) and `get_independent_record`
(`perp-leaderboard`). Any other tool name throws. The credit guard in `validation/nansen.js`
stays in the path.

Cost is one credit per window: one for `wallet-realized-pnl-30d-v1`, two for
`wallet-copy-risk-v2` or `-v3`, and only one when the 30-day evidence already refuses. v3 and
v4 add `profiler/perp-positions` (1) once the summaries pass; v4 adds `perp-screener` (1) and
`perp-leaderboard` (5), so v4 costs 9 at most. v5, the default since 25 Sep, adds
`profiler/address/related-wallets` on two chains (2), one `profiler/address/transactions` read per
counted funder (up to 2) and one 30-day summary per indexed sibling (up to 8): at most 21 credits.
So a v5 check costs 1 credit when the month refuses and 10 to 21 credits once the wallet reaches the
owner read (`liveCheckCredits` in `validation/guard-live.js`, the figure `/api/health` reports).

`runLiveGuard` wraps that adapter, enforces 15-minute freshness, and adds
`creditsCharged` and `creditsRemaining` to the decision. Its own default policy is
pinned to v1, because its contract test asserts the one-credit v1 behaviour; callers pass
`policy`. `POST /api/guard` in `prototype/server.js` and the CLI both pass the v5 default.

Two ways to run it, both needing only `NANSEN_API_KEY` in `.env`:

```powershell
# wallet-copy-risk-v5 (the default): 1 credit if the month refuses, 10 to 21 with the owner read; prints the full check table
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
the page, the policy id and `credits_per_check` (`min`, `owner_read`, `max`) under `live_guard`.

The earlier form page, `/guard.html`, was retired; it now redirects to the Proof page's
"How BAIT works" section. In the Pitch Room, "Or paste any Hyperliquid wallet" runs the same
v4 gate on one live read.

Two real checks on 20 September 2026 (UTC), run under `wallet-realized-pnl-30d-v1`, one
credit each. *Note, 24 Sep 2026: since then every hosted Pitch Room round has run the live
gate (v4 from 23 Sep), and its raw Nansen responses are committed in
[bench/live-reads/](../bench/live-reads/README.md).*

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
| `capped` | allow | `concentration`, `open_book` or `smart_money_side` | Every refusal check passed and at least one cap row fired: 25% of the request is authorized, the rest held. v3 and v4. |
| `pnl_below_minimum` | block | `realised_pnl_30d` | Verified 30-day realised PnL is below the configured threshold. |
| `regime_disagreement` | block | `regime_agreement` | The 7-day and 30-day realised PnL have opposite signs and the 7-day move is at least 10% of the 30-day figure. v2 and later. |
| `thin_sample` | block | `thin_sample` | Fewer than 20 closed trades in 30 days. v2 and later. |
| `low_win_rate` | block | `low_win_rate` | The 30-day win rate is below the policy minimum. v2 and later. |
| `paper_headline` | block | `paper_headline` | More than 80% of the headline is unsold. v2 and later, and only when the adapter supplies unrealised PnL. |
| `record_disagreement` | block | `independent_record` | The 30-day summary claims more realised PnL than `perp-leaderboard` records for the same days, by over 25% of that record and $1,000. v4. |
| `operator_losing` | block | `operator_record` | The wallet's first funder also funded indexed Hyperliquid wallets, and together with this one they lost money over the same 30 days. v5. |
| `window_dates_mismatch` | block | `evidence_30d` | The response is labelled 30 days but its dates do not span them (v3 revision 2). |
| `evidence_unavailable` | block | `evidence_30d` or `evidence_7d` | The evidence adapter returned no usable PnL, or threw. |
| `evidence_timeout` | block | `evidence_30d` or `evidence_7d` | The evidence check exceeded the deadline. |
| `wallet_mismatch` | block | `evidence_30d` | The 30-day response belongs to another wallet. |
| `window_mismatch` | block | `evidence_30d` | The 30-day response does not cover the required period. |
| `source_mismatch` | block | `evidence_30d` | The 30-day response does not identify the required endpoint. |
| `short_window_unavailable` | block | `evidence_7d` | The 7-day response carried no usable realised PnL. v2 and later. |
| `short_window_mismatch` | block | `evidence_7d` | The 7-day response has the wrong wallet, window, source or timestamp. v2 and later. |
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
| `creditsCharged` | Nansen credits this check spent. Added by `runLiveGuard`: 1 per summary window, positions or screener read, 5 for the leaderboard, 1 per related-wallets, transactions or sibling summary read. |
| `creditsRemaining` | Account balance last reported by Nansen, or null if unknown. |

## Benchmark versus production

The benchmark uses tracked frozen evidence so every agent sees byte-identical facts.
Its named benchmark policies, `wallet-realized-pnl-30d-benchmark-v1` through
`wallet-copy-risk-benchmark-v4` (the one the published tables use; its `perp-screener` and
`perp-leaderboard` rows read the saved responses in `bench/v4/reads/`), disable only the age
limit. Wallet, period, source and every numeric check still run. The production policies require fresh evidence by
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
| 23 Sep 2026 | `guarded-v2`, re-gated | v3 r2 | 0 of 78 losing runs | 62 of 78 | [`2026-09-23T02-53-37-602Z-wallets.md`](../bench/reports/2026-09-23T02-53-37-602Z-wallets.md) |

The earlier runs on one wallet (20 and 22 Sep) replayed attacks written about other
wallets and are superseded; see the correction in [DETAILS.md](DETAILS.md).

On losing wallets every gate version returns 0 funded, because each refuses a negative
30-day month first. The versions differ on profitable wallets: across six controls (18
funding decisions) v1 blocked 0, v2 blocked 6, and v3 and v4 block 3 (one month whose last
week reversed) and cap 3 at 25% (one month carried by a single market). v2 and v3
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
node --test validation/guard.test.js validation/guard-v2.test.js validation/guard-v3.test.js validation/guard-v4.test.js validation/guard-live.test.js scripts/guard.test.mjs
```

The tests cover the allow path and every fail-closed branch listed above, one test per
v2 block reason, and the v3 and v4 cap and record rows. The live tests stub the Nansen client, so they make no network
call and spend no credits.
