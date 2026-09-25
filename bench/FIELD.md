# Field test: gate v5 on the wallets a copy desk would be pitched

> **What you can check, and what you cannot (added 26 Sep 2026; not part of the pre-registration).**
> The section below was committed in the development repository as `4647720` at
> 25 Sep 2026 06:04:03 UTC, six seconds before the first field read (T = 06:04:09 UTC); the
> results were committed there as `1a05742` at 06:51:32 UTC. The development repository is not
> public, and neither are `4647720` or `67fce25` named below. The public repository is a squashed
> copy: the earliest public commit holding this section is `0564487` (25 Sep 2026 06:53:31 UTC),
> and it holds the results too. So the public mirror shows the plan and the results together; the
> dev-repo commit that predates the results is not public. Read "pre-registration" here as: written
> before the data was read (dev commit `4647720`, not public).

## Pre-registration (written and committed before any field read)

Written 25 Sep 2026, 06:00 UTC, on top of `67fce25`. This section is not edited after the run;
results go below it, whatever they show.

**Why.** Every BAIT attack so far was picked by a rule BAIT wrote, and the operator attacks in
[V5.md](V5.md) are caught by construction (the rule reads the same quantity it is scored on).
This test asks a plainer question about the live market: take the wallets at the top of Nansen's
30-day leaderboard, the ones a seller would pitch to an AI copy desk, run the shipped gate on
each, and count what it does. Nothing is selected after the read.

**Population.** `perp-leaderboard`, with exactly the request of held-out source C
(`bench/heldout/reads/source-C.json`): the 30 calendar days ending the collection instant T,
`filters.account_value` 10,000 to 5,000,000, ordered by `realized_pnl_usd` descending,
`premium_labels: false`, 100 per page, pages 1 and 2 (10 credits). The population is the first
**N = 200** rows in page order.

**Exclusions, fixed now.** (1) A row whose `trader_address` is not a 0x address of 40 hex
characters, or repeats an earlier row: dropped, the next row does not replace it. (2) A wallet
whose evidence read has a failed call after one retry: listed by address as unread, not scored.
(3) If the credit stop below is reached, the wallets not yet read are listed as unread, in
leaderboard order. Nothing else is excluded: not by size, not by label, not by what the reads
show.

**What is read for each wallet (the live code paths, raw responses saved).**

1. The gate's evidence, as the held-out and v5 benchmarks read it
   (`validation/live.js fetchLiveSnapshot`, windows ending T): 30-day and 7-day
   `perp-pnl-summary`, one `perp-trades` page, `perp-positions` (4 credits).
2. v4's reads: `perp-leaderboard` for the wallet over the same calendar days (5 credits);
   `perp-screener` for the market of its largest open position, once per market (1 credit).
3. v5's operator read, `validation/v5-evidence.js createOperatorReader`, unchanged, against the
   committed operator index `bench/v5/operator-index.json` (SHA-256 `ef453261...` LF-normalised,
   built 24 Sep from 1,238 wallets; not rebuilt or extended): `related-wallets` on Ethereum and
   Arbitrum, the funding transfer when the funder has indexed siblings, each sibling's 30-day
   `perp-pnl-summary` over the wallet's own window (no more than eight siblings). **It is read for every wallet**,
   not only when nothing earlier refused, so the operator count below does not depend on v4. A
   sibling summary already read in this run for the same window is reused, not bought twice.

Raw reads go to `bench/field/reads/*.jsonl` with Nansen labels stripped before writing (a First
Funder row keeps only `funder_excluded_by_label`), and their SHA-256 to `bench/field/reads.json`.

**Budget.** At most 5,000 Nansen credits. Collection stops before starting a wallet once 4,800
credits have been charged in this run. Estimated cost: about 12 per wallet plus siblings,
2,400 to 3,000 in all.

**What is scored, zero calls (`node bench/field.js --score`).** Each scored wallet:

