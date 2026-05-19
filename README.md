# Slickdeals Alerts

A faster, more reliable replacement for Slickdeals' built-in deal-alert system.
Polls arbitrary saved-search RSS feeds, deduplicates matches, and pushes notifications
to **whichever services you (or your coworkers) prefer** — Telegram, SMS, ntfy.sh,
Pushover, Discord webhooks, email, or a generic webhook for anything else.

---

## What you've got

Everything is built and ready to deploy. The code is structured so that the
configuration steps below are the only manual work left.

```
slickdeals-alerts/
├── apps/
│   ├── poller/        Node always-on poller for Fly.io
│   └── dashboard/     Next.js 15 dashboard for Vercel
├── packages/
│   └── shared/        Types + RSS parser shared between poller & dashboard
├── supabase/
│   ├── migrations/    SQL schema + RLS + triggers + indexes
│   └── functions/     Deno edge functions (notifier, channel-verify, telegram-webhook, send-test)
├── docs/              architecture / data-model / getting-started / self-hosting / operating / troubleshooting
├── scripts/           bootstrap.{sh,ps1}, dev.sh, gen-types.sh
└── .github/workflows/ ci, deploy-poller, deploy-functions, db-migrate
```

For the deep dive, read `docs/architecture.md` (or the one-pager in `ARCHITECTURE.md`).

---

## ✅ ✅ ✅  Manual setup checklist  ✅ ✅ ✅

Work through this top-to-bottom. Each box is something *you* have to do because
it requires creating an account, generating a secret, or registering a webhook.

### 0. Local prerequisites

Install these once on your machine:

- [ ] Node 20+: <https://nodejs.org>
- [ ] pnpm 9+: `npm install -g pnpm`
- [ ] Supabase CLI: <https://supabase.com/docs/guides/cli>
- [ ] Fly.io CLI (`flyctl`): <https://fly.io/docs/hands-on/install-flyctl/>
- [ ] Vercel CLI: `npm install -g vercel`
- [ ] GitHub CLI (`gh`) — optional but handy: <https://cli.github.com>
- [ ] `openssl` (for generating random secrets — comes with Git Bash on Windows)

Then in this directory: `pnpm install`.

---

### 1. Create the GitHub repo (private)

- [ ] `gh repo create slickdeals-alerts --private --source . --remote origin`
- [ ] `git add . && git commit -m "Initial commit" && git push -u origin main`
- [ ] In repo settings → Collaborators, invite your coworkers.

---

### 2. Create the Supabase project

- [ ] Go to <https://supabase.com/dashboard> and click **New project**.
- [ ] Pick a region close to your users. Save the **project ref** (in the URL, e.g. `abcd1234`) and the **DB password** somewhere safe.
- [ ] Note from Settings → API:
  - `Project URL` → this is `SUPABASE_URL`
  - `anon` `public` key → `SUPABASE_ANON_KEY`
  - `service_role` `secret` key → `SUPABASE_SERVICE_ROLE_KEY` (treat like a password)

---

### 3. Link the Supabase CLI and push the schema

- [ ] `supabase link --project-ref YOUR_REF --password 'YOUR_DB_PASSWORD'`
- [ ] `supabase db push --password 'YOUR_DB_PASSWORD'`

This applies the four migrations in `supabase/migrations/`. You should see them succeed in order.

---

### 4. Create the Telegram bot

(Even if you don't personally want Telegram, your coworkers might — and it's the smoothest UX.)

