-- =============================================================================
-- 20260524000001_refresh_scores_schedule.sql
-- pg_cron schedule that calls the `refresh-scores` edge function every 5 min.
--
-- The edge function picks up to N deals first_seen in the last 12h, fetches
-- the thread page on slickdeals.net, parses the current vote count, and
-- updates `deals.thumb_score`. This is feed-only: the notifier reads its
-- score snapshot at notification time and never re-fires for the same match.
-- =============================================================================

alter table public.deals
  add column if not exists last_score_refresh_at timestamptz;

create index if not exists deals_score_refresh_idx
  on public.deals (first_seen_at desc)
  where last_score_refresh_at is null
     or last_score_refresh_at < now() - interval '5 minutes';

-- SECURITY DEFINER wrapper so pg_cron can hit the edge function with the
-- service_role key from vault. Same pattern as invoke_poll().
create or replace function public.invoke_refresh_scores()
returns void
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  fn_url       text;
  service_key  text;
begin
  select decrypted_secret into fn_url
    from vault.decrypted_secrets
    where name = 'notifier_url'
    limit 1;
  if fn_url is null or fn_url = '' then
    return;
  end if;
  fn_url := regexp_replace(fn_url, '/notifier$', '/refresh-scores');

  select decrypted_secret into service_key
    from vault.decrypted_secrets
    where name = 'service_role_key'
    limit 1;
  if service_key is null or service_key = '' then
    return;
  end if;

  perform net.http_post(
    url     := fn_url,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || service_key,
      'Content-Type',  'application/json'
    ),
    body    := jsonb_build_object(),
    timeout_milliseconds := 25000
  );
end;
$$;

revoke execute on function public.invoke_refresh_scores() from public, anon, authenticated;
grant  execute on function public.invoke_refresh_scores() to postgres;

do $$
begin
  perform cron.unschedule('refresh-scores')
  where exists (select 1 from cron.job where jobname = 'refresh-scores');
exception when others then null;
end $$;

-- Every 5 minutes. pg_cron supports cron syntax for sub-minute jobs but 5min
-- is the natural cadence here — Slickdeals' ttl hint is 5min and votes
-- accrue over minutes/hours, not seconds.
select cron.schedule(
  'refresh-scores',
  '*/5 * * * *',
  $$select public.invoke_refresh_scores();$$
);

comment on function public.invoke_refresh_scores() is
  'Called by pg_cron every 5min. Refreshes thumb_score on deals < 12h old by scraping the thread page. Feed-only; notifications carry snapshot at send time.';
