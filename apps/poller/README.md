# Poller (deprecated — Fly.io path)

> **Deprecated as of 2026-05-21.** Polling now runs **inside Supabase** via
> the `poll` edge function + a `pg_cron` schedule (see
> `supabase/functions/poll/` and `supabase/migrations/20260521000001_schedule_polling.sql`).
> Each deployment auto-provisions polling on deploy — no extra services or
> $/mo costs required.
>
> This directory is kept as an optional alternative for anyone who wants a
> dedicated machine (e.g., extreme polling cadence, custom networking).
> It's no longer wired into the default Vercel build / deploy.

---

Always-on Node process that polls every enabled alert's RSS feed at the configured cadence (default 30s), parses items, deduplicates them against the `deals` table, and inserts `alert_matches` rows. A Postgres trigger on `alert_matches` then fires the notifier edge function.

## When you'd still use this

- You want **sub-30s polling** that pg_cron can't comfortably do (e.g., 5s).
- You want polling to come from a **dedicated IP** (Fly assigns one per machine).
- Your Supabase plan has pg_cron disabled or rate-limited.

For all other cases — including the default plug-and-play setup — the in-Supabase poller is preferable.

## Run locally

```bash
cp ../../.env.example .env
pnpm install
pnpm dev
```

The `dev` script uses `tsx watch` for hot reload. Logs are JSON to stdout.

## Deploy to Fly.io (manual)

From the **repo root**:

```bash
cd apps/poller
fly launch --no-deploy
fly secrets set \
  SUPABASE_URL="https://YOUR_REF.supabase.co" \
  SUPABASE_SERVICE_ROLE_KEY="eyJ..."
fly deploy
```

If you go this route, **drop the in-Supabase poll schedule first** to avoid
double-polling:

```sql
select cron.unschedule('poll-feeds');
```

## What it does NOT do

- It does not send notifications. Those are fanned out by the `notifier` edge function, triggered by a Postgres `AFTER INSERT` trigger on `alert_matches`.
- It does not enforce RLS — it uses the service role key. Be careful with that key.
