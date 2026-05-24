// Unified feed: latest matches across all alerts. Server fetches the initial
// snapshot; the client (FeedClient) subscribes to Supabase Realtime for new
// alert_matches and prepends them with a 30-second highlight.

import { supabaseServer } from "@/lib/supabase/server";
import { FeedClient, type FeedRow } from "@/components/feed-client";

export const dynamic = "force-dynamic";

export default async function FeedPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; alert?: string }>;
}) {
  const supa = await supabaseServer();
  const { filter, alert: alertFilter } = await searchParams;

  // alert_matches has FKs to alerts + deals, but NOT to deal_state, so fetch
  // matches/deal_state separately and merge in JS.
  let matchesQuery = supa
    .from("alert_matches")
    .select(`
      id, matched_at, alert_id, deal_id,
      alerts!inner(id, name),
      deals!inner(id, title, url, price, store, merchant, merchant_domain, thumb_score, thumbnail_url, rss_pub_at)
    `)
    .order("matched_at", { ascending: false })
    .limit(200);
  if (alertFilter) matchesQuery = matchesQuery.eq("alert_id", alertFilter);
  const { data: matches, error } = await matchesQuery;
  if (error) return <p className="text-red-600">{error.message}</p>;

  const { data: allAlerts } = await supa
    .from("alerts")
    .select("id, name")
    .eq("enabled", true)
    .order("name");

  const dealIds = Array.from(new Set((matches ?? []).map((m: { deal_id: number }) => m.deal_id)));
  const { data: states } = dealIds.length
    ? await supa.from("deal_state").select("deal_id, saved, dismissed, read_at").in("deal_id", dealIds)
    : { data: [] };

  const stateByDealId = new Map<number, { saved: boolean; dismissed: boolean; read_at: string | null }>();
  for (const s of (states ?? []) as Array<{ deal_id: number; saved: boolean; dismissed: boolean; read_at: string | null }>) {
    stateByDealId.set(s.deal_id, { saved: s.saved, dismissed: s.dismissed, read_at: s.read_at });
  }

  // deno-lint-ignore no-explicit-any
  const initialRows: FeedRow[] = (matches ?? []).map((r: any) => {
    const state = stateByDealId.get(r.deals.id);
    return {
      match_id: r.id,
      matched_at: r.matched_at,
      alert_id: r.alerts.id,
      alert_name: r.alerts.name,
      deal_id: r.deals.id,
      title: r.deals.title,
      url: r.deals.url,
      price: r.deals.price,
      store: r.deals.store,
      merchant: r.deals.merchant ?? null,
      merchant_domain: r.deals.merchant_domain ?? null,
      thumb_score: r.deals.thumb_score ?? null,
      thumbnail_url: r.deals.thumbnail_url,
      rss_pub_at: r.deals.rss_pub_at,
      saved: state?.saved ?? false,
      dismissed: state?.dismissed ?? false,
      read_at: state?.read_at ?? null,
    };
  }).sort((a: FeedRow, b: FeedRow) => {
    const at = a.rss_pub_at ? new Date(a.rss_pub_at).getTime() : 0;
    const bt = b.rss_pub_at ? new Date(b.rss_pub_at).getTime() : 0;
    if (bt !== at) return bt - at;
    return new Date(b.matched_at).getTime() - new Date(a.matched_at).getTime();
  });

  return (
    <FeedClient
      initialRows={initialRows}
      alerts={allAlerts ?? []}
      filter={filter ?? null}
      alertFilter={alertFilter ?? null}
    />
  );
}
