# Operating

For the person running the shared instance. Not user-facing.

## One-time post-deploy SQL

After your edge functions are deployed, you must tell Postgres how to reach the notifier. Run this in the Supabase SQL editor (replace placeholders):

```sql
-- The URL the trigger POSTs to. Format: https://<ref>.functions.supabase.co/notifier
alter database postgres
  set "app.notifier_url" to 'https://YOUR_REF.functions.supabase.co/notifier';

-- The service role key that the notifier checks for in the Authorization header.
alter database postgres
  set "app.service_role_key" to 'eyJ...';

-- Reload so all sessions pick up the new GUCs.
select pg_reload_conf();
```

To verify it works:
```sql
-- Insert a fake match (don't do this on a live user) and watch the
-- pg_net.http_response table or the notifier function logs.
```

## Setting Supabase function secrets

Edge functions read secrets from project-level env vars. Set them once:

```bash
supabase secrets set \
  TELEGRAM_BOT_TOKEN="123456:ABC-..." \
  TELEGRAM_BOT_USERNAME="SlickdealsAlertsBot" \
  TELEGRAM_WEBHOOK_SECRET="$(openssl rand -hex 32)" \
  TWILIO_ACCOUNT_SID="AC..." \
  TWILIO_AUTH_TOKEN="..." \
  TWILIO_FROM_NUMBER="+15551234567" \
  PUSHOVER_APP_TOKEN="a..." \
  RESEND_API_KEY="re_..." \
  EMAIL_FROM_ADDRESS="alerts@your-domain.com" \
  --project-ref YOUR_REF
```

You can also set per-function secrets in the Supabase dashboard.

## Registering the Telegram webhook

After deploying `telegram-webhook`:

```bash
SECRET="$(supabase secrets list --project-ref YOUR_REF | grep TELEGRAM_WEBHOOK_SECRET | awk '{print $2}')"
curl -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -d "url=https://YOUR_REF.functions.supabase.co/telegram-webhook?secret=${SECRET}"
```

Verify with `getWebhookInfo`:
```bash
curl "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo"
```

## Health checks

| Signal | Where |
|---|---|
| Poller alive | `fly status` + `/healthz` returns 200 |
| Recent polls succeeding | Dashboard `/stats` "Alert health" table |
| Notifications firing | Dashboard `/stats` 24h count + error rate |
| pg_net trigger firing | `select * from net._http_response order by created desc limit 20;` |
| Edge function errors | Supabase dashboard → Functions → Logs |

## Routine maintenance

- **Rotating bot token:** `supabase secrets set TELEGRAM_BOT_TOKEN=...`, then re-register webhook with the new token (Telegram caches nothing).
- **Rotating service role key:** rotate via Supabase dashboard, set the new GUC: `alter database postgres set "app.service_role_key" to '<new>';`. Old in-flight notifier calls will 401 once and recover.
- **Bumping poll cadence:** edit `apps/poller/fly.toml` env section, redeploy.
- **Draining a noisy alert:** set `alerts.enabled = false` for that row.
- **Banning a user:** delete from `auth.users` — cascades to all their data via FK ON DELETE CASCADE.

## When things go wrong

- **Matches appear in feed but no notifications:** the trigger fired but the notifier rejected the call. Likely `app.service_role_key` doesn't match the actual key. Reset both GUCs.
- **No matches at all:** poller can't reach Supabase. Check `fly logs apps/poller` for connection errors.
- **`pg_net` extension not enabled:** rerun migration `20260518000000_init.sql` or `create extension pg_net with schema extensions;` manually.
- **Telegram bot doesn't reply:** webhook isn't registered or secret mismatches. Check `getWebhookInfo`.
- **SMS verification fails:** `TWILIO_*` env vars missing or phone number not in E.164 format.
