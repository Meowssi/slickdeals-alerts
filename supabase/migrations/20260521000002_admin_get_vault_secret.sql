-- =============================================================================
-- 20260521000002_admin_get_vault_secret.sql
-- Companion RPC to admin_upsert_vault_secret: read a single vault secret's
-- decrypted value by name. Used by the dashboard server to fetch the admin
-- TOTP secret (so 2FA setup persists across Vercel redeploys without an
-- env var).
-- =============================================================================

create or replace function public.admin_get_vault_secret(p_name text)
returns text
language sql
security definer
stable
set search_path = pg_catalog, vault
as $$
  select decrypted_secret from vault.decrypted_secrets where name = p_name limit 1;
$$;

revoke execute on function public.admin_get_vault_secret(text) from public, anon, authenticated;
grant  execute on function public.admin_get_vault_secret(text) to service_role;

comment on function public.admin_get_vault_secret(text) is
  'Returns the decrypted vault secret for the given name. service_role only — never expose to anon/authenticated.';
