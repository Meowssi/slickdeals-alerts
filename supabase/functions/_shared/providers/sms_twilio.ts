import type { Provider, Notification, ChannelConfig, SendResult } from "./types.ts";

interface TwilioConfig {
  phone?: string;
  account_sid?: string;
  auth_token?: string;
  from_number?: string;
}

export const smsTwilioProvider: Provider = {
  type: "sms_twilio",
  displayName: "SMS (via Twilio)",
  description: "Text message to your phone. Reliable, works without internet, you pay Twilio (~$0.008/SMS).",
  requiresGlobalSecrets: false, // Per-user: account_sid, auth_token, from_number live in channel.config

  async send(n: Notification, raw: ChannelConfig): Promise<SendResult> {
    const cfg = raw as TwilioConfig;
    const sid = cfg.account_sid;
    const token = cfg.auth_token;
    const from = cfg.from_number;
    if (!sid || !token || !from) {
      return { ok: false, error: "Twilio account_sid / auth_token / from_number missing in channel config" };
    }
    if (!cfg.phone) return { ok: false, error: "missing phone" };

    // SMS has no rich formatting. Keep it tight: title + url.
    const body = `${n.title}\n${n.url}`.slice(0, 1600);

    const params = new URLSearchParams({
      To: cfg.phone,
      From: from,
      Body: body,
    });

    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: "Basic " + btoa(`${sid}:${token}`),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
      },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `twilio ${res.status}: ${text.slice(0, 200)}` };
    }
    return { ok: true };
  },
};
