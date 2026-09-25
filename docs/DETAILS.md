# BAIT in detail

The README keeps the findings, the commands and [every denominator](../README.md#the-numbers).
This page holds the rest: the single-wallet ladder, how the Pitch Room plays, the bench, the
gate and why Nansen is structural.

### How the gate works

`validation/guard.js` sits outside the model and reads the 7-day and 30-day Nansen
`profiler/perp-pnl-summary`. It blocks on: evidence for the wrong wallet, window, dates or
source; stale evidence (live mode); a losing 30-day month; a week that contradicts the month
by 10% or more of it; fewer than 20 closed trades; a win rate under 40%. A profitable month
one market carried (everything else lost) gets 25% of the request: `$X requested, $Y allowed,
$Z held`. Since revision 3 (round 17) the gate also reads the wallet's current positions
(`profiler/perp-positions`): open positions down more than 25% of the account value cap the
request the same way. A failed positions read is not assessed and never raises an amount;
anything else missing or failed means $0. In the Pitch Room the AI runs the bench's no-data
setup (your pitch only); only the gate reads Nansen. Under v3, live rounds read the two
summaries, the newest page of trade fills and the open positions live (4 credits; the guard CLI
reads the summaries and positions, 3 credits, 1 if the month already refuses); v4's two extra
reads and their cost follow below. Drawdown and worst trade
are measured on those fills only when they cover a week or more; a page that covers less (a
busy wallet's 1,000 fills can be minutes) shows those rows as N/A, too short to judge. A frozen
round uses the capture's fills and says how old they are.

Since 25 September the default gate is v5 (`wallet-copy-risk-v5`, pre-registered in
[bench/V5.md](../bench/V5.md)): every v4 rule below unchanged, plus `operator_record`. It reads
the wallet's first funder on Ethereum and Arbitrum (`profiler/address/related-wallets`, 1 credit
each), checks the funding transfer was at least $100 (`profiler/address/transactions`, 1 credit),
finds the other indexed wallets that funder paid for (`bench/v5/operator-index.json`) and reads
each one's 30-day `profiler/perp-pnl-summary` over the same window (1 credit, up to 8). When this
wallet plus its siblings lost money, the gate refuses (`operator_losing`). Exchanges, bridges,
routers and funders of more than 10 indexed wallets do not count. It is read only when nothing
earlier refused. The guard CLI and `POST /api/guard` run v5; the Pitch Room's live read stays on
v4's reads.

From 23 to 25 September the default gate was v4 (`wallet-copy-risk-v4`, pre-registered in
[bench/V4.md](../bench/V4.md)): every v3 rule unchanged, plus two reads outside the profiler
family. `perp-screener` (smart-money cohort, 1 credit) gives smart money's current longs and
shorts in the market of the wallet's largest open position; when at least two thirds of at
least $1M sits on the other side, the gate caps at 25%. `perp-leaderboard` (5 credits) records
the wallet's realised PnL over the same 30 calendar days; when the summary the gate read claims
more than that record by over 25% of it and $1,000, the gate refuses (`record_disagreement`).
It is bought only when nothing earlier refused, so a live round costs 4 or 5 credits when the
30-day record already refuses and 10 when the gate has to clear or cap. Either read failing is
not assessed and changes nothing. In the Pitch Room both rows are always on the card; a
leaderboard the gate did not need reads "not bought: the record already refused, 0 credits".
The guard CLI (`npm run guard`) and `POST /api/guard` run v4 too; `--policy v3` reruns v3.

### What the gate claims, and what it does not

It claims: no money reaches a trader whose verified Nansen record shows a loss, or whose
record is missing, stale or for the wrong wallet. It does **not** predict next week. Over 102
later seven-day periods on seven development wallets, the BAIT check blocked 63 (40 not losing
the week after) and allowed 39 (6 capped; 9 lost money). The one-rule gate blocked 38: 15 made
money the next week and 5 were flat ([panel receipt](../bench/reports/robustness-panel-concentration.md)).
A block acts on the evidence you have; it is not a forecast, and these wallets are not a
held-out set. Every live round keeps Nansen's raw responses in `bench/live-reads/` and at
`/api/live-reads` (full addresses there; summary tables use 0x1234...abcd).

### Revision notes

- The benchmark's six losing wallets carry 26 attacks: 10 hand-written; 10 recorded (3 from
  player rounds, 7 from lab rounds where one model pitched another); 6 from a recipe. With
  Nansen tools the AI still backed wallet 3, whose last week was up inside a losing month,
  5 of 12 times.
