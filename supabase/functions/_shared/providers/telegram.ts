import type { Provider, Notification, ChannelConfig, SendResult } from "./types.ts";

interface TelegramConfig { chat_id?: string }

export const telegramProvider: Provider = {
  type: "telegram",
  displayName: "Telegram",
  description: "Push to a Telegram chat via our bot. Free, fast, supports inline buttons.",
  requiresGlobalSecrets: true, // needs TELEGRAM_BOT_TOKEN

  async send(n: Notification, raw: ChannelConfig): Promise<SendResult> {
    const cfg = raw as TelegramConfig;
    const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
    if (!token) return { ok: false, error: "TELEGRAM_BOT_TOKEN not set" };
    if (!cfg.chat_id) return { ok: false, error: "missing chat_id" };

    const text = [
      `<b>${escapeHtml(n.title)}</b>`,
      "",
      escapeHtml(n.body),
    ].join("\n");

    const keyboard = (n.actions ?? [])
      .filter((a) => a.url || a.callback)
      .map((a) => [a.url
        ? { text: a.label, url: a.url }
        : { text: a.label, callback_data: a.callback }]);

    if (n.url) keyboard.unshift([{ text: "View Deal", url: n.url }]);

    const res = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: cfg.chat_id,
          text,
          parse_mode: "HTML",
          disable_notification: n.silent,
          reply_markup: keyboard.length > 0 ? { inline_keyboard: keyboard } : undefined,
        }),
      },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `telegram ${res.status}: ${body.slice(0, 200)}` };
    }
    return { ok: true };
  },
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
