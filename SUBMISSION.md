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
- A 45-second live-data video candidate exists at `scratch/BAIT-live-demo-45s.mp4`.
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

The candidate is 1280 by 720, H.264/AAC, 30 fps and exactly 45 seconds. A 34-second
browser sequence scrolls through the running BAIT interface from the verified live
encounter. Windows returned black frames when asked to capture protected browser
windows, so Chrome DevTools captured the app sequence directly. The video keeps the
live timestamp visible and uses the exact saved Nansen values and model decisions.
The final encode is 28,066,691 bytes and 4.98 Mbps. It matches [X's published
upload guidance](https://help.x.com/en/using-x/media-studio-faqs): 1280x720,
H.264, AAC-LC and 5–8 Mbps. SHA-256:
`91b1dd757fbfc1332e5c1e68da9adccf5ba0361c11c814d8464afb1878e17bc5`.

| Time | Action | Point the viewer should understand |
| --- | --- | --- |
| 0–8s | State the game and show the live Nansen timestamp. | Real records, fictional capital. Can true facts sell a losing trader? |
| 8–23s | Show the selected seven-day facts, then both desk decisions. | Both desks receive the same pitch; one can check the record. |
| 23–30s | Reveal the full 30-day loss. | The short-window pitch leaves out the wallet-wide result. |
| 30–38s | Show the live-round result and 90-replay rates. | Tools reduced risk in aggregate but did not guarantee the safer live decision. |
| 38–45s | Show the fixed-evidence policy result and public links. | Strict funded 0/6 losing wallets and 1/1 profitable control. |

The candidate contains no simulated loading period and makes no latency claim.
It names the encounter as verified live data and preserves the fetched timestamp.

## Draft X post

Can true facts sell a losing trader?

BAIT baits AI trading desks with true but selective facts, then scores any agent
config against the recorded attacks. Same wallet, lost $4.7M in 30 days: no tools
funded it 24/30, Nansen data 6/30, the BAIT guard 0/30 and blocked 25 attempts in code.

Play + audit: https://github.com/wolfgang-aura/bait
@nansen_ai

The raw draft is 352 characters, 338 after X counts the link as 23. That is over the
280-character free limit, so it needs a Premium account or a trim before posting. It
includes the required tag and GitHub link.

## Draft description

BAIT asks whether true but selective evidence can persuade an AI allocator to fund
a losing trader. Players send the same pitch to two desks. One sees only the pitch;
the other can query Nansen PnL and trade history. The receipt exposes the selected
facts, the full record and both decisions.

In the fixed-evidence policy comparison, the permissive policy funded 2/6 losing
wallets. The strict Nansen-backed policy funded 0/6 and still funded the profitable
control. Each pair used the same evidence, tools, model and pitches. The frozen-evidence
attack suite, 10 recorded attacks by 3 repeats, funded the losing wallet 24/30 with
no tools, 6/30 with Nansen PnL and trades, 0/30 with the prompt-only rule, and 0/30
with the BAIT guard, a code gate that blocked 25 of 30 attempts using one Nansen call
and no model tool. Full traces and reproduction commands accompany the demo.

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