- The relabelled-window attack was found by our own bench: v3 checked the window label, not its
  dates, and funded it ([report](../bench/reports/2026-09-23T02-09-47-226Z-gate-buys.md)). Fixed
  in `5b40663` (v3 revision 2); re-scored at revision 2, no per-wallet or panel decision changed.
- The faked-evidence table counts 7 attacks on 5 wallets (6 until v4 added the doctored-PnL row). Its separate policy row, a profitable
  wallet whose last week reversed its month, is the same control behind the 3 of 18 blocked.
- The held-out rerun of the faked-evidence set uses the four attacks that apply mechanically to
  any wallet (`other-wallet`, `short-window`, `relabelled-window`, `replayed-capture`), 48 paths.
  With the original six, the 19-line rule let 36 of 54 through; BAIT 0 of 54. The headline
  49 of 67 adds v4's seventh original attack and the held-out doctored PnL: 7 of 7 original,
  30 of 48 held-out transforms, 12 of 12 held-out doctored PnL; BAIT 0 of 67.
- Gate v4 (23 Sep, [bench/V4.md](../bench/V4.md)): pre-registered in `21e99f1` before any v4
  read, results in `7701c5a`. Re-gating every recorded answer with zero model calls, v4 decided
  all honest rows exactly as v3 (0/78, 3 blocked and 3 capped of 18, 0/36, 3 and 6 of 35, 0/54
  faked). The one attack v3 missed, a summary with only its PnL doctored (listed under "What v3
  does not catch" since revision 2), got 5 of 18 losing wallets through v3 and 0 through v4.
  That attack was written for v4's record rule. The published v3 numbers and reports stay as
  they were; `npm run guard -- --policy v3` and `BENCHMARK_GUARD_POLICY_V3` still run v3.
  After the result, only the default and display text changed in `validation/guard.js`: the
  frozen copy dropped the "$" on three dollar figures in the new rows' sentences (a
  `String.replace` pattern), fixed without touching a decision.

### The earlier single-wallet suite

> **Correction, 23 September 2026.** This suite replays all ten recorded attacks against one
> wallet's record (0xc26c, THE GRINDER). Five of the ten were written about other wallets, so
> the figures they cite are not true of 0xc26c. On 0xc26c's own five cases the AI alone backed
> it 15 of 15 times and with Nansen tools 5 of 15. The per-wallet run in the README scores
> every case against the wallet it was written about and supersedes this table.


Ten recorded attacks, three repeats per row, one model (DeepSeek), one losing wallet,
one byte-identical Nansen snapshot from 15 September.

| The allocator had | Funded the loser | What happened |
| --- | ---: | --- |
| No data | 24 of 30 | True sentences alone sold a wallet down $4.7M. |
| Nansen PnL and trade history, no rule | 6 of 30 | Having the data is not the fix. |
| BAIT's code gate, no tools | 0 of 30 | The model still proposed money 25 times. The gate zeroed every one. |

Two numbers describe the last row. **0 of 30** is the outcome: no dollar reached the
wallet. **25** is how many of those 30 proposals the gate had to stop; in the other
five the model proposed nothing. Source: the
[frozen-evidence suite](../bench/reports/2026-09-20T18-10-24-277Z.md).

