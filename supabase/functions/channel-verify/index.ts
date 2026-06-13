// =============================================================================
// channel-verify
// -----------------------------------------------------------------------------
// Called by the dashboard to verify a notification channel. Supports two phases:
//
//   POST { channel_id, action: "start" }
//     - Generates a verification_code and (for SMS/etc.) delivers it via the
//       channel itself. For Telegram, returns the code + deep link.
//
//   POST { channel_id, action: "confirm", code: "ABC123" }
//     - For SMS/Twilio: verifies user-supplied code matches.
//     - For Telegram: not used (the bot's /link command confirms instead).
//
// Auth: user JWT in Authorization header. Verifies channel.user_id == JWT user.
// =============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

interface StartReq  { channel_id: string; action: "start" }
interface ConfirmReq { channel_id: string; action: "confirm"; code: string }
type Req = StartReq | ConfirmReq;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  const res = await handle(req);
  for (const [k, v] of Object.entries(CORS_HEADERS)) res.headers.set(k, v);
  return res;
});

async function handle(req: Request): Promise<Response> {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return new Response("unauthorized", { status: 401 });
  const jwt = auth.slice("Bearer ".length);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const supaUser = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: userRes } = await supaUser.auth.getUser();
  if (!userRes?.user) return new Response("unauthorized", { status: 401 });
  const userId = userRes.user.id;

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supa = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const body = await req.json().catch(() => null) as Req | null;
  if (!body) return new Response("bad json", { status: 400 });

  const { data: ch } = await supa
    .from("notification_channels")
    .select("*")
    .eq("id", body.channel_id)
    .single();
  if (!ch || ch.user_id !== userId) return new Response("not found", { status: 404 });

  if (body.action === "start")   return await startVerification(supa, ch);
  if (body.action === "confirm") return await confirmVerification(supa, ch, body.code);
  return new Response("bad action", { status: 400 });
}

async function startVerification(
  // deno-lint-ignore no-explicit-any
  supa: any,
  ch: { id: string; type: string; config: Record<string, unknown> },
): Promise<Response> {
  const code = generateCode(6);
  const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  await supa.from("notification_channels").update({
    verification_code: code,
    verification_expires_at: expires,
  }).eq("id", ch.id);

  if (ch.type === "telegram") {
    const botUsername = Deno.env.get("TELEGRAM_BOT_USERNAME") ?? "";
    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
    if (!botUsername || !botToken) {
      // Roll back the code we just wrote — it's useless without a bot.
      await supa.from("notification_channels").update({
        verification_code: null,
        verification_expires_at: null,
      }).eq("id", ch.id);
      return Response.json({
        ok: false,
        error: "telegram_not_configured",
        needs_admin: true,
        message: "Your deployer needs to set up a Telegram bot first. See /admin/setup.",
      }, { status: 400 });
    }
    return Response.json({
      ok: true,
      code,
      instructions: "Send `/link CODE` to the bot, or tap the deep link.",
      deeplink: `https://t.me/${botUsername}?start=${code}`,
      expires_in_seconds: 900,
    });
  }

  if (ch.type === "sms_telnyx") {
    const cfg = ch.config as { phone?: string; api_key?: string; from_number?: string };
    const phone = cfg.phone;
    const apiKey = cfg.api_key;
    const from = cfg.from_number;
    if (!phone || !apiKey || !from) {
      return Response.json({ ok: false, error: "Telnyx api_key, from_number, and phone are all required in the channel config" }, { status: 400 });
    }
    const res = await fetch("https://api.telnyx.com/v2/messages", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: phone,
        text: `Your Slickdeals Alerts verification code: ${code}`,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return Response.json({ ok: false, error: `telnyx ${res.status}: ${body.slice(0, 200)}` }, { status: 400 });
    }
    return Response.json({
      ok: true,
      instructions: "Check your phone for a 6-character code.",
      expires_in_seconds: 900,
    });
  }

  // Pushover requires a deployer-side PUSHOVER_APP_TOKEN (free, registered at pushover.net).
  // Block here so the user wizard can surface "ask your admin" instead of silently
  // auto-verifying a channel that won't actually send.
  if (ch.type === "pushover" && !Deno.env.get("PUSHOVER_APP_TOKEN")) {
    return Response.json({
      ok: false,
      error: "pushover_not_configured",
      needs_admin: true,
      message: "Your deployer needs to register a Pushover application (free). See /admin/setup.",
    }, { status: 400 });
  }

  // Other channels (ntfy, discord, email, webhook): no out-of-band verification.
  // Auto-verify; user can hit "Send test" from settings to confirm it works.
  await supa.from("notification_channels").update({
    verified_at: new Date().toISOString(),
    verification_code: null,
    verification_expires_at: null,
  }).eq("id", ch.id);
  return Response.json({ ok: true, auto_verified: true });
}

async function confirmVerification(
  // deno-lint-ignore no-explicit-any
  supa: any,
  ch: { id: string; verification_code: string | null; verification_expires_at: string | null },
  code: string,
): Promise<Response> {
  if (!ch.verification_code || ch.verification_code !== code) {
    return Response.json({ ok: false, error: "invalid code" }, { status: 400 });
  }
  if (ch.verification_expires_at &&
      new Date(ch.verification_expires_at).getTime() < Date.now()) {
    return Response.json({ ok: false, error: "expired" }, { status: 400 });
  }
  await supa.from("notification_channels").update({
    verified_at: new Date().toISOString(),
    verification_code: null,
    verification_expires_at: null,
  }).eq("id", ch.id);
  return Response.json({ ok: true });
}

function generateCode(len: number): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const buf = new Uint8Array(len);
  crypto.getRandomValues(buf);
  let out = "";
  for (let i = 0; i < len; i++) out += chars[buf[i]! % chars.length];
  return out;
}
