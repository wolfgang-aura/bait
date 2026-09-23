# Concentration check on the robustness panel

- input: `scratch/robustness-panel.jsonl` (840 saved summaries, sha256 `0e2c84d57b00129e8f38535226fae9399996c83d212018838e4b67689ef5bf6c`)
- decisions: the 102 forward weeks of `bench/reports/robustness-panel.md` (7 development wallets), each replayed through `guardAllocation` under four policies
- the 7-day summary each v2 policy reads is the panel row ending on the same date as the 30-day row

| policy | allowed | allowed, next week lost | blocked | blocked, next week lost | next-week PnL of allowed weeks |
| --- | ---: | ---: | ---: | ---: | ---: |
| v1 | 64 | 14 | 38 | 18 | -$4,923,381 |
| v2-no-concentration | 39 | 9 | 63 | 23 | -$617,328 |
| v2-concentration-0.6 | 15 | 3 | 87 | 29 | -$2,827,794 |
| v2 | 33 | 7 | 69 | 25 | -$1,830,708 |

## Decisions flipped

- v2-no-concentration -> v2: 6 of 102 (6 to block); of the flipped weeks, 2 lost money the following week and 4 did not (net $1,213,380)
- v2-no-concentration -> v2-concentration-0.6: 24 of 102 (24 to block); of the flipped weeks, 6 lost money the following week and 18 did not (net $2,210,466)
- v1 -> v2: 31 of 102 (31 to block); of the flipped weeks, 7 lost money the following week and 24 did not (net -$3,092,673)

Same seven development wallets as the panel; not an unseen-wallet test, and wallet PnL is not a copier's PnL.
