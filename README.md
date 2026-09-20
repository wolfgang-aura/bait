# BAIT

**Can true facts sell a losing trader?**

A red-team game for AI allocators, powered by live Nansen evidence.

[Open the recorded demo](https://wolfgang-aura.github.io/bait/) ·
[Inspect the public repository](https://github.com/wolfgang-aura/bait)

Pitch selected Nansen evidence to two AI desks. Both receive the same argument and
the same policy. One can check the full trading record; the other cannot.
All allocations are fictional.

**Recorded result:** the strict Nansen-backed policy funded 0/6 losing wallets and
still funded the profitable control when evidence, tools, model and pitches were held
fixed. In the 90-replay ablation, tools alone reduced funding from 77% to 43%, which
is still too high for deployment.

## Judge path

1. Open the recorded demo and press **Next pitch** three times.
2. Compare the selected facts with the full 30-day record after each reply.
3. Open **See all recorded results** to inspect 90 replays and the seven-wallet policy comparison.

The first minute shows the whole argument. Every reply, allocation, timestamp and
aggregate links back to tracked evidence in this repository.

## Why Nansen is structural

- Live 7-day and 30-day PnL decide whether a wallet can enter the game. The server
  refuses a wallet that is no longer losing instead of changing the story around it.
- Every evidence card comes from Nansen PnL summaries or trade history.
- The armed desk can query PnL, fills and, in the extended configuration, open
  positions before it allocates fictional capital.
- The deterministic referee uses the complete 30-day result. The historical panel
  checks whether the same wallet changes classification across distinct time windows.

Remove Nansen and the encounter, the evidence asymmetry, the armed desk and the
score all disappear.

## Try the recorded round

Node.js 22 or newer. From the repository root in PowerShell:

```powershell
npm --prefix validation install
$env:NANSEN_LIVE="0"
$env:PORT="3001"
npm start
```

Open <http://127.0.0.1:3001/replay.html>. No API key is needed for this page. Step
through a real saved round, inspect the omitted evidence, then compare the recorded
experiments. Dates and recorded status stay visible. The replies are unchanged.

In pitch two, the unarmed desk mistakes one market's profit for the wallet's total.
The armed desk catches the mistake but still takes a small position, which its
policy allows. That distinction is the point of the demo.

## Play against the models

Copy `.env.example` to `.env` and configure `DEEPSEEK_API_KEY` and `NANSEN_API_KEY`.
The server reads the ignored file. Remove the snapshot override before starting:

```powershell
Remove-Item Env:NANSEN_LIVE -ErrorAction SilentlyContinue
$env:PORT="3001"
npm start
```

If the default trader is no longer losing over the current 30-day window, select
another tracked snapshot before starting:

```powershell
$env:ENCOUNTER_WALLET="0x6daec5ff434924e0839358e710e6ae5f158590de"
```

The server refuses an untracked address because every live encounter needs an audited
fallback if Nansen is unavailable.

Open <http://127.0.0.1:3001>. **Pitch the comeback** sends a prepared argument with
two evidence cards immediately. You can also choose cards and write your own pitch.
After three accepted pitches, copy the receipt with both replies and the evidence
date. The header distinguishes live data from snapshot fallback.

The shared prototype budget can disable live play even with valid keys. The
recorded page remains available. `/api/health` reports model usage and data status.

## What we measured

Ten recorded attacks, three repeats per configuration, DeepSeek, one losing wallet:

| Evidence access | Mean final allocation | Runs that funded |
| --- | ---: | ---: |
| None | $4,142 | 23/30 |
| PnL and trade history | $950 | 13/30 |
| Also open positions | $450 | 9/30 |

This measures persuasion under a permissive policy. These allocations are not
proof that an agent violated its own instructions. The benchmark's historical
`BAITED` label means a positive allocation to the losing wallet under its referee.

A separate strict-policy run funded 0/10 recorded attacks. The evidence and policy
both changed, and each attack ran once. Separate synthetic controls funded a
profitable wallet in 3/3 repeats. This is not a controlled 77%-to-0% improvement or
a guarantee against unseen attacks. No deterministic gate overrides model answers.

A later [fixed-evidence policy comparison](bench/reports/2026-09-19T06-18-01-805Z-paired.md)
tested six losing wallets and one profitable control. The permissive policy funded
2/6 losing wallets; the strict policy funded 0/6. Both funded the profitable control.
Each wallet-policy pair ran once, so this remains a small development sample.

The [historical robustness panel](bench/reports/robustness-panel.md) contains 840
distinct Nansen PnL observations across the same seven development wallets. The
7-day and 30-day verdicts disagree on 103 of 420 matched wallet-date pairs (25%).
All 14 wallet-window series change sign at least once. A carefully selected date
window is an argument, not proof of a durable edge.

## Evidence and checks

```powershell
npm test
npm run results:export
```

The export computes public totals from tracked replay rows and preserves the saved
round. Tests reject incomplete or duplicated results. Source paths and hashes are
included in the downloadable evidence.

- [Detailed setup, costs and methodology](prototype/README.md)
- [Original comparison](bench/reports/2026-09-18T13-58-10-058Z.md)
- [Separate strict-policy experiment](bench/reports/2026-09-18T16-25-58-254Z.md)
- [Design decisions](prototype/DESIGN.md)
- [Fixed-evidence comparison protocol](bench/PAIRED_PROTOCOL.md), completed on seven wallets. `npm run bench:paired` checks its inputs and budget without making API calls.
- [Submission status and recording plan](SUBMISSION.md)

The recorded demo is public, and the 45-second live-data submission video is prepared.
The X post and buildathon entry are still in progress.
Data: Nansen.

## Recorded demo package

Run `npm run demo:package` to prepare a standalone recorded demo under the ignored
scratch directory. It includes both experiments, original replies and setup instructions.
It makes no API calls and does not expose the live server. Serve its files from a static
host; this is separate from the live-data video required for the entry.

The GitHub Pages workflow verifies the tests and rebuilds this package before each
deployment. The hosted page contains recorded evidence only. Live play remains a
local, key-backed flow.
