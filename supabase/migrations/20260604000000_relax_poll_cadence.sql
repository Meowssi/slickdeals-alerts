-- =============================================================================
-- 20260604000000_relax_poll_cadence.sql
-- Poll every 60s instead of every 30s.
--
-- Slickdeals' RSS advertises a 5-minute TTL, so a 30s cadence doubled the
-- Supabase egress (and the load on slickdeals.net) without delivering deals
-- meaningfully faster. Together with the batched writes in the poll function
-- this keeps a self-hosted instance comfortably inside the free tier's
-- 5 GB/month egress quota.
-- =============================================================================

do $$
begin
  perform cron.unschedule('poll-feeds')
  where exists (select 1 from cron.job where jobname = 'poll-feeds');
exception when others then null;
end $$;

select cron.schedule(
  'poll-feeds',
  '60 seconds',
  $$select public.invoke_poll();$$
);

comment on function public.invoke_poll() is
  'Called by pg_cron every 60s. Reads vault, POSTs to the poll edge function which performs one polling pass over all enabled alerts.';
