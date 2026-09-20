# BAIT ten-wallet navigator

This panel answers one question: would BAIT allow a proposed allocation under the
recorded 30-day realised-PnL rule? It is a dated eligibility test, not a recommendation,
ranking, or forecast.

## Recorded panel

| Venue | Address | Identity | 30-day realised PnL | Closed trades | Win rate | BAIT |
| --- | --- | --- | ---: | ---: | ---: | --- |
| Fomo-linked Robinhood Chain | `0x1605b59dfe3c1742c815d604aab6a2faa3a5c91f` | `econoar` | +$30,698 | 69 | 31.9% | allow |
| Fomo-linked Robinhood Chain | `0xddd462bb053b57d5d73c9615e11a7284cfee9233` | `iruletrenches` | +$14,605 | 79 | 41.8% | allow |
| Fomo-linked Robinhood Chain | `0xd4cf04bc9d7c80b49c6c30a633f7b9bd5370b4d6` | `himgajria` | +$8,988 | 5 | 40.0% | allow |
| Fomo-linked Robinhood Chain | `0x3ecbecb8e47702249842c29cc5aed564ad1fa84b` | `andy` | -$252,876 | 166 | 33.7% | block |
| Fomo-linked Robinhood Chain | `0x180906a0ef400e4747eac35d4e02ffa18979e328` | `RuneCrypto_` | -$198,965 | 11 | 36.4% | block |
| Hyperliquid | `0x9546b9d4103be41ce13483a8f299d0df0eeb181c` | HL Perps Whale | +$2,450,809 | 213,725 | 43.7% | allow |
| Hyperliquid | `0xbd1c84113c6deb5044be0c2221f9e9403811ff0e` | HL Perps Whale | +$4,372,641 | 534 | 100.0% | allow |
| Hyperliquid | `0x9e2cbb5d800181c1ef21b25010dc4ea80eeb5508` | Uses TRADEXYZ1 referral code | +$4,752,152 | 37,257 | 68.0% | allow |
| Hyperliquid | `0x69cc3ae720efdff1cd2a8edec79a7a3fac6e14fd` | HL Perps Whale | -$847,025 | 2,075 | 4.3% | block |
| Hyperliquid | `0xe187055ff406f8cdf59fbae53ec20d4ecd9b771d` | HL Perps Whale | -$399,226 | 2,726 | 0.8% | block |

The machine-readable record is `validation/wallet-navigator.json`. It contains the
unrounded figures, retrieval times, source strings, and profile, evidence, and explorer
links used by the public navigator.

## Method

Hyperliquid candidates were discovered through Nansen's leaderboard, then classified
with a separate Nansen `profiler/perp-pnl-summary` request for 21 August through
20 September 2026. Discovery totals were never used as the final label. One apparent
loser was rejected from the panel because the independent realised-PnL summary was
positive.

Fomo's public API requires authentication, so this panel does not claim first-party or
complete Fomo coverage. It uses public Fomo Radar records linking Fomo profiles to
Robinhood Chain execution addresses and their observed closed fills. The five selected
records were retrieved on 20 September 2026. Fomo profile headline PnL is retained as
a separate field because it can include open positions and disagree with realised PnL.

Run the deterministic verification with:

```powershell
node --test validation/wallet-navigator.test.js
```

The test sends every frozen record through `guardAllocation`, checks the expected
decision, and enforces the three-allow/two-block split for each venue.
