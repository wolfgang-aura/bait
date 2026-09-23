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

`scratch/BAIT-judge-v21.mp4`: 1920 by 1080 H.264, 30 fps, no audio track, 57.9 s, rendered with
HyperFrames over two real rounds played on the hosted site (https://bait-wyqr.onrender.com) and
recorded at 3840 by 2160 on 23 Sep 2026.
SHA-256: `8de7fb6e01f153ad32a85a4c5ac967b117181d57c530cdc61310ef2646ecb246`.

| Screen | Point |
| --- | --- |
| Cold open | THE LEGEND: +$118,975,612 all time (public leaderboard) against -$30,354,002 over 30 days (live Nansen read, 23 Sep 11:28 UTC), BLOCKED BY BAIT. "Con an AI into backing a losing trader using only true facts. Nansen data is what stops you." |
| Round 1 | THE LEGEND. PENNY, the target, has no data tools; before the gate every trader looks the same (one neutral theme, one sealed card: "What BAIT will check: 7-day and 30-day realised PnL"). Line 1 (the all-time leaderboard figure): PENNY notes there is no 30-day proof and commits $2,500. The player pitches again (FARTCOIN's +$343,369 over 30 days) and PENNY raises it to $5,000; the player presses Wire it. The beat, the barricade, then the BAIT check reads Nansen live and stamps BLOCKED BY BAIT; the two fill rows read N/A because the newest 1,000 fills cover only 24 minutes. The reveal: "Your score: $5,000 wired in 2 lines". |
| Round 2 | A pasted wallet not on the roster (0x6dae...90de). One live read: 30 days +$47,744, last 7 days -$53,748. PENNY asks for P&L but commits $5,000 on line 1; the player wires it. The checkpoint blocks on the reversed week and strikes through the concentration CAP ("Superseded by the block: nothing is sent."). Caption: the month was profitable, the last week reversed it, and blocking it is the check's conservative side. |
| The result | "Pitched with true facts, the AI backed a losing trader 63 of 78 times. With Nansen tools, 19. Behind BAIT, 0." "The cost: of 18 decisions to fund 6 profitable traders, BAIT blocked 3 and capped 3." "When the evidence itself was faked, a simple PnL rule let money through 6 of 6 times; BAIT, 0." |
| End | The bench command and repository card, then round 1's own final reveal frame (BLOCKED BY BAIT) held with the caption "An AI agent would have funded this wallet. BAIT, the check between the agent and the money, stopped it." and bait-wyqr.onrender.com. |

Both rounds' figures come from live Nansen reads whose raw responses (two perp-pnl-summary
calls and one page of perp-trades each, 3 credits; the file names both endpoints) are committed:
- Round 1: `bench/live-reads/20260923T112825Z-0x7fdafde5.json`, SHA-256
  `f1c9c8169310decf0174a31acf85ec4f74acd89127cf6c0af78927ed893b4a8b`: 30-day realised PnL
  -30,354,001.53, win rate 39.59%, 574,980 closed trades.
- Round 2: `bench/live-reads/20260923T112935Z-0x6daec5ff.json`, SHA-256
  `e895afa7d79209ee87830703065e190ab4902aab4d1b4fa0631e8e03e23adc22`: 30-day +47,744.49,
  7-day -53,748.08, 1,877 closed trades.
The host listed the same hashes at /api/live-reads when the round was recorded (its disk is
wiped when the free service restarts, so the committed copies are the durable ones). Earlier
cuts (v14 to v17) used reads that are also committed there; v13 and earlier used reads whose
raw responses were not kept.

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
