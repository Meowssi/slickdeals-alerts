// Client-side catalog of providers. Mirrors the server registry in
// supabase/functions/_shared/providers/index.ts. Adding a provider means
// updating both — keep this list in sync.

import type { ChannelType } from "./types.js";

export interface ProviderMeta {
  type: ChannelType;
  displayName: string;
  /** One-line description for the picker card. */
  description: string;
  /** What the user is expected to provide during setup. */
  setup: {
    /** Free-form instructions shown above the form. */
    instructions: string;
    /** Form fields to render. Each becomes a key in the `config` jsonb. */
    fields: Array<{
      key: string;
      label: string;
      placeholder?: string;
      type?: "text" | "tel" | "email" | "url" | "password";
      required: boolean;
      help?: string;
    }>;
    /**
     * Does this channel require a verification step after the user submits the form?
     *  - "telegram": user must talk to bot
     *  - "sms"     : we SMS a code, user enters it
     *  - "none"    : auto-verified (Pushover / Discord / Email / Webhook / ntfy)
     */
    verifyMode: "telegram" | "sms" | "none";
  };
  /** Whether this provider requires server-side global env vars. Used to flag in UI. */
  requiresServerSecrets: boolean;
}

export const PROVIDER_CATALOG: ProviderMeta[] = [
  {
    type: "telegram",
    displayName: "Telegram",
    description: "Free, fast push via Telegram bot. Best UX — supports inline Save/Dismiss buttons.",
    setup: {
      instructions:
        "We'll generate a code. Tap the deep link (or send /link CODE to the bot) to connect this chat.",
      fields: [], // no fields; verification handles the binding
      verifyMode: "telegram",
    },
    requiresServerSecrets: true,
  },
  {
    type: "ntfy",
    displayName: "ntfy.sh",
    description: "Free open-source push. Install the ntfy app and subscribe to your private topic.",
    setup: {
      instructions:
        "Pick a topic name (we suggest a random one). Subscribe to it in the ntfy app on your phone, then save.",
      fields: [
        { key: "topic", label: "Topic", placeholder: "slickalerts-yourname", required: true,
          help: "Treat this like a password — anyone who knows it can read your notifications." },
        { key: "server", label: "Server URL", placeholder: "https://ntfy.sh", required: false,
          help: "Leave default unless you self-host ntfy." },
      ],
      verifyMode: "none",
    },
    requiresServerSecrets: false,
  },
  {
    type: "sms_twilio",
    displayName: "SMS (Twilio)",
    description: "Text message to your phone. Works without internet. Paid (~$0.008/msg).",
    setup: {
      instructions:
        "Enter your phone number (E.164 format, e.g. +15551234567). We'll text you a code to confirm.",
      fields: [
        { key: "phone", label: "Phone number", placeholder: "+15551234567", type: "tel", required: true,
          help: "Format: +<country><number>. US example: +15551234567" },
      ],
      verifyMode: "sms",
    },
    requiresServerSecrets: true,
  },
  {
    type: "pushover",
    displayName: "Pushover",
    description: "Premium push ($5 one-time). Emergency priority bypasses Do-Not-Disturb.",
    setup: {
      instructions:
        "Create a Pushover account and find your User Key (https://pushover.net). Paste it below.",
      fields: [
        { key: "user_key", label: "User Key", placeholder: "u...", required: true },
        { key: "device", label: "Device (optional)", placeholder: "iphone", required: false,
          help: "Limit notifications to one device. Leave blank to receive on all your Pushover devices." },
      ],
      verifyMode: "none",
    },
    requiresServerSecrets: true,
  },
  {
    type: "discord",
    displayName: "Discord (webhook)",
    description: "Post to a Discord channel via webhook. Good for team channels.",
    setup: {
      instructions:
        "In Discord: Channel Settings → Integrations → Webhooks → New Webhook → Copy URL. Paste it below.",
      fields: [
        { key: "webhook_url", label: "Webhook URL", placeholder: "https://discord.com/api/webhooks/...", type: "url", required: true },
      ],
      verifyMode: "none",
    },
    requiresServerSecrets: false,
  },
  {
    type: "email",
    displayName: "Email",
    description: "Send to an email address. Reliable, slower than push.",
    setup: {
      instructions: "Where should we send the email?",
      fields: [
        { key: "address", label: "Email address", placeholder: "you@example.com", type: "email", required: true },
      ],
      verifyMode: "none",
    },
    requiresServerSecrets: true,
  },
  {
    type: "webhook",
    displayName: "Generic Webhook",
    description: "POST JSON to any URL. Wire up Zapier, IFTTT, Apple Shortcuts, home assistant, etc.",
    setup: {
      instructions: "We'll POST a JSON body to this URL on every match.",
      fields: [
        { key: "url", label: "URL", placeholder: "https://...", type: "url", required: true },
      ],
      verifyMode: "none",
    },
    requiresServerSecrets: false,
  },
];

export function getProviderMeta(type: string): ProviderMeta | undefined {
  return PROVIDER_CATALOG.find((p) => p.type === type);
}
