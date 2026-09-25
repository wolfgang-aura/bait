# Judging BAIT in three minutes

BAIT is a gate between an AI trading desk and its money. A seller pitches the AI a wallet to
copy. Before any transfer, BAIT reads the wallet, and whoever funded it, from Nansen, then
blocks, caps at 25%, or clears the amount.

On the live market: of 200 top leaderboard wallets, 5 are funded by an operator whose other wallets lost $759,169 to $10,129,956 over the same 30 days, more than the pitched wallet made. 3 of the 5 were already in the benchmark. [bench/FIELD.md](bench/FIELD.md)

## 1. Look (1 minute)

- Watch the round at the top of the [README](README.md), or the
  [60-second video](https://x.com/WolfGanG_Aura/status/2102859321969442856).
- Play one round: <https://bait-wyqr.onrender.com/>. Pick a trader or paste a Hyperliquid wallet,
  talk PENNY, the AI with a $25,000 fund, into backing it, press **Wire it**, then **See what happened**.
  The checkpoint lists each Nansen call it made and the rule each one drove.
  The hosted game runs gate v5, so the checkpoint includes the hidden-owner row;
  [/api/health](https://bait-wyqr.onrender.com/api/health) shows its commit.
- The [Proof page](https://wolfgang-aura.github.io/bait/) shows every result with its source.

## 2. Run (1 minute, no keys)

Requires Node 22+.

```powershell
git clone https://github.com/wolfgang-aura/bait; cd bait; npm install
npm run verify
```

`npm run verify` switches off network access, re-derives each headline number from the committed
files, and prints one PASS or FAIL row per number against [bench/FIGURES.json](bench/FIGURES.json).
The last line should read `PASS  34 of 34 checks` with 0 network requests. Any mismatch exits
non-zero. It spends no Nansen credits and makes no model calls.

What it recomputes and what it reads as recorded:

- **Recomputed by running the gate code on saved Nansen reads:** the simple PnL rule, gate v4 and
  gate v5 on the 12 hidden-owner attacks and 26 controls; every faked-evidence path; every gated
  run in the true-fact and held-out benchmarks. The v5 reads are checked against their SHA-256
  hashes as they load.
- **Read from recorded runs:** what each AI model answered. Re-asking a model costs money. The
  runs are the `.jsonl` files in `bench/reports/`, one row per run.
- **Not derivable here, and labelled so in FIGURES.json:** the $5,000 PENNY asked for in the hosted
  round of 23 Sep, because the raw read holds Nansen's answers and not the model's, and the video file.

To re-run a model or re-read Nansen yourself you need keys; the commands are in
[bench/V5.md](bench/V5.md) and the README's [Run it and re-score it](README.md#run-it-and-re-score-it).

## 3. Read the numbers (1 minute)

| Number | What it means |
| --- | --- |
| 61 of 79 | Attacks where the 19-line rule "don't copy a wallet that lost money this month" sent money: 12 hidden-owner attacks plus 67 faked-evidence paths |
| 0 of 79 | The same attacks behind BAIT |
| 12, 11 and 0 of 12 | Hidden-owner attacks funded by the PnL rule, the previous gate v4, and v5 |
| 36 of 36 | Runs where DeepSeek, and separately Claude Sonnet 5, backed a hidden-owner wallet on its own (3 runs per attack). Behind BAIT: 0 of 36 each |
| 49 of 67 | Faked-evidence paths the PnL rule funded. BAIT: 0 of 67 |
| 63, 19 and 0 of 78 | True facts about 6 losing wallets: runs where the AI backed one alone, with Nansen tools, and behind BAIT |
| 18 and 0 of 36 | The same on 12 losing wallets the project had never seen: AI alone, behind BAIT |
| 38 of 53 | The cost: good-trader transfers that went through in full (9 capped, 6 blocked) |

Every denominator is explained once in the README's [The numbers](README.md#the-numbers).

## Where the attacks came from

- **Hidden-owner attacks (12):** real wallets. A selection rule was written in
  [bench/V5.md](bench/V5.md) before any read. A script scanned 1,238 Hyperliquid wallets, found
  each one's first funder with Nansen's `related-wallets`, checked the funding transfer with
  `transactions`, and kept, per owner, the best wallet that made at least $1,000 while its owner
  lost money. No wallet was picked by hand. The public repository ships as release commits, so the
  "written first" order is stated in V5.md, not provable from public git history.
- **Pitches:** a fixed template filled from each wallet's own record (`bench/paired.js`).
- **Faked evidence (67):** built by the author. Each changes one thing in a real Nansen record.
- **By construction:** the hidden-owner check reads the same quantity that defines the attack, so
  BAIT's 0 is expected. What is measured: that such wallets exist in real data, and that the PnL
  rule, gate v4 and both models fund them.
- **No forecast:** a one-month look-back found the pitched winners lost money in the next 30 days
  no more often than the controls (4 of 11 against 9 of 23).

## Where the raw reads are

| Folder | What is in it |
| --- | --- |
| `bench/v5/reads/*.jsonl` | Every Nansen response behind the hidden-owner benchmark (3,604 credits), SHA-256 in `bench/v5/reads.json` |
| `bench/v5/selection.json`, `bench/v5/operator-index.json` | The 12 attacks, 26 controls and the owner index built from the reads |
| `bench/heldout/reads/` | The held-out wallets' selection and profiler reads |
| `bench/v4/reads/` | The leaderboard, positions and screener reads gate v4 added |
| `bench/live-reads/` | Raw responses from rounds played on the hosted game ([index](bench/live-reads/README.md)) |
| `bench/reports/` | One row per model run, plus a Markdown report per run set |

Committed reads carry no Nansen address labels (Nansen's redistribution terms).
