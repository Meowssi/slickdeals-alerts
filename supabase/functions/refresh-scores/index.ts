// =============================================================================
// refresh-scores
// -----------------------------------------------------------------------------
// Triggered by pg_cron every 5 minutes (see invoke_refresh_scores() in
// migration 20260524000001).
//
// Picks up to MAX_PER_RUN deals first_seen within the last MAX_AGE_HOURS,
// fetches the thread page on slickdeals.net, parses the current vote count
// from the GTM/datalayer JSON, and updates deals.thumb_score +
// deals.last_score_refresh_at.
//
// This is feed-only — the notifier reads its snapshot at notification time
// and won't re-fire for the same match. So updating thumb_score here changes
// the chip in the dashboard but never spams users with follow-up SMS/Telegram/
// etc. notifications.
//
// Auth: service_role JWT, same pattern as poll/notifier.
// =============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const MAX_AGE_HOURS = 12;
const MAX_PER_RUN   = 30;
const MAX_CONCURRENT = 5;
const USER_AGENT    = "SlickdealsAlerts/0.1 (+https://github.com/Meowssi/slickdeals-alerts)";

interface DealRow {
  id: number;
  url: string;
}

Deno.serve(async (req) => {
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ") || !isServiceRole(auth.slice("Bearer ".length))) {
    return new Response("unauthorized", { status: 401 });
  }

  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin":  "*",
        "Access-Control-Allow-Headers": "authorization, content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
    });
  }

  const supa = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Oldest-refresh-first, so every deal gets a turn within the 12h window.
  const since = new Date(Date.now() - MAX_AGE_HOURS * 3600 * 1000).toISOString();
  const { data: deals, error } = await supa
    .from("deals")
    .select("id, url")
    .gte("first_seen_at", since)
    .order("last_score_refresh_at", { ascending: true, nullsFirst: true })
    .limit(MAX_PER_RUN);

  if (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
  if (!deals || deals.length === 0) {
    return Response.json({ ok: true, refreshed: 0, reason: "nothing eligible" });
  }

  const results = await mapWithConcurrency(deals as DealRow[], MAX_CONCURRENT, async (d) => {
    try {
      const score = await fetchThumbScore(d.url);
      const patch: { thumb_score?: number | null; last_score_refresh_at: string } = {
        last_score_refresh_at: new Date().toISOString(),
      };
      if (score !== null) patch.thumb_score = score;
      await supa.from("deals").update(patch).eq("id", d.id);
      return { id: d.id, ok: true, score };
    } catch (e) {
      // Still bump last_score_refresh_at so a permanently-broken URL doesn't
      // block the queue from advancing.
      await supa.from("deals").update({ last_score_refresh_at: new Date().toISOString() }).eq("id", d.id);
      return { id: d.id, ok: false, error: String(e) };
    }
  });

  return Response.json({
    ok: true,
    refreshed: results.filter((r) => r.ok).length,
    failed:    results.filter((r) => !r.ok).length,
  });
});

async function fetchThumbScore(url: string): Promise<number | null> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, "Accept": "text/html" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  return parseScoreFromHtml(html);
}

/**
 * Slickdeals embeds the live vote count in the GTM dataLayer JSON near the
 * top of the page:
 *   "postedBy":"Red_Liz | Staff","comments":"15","votes":"36",...
 * The "votes" field tracks the same net-thumbs metric the RSS exposes as
 * "Thumb Score: +N" (with the sign normalized — RSS keeps the sign, the
 * dataLayer drops it because the field is also used by GTM as a string).
 *
 * Exported so we can unit-test the parser without making network calls.
 */
export function parseScoreFromHtml(html: string): number | null {
  // Look for "votes":"<n>" first (canonical, server-rendered).
  const m1 = html.match(/"votes"\s*:\s*"([+-]?\d+)"/);
  if (m1) {
    const n = Number(m1[1]);
    return Number.isFinite(n) ? n : null;
  }
  // Fallback: try the visible voteCount element near the main thumbsUp button.
  const m2 = html.match(/dealVoting__voteCount[^>]*>([+-]?\d+)</);
  if (m2) {
    const n = Number(m2[1]);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return out;
}

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
