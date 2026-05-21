// Unified feed: latest matches across all alerts, with read/saved/dismissed state.

import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { humanAgo, formatPrice } from "@/lib/format";

export const dynamic = "force-dynamic";

interface FeedRow {
  match_id: number;
  matched_at: string;
  alert_id: string;
  alert_name: string;
  deal_id: number;
  title: string;
  url: string;
  price: number | null;
  store: string | null;
  thumbnail_url: string | null;
  rss_pub_at: string | null;
  saved: boolean;
  dismissed: boolean;
  read_at: string | null;
}

export default async function FeedPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; alert?: string }>;
}) {
  const supa = await supabaseServer();
  const { filter, alert: alertFilter } = await searchParams;

  // alert_matches has FKs to alerts + deals, but NOT to deal_state (they only
  // share user_id + deal_id, no FK). PostgREST can't infer that relationship,
  // so we fetch matches and deal_state separately and merge in JS.
  let matchesQuery = supa
    .from("alert_matches")
    .select(`
      id, matched_at, alert_id, deal_id,
      alerts!inner(id, name),
      deals!inner(id, title, url, price, store, thumbnail_url, rss_pub_at)
    `)
    .order("matched_at", { ascending: false })
    .limit(200);
  if (alertFilter) {
    matchesQuery = matchesQuery.eq("alert_id", alertFilter);
  }
  const { data: matches, error } = await matchesQuery;
  if (error) return <p className="text-red-600">{error.message}</p>;

  // For the alert-filter chip row: enumerate the user's alerts (just id + name).
  const { data: allAlerts } = await supa
    .from("alerts")
    .select("id, name")
    .eq("enabled", true)
    .order("name");

  const dealIds = Array.from(new Set((matches ?? []).map((m: { deal_id: number }) => m.deal_id)));
  const { data: states } = dealIds.length
    ? await supa
        .from("deal_state")
        .select("deal_id, saved, dismissed, read_at")
        .in("deal_id", dealIds)
    : { data: [] };
  const stateByDealId = new Map<number, { saved: boolean; dismissed: boolean; read_at: string | null }>();
  for (const s of (states ?? []) as Array<{ deal_id: number; saved: boolean; dismissed: boolean; read_at: string | null }>) {
    stateByDealId.set(s.deal_id, { saved: s.saved, dismissed: s.dismissed, read_at: s.read_at });
  }

  // deno-lint-ignore no-explicit-any
  const allRows: FeedRow[] = (matches ?? []).map((r: any) => {
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
      thumbnail_url: r.deals.thumbnail_url,
      rss_pub_at: r.deals.rss_pub_at,
      saved: state?.saved ?? false,
      dismissed: state?.dismissed ?? false,
      read_at: state?.read_at ?? null,
    };
  });

  const rows: FeedRow[] = allRows
    .filter((r) => {
      if (filter === "dismissed") return r.dismissed;
      if (r.dismissed) return false;
      if (filter === "saved") return r.saved;
      if (filter === "unread") return r.read_at === null;
      return true;
    })
    // Sort by when the deal was actually published on Slickdeals (rss_pub_at),
    // not by when our poller noticed it (matched_at). Within the same minute
    // a batch poll's matched_at values are all near-identical, so matched_at
    // sort puts newly-published deals below older same-batch items.
    .sort((a, b) => {
      const at = a.rss_pub_at ? new Date(a.rss_pub_at).getTime() : 0;
      const bt = b.rss_pub_at ? new Date(b.rss_pub_at).getTime() : 0;
      if (bt !== at) return bt - at;
      return new Date(b.matched_at).getTime() - new Date(a.matched_at).getTime();
    });

  const buildHref = (next: { filter?: string | null; alert?: string | null }): string => {
    const sp = new URLSearchParams();
    const f = next.filter !== undefined ? next.filter : filter;
    const a = next.alert  !== undefined ? next.alert  : alertFilter;
    if (f) sp.set("filter", f);
    if (a) sp.set("alert", a);
    const qs = sp.toString();
    return qs ? `/?${qs}` : "/";
  };

  return (
    <div>
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Feed</h1>
        <div className="flex gap-1 text-sm">
          <FilterTab label="All"       href={buildHref({ filter: null })}      active={!filter} />
          <FilterTab label="Unread"    href={buildHref({ filter: "unread" })}    active={filter === "unread"} />
          <FilterTab label="Saved"     href={buildHref({ filter: "saved" })}     active={filter === "saved"} />
          <FilterTab label="Dismissed" href={buildHref({ filter: "dismissed" })} active={filter === "dismissed"} />
        </div>
      </header>

      {/* Alert chips */}
      {(allAlerts ?? []).length > 1 && (
        <div className="mb-4 flex flex-wrap gap-1 text-xs">
          <AlertChip
            label="All alerts"
            href={buildHref({ alert: null })}
            active={!alertFilter}
          />
          {(allAlerts ?? []).map((a) => (
            <AlertChip
              key={a.id}
              label={a.name}
              href={buildHref({ alert: a.id })}
              active={alertFilter === a.id}
            />
          ))}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="card p-8 text-center text-neutral-500">
          <p className="mb-2">No matches yet.</p>
          <p className="text-sm">
            {alertFilter
              ? "Nothing for this alert yet — try removing the alert filter."
              : "Once your alerts find a deal, it'll show up here in real time."}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.match_id}>
              <FeedItem row={r} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AlertChip({ label, href, active }: { label: string; href: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={
        "px-2.5 py-1 rounded-full border transition " +
        (active
          ? "bg-brand-500 text-white border-brand-500"
          : "bg-white text-neutral-700 border-neutral-200 hover:border-neutral-400")
      }
    >
      {label}
    </Link>
  );
}

function FilterTab({ label, href, active }: {
  label: string; href: string; active: boolean;
}) {
  return (
    <Link
      href={href}
      className={
        "px-3 py-1 rounded-md " +
        (active
          ? "bg-neutral-900 text-white"
          : "text-neutral-600 hover:bg-neutral-100")
      }
    >
      {label}
    </Link>
  );
}

function FeedItem({ row }: { row: FeedRow }) {
  const unread = !row.read_at;
  return (
    <Link href={`/deal/${row.deal_id}`} className="block">
      <article className={
        "card p-4 flex gap-4 hover:shadow-md transition " +
        (unread ? "border-l-4 border-l-brand-500" : "")
      }>
        {row.thumbnail_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={row.thumbnail_url}
            alt=""
            className="w-[72px] h-[72px] sm:w-24 sm:h-24 shrink-0 object-contain rounded bg-neutral-100"
          />
        ) : (
          <div className="w-[72px] h-[72px] sm:w-24 sm:h-24 shrink-0 rounded bg-neutral-100 flex items-center justify-center text-2xl text-neutral-300">
            $
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            {row.price != null && (
              <span className="text-lg font-semibold text-brand-600">
                {formatPrice(row.price)}
              </span>
            )}
            {row.store && <span className="text-sm text-neutral-500">@ {row.store}</span>}
            {row.saved && <span className="ml-auto text-xs text-amber-600">★ saved</span>}
          </div>
          <h3 className="font-medium truncate">{row.title}</h3>
          <div className="text-xs text-neutral-500 mt-1 flex gap-3">
            <span>{row.alert_name}</span>
            <span>•</span>
            <span>Posted {humanAgo(row.rss_pub_at)}</span>
            <span>•</span>
            <span>Matched {humanAgo(row.matched_at)}</span>
          </div>
        </div>
      </article>
    </Link>
  );
}
