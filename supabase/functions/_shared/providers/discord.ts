import type { Provider, Notification, ChannelConfig, SendResult } from "./types.ts";

interface DiscordConfig { webhook_url?: string }

export const discordProvider: Provider = {
  type: "discord",
  displayName: "Discord (webhook)",
  description: "Post to a Discord channel via a webhook URL. Good for shared team channels.",
  requiresGlobalSecrets: false,

  async send(n: Notification, raw: ChannelConfig): Promise<SendResult> {
    const cfg = raw as DiscordConfig;
    if (!cfg.webhook_url) return { ok: false, error: "missing webhook_url" };

    const embed = {
      title: n.title.slice(0, 256),
      description: n.body.slice(0, 4096),
      url: n.url,
      color: 0xff6600,
    };

    const res = await fetch(cfg.webhook_url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embeds: [embed] }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `discord ${res.status}: ${text.slice(0, 200)}` };
    }
    return { ok: true };
  },
};
