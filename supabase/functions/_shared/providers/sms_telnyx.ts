import type { Provider, Notification, ChannelConfig, SendResult } from "./types.ts";

interface TelnyxConfig {
  phone?: string;
  api_key?: string;
  from_number?: string;
}

export const smsTelnyxProvider: Provider = {
  type: "sms_telnyx",
  displayName: "SMS (via Telnyx)",
  description: "Text message to your phone. Reliable, works without internet, you pay Telnyx (~$0.005/SMS).",
  requiresGlobalSecrets: false,

  async send(n: Notification, raw: ChannelConfig): Promise<SendResult> {
    const cfg = raw as TelnyxConfig;
    if (!cfg.api_key) return { ok: false, error: "Telnyx api_key missing in channel config" };
    if (!cfg.from_number) return { ok: false, error: "Telnyx from_number missing in channel config" };
    if (!cfg.phone) return { ok: false, error: "missing phone" };

    const text = `${n.title}\n${n.url}`.slice(0, 1600);

    const body: Record<string, unknown> = {
      from: cfg.from_number,
      to: cfg.phone,
      text,
    };
    if (n.thumbnailUrl) {
      body.media_urls = [n.thumbnailUrl];
    }

    const res = await fetch("https://api.telnyx.com/v2/messages", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.api_key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `telnyx ${res.status}: ${text.slice(0, 200)}` };
    }
    return { ok: true };
  },
};
