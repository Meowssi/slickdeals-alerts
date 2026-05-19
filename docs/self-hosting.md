# Self-hosting

For coworkers who'd rather run their own stack instead of using the shared instance.

> ⏱️ Total time: ~45 minutes including account signups. Most of it is waiting for free-tier provisioning.

## Prerequisites

Install these once:

| Tool | Purpose | Install |
|---|---|---|
| Node 20+ | Runtime | https://nodejs.org |
| pnpm 9+ | Package manager | `npm install -g pnpm` |
| Supabase CLI | DB + edge functions | https://supabase.com/docs/guides/cli |
| Fly CLI (`flyctl`) | Poller deploy | https://fly.io/docs/hands-on/install-flyctl/ |
| Vercel CLI | Dashboard deploy | `npm install -g vercel` |
| GitHub CLI (`gh`) | Optional, for secrets | https://cli.github.com |

## Accounts you'll need

| Service | Purpose | Free tier covers |
|---|---|---|
| **GitHub** | Code host | Always free for private repos |
| **Supabase** | DB + auth + edge functions | 500MB DB, 50K MAU, 500K function invocations/mo |
| **Fly.io** | Poller runtime | 3× shared-cpu-1x machines |
| **Vercel** | Dashboard | Hobby plan free |
| **Telegram BotFather** | Bot token | Always free |
| **ntfy.sh** | Push delivery | Free; self-hostable |
| **Twilio** | (Optional) SMS | $0.008/msg, free trial credit |
| **Pushover** | (Optional) Premium push | $5 one-time |
| **Resend** | (Optional) Email | 3,000 emails/mo free |

## Step-by-step

### 1. Clone & install

```bash
gh repo clone YOUR_USER/slickdeals-alerts
cd slickdeals-alerts
pnpm install
```

### 2. Create a Supabase project

1. https://supabase.com/dashboard → New project.
2. Save the project ref (in the URL) and DB password somewhere safe.
3. Link the CLI:
   ```bash
   supabase link --project-ref YOUR_REF --password 'YOUR_DB_PASSWORD'
   ```

### 3. Push the schema

```bash
supabase db push --password 'YOUR_DB_PASSWORD'
```

This applies the four migrations under `supabase/migrations/`.

### 4. Create the Telegram bot

1. Open Telegram, message **@BotFather**.
2. Send `/newbot`. Pick a name and username (must end in `Bot`).
3. Save the token. Note the username (without leading `@`).

### 5. Set Supabase function secrets

```bash
supabase secrets set \
  TELEGRAM_BOT_TOKEN="123:ABC" \
  TELEGRAM_BOT_USERNAME="YourBotName" \
  TELEGRAM_WEBHOOK_SECRET="$(openssl rand -hex 32)" \
  --project-ref YOUR_REF
```

For each optional channel you want to enable, also set:

| Channel | Secrets |
|---|---|
| SMS | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` |
| Pushover | `PUSHOVER_APP_TOKEN` |
| Email | `RESEND_API_KEY`, `EMAIL_FROM_ADDRESS` |
| Self-hosted ntfy | `NTFY_BASE_URL` |

### 6. Deploy edge functions

```bash
supabase functions deploy notifier         --project-ref YOUR_REF --no-verify-jwt
supabase functions deploy telegram-webhook --project-ref YOUR_REF --no-verify-jwt
supabase functions deploy channel-verify   --project-ref YOUR_REF --no-verify-jwt
supabase functions deploy send-test        --project-ref YOUR_REF --no-verify-jwt
```

### 7. Configure the notifier trigger

Open the Supabase SQL editor and run:

```sql
alter database postgres
  set "app.notifier_url" to 'https://YOUR_REF.functions.supabase.co/notifier';

alter database postgres
  set "app.service_role_key" to 'YOUR_SERVICE_ROLE_KEY';

select pg_reload_conf();
```

Find your service role key at Supabase → Settings → API → `service_role`.

### 8. Register the Telegram webhook

```bash
SECRET="<the TELEGRAM_WEBHOOK_SECRET you generated>"
TOKEN="<your bot token>"
curl -X POST "https://api.telegram.org/bot${TOKEN}/setWebhook" \
  -d "url=https://YOUR_REF.functions.supabase.co/telegram-webhook?secret=${SECRET}"
```

Confirm with `getWebhookInfo`.

### 9. Deploy the poller to Fly

```bash
cd apps/poller
fly launch --no-deploy
# accept defaults; this creates fly.toml entries

fly secrets set \
  SUPABASE_URL="https://YOUR_REF.supabase.co" \
  SUPABASE_SERVICE_ROLE_KEY="YOUR_SERVICE_ROLE_KEY"

fly deploy
fly status     # confirm machine is running
fly logs       # tail logs
```

### 10. Deploy the dashboard to Vercel

```bash
cd ../dashboard
vercel link
vercel env add NEXT_PUBLIC_SUPABASE_URL              production
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY         production
vercel env add NEXT_PUBLIC_TELEGRAM_BOT_USERNAME     production
# Optional:
vercel env add NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN      production
vercel --prod
```

In Supabase → Authentication → URL Configuration:
- **Site URL:** `https://<your-vercel-domain>`
- **Redirect URLs:** `https://<your-vercel-domain>/auth/callback`

### 11. Sign in and test

1. Visit your Vercel URL.
2. Sign in with email.
3. Follow the onboarding wizard.
4. Add one alert. Wait for a match. Confirm your phone buzzes.

## CI/CD (optional but nice)

Add these GitHub repo secrets so the workflows in `.github/workflows/` work:

| Secret | Where to find |
|---|---|
| `FLY_API_TOKEN` | `fly tokens create deploy` |
| `SUPABASE_ACCESS_TOKEN` | https://supabase.com/dashboard/account/tokens |
| `SUPABASE_PROJECT_REF` | Your project ref |
| `SUPABASE_DB_PASSWORD` | The one you set at project creation |

Vercel auto-deploys from `main` once the repo is linked.

## Updating

```bash
git pull
pnpm install
supabase db push                    # if there are new migrations
pnpm fns:deploy                     # if functions changed
cd apps/poller && fly deploy        # if poller changed
# dashboard auto-deploys via Vercel
```
