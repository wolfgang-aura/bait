# Public release audit

Prepared 19 September 2026. Nothing has been pushed or deployed.

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

Before public release, confirm the repository owner and name. The expected target
is `wolfgang-aura/bait`; that repository did not exist when this audit ran. Making
the repository public and enabling Pages will expose the code, blockchain evidence,
model replies and benchmark reports to anyone.
