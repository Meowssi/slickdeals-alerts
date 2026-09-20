-- =============================================================================
-- 20260920200000_operational_history_retention.sql
-- Bounded retention for Supabase-managed operational history.
--
-- The application tables are intentionally not touched here.  pg_net response
-- bodies and pg_cron run details are internal observability history; retaining
-- them forever can consume a meaningful portion of the Free-tier database
-- quota.  Each hourly run removes at most 5,000 old rows from each table.
--
-- Polling stays at the safe one-minute cadence and refresh-scores remains
-- paused until it is explicitly re-enabled after production observation.
-- =============================================================================

create or replace function public.maintain_operational_history()
returns void
language plpgsql
security definer
set search_path = public, extensions, net, cron
as $$
begin
  -- Keep seven days of pg_net responses for troubleshooting, but never delete
  -- queued requests or any public/application data.
  delete from net._http_response
   where id in (
     select id
       from net._http_response
      where created < now() - interval '7 days'
      order by created asc
      limit 5000
   );

  -- Keep two weeks of cron execution history.  The runid is the stable row
  -- identifier in pg_cron.job_run_details; the bounded subquery avoids a
  -- large one-shot delete when a project has accumulated history.
  delete from cron.job_run_details
   where runid in (
     select runid
       from cron.job_run_details
      where start_time < now() - interval '14 days'
      order by start_time asc
      limit 5000
   );
end;
$$;

revoke execute on function public.maintain_operational_history() from public, anon, authenticated;
grant execute on function public.maintain_operational_history() to postgres;

comment on function public.maintain_operational_history() is
  'Hourly bounded retention: deletes only pg_net responses older than 7d and pg_cron run details older than 14d, up to 5000 rows per table.';

do $$
begin
  perform cron.unschedule('operational-history-retention')
  where exists (select 1 from cron.job where jobname = 'operational-history-retention');
exception when others then null;
end $$;

select cron.schedule(
  'operational-history-retention',
  '15 * * * *',
  $$select public.maintain_operational_history();$$
);

-- Reassert the safe poll cadence and remove any duplicate/stale definition.
do $$
begin
  perform cron.unschedule('poll-feeds')
  where exists (select 1 from cron.job where jobname = 'poll-feeds');
exception when others then null;
end $$;

select cron.schedule(
  'poll-feeds',
  '* * * * *',
  $$select public.invoke_poll();$$
);

-- Keep the IO-heavy score scraper paused during the migration/cutover window.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'refresh-scores') then
    perform cron.unschedule('refresh-scores');
  end if;
end
$$;
