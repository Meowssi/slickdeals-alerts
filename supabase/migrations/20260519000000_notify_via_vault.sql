-- =============================================================================
-- 20260519000000_notify_via_vault.sql
-- Rewrite notify_on_match() to read notifier_url + service_role_key from
-- vault.decrypted_secrets instead of `alter database ... set` GUCs.
-- Managed Postgres on Supabase doesn't allow non-superusers to set custom GUCs,
-- so we use Supabase Vault instead.
--
-- After applying, populate the secrets ONCE per project (idempotent guard):
--   select vault.create_secret(
--     'https://<REF>.functions.supabase.co/notifier',
--     'notifier_url'
--   ) where not exists (select 1 from vault.decrypted_secrets where name = 'notifier_url');
--   select vault.create_secret(
--     '<SERVICE_ROLE_JWT>',
--     'service_role_key'
--   ) where not exists (select 1 from vault.decrypted_secrets where name = 'service_role_key');
-- =============================================================================

create or replace function public.notify_on_match()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  notifier_url text;
  service_key  text;
begin
  select decrypted_secret into notifier_url
    from vault.decrypted_secrets
    where name = 'notifier_url'
    limit 1;

  select decrypted_secret into service_key
    from vault.decrypted_secrets
    where name = 'service_role_key'
    limit 1;

  if notifier_url is null or notifier_url = '' then
    return new;
  end if;

  perform net.http_post(
    url     := notifier_url,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || coalesce(service_key, '')
    ),
    body    := jsonb_build_object(
      'match_id', new.id,
      'user_id',  new.user_id,
      'alert_id', new.alert_id,
      'deal_id',  new.deal_id
    ),
    timeout_milliseconds := 5000
  );

  return new;
end;
$$;
