# Public release audit

Prepared 19 September 2026 and updated after publication on 20 September 2026.

> *Note, 24 Sep 2026: this is the record of the first public release and is kept as it was.
> Its counts (files, tests) and its "pending" section describe 20 September; issue #3 closed
> that day. The current state, figures and commands are in [README.md](README.md) and
> [SUBMISSION.md](SUBMISSION.md), with every headline figure in
> [bench/FIGURES.json](bench/FIGURES.json).*

- Public repository: <https://github.com/wolfgang-aura/bait>
- Recorded demo: <https://wolfgang-aura.github.io/bait/>
- Published commit: `ab617aac5febcbe7312f1777243d554bd814990b`
- Pages workflow run `35468370556` passed after the deployment path fix.

The release candidate contains 255 tracked files and starts from one clean commit.
It excludes the local `.env`, API keys, usage ledgers, conversation notes, local
handoff files, scratch output and the development repository's Git history.

Verification completed in a separate directory:

- Configured-secret and common credential-pattern scan passed.
- Dependency audit reported no known vulnerabilities.
- All 147 tests passed.
- The benchmark exporter rebuilt every shipped case byte for byte from tracked
  receipts and recorded lab runs.
- The standalone recorded demo loaded without the API server or credentials.
- Desktop and phone views were inspected after adding the paired result explorer.

The GitHub Pages workflow runs the full tests and regenerates the public evidence
before publishing the recorded demo. It cannot expose the live server or API keys.
The public page remains clearly labelled as recorded and links to local setup for
the live game.

The public repository exposes the intended code, blockchain evidence, model replies
and benchmark reports. It excludes local credentials, usage ledgers, scratch output
and the development repository's Git history.

## Pending final refresh

The release exporter now updates an existing clean Git staging clone instead of
failing after the first publication. It refuses a dirty checkout, refuses outputs
outside `scratch`, preserves `.git`, removes stale tracked files, and reruns the
credential scan. A fresh 263-file export and a second in-place export both passed.
After installing the pinned validation dependency, all 154 tests passed and both
evidence and demo exporters completed in the isolated tree. This refresh is not yet
published; issue #3 remains open until the eligibility gate, Pages workflow and live
page all pass.

Private release commands are removed from the exported `package.json`; their video and
ledger inputs are intentionally absent from the public repository. Shared validators
remain public, and the exported test suite covers them without importing private files.
