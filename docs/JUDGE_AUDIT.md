# Judge audit

This audit asks what a skeptical Meridian judge can reject. It is not a prediction
of their votes. Each answer links to code or tracked evidence.

## First objection: "This is just a 30-day PnL checker"

It was, until 22 September. The default gate is now `wallet-copy-risk-v2`, and it
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
| `paper_headline` | Unrealised share of the headline | At most 80% |
| `concentration`, `tail_loss`, `max_drawdown` | Per-fill tape | Reported `not_assessed`: the gate reads summaries, not fills |

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
10% of the month is treated as noise, not a regime: the control wallet made +$35,083 in
30 days and gave back $1,208 in the last 7, and a gate that blocks on that is a gate
nobody keeps switched on.

Two honest limits. On the recorded ten-case corpus both gates score 0 funded of 30,
because the benchmark wallet lost $4.7M over 30 days and fails the first check either
way; v2 is not catching a wallet v1 missed there. And three of the eleven checks need
the fill tape the gate does not fetch, so they report `not_assessed` and are covered
by the separate copy-risk report instead.

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
tools and no policy text. The model attempted to fund the losing wallet in 25 of 30
final decisions, with a mean attempted allocation of $4,000. The guard forced every
one to zero. See `validation/guard.js` and the tracked four-row report.

## Judge 3: "Your evidence check can pass the wrong or stale data"

The guard validates the requested wallet, 30-day period, Nansen endpoint, timestamp,
and finite realised PnL. Production evidence expires after 15 minutes. Invalid input,
provider errors, timeouts, missing values, stale timestamps, future timestamps, and
wallet, period, or source mismatches all block. Contract tests cover each branch.

The benchmark's frozen-evidence policy disables only the age limit and identifies
itself separately. The page labels its proof as recorded.

## Judge 4: "Zero allocations prove only that you reject everything"

The guard passes a fresh matching result at or above the configured threshold without
changing the model's amount. Tests cover positive and exactly-zero PnL. The earlier
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
referee, reproduction command, production contract, and failure tests. The 45-second
video shows the attack, score, guard contract, and recorded status without narration.

## Wallet-panel objection: "You picked winners and losers from whichever metric suited you"

The navigator uses one rule for every address: independently observed 30-day realised
PnL at or above zero allows; negative blocks. Discovery metrics do not decide the label.
One Hyperliquid candidate found through a negative total-PnL result was excluded because
its independently fetched realised PnL was positive. Conversely, two Fomo profiles with
positive headline PnL remain blocked because their observed closed-trade realised PnL
is negative. The page exposes both Fomo figures rather than hiding the disagreement.

`validation/wallet-navigator.test.js` reruns the guard over all ten frozen records and
asserts five addresses per venue, with exactly three allows and two blocks in each.
The evidence table records addresses, timestamps, sources, trade counts, and links.

## Remaining external steps

The repository, page, video, post copy, and preflight can be completed locally. The
founder must publish the X post and submit its URL in Nansen's form. Hosted interactive
play remains optional unless the founder supplies a hosting account and secrets.
