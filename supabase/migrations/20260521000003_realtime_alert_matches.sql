-- =============================================================================
-- 20260521000003_realtime_alert_matches.sql
-- Add alert_matches to the supabase_realtime publication so the dashboard
-- feed can subscribe to INSERTs via Supabase Realtime (postgres_changes).
-- RLS still applies — users only receive events for their own rows.
-- =============================================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'alert_matches'
  ) then
    execute 'alter publication supabase_realtime add table public.alert_matches';
  end if;
end $$;
