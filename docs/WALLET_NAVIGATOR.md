# BAIT recorded wallet navigator

This panel answers one question: would BAIT allow a proposed allocation under the
recorded 30-day realised-PnL rule? It is a dated eligibility test, not a recommendation,
ranking, or forecast.

## Recorded panel

| Venue | Address | 30-day realised PnL | Closed trades | Win rate | BAIT |
| --- | --- | ---: | ---: | ---: | --- |
| Hyperliquid | `0x9546b9d4103be41ce13483a8f299d0df0eeb181c` | +$2,450,809 | 213,725 | 43.7% | allow |
| Hyperliquid | `0xbd1c84113c6deb5044be0c2221f9e9403811ff0e` | +$4,372,641 | 534 | 100.0% | allow |
| Hyperliquid | `0x9e2cbb5d800181c1ef21b25010dc4ea80eeb5508` | +$4,752,152 | 37,257 | 68.0% | allow |
| Hyperliquid | `0x69cc3ae720efdff1cd2a8edec79a7a3fac6e14fd` | -$847,025 | 2,075 | 4.3% | block |
| Hyperliquid | `0xe187055ff406f8cdf59fbae53ec20d4ecd9b771d` | -$399,226 | 2,726 | 0.8% | block |

The machine-readable record is `validation/wallet-navigator.json`. It contains the
unrounded figures, retrieval times, source strings, and profile, evidence, and explorer
links used by the public navigator. Third-party entity labels are not republished (removed
23 Sep 2026); the address links to the explorer instead.

## Method

Hyperliquid candidates were discovered through Nansen's leaderboard, then classified
with a separate Nansen `profiler/perp-pnl-summary` request for 21 August through
20 September 2026. Discovery totals were never used as the final label. One apparent
loser was rejected from the panel because the independent realised-PnL summary was
positive.

The public panel originally included five Fomo-linked Robinhood Chain addresses. Those
rows were removed on 22 September 2026 after the available aggregate realised figure
was found to disagree with the same provider's closed-round-trip records. The saved
panel did not retain the raw rows needed to settle the difference. No replacement label
was inferred.

Run the deterministic verification with:

```powershell
node --test validation/wallet-navigator.test.js
```

The test sends every frozen record through `guardAllocation` and derives the expected
decision from the saved Nansen result. It does not enforce a chosen allow/block split.
