# Architecture

## System diagram

```
   ┌────────────────────────────────────┐
   │ Slickdeals RSS feeds                │
   │ (one URL per saved search)          │
   └──────────────┬─────────────────────┘
                  │  HTTP GET (ETag / If-Modified-Since)
                  │  60s cadence, per-feed exp. backoff on errors
                  ▼
   ┌────────────────────────────────────┐
   │ Poller   (Fly.io machine, Node)     │
   │  - listEnabledAlerts() oldest-first │
   │  - fetch → parseRss → upsertDeal    │
   │  - insertMatch (one per alert hit)  │
   └──────────────┬─────────────────────┘
                  │ writes (service role, bypasses RLS)
                  ▼
   ┌────────────────────────────────────────────────────────┐
   │ Supabase Postgres                                       │
   │  user_settings | notification_channels | alerts |       │
   │  deals | alert_matches | notifications_sent |           │
   │  deal_state                                             │
   │                                                          │
   │  AFTER INSERT trigger on alert_matches →                │
   │    pg_net.http_post → notifier edge function            │
   └──┬───────────────────────────────────┬─────────────────┘
      │ DB trigger (pg_net)               │ Realtime / direct query
      ▼                                   ▼
   ┌───────────────────────────┐  ┌────────────────────────────┐
   │ Notifier  (Edge Function) │  │ Dashboard  (Next.js / Vercel)│
   │  resolves channel set →    │  │  /login   magic-link auth   │
   │  dispatches via providers/ │  │  /setup   onboarding wizard │
   │  logs notifications_sent   │  │  /        unified feed      │
   └───┬──────────┬─────┬──────┘  │  /alerts  CRUD              │
       │          │     │         │  /stats   latency dashboards│
       │          │     │         │  /settings channels + prefs │
       ▼          ▼     ▼         └────────────────────────────┘
   ┌────────┐ ┌─────┐ ┌──────┐
   │Telegram│ │ SMS │ │ ntfy │ ...  (plus Pushover, Discord, Email, Webhook)
   └────────┘ └─────┘ └──────┘
```

## Why these pieces

**Why pg_cron → `poll` edge function for the poller (the hosted default):**
zero extra infrastructure — everything runs inside Supabase. The 60s cadence is
deliberate: Slickdeals' RSS advertises a 5-minute TTL, so polling faster buys
latency the feed doesn't deliver, and 60s keeps PostgREST egress comfortably
inside Supabase's free tier.

**Why the optional Fly machine poller exists:** an always-on Node process can poll
faster than any hosted scheduler allows and keeps ETag/If-Modified-Since in memory
across polls (politer to Slickdeals). Only worth running if you genuinely need
sub-minute latency.

**Why Supabase RLS for multi-tenancy:** RLS makes "share my instance with coworkers"
a zero-effort feature. Every domain table has `user_id` + a policy. Service role
(poller + notifier) bypasses RLS for system writes.

**Why pluggable providers (`supabase/functions/_shared/providers/`):**
adding a new notification service is a single file + one entry in `index.ts`. No
schema change, no dashboard change beyond an entry in `packages/shared/src/providers.ts`
that drives the picker.

## Data flow: one deal end-to-end

1. **Poller tick** (every 60s):
   `listEnabledAlerts()` → oldest `last_polled_at` first.
2. **Fetch** with `If-None-Match: <last_etag>`.
   - `304 Not Modified` → bump `last_polled_at`, done.
   - `200` → parse RSS items, filter to the alert's matchers. On an alert's
     *first* poll, keep only the 10 newest matches so a new alert doesn't
     flood the feed/notifications with the feed's backlog.
3. **Per feed** (batched — three PostgREST round-trips, not one per item):
   - Look up which `slickdeals_id`s already exist in `deals`.
   - Array-upsert only the new items (existing deals are not re-written;
     `refresh-scores` keeps vote counts fresh).
   - Array-insert `alert_matches` with `ON CONFLICT DO NOTHING` on the unique
     `(alert_id, deal_id)` constraint — idempotent across re-polls.
4. **DB trigger** `alert_matches AFTER INSERT` calls `pg_net.http_post` to the
   `notifier` edge function with `{match_id, user_id, alert_id, deal_id}`.
5. **Notifier**:
   - Loads `deal`, `alert`, `user_settings`, target `notification_channels` (verified, enabled, intersected with `alert.channel_ids` if non-empty).
   - Constructs `Notification` (title/body/url/priority/silent).
   - Fans out to each channel via `providers[ch.type].send(...)` in parallel.
   - Inserts one `notifications_sent` row per attempt, with computed latency.
6. **Phone buzzes.**
7. **Dashboard** queries `alert_matches` joined to `deals` / `deal_state` for the feed page. Realtime subscriptions update the page live.

## Trust boundaries / who can do what

| Actor | Can read | Can write |
|---|---|---|
| Authenticated user | own `alerts`, `notification_channels`, `alert_matches`, `deal_state`, `notifications_sent`, `user_settings`; `deals` referenced by their matches | own `alerts`, `notification_channels` config, `deal_state`, `user_settings` (RLS-enforced) |
| Poller (service role) | everything | `deals`, `alert_matches`, `alerts.last_*` |
| Notifier (service role) | everything | `notifications_sent` |
| Telegram bot | nothing direct (talks to telegram-webhook fn) | `notification_channels.config.chat_id`, `deal_state` (via webhook) |

## Adding a new notification provider

1. Create `supabase/functions/_shared/providers/<name>.ts` exporting a `Provider`.
2. Add it to the registry in `supabase/functions/_shared/providers/index.ts`.
3. Add a `ProviderMeta` to `packages/shared/src/providers.ts` so the dashboard's picker and setup wizard know about it.
4. (If verification needs special handling) extend `channel-verify` to handle the new `type`.
5. Deploy: `supabase functions deploy notifier channel-verify send-test`.

That's it. No DB migration, no dashboard rebuild needed beyond redeploy.

## Failure modes worth knowing

| Failure | What happens |
|---|---|
| Slickdeals returns 429 | Poller bumps `consecutive_errors`; backoff up to 10min |
| RSS URL goes dead | Same as above; `alerts.last_error` is surfaced on the dashboard |
| Telegram API down | Notification row written with `ok=false`; user sees it on `/stats`. Other channels still fire. |
| Edge function cold start | Adds ~200ms to first notification after idle. Negligible. |
| pg_net trigger silently drops | `app.notifier_url` not set, or `service_role_key` GUC wrong. Notifier never fires. See `operating.md`. |
| Notifier auth header mismatch | Trigger gets 401, drops the call. Symptom: matches appear in feed but nothing notifies. |
