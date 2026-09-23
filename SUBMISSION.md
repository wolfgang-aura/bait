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
- Playable build: <https://bait-wyqr.onrender.com/> (the dev branch is ahead of it until
  the next push and Manual Deploy).
- Recorded proof page: <https://wolfgang-aura.github.io/bait/>

## The recording

`scratch/BAIT-judge-v12.mp4`: 1920 by 1080 H.264, 30 fps, no audio track, 45.7 s, rendered with
HyperFrames over a real round played on the hosted site (https://bait-wyqr.onrender.com) and
recorded at 3840 by 2160 on 23 Sep 2026.
SHA-256: `a3a4f6b6c6e40b694786f4dd66ab66393b69915548d3eceb9016d5e503159b11`.

| Screen | Point |
| --- | --- |
| Cold open | THE LEGEND: +$118,975,612 all time against -$30,271,483 over 30 days (live Nansen read, 23 Sep 03:45 UTC), BLOCKED. |
| What BAIT is | The check that runs before an AI agent moves money. |
| The round | A real DeepSeek round with no data tools. On the first line it asks for the last 30 days, then agrees anyway and puts $5,000 of its $25,000 behind him. |
| The reveal | "It asked for the record, then agreed to send $5,000 anyway." BAIT's Nansen read blocks it: $0 sent. |
| The checks | Every check the gate ran, each with the Nansen read it stands on. |
| The result | Six losing wallets, 26 attacks: AI alone 63/78, with Nansen tools 19/78, behind the gate 0/78; on profitable traders 3 of 18 decisions blocked, 3 capped. |
| End card | The bench command, the play link and the repository. |

The round ran on the hosted build with a live Nansen read of THE LEGEND at 03:45 UTC on
23 Sep 2026 (two summaries, 2 credits). The gate's freshness row reads PASS, 0 min old. The
fill tape behind the trade details is still the 21 Sep capture, and the screen says so.

## Draft X post

Can true facts sell a losing trader to an AI?

BAIT gates wallet-allocation agents. 6 losing wallets, 26 true-fact attacks: the AI alone backed a loser 63/78, with Nansen tools 19/78, behind BAIT's gate 0/78.

Play it: https://bait-wyqr.onrender.com
https://github.com/wolfgang-aura/bait @nansen_ai

The draft fits the free limit once X counts each link as 23 characters, and includes the
required tag and repository.

## Draft description

BAIT is the check that runs before an AI agent moves money, for teams whose agents
allocate capital to traders. In the Pitch Room you talk MERIDIAN, an AI with no data tools
and a $25,000 fund, into backing a trader using only true facts; the facts unlock one at a
time and the loss stays sealed. The moment it agrees to send money, BAIT's gate reads the
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
