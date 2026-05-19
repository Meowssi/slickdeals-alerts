import type { Provider, Notification, ChannelConfig, SendResult } from "./types.ts";

interface TwilioConfig { phone?: string }

export const smsTwilioProvider: Provider = {
  type: "sms_twilio",
  displayName: "SMS (via Twilio)",
  description: "Text message to your phone. Reliable, works without internet, paid per message (~$0.008).",
  requiresGlobalSecrets: true, // TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER

  async send(n: Notification, raw: ChannelConfig): Promise<SendResult> {
    const cfg = raw as TwilioConfig;
    const sid = Deno.env.get("TWILIO_ACCOUNT_SID");
    const token = Deno.env.get("TWILIO_AUTH_TOKEN");
    const from = Deno.env.get("TWILIO_FROM_NUMBER");
    if (!sid || !token || !from) {
      return { ok: false, error: "Twilio env vars not set" };
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
