# Dashboard

Next.js 15 App Router. Server components by default. Tailwind for styling.

## Run locally

```bash
cp ../../.env.example .env.local
# (fill in NEXT_PUBLIC_* vars + ALLOWED_EMAIL_DOMAIN)
pnpm install
pnpm dev
# -> http://localhost:3000
```

## Deploy to Vercel

```bash
vercel link
vercel env pull .env.local           # optional, syncs from dashboard
vercel --prod
```

Set env vars in the Vercel dashboard (Project → Settings → Environment Variables):

| Variable | Scope |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | All |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | All |
| `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` | All |
| `NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN` | All (optional) |

Vercel auto-deploys on push to `main` once you link the repo.

## Route map

| Path | Role |
|---|---|
| `/login` | Magic-link sign-in |
| `/auth/callback` | OAuth code exchange |
| `/setup` | First-time onboarding wizard |
| `/` | Unified feed of matches |
| `/alerts` | List + CRUD of alert rules |
| `/alerts/new` | Create a new alert |
| `/alerts/[id]` | Edit an alert |
| `/deal/[id]` | Deal detail + notification history |
| `/stats` | Latency + health stats |
| `/settings` | Channels + preferences |
| `/api/alert-test?url=…` | Test-fetch an RSS URL |
