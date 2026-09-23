# BAIT, the check that runs before an AI agent moves money

**Judging BAIT? Start here.**

1. [Play one round](https://bait-wyqr.onrender.com/) (about 60 s): talk an AI into backing
   a losing trader, then watch BAIT's Nansen read stop the money.
2. [See the proof](https://wolfgang-aura.github.io/bait/): the per-wallet result below,
   also as JSON with raw-file hashes at [/api/proof](https://bait-wyqr.onrender.com/api/proof).
3. [Run the bench on your own agent](#test-your-own-agent): one command, zero Nansen credits.

AI agents are starting to move real money, and true facts can talk them into bad bets.
BAIT sits between an agent's decision and the transfer, reads the trader's record from
Nansen and blocks the money when it is losing. For teams whose agents allocate capital.

## The finding

Six losing wallets and a profitable control, each pitched three times with true facts from
its own Nansen record. Model tested: DeepSeek (`deepseek-chat`), frozen snapshots.

| Six losing wallets | AI alone | AI with Nansen tools | Behind BAIT's gate |
| --- | ---: | ---: | ---: |
| Runs where the AI backed the loser | **9 of 18** | **5 of 18** | **0 of 18** |
| Runs where the gate overruled the AI | | | 9 of 18 |
| Profitable control: decisions to fund it that the gate blocked | | | **0 of 3** |

The gate's 0 of 18 restates its rule; the 9 overrules and the 0 false blocks are the parts
that are not circular. One control wallet is not a rate.
[Per-wallet table](bench/reports/2026-09-22T22-43-22-858Z-wallets.md).

## Test your own agent

```powershell
npm run bench -- --agent examples/agents/deepseek-own-prompt.mjs --a unarmed --repeats 1 --snapshot
```

Your agent: a JS module exporting `decide({ pitch, history, tools, slotUsd })` that returns
`{ allocateUsd, reason }`, or an HTTP endpoint. It faces the ten recorded attacks with frozen
Nansen evidence through `tools`, scored by the same referee. Details below.

## Details

### The single-wallet ladder

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
[frozen-evidence suite](bench/reports/2026-09-20T18-10-24-277Z.md).

What the ladder does not show: that the gate picks profitable wallets. On 102 later
seven-day periods across the same seven development wallets, 14 of the 64 records it
allowed lost money next and 20 of the 38 it blocked turned profitable
([robustness panel](bench/reports/robustness-panel.md)). One model, one losing wallet,
no unseen test set. The gate is an execution policy with a measured limit, not a
wallet picker.

### The Pitch Room

The first screen says what BAIT is, then shows four Hyperliquid traders as they present
themselves on the public leaderboard; every one has a Nansen record. Pick one, and your
job is to talk MERIDIAN, an AI that invests a $25,000 fund, into backing that trader,
using only true facts. Every claim is checked against the record. MERIDIAN runs the
benchmark's no-data setup (`bench/configs/unarmed.json`: no tools, your pitch only), as
most agents do today; Nansen is read by BAIT's gate.

**The facts come out in order.** You start with one or two flattering facts; each line
you send unlocks the next. Every unflattering fact, and the number you must not mention,
stays sealed: the page shows a locked card and the server does not send the value.

**The round ends the moment the AI agrees to send money.** That transfer goes to BAIT's
gate. The reveal comes next: BAIT's stamp (BLOCKED, CAUTION or CLEARED), "The AI sent $X and never
looked. BAIT's Nansen read blocked it", what you pitched against what you left out, and the gate's
own reason, then the full check table, each check naming the Nansen read it stands on. The
desk reply is the real model reply; the stamp is the gate's decision. Posted cons share the
board with recorded ones, each traceable to a raw file (`prototype/fixtures/recorded-cons.json`).

### The bench

`npm run bench` replays the ten recorded attacks (all written against one wallet, THE
GRINDER, down $4,745,429 in 30 days) on frozen Nansen evidence and prints how often an
agent backs the loser. Two ways to plug in:

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
before quoting a rate. Report: [bench/reports/2026-09-22T22-43-46-684Z.md](bench/reports/2026-09-22T22-43-46-684Z.md).

The per-wallet table comes from `node bench/wallets.js --execute --repeats 3` (a dry run
without `--execute` prints the plan and the worst-case call count).

**The gate** is `validation/guard.js`. It sits outside the model. The default policy,
`wallet-copy-risk-v2`, reads the 7-day and the 30-day Nansen `profiler/perp-pnl-summary`
and runs named checks, each with a number and a bar: wallet, window, source and freshness
for both windows; 30-day realised loss; regime disagreement, a week that moves against
the month by 10% or more of it (the two windows disagree on 25% of 840 saved wallet-dates);
fewer than 20 closed trades; win rate under 40%; a headline over 80% unsold where the
summary carries it. Every decision returns the whole table, pass, fail or not assessed,
and forces the allocation to $0 on anything invalid, stale, mismatched, missing or timed
out. The model is checked, not asked to check. The recorded 0/30 row ran the original
one-window rule, `wallet-realized-pnl-30d-v1`, still reachable by id; v2 on the same
frozen suite is [also 0/30](bench/reports/2026-09-22T10-00-23-863Z.md). One credit per
live check, two when the 30-day evidence passes and the week is bought:

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
[judge audit](docs/JUDGE_AUDIT.md) takes each objection in turn.

## Judge path

1. Open the [Pitch Room](https://bait-wyqr.onrender.com/) and pick THE LEGEND
   (+$118,975,612 all time on the public leaderboard). You see the flattering facts only,
   one more per line, and a sealed card for the number you must not mention.
2. Talk MERIDIAN into backing him in up to three lines. It has no data tools, like most
   agents today. The round ends when it agrees to send money; that transfer goes to BAIT.
3. Read the reveal: "The AI sent $X and never looked", BAIT's stamp and reason, then the
   live Nansen record you left out. "See every check BAIT ran" shows the gate's check
   table, each row naming its Nansen read.
4. Run your own agent against the recorded attacks with the command at the top.
5. With your own Nansen key, run the gate live with the command above. One or two
   credits, under a minute.

## Why Nansen is structural

- Every truth figure on a Hyperliquid tile comes from `profiler/perp-pnl-summary` and
  `profiler/perp-trades`, and each screen names the endpoint and capture date.
- MERIDIAN has no Nansen tools in the room (the no-data condition); the "AI with Nansen
  tools" column of the finding is the same desk given `profiler/perp-pnl-summary` and
  `profiler/perp-trades`.
- The gate makes its own Nansen call. Live mode refuses a wallet whose record no
  longer supports the story rather than reshaping the game around it.
- Picking one of the four Hyperliquid traders buys one live read: the 30-day and 7-day
  `profiler/perp-pnl-summary`, 2 credits, cached per wallet for 30 minutes and reused by
  the gate for the whole round. The header then reads LIVE NANSEN · fetched
  HH:MM UTC and the gate's freshness row shows the evidence age. Hard caps:
  `HOSTED_NANSEN_CREDITS_PER_DAY` (20) and `HOSTED_NANSEN_CREDITS_TOTAL` (300). No key,
  a cap, a timeout or an error plays the frozen capture and says why. A live record that is no longer losing is played as
  it is: the gate clears or cautions the wire instead of blocking it.
- An 840-observation [robustness panel](bench/reports/robustness-panel.md) across
  seven wallets shows why one dated window is an argument, not proof: 7-day and 30-day
  verdicts disagree on 25% of matched dates.

## Run it yourself

Hosted mode is what the public link runs: live Nansen reads for the four traders when
the host has a key (capped as above, frozen capture otherwise), 12 rounds per visitor per
day, 300 model calls per day. `/healthz` reports live credits used today and in total,
the caps and the last live success. Steps for your own free Render
instance are in [docs/HOSTING.md](docs/HOSTING.md).

Locally, copy `.env.example` to `.env` with `DEEPSEEK_API_KEY` and, optionally,
`NANSEN_API_KEY`, then:

```powershell
npm install
npm test
npm start
```

Open <http://127.0.0.1:3000>. Without a Nansen key, or with `NANSEN_LIVE=0`, the
header reads FROZEN CAPTURE and nothing is spent. Setup detail, costs and methodology
are in [prototype/README.md](prototype/README.md); the integration contract, failure
table and threat model in [the guard guide](docs/WALLET_ALLOCATION_GUARD.md).

## What BAIT is not

BAIT does not select wallets, predict returns or execute trades. Passing the gate means
one minimum eligibility rule was met on fresh evidence; it is not an endorsement. Out of
time, the fixed rule blocked a specific failure but did not predict profitable copying:
14 of 64 allowed periods lost money and 20 of 38 blocked periods turned profitable
([receipt](bench/reports/robustness-panel-forward.json)). Seven development wallets and
ten attacks are not a guarantee against unseen attacks.

## Evidence and checks

```powershell
npm test
npm run results:export
```

- [Per-wallet table, six losing wallets and a control](bench/reports/2026-09-22T22-43-22-858Z-wallets.md), the finding above
- [Frozen-evidence attack suite with the guard](bench/reports/2026-09-20T18-10-24-277Z.md), the single-wallet ladder
- [Fixed-evidence policy comparison](bench/reports/2026-09-19T06-18-01-805Z-paired.md), six losing wallets and one profitable control: permissive funded 2/6, strict 0/6, both funded the control
- [Original live-evidence sweep](bench/reports/2026-09-18T13-58-10-058Z.md), superseded for the headline table
- [Historical robustness panel](bench/reports/robustness-panel.md)
- [Recorded wallet navigator](docs/WALLET_NAVIGATOR.md), ten dated wallet examples
- [Design decisions](prototype/DESIGN.md) · [Judge audit](docs/JUDGE_AUDIT.md) · [Submission status](SUBMISSION.md)

`npm run demo:package` prepares the standalone recorded page under the ignored
`scratch/` directory. Data: Nansen.
