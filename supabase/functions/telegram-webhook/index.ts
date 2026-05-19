// =============================================================================
// telegram-webhook
// -----------------------------------------------------------------------------
// Inbound from Telegram. Handles:
//   - /start, /help           -> friendly reply with link instructions
//   - /link CODE              -> claim the matching unverified telegram channel
//   - inline button callbacks "save:<deal_id>" | "dismiss:<deal_id>"
//
// Telegram is told to POST to:
//   https://<ref>.functions.supabase.co/telegram-webhook?secret=<TELEGRAM_WEBHOOK_SECRET>
// =============================================================================

import { serviceClient } from "../_shared/db.ts";

const TELEGRAM_API = "https://api.telegram.org";

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (url.searchParams.get("secret") !== Deno.env.get("TELEGRAM_WEBHOOK_SECRET")) {
    return new Response("forbidden", { status: 403 });
  }

  const token = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
  const supa = serviceClient();
  const update = await req.json().catch(() => null);
  if (!update) return new Response("bad json", { status: 400 });

  // ---- inline button callback (save / dismiss) ----
  if (update.callback_query) {
    const cq = update.callback_query;
    const chatId = String(cq.message?.chat?.id ?? "");
    const [action, idStr] = String(cq.data ?? "").split(":");
    const dealId = Number(idStr);
    if (!chatId || !dealId || (action !== "save" && action !== "dismiss")) {
      await answerCallback(token, cq.id, "Invalid action");
      return new Response("ok");
    }
    // Find user via verified telegram channel for this chat.
    const { data: ch } = await supa
      .from("notification_channels")
      .select("user_id")
      .eq("type", "telegram")
      .eq("config->>chat_id", chatId)
      .not("verified_at", "is", null)
      .single();
    if (!ch) {
      await answerCallback(token, cq.id, "Not linked");
      return new Response("ok");
    }
    await supa.from("deal_state").upsert({
      user_id: ch.user_id,
      deal_id: dealId,
      saved: action === "save",
      dismissed: action === "dismiss",
      read_at: new Date().toISOString(),
    });
    await answerCallback(token, cq.id, action === "save" ? "Saved" : "Dismissed");
    return new Response("ok");
  }

  // ---- text message ----
  const msg = update.message;
  if (!msg?.text) return new Response("ok");
  const chatId = String(msg.chat.id);
  const text = (msg.text as string).trim();

  // Telegram deep-link: `start=CODE` sends `/start CODE` on first interaction.
  let code: string | null = null;
  if (text.startsWith("/start ")) code = text.slice("/start ".length).trim();
  else if (text.startsWith("/link ")) code = text.slice("/link ".length).trim();

  if (text === "/start" || text === "/help") {
    await sendMessage(token, chatId,
      "👋 Hi! I'm the Slickdeals Alerts bot.\n\n" +
      "To connect this chat to your dashboard, go to <b>Settings → Channels</b> on the dashboard, " +
      "add a Telegram channel, and tap the deep-link or send me <code>/link YOUR_CODE</code>.",
    );
    return new Response("ok");
  }

  if (code) {
    // Find an unverified telegram channel with this verification code.
    const { data: ch } = await supa
      .from("notification_channels")
      .select("id, user_id, expires_at:verification_expires_at")
      .eq("type", "telegram")
      .eq("verification_code", code)
      .is("verified_at", null)
      .single();

    if (!ch) {
      await sendMessage(token, chatId, "❌ Invalid or already-used code.");
      return new Response("ok");
    }
    if (ch.expires_at && new Date(ch.expires_at).getTime() < Date.now()) {
      await sendMessage(token, chatId, "❌ Code expired. Generate a new one.");
      return new Response("ok");
    }

    await supa
      .from("notification_channels")
      .update({
        config: { chat_id: chatId },
        verified_at: new Date().toISOString(),
        verification_code: null,
        verification_expires_at: null,
      })
      .eq("id", ch.id);

    await sendMessage(token, chatId, "✅ Linked! Deal alerts will appear here.");
    return new Response("ok");
  }

  return new Response("ok");
});

async function sendMessage(token: string, chatId: string, html: string): Promise<void> {
  await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: html, parse_mode: "HTML" }),
  });
}

async function answerCallback(token: string, id: string, text: string): Promise<void> {
  await fetch(`${TELEGRAM_API}/bot${token}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: id, text }),
  });
}
