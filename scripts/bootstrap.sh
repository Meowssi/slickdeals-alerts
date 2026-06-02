#!/usr/bin/env bash
# =============================================================================
# bootstrap.sh — first-time setup helper (macOS / Linux)
# =============================================================================
set -euo pipefail

require() {
  command -v "$1" >/dev/null 2>&1 || { echo "ERROR: '$1' is not on PATH"; exit 1; }
}

echo "==> Checking prerequisites"
for cmd in node pnpm supabase flyctl vercel gh; do require "$cmd"; done

echo "==> Installing dependencies"
pnpm install

echo
echo "==> Supabase setup"
read -rp "Supabase project ref: " PROJECT_REF
read -rsp "Supabase DB password: " DB_PW; echo

supabase link --project-ref "$PROJECT_REF" --password "$DB_PW"
supabase db push --password "$DB_PW"

echo
echo "==> Deploying edge functions"
for fn in notifier telegram-webhook channel-verify send-test poll refresh-scores; do
  supabase functions deploy "$fn" --project-ref "$PROJECT_REF" --no-verify-jwt
done

echo
echo "==> Manual steps remaining — see README:"
echo "   - Set Supabase function secrets (TELEGRAM_BOT_TOKEN, TWILIO_*, etc.)"
echo "   - Configure notifier trigger GUCs"
echo "   - Deploy poller (fly deploy)"
echo "   - Deploy dashboard (vercel --prod)"
echo "   - Register Telegram webhook"
echo
echo "Done. ✅"
