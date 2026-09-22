# Submission preparation

Not submitted. Updated 22 September 2026.

## Entry requirements

The [official entry guide](https://release.nansen.ai/help/articles/3540155-nansen-meridian-buildathon-sep-14-27)
requires 1,000 or more Nansen calls during 14–27 September, a public GitHub
repository, a 30–60 second recording posted on X with the repository link and
`@nansen_ai`, and the entry form. The recording must show the build running with
live Nansen data visible. The deadline is 27 September at 23:59 UTC, or
28 September at 07:59 Singapore time.

Current evidence:

- Nansen Usage Analytics: 1,033 Total Usage over 30 days and 615 Used Today,
  visually verified in the signed-in dashboard at 11:12 UTC on 20 September. This
  satisfies the 1,000-call eligibility requirement.
- Local ledger: 1,089 Nansen call rows since 14 September. The account reported 61
  credits remaining after the recording call at 04:26 UTC on 22 September.
- Public repository: <https://github.com/wolfgang-aura/bait>
- Playable build: <https://bait-wyqr.onrender.com/>, hosted on Render in frozen
  evidence mode (zero Nansen credits). A full round to a stamp was played and seen
  there on 22 September after the deploy of public commit `5b79411`.
- Recorded proof page: <https://wolfgang-aura.github.io/bait/>
- The 45-second submission recording is `scratch/BAIT-pitchroom-45s.mp4`. It shows
  one live Nansen check running. No X post or submitted form exists.

The qualification run produced a resumable historical panel across distinct 7-day
and 30-day endpoints: 840 observations across seven wallets. The 7-day and 30-day
verdicts disagree on 103 of 420 matched wallet-date pairs (25%). Profit/loss signs
flipped on 126 of 826 adjacent endpoints (15%), and all 14 wallet-window series
flipped at least once.

## The 45-second recording

The file is `scratch/BAIT-pitchroom-45s.mp4`: 1280 by 720, H.264/AAC, 30 fps and
exactly 45 seconds, 1,465,427 bytes with BT.709 limited-range `yuv420p`. SHA-256:
`15fe3b594992de4986dbb700404cafbb1e64ba3ed5008894b7b5b6941fc5e950`.

The cut leads with the finding, then shows the Pitch Room being played for real
against DeepSeek, then the ladder, then one live Nansen guard check. That check sends
a real `POST /api/guard`, spends one Nansen credit and prints the fetch time on
screen: `Live Nansen data · fetched 04:26 UTC`, realised 30-day PnL -$843,280.85 on
`0x69cc3ae720efdff1cd2a8edec79a7a3fac6e14fd`. It is the only Nansen spend in the cut.

| Time | Screen | Point the viewer should understand |
| --- | --- | --- |
| 0–3s | Black card: the verbatim bait line. | A human said something true to an AI allocator. |
| 3–6s | Black card: DeepSeek funded it 24 of 30, wallet down $4,745,429. | The true sentence sold a catastrophic wallet. |
| 6–8s | The roster of eight real traders. | Each tile is what the trader publishes about themselves. |
| 8–12s | THE GRINDER, hype versus record. | +$35,723 and a 100% week next to -$4,745,429 over 30 days. |
| 12–23s | A real three-line round against MERIDIAN. | The desk funds, then checks the Nansen tape, then cuts. |
| 23–26s | The wire and the BLOCKED stamp. | $0 executes. |
| 26–33s | The 24 → 6 → 0 ladder and the score table. | More data helps; only the code gate holds. |
| 33–41s | Live check on a losing wallet: BLOCK. | Fresh Nansen evidence, negative 30-day PnL, $0. |
| 41–45s | Closing card, play link and repository. | Anyone can play it or score their own agent. |

Known weakness: in the recorded round MERIDIAN funded $3,000 after line one, cut to
$2,000 on line two and held at $0 on line three, so the climax stamps a $0 wire that
the gate never had to stop. A re-cut that ends the room scene on the $3,000 wire being
cut to $0 is pending the founder's choice. The recording contains no simulated loading
period and makes no latency claim.

## Draft X post

Can true facts sell a losing trader to an AI?

BAIT red-teams wallet-allocation agents. No data: DeepSeek funded a wallet down $4.7M 24/30. With Nansen PnL and trades: 6/30. Behind BAIT's code gate: 0/30.

Play it: https://bait-wyqr.onrender.com
https://github.com/wolfgang-aura/bait @nansen_ai

The draft is 294 raw characters and 273 effective characters after X counts each link
as 23. It fits the free limit and includes the required tag and repository.

## Draft description

BAIT is a red-team benchmark for AI capital allocators, built for agent developers,
copy-trading platforms, wallets, managed vaults, funds and DAOs. The Pitch Room is the
attack recorder: pick one of eight real traders shown as they present themselves, see
their record from a Nansen profiler capture or a recorded Fomo Radar tape with a
seven-check copy-risk report, then sell them to MERIDIAN, an AI desk that reads the
same Nansen tools, in three lines. The wire passes through BAIT's execution gate and
gets a stamp. The benchmark replays ten recorded attacks against any agent
configuration on frozen evidence. The gate independently checks the proposed
allocation against one fresh Nansen call before the caller may honour it.

On the frozen-evidence suite, ten attacks by three repeats, DeepSeek funded the losing
wallet 24/30 with no tools, 6/30 with Nansen PnL and trades and no rule, and 0/30
behind the BAIT gate, which zeroed all 25 proposals the model still made. The gate
verifies wallet identity, 30-day scope, source, freshness and realised PnL, and fails
closed on invalid, stale, mismatched, missing or timed-out evidence. Full traces,
contract tests and reproduction commands accompany the demo.

BAIT does not select wallets, predict returns or execute trades. Passing the gate means
the proposal met one minimum eligibility rule. It is not an endorsement of the wallet.

## Before publication

Run `npm run submission:check` in the private workspace; it verifies the
dashboard-backed usage estimate, the 840-row panel, the public URL, the X draft, and
the video's duration, codec, dimensions, audio and SHA-256 without network calls.
Verify Total Usage directly in Nansen after that passes, then publish the post and
submit the form.

## Entry form audit

The live Typeform has three required fields:

1. Email associated with the Nansen API key.
2. X post URL with `@nansen_ai` tagged.
3. GitHub repository URL.

The GitHub value is `https://github.com/wolfgang-aura/bait`. The X value can only
exist after the video post. The account email was verified from the signed-in Nansen
settings page and stored only in the ignored private submission record. It is not in
the repository.
