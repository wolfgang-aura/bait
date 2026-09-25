# Raw live Nansen reads

One JSON file per fresh live read the Pitch Room made (hosted, or local with a key), saved byte for byte as it
arrived and listed with its SHA-256 at `/api/live-reads`, minus Nansen's address labels.
SUBMISSION.md publishes the SHA-256 of the three reads the submission cites (both video rounds
and the round `perp-screener` capped).

Labels: Nansen's redistribution guide prohibits public display of address labels in bulk, so
no committed or served read carries one. On 25 Sep 2026 `node scripts/strip-nansen-labels.mjs
--write` removed the `trader_address_label` field from the three files here that held one
(20260923T155252Z, 20260923T160814Z, 20260923T190301Z) and nothing else; their SHA-256 changed
and every place that records one was updated. The two video rounds held no label and are
unchanged. Reads saved after that are stripped before they are written
(`validation/nansen-labels.js`).

Fields: `responses['30d']` and `responses['7d']` are the two `profiler/perp-pnl-summary`
calls (request, status, credit header, body). From 23 Sep 2026 06:41 UTC a read also holds
`responses.fills`: pages of `profiler/perp-trades`, newest first. From gate v3 revision 3
(23 Sep) it holds `responses.positions` (`profiler/perp-positions`), and from gate v4 (23 Sep,
`bench/V4.md`) `responses.smart_money` (`perp-screener`, only when the wallet has an open
position) and `responses.leaderboard` (`perp-leaderboard`, only when nothing earlier refused).
From gate v5 in the room (25 Sep) it holds `responses.operator`: the owner read, one entry per call
(`profiler/address/related-wallets` per chain, `profiler/address/transactions` for the funding
transfer, each sibling's `profiler/perp-pnl-summary`). Each entry names its own `endpoint`. From 25 Sep 2026 (the
writer in `prototype/live-evidence.js`) the top-level `"endpoints"` list also names every endpoint the
owner read called, once each: `profiler/address/related-wallets` and `profiler/address/transactions`;
the siblings' `profiler/perp-pnl-summary` is the endpoint already listed first. When the owner read did not
run, they are not listed. Files saved before that change are kept as written, so a file whose
`responses.operator` has entries but whose `"endpoints"` omits them predates it; read those from each
entry's `endpoint`.
Each response carries Nansen's `credits_cost_header`, so a file's credits can be summed from it.

Known quirk: files saved before round 12 carry only `"endpoint": "profiler/perp-pnl-summary"`
even when they also hold `responses.fills` from `profiler/perp-trades`. Files saved after it
add `"endpoints"`, listing every endpoint the file holds a response from.

Addresses: raw reads keep the full wallet address. Every other surface shows 0x1234...abcd.
