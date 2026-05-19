# Contributing

This is a private repo. You're here because you were invited as a collaborator.

## Filing issues

Use the templates under "New issue" — there are dedicated ones for:
- **Alert not firing** — most common; pre-fills the info we need to debug
- **Bug** — anything else broken
- **Feature** — including "add support for $service" notification providers

## Making changes

1. Branch from `main`. Name it `<your-handle>/<short-desc>`.
2. PR template prompts for the essentials. Fill it in.
3. CI runs typecheck + build on every PR. PRs can't merge red.
4. After merge, the relevant deploy workflow runs automatically:
   - `apps/poller/**` → Fly deploy
   - `supabase/functions/**` → Supabase function deploy
   - `apps/dashboard/**` → Vercel auto-deploys via git integration
   - `supabase/migrations/**` → **NOT** auto-deployed. Run the manual `DB migrate` workflow after reviewing.

## Adding a notification provider

1. `supabase/functions/_shared/providers/<name>.ts` — implement the `Provider` interface.
2. `supabase/functions/_shared/providers/index.ts` — add to the registry.
3. `packages/shared/src/providers.ts` — add a `ProviderMeta` so the dashboard's picker and setup wizard know about it.
4. If the provider needs custom verification (SMS-style: send code, user enters it), extend `supabase/functions/channel-verify/index.ts`.
5. Deploy: `pnpm fns:deploy` + dashboard redeploys automatically.

No schema migration needed.

## Local dev

```bash
cp .env.example .env
pnpm install
supabase start           # local Postgres + studio at :54323
pnpm dev:dashboard       # http://localhost:3000
pnpm dev:poller          # in another shell
```

## Code style

- TypeScript strict mode, `noUncheckedIndexedAccess`. No `any` unless commented why.
- Comments are for *why*, not *what*. The code shows what.
- Prefer server components in the dashboard. Reach for `"use client"` only when needed.
- Provider modules should be small (~50 lines) and have zero deps beyond `fetch` and Deno globals.
