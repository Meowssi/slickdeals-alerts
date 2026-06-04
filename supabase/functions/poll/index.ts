// =============================================================================
// poll
// -----------------------------------------------------------------------------
// One polling pass per invocation. Triggered by pg_cron every 60s.
// Lists enabled alerts, fetches RSS for each (conditional GET via ETag /
// If-Modified-Since), parses, batch-upserts only-new deals, batch-inserts
// matches. The notify_on_match DB trigger fans matches out via the user's
// channels.
//
// Egress note: PostgREST responses cost ~600-800B of headers each, so this
// function batches DB writes into a fixed number of round-trips per feed
// (lookup + deals upsert + matches insert) instead of one per RSS item.
// Per-item requests at a 30s cadence were ~600MB/month of pure header
// egress — enough to blow the Supabase free tier on their own.
//
// Auth: service_role JWT in Authorization header (pg_cron passes this from
// the vault entry — see invoke_poll() in the schedule migration).
// =============================================================================

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { XMLParser } from "https://esm.sh/fast-xml-parser@4.5.0";

const MAX_BACKOFF_SECONDS = 10 * 60;
const MAX_CONCURRENT = 2;
const USER_AGENT = "SlickdealsAlerts/0.1 (+https://github.com/Meowssi/slickdeals-alerts)";
// A brand-new alert sees a feed full of pre-existing deals. Cap the backfill
// so creating an alert doesn't flood the feed + notification channels with
// 25+ old items — only the newest few seed the feed.
const FIRST_POLL_MAX_MATCHES = 10;

interface AlertRow {
  id: string;
  user_id: string;
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

// Mirror of packages/shared/src/types.ts DealItem — duplicated here because
// Deno edge functions can't import the workspace package.
interface DealItem {
  slickdealsId: string;
  title: string;
  url: string;
  price: number | null;
  store: string | null;
  thumbnailUrl: string | null;
  pubAt: Date | null;
  thumbScore: number | null;
  merchant: string | null;
  merchantDomain: string | null;
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
    .select("id, user_id, rss_url, title_include, title_exclude, min_price, max_price, last_polled_at, last_etag, last_modified, consecutive_errors")
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
    let matched = items.filter((item) => dealMatchesAlert(item, alert));

    // First poll for this alert: everything in the feed is "old news". Keep
    // only the newest few so the user isn't flooded with backlog matches.
    if (!alert.last_polled_at && matched.length > FIRST_POLL_MAX_MATCHES) {
      matched = [...matched]
        .sort((a, b) => (b.pubAt?.getTime() ?? 0) - (a.pubAt?.getTime() ?? 0))
        .slice(0, FIRST_POLL_MAX_MATCHES);
    }

    const newMatches = await upsertDealsAndMatches(supa, alert, matched);

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
  const html = typeof item["content:encoded"] === "string" ? item["content:encoded"] : "";
  const thumbnailUrl =
    item["media:thumbnail"]?.["@_url"] ??
    item["media:content"]?.["@_url"] ??
    item.enclosure?.["@_url"] ??
    extractImgFromHtml(html) ??
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
    thumbScore: extractThumbScore(html),
    merchant: extractMerchantSlug(html),
    merchantDomain: extractMerchantDomain(html),
    raw: item as Record<string, unknown>,
  };
}

function extractImgFromHtml(html: unknown): string | null {
  if (typeof html !== "string" || !html) return null;
  const m = html.match(/<img[^>]+src=["']([^"'>]+)["']/i);
  return m ? m[1]! : null;
}

