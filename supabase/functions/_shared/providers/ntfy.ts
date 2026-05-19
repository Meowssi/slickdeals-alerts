import type { Provider, Notification, ChannelConfig, SendResult } from "./types.ts";

interface NtfyConfig { topic?: string; server?: string }

export const ntfyProvider: Provider = {
  type: "ntfy",
  displayName: "ntfy.sh",
  description: "Free open-source push notifications. Install the ntfy app and subscribe to a private topic.",
  requiresGlobalSecrets: false,

  async send(n: Notification, raw: ChannelConfig): Promise<SendResult> {
    const cfg = raw as NtfyConfig;
    if (!cfg.topic) return { ok: false, error: "missing topic" };
    const server = cfg.server || "https://ntfy.sh";

    const headers: Record<string, string> = {
      Title: n.title,
      Priority: String(n.silent ? Math.min(n.priority, 2) : n.priority),
    };
    if (n.url) headers["Click"] = n.url;
    headers["Tags"] = "tag,money_with_wings";

    const res = await fetch(
      `${server}/${encodeURIComponent(cfg.topic)}`,
      { method: "POST", headers, body: n.body },
    );
    if (!res.ok) return { ok: false, error: `ntfy ${res.status}` };
    return { ok: true };
  },
};
