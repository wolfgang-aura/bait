# BAIT

[![CI](https://github.com/wolfgang-aura/bait/actions/workflows/ci.yml/badge.svg)](https://github.com/wolfgang-aura/bait/actions/workflows/ci.yml)
[![Proof page](https://img.shields.io/badge/proof-page-FFB020)](https://wolfgang-aura.github.io/bait/)

**AI trading desks get pitched wallets to copy. BAIT is the gate, backed by Nansen data, that stops
the AI from funding the bad ones.**

![A BAIT round: a seller talks the AI into a transfer, then BAIT reads Nansen and decides](docs/media/round.gif)

**Play it:** <https://bait-wyqr.onrender.com/>. Talk PENNY, an AI with a $25,000 fund, into backing
a trader, press **Wire it**, and watch BAIT read Nansen live and decide.
[60-second video](https://x.com/WolfGanG_Aura/status/2102859321969442856).

## What we found

| Who decides | Attacks where money went out |
| --- | ---: |
| A simple rule: "don't copy a wallet that lost money this month" | **61 of 79** |
| BAIT | **0 of 79** |

The worst attack uses only true facts: one owner funds several wallets, most lose, and the seller
pitches the one that won. The simple rule, and DeepSeek and Claude on their own, fund it. BAIT asks
Nansen who funded the wallet, sees the owner lost money, and refuses.

On the live market, 5 of the top 200 leaderboard wallets have that shape ([bench/FIELD.md](bench/FIELD.md)).

## Check it in one command

No keys, no network, no credits. Node 22+.

```powershell
git clone https://github.com/wolfgang-aura/bait; cd bait; npm install
npm run verify
```

Every number above is re-derived from committed Nansen reads and prints PASS or FAIL.
Test your own agent against the same attacks: `npm run bench -- --agent your-agent.mjs --snapshot`.

## More

- [JUDGE.md](JUDGE.md): the three-minute judging path
- [docs/EVIDENCE.md](docs/EVIDENCE.md): how BAIT uses Nansen, every denominator, the cost, and the limits
- [Proof page](https://wolfgang-aura.github.io/bait/): every result with its source

MIT license. BAIT does not select wallets, predict returns or execute trades. All allocations are
fictional. Data: Nansen.
