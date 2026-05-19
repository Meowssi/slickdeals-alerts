-- =============================================================================
-- 20260518000001_rls.sql
-- Row-Level Security policies. Service role bypasses RLS automatically.
-- =============================================================================

alter table public.user_settings enable row level security;
alter table public.notification_channels enable row level security;
alter table public.alerts enable row level security;
alter table public.alert_matches enable row level security;
alter table public.deal_state enable row level security;
alter table public.notifications_sent enable row level security;
alter table public.deals enable row level security;

-- user_settings
create policy "user_settings select own"  on public.user_settings for select using (auth.uid() = user_id);
create policy "user_settings insert own"  on public.user_settings for insert with check (auth.uid() = user_id);
create policy "user_settings update own"  on public.user_settings for update using (auth.uid() = user_id);

-- notification_channels
create policy "channels select own"  on public.notification_channels for select using (auth.uid() = user_id);
create policy "channels insert own"  on public.notification_channels for insert with check (auth.uid() = user_id);
create policy "channels update own"  on public.notification_channels for update using (auth.uid() = user_id);
create policy "channels delete own"  on public.notification_channels for delete using (auth.uid() = user_id);

-- alerts
create policy "alerts select own"  on public.alerts for select using (auth.uid() = user_id);
create policy "alerts insert own"  on public.alerts for insert with check (auth.uid() = user_id);
create policy "alerts update own"  on public.alerts for update using (auth.uid() = user_id);
create policy "alerts delete own"  on public.alerts for delete using (auth.uid() = user_id);

-- alert_matches  (insert handled by service role)
create policy "alert_matches select own" on public.alert_matches for select using (auth.uid() = user_id);

-- deal_state
create policy "deal_state select own" on public.deal_state for select using (auth.uid() = user_id);
create policy "deal_state insert own" on public.deal_state for insert with check (auth.uid() = user_id);
create policy "deal_state update own" on public.deal_state for update using (auth.uid() = user_id);

-- notifications_sent  (insert handled by service role)
create policy "notifications select own" on public.notifications_sent for select using (auth.uid() = user_id);

-- deals: visible only via a match the user owns
create policy "deals select via match" on public.deals for select using (
  exists (
    select 1 from public.alert_matches am
    where am.deal_id = deals.id and am.user_id = auth.uid()
  )
);
