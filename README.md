# Slickdeals Alerts

A faster, more reliable replacement for Slickdeals' built-in deal-alert system. Polls saved-search RSS feeds, deduplicates matches, and pushes notifications to **whichever services you (or your coworkers) prefer** — Telegram, SMS, ntfy.sh, Pushover, Discord, email, or generic webhooks.

---

## 🚀 1-click deploy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FMeowssi%2Fslickdeals-alerts&root-directory=apps%2Fdashboard&project-name=slickdeals-alerts&repository-name=slickdeals-alerts&demo-title=Slickdeals%20Alerts&demo-description=Self-hosted%20deal%20alerts%20replacing%20Slickdeals'%20built-in%20notifications.&env=ADMIN_EMAILS&envDescription=Comma-separated%20list%20of%20emails%20allowed%20to%20use%20the%20%2Fadmin%2Fsetup%20wizard.&envLink=https%3A%2F%2Fgithub.com%2FMeowssi%2Fslickdeals-alerts%2Fblob%2Fmain%2Fdocs%2Fself-hosting.md&integration-ids=oac_VqOgBHqhEoFTPzGkPd7L0iH6)

Click the button. Vercel will:
1. Fork the repo into your GitHub.
2. Walk you through the **Supabase integration** — it provisions a fresh Supabase project for you and auto-fills all `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, etc. env vars.
3. Prompt for **one** thing you have to paste: `ADMIN_EMAILS` (your email — gates the `/admin/setup` wizard).
4. Deploy.

**Then open `https://<your-vercel-domain>/admin/setup`** — an in-app wizard finishes everything (migrations, edge functions, Telegram bot, optional channels, Fly poller).

> ⏱️ **Total time:** ~10 min including signups. **Cost:** $0/mo on free tiers.

---

## What you get

```
slickdeals-alerts/
├── apps/
│   ├── dashboard/     Next.js 15 — user dashboard + /admin/setup wizard
│   └── poller/        Node service that polls RSS feeds (deploys to Fly.io)
├── packages/shared/   Shared types + RSS parser
├── supabase/
│   ├── migrations/    DB schema + RLS + triggers + vault wiring
│   └── functions/     Deno edge functions (notifier, telegram-webhook, ...)
├── docs/              architecture / setup / operating / troubleshooting
└── .github/workflows/ ci, deploy-poller, deploy-functions, db-migrate
```

After the 1-click deploy, the `/admin/setup` wizard handles every other config step — see [docs/self-hosting.md](docs/self-hosting.md) for the full walkthrough, or [docs/architecture.md](docs/architecture.md) for the technical design.

---

## What ships with the box

- **7 notification channels** out of the box: Telegram (with inline Save/Dismiss buttons), SMS via Twilio, Pushover, ntfy.sh, Discord, email via Resend, generic JSON webhook.
- **Per-user channel routing** — an alert can fire only to Telegram, while another fires SMS + email.
- **Quiet hours + digest mode** per user.
- **Latency telemetry** — the `/stats` page tracks RSS-publish → notification-sent latency p50/p95/p99 over 24 h.
- **Row-Level Security** — users only ever see their own alerts, matches, and stats.
- **GitHub Actions CI/CD** — push to `main`, deploys happen.

---

## After deploying

| Audience | Doc |
|---|---|
| You (the host) finishing config | [`docs/self-hosting.md`](docs/self-hosting.md) + open `/admin/setup` in your dashboard |
| Coworkers/users you invite | [`docs/getting-started.md`](docs/getting-started.md) |
| Running the system day-to-day | [`docs/operating.md`](docs/operating.md) |
| Diagnosing problems | [`docs/troubleshooting.md`](docs/troubleshooting.md) |
| Modifying the code | [`docs/architecture.md`](docs/architecture.md), [`CONTRIBUTING.md`](CONTRIBUTING.md) |

---

## Manual setup (if the 1-click button doesn't work for you)

Some scenarios where you'd skip the button:
- You already have a Supabase project you want to reuse.
- You want to deploy to a non-Vercel host.
- The Supabase integration on Vercel is having a bad day.

Full manual walkthrough: [`docs/self-hosting.md`](docs/self-hosting.md).

---

## License

Private — internal use only. No license granted.
