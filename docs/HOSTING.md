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
5. Render prompts for the secrets marked `sync: false`. Set `DEEPSEEK_API_KEY`. Leave
   `NANSEN_API_KEY` empty here and sync it from the local `.env` instead (below), so the
   key is never pasted. Nothing else needs a value; `PORT` is injected by Render.
6. Wait for the first deploy to reach **Live** (2 to 4 minutes). The service URL is
   shown at the top of the service page as `https://bait-<hash>.onrender.com`.

### Live Nansen evidence

The room reads live Nansen summaries when `NANSEN_LIVE=1` and `NANSEN_API_KEY` are set.
From the repository root, with `RENDER_API_KEY` (Render: Account settings, API keys) in
the local `.env`:

```powershell
node scripts/sync-render-env.mjs            # dry run: prints the key length, sends nothing
node scripts/sync-render-env.mjs --apply    # sets NANSEN_API_KEY, NANSEN_LIVE=1 and both caps
```

Then deploy (service page, **Manual Deploy**, **Deploy latest commit**). The start log
prints `nansen key present (length N)` and `room live read enabled (...)`, never the key.
The credit counter is a file on the instance disk, which Render's free plan wipes on
restart and deploy, so the total cap is per instance lifetime; the Nansen account balance
check at startup is the backstop.

To change a key later: open the service, choose **Environment** in the left menu, edit
the variable, then **Save, rebuild, and deploy**.

## Verify

1. Open `https://<your-service>.onrender.com/healthz`. `evidence` reads `live` when a
   Hyperliquid pick would buy a live read and `frozen` otherwise. `nansen` carries
   `key_present`, `credits_today`, `credits_total`, both caps, `blocked_by` and
   `last_live_success_at`.
2. Open `https://<your-service>.onrender.com/`. Before a pick the badge reads LIVE
   NANSEN · READ ON PICK (or FROZEN CAPTURE). Pick THE LEGEND: the badge turns green,
   LIVE NANSEN · FETCHED HH:MM UTC, and the truth screen says "live Nansen read". Two
   credits. `/healthz` `credits_today` rises by 2.

## Limits to tell the judges

- Free instances sleep after 15 minutes idle; the first request takes about 30 s to wake.
- A visitor who starts a fourth round in 24h sees "Today's live rounds are used up.
  Watch the recorded attack instead." with a link to the recorded round.
- Raise a cap by editing `HOSTED_ROUNDS_PER_IP` or `HOSTED_DAILY_CALLS` under
  **Environment**; the model-call ledger cap in `validation/providers.js` still applies.
