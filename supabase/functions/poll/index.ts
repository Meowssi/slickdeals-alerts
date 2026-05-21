// =============================================================================
// poll
// -----------------------------------------------------------------------------
// One polling pass per invocation. Triggered by pg_cron every 30s.
// Lists enabled alerts, fetches RSS for each (conditional GET via ETag /
// If-Modified-Since), parses, upserts new deals, inserts matches. The
// notify_on_match DB trigger fans matches out via the user's channels.
//
// Auth: service_role JWT in Authorization header (pg_cron passes this from
// the vault entry — see invoke_poll() in the schedule migration).
// =============================================================================

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { XMLParser } from "https://esm.sh/fast-xml-parser@4.5.0";

const MAX_BACKOFF_SECONDS = 10 * 60;
const MAX_CONCURRENT = 2;
const USER_AGENT = "SlickdealsAlerts/0.1 (+https://github.com/Meowssi/slickdeals-alerts)";

interface AlertRow {
  id: string;
  user_id: string;
  name: string;
  rss_url: string;
  title_include: string[];
  title_exclude: string[];
  min_price: number | null;
  max_price: number | null;
  last_polled_at: string | null;
  last_etag: string | null;
  last_modified: string | null;
  consecutive_errors: number;
}

interface DealItem {
  slickdealsId: string;
  title: string;
  url: string;
  price: number | null;
  store: string | null;
  thumbnailUrl: string | null;
  pubAt: Date | null;
  raw: Record<string, unknown>;
}

Deno.serve(async (req) => {
  // verify_jwt:true on the function deploy means Supabase has already
  // validated the JWT signature. We only need to confirm the role claim
  // is service_role so anon-key callers can't trigger a polling pass.
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ") || !isServiceRole(auth.slice("Bearer ".length))) {
    return new Response("unauthorized", { status: 401 });
  }

  const supa = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const result = await tick(supa);
  return Response.json(result);
});

async function tick(supa: SupabaseClient): Promise<{ polled: number; matches: number; ms: number }> {
  const start = Date.now();
  const { data: alertsRaw, error } = await supa
    .from("alerts")
    .select("id, user_id, name, rss_url, title_include, title_exclude, min_price, max_price, last_polled_at, last_etag, last_modified, consecutive_errors")
    .eq("enabled", true)
    .order("last_polled_at", { ascending: true, nullsFirst: true });
  if (error) {
    return { polled: 0, matches: 0, ms: Date.now() - start };
  }
  const alerts = (alertsRaw ?? []) as AlertRow[];
  const now = Date.now();
  const due = alerts.filter((a) => isDue(a, now));
  if (due.length === 0) return { polled: 0, matches: 0, ms: Date.now() - start };

  let totalMatches = 0;
  await runWithConcurrency(due, MAX_CONCURRENT, async (alert) => {
    totalMatches += await pollOne(supa, alert);
  });
  return { polled: due.length, matches: totalMatches, ms: Date.now() - start };
}

function isDue(a: { last_polled_at: string | null; consecutive_errors: number }, now: number): boolean {
  if (!a.last_polled_at) return true;
  if (a.consecutive_errors === 0) return true;
  const backoffSec = Math.min(MAX_BACKOFF_SECONDS, Math.pow(2, a.consecutive_errors) * 5);
  const last = new Date(a.last_polled_at).getTime();
  return now - last >= backoffSec * 1000;
}

async function pollOne(supa: SupabaseClient, alert: AlertRow): Promise<number> {
  try {
    const fetched = await fetchFeed(alert.rss_url, alert.last_etag, alert.last_modified);

    if (fetched.status === 304) {
      await supa.from("alerts").update({
        last_polled_at: new Date().toISOString(),
        last_error: null,
        consecutive_errors: 0,
      }).eq("id", alert.id);
      return 0;
    }
    if (fetched.status >= 400 || !fetched.body) {
      await supa.from("alerts").update({
        last_polled_at: new Date().toISOString(),
        last_error: `HTTP ${fetched.status}`,
        consecutive_errors: alert.consecutive_errors + 1,
      }).eq("id", alert.id);
      return 0;
    }

    const items = parseRss(fetched.body);
    let newMatches = 0;
    for (const item of items) {
      if (!dealMatchesAlert(item, alert)) continue;
      const dealId = await upsertDeal(supa, item);
      if (!dealId) continue;
      const inserted = await insertMatch(supa, alert.user_id, alert.id, dealId);
      if (inserted) newMatches++;
    }

    await supa.from("alerts").update({
      last_polled_at: new Date().toISOString(),
      last_etag: fetched.etag,
      last_modified: fetched.lastModified,
      last_error: null,
      consecutive_errors: 0,
    }).eq("id", alert.id);

    return newMatches;
  } catch (err) {
    await supa.from("alerts").update({
      last_polled_at: new Date().toISOString(),
      last_error: String(err).slice(0, 200),
      consecutive_errors: alert.consecutive_errors + 1,
    }).eq("id", alert.id);
    return 0;
  }
}