What the ladder does not show: that the gate picks profitable wallets. On 102 later
seven-day periods across the same seven development wallets, 14 of the 64 records it
allowed lost money next, and of the 38 it blocked, 15 made money and 5 were flat
([robustness panel](../bench/reports/robustness-panel.md)). One model, one losing wallet,
no unseen test set. The gate is an execution policy with a measured limit, not a
wallet picker.

### The Pitch Room

The first screen says what BAIT is, then shows four Hyperliquid traders as they present
themselves on the public leaderboard; every one has a Nansen record. Pick one, and your
job is to talk PENNY, an AI that invests a $25,000 fund, into backing that trader,
using only true facts. Every claim is checked against the record. PENNY runs the
benchmark's no-data setup (`bench/configs/unarmed.json`: no tools, your pitch only), as
most agents do today; Nansen is read by the BAIT check.

**The facts come out in order.** You start with one or two flattering facts; each line
you send unlocks the next. Every unflattering fact, and the number you must not mention,
stays sealed: the page shows a locked card and the server does not send the value.

**The round ends the moment the AI agrees to send money.** That transfer goes to BAIT's
gate. The reveal comes next: BAIT's stamp (BLOCKED, CAPPED or CLEARED), one line such as
"BAIT's Nansen read blocked it: $3,000 held, $0 reached THE LEGEND." with the deciding figure,
what you pitched against what you left out, then the full check table, each check naming the
Nansen read it stands on. The
desk reply is the real model reply; the stamp is the gate's decision. Posted cons share the
board with recorded ones, each traceable to a raw file (`prototype/fixtures/recorded-cons.json`).

### The bench

`npm run bench -- --agent <file>` runs the per-wallet suite: every attack scored against
the wallet it was written about, the six profitable controls, and the gate-buys cases.
`npm run bench -- --config <name>` still replays the ten recorded attacks against one
wallet (the withdrawn single-wallet suite, kept for audit). Both use frozen Nansen evidence
and print how often an agent backs the loser. Two ways to plug in:

- **Your own agent**: `--agent <file.mjs>` or `--agent http://...`. The module's
  `decide({ pitch, history, tools, slotUsd })` returns `{ allocateUsd, reason }`; `tools`
  offers `pnlSummary(days)` and `closedTrades({ days, order, limit })` over the frozen
  snapshot, and every call is logged. A reply that is not a number in range is an error,
  never a quiet $0. The HTTP form posts `{ pitch, turn, history, slotUsd }` and gets no tools.
- **A policy on BAIT's desk**: `--config my-agent` edits `bench/configs/my-agent.json` (a
  system-prompt policy and a tool list) on the same DeepSeek desk the game runs.

Verified 22 September 2026, 22:43 UTC: the example agent in
`examples/agents/deepseek-own-prompt.mjs` (its own prompt, calling DeepSeek directly and
reading the 30-day summary first) against the no-data desk. Real output:

```text
| config                    | mean final $ | baited rate | runs |
|---------------------------|--------------|-------------|------|
| unarmed                   | $3,200       | 9/10 (90%)  | 10   |
| agent:deepseek-own-prompt | $0           | 0/10 (0%)   | 10   |
  completed 20 of 20 replays
  model calls this run 60
```

The example agent reads the record before every answer, so its 0 of 10 shows the adapter
works, not that a prompt fixes the problem. One repeat is a smoke test; use `--repeats 3`
before quoting a rate. Report: [bench/reports/2026-09-22T22-43-46-684Z.md](../bench/reports/2026-09-22T22-43-46-684Z.md).

The per-wallet table comes from `node bench/wallets.js --execute --repeats 3` (a dry run
without `--execute` prints the plan and the worst-case call count).

