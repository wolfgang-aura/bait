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

`scratch/BAIT-judge-v25.mp4`: 1920 by 1080 H.264, 30 fps, no audio track, 53.3 s, rendered with
HyperFrames (`scratch/hf/make-gen13.cjs` then `gen13.cjs`, from v24's builder) over two real rounds
played on the hosted site (https://bait-wyqr.onrender.com, public commit 6c8fcb9, gate v4) and
recorded at 3840 by 2160 on 23 Sep 2026, 16:09 and 16:10 UTC. Each round was one take on a fresh
live Nansen read: no retry, so no round played from the 30-minute cache. The barricade is the
hosted page's own component with each round's amount, captured at a tenth of its speed and timed
back to real time, because 4K screenshots cannot catch a 2.2 s animation.
SHA-256: `68a615c6c4e180e592ac9a59f9a44a44d8b1e98a336689bf1a09be90d1220bd2`.

| Screen | Point |
| --- | --- |
| Cold open (0:00) | THE LEGEND: -$30,619,686 over the last 30 days (live Nansen read, 23 Sep 16:09 UTC) first and largest, then +$118,975,612 all time (labelled Hyperliquid public leaderboard), BLOCKED BY BAIT. "Con an AI into backing a losing trader using only true facts. Nansen data is what stops you." |
| Round 1 (0:03) | THE LEGEND. Line 1 (the all-time figure and "Twenty percent of your fund is $5,000"): PENNY calls it a trophy, not a 30-day record, and commits $1,500; caption "PENNY doubts the pitch, then commits $1,500 anyway." The player presses Wire it, the barricade slams shut, and the checkpoint reads Nansen live: six calls listed, five bought at 1 credit each (30d and 7d perp-pnl-summary, perp-trades, perp-positions, perp-screener), perp-leaderboard "not bought: the record already refused, 0 credits", "5 Nansen credits this round". The smart-money CAP (67% of $103.4M against his ETH short) is struck through by the block. Reveal (0:20.3, 4.2 s): caption "Nansen's 30-day record decided it: -$30.6M. BAIT held all $1,500." |
| Round 2 (0:24.5) | A pasted wallet (0x6dae...90de); caption "One live Nansen check, the same round." One live check: 30 days +$47,744, last 7 days -$56,416. PENNY commits $3,000 on line 1 ("PENNY doubts this pitch too, then commits $3,000 anyway.") and the player wires it. The checkpoint blocks on the reversed week, strikes the concentration CAP through, and lists the same six calls: five at 1 credit, the leaderboard not bought, "5 Nansen credits this round". Reveal (0:41.2): "The month was up; the last week reversed it. BAIT blocked all $3,000." |
| The result (0:44.3) | "AI agents can be talked into funding losing traders. BAIT stops them." 63/78 AI alone funded the loser, 19/78 with Nansen tools, 0/78 behind BAIT. "Faked evidence: a simple PnL rule let 49 of 67 through. BAIT: 0." (7 of 7 original, 30 of 48 held-out transforms, 12 of 12 held-out doctored PnL, gate v4.) "Held out: 12 unseen losing wallets, 0 of 36 through." "Cost: 6 of 53 good-trader decisions blocked, 9 capped." (3 of 18 and 3 capped original, 3 of 35 and 6 capped held-out.) Footnote: 6 losing wallets · 26 attacks · 3 tries each · true facts only · +12 unseen wallets. |
| Order and end | Cold open 0:00, round 1 0:03.0, round 2 0:24.5, benchmark card 0:44.3, "Test your own agent" card 0:50.5 to the end (0:53.3): the bench command, bait-wyqr.onrender.com, the repository, Built on the Nansen API, and "BAIT: the check between the agent and the money." |

Both rounds' figures come from fresh live Nansen reads on the hosted build; the raw responses (two
perp-pnl-summary calls, one page of perp-trades, perp-positions and perp-screener each, 5 credits a
read; the leaderboard was not bought because the record already refused) are committed:
- Round 1: `bench/live-reads/20260923T160919Z-0x7fdafde5.json`, SHA-256
  `896ee9c7661b7998aec712ca303aca609b8ffd46dd004385971c0563db551727`: 30-day realised PnL
  -30,619,686, 7-day -9,470,305, win rate 39.2%, 574,977 closed trades.
- Round 2: `bench/live-reads/20260923T161051Z-0x6daec5ff.json`, SHA-256
  `cda080d63d8dd4ee00a5c8aad766a36e6fce3f2be280cc16d533d206da30442f`: 30-day +47,744.49,
  7-day -56,416.09, 1,877 closed trades.
A third hosted round (THE REAL DEAL, 16:08 UTC, not in the video) checked that a wallet the gate
has to cap buys all six reads: 10 credits, perp-leaderboard +$70,580 against the summary's
+$70,917, `bench/live-reads/20260923T160814Z-0xfe47c8f2.json` (SHA-256 `c73f891b...ec172`).
The host listed the same hashes at /api/live-reads; its disk is wiped when the free service
restarts, so the committed copies are the durable ones. Review frames: `scratch/round21/v25/`.
v24 (SHA-256 `a55f9709b3720e574b37249ef99878b61f4f78d59e408ed68eb938e2147df289`, gate v3, four
Nansen calls, one round from the cache) is superseded.

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
trader's Nansen record live: the 7-day and 30-day `profiler/perp-pnl-summary`, with named
checks for a losing month, a week that reverses the month, too few trades, a low win rate, and
stale or mismatched evidence; `profiler/perp-positions` for the open book; `perp-screener` for
which side smart money holds in the trader's largest position; and `perp-leaderboard` as a
second record of the same month, which refuses a summary that claims more than it. A
profitable month carried by one market, an open book deep underwater, or smart money two to
one on the other side is capped at 25% of the request rather than refused.

Across six losing wallets and 26 attacks written from each wallet's own true facts, the
AI alone backed a loser in 63 of 78 runs and with Nansen tools in 19 of 78. Behind the
gate, 0 of 78, while the AI still tried in 62. On six profitable wallets the gate blocked
3 of 18 funding decisions and capped 3. When the evidence itself is faked (another wallet's
record, the wrong window, relabelled dates, a stale capture, a doctored number), a 19-line PnL
rule sends money in 49 of 67 attacked paths and BAIT in 0; on honest evidence that rule also
scores 0, and it is published as the baseline to beat. Gate v4, pre-registered before its run
(`bench/V4.md`), decides every honest benchmark row as v3 did and closes the one gap v3 had: a
summary with only its PnL doctored got 5 of 18 losing wallets through v3 and 0 through v4. `npm run bench -- --agent your-agent.mjs` runs any agent
against the same attacks with zero Nansen credits.

Held-out set, pre-registered before any wallet was picked, gate and prompt frozen by hash
(`bench/HELDOUT.md`): 24 wallets the project had never queried, picked by Nansen's
`perp-leaderboard`, `tgm/perp-pnl-leaderboard` and `smart-money/perp-trades`. Original 6
wallets: 0/78 behind BAIT. Unseen 12 losing wallets: 0/36 behind BAIT, against 18/36 for the
AI alone and 3/36 with Nansen tools (the recipe attack only). Unseen 12 good traders: 3 of 35
funding decisions blocked, 6 capped. The 0/36 is partly by construction (a wallet counts as
losing by its 30-day Nansen record, which the gate's first rule refuses); the meaningful
held-out result is faked evidence on unseen wallets: PnL rule 42/60 through, BAIT 0/60.

BAIT does not select wallets, predict returns or execute trades.

## Preflight

The video file is not in this repository, so the preflight (`npm run submission:check`, which
checks its format, length and SHA-256) runs only in the private development workspace.

## Entry form audit

The live Typeform has three required fields: the email associated with the Nansen API key
(stored only in the ignored private submission record), the X post URL with `@nansen_ai`
tagged, and the GitHub repository URL `https://github.com/wolfgang-aura/bait`.
