#!/usr/bin/env bash
# Spin up the full dev stack: Supabase local, dashboard, poller.
set -euo pipefail

supabase start
pnpm --filter @slickalerts/dashboard dev &
pnpm --filter @slickalerts/poller dev &
wait
