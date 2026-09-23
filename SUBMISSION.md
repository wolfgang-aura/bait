# Submission preparation

Not submitted. Updated 23 September 2026.

## Entry requirements

The [official entry guide](https://release.nansen.ai/help/articles/3540155-nansen-meridian-buildathon-sep-14-27)
requires 1,000 or more Nansen calls during 14–27 September, a public GitHub repository,
a 30–60 second recording posted on X with the repository link and `@nansen_ai`, and the
entry form. The deadline is 27 September at 23:59 UTC (28 September 07:59 Singapore).

Current evidence:

- Nansen Usage Analytics: 1,033 Total Usage over 30 days, seen in the signed-in dashboard
  at 11:12 UTC on 20 September, which meets the 1,000-call requirement. The local ledger
  holds 1,101 charged credits since 14 September.
- Public repository: <https://github.com/wolfgang-aura/bait>
- Playable build: <https://bait-wyqr.onrender.com/>, serving public main.
- Recorded proof page: <https://wolfgang-aura.github.io/bait/>

## The recording

`scratch/BAIT-judge-v16.mp4`: 1920 by 1080 H.264, 30 fps, no audio track, 59.7 s, rendered with
HyperFrames over two real rounds played on the hosted site (https://bait-wyqr.onrender.com) and
recorded at 3840 by 2160 on 23 Sep 2026.
SHA-256: `f96a130f401882187d374c25d738a016000fa7feb257c5c526f3ef3e056dc5b3`.

| Screen | Point |
| --- | --- |
| Cold open | THE LEGEND: +$118,975,612 all time (public leaderboard) against -$30,104,635 over 30 days (live Nansen read, 23 Sep 06:46 UTC), BLOCKED BY BAIT. "Con an AI into backing a losing trader using only true facts. Nansen data is what stops you." |
| Round 1 | THE LEGEND. PENNY, the target, has no data tools; on line 1 it asks for the 30-day P&L, then agrees anyway and puts $3,000 of its $25,000 behind him. The BAIT check intercepts, reads Nansen live (both summaries and the newest 1,000 perp fills), ticks in every row with its value and stamps BLOCKED BY BAIT. |
| Round 2 | A pasted wallet not on the roster (0x6dae...90de). One live read; its 30 days are up (+$47,744) but its last 7 days lost $53,748. PENNY agrees to $2,000; the BAIT check blocks it on the reversed week. |
| The result | Six losing wallets, 26 attacks: AI alone 63/78, with Nansen tools 19/78, behind the BAIT check 0/78; on profitable traders 3 of 18 decisions blocked, 3 capped; data-path attacks 6 of 6 through a 30-day rule, 0 of 6 behind the check. |
| End card | The bench command, the play link and the repository. |

Both rounds' figures come from live Nansen reads whose raw responses (two perp-pnl-summary
calls and one page of perp-trades each, 3 credits) are committed:
- Round 1: `bench/live-reads/20260923T064613Z-0x7fdafde5.json`, SHA-256
  `72ae684cc66411c161dbf60392b6557b86991dac076ca352f7305e4243462bb6`: 30-day realised PnL
  -30,104,635.34, win rate 39.74%, 575,837 closed trades.
- Round 2: `bench/live-reads/20260923T064550Z-0x6daec5ff.json`, SHA-256
  `73ff01e19a114dd9c03fe44c44120f7f7d9a7e188689a597d1a603b824f51013`: 30-day +47,744.49,
  7-day -53,748.08, 1,877 closed trades.
The same hashes are listed by the host at /api/live-reads. Earlier cuts: v14 and v15 used the
06:01:59 and 06:19:08 reads (also committed); v13 and earlier used reads whose raw responses
were not kept.

## Draft X post

Can true facts sell a losing trader to an AI?

BAIT gates wallet-allocation agents. 6 losing wallets, 26 true-fact attacks: the AI alone backed a loser 63/78, with Nansen tools 19/78, behind the BAIT check 0/78.

Play it: https://bait-wyqr.onrender.com
https://github.com/wolfgang-aura/bait @nansen_ai

The draft fits the free limit once X counts each link as 23 characters, and includes the
required tag and repository.

## Draft description

BAIT is the check that runs before an AI agent moves money, for teams whose agents
allocate capital to traders. In the Pitch Room you talk PENNY, an AI with no data tools
and a $25,000 fund, into backing a trader using only true facts; the facts unlock one at a
time and the loss stays sealed. The moment it agrees to send money, the BAIT check reads the
trader's Nansen record: the 7-day and 30-day `profiler/perp-pnl-summary`, with named checks
for a losing month, a week that reverses the month, too few trades, a low win rate, and
stale or mismatched evidence. A profitable month carried by one market is capped at 25%
of the request rather than refused.

Across six losing wallets and 26 attacks written from each wallet's own true facts, the
AI alone backed a loser in 63 of 78 runs and with Nansen tools in 19 of 78. Behind the
gate, 0 of 78, while the AI still tried in 62. On six profitable wallets the gate blocked
3 of 18 funding decisions and capped 3. A 19-line rule with no model also scores 0 and is
published as the baseline to beat; `npm run bench -- --agent your-agent.mjs` runs any agent
against the same attacks with zero Nansen credits.

BAIT does not select wallets, predict returns or execute trades.

## Before publication

Run `npm run submission:check` in the private workspace, verify Total Usage in Nansen,
then publish the post and submit the form.

## Entry form audit

The live Typeform has three required fields: the email associated with the Nansen API key
(stored only in the ignored private submission record), the X post URL with `@nansen_ai`
tagged, and the GitHub repository URL `https://github.com/wolfgang-aura/bait`.
