-- =============================================================================
-- 20260521000004_alerts_include_images.sql
-- Per-alert toggle: include deal thumbnails in notifications. Controls
-- whether the notifier passes thumbnailUrl to providers — Telegram/Discord
-- show the image, Twilio upgrades to MMS (more $).
-- =============================================================================

alter table public.alerts
  add column if not exists include_images boolean not null default true;

comment on column public.alerts.include_images is
  'When true, the notifier sends deal thumbnails along with the text. For Twilio that upgrades the message to MMS (~2.5x cost). Free for Telegram/Discord/etc.';
