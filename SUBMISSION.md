# Submission preparation

Updated 23 September 2026.

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

`scratch/BAIT-judge-v24.mp4`: 1920 by 1080 H.264, 30 fps, no audio track, 59.0 s, rendered with
HyperFrames over two real rounds played on the hosted site (https://bait-wyqr.onrender.com, commit
e4b9ae6) and recorded at 3840 by 2160 on 23 Sep 2026. v24 is a re-cut of v23 from the same
footage; nothing was re-recorded. The barricade is the hosted page's own component with each
round's amount, captured at a tenth of its speed and timed back to real time, because 4K
screenshots cannot catch a 2.2 s animation.
SHA-256: `a55f9709b3720e574b37249ef99878b61f4f78d59e408ed68eb938e2147df289`.

| Screen | Point |
| --- | --- |
| Cold open | THE LEGEND: -$30,943,878 over the last 30 days (live Nansen read, 23 Sep 13:29 UTC) first and largest, then +$118,975,612 all time (labelled Hyperliquid public leaderboard), BLOCKED BY BAIT. "Con an AI into backing a losing trader using only true facts. Nansen data is what stops you." |
| Round 1 | THE LEGEND, before the gate the same neutral card as every trader. Line 1 (the all-time figure): PENNY asks for the 30-day window and commits $2,500. Line 2 (FARTCOIN's +$328,412 over 30 days): PENNY raises it to $6,250, and the player presses Wire it. The barricade slams shut ("$6,250 HELD"), the checkpoint reads Nansen live, the camera shows the BLOCK rows, the Nansen calls and the whole BLOCKED BY BAIT stamp. Reveal (0:24.6): the camera frames PENNY's two lines, the page's one "agreed to send $6,250" sentence and Nansen's figures; caption "Nansen's 30-day record decided it: -$30.9M. BAIT held all $6,250." |
| Round 2 | Straight after round 1 (0:30.1): a pasted wallet (0x6dae...90de). One live read: 30 days +$47,744, last 7 days -$56,416. PENNY commits $3,000 on line 1 and the player presses Wire it. The checkpoint blocks on the reversed week and strikes the concentration CAP through as superseded. Reveal (0:46.0), framed like round 1: caption "The month was up; the last week reversed it. BAIT blocked all $3,000." |
| The result (0:50.0) | "AI agents can be talked into funding losing traders. BAIT stops them." 63/78 AI alone funded the loser, 19/78 with Nansen tools, 0/78 behind BAIT (the largest, in amber). "Faked evidence: a simple PnL rule let 36 of 54 through. BAIT: 0." (6 of 6 original plus 30 of 48 held out: same rule, same attack code, same count.) "Held out: 12 unseen losing wallets, 0 of 36 through." "Cost: 3 of 18 good-trader decisions blocked, 3 capped." Footnote: 6 losing wallets · 26 attacks · 3 tries each · true facts only · +12 unseen wallets. |
| Order and end | Cold open 0:00, round 1 0:03, round 2 0:30.1, benchmark card 0:50.0, "Test your own agent" card 0:56.2 to the end (0:59.0): the bench command, bait-wyqr.onrender.com, the repository, Built on the Nansen API, and "BAIT: the check between the agent and the money." |

On the reveal pages the tilted stamp touches the "BAIT's Nansen read" chip; that is in the
footage, so v24 shows the stamp whole on the checkpoint and frames both reveals to the right of
it. Built by `scratch/hf/make-gen12.cjs` (from v23's `make-gen11.cjs`) with COLD=3.0
LADDER=6.2 CLI_CARD=2.8; the held-out figures on the card are read from `bench/HELDOUT.md`.
v23 (SHA-256 `2ea33b7f5c0ff2d60a556bc49c56d7b2c9a6b31a28307e4f5744d806809735bb`) is superseded.

Both rounds' figures come from live Nansen reads whose raw responses (two perp-pnl-summary
calls, one page of perp-trades and one perp-positions call each, 4 credits a fresh read; the
files list all three endpoints) are committed. What the checkpoints in the video show: round 2's
read was fresh, so its calls read "1 credit" each and "4 Nansen credits this round". Round 1's
checkpoint reads "0 credits (cached read, 13:29 UTC)": the first recording take made that read
(4 credits) and did not reach the wire, and the take in the video used the same read from the
30-minute cache, so that round itself spent nothing:
- Round 1: `bench/live-reads/20260923T132930Z-0x7fdafde5.json`, SHA-256
  `35af9d1212eb81edd1a5e0a9da7c7032e44e186088124c76d40171492793398c`: 30-day realised PnL
  -30,943,878.04, win rate 39.24%, 572,917 closed trades.
- Round 2: `bench/live-reads/20260923T133145Z-0x6daec5ff.json`, SHA-256
  `ca00c6d2373382a850fd4903934f5e95b786a21e5bd2ef721b2bf1e41ad22797`: 30-day +47,744.49,
  7-day -56,416.09, 1,877 closed trades.
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
3 of 18 funding decisions and capped 3. When the evidence itself is faked (another wallet's
record, the wrong window, relabelled dates, a stale capture), a 19-line PnL rule sends money in
36 of 54 attacked paths and BAIT in 0; on honest evidence that rule also scores 0, and it is
published as the baseline to beat. `npm run bench -- --agent your-agent.mjs` runs any agent
against the same attacks with zero Nansen credits.

Held-out set, pre-registered before any wallet was picked, gate and prompt frozen by hash
(`bench/HELDOUT.md`): 24 wallets the project had never queried, picked by Nansen's
`perp-leaderboard`, `tgm/perp-pnl-leaderboard` and `smart-money/perp-trades`. Original 6
wallets: 0/78 behind BAIT. Unseen 12 losing wallets: 0/36 behind BAIT, against 18/36 for the
AI alone and 3/36 with Nansen tools (the recipe attack only). Unseen 12 good traders: 3 of 35
funding decisions blocked, 6 capped. The 0/36 is partly by construction (a wallet counts as
losing by its 30-day Nansen record, which the gate's first rule refuses); the meaningful
held-out result is faked evidence on unseen wallets: PnL rule 30/48 through, BAIT 0/48.

BAIT does not select wallets, predict returns or execute trades.

## Preflight

The video file is not in this repository, so the preflight (`npm run submission:check`, which
checks its format, length and SHA-256) runs only in the private development workspace.

## Entry form audit

The live Typeform has three required fields: the email associated with the Nansen API key
(stored only in the ignored private submission record), the X post URL with `@nansen_ai`
tagged, and the GitHub repository URL `https://github.com/wolfgang-aura/bait`.
