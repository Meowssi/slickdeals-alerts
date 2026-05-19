import type { Provider, Notification, ChannelConfig, SendResult } from "./types.ts";

interface PushoverConfig { user_key?: string; device?: string }

export const pushoverProvider: Provider = {
  type: "pushover",
  displayName: "Pushover",
  description: "Premium push notifications. $5 one-time fee. Best for power users — supports emergency priority that bypasses DND.",
  requiresGlobalSecrets: true, // PUSHOVER_APP_TOKEN

  async send(n: Notification, raw: ChannelConfig): Promise<SendResult> {
    const cfg = raw as PushoverConfig;
    const appToken = Deno.env.get("PUSHOVER_APP_TOKEN");
    if (!appToken) return { ok: false, error: "PUSHOVER_APP_TOKEN not set" };
    if (!cfg.user_key) return { ok: false, error: "missing user_key" };

    // Pushover priority mapping:
    //  -2 lowest, -1 low, 0 normal, 1 high, 2 emergency (bypass DND, requires retry/expire)
    const poPriority = n.silent
      ? -1
      : n.priority >= 5
        ? 2
        : n.priority >= 4
          ? 1
          : 0;

    const form = new URLSearchParams({
      token: appToken,
      user: cfg.user_key,
      title: n.title,
      message: n.body,
      url: n.url,
      url_title: "View Deal",
      priority: String(poPriority),
    });
    if (cfg.device) form.set("device", cfg.device);
    if (poPriority === 2) {
      form.set("retry", "60");
      form.set("expire", "1800");
    }

    const res = await fetch("https://api.pushover.net/1/messages.json", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `pushover ${res.status}: ${text.slice(0, 200)}` };
    }
    return { ok: true };
  },
};
