# Raw live Nansen reads

One JSON file per fresh live read the hosted Pitch Room made, saved byte for byte as it
arrived and listed with its SHA-256 at `/api/live-reads`. The hashes of committed files are
published in SUBMISSION.md, so committed files are never rewritten.

Fields: `responses['30d']` and `responses['7d']` are the two `profiler/perp-pnl-summary`
calls (request, status, credit header, body). From 23 Sep 2026 06:41 UTC a read also holds
`responses.fills`: pages of `profiler/perp-trades`, newest first.

Known quirk: files saved before round 12 carry only `"endpoint": "profiler/perp-pnl-summary"`
even when they also hold `responses.fills` from `profiler/perp-trades`. Files saved after it
add `"endpoints"`, listing every endpoint the file holds a response from.

Addresses: raw reads keep the full wallet address. Every other surface shows 0x1234...abcd.
