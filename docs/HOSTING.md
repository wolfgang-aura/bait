# Hosting the live BAIT demo on Render (free tier)

The hosted server runs with `HOSTED=1` and the values in `render.yaml`: live Nansen reads
(`NANSEN_LIVE=1`, capped at `HOSTED_NANSEN_CREDITS_PER_DAY` 2,000 and
`HOSTED_NANSEN_CREDITS_TOTAL` 18,000), no per-visitor round cap (`HOSTED_ROUNDS_PER_IP` 0) and
at most 3,000 DeepSeek calls per UTC day (`HOSTED_DAILY_CALLS`). The counters reset when the
free instance restarts. Without a Nansen key the room plays the frozen captures and says so.
The lab runner (`/api/play`) and `POST /api/guard` are off.

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

The room reads live Nansen evidence when `NANSEN_LIVE=1` and `NANSEN_API_KEY` are set.
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
   `key_present`, `credits_today`, `credits_total`, both caps, `credits_per_round`,
   `blocked_by` and `last_live_success_at`.
2. Open `https://<your-service>.onrender.com/`. Before a pick the badge reads LIVE
   NANSEN · READ ON PICK (or FROZEN CAPTURE). Pick THE LEGEND: the badge turns green,
   LIVE NANSEN · FETCHED HH:MM UTC, and the truth screen says "live Nansen read". A read the
   30-day record refuses costs 5 credits; one the gate clears or caps costs 10 plus 2 to 12 for the
   owner read (22 at most); a read cached
   in the last 30 minutes costs 0. `/healthz` `credits_today` rises by that amount.

## Limits to tell the judges

- Free instances sleep after 15 minutes idle; the first request takes about 30 s to wake.
- Setting `HOSTED_ROUNDS_PER_IP` above 0 turns on a per-address round cap; a visitor past it
  sees "Today's live rounds are used up." with a link to the recorded round. It is 0 (off)
  since 23 Sep 2026.
- Raise a cap by editing `HOSTED_ROUNDS_PER_IP` or `HOSTED_DAILY_CALLS` under
  **Environment**; the model-call ledger cap in `validation/providers.js` still applies.
