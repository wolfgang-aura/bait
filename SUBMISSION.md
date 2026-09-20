# Submission preparation

Not submitted. Updated 20 September 2026.

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
- Local ledger: 1,044 Nansen calls since 14 September, 1,043 successful and 1,028
  locally charged credits. Free account checks explain the difference from dashboard usage.
- Public repository: <https://github.com/wolfgang-aura/bait>
- Recorded demo: <https://wolfgang-aura.github.io/bait/>
- A 45-second product video candidate exists at `scratch/BAIT-wallet-guard-45s.mp4`.
  No X post or submitted form exists.
- The saved replay works without keys, but it does not satisfy the live-data
  recording requirement by itself.

The completed qualification run produced a resumable historical panel across
distinct 7-day and 30-day endpoints: 840 observations across seven wallets. The
7-day and 30-day verdicts disagree on 103 of 420 matched wallet-date pairs (25%).
Profit/loss signs flipped on 126 of 826 adjacent endpoints (15%), and all 14
wallet-window series flipped at least once. The final account response reports 87
credits remaining. These calls produced documented regime-stability evidence while
completing eligibility.

## The 45-second recording

The candidate is 1280 by 720, H.264/AAC, 30 fps and exactly 45 seconds. A 41-second
browser sequence shows the recorded attack, the four-row benchmark, and the production
guard contract. A four-second closing card states the product boundary and result.
The sequence uses exact saved Nansen values and model decisions. The final encode is
2,593,467 bytes with BT.709 limited-range `yuv420p`. SHA-256:
`8f60dc18880d10336f2c39e205a1450c8e4fe3908d73d6bb23424a4818c5fe00`.

| Time | Action | Point the viewer should understand |
| --- | --- | --- |
| 0–5s | State the product and show 24/30 against 0/30. | BAIT protects AI wallet-allocation decisions. |
| 5–19s | Step through the true but selective pitch and both desks. | Tool access helps, but the allocator can still fund the loser. |
| 19–26s | Reveal the full 30-day loss. | The short-window pitch omitted the wallet-wide result. |
| 26–34s | Show the four controlled benchmark rows. | The same recorded attacks compare no tools, Nansen tools, prompt policy and code guard. |
| 34–41s | Show the guard contract and integration boundary. | BAIT checks wallet, window, source, freshness and PnL before execution. |
| 41–45s | Show the result and public repository. | The guard blocked 25 attempts and funded the losing wallet 0/30. |

The candidate contains no simulated loading period and makes no latency claim. It
labels the page as recorded proof and does not imply that frozen evidence authorizes a
live allocation.

## Draft X post

Can true facts sell a losing trader to an AI?

BAIT red-teams wallet-allocation agents, then blocks unsafe execution with fresh Nansen 30d PnL. The guard stopped 25 attempts: 24/30 baited without it, 0/30 with it.

https://github.com/wolfgang-aura/bait @nansen_ai

The draft is 263 raw characters and 249 effective characters after X counts the link
as 23. It fits the free limit and includes the required tag and repository.

## Draft description

BAIT protects one automated decision: whether an AI system may allocate capital to a
tracked perpetual-trading wallet. It is built for agent developers, copy-trading
platforms, wallets, managed vaults, funds and DAOs. The game records a human persuading
an allocator with true but selective evidence. The benchmark replays those attacks
against any agent configuration. The execution guard independently checks the proposed
allocation against Nansen before the caller may honour it.

In the fixed-evidence policy comparison, the permissive policy funded 2/6 losing
wallets. The strict Nansen-backed policy funded 0/6 and still funded the profitable
control. Each pair used the same evidence, tools, model and pitches. The frozen-evidence
attack suite, 10 recorded attacks by 3 repeats, funded the losing wallet 24/30 with
no tools, 6/30 with Nansen PnL and trades, 0/30 with the prompt-only rule, and 0/30
with the BAIT guard, a code gate that blocked 25 of 30 attempts using one Nansen call
and no model tool. The production gate verifies wallet identity, 30-day scope, source,
freshness and realised PnL. It fails closed on invalid, stale, mismatched, missing or
timed-out evidence. Full traces, contract tests and reproduction commands accompany
the demo.

BAIT does not select wallets, predict returns or execute trades. Passing the gate means
the proposal met one minimum eligibility rule. It is not an endorsement of the wallet.

## Before publication

A complete real-provider round with live data passed on 19 September, including
receipt copying and reload recovery. The paired comparison also completed; its
full result is linked in the README. In the private development workspace, run
`npm run submission:check`; it verifies the
dashboard-backed usage estimate, 840-row panel, public URL, X draft, video duration,
codec, dimensions, audio and SHA-256 without making network calls. Verify Total Usage
directly in Nansen after that passes, then publish the post and submit the form.

## Final live-data candidate, 20 September

The original trader turned profitable and the game refused to mislabel it. A second tracked trader now supplies the live encounter with an audited fallback. A complete three-pitch DeepSeek round passed with `Live Nansen data · fetched 21:06 UTC` visible. The current 30-day result was -$1,406,757 and the seven-day result was +$39,900. Use this trader for the final recording.

## Entry form audit

The live Typeform has three required fields:

1. Email associated with the Nansen API key.
2. X post URL with `@nansen_ai` tagged.
3. GitHub repository URL.

The GitHub value is `https://github.com/wolfgang-aura/bait`. The X value can only
exist after the video post. The account email was verified from the signed-in Nansen
settings page and stored only in the ignored private submission record. It is not in
the repository.