- [ ] Open Telegram, message **[@BotFather](https://t.me/BotFather)**.
- [ ] Send `/newbot`. Pick a name (e.g. *Slickdeals Alerts*) and a username ending in `Bot` (e.g. `SlickdealsAlertsBot`).
- [ ] BotFather replies with a **token** like `123456:ABC-DEF...`. **Save it.**
- [ ] Note the bot's **username** without `@`.

Generate a webhook secret:

- [ ] `openssl rand -hex 32`  → save the output as `TELEGRAM_WEBHOOK_SECRET`.

---

### 5. (Optional) Sign up for the optional notification services

You only need the ones you (and any coworkers) want to use. Skip anything you don't want.

- [ ] **Twilio** (SMS): <https://www.twilio.com> → free trial gives you a test number. Note `Account SID`, `Auth Token`, and the trial phone number.
- [ ] **Pushover**: <https://pushover.net> → buy the app ($5 one-time), get an `App Token` by registering a new application.
- [ ] **Resend** (Email): <https://resend.com> → create an API key. Verify a sending domain (or use their default for testing).
- [ ] **ntfy.sh**: nothing to sign up for — coworkers each pick their own random topic. Install the [ntfy app](https://ntfy.sh/app) for testing.
- [ ] **Discord**: per-channel webhook URL is configured by each user on their end.

---

### 6. Set Supabase function secrets

These are env vars the edge functions read. Set whichever apply:

```bash
supabase secrets set \
  TELEGRAM_BOT_TOKEN="123456:ABC..." \
  TELEGRAM_BOT_USERNAME="SlickdealsAlertsBot" \
  TELEGRAM_WEBHOOK_SECRET="<from step 4>" \
  --project-ref YOUR_REF
```

Optional channels:

```bash
# SMS
supabase secrets set TWILIO_ACCOUNT_SID=AC... TWILIO_AUTH_TOKEN=... TWILIO_FROM_NUMBER=+15551234567 --project-ref YOUR_REF
# Pushover
supabase secrets set PUSHOVER_APP_TOKEN=a... --project-ref YOUR_REF
# Email via Resend
supabase secrets set RESEND_API_KEY=re_... EMAIL_FROM_ADDRESS=alerts@yourdomain.com --project-ref YOUR_REF
```

- [ ] Confirm with `supabase secrets list --project-ref YOUR_REF`.

---

### 7. Deploy the edge functions

```bash
supabase functions deploy notifier         --project-ref YOUR_REF --no-verify-jwt
supabase functions deploy telegram-webhook --project-ref YOUR_REF --no-verify-jwt
supabase functions deploy channel-verify   --project-ref YOUR_REF --no-verify-jwt
supabase functions deploy send-test        --project-ref YOUR_REF --no-verify-jwt
```

- [ ] All four print "Deployed function ..."

---

### 8. Wire the Postgres → notifier trigger 🚨

This is the most-missed step. Without it, matches will land in the DB but nothing will get pushed.

Open the Supabase SQL editor (Dashboard → SQL → New query) and run:

```sql
alter database postgres
  set "app.notifier_url" to 'https://YOUR_REF.functions.supabase.co/notifier';

alter database postgres
  set "app.service_role_key" to 'YOUR_SERVICE_ROLE_KEY';

select pg_reload_conf();
```

- [ ] Replace `YOUR_REF` with your project ref.
- [ ] Replace `YOUR_SERVICE_ROLE_KEY` with the `service_role` key from Settings → API.
- [ ] Run it. You should see `pg_reload_conf` return `true`.

---

### 9. Register the Telegram webhook 🚨

Tell Telegram where to send updates:

```bash
curl -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -d "url=https://YOUR_REF.functions.supabase.co/telegram-webhook?secret=${TELEGRAM_WEBHOOK_SECRET}"
```

- [ ] You should see `{"ok":true,"result":true,"description":"Webhook was set"}`.
- [ ] Verify with `curl "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo"` — it should show the URL you registered.

---

### 10. Deploy the poller to Fly.io

```bash
cd apps/poller
fly launch --no-deploy
# - App name: slickdeals-alerts-poller (or your choice; reflect in fly.toml)
# - Region: closest to you (already 'sea' in fly.toml; change if desired)
# - Don't deploy yet (we need secrets first)

fly secrets set \
  SUPABASE_URL="https://YOUR_REF.supabase.co" \
  SUPABASE_SERVICE_ROLE_KEY="YOUR_SERVICE_ROLE_KEY"

fly deploy
```

- [ ] `fly status` shows machine state `started`.
- [ ] `fly logs` shows the periodic `polled` JSON lines (or `no enabled alerts` until you create one).

---

### 11. Deploy the dashboard to Vercel

```bash
cd apps/dashboard
vercel link            # follow prompts; create a new project
```

In Vercel dashboard → Project → Settings → Environment Variables, add (all "Production" scope):

| Name | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://YOUR_REF.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the `anon` key from step 2 |
| `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` | the bot username from step 4 (no `@`) |
| `NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN` | `slickdeals.net` (or leave unset to allow any) |

Then:

```bash
vercel --prod
```

- [ ] Note the production URL Vercel prints.

---

### 12. Tell Supabase about your dashboard URL 🚨

This is what makes magic-link sign-in work.

Supabase Dashboard → Authentication → URL Configuration:

- [ ] **Site URL:** `https://<your-vercel-domain>`
- [ ] **Redirect URLs (Add URL):** `https://<your-vercel-domain>/auth/callback`

---

### 13. Sign in and onboard yourself

- [ ] Open your Vercel URL.
- [ ] Enter your email, click the magic link.
- [ ] Follow the **setup wizard**: pick channel(s), connect them, add one test alert.
- [ ] Wait a minute. You should see the test alert poll in `fly logs`.

---

### 14. (Optional) Wire up GitHub Actions

The workflows in `.github/workflows/` auto-deploy poller & functions on push to `main`. Add these repo secrets (`gh secret set NAME` or via GitHub UI):

- [ ] `FLY_API_TOKEN` — `fly tokens create deploy`
- [ ] `SUPABASE_ACCESS_TOKEN` — <https://supabase.com/dashboard/account/tokens>
- [ ] `SUPABASE_PROJECT_REF` — your project ref
- [ ] `SUPABASE_DB_PASSWORD` — the one from step 2

(Vercel auto-deploys from `main` once linked.)

---

### 15. Invite coworkers

- [ ] Share your dashboard URL.
- [ ] Tell them to read `docs/getting-started.md`.
- [ ] Repo collaborator access is separate from dashboard signup — they don't need the repo unless they're contributing.

---

## ⚠️ Common gotchas

- **Matches appear in the dashboard feed but no notification fires** → step 8 is misconfigured. The `app.notifier_url` GUC must include the full `https://...functions.supabase.co/notifier` URL, and `app.service_role_key` must exactly match the actual key.
- **Telegram bot doesn't reply to `/start`** → step 9 didn't run, or the secret has a typo. Re-run `setWebhook`.
- **SMS verification never arrives** → phone number must be E.164 (`+15551234567`). Twilio trial accounts can only SMS *verified* numbers; verify yours in the Twilio console first.
- **Sign-in link returns to an error page** → step 12 not done. Add the callback URL to the Supabase allow-list.
- **Polling appears to be running but no matches** → the RSS URL is wrong, or every item already exists in `deals`. Use the **Test fetch** button on the alert edit page to confirm the URL parses.

---

## What's where (quick reference)

| If you need to... | Look in |
|---|---|
| Add a new notification service (Slack, Matrix, push to my Tesla, etc.) | `supabase/functions/_shared/providers/` — drop in a new file, add to `index.ts`, add a `ProviderMeta` to `packages/shared/src/providers.ts` |
| Change the polling cadence | `apps/poller/fly.toml` → `POLL_INTERVAL_SECONDS` |
| Change the schema | Add a new file under `supabase/migrations/`, then run the **DB migrate (manual)** GitHub Action |
| Tune notification copy | `supabase/functions/notifier/index.ts` (`buildBody`) |
| Add a dashboard page | `apps/dashboard/app/(app)/<route>/page.tsx` |
| Look at recent failures | Dashboard `/stats` page + Supabase Functions logs + `fly logs` for the poller |

---

## Running locally

```bash
cp .env.example .env
pnpm install
supabase start                # local Postgres + Studio at :54323
pnpm dev:dashboard            # http://localhost:3000
pnpm dev:poller               # in another shell
```

Local Supabase auto-creates the schema from `supabase/migrations/`. The local
edge functions can be served with `pnpm fns:serve`.

---

## License

Private — internal use only. No license granted.

---

## Further reading

- [`docs/architecture.md`](docs/architecture.md) — diagrams + design decisions
- [`docs/data-model.md`](docs/data-model.md) — tables, indexes, RLS
- [`docs/getting-started.md`](docs/getting-started.md) — share this link with coworkers
- [`docs/self-hosting.md`](docs/self-hosting.md) — for coworkers who want their own stack
- [`docs/operating.md`](docs/operating.md) — for you (the host) once things are running
- [`docs/troubleshooting.md`](docs/troubleshooting.md) — user-facing FAQ
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — workflow for code changes
