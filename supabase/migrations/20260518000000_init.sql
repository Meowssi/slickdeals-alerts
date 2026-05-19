-- =============================================================================
-- 20260518000000_init.sql
-- Core schema: user_settings, notification_channels (pluggable), alerts,
-- deals, alert_matches, deal_state, notifications_sent.
-- =============================================================================

create extension if not exists "pgcrypto";
create extension if not exists "pg_net" with schema extensions;

-- ---------------------------------------------------------------------------
-- user_settings: per-tenant preferences (not channel config — see notification_channels)
-- ---------------------------------------------------------------------------
create table public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  quiet_hours_start time,
  quiet_hours_end time,
  timezone text not null default 'America/Los_Angeles',
  digest_mode boolean not null default false,
  onboarded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.user_settings is
  'Per-user preferences (quiet hours, timezone). Channel config lives in notification_channels.';
comment on column public.user_settings.digest_mode is
  'If true, non-urgent matches are batched and delivered hourly instead of immediately.';
comment on column public.user_settings.onboarded_at is
  'Set the first time the user finishes the setup wizard. Null = show wizard.';

-- ---------------------------------------------------------------------------
-- notification_channels: plug-and-play providers (telegram, sms, pushover, ...)
-- One row per user × provider × instance. Verified channels can receive alerts.
-- ---------------------------------------------------------------------------
create table public.notification_channels (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Provider type. Add new providers without schema changes; the notifier
  -- dispatches by string and ignores unknown types.
  type text not null,                       -- 'telegram' | 'ntfy' | 'sms_twilio' | 'pushover' | 'discord' | 'email' | 'webhook'
  name text not null default 'default',     -- user-given label ("work phone", "home pushover")
  enabled boolean not null default true,
  -- Per-channel configuration. Schema depends on `type`. Examples:
  --   telegram      -> { "chat_id": "12345" }
  --   ntfy          -> { "topic": "slickalerts-abc", "server": "https://ntfy.sh" }
  --   sms_twilio    -> { "phone": "+15551234567" }
  --   pushover      -> { "user_key": "u...", "device": null }
  --   discord       -> { "webhook_url": "https://discord.com/api/webhooks/..." }
  --   email         -> { "address": "user@example.com" }
  --   webhook       -> { "url": "https://...", "headers": {} }
  config jsonb not null default '{}'::jsonb,
  -- Channels start unverified. The verification flow (SMS code, telegram /link, etc.)
  -- sets verified_at; only verified channels are used by the notifier.
  verified_at timestamptz,
  -- For multi-step verification (SMS code, etc.) — short-lived nonce.
  verification_code text,
  verification_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, type, name)
);

comment on table public.notification_channels is
  'Per-user notification destinations. Pluggable: add a new `type` + provider module to support new services.';

-- ---------------------------------------------------------------------------
-- alerts: a saved-search RSS feed the user wants to monitor
-- ---------------------------------------------------------------------------
create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  rss_url text not null,
  enabled boolean not null default true,
  -- optional client-side filters layered on top of RSS results
  title_include text[] not null default '{}',  -- ANY must appear (case-insensitive)
  title_exclude text[] not null default '{}',  -- NONE may appear
  min_price numeric,
  max_price numeric,
  -- delivery: array of notification_channels.id this alert routes to.
  -- Empty array = send to all of this user's enabled+verified channels.
  channel_ids uuid[] not null default '{}',
  priority text not null default 'normal',     -- 'silent' | 'normal' | 'urgent'
  -- bookkeeping
  last_polled_at timestamptz,
  last_etag text,
  last_modified text,
  last_error text,
  consecutive_errors int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint priority_valid check (priority in ('silent', 'normal', 'urgent'))
);

comment on table public.alerts is
  'User-defined RSS feeds (Slickdeals saved searches) to poll for matches.';
comment on column public.alerts.last_etag is
  'ETag from the most recent successful poll, used for conditional GET.';

-- ---------------------------------------------------------------------------
-- deals: deduplicated deal items seen across ALL users
-- ---------------------------------------------------------------------------
create table public.deals (
  id bigserial primary key,
  slickdeals_id text not null unique,           -- guid from RSS
  title text not null,
  url text not null,
  price numeric,
  store text,
  thumbnail_url text,
  rss_pub_at timestamptz,                       -- <pubDate> from RSS
  first_seen_at timestamptz not null default now(),  -- when poller wrote it
  raw jsonb not null,                           -- full RSS item for forensics
  created_at timestamptz not null default now()
);

comment on table public.deals is
  'Deduplicated deal items. One row per unique slickdeals_id, shared across users.';
comment on column public.deals.first_seen_at is
  'When the poller observed this deal for the first time. Used for latency stats.';

-- ---------------------------------------------------------------------------
-- alert_matches: which alert(s) matched which deal
-- This is the per-user feed table.
-- ---------------------------------------------------------------------------
create table public.alert_matches (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  alert_id uuid not null references public.alerts(id) on delete cascade,
  deal_id bigint not null references public.deals(id) on delete cascade,
  matched_at timestamptz not null default now(),
  unique (alert_id, deal_id)
);

comment on table public.alert_matches is
  'Many-to-many: deals that satisfied each alert. The unified feed reads from here.';

-- ---------------------------------------------------------------------------
-- deal_state: per-user state for a deal (read / saved / dismissed / notes)
-- ---------------------------------------------------------------------------
create table public.deal_state (
  user_id uuid not null references auth.users(id) on delete cascade,
  deal_id bigint not null references public.deals(id) on delete cascade,
  read_at timestamptz,
  saved boolean not null default false,
  dismissed boolean not null default false,
  notes text,
  updated_at timestamptz not null default now(),
  primary key (user_id, deal_id)
);

-- ---------------------------------------------------------------------------
-- notifications_sent: log of every outbound notification
-- ---------------------------------------------------------------------------
create table public.notifications_sent (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  deal_id bigint not null references public.deals(id) on delete cascade,
  channel_id uuid references public.notification_channels(id) on delete set null,
  channel_type text not null,                   -- denormalized for stats even after channel delete
  sent_at timestamptz not null default now(),
  rss_to_sent_ms int,                           -- sent_at - deals.rss_pub_at
  poll_to_sent_ms int,                          -- sent_at - deals.first_seen_at
  ok boolean not null,
  error text
);

comment on table public.notifications_sent is
  'Append-only log of notification attempts. Drives the latency stats page.';

-- ---------------------------------------------------------------------------
-- updated_at trigger helper
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger user_settings_set_updated_at before update on public.user_settings
  for each row execute function public.set_updated_at();
create trigger alerts_set_updated_at before update on public.alerts
  for each row execute function public.set_updated_at();
create trigger deal_state_set_updated_at before update on public.deal_state
  for each row execute function public.set_updated_at();
create trigger notification_channels_set_updated_at before update on public.notification_channels
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Auto-create user_settings row on auth.users insert
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_settings (user_id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
