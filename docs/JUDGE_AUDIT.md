# Judge audit

This audit asks what a skeptical Meridian judge can reject. It is not a prediction
of their votes. Each answer links to code or tracked evidence.

## First objection: "This is just a 30-day PnL checker"

It was, until 22 September. The default gate became `wallet-copy-risk-v3` (v2's refusals, with a one-market month capped
rather than refused), and since 23 September it is `wallet-copy-risk-v4`: every v3 row below
plus `perp-screener` (smart money against the largest open position caps at 25%) and
`perp-leaderboard` (a summary that claims more than the leaderboard's record refuses). The gate
publishes its whole reasoning on every decision, allow or block:

| Check | Reads | Bar |
| --- | --- | --- |
| `evidence_30d` | 30-day summary: wallet, window, source | Matches the request and the approved endpoint |
| `evidence_freshness` | Age of that evidence | At most 15 minutes, not future-dated |
| `evidence_7d` | 7-day summary: wallet, window, source, age | Same bars |
| `realised_pnl_30d` | 30-day realised PnL | At or above $0 |
| `regime_agreement` | Sign of the 7-day vs the 30-day | Same sign, or the week is under 10% of the month |
| `thin_sample` | 30-day closed trades | At least 20 |
| `low_win_rate` | 30-day win rate | At least 40% |
| `paper_headline` | Unrealised share of the headline | At most 80% (`not_assessed` on the Nansen adapter, which carries no unrealised figure) |
| `concentration` | Best market in the 30-day summary's top five | Carrying more than the whole month caps at 25% (v3) |
| `open_book` | `profiler/perp-positions` | Open positions down more than 25% of the account value cap at 25% (v3 r3) |
| `smart_money_side` | `perp-screener`, smart money in the largest open position's market | Two thirds of at least $1M on the other side caps at 25% (v4) |
| `independent_record` | `perp-leaderboard`, the same 30 days | A summary claiming more realised PnL than this record by over 25% of it and $1,000 blocks (v4) |
| `tail_loss`, `max_drawdown` | Per-trade fills | Reported `not_assessed` by the gate; the Pitch Room shows them from `profiler/perp-trades` as watch rows that never decide |

Every row carries the number it read, the bar it wanted and one plain sentence. A
block names the first row that failed. A row the evidence could not answer says so
rather than passing quietly. The bars are the same `COPY_RISK_THRESHOLDS` the game's
copy-risk report uses, so the report and the gate cannot drift.

`regime_agreement` is the one that answers this objection directly, and it exists
because of a measurement rather than an intuition. Across 840 saved Nansen summaries,
the 7-day and 30-day verdicts disagreed on 103 of 420 matched wallet-date pairs, 25%
([the robustness panel](../bench/reports/robustness-panel.md)). A gate that reads one
window is reading a window the other contradicts about a quarter of the time, so v2
reads both and refuses when they point opposite ways. A week that gives back less than
10% of the month is small against it, so the two windows are read as agreeing: the control wallet made +$35,083 in
30 days and gave back $1,208 in the last 7, and a gate that blocks on that is a gate
nobody keeps switched on.

Two honest limits. On the recorded ten-case corpus both gates score 0 funded of 30,
because the benchmark wallet lost $4.7M over 30 days and fails the first check either
way; v2 is not catching a wallet v1 missed there. And two of the gate's rows,
`tail_loss` and `max_drawdown`, need the trade fills the gate does not fetch, so they report
`not_assessed` and are covered by the separate copy-risk report instead.

The earlier rule, `wallet-realized-pnl-30d-v1`, is still shipped by id, because the
recorded `guarded` benchmark row depends on exactly that rule and a number whose rule
moved underneath it is not reproducible.

The gate is also not the whole product. Around it sit a corpus of ten recorded attacks
in which every stated fact is true, a benchmark harness that replays them against any
agent configuration with a deterministic referee, and the measurement that having the
data is not the fix. Across six losing wallets and 26 true-fact attacks, the desk with Nansen PnL and trade
history in hand, and no rule, still backed a loser in 19 of 78 runs. The same model with
no data did in 63 of 78; behind the code gate, 0 of 78, while it still tried in 62
(bench/reports/2026-09-23T02-53-37-602Z-wallets.md).

Nansen supplies the evidence and could ship any of these checks. What would still be
missing is the attack corpus, the score, and the demonstration that an allocator reads
true facts and funds the loser anyway.

## Judge 1: "This is a game, not a product"

BAIT protects a defined integration point: an AI proposes a dollar allocation to a
perpetual-trading wallet, then BAIT independently returns `allow` or `block` before
execution. The buyer, input, output, default policy, failure codes, exclusions, and
operator duties are documented in [the integration contract](WALLET_ALLOCATION_GUARD.md).

The game is the attack recorder. The benchmark measures agents against those attacks.
The guard is the product an operator integrates.

## Judge 2: "The model can ignore the rule"

The production guard sits outside the model. The guarded benchmark gives the model no
tools and no policy text. Across the six losing wallets the model tried to fund a loser in
62 of 78 final decisions and the gate forced every one to zero
([per-wallet report](../bench/reports/2026-09-23T15-44-55-161Z-wallets.md)). See
`validation/guard.js`.

## Judge 3: "Your evidence check can pass the wrong or stale data"

The guard validates the requested wallet, 30-day period, Nansen endpoint, timestamp,
and finite realised PnL. Production evidence expires after 15 minutes. Invalid input,
provider errors, timeouts, missing values, stale timestamps, future timestamps, and
wallet, period, or source mismatches all block. Contract tests cover each branch.

The benchmark's frozen-evidence policy disables only the age limit and identifies
itself separately. The page labels its proof as recorded.

## Judge 4: "Zero allocations prove only that you reject everything"

The guard passes a fresh matching result at or above the configured threshold and never
raises the model's amount; a cap row can only lower it to 25%. Across all 53 good-trader
funding decisions, 38 went through in full, 9 were capped and 6 were blocked
([the numbers](../README.md#the-numbers)). Tests cover positive and exactly-zero PnL. The earlier
paired prompt-policy experiment also funded its profitable control, although that is a
small development sample and is not presented as guard validation.

Passing BAIT is only a minimum eligibility result. It is not a wallet recommendation.

The out-of-time check makes that limit measurable. On 102 later seven-day periods from
the same seven development wallets, 14 of 64 records allowed by the 30-day sign lost
money next, while of 38 blocked records 15 made money and 5 were flat. BAIT therefore presents
the guard as a narrow execution policy and never as a profitable-wallet classifier.

## Judge 5: "The submission overclaims or cannot be reproduced"

The public copy says exactly what the product covers and excludes. It does not claim to
execute trades, pick wallets, predict profit, or protect every trading action. The
repository contains the attack rows, frozen evidence, source hashes, deterministic
referee, reproduction command, production contract, and failure tests. The 59.5-second
video (`SUBMISSION.md`) shows two real rounds played on the hosted site on fresh live Nansen
reads, then the benchmark card, without narration. Every headline figure is checked against
`bench/FIGURES.json` by `npm test`, and every denominator is explained once in the
[README](../README.md#the-numbers).

## Wallet-panel objection: "You picked winners and losers from whichever metric suited you"

The navigator uses one rule for every address: independently observed 30-day realised
PnL at or above zero allows; negative blocks. Discovery metrics do not decide the label.
One Hyperliquid candidate found through a negative total-PnL result was excluded because
its independently fetched realised PnL was positive. The five Fomo rows were removed on
22 September because the available aggregate disagreed with the same provider's
closed-round-trip records ([WALLET_NAVIGATOR.md](WALLET_NAVIGATOR.md)).

`validation/wallet-navigator.test.js` reruns the guard over the five frozen Hyperliquid
records and derives each expected decision from the saved Nansen result; it does not
enforce a chosen allow/block split. The evidence table records addresses, timestamps,
sources, trade counts, and links.

## Remaining external steps

The founder publishes the X post and submits its URL in Nansen's form. The hosted
build (<https://bait-wyqr.onrender.com/>) plays live rounds on real Nansen reads.
