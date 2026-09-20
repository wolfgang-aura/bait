# Five-judge audit

This audit asks what five skeptical Meridian judges can reject. It is not a prediction
of their votes. Each answer links to code or tracked evidence.

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

## Remaining external steps

The repository, page, video, post copy, and preflight can be completed locally. The
founder must publish the X post and submit its URL in Nansen's form. Hosted interactive
play remains optional unless the founder supplies a hosting account and secrets.