async function fetchFeed(
  url: string, etag: string | null, lastModified: string | null,
): Promise<{ status: number; body: string | null; etag: string | null; lastModified: string | null }> {
  const headers: Record<string, string> = {
    "User-Agent": USER_AGENT,
    "Accept": "application/rss+xml, application/xml;q=0.9, */*;q=0.5",
  };
  if (etag) headers["If-None-Match"] = etag;
  if (lastModified) headers["If-Modified-Since"] = lastModified;

  const res = await fetch(url, {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(20_000),
  });
  const newEtag = res.headers.get("etag");
  const newLastMod = res.headers.get("last-modified");
  if (res.status === 304) {
    return { status: 304, body: null, etag: newEtag, lastModified: newLastMod };
  }
  const body = await res.text();
  return { status: res.status, body, etag: newEtag, lastModified: newLastMod };
}

// ---------------------------------------------------------------------------
// RSS parsing
// ---------------------------------------------------------------------------

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseAttributeValue: true,
  trimValues: true,
});

// deno-lint-ignore no-explicit-any
function parseRss(xml: string): DealItem[] {
  const doc = xmlParser.parse(xml) as any;
  const items = doc?.rss?.channel?.item;
  if (!items) return [];
  const arr = Array.isArray(items) ? items : [items];
  return arr.map(rssItemToDeal).filter((d): d is DealItem => d !== null);
}

// deno-lint-ignore no-explicit-any
function rssItemToDeal(item: any): DealItem | null {
  const title = (item.title as string | undefined)?.trim();
  const link = (item.link as string | undefined)?.trim();
  if (!title || !link) return null;

  const guid = typeof item.guid === "string" ? item.guid : item.guid?.["#text"];
  const slickdealsId = (typeof guid === "string" && guid.trim()) || link;

  const pubAt = item.pubDate ? new Date(item.pubDate) : null;
  const thumbnailUrl =
    item["media:thumbnail"]?.["@_url"] ??
    item["media:content"]?.["@_url"] ??
    item.enclosure?.["@_url"] ??
    extractImgFromHtml(item["content:encoded"]) ??
    extractImgFromHtml(item.description) ??
    null;

  return {
    slickdealsId: String(slickdealsId),
    title,
    url: link,
    price: extractPrice(title) ?? extractPrice(String(item.description ?? "")),
    store: extractStore(title),
    thumbnailUrl,
    pubAt: pubAt && !Number.isNaN(pubAt.getTime()) ? pubAt : null,
    raw: item as Record<string, unknown>,
  };
}

function extractImgFromHtml(html: unknown): string | null {
  if (typeof html !== "string" || !html) return null;
  const m = html.match(/<img[^>]+src=["']([^"'>]+)["']/i);
  return m ? m[1]! : null;
}

function extractPrice(s: string): number | null {
  const m = s.match(/\$\s?([0-9]{1,3}(?:,?[0-9]{3})*(?:\.[0-9]{1,2})?)/);
  if (!m) return null;
  const n = Number(m[1]!.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function extractStore(title: string): string | null {
  const m = title.match(/\bat\s+([A-Z][\w.& '-]+?)\s*$/);
  return m ? m[1]!.trim() : null;
}

function dealMatchesAlert(deal: DealItem, filters: {
  title_include: string[]; title_exclude: string[];
  min_price: number | null; max_price: number | null;
}): boolean {
  const lower = deal.title.toLowerCase();
  if (filters.title_include?.length > 0) {
    const hit = filters.title_include.some((kw) => lower.includes(kw.toLowerCase()));
    if (!hit) return false;
  }
  if (filters.title_exclude?.length > 0) {
    const hit = filters.title_exclude.some((kw) => lower.includes(kw.toLowerCase()));
    if (hit) return false;
  }
  if (filters.min_price != null && deal.price != null && deal.price < filters.min_price) return false;
  if (filters.max_price != null && deal.price != null && deal.price > filters.max_price) return false;
  return true;
}

// ---------------------------------------------------------------------------
// DB writes
// ---------------------------------------------------------------------------

async function upsertDeal(supa: SupabaseClient, item: DealItem): Promise<number | null> {
  const { data, error } = await supa
    .from("deals")
    .upsert(
      {
        slickdeals_id: item.slickdealsId,
        title: item.title,
        url: item.url,
        price: item.price,
        store: item.store,
        thumbnail_url: item.thumbnailUrl,
        rss_pub_at: item.pubAt?.toISOString() ?? null,
        raw: item.raw,
      },
      { onConflict: "slickdeals_id", ignoreDuplicates: false },
    )
    .select("id")
    .single();
  if (error) return null;
  return (data as { id: number } | null)?.id ?? null;
}

async function insertMatch(
  supa: SupabaseClient, userId: string, alertId: string, dealId: number,
): Promise<boolean> {
  const { error } = await supa
    .from("alert_matches")
    .insert({ user_id: userId, alert_id: alertId, deal_id: dealId });
  if (error) {
    // Unique violation = already matched; expected on re-poll.
    return false;
  }
  return true;
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

async function runWithConcurrency<T>(
  items: T[], concurrency: number, worker: (item: T) => Promise<void>,
): Promise<void> {
  const queue = items.slice();
  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(concurrency, queue.length); i++) {
    workers.push((async () => {
      while (queue.length > 0) {
        const next = queue.shift();
        if (next === undefined) return;
        await worker(next);
      }
    })());
  }
  await Promise.all(workers);
}
