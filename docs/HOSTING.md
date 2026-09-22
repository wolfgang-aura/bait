# Hosting the live BAIT demo on Render (free tier)

The hosted server runs with `HOSTED=1`: it serves the frozen 15 Sep Nansen snapshot
(zero Nansen credits), allows 12 rounds per visitor IP per 24h, and stops after 300
DeepSeek calls per UTC day. Both counters live in memory and reset when the free
instance restarts or wakes from idle. The lab runner (`/api/play`) is off.

## One-time setup (about 10 minutes)

1. Create a Render account at <https://dashboard.render.com/register>. Sign up with
   GitHub so the public repo is visible without extra permissions.
2. In the dashboard click **New** (top right), then **Blueprint**.
3. Under *Connect a repository* pick `wolfgang-aura/bait`. If it is not listed, click
   **Configure account** and grant Render access to that one repo.
4. Render reads `render.yaml` and shows one service, `bait`, on the Free plan.
   Give the blueprint any name and click **Apply**.
5. Render prompts for the secret marked `sync: false`. Set `DEEPSEEK_API_KEY` from the
   local environment. Hosted mode uses frozen Nansen evidence, so it does not receive
   `NANSEN_API_KEY`. Nothing else needs a value; `PORT` is injected by Render.
6. Wait for the first deploy to reach **Live** (2 to 4 minutes). The service URL is
   shown at the top of the service page as `https://bait-<hash>.onrender.com`.

To change a key later: open the service, choose **Environment** in the left menu, edit
the variable, then **Save, rebuild, and deploy**.

## Verify

1. Open `https://<your-service>.onrender.com/healthz`. Expect
   `{"ok":true,"evidence":"frozen","roundsToday":0,"callsToday":0,"startedAt":"..."}`.
   `evidence` must read `frozen`; `live` means `NANSEN_LIVE` was set to `1`.
2. Open `https://<your-service>.onrender.com/` and play one round. The header badge
   must say *Nansen snapshot, captured 15 Sep 2026*.

## Limits to tell the judges

- Free instances sleep after 15 minutes idle; the first request takes about 30 s to wake.
- A visitor who starts a fourth round in 24h sees "Today's live rounds are used up.
  Watch the recorded attack instead." with a link to the recorded round.
- Raise a cap by editing `HOSTED_ROUNDS_PER_IP` or `HOSTED_DAILY_CALLS` under
  **Environment**; the model-call ledger cap in `validation/providers.js` still applies.
