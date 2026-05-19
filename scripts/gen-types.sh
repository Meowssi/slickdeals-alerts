#!/usr/bin/env bash
# Regenerate TypeScript types from the linked Supabase project schema.
set -euo pipefail
supabase gen types typescript --linked > packages/shared/src/db.types.ts
echo "Wrote packages/shared/src/db.types.ts"
