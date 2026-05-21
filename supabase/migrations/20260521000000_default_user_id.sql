-- =============================================================================
-- 20260521000000_default_user_id.sql
-- Adds `default auth.uid()` to user_id columns on tables the user inserts to
-- directly under RLS. Without this default, clients have to set user_id
-- explicitly, but the RLS policies (`with check (auth.uid() = user_id)`)
-- expect it to already match the caller. The default + RLS pair is the
-- idiomatic Supabase pattern: the default fills it in, RLS verifies it.
-- =============================================================================

alter table public.notification_channels alter column user_id set default auth.uid();
alter table public.alerts                alter column user_id set default auth.uid();
alter table public.deal_state            alter column user_id set default auth.uid();
