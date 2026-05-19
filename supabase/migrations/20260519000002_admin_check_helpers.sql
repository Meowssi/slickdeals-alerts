-- =============================================================================
-- 20260519000002_admin_check_helpers.sql
-- Helper RPC functions used by the /admin/setup dashboard:
--   - count_schema_migrations(): counts rows in supabase_migrations.schema_migrations
--   - admin_list_vault_secrets(): returns the names (not values) of vault secrets
-- Both are SECURITY DEFINER and restricted to the service_role.
-- =============================================================================

create or replace function public.count_schema_migrations()
returns table (count bigint)
language sql
security definer
stable
set search_path = pg_catalog, supabase_migrations
as $$
  select count(*)::bigint from supabase_migrations.schema_migrations;
$$;

create or replace function public.admin_list_vault_secrets()
returns table (name text)
language sql
security definer
stable
set search_path = pg_catalog, vault
as $$
  select name from vault.decrypted_secrets;
$$;

revoke execute on function public.count_schema_migrations()  from public, anon, authenticated;
revoke execute on function public.admin_list_vault_secrets() from public, anon, authenticated;
grant  execute on function public.count_schema_migrations()  to service_role;
grant  execute on function public.admin_list_vault_secrets() to service_role;