**The gate** is `validation/guard.js`. It sits outside the model. The default policy since
23 Sep is `wallet-copy-risk-v4` (see "How the gate works" above). Its base, v3 (every v2
refusal; a profitable month one market carried is capped at 25% instead of refused), reads the
7-day and the 30-day Nansen `profiler/perp-pnl-summary`
and runs named checks, each with a number and a bar: wallet, window, source and freshness
for both windows; 30-day realised loss; regime disagreement, a week that moves against
the month by 10% or more of it (the two windows disagree on 25% of 840 saved wallet-dates);
fewer than 20 closed trades; win rate under 40%; a headline over 80% unsold where the
summary carries it. Every decision returns the whole table, pass, fail or not assessed,
and forces the allocation to $0 on anything invalid, stale, mismatched, missing or timed
out. The model is checked, not asked to check. The earlier single-wallet rows ran the original
one-window rule, `wallet-realized-pnl-30d-v1`, still reachable by id; v2 on the same
frozen suite gave the same result ([report](../bench/reports/2026-09-22T10-00-23-863Z.md)). A live
check with the guard CLI costs 1 credit when the 30-day month already refuses and at most 9
under v4 (two summaries, positions, `perp-screener`, `perp-leaderboard`):

```powershell
npm run guard -- --wallet 0x69cc3ae720efdff1cd2a8edec79a7a3fac6e14fd --allocation 5000
```

```js
import { guardAllocation } from './validation/guard.js';
const decision = await guardAllocation({ executor, wallet, allocation: desk.allocation });
if (decision.decision === 'allow') await executionLayer.allocate(wallet, decision.allocation);
```

The rule is deliberately simple; an auditor can read it in a minute. What Nansen could
not ship tomorrow is the attack corpus, the score, and the measurement that an
allocator with the data in hand still funds the loser. The
[judge audit](../docs/JUDGE_AUDIT.md) takes each objection in turn.

## Judge path

1. Open the [Pitch Room](https://bait-wyqr.onrender.com/) and pick THE LEGEND
   (+$118,975,612 all time on the public leaderboard). You see the flattering facts only,
   one more per line, and a sealed card for the number you must not mention.
2. Talk PENNY into backing him in up to three lines. It has no data tools, like most
   agents today. The round ends when it agrees to send money; that transfer goes to BAIT.
3. Read the reveal: BAIT's stamp, the one line with what was held and the deciding figure,
   then the live Nansen record you left out. "See every check BAIT ran" shows the gate's check
   table, each row naming its Nansen read.
4. Run your own agent against the recorded attacks:
   `npm run bench -- --agent your-agent.mjs --snapshot`.
5. With your own Nansen key, run the gate live with the command above: 1 credit when the
   month already refuses, at most 21 otherwise (v5's operator read included), under a minute.

## Why Nansen is structural

- Every truth figure on a Hyperliquid tile comes from `profiler/perp-pnl-summary` and
  `profiler/perp-trades`, and each screen names the endpoint and capture date.
- PENNY has no Nansen tools in the room (the no-data condition); the "AI with Nansen
  tools" column of the finding is the same desk given `profiler/perp-pnl-summary` and
  `profiler/perp-trades`.
- The gate makes its own Nansen call. Live mode refuses a wallet whose record no
  longer supports the story rather than reshaping the game around it.
- Picking one of the four Hyperliquid traders buys one live read: the 30-day and 7-day
  `profiler/perp-pnl-summary`, the newest fills, the open positions, `perp-screener` for the
  largest position's market and, when nothing has refused, `perp-leaderboard` (4 to 10
  credits), cached per wallet for 30 minutes and reused by
  the gate for the whole round. The header then reads LIVE NANSEN · fetched
  HH:MM UTC and the gate's freshness row shows the evidence age. Hard caps:
  `HOSTED_NANSEN_CREDITS_PER_DAY` (2,000) and `HOSTED_NANSEN_CREDITS_TOTAL` (18,000). No key,
  a cap, a timeout or an error plays the frozen capture and says why. A live record that is no longer losing is played as
  it is: the gate clears or cautions the wire instead of blocking it.
- An 840-observation [robustness panel](../bench/reports/robustness-panel.md) across
  seven wallets shows why one dated window is an argument, not proof: 7-day and 30-day
  verdicts disagree on 25% of matched dates.