function extractThumbScore(html: string): number | null {
  if (!html) return null;
  const m = html.match(/Thumb\s*Score\s*:\s*([+-]?\d+)/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function extractMerchantSlug(html: string): string | null {
  if (!html) return null;
  const m = html.match(/data-store-slug=["']([^"']+)["']/i);
  return m ? m[1]! : null;
}

function extractMerchantDomain(html: string): string | null {
  if (!html) return null;
  const m = html.match(/data-product-exitWebsite=["']([^"']+)["']/i);
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

function dealRow(item: DealItem) {
  return {
    slickdeals_id: item.slickdealsId,
    title: item.title,
    url: item.url,
    price: item.price,
    store: item.store,
    thumbnail_url: item.thumbnailUrl,
    thumb_score: item.thumbScore,
    merchant: item.merchant,
    merchant_domain: item.merchantDomain,
    rss_pub_at: item.pubAt?.toISOString() ?? null,
    raw: item.raw,
  };
}

// Persist a feed's matching items in three batched round-trips instead of one
// request per item: (1) look up which deals we already know, (2) insert only
// the genuinely new ones as a single array upsert, (3) insert matches as a
// single array insert that skips already-matched pairs. Existing deals are
// deliberately NOT re-upserted on every poll — vote scores are kept fresh by
// the refresh-scores function, and re-sending unchanged rows every tick was
// the main source of PostgREST egress.
async function upsertDealsAndMatches(
  supa: SupabaseClient, alert: AlertRow, items: DealItem[],
): Promise<number> {
  if (items.length === 0) return 0;

  // The same guid can repeat within a feed; keep the first occurrence.
  const bySdId = new Map<string, DealItem>();
  for (const item of items) {
    if (!bySdId.has(item.slickdealsId)) bySdId.set(item.slickdealsId, item);
  }

  const { data: existing, error: lookupErr } = await supa
    .from("deals")
    .select("id, slickdeals_id, title, url, price, thumbnail_url")
    .in("slickdeals_id", [...bySdId.keys()]);
  // A failed read means the DB itself is unhealthy (no bad-row to isolate),
  // so throw and let pollOne's backoff handle it; the matches insert is
  // idempotent and the next tick retries everything.
  if (lookupErr) throw new Error(`deals lookup failed: ${lookupErr.message}`);

  type ExistingRow = {
    id: number;
    slickdeals_id: string;
    title: string;
    url: string;
    price: number | null;
    thumbnail_url: string | null;
  };
  const existingBySdId = new Map<string, ExistingRow>(
    ((existing ?? []) as ExistingRow[]).map((r) => [r.slickdeals_id, r]),
  );
  const dealIdBySdId = new Map<string, number>(
    [...existingBySdId].map(([sdId, r]) => [sdId, r.id]),
  );

  // Write brand-new deals, plus existing deals whose user-visible fields
  // were edited on Slickdeals (title/url/price/thumbnail). Vote scores are
  // deliberately NOT part of the change check — they move on every fetch
  // and refresh-scores owns them — so steady-state writes stay at zero.
  const newItems = [...bySdId.values()].filter((it) => {
    const ex = existingBySdId.get(it.slickdealsId);
    if (!ex) return true;
    return ex.title !== it.title || ex.url !== it.url ||
      ex.price !== it.price || ex.thumbnail_url !== it.thumbnailUrl;
  });
  if (newItems.length > 0) {
    // upsert (not insert) so a concurrent worker racing on the same deal
    // doesn't error; onConflict resolves to the existing row's id.
    const { data: inserted, error: insertErr } = await supa
      .from("deals")
      .upsert(newItems.map(dealRow), { onConflict: "slickdeals_id", ignoreDuplicates: false })
      .select("id, slickdeals_id");
    if (insertErr) {
      // The batch failed — likely one poisoned row (e.g. an oversized raw
      // payload). Fall back to per-item upserts so a single bad item can't
      // block every other new deal for as long as it stays in the feed.
      // This path only runs on errors, so it doesn't affect normal egress.
      for (const it of newItems) {
        const { data: one } = await supa
          .from("deals")
          .upsert(dealRow(it), { onConflict: "slickdeals_id", ignoreDuplicates: false })
          .select("id, slickdeals_id")
          .single();
        if (one) dealIdBySdId.set((one as { slickdeals_id: string }).slickdeals_id, (one as { id: number }).id);
      }
    } else {
      for (const r of (inserted ?? []) as { id: number; slickdeals_id: string }[]) {
        dealIdBySdId.set(r.slickdeals_id, r.id);
      }
    }
  }

  const matchRows = [...bySdId.keys()]
    .map((sdId) => dealIdBySdId.get(sdId))
    .filter((id): id is number => id != null)
    .map((dealId) => ({ user_id: alert.user_id, alert_id: alert.id, deal_id: dealId }));
  if (matchRows.length === 0) return 0;

  // ignoreDuplicates:true → ON CONFLICT DO NOTHING on unique(alert_id, deal_id);
  // the response contains only the rows actually inserted, so its length is
  // the new-match count and the notify trigger fires only for those.
  const { data: insertedMatches, error: matchErr } = await supa
    .from("alert_matches")
    .upsert(matchRows, { onConflict: "alert_id,deal_id", ignoreDuplicates: true })
    .select("id");
  if (matchErr) {
    // Same bad-row isolation as the deals upsert: persist what we can
    // one-by-one rather than dropping every match in this batch.
    let count = 0;
    for (const row of matchRows) {
      const { error } = await supa.from("alert_matches").insert(row);
      if (!error) count++; // unique violation = already matched; expected
    }
    return count;
  }
  return (insertedMatches ?? []).length;
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
