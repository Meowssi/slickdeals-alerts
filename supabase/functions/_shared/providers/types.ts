// Provider plugin contract.
// To add a new notification service, drop a new module in this folder that
// exports a `Provider` and add it to the registry in `index.ts`.

export interface Notification {
  /** Short title, e.g. "Cat6 cables under $20: $10.99 Insignia 150ft" */
  title: string;
  /** Full plain-text body */
  body: string;
  /** Click target URL */
  url: string;
  /** 1 (min) — 5 (urgent). Maps differently per provider. */
  priority: 1 | 2 | 3 | 4 | 5;
  /** Suppress sound/vibration where supported */
  silent: boolean;
  /** Inline buttons (Telegram-style). Providers without button support ignore these. */
  actions?: Array<{ label: string; url?: string; callback?: string }>;
}

export interface SendResult {
  ok: boolean;
  error?: string;
}

export interface ChannelConfig {
  /** Per-provider config blob — schema enforced by provider, not DB. */
  [k: string]: unknown;
}

export interface Provider {
  /** Stable string id matching notification_channels.type. */
  type: string;
  /** Display name shown in onboarding UI. */
  displayName: string;
  /** One-line description for the picker. */
  description: string;
  /** Whether this provider needs an env-level secret (e.g. Twilio creds). */
  requiresGlobalSecrets: boolean;
  /** Send a notification using the channel's stored config. */
  send(notification: Notification, config: ChannelConfig): Promise<SendResult>;
}
