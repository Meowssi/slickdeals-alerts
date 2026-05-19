-- =============================================================================
-- 20260518000003_indexes.sql
-- Indexes for the hot paths: dedup lookup, feed query, stats.
-- =============================================================================

-- Poller dedup hot path: lookup deal by slickdeals_id
-- (already covered by the unique constraint on deals.slickdeals_id, no extra index needed)

-- Feed query: most recent matches per user
create index alert_matches_user_matched_at_idx
  on public.alert_matches (user_id, matched_at desc);

-- Stats query: notifications by user over time window
create index notifications_sent_user_sent_at_idx
  on public.notifications_sent (user_id, sent_at desc);

-- Poller scan: enabled alerts, ordered by last_polled_at asc (poll oldest first)
create index alerts_enabled_last_polled_idx
  on public.alerts (last_polled_at nulls first)
  where enabled = true;

-- Telegram webhook lookup: by verification_code (unverified) and by chat_id (verified)
create index notif_channels_verification_idx
  on public.notification_channels (verification_code)
  where verification_code is not null;
create index notif_channels_telegram_chat_idx
  on public.notification_channels ((config->>'chat_id'))
  where type = 'telegram' and verified_at is not null;
create index notif_channels_user_idx
  on public.notification_channels (user_id);

-- Deal state quick lookup
create index deal_state_saved_idx
  on public.deal_state (user_id, saved)
  where saved = true;
