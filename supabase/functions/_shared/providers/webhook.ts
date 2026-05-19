// Generic HTTP webhook. Sends a JSON POST to whatever URL the user configures.
// Useful for Zapier, IFTTT, custom integrations, Apple Shortcuts, etc.

import type { Provider, Notification, ChannelConfig, SendResult } from "./types.ts";

interface WebhookConfig {
  url?: string;
  headers?: Record<string, string>;
}

export const webhookProvider: Provider = {
  type: "webhook",
  displayName: "Generic Webhook",
  description: "POST JSON to any URL. Use for Zapier, IFTTT, Apple Shortcuts, home automation, etc.",
  requiresGlobalSecrets: false,

  async send(n: Notification, raw: ChannelConfig): Promise<SendResult> {
    const cfg = raw as WebhookConfig;
    if (!cfg.url) return { ok: false, error: "missing url" };

    const res = await fetch(cfg.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(cfg.headers ?? {}) },
      body: JSON.stringify({
        title: n.title,
        body: n.body,
        url: n.url,
        priority: n.priority,
        silent: n.silent,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `webhook ${res.status}: ${text.slice(0, 200)}` };
    }
    return { ok: true };
  },
};