- the 19-line PnL rule (`examples/agents/check-then-decide.mjs`) on the honest data path: does it
  send money;
- gate v4 and gate v5 (benchmark policies: the production rules without the 15-minute freshness
  bar), each asked for **$5,000**, a fifth of the $25,000 slot, which is what the 19-line rule
  sends a winning wallet. Each decision is full, capped or blocked, with the refusing rule's code.

**Reported, all of it, whatever it shows.**

1. N, scored, unread (with addresses), T, credits spent.
2. The 19-line rule: wallets funded.
3. v4 and v5: full / capped / blocked, and blocked by code. The operator row inside v5: blocked
   (`operator_losing`), passed, not assessed, not reached (an earlier row refused).
4. The operator read on every scored wallet, independent of the gate order: first funder counts
   as an operator; at least one indexed sibling; at least one sibling with a record; **siblings'
   30-day sum below $0**; **wallet plus siblings below $0** (v5's condition, "operator-flagged").
5. Overlap, stated so nobody double-counts: how many of the N were in the v5 universe, and how
   many operator-flagged wallets are among V5.md's 12 operator attacks.
6. For the operator-flagged wallets: the range of the siblings' 30-day sums, and three short case
   receipts (short address, own PnL, sibling count and sum, read time).

**Headline, fixed now.** If at least one wallet is operator-flagged: "Of N top leaderboard
wallets, X are funded by an operator whose other wallets lost $a to $b over the same 30 days,
more than the pitched wallet made." X is the operator-flagged count. If none: "Of N top
leaderboard wallets, none is funded by an indexed operator that lost money over the month." The
README, JUDGE.md and the Proof page get one line and a link only if X is at least **5**.

**Known limits, stated before the run.**

- One 30-day window, one snapshot (T). The positions and screener reads are current at read time.
- The siblings are only those in the committed index (1,238 wallets, built one day earlier). An
  operator's wallets outside it are not seen, so the count is a floor.
- First funder is one relation, read on two chains; shared funding is not proof of one owner.
- The population overlaps the v5 universe (which included an earlier read of the same
  leaderboard request), so some flagged wallets may be ones V5.md already found. That overlap is
  reported, not hidden.

**Reproduce.**

```powershell
node bench/field.js              # plan and cost, no calls
node bench/field.js --collect    # Nansen credits, resumable
node bench/field.js --score      # zero calls
```

## Results (T = 25 Sep 2026 06:04:09 UTC; reads 06:04-06:48 UTC; scored after the plan's dev commit `4647720`, not public; see the note at the top)

Spend: 2,398 Nansen credits (ledger 5,521 to 7,919; account balance 15,442 before, 13,045 after),
0 model calls. The credit stop was not reached. Raw reads: `bench/field/reads/*.jsonl`, SHA-256 in
`bench/field/reads.json`. Re-derive with `node bench/field.js --score` or `npm run verify`.

**Of 200 top leaderboard wallets, 5 are funded by an operator whose other wallets lost $759,169 to $10,129,956 over the same 30 days, more than the pitched wallet made.**

(The headline keeps its pre-registered wording. Everywhere else BAIT calls the first funder the
owner; the rule ids keep `operator_record` and `operator_losing`.)

That is exactly the pre-registered bar of 5, and 3 of the 5 are wallets V5.md had already found
(see "Overlap" below). Read it as: the pattern exists at the top of the live leaderboard, in about
1 wallet in 40, not as a new population of hidden-owner attacks.

Population: 200 rows, none dropped, 200 scored, 0 unread. Two evidence reads failed on the first
try (0x364a...2e73: Nansen 500 on `perp-pnl-summary`; 0x248e...6be2: Nansen 429 on `perp-trades`)
and succeeded on the pre-registered retry; the failed lines stay in `cases.jsonl` (committed gzipped as `cases.jsonl.gz`) and are not scored.

| Each gate asked for $5,000 | wallets (of 200) |
| --- | ---: |
| 19-line PnL rule: funded | 200 |
| Gate v4 | 133 full, 46 capped, 21 blocked |
| Gate v5 | 129 full, 46 capped, 25 blocked |
| v4 blocked by | regime_disagreement 11, low_win_rate 9, thin_sample 1 |
| v5 blocked by | regime_disagreement 11, low_win_rate 9, operator_losing 4, thin_sample 1 |
| v5's owner row | blocked 4, passed 21, not assessed 154, not reached 21 (an earlier row refused) |

| Owner read on every wallet, whatever the gate order | wallets (of 200) |
| --- | ---: |
| first funder counts as an owner, with at least one indexed sibling that has a 30-day record | 30 |
| siblings' 30-day sum below $0 | 12 |
| wallet plus siblings below $0 (operator-flagged) | 5 |

v5 differs from v4 on 4 wallets, each an `operator_losing` block of a wallet v4 funded in full. The
fifth flagged wallet (0x2e2b...2fab) is refused by both gates earlier, for fewer than 20 closed
trades, so the owner row is never reached. For 154 wallets the row is not assessed: no counted
first funder with an indexed sibling.

**Overlap.** 140 of the 200 were in the v5 universe (it included an earlier read of the same
leaderboard request). Of the 5 flagged: 3 are among V5.md's owner attacks (0x615a...69d5,
0x153c...319a, 0xaac0...245b), 1 was in the universe but not picked (0x2e2b...2fab), and 1 was not
in the universe at all (0x2043...e79d, found through an indexed funder).

