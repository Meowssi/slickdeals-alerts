// Test-fetch endpoint: fetches a URL once, parses RSS, returns item count + latest title.
// Used by the alert form's "Test fetch" button.

import { NextResponse } from "next/server";
import { parseRss } from "@slickalerts/shared";
import { supabaseServer } from "@/lib/supabase/server";

export async function GET(req: Request) {
  // Require auth.
  const supa = await supabaseServer();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const url = searchParams.get("url");
  if (!url) return NextResponse.json({ error: "missing url" }, { status: 400 });

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "SlickdealsAlertsDashboardTest/0.1",
        "Accept": "application/rss+xml, application/xml",
      },
    });
    if (!res.ok) {
      return NextResponse.json({ error: `HTTP ${res.status}` }, { status: 400 });
    }
    const xml = await res.text();
    const items = parseRss(xml);
    return NextResponse.json({
      itemCount: items.length,
      latestTitle: items[0]?.title ?? null,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
