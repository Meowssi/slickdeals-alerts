# =============================================================================
# bootstrap.ps1 — first-time setup helper (Windows / PowerShell)
# -----------------------------------------------------------------------------
# Walks through installing deps, creating Supabase project, deploying functions,
# pushing migrations, and configuring all the secrets.
# =============================================================================

$ErrorActionPreference = "Stop"

function require-cmd($name) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: '$name' is not on your PATH." -ForegroundColor Red
    exit 1
  }
}

Write-Host "==> Checking prerequisites" -ForegroundColor Cyan
require-cmd "node"
require-cmd "pnpm"
require-cmd "supabase"
require-cmd "flyctl"
require-cmd "vercel"
require-cmd "gh"

Write-Host "==> Installing dependencies" -ForegroundColor Cyan
pnpm install

Write-Host ""
Write-Host "==> Supabase setup" -ForegroundColor Cyan
$projectRef = Read-Host "Supabase project ref (from https://supabase.com/dashboard)"
$dbPassword = Read-Host "Supabase DB password" -AsSecureString
$dbPasswordPlain = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto(
  [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($dbPassword))

supabase link --project-ref $projectRef --password $dbPasswordPlain
supabase db push --password $dbPasswordPlain

Write-Host ""
Write-Host "==> Deploying edge functions" -ForegroundColor Cyan
supabase functions deploy notifier         --project-ref $projectRef --no-verify-jwt
supabase functions deploy telegram-webhook --project-ref $projectRef --no-verify-jwt
supabase functions deploy channel-verify   --project-ref $projectRef --no-verify-jwt
supabase functions deploy send-test        --project-ref $projectRef --no-verify-jwt

Write-Host ""
Write-Host "==> Now go through the README sections:" -ForegroundColor Yellow
Write-Host "   - 'Set Supabase secrets' (TELEGRAM_BOT_TOKEN, TWILIO_*, etc.)"
Write-Host "   - 'Configure notifier trigger GUCs' (app.notifier_url, app.service_role_key)"
Write-Host "   - 'Deploy poller to Fly'"
Write-Host "   - 'Deploy dashboard to Vercel'"
Write-Host "   - 'Register Telegram webhook'"
Write-Host ""
Write-Host "Done with the automated parts. ✅" -ForegroundColor Green
