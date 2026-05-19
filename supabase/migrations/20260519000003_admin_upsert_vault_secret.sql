-- =============================================================================
-- 20260519000003_admin_upsert_vault_secret.sql
-- Helper used by the /admin/setup wizard's "Populate vault" action.
-- Upserts a vault secret (by name) so it's safe to call repeatedly.
-- =============================================================================

create or replace function public.admin_upsert_vault_secret(
  p_name  text,
  p_value text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, vault
as $$
declare
  existing_id uuid;
begin
  select id into existing_id from vault.secrets where name = p_name limit 1;
  if existing_id is not null then
    perform vault.update_secret(existing_id, p_value, p_name);
  else
    perform vault.create_secret(p_value, p_name);
  end if;
end;
$$;

revoke execute on function public.admin_upsert_vault_secret(text, text) from public, anon, authenticated;
grant  execute on function public.admin_upsert_vault_secret(text, text) to service_role;
