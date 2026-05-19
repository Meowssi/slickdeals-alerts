-- =============================================================================
-- 20260518000002_triggers.sql
-- pg_net trigger: when a new alert_match is inserted, POST to the notifier
-- edge function so it can fan out to Telegram + ntfy.
-- =============================================================================

-- We need the function URL and service role JWT at runtime. They're stored
-- in private app settings via `alter database ... set` (see operating.md).
-- Locally / on first run, set them with:
--   alter database postgres set "app.notifier_url" to 'https://<ref>.functions.supabase.co/notifier';
--   alter database postgres set "app.service_role_key" to 'eyJ...';

create or replace function public.notify_on_match()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  notifier_url text := current_setting('app.notifier_url', true);
  service_key  text := current_setting('app.service_role_key', true);
begin
  if notifier_url is null or notifier_url = '' then
    -- not configured yet; skip silently
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

create trigger alert_matches_notify
  after insert on public.alert_matches
  for each row execute function public.notify_on_match();