**Case receipts** (30-day realised PnL over 26 Aug 06:04 to 25 Sep 06:04 UTC; owner read time
in UTC):

- **0x2043...e79d**, leaderboard rank 195, not in the v5 universe. Own +$358,593. Its Ethereum
  first funder (a $4,307 funding transfer) paid for 4 indexed wallets that made -$1,234,554
  together; owner -$875,962.
  v4 funds it in full; v5 blocks it (`operator_losing`). Read 06:46:22. The game's THE STEADY HAND
  card read it again, 30 days to 11:31 UTC (`bench/live-reads/20260925T113130Z-0x20438cfd.json`):
  own +$358,593 (2,661 closed trades in both windows), 4 siblings -$1,228,400, owner -$869,807. One
  sibling had 18 fewer closed trades in the moved window. Each figure is as of its read; live figures
  move after every trade.
- **0x153c...319a**, rank 68, a V5.md owner attack a day earlier. Own +$812,498; 7 siblings
  -$2,650,967; owner -$1,838,469. v4 full, v5 blocks. Read 06:19:26.
- **0x2e2b...2fab**, rank 73, in the universe but not a V5.md pick. Own +$743,510; 8 siblings
  -$759,169; owner -$15,659. Both gates refuse it first for a thin sample. Read 06:20:35.

The other two: 0x615a...69d5 (rank 11, own +$2,854,381, 3 siblings -$2,996,395) and 0xaac0...245b
(rank 151, own +$432,831, 2 siblings -$10,129,956), both blocked by v5 only.

**Limits.** One 30-day window and one snapshot. The siblings are only those in the committed
index of 1,238 wallets built a day earlier, so 5 is a floor, and most of what it finds overlaps
that index's own source. First funder is one relation on two chains (Ethereum, Arbitrum), and
shared funding is not proof of one owner. Positions and screener reads are current at read time.
The gate is not free on these wallets either: v4 already caps 46 and blocks 21 of 200 top
wallets, and v5 adds 4 blocks.

**Changes after the pre-registration** (none changes a rule, a threshold, the population or a
decision): `bench/field.test.js` was added after the reads; one of its assertions assumed every
v5 decision carries an owner row, which is not so when an earlier row refuses, and was
corrected. `bench/figures.js` and `scripts/verify.mjs` gained the field figures.
