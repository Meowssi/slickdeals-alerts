// Email via Resend (https://resend.com). Easy free tier, simple API.
// For other providers (Postmark, SES, SendGrid), copy this file and tweak.

import type { Provider, Notification, ChannelConfig, SendResult } from "./types.ts";

interface EmailConfig {
  address?: string;
  api_key?: string;
  from_address?: string;
}

export const emailProvider: Provider = {
  type: "email",
  displayName: "Email",
  description: "Send to an email address. Reliable, but slower than push.",
  requiresGlobalSecrets: false, // Per-user: api_key + from_address live in channel.config

  async send(n: Notification, raw: ChannelConfig): Promise<SendResult> {
    const cfg = raw as EmailConfig;
    const apiKey = cfg.api_key;
    const from = cfg.from_address;
    if (!apiKey || !from) return { ok: false, error: "Resend api_key / from_address missing in channel config" };
    if (!cfg.address) return { ok: false, error: "missing recipient address" };

    const html = `
      <div style="font-family:system-ui,sans-serif">
        <h2 style="margin:0 0 8px 0">${escapeHtml(n.title)}</h2>
        <p style="margin:0 0 12px 0">${escapeHtml(n.body)}</p>
        <p><a href="${escapeHtml(n.url)}">View Deal</a></p>
      </div>`;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: cfg.address,
        subject: n.title,
        html,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `resend ${res.status}: ${text.slice(0, 200)}` };
    }
    return { ok: true };
  },
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
