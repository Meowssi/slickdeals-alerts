# Self-hosting

Stand up your own copy of Slickdeals Alerts. Designed for **zero local CLIs** — everything runs in browsers, GitHub Actions, and remote APIs. You don't install Node, Supabase CLI, flyctl, or vercel locally unless you want to.

> ⏱️ **Total time:** ~10-15 min via the 1-click path, or ~45-60 min via the manual path below.
> 💵 **Cost:** $0/month on free tiers for small workloads. Optional channels (Pushover, Twilio, Resend) add their own costs only if you enable them.

---

## 🚀 Fast path (1-click)

This is the recommended path for most people:

1. Click **[Deploy with Vercel](../README.md#-1-click-deploy)** in the README.
2. Vercel walks you through the Supabase integration — it provisions a fresh Supabase project for you and auto-fills `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, etc.
3. Paste **one** env var: `ADMIN_EMAILS` (your email, comma-separated for multiple admins).
4. Vercel deploys (~2 min).
5. **Open `https://<your-vercel-domain>/admin/setup`** — the wizard's "Live checks" section shows what's still missing. Run each form in order. The wizard handles vault setup, edge function deploy, auth redirect URLs, Telegram bot wiring, optional channels — everything.

After this you can skip the rest of this doc. The remaining sections are the manual fallback if the button fails, or if you want full control.

To unlock the wizard's workflow-trigger actions (`Apply migrations`, `Redeploy edge functions`), also set these env vars in Vercel:
- `SUPABASE_ACCESS_TOKEN` — [generate one](https://supabase.com/dashboard/account/tokens)
- `GITHUB_TOKEN` — a GitHub personal access token with `repo + workflow` scopes
- `GITHUB_REPO` — `<your-username>/slickdeals-alerts`

These are optional but recommended.

---

## What you'll have at the end

- A Supabase project (Postgres + auth + 4 edge functions)
- A Telegram bot that pushes deal notifications (and/or any other channel you pick)
- A Fly.io machine polling Slickdeals RSS every minute
- A Vercel-hosted Next.js dashboard your users sign in to
- A `/admin/setup` health page that tells you what's wired and what's not

---

## Table of contents

- [Prereqs](#prereqs)
- [Phase 1 — Supabase project](#phase-1--supabase-project)
- [Phase 2 — Fork & GitHub secrets](#phase-2--fork--github-secrets)
- [Phase 3 — Notification channels](#phase-3--notification-channels)
  - [Telegram](#telegram-recommended) (recommended)
  - [SMS via Twilio](#sms-via-twilio)
  - [Pushover](#pushover)
  - [ntfy.sh](#ntfysh)
  - [Discord](#discord)
  - [Email via Resend](#email-via-resend)
  - [Generic webhook](#generic-webhook)
- [Phase 4 — Poller on Fly.io](#phase-4--poller-on-flyio)
- [Phase 5 — Dashboard on Vercel](#phase-5--dashboard-on-vercel)
- [Phase 6 — Connect everything](#phase-6--connect-everything)
- [Verify with the setup page](#verify-with-the-setup-page)
- [Add your first alert](#add-your-first-alert)
- [Invite users](#invite-users)
- [Troubleshooting](#troubleshooting)
- [Updating](#updating)
- [Advanced: local dev for contributors](#advanced-local-dev-for-contributors)

---

## Prereqs

Just accounts. No software to install (`curl` is built into Windows 10+, macOS, and every Linux).

| Service | Required for | Free tier |
|---|---|---|
| **[GitHub](https://github.com)** | Code + CI | Always free |
| **[Supabase](https://supabase.com)** | DB + auth + edge functions | 500 MB DB, 50k MAU, 500k function invocations/mo |
| **[Fly.io](https://fly.io)** | Poller runtime | 3× shared-cpu-1x machines |
| **[Vercel](https://vercel.com)** | Dashboard | Hobby plan free |
| **[Telegram](https://telegram.org)** | (Most popular channel) | Always free |

Optional channels — sign up only for the ones you want:
[Twilio](https://www.twilio.com) (SMS), [Pushover](https://pushover.net) ($5 one-time), [Resend](https://resend.com) (email).

---

## Phase 1 — Supabase project

### 1.1 Create the project

1. Open [supabase.com/dashboard](https://supabase.com/dashboard) → **New project**.
2. Fill out:
   - **Organization**: any (free tier is fine)
   - **Project name**: `slickdeals-alerts` (anything, but match this for clarity)
   - **GitHub (optional)**: **skip** — we use GitHub Actions for migrations, not Supabase's GitHub integration
   - **Database password**: click **Generate a password**. **Save it** — you'll paste it into a GitHub secret in Phase 2.
   - **Region**: pick closest to your users. (We'll co-locate Fly in the same region.)
   - **Security**:
     - ✓ Enable Data API
     - ✓ Automatically expose new tables
     - ☐ Enable automatic RLS *(leave OFF — our migrations enable RLS per-table)*
3. Click **Create new project** and wait ~2 min for provisioning.

### 1.2 Capture your keys

Once provisioning finishes, grab these from **Settings → API**:

| Label in dashboard | Save as |
|---|---|
| Project URL (`https://xxx.supabase.co`) | `SUPABASE_URL` |
| Project ref (the `xxx` part of the URL) | `SUPABASE_PROJECT_REF` |
| `anon` `public` (legacy JWT) — OR — the new `sb_publishable_…` key | `SUPABASE_ANON_KEY` *(or publishable equivalent — supabase-js accepts either)* |
| `service_role` `secret` (legacy JWT) | `SUPABASE_SERVICE_ROLE_KEY` *(treat like a password)* |

And generate a personal-access token at [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens) → **Generate new token** → save as `SUPABASE_ACCESS_TOKEN`.

### 1.3 Apply the database migrations

You have two ways. Pick one.

#### Option A — GitHub Action *(zero clicks once Phase 2 is done; pick this)*
Skip ahead to [Phase 2](#phase-2--fork--github-secrets), then come back and trigger the `db-migrate.yml` workflow as instructed there.

#### Option B — Web SQL editor *(if you want to verify the schema before automation)*
1. Supabase Dashboard → **SQL Editor** → **New query**.
2. For each file in `supabase/migrations/` (in filename order), paste its contents and **Run**.
3. Confirm in **Table Editor** that you see: `alerts`, `alert_matches`, `deals`, `deal_state`, `notification_channels`, `notifications_sent`, `user_settings`.

### 1.4 Populate the vault secrets

The notifier trigger reads `notifier_url` and `service_role_key` from Supabase Vault. Run this in **SQL Editor** (substitute your values):

```sql
select vault.create_secret(
  'https://YOUR_REF.functions.supabase.co/notifier',
  'notifier_url'
);

select vault.create_secret(
  'YOUR_SERVICE_ROLE_KEY',
  'service_role_key'
);

-- Verify
select name, length(decrypted_secret) as len
from vault.decrypted_secrets order by name;
```

You should see two rows: `notifier_url` (≈ 60 chars) and `service_role_key` (≈ 220 chars).

> 💡 **Why not `ALTER DATABASE ... SET app.*`?** Managed Supabase Postgres blocks non-superusers from setting custom GUCs. The vault approach works for any project and is the official recommendation.

---

## Phase 2 — Fork & GitHub secrets

### 2.1 Fork the repo

1. Visit [github.com/Meowssi/slickdeals-alerts](https://github.com/Meowssi/slickdeals-alerts) → **Fork** *(or, if you have access to the original repo, just clone-and-push your own private copy).*
2. In your fork → **Settings → Collaborators**, invite anyone who needs to contribute.

### 2.2 Set repo secrets

GitHub → your fork → **Settings → Secrets and variables → Actions → New repository secret**. Add all four:

| Name | Value |
|---|---|
| `SUPABASE_PROJECT_REF` | from Phase 1.2 |
| `SUPABASE_ACCESS_TOKEN` | from Phase 1.2 |
| `SUPABASE_DB_PASSWORD` | from Phase 1.1 |
| `FLY_API_TOKEN` | *deferred to Phase 4 — leave blank for now* |

> 💻 **Prefer the gh CLI?** `gh secret set NAME --repo YOUR_USER/slickdeals-alerts` lets you paste the value into the prompt. Same effect.

### 2.3 Trigger the initial deploys

Visit your fork's **Actions** tab:

1. **Apply migrations** — pick *DB migrate (manual)* → **Run workflow** → type `yes` in the confirm box → **Run**. Wait until green (≈ 30 s). *(Skip if you did Phase 1.3 Option B.)*
2. **Deploy edge functions** — push any commit to `main`, OR pick *Deploy edge functions* → **Run workflow** → **Run**. This deploys `notifier`, `telegram-webhook`, `channel-verify`, `send-test`.

You can verify in Supabase Dashboard → **Edge Functions**: all four show **ACTIVE**.

---

## Phase 3 — Notification channels

Pick **one or more**. You can come back and add channels later. Each subsection ends with the **Supabase function secret(s)** you need to set; those go in Supabase Dashboard → **Project Settings → Edge Functions → Secrets → Add new secret**.

### Telegram (recommended)

Best UX: free, fast, supports inline "Save / Dismiss" buttons.

**3.T.1 — Create the bot**
1. In Telegram, open chat with [@BotFather](https://t.me/BotFather).
2. Send `/newbot`. Pick:
   - A **display name** (e.g. `Slickdeals Alerts`).
   - A **username** ending in `bot` (e.g. `slickdeals_alerts_meowssi_bot`). Must be globally unique.
3. BotFather replies with a **token** like `123456789:AAH...`. Save it.

Optional polish (run anytime, any order):
- `/setdescription` — short bio shown when users first open the bot.
- `/setuserpic` — bot avatar.

**3.T.2 — Set the function secrets**

In Supabase → Edge Functions → Secrets:

| Name | Value |
|---|---|
| `TELEGRAM_BOT_TOKEN` | `123456789:AAH...` |
| `TELEGRAM_BOT_USERNAME` | the username without `@` |
| `TELEGRAM_WEBHOOK_SECRET` | a random string (paste output of any password generator, or use SQL: `select encode(gen_random_bytes(32), 'hex');`) |

**3.T.3 — Register the webhook**

Run in any terminal that has `curl` (Windows 10+: built-in to PowerShell):

```sh
TOKEN="123456789:AAH..."
SECRET="<the TELEGRAM_WEBHOOK_SECRET from 3.T.2>"
REF="<your Supabase project ref>"
curl -X POST "https://api.telegram.org/bot${TOKEN}/setWebhook" \
  -d "url=https://${REF}.functions.supabase.co/telegram-webhook?secret=${SECRET}"
```

Expect `{"ok":true,"result":true,...}`. Verify with:

```sh
curl "https://api.telegram.org/bot${TOKEN}/getWebhookInfo"
```

→ should show your URL.

### SMS via Twilio

Reliable, paid (~$0.008/msg).

1. Sign up at [twilio.com](https://www.twilio.com). Free trial gives credit + a test number.
2. From the Twilio console **Account Dashboard**, note: **Account SID**, **Auth Token**, and the **trial phone number** (E.164 format like `+15551234567`).
3. *Trial accounts can only SMS verified numbers.* Verify your phone in Twilio → **Phone Numbers → Verified Caller IDs**.

In Supabase function secrets:

| Name | Value |
|---|---|
| `TWILIO_ACCOUNT_SID` | `AC...` |
| `TWILIO_AUTH_TOKEN` | from Twilio |
| `TWILIO_FROM_NUMBER` | `+15551234567` |

#### A2P 10DLC campaign registration (required for US numbers)

US carriers require every app-to-person SMS sender to register a **brand** and a **campaign** (A2P 10DLC) through Twilio. Until the campaign is **approved**, texts to US numbers are filtered or blocked. For a personal deployment, register a **Sole Proprietor** brand — no EIN or business entity needed, lowest cost, and it fits the "alerts to my own phone" use case.

> ⚠️ **Before you submit, open `https://<your-domain>/sms-opt-in` in a logged-out (incognito) browser** and confirm the consent form actually renders. That URL is your **Call-to-Action (CTA)** — the reviewer visits it to verify how people opt in. A blank or erroring page is rejected with **Error 30909 (CTA could not be verified)**, the single most common A2P rejection. This dashboard ships `/sms-opt-in`, `/privacy`, and `/terms` for exactly this purpose; just confirm all three load on *your* domain first.

Twilio Console → **Messaging → Regulatory Compliance → A2P 10DLC** (older accounts: **Messaging → Compliance**). Suggested field values:

| Field | What to enter |
|---|---|
| Campaign description | `Personal Slickdeals deal alerts sent to my own phone via a self-hosted dashboard.` |
| Sample message 1 | `[Slickdeals Alerts] $9.99 – 50ft Cat6 Cable @ Best Buy. slickdeals.net/f/12345` |
| Sample message 2 | `[Slickdeals Alerts] $42 – Anker 65W USB-C @ Amazon. slickdeals.net/f/67890` |
| Message contents | Check **Embedded links** (messages carry `slickdeals.net` links). Leave *phone numbers*, *age-gated*, and *direct lending* unchecked. |
| Privacy policy URL | `https://<your-domain>/privacy` |
| Terms of service URL | `https://<your-domain>/terms` |
| Opt-in keywords | *Leave blank* — consent is collected on the web form, not via a keyword. |
| Opt-in / confirmation message | `Slickdeals Alerts: You're now subscribed to deal alerts. Reply HELP for help, STOP to opt out. Msg & data rates may apply.` |
| Opt-out keywords | `STOP,STOPALL,UNSUBSCRIBE,CANCEL,END,QUIT,OPTOUT,REVOKE` |
| Opt-out message | `You have been unsubscribed and will receive no further messages. Reply START to resubscribe.` |
| Help keywords | `HELP,INFO` |
| Help message | `Slickdeals Alerts: deal notifications for your saved searches. Reply STOP to unsubscribe. Msg & data rates may apply.` |

**The field that gets flagged (the "CTA"):** there is no field literally labeled "CTA." It maps to the **"How do end-users consent to receive messages?"** box. Paste a description that *names the opt-in URL* so the reviewer can reach it:

> End users opt in on the public web form at https://<your-domain>/sms-opt-in. The form requires the user to (1) enter their own mobile number and (2) actively check an unchecked consent checkbox agreeing to receive automated SMS deal alerts about deals matching their saved Slickdeals searches. The page discloses that message frequency varies, that message & data rates may apply, how to reply HELP or STOP, and links to the Terms of Service and Privacy Policy. This is a single-operator, personal-use deployment — the only recipient is the person who deployed and operates the instance. Numbers are never purchased, shared, or sold.

A Sole Proprietor campaign is capped at a low daily message volume (plenty for personal alerts). After approval, point your Twilio number (or Messaging Service) at this campaign so outbound texts send under it.

### Pushover

Premium push, $5 one-time per device.

1. Buy and install the [Pushover app](https://pushover.net). Note your **User Key** (each user has their own).
2. Pushover Dashboard → **Create an Application/API Token** → name it *Slickdeals Alerts* → grab the **API Token**.

In Supabase function secrets:

| Name | Value |
|---|---|
| `PUSHOVER_APP_TOKEN` | the API token |

(End users paste their own user key into the dashboard when they add the channel.)

### ntfy.sh

Free, open-source, no signup. End users each pick their own random topic (e.g. `slickalerts-abc12def`) and subscribe in the [ntfy app](https://ntfy.sh/app).

No global secrets needed — works out of the box.

### Discord

Per-channel webhook. End users paste a Discord webhook URL when they add the channel.

No global secrets needed.

### Email via Resend

3,000 emails/month free.

1. Sign up at [resend.com](https://resend.com) → create an API key.
2. Verify a sending domain (or use Resend's `onboarding@resend.dev` for testing — it limits delivery to your own email).

In Supabase function secrets:

| Name | Value |
|---|---|
| `RESEND_API_KEY` | `re_...` |
| `EMAIL_FROM_ADDRESS` | `alerts@yourdomain.com` (or `onboarding@resend.dev`) |

### Generic webhook

Wire up to Zapier, IFTTT, Apple Shortcuts, home automation, etc. End users paste their own webhook URL when they add the channel.

No global secrets needed.

---

## Phase 4 — Poller on Fly.io

### 4.1 Create the Fly app via the web

1. [fly.io/dashboard](https://fly.io/dashboard) → **Launch a new app**.
2. **Connect to GitHub** → pick your fork → select `apps/poller/` as the working directory.
3. App name: `slickdeals-alerts-poller-<your-tag>` (must be globally unique). Region: same as Supabase if possible.
4. **Do not deploy yet** — we need secrets first.

> 🪟 **Don't want Fly's GitHub integration?** Generate a Fly API token at [fly.io/user/personal_access_tokens](https://fly.io/user/personal_access_tokens) → save as `FLY_API_TOKEN` GitHub secret → the included `deploy-poller.yml` workflow handles the deploy entirely from CI.

### 4.2 Set Fly secrets

Fly dashboard → your app → **Secrets**:

| Name | Value |
|---|---|
| `SUPABASE_URL` | `https://YOUR_REF.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | (from Phase 1.2) |

### 4.3 Deploy

Push any commit to `main` in your fork (e.g., add a line to README). The `deploy-poller.yml` workflow auto-deploys.

Verify: Fly dashboard → your app → **Monitoring** → you should see periodic `polled` log lines (or `no enabled alerts` until you create your first alert).

---

## Phase 5 — Dashboard on Vercel

### 5.1 Import your fork

1. [vercel.com/new](https://vercel.com/new) → import your GitHub fork.
2. **Root Directory**: `apps/dashboard`.
3. **Framework Preset**: Next.js (auto-detected).
4. **Environment Variables** — add all (Production scope):

| Name | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://YOUR_REF.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | from Phase 1.2 |
| `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` | from Phase 3.T.1 *(skip if not using Telegram)* |
| `NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN` | (optional) restrict sign-ups, e.g. `yourcompany.com` |
| `SUPABASE_SERVICE_ROLE_KEY` | from Phase 1.2 *(server-only — never exposed to browser)* |
| `SUPABASE_ACCESS_TOKEN` | from Phase 1.2 *(for `/admin/setup` health checks)* |
| `SUPABASE_PROJECT_REF` | from Phase 1.2 |
| `TELEGRAM_BOT_TOKEN` | from Phase 3.T.1 *(skip if not using Telegram — used only by `/admin/setup` to query webhook info)* |
| `ADMIN_EMAILS` | comma-separated emails allowed to view `/admin/setup` |

5. **Deploy**. Note the production URL Vercel prints.

---

## Phase 6 — Connect everything

### 6.1 Add the Vercel URL to Supabase auth

Without this, magic-link sign-in won't redirect properly.

Supabase Dashboard → **Authentication → URL Configuration**:

- **Site URL**: `https://<your-vercel-domain>`
- **Redirect URLs (Add URL)**: `https://<your-vercel-domain>/auth/callback`

### 6.2 Add the Telegram webhook (if not done in Phase 3.T.3)

Skip if you already registered it.

---

## Verify with the setup page

1. Visit `https://<your-vercel-domain>/admin/setup`.
2. Sign in with an email listed in `ADMIN_EMAILS`.
3. The page runs live checks against your stack:

| Check | What it confirms |
|---|---|
| DB migrations | All ≥ 6 migrations applied |
| Edge functions | `notifier`, `telegram-webhook`, `channel-verify`, `send-test` all ACTIVE |
| Vault secrets | `notifier_url` and `service_role_key` populated |
| Telegram webhook | `getWebhookInfo` returns your function URL *(only checked if `TELEGRAM_BOT_TOKEN` is set)* |
| Poller heartbeat | Poller logged activity in the last 5 min |
| Optional channels | Each channel's required Supabase function secrets are present |

Each failing check links back to the matching section of this doc.

---

## Add your first alert

1. Open [slickdeals.net](https://slickdeals.net), apply any search filters you like.
2. Click the **orange RSS icon** on the search results page. Copy the URL.
3. In your dashboard → **+ New alert** → paste the URL. Give it a name. Save.
4. Within ~1 minute of a matching deal posting, you'll get a notification on whichever channels you connected.

---

## Invite users

1. Share your Vercel dashboard URL.
2. Point them at [`docs/getting-started.md`](getting-started.md) — that's the user-facing guide.
3. They sign in with their email, pick channels, add their own alerts.
4. If you set `NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN`, only matching emails will be accepted.

---

## Troubleshooting

| Symptom | Likely fix |
|---|---|
| `/admin/setup` shows "Migrations: 0" | Phase 2.3 step 1 wasn't run. Trigger the `DB migrate (manual)` workflow. |
| `/admin/setup` shows "Functions: 0" | Phase 2.3 step 2 wasn't run. Trigger the `Deploy edge functions` workflow. |
| `/admin/setup` shows "Vault: missing" | Phase 1.4 wasn't run. Paste the SQL into the Supabase SQL Editor. |
| Matches show in the feed but no notification | Vault is missing — same as above. Notifier trigger silently no-ops without `notifier_url`. |
| Telegram `/start` doesn't respond | Webhook not registered. Re-run Phase 3.T.3 curl. Verify with `getWebhookInfo`. |
| Magic-link sign-in lands on an error page | Phase 6.1 not done. Add the callback URL to Supabase Auth allow-list. |
| Poller logs `no enabled alerts` forever | No alerts created yet, or all alerts have `enabled = false`. |
| SMS verification code never arrives | Twilio trial accounts only SMS *verified* numbers. Add yours in Twilio → Verified Caller IDs. |
| Pushover priority-2 notifications loop | That's correct — emergency priority bypasses DND and re-alerts every 60s for 30 min. Use sparingly. |

For deeper digs, see [`docs/operating.md`](operating.md) and [`docs/troubleshooting.md`](troubleshooting.md).

---

## Updating

Pull latest from upstream into your fork, then push to `main`. The workflows handle the rest:

- New `supabase/migrations/` files → run `DB migrate (manual)` workflow.
- New `supabase/functions/` code → `Deploy edge functions` workflow fires automatically on push.
- New `apps/poller/` code → `Deploy poller` workflow fires automatically on push.
- New `apps/dashboard/` code → Vercel deploys automatically on push.

---

## Advanced: local dev for contributors

You don't need any of this to operate the stack. Only contributors editing code locally.

```sh
# One-time:
npm install -g pnpm
pnpm install

# Per-shell:
pnpm dev:dashboard   # http://localhost:3000
pnpm dev:poller      # in another terminal
```

A local Supabase stack (`supabase start` from the CLI) is optional — you can also point local dev at your remote Supabase project by setting the same env vars from Phase 5.

---

## License

Private — internal use only. No license granted.
