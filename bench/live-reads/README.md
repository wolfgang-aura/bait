# Raw live Nansen reads

One JSON file per fresh live read the hosted Pitch Room made, saved byte for byte as it
arrived and listed with its SHA-256 at `/api/live-reads`. Committed files are never
rewritten; SUBMISSION.md publishes the SHA-256 of the three reads the submission cites (both
video rounds and the round `perp-screener` capped).

Fields: `responses['30d']` and `responses['7d']` are the two `profiler/perp-pnl-summary`
calls (request, status, credit header, body). From 23 Sep 2026 06:41 UTC a read also holds
`responses.fills`: pages of `profiler/perp-trades`, newest first. From gate v3 revision 3
(23 Sep) it holds `responses.positions` (`profiler/perp-positions`), and from gate v4 (23 Sep,
`bench/V4.md`) `responses.smart_money` (`perp-screener`, only when the wallet has an open
position) and `responses.leaderboard` (`perp-leaderboard`, only when nothing earlier refused).
Each response carries Nansen's `credits_cost_header`, so a file's credits can be summed from it.

Known quirk: files saved before round 12 carry only `"endpoint": "profiler/perp-pnl-summary"`
even when they also hold `responses.fills` from `profiler/perp-trades`. Files saved after it
add `"endpoints"`, listing every endpoint the file holds a response from.

Addresses: raw reads keep the full wallet address. Every other surface shows 0x1234...abcd.
