// =============================================================================
// notifier
// -----------------------------------------------------------------------------
// Triggered by pg_net from the alert_matches AFTER INSERT trigger.
// Resolves the target channels for the user/alert, dispatches via the provider
// registry, logs each attempt to notifications_sent.
//
// To add a new notification service: edit _shared/providers/index.ts.
// =============================================================================

import { serviceClient } from "../_shared/db.ts";
import { providers, type Notification } from "../_shared/providers/index.ts";

interface TriggerPayload {
  match_id: number;
  user_id: string;
  alert_id: string;
  deal_id: number;
}

Deno.serve(async (req) => {
  // verify_jwt:true on deploy means Supabase already validated the signature.
  // We only need to confirm the role claim is service_role so anon callers
  // can't trigger a notification fanout.
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ") || !isServiceRole(auth.slice("Bearer ".length))) {
    return new Response("unauthorized", { status: 401 });
  }

  let payload: TriggerPayload;
  try { payload = await req.json(); }
  catch { return new Response("invalid json", { status: 400 }); }

  const supa = serviceClient();

  const [{ data: deal }, { data: alert }, { data: settings }] =
    await Promise.all([
      supa.from("deals").select("*").eq("id", payload.deal_id).single(),
      supa.from("alerts").select("*").eq("id", payload.alert_id).single(),
      supa.from("user_settings").select("*").eq("user_id", payload.user_id).single(),
    ]);

  if (!deal || !alert || !settings) {
    return new Response("missing related rows", { status: 404 });
  }

  // Resolve target channels:
  //  - If alert.channel_ids is non-empty, use only those (intersected with enabled+verified).
  //  - Otherwise (empty array = "all"), use every enabled+verified channel for the user.
  let channelQuery = supa
    .from("notification_channels")
    .select("*")
    .eq("user_id", payload.user_id)
    .eq("enabled", true)
    .not("verified_at", "is", null);

  if (alert.channel_ids && alert.channel_ids.length > 0) {
    channelQuery = channelQuery.in("id", alert.channel_ids);
  }
  const { data: channels } = await channelQuery;

  if (!channels || channels.length === 0) {
    return Response.json({ sent: [], reason: "no verified channels" });
  }

  const silent =
    alert.priority !== "urgent" && withinQuietHours(settings);

  const priority: 1 | 2 | 3 | 4 | 5 =
    alert.priority === "urgent" ? 5 :
    alert.priority === "silent" ? 1 :
    3;

  // Per-alert toggle: when include_images is false, drop the thumbnail so
  // Twilio falls back to plain SMS (cheaper) and Telegram/etc. send text-only.
  const wantImages = alert.include_images !== false; // default true
  const notification: Notification = {
    title: truncate(deal.title, 140),
    body: buildBody(alert.name, deal),
    url: deal.url,
    priority,
    silent,
    thumbnailUrl: wantImages ? (deal.thumbnail_url ?? null) : null,
    dealId: deal.id,
  };

  const now = new Date();
  const rssToSentMs = deal.rss_pub_at
    ? now.getTime() - new Date(deal.rss_pub_at).getTime()
    : null;
  const pollToSentMs = deal.first_seen_at
    ? now.getTime() - new Date(deal.first_seen_at).getTime()
    : null;

  // Fan out in parallel.
  const results = await Promise.all(channels.map(async (ch) => {
    const provider = providers[ch.type];
    if (!provider) {
      return { id: ch.id, type: ch.type, ok: false, error: "unknown provider" };
    }
    try {
      const r = await provider.send(notification, ch.config ?? {});
      return { id: ch.id, type: ch.type, ok: r.ok, error: r.error };
    } catch (e) {
      return { id: ch.id, type: ch.type, ok: false, error: String(e) };
    }
  }));

  await supa.from("notifications_sent").insert(
    results.map((r) => ({
      user_id: payload.user_id,
      deal_id: payload.deal_id,
      channel_id: r.id,
      channel_type: r.type,
      rss_to_sent_ms: rssToSentMs,
      poll_to_sent_ms: pollToSentMs,
      ok: r.ok,
      error: r.error ?? null,
    })),
  );

  return Response.json({ sent: results });
});

function isServiceRole(jwt: string): boolean {
  try {
    const parts = jwt.split(".");
    if (parts.length < 2) return false;
    const payload = JSON.parse(atob(parts[1]!.replace(/-/g, "+").replace(/_/g, "/")));
    return payload?.role === "service_role";
  } catch {
    return false;
  }
}

function buildBody(
  alertName: string,
  deal: {
    title: string;
    price: number | null;
    store: string | null;
    merchant: string | null;
    merchant_domain: string | null;
    thumb_score: number | null;
    rss_pub_at: string | null;
  },
): string {
  // Body is everything BUT the title (the title is shown separately above by
  // each provider). Keep it tight: price + merchant line, optional score line,
  // footer with alert + posted-ago.
  const parts: string[] = [];

  const merchant = resolveMerchantLabel(deal);
  const priceLine = formatPriceLine(deal.price, merchant);
  if (priceLine) parts.push(priceLine);

  if (deal.thumb_score != null) {
    const sign = deal.thumb_score >= 0 ? "+" : "";
    parts.push(`👍 ${sign}${deal.thumb_score} community score`);
  }

  const footer = [
    alertName,
    deal.rss_pub_at ? humanAgo(new Date(deal.rss_pub_at)) : null,
  ].filter(Boolean).join(" · ");
  if (footer) parts.push(footer);
  return parts.join("\n");
}

function resolveMerchantLabel(d: { store: string | null; merchant: string | null; merchant_domain: string | null }): string | null {
  // Prefer the most user-recognizable form. Domain > unslugged slug > title-mined store.
  if (d.merchant_domain) return d.merchant_domain;
  if (d.merchant) return unslug(d.merchant);
  return d.store;
}

function unslug(s: string): string {
  return s
    .split("-")
    .map((w) => (w.length === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

function formatPriceLine(price: number | null, merchant: string | null): string {
  if (price == null && !merchant) return "";
  const p = price != null ? `$${price.toFixed(2)}` : "";
  if (!merchant) return p;
  if (!p)        return `at ${merchant}`;
  return `${p} at ${merchant}`;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function humanAgo(d: Date): string {
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function withinQuietHours(settings: {
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  timezone: string;
}): boolean {
  if (!settings.quiet_hours_start || !settings.quiet_hours_end) return false;
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: settings.timezone,
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const parts = fmt.formatToParts(new Date());
  const hh = parts.find((p) => p.type === "hour")?.value ?? "00";
  const mm = parts.find((p) => p.type === "minute")?.value ?? "00";
  const now = `${hh}:${mm}`;
  const start = settings.quiet_hours_start.slice(0, 5);
  const end = settings.quiet_hours_end.slice(0, 5);
  if (start <= end) return now >= start && now < end;
  return now >= start || now < end;
}
