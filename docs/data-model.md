# Data model

All tables live in `public`. Every table has RLS enabled (`supabase/migrations/20260518000001_rls.sql`).

```
auth.users
   │
   ├──< user_settings (1:1)        — quiet hours, timezone, digest mode, onboarded_at
   │
   ├──< notification_channels      — per-user per-provider config (jsonb)
   │
   ├──< alerts                     — saved-search RSS feeds + filters + channel_ids[]
   │       │
   │       └──< alert_matches >──< deals (shared, deduped)
   │                  │
   │                  └──< notifications_sent (one row per outbound attempt)
   │
   └──< deal_state                 — read/saved/dismissed per (user, deal)
```

## Hot paths

| Query | Index |
|---|---|
| Poller dedup `deals.slickdeals_id` lookup | `unique` constraint |
| Poller "what to poll next" | `alerts_enabled_last_polled_idx` (partial) |
| Feed page (user's matches, newest first) | `alert_matches_user_matched_at_idx` |
| Telegram callback (chat_id → user) | `notif_channels_telegram_chat_idx` (partial, jsonb expression) |
| Verification (code → channel) | `notif_channels_verification_idx` |

## Notable design decisions

**Shared `deals` table, per-user `alert_matches`.** Storage-efficient — a popular deal that matches 8 coworkers' alerts is stored once. The `deals` RLS policy ("you can read it only if you have a match referencing it") means privacy is preserved.

**`alerts.channel_ids uuid[]` is array, not join table.** A user rarely has 50 channels per alert. Array column is faster to read and write.

**`notifications_sent.channel_type` is denormalized.** When a user deletes a channel, the FK goes null but the type stays so stats charts keep working.

**`pg_net.http_post` from a trigger.** Cleaner than a worker that polls for unsent matches. Caveat: requires `app.notifier_url` and `app.service_role_key` GUCs to be set on the database. See `operating.md`.

**Onboarding gate via `user_settings.onboarded_at`.** Dashboard `(app)/layout.tsx` redirects to `/setup` until that timestamp is set. Lets users re-run onboarding if they want by clearing it manually.
