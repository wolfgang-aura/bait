# BAIT

[![CI](https://github.com/wolfgang-aura/bait/actions/workflows/ci.yml/badge.svg)](https://github.com/wolfgang-aura/bait/actions/workflows/ci.yml)
[![Proof page](https://img.shields.io/badge/proof-page-FFB020)](https://wolfgang-aura.github.io/bait/)

**AI trading desks get pitched wallets to copy. BAIT is the gate, backed by Nansen data, that stops
the AI from funding the bad ones.**

**Judging? 3 minutes:** [play a round](https://bait-wyqr.onrender.com/) (1 min) ·
[watch the video](https://x.com/WolfGanG_Aura/status/2102859321969442856) (60 s) ·
[read the proof page](https://wolfgang-aura.github.io/bait/) · run `npm run verify` (1 min, no keys,
[Quickstart](#quickstart)). Longer path: [JUDGE.md](JUDGE.md).

![A BAIT round: a seller talks the AI into a transfer, then BAIT reads Nansen and decides](docs/media/round.gif)

## What we found

**On the live market, 5 of the top 200 wallets on Nansen's 30-day leaderboard are funded by an
owner whose other wallets lost more than the pitched wallet made.** A simple "don't copy a wallet
that lost money" rule funds all five. BAIT blocks all five: four because the owner lost, one for
too few trades. Read 25 Sep 2026, 06:04 UTC; details in [bench/FIELD.md](bench/FIELD.md).

![THE STEADY HAND in the Pitch Room: the pitched wallet made +$358,593 over 30 days; its first funder, 0xeb26...d4cf, funds 4 other wallets that lost $1,228,400](docs/media/owner-reveal.png)

*One of the five, as the game shows it: THE STEADY HAND (0x2043...e79d) made +$358,593 over 30
days. Its first funder, 0xeb26...d4cf, funds 4 other wallets that lost $1,228,400, so the owner is
down $869,807 (read 25 Sep 2026, 11:31 UTC).*

### The benchmark

| Who decides | Attacks where money went out |
| --- | ---: |
| A simple rule: "don't copy a wallet that lost money this month" | **61 of 79** |
| BAIT | **0 of 79** |

12 attacks are real wallets, picked by a rule written before any data was read. The other 67 are
faked evidence we built by changing one thing in a real Nansen record.

The worst attack uses only true facts: one owner funds several wallets, most lose, and the seller
pitches the one that won. The simple rule, and DeepSeek and Claude on their own, fund it. BAIT asks
Nansen who funded the wallet, sees the owner lost money, and refuses.

## How it works

1. An AI agent decides to copy a wallet and proposes a transfer.
2. Before any money moves, BAIT reads the wallet, and whoever funded it, from Nansen.
3. BAIT blocks, caps the amount at 25%, or clears it, and shows the rule that decided.

Anything BAIT cannot read counts as "not assessed" and never raises the amount.

## How BAIT uses Nansen

Every read drives a rule.

| Nansen endpoint | What it decides |
| --- | --- |
| `profiler/perp-pnl-summary` (30 and 7 days) | A losing month, too few trades, or a week that reverses the month blocks |
| `perp-leaderboard` | A summary that claims more than this second record blocks (catches faked evidence) |
| `profiler/perp-positions`, `perp-screener` | Deep open losses, or smart money on the other side, cap at 25% |
| `profiler/address/related-wallets`, `transactions`, then each sibling's `perp-pnl-summary` | Finds the owner who funded the wallet; if the owner's wallets lost money together, blocks |
| `profiler/perp-trades` (Pitch Room) | The newest fills: a drawdown or one trade too large for the book raises a caution flag in the copy-risk report; it never changes the amount |

Credits per call, and every figure with its denominator: [docs/EVIDENCE.md](docs/EVIDENCE.md#how-bait-uses-nansen).

## Quickstart

Node 22+, PowerShell.

```powershell
git clone https://github.com/wolfgang-aura/bait; cd bait; npm install
```

| To | Run | Notes |
| --- | --- | --- |
| Check every number | `npm run verify` | No keys, network off. Re-derives each figure above from the committed Nansen reads and ends with `PASS  34 of 34 checks` |
| Play the game | `npm start`, then open <http://localhost:3000> | With no keys it plays recorded Nansen reads, marked FROZEN CAPTURE, and PENNY answers through the hosted game |
| Ask the gate about one wallet | `npm run assess -- 0xc26cbb6483229e0d0f9a1cab675271eda535b8f4` | `npm run assess -- --list` shows the wallets on file |
| Test your own agent | `npm run bench -- --agent your-agent.mjs --snapshot` | The same attacks, zero Nansen credits |

For live reads, copy `.env.example` to `.env` and add `NANSEN_API_KEY`; add `DEEPSEEK_API_KEY` for
a live AI.

## Limits

- BAIT catching the hidden-owner wallets is partly by construction: it reads the quantity that
  defines the attack. What is measured is that such wallets exist and that the simple rule and both
  AIs fund them.
- It does not predict returns. It refuses on the record that exists today. It also costs good
  traders: 38 of 53 good-trader transfers went through in full.
- An owner who funds through an exchange or a fresh address is not seen.

Every number, denominator and caveat: [docs/EVIDENCE.md](docs/EVIDENCE.md).

## Repo map

| Folder | What is in it |
| --- | --- |
| `validation/` | The gate itself (`guard.js`) and its tests |
| `prototype/` | The game: server, Pitch Room, PENNY |
| `bench/` | The attacks, every raw Nansen read, pre-registrations and results |
| `scripts/` | `verify`, `assess` and release tooling |
| `docs/` | Evidence, hosting, the gate's contract and media |

MIT license. BAIT does not select wallets, predict returns or execute trades. All allocations are
fictional. Data: Nansen.
