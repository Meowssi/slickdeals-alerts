-- =============================================================================
-- 20260521000001_schedule_polling.sql
-- pg_cron schedule that calls the `poll` edge function every 30 seconds.
--
-- Replaces the old external Fly.io poller — polling now lives inside each
-- deployment's Supabase project, so the dashboard's Vercel deploy + Supabase
-- project are everything a self-hoster needs.
--
-- Reads notifier_url + service_role_key from Supabase Vault (already populated
-- by `populateVaultAction` in /admin/setup) and derives the poll URL from
-- the notifier URL.
-- =============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Function the cron job calls. SECURITY DEFINER so it can read vault under the
-- postgres owner; restricted from public/authenticated callers.
create or replace function public.invoke_poll()
returns void
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  poll_url     text;
  service_key  text;
begin
  -- Derive poll URL from the notifier URL stored in vault (same host).
  select decrypted_secret into poll_url
    from vault.decrypted_secrets
    where name = 'notifier_url'
    limit 1;
  if poll_url is null or poll_url = '' then
    return;
  end if;
  poll_url := regexp_replace(poll_url, '/notifier$', '/poll');

  select decrypted_secret into service_key
    from vault.decrypted_secrets
    where name = 'service_role_key'
    limit 1;
  if service_key is null or service_key = '' then
    return;
  end if;

  perform net.http_post(
    url     := poll_url,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || service_key,
      'Content-Type',  'application/json'
    ),
    body    := jsonb_build_object(),
    timeout_milliseconds := 25000
  );
end;
$$;

revoke execute on function public.invoke_poll() from public, anon, authenticated;
grant  execute on function public.invoke_poll() to postgres;

-- Schedule it every 30 seconds. Drop any existing job with the same name first
-- so this migration is idempotent across re-runs.
do $$
begin
  perform cron.unschedule('poll-feeds')
  where exists (select 1 from cron.job where jobname = 'poll-feeds');
exception when others then null;
end $$;

select cron.schedule(
  'poll-feeds',
  '30 seconds',
  $$select public.invoke_poll();$$
);

comment on function public.invoke_poll() is
  'Called by pg_cron every 30s. Reads vault, POSTs to the poll edge function which performs one polling pass over all enabled alerts.';
