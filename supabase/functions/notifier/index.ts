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
  const auth = req.headers.get("Authorization");
  const expected = `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`;
  if (!auth || auth !== expected) {
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

  const notification: Notification = {
    title: `${alert.name}: ${truncate(deal.title, 80)}`,
    body: buildBody(alert.name, deal),
    url: deal.url,
    priority,
    silent,
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

function buildBody(
  alertName: string,
  deal: {
    title: string;
    price: number | null;
    store: string | null;
    rss_pub_at: string | null;
  },
): string {
  const lines: string[] = [];
  if (deal.price != null) {
    lines.push(deal.store ? `$${deal.price.toFixed(2)} @ ${deal.store}` : `$${deal.price.toFixed(2)}`);
  } else if (deal.store) {
    lines.push(`@ ${deal.store}`);
  }
  lines.push(deal.title);
  if (deal.rss_pub_at) lines.push(`Posted ${humanAgo(new Date(deal.rss_pub_at))}`);
  lines.push(`(${alertName})`);
  return lines.join("\n");
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
