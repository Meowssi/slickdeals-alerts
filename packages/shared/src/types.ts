// Hand-written types used across poller, dashboard, and edge functions.
// For DB-row types, regenerate with `pnpm db:types`.

export interface DealItem {
  /** Stable unique id from the RSS guid. */
  slickdealsId: string;
  title: string;
  url: string;
  price: number | null;
  store: string | null;
  thumbnailUrl: string | null;
  /** From <pubDate>. Null if the feed didn't include one. */
  pubAt: Date | null;
  /** Full raw item, for forensics. */
  raw: Record<string, unknown>;
}

export type AlertPriority = "silent" | "normal" | "urgent";

/**
 * Known provider types. Used for type hints; the DB stores arbitrary strings,
 * so adding a new provider is a code-only change (no migration).
 */
export type ChannelType =
  | "telegram"
  | "ntfy"
  | "sms_twilio"
  | "pushover"
  | "discord"
  | "email"
  | "webhook";

export interface AlertRow {
  id: string;
  user_id: string;
  name: string;
  rss_url: string;
  enabled: boolean;
  title_include: string[];
  title_exclude: string[];
  min_price: number | null;
  max_price: number | null;
  /** Empty array = send to ALL of the user's verified channels. */
  channel_ids: string[];
  priority: AlertPriority;
  last_polled_at: string | null;
  last_etag: string | null;
  last_modified: string | null;
  last_error: string | null;
  consecutive_errors: number;
  created_at: string;
  updated_at: string;
}

export interface NotificationChannelRow {
  id: string;
  user_id: string;
  type: ChannelType | string;
  name: string;
  enabled: boolean;
  config: Record<string, unknown>;
  verified_at: string | null;
  verification_code: string | null;
  verification_expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DealRow {
  id: number;
  slickdeals_id: string;
  title: string;
  url: string;
  price: number | null;
  store: string | null;
  thumbnail_url: string | null;
  rss_pub_at: string | null;
  first_seen_at: string;
  raw: Record<string, unknown>;
  created_at: string;
}

export interface AlertMatchRow {
  id: number;
  user_id: string;
  alert_id: string;
  deal_id: number;
  matched_at: string;
}

export interface UserSettingsRow {
  user_id: string;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  timezone: string;
  digest_mode: boolean;
  onboarded_at: string | null;
  created_at: string;
  updated_at: string;
}
