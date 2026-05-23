# Architecture (one-page version)

For the full thing with diagrams, see [`docs/architecture.md`](docs/architecture.md).

**Goal:** a self-hosted companion to Slickdeals' saved-search RSS feeds — polls the feeds on whatever cadence you set and pushes matches to whatever notification service the user prefers (Telegram, SMS, ntfy, Discord, email, etc.).

**Pieces:**

- **Poller** (`apps/poller/`): Node loop on Fly.io. Polls each enabled `alerts` row every ~30s with ETag/If-Modified-Since. Upserts deals, inserts matches.
- **DB** (Supabase Postgres, `supabase/migrations/`): multi-tenant via RLS. `pg_net` trigger on `alert_matches` calls the notifier on insert.
- **Notifier** (`supabase/functions/notifier/`): edge function that resolves which channels the user wants for a match and fans out via the **provider registry** (`supabase/functions/_shared/providers/`).
- **Providers** (Telegram, ntfy, SMS via Twilio, Pushover, Discord webhook, Email via Resend, Generic Webhook): one file each, dropped into the registry. Adding a new one needs zero schema changes.
- **Dashboard** (`apps/dashboard/`): Next.js 15 on Vercel. Magic-link auth. Onboarding wizard walks first-time users through picking + verifying channels and adding their first alert.

**Data flow:** poller writes match → DB trigger → notifier → providers → phone. Latency end-to-end is dominated by RSS update cadence on Slickdeals' side.

**Trust:** RLS isolates users from each other. Service role bypasses RLS for poller/notifier writes. Telegram webhook validates a shared secret.
