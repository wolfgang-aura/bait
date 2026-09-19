# Fixed-evidence policy comparison

Status: the first real evaluation completed all 14 replays on 19 September. See
[the result](reports/2026-09-19T06-18-01-805Z-paired.md). The dry run makes no model or Nansen calls.

Run `npm run bench:paired` to inspect the plan and budget requirement.
`npm run bench:paired -- --execute` runs it only if the existing model cap has
room for the entire worst-case request count. It never raises that cap.

## Question

With tools, wallet evidence, model and pitches held constant, does the strict
eligibility prompt reduce allocations to losing wallets while still allowing an
allocation to the profitable control?

This measures the effect of changing the prompt policy. It does not measure the
effect of adding Nansen access, and it does not enforce eligibility in code.

## Frozen inputs

The explicit snapshot list in `bench/paired.js` contains six losing wallets and one
profitable control captured on 15 September 2026. Both policies receive the same
snapshot for each wallet. No live refresh occurs during evaluation.

Both configurations have the same tools, endpoints and permitted time windows.
They differ in their policy text. Each receives three pitches using the same
recipe: seven-day PnL, the strongest individual market over 30 days, then the
30-day win rate. Claims come directly from that wallet's snapshot and retain the
sign and period. A losing recent record is never described as a comeback.

The model is `deepseek-chat` with a 600-token response limit, matching the player
server. Both policies use identical request settings. The provider can update the
model behind that alias, so the results cannot promise an immutable model version.
Policy order alternates between wallets. Each replay starts a fresh conversation.
The default is one repeat per wallet-policy pair: 14 replays and at most 126 calls.

The plan ID hashes the configuration, model settings, pitch text and snapshot
hashes. Every result carries that ID plus its evidence and pitch hashes. Mismatched
or duplicated result rows are rejected by the summarizer.

## Reporting

Report complete pairs only. For losing wallets, show both policies' funded counts
and mean change in final allocation, strict minus baseline. Show the profitable
control separately so rejecting every wallet cannot masquerade as success.

Errors remain errors. An unfinished or failed replay never becomes a zero-dollar
allocation. The runner saves after each replay and stops at the first failure.
Its report identifies an incomplete run. There is no automatic retry or resume in
this version; inspect a failure before spending on another run.

## Limits

These wallets were already collected during development. The pitch recipe is new,
but this is not an independently held-out evaluation. Six losing wallets, one
profitable control, one model and one repeat cannot establish a general guarantee.
The control snapshot has incomplete trade coverage; both configurations see that
same limitation. Snapshot windows are fixed within each pair but differ slightly
between wallets. Repeating the experiment would help quantify model variation.

Do not replace the recorded 90-replay results or combine their denominators with
this experiment. Publish this comparison as a separate result after it completes.
