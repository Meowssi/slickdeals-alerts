import type { Provider, Notification, ChannelConfig, SendResult } from "./types.ts";

interface TelegramConfig { chat_id?: string }

const TELEGRAM_CAPTION_MAX = 1024;     // sendPhoto caption hard limit
const TELEGRAM_MESSAGE_MAX = 4096;     // sendMessage text limit

export const telegramProvider: Provider = {
  type: "telegram",
  displayName: "Telegram",
  description: "Push to a Telegram chat via our bot. Free, fast, supports inline buttons + images.",
  requiresGlobalSecrets: true, // needs TELEGRAM_BOT_TOKEN

  async send(n: Notification, raw: ChannelConfig): Promise<SendResult> {
    const cfg = raw as TelegramConfig;
    const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
    if (!token) return { ok: false, error: "TELEGRAM_BOT_TOKEN not set" };
    if (!cfg.chat_id) return { ok: false, error: "missing chat_id" };

    const caption = buildCaption(n);
    const keyboard = buildKeyboard(n);
    const reply_markup = keyboard.length > 0 ? { inline_keyboard: keyboard } : undefined;

    // Prefer sendPhoto when we have a thumbnail — the image makes the
    // notification far more scannable on mobile.
    if (n.thumbnailUrl) {
      const photoRes = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: cfg.chat_id,
          photo: n.thumbnailUrl,
          caption: truncate(caption, TELEGRAM_CAPTION_MAX),
          parse_mode: "HTML",
          disable_notification: n.silent,
          reply_markup,
        }),
      });
      if (photoRes.ok) return { ok: true };
      // If sendPhoto fails (broken URL, unsupported format), fall through to
      // sendMessage so we still deliver something rather than dropping the alert.
    }

    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: cfg.chat_id,
        text: truncate(caption, TELEGRAM_MESSAGE_MAX),
        parse_mode: "HTML",
        disable_web_page_preview: false,
        disable_notification: n.silent,
        reply_markup,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `telegram ${res.status}: ${body.slice(0, 200)}` };
    }
    return { ok: true };
  },
};

function buildCaption(n: Notification): string {
  // The notifier hands us a `body` already shaped as the right summary lines.
  // Title goes on top (bold). No redundant title in the body.
  const parts: string[] = [];
  if (n.title) parts.push(`<b>${escapeHtml(n.title)}</b>`);
  if (n.body) parts.push(escapeHtml(n.body));
  return parts.join("\n\n");
}

function buildKeyboard(n: Notification): Array<Array<{ text: string; url?: string; callback_data?: string }>> {
  const buttons: Array<{ text: string; url?: string; callback_data?: string }> = [];
  if (n.url) buttons.push({ text: "🛒 View Deal", url: n.url });
  if (n.dealId) {
    buttons.push({ text: "💾 Save",    callback_data: `save:${n.dealId}` });
    buttons.push({ text: "🗑 Dismiss", callback_data: `dismiss:${n.dealId}` });
  }
  // Any extra custom actions passed in.
  for (const a of n.actions ?? []) {
    if (!a.url && !a.callback) continue;
    buttons.push(a.url
      ? { text: a.label, url: a.url }
      : { text: a.label, callback_data: a.callback! });
  }
  // Telegram inline keyboards: each sub-array is one row. Use one row of 3
  // buttons (View / Save / Dismiss) so they stay compact on mobile.
  if (buttons.length === 0) return [];
  if (buttons.length <= 3) return [buttons];
  return [buttons.slice(0, 3), buttons.slice(3)];
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
