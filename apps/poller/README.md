# Poller

Always-on Node process that polls every enabled alert's RSS feed at the configured cadence (default 30s), parses items, deduplicates them against the `deals` table, and inserts `alert_matches` rows. A Postgres trigger on `alert_matches` then fires the notifier edge function.

## Run locally

```bash
cp ../../.env.example .env
pnpm install
pnpm dev
```

The `dev` script uses `tsx watch` for hot reload. Logs are JSON to stdout.

## Deploy to Fly.io

From the **repo root**:

```bash
cd apps/poller
fly launch --no-deploy           # accept defaults; this writes secrets to fly.toml
fly secrets set \
  SUPABASE_URL="https://YOUR_REF.supabase.co" \
  SUPABASE_SERVICE_ROLE_KEY="eyJ..."
fly deploy
```

## Operations

- `fly logs` — tail logs
- `fly status` — see machine state
- `fly ssh console` — shell into the running machine
- Restart loop after changing env: `fly machine restart`

## What it does NOT do

- It does not send notifications. Those are fanned out by the `notifier` edge function, triggered by a Postgres `AFTER INSERT` trigger on `alert_matches`.
- It does not enforce RLS — it uses the service role key. Be careful with that key.
