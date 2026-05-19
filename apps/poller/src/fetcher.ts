// HTTP fetcher with conditional GET (ETag / If-Modified-Since) support.

import { request } from "undici";
import { config } from "./config.js";

export interface FetchResult {
  status: number;
  body: string | null;       // null on 304
  etag: string | null;
  lastModified: string | null;
}

export async function fetchFeed(
  url: string,
  prev?: { etag?: string | null; lastModified?: string | null },
): Promise<FetchResult> {
  const headers: Record<string, string> = {
    "User-Agent": config.userAgent,
    "Accept": "application/rss+xml, application/xml;q=0.9, */*;q=0.5",
  };
  if (prev?.etag) headers["If-None-Match"] = prev.etag;
  if (prev?.lastModified) headers["If-Modified-Since"] = prev.lastModified;

  const res = await request(url, {
    method: "GET",
    headers,
    headersTimeout: 15_000,
    bodyTimeout: 30_000,
  });

  const etag = pickHeader(res.headers, "etag");
  const lastModified = pickHeader(res.headers, "last-modified");

  if (res.statusCode === 304) {
    // Drain body to free the socket.
    await res.body.dump();
    return { status: 304, body: null, etag, lastModified };
  }

  const body = await res.body.text();
  return { status: res.statusCode, body, etag, lastModified };
}

function pickHeader(
  h: Record<string, string | string[] | undefined>,
  key: string,
): string | null {
  const v = h[key];
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}
