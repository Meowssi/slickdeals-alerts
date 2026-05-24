// RSS 2.0 parser tailored for Slickdeals feeds.
// Slickdeals' RSS format: <rss><channel><item>...</item></channel></rss>
// Each item has: title, link, description, pubDate, guid (slickdeals_id).
// Prices and store names appear inline in title/description with various formats.

import { XMLParser } from "fast-xml-parser";
import type { DealItem } from "./types.js";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseAttributeValue: true,
  trimValues: true,
});

interface RssItem {
  title?: string;
  link?: string;
  description?: string;
  pubDate?: string;
  guid?: string | { "#text"?: string };
  category?: string | string[];
  "media:thumbnail"?: { "@_url"?: string };
  "media:content"?: { "@_url"?: string };
  enclosure?: { "@_url"?: string };
  "content:encoded"?: string;
  [key: string]: unknown;
}

interface RssDocument {
  rss?: {
    channel?: {
      item?: RssItem | RssItem[];
    };
  };
}

export function parseRss(xml: string): DealItem[] {
  const doc = parser.parse(xml) as RssDocument;
  const items = doc?.rss?.channel?.item;
  if (!items) return [];
  const arr = Array.isArray(items) ? items : [items];
  return arr.map(rssItemToDeal).filter((d): d is DealItem => d !== null);
}

function rssItemToDeal(item: RssItem): DealItem | null {
  const title = item.title?.trim();
  const link = item.link?.trim();
  if (!title || !link) return null;

  const guid =
    typeof item.guid === "string" ? item.guid : item.guid?.["#text"];
  const slickdealsId = guid?.trim() || link;

  const pubAt = item.pubDate ? new Date(item.pubDate) : null;
  const html = typeof item["content:encoded"] === "string" ? item["content:encoded"]! : "";

  const thumbnailUrl =
    item["media:thumbnail"]?.["@_url"] ??
    item["media:content"]?.["@_url"] ??
    item.enclosure?.["@_url"] ??
    extractImgFromHtml(html) ??
    extractImgFromHtml(item.description ?? "") ??
    null;

  return {
    slickdealsId,
    title,
    url: link,
    price: extractPrice(title) ?? extractPrice(item.description ?? ""),
    store: extractStore(title),
    thumbnailUrl,
    pubAt: pubAt && !Number.isNaN(pubAt.getTime()) ? pubAt : null,
    thumbScore: extractThumbScore(html),
    merchant: extractMerchantSlug(html),
    merchantDomain: extractMerchantDomain(html),
    raw: item as Record<string, unknown>,
  };
}

function extractImgFromHtml(html: string): string | null {
  if (!html) return null;
  const m = html.match(/<img[^>]+src=["']([^"'>]+)["']/i);
  return m ? m[1]! : null;
}

/** "Thumb Score: +31" / "Thumb Score: -2" → 31 / -2 */
function extractThumbScore(html: string): number | null {
  if (!html) return null;
  const m = html.match(/Thumb\s*Score\s*:\s*([+-]?\d+)/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/** First data-store-slug attribute (e.g. "clearance-chair", "amazon"). */
function extractMerchantSlug(html: string): string | null {
  if (!html) return null;
  const m = html.match(/data-store-slug=["']([^"']+)["']/i);
  return m ? m[1]! : null;
}

/** First data-product-exitWebsite attribute (e.g. "amazon.com"). */
function extractMerchantDomain(html: string): string | null {
  if (!html) return null;
  const m = html.match(/data-product-exitWebsite=["']([^"']+)["']/i);
  return m ? m[1]! : null;
}

// Slickdeals titles look like:
//   "$49.55 | 4 × 132-Oz Tide ... at Amazon"
//   "$10.99 Insignia™ - 150' Cat-6 Ethernet Cable - Gray at Best Buy"
//   "20% off ..."
// Best-effort: first $X.XX or $X token wins.
function extractPrice(s: string): number | null {
  // Match $1,234.56 or $1234 etc.
  const m = s.match(/\$\s?([0-9]{1,3}(?:,?[0-9]{3})*(?:\.[0-9]{1,2})?)/);
  if (!m) return null;
  const n = Number(m[1]!.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

// Best-effort store extraction: looks for " at <Store>" at end of title.
function extractStore(title: string): string | null {
  const m = title.match(/\bat\s+([A-Z][\w.& '-]+?)\s*$/);
  return m ? m[1]!.trim() : null;
}

// Apply user-defined include/exclude filters to a parsed deal.
export function dealMatchesAlert(
  deal: DealItem,
  filters: {
    title_include: string[];
    title_exclude: string[];
    min_price: number | null;
    max_price: number | null;
  },
): boolean {
  const lower = deal.title.toLowerCase();
  if (filters.title_include.length > 0) {
    const anyHit = filters.title_include.some((kw) =>
      lower.includes(kw.toLowerCase()),
    );
    if (!anyHit) return false;
  }
  if (filters.title_exclude.length > 0) {
    const anyHit = filters.title_exclude.some((kw) =>
      lower.includes(kw.toLowerCase()),
    );
    if (anyHit) return false;
  }
  if (filters.min_price != null && deal.price != null && deal.price < filters.min_price) {
    return false;
  }
  if (filters.max_price != null && deal.price != null && deal.price > filters.max_price) {
    return false;
  }
  return true;
}
