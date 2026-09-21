# Judge audit

This audit asks what a skeptical Meridian judge can reject. It is not a prediction
of their votes. Each answer links to code or tracked evidence.

## First objection: "This is just a PnL check; Nansen could build it in an afternoon"

Correct, and the check is deliberately that simple. One `profiler/perp-pnl-summary`
call, one rule: negative 30-day realised PnL forces the allocation to $0. A rule an
auditor cannot read in a minute is a rule nobody will deploy.

The check is not the product. The product is what surrounds it: a corpus of ten
recorded attacks in which every stated fact is true, a benchmark harness that replays
them against any agent configuration with a deterministic referee, and the measurement
that having the data is not the fix. In the frozen-evidence table the `armed-basic`
row had Nansen PnL and trade history in hand, with no rule, and still funded a wallet
whose 30-day realised PnL was -$4,745,429 on 6 of 30 replays. The same model with no
data funded it 24 of 30; behind the code gate, 0 of 30 while it still tried 25 times.

Nansen supplies the evidence and could ship the same one-line check tomorrow. What
would still be missing is the attack corpus, the score, and the demonstration that an
allocator reads true facts and funds the loser anyway.

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
