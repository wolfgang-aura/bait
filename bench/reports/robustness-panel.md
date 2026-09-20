# Historical robustness panel

Generated from 840 saved Nansen PnL summaries across 7 wallets.
Each observation uses a distinct historical endpoint. This tests whether a wallet classification depends on one convenient date.

## What changed across windows

The 7-day and 30-day verdicts disagreed on 103 of 420 matched wallet-date pairs (25%). Across each wallet and window over time, the profit/loss sign flipped on 126 of 826 adjacent endpoints (15%); 14 of 14 series flipped at least once.

A truthful short window can therefore imply the opposite classification from the full 30-day record. BAIT tests whether an agent notices that omission before allocating.

## Wallet detail

| Wallet | Window | Observations | Non-negative | Median realised PnL | Range |
| --- | ---: | ---: | ---: | ---: | ---: |
| 0x3b883b… | 7d | 61 | 35/61 (57%) | $42,002 | -$3,227,092 to $1,087,720 |
| 0x3b883b… | 30d | 61 | 42/61 (69%) | $304,538 | -$4,988,968 to $1,388,881 |
| 0x3dd2a4… | 7d | 61 | 58/61 (95%) | $0 | -$18,527 to $0 |
| 0x3dd2a4… | 30d | 61 | 52/61 (85%) | $0 | -$18,527 to $0 |
| 0x6daec5… | 7d | 60 | 39/60 (65%) | $497 | -$2,498,070 to $638,199 |
| 0x6daec5… | 30d | 60 | 26/60 (43%) | -$42,780 | -$2,608,042 to $1,090,704 |
| 0xa844e8… | 7d | 59 | 46/59 (78%) | $0 | -$16,757 to $19,413 |
| 0xa844e8… | 30d | 59 | 33/59 (56%) | $67 | -$19,705 to $24,353 |
| 0xc26cbb… | 7d | 61 | 54/61 (89%) | $0 | -$4,970,580 to $533,803 |
| 0xc26cbb… | 30d | 61 | 38/61 (62%) | $24,110 | -$4,984,726 to $1,271,057 |
| 0xd894ca… | 7d | 59 | 45/59 (76%) | $0 | -$18,793 to $9,778 |
| 0xd894ca… | 30d | 59 | 37/59 (63%) | $0 | -$26,814 to $12,249 |
| 0xfe47c8… | 7d | 59 | 34/59 (58%) | $0 | -$23,187 to $33,760 |
| 0xfe47c8… | 30d | 59 | 26/59 (44%) | -$298 | -$18,221 to $63,137 |

This panel measures the seven development wallets already used by BAIT. It is not an unseen test set or evidence of future returns.
