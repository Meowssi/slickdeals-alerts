// =============================================================================
// send-test
// -----------------------------------------------------------------------------
// POST { channel_id }  -> sends a test notification through that channel.
// Auth: user JWT.
// =============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { providers, type Notification } from "../_shared/providers/index.ts";

Deno.serve(async (req) => {
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

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supa = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { channel_id } = await req.json().catch(() => ({})) as { channel_id?: string };
  if (!channel_id) return new Response("missing channel_id", { status: 400 });

  const { data: ch } = await supa
    .from("notification_channels")
    .select("*")
    .eq("id", channel_id)
    .single();
  if (!ch || ch.user_id !== userRes.user.id) {
    return new Response("not found", { status: 404 });
  }

  const provider = providers[ch.type];
  if (!provider) return Response.json({ ok: false, error: "unknown provider" });

  const test: Notification = {
    title: "Slickdeals Alerts — Test",
    body: "If you can read this, your channel is wired up correctly. 🎉",
    url: "https://slickdeals.net",
    priority: 3,
    silent: false,
  };
  const r = await provider.send(test, ch.config ?? {});
  return Response.json(r);
});
