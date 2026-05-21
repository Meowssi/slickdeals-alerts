"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";
import { humanAgo, formatPrice } from "@/lib/format";

export interface FeedRow {
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

interface AlertOption { id: string; name: string }

interface Props {
  initialRows: FeedRow[];
  alerts: AlertOption[];
  filter: string | null;
  alertFilter: string | null;
}

const HIGHLIGHT_MS = 30_000;

export function FeedClient({ initialRows, alerts, filter, alertFilter }: Props) {
  const [rows, setRows] = useState<FeedRow[]>(initialRows);
  const [highlights, setHighlights] = useState<Set<number>>(new Set());

  // Reset state when filter/alertFilter changes (server re-renders with new initialRows).
  const initialRef = useRef(initialRows);
  useEffect(() => {
    if (initialRef.current !== initialRows) {
      initialRef.current = initialRows;
      setRows(initialRows);
      setHighlights(new Set());
    }
  }, [initialRows]);

  const dropHighlight = useCallback((matchId: number) => {
    setHighlights((prev) => {
      if (!prev.has(matchId)) return prev;
      const next = new Set(prev);
      next.delete(matchId);
      return next;
    });
  }, []);

  // Subscribe to new alert_matches via Supabase Realtime. RLS scopes it to
  // the current user. Filter by alert_id when an alert chip is active so
  // we don't show items the current view wouldn't render anyway.
  useEffect(() => {
    const supa = supabaseBrowser();
    const channel = supa
      .channel("feed:alert_matches")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "alert_matches",
          ...(alertFilter ? { filter: `alert_id=eq.${alertFilter}` } : {}),
        },
        async (payload) => {
          const inserted = payload.new as { id: number; deal_id: number; alert_id: string };

          // Fetch the joined row (deal + alert) — payload only has the raw
          // alert_matches columns.
          const { data } = await supa
            .from("alert_matches")
            .select(`
              id, matched_at, alert_id, deal_id,
              alerts!inner(id, name),
              deals!inner(id, title, url, price, store, thumbnail_url, rss_pub_at)
            `)
            .eq("id", inserted.id)
            .single();
          if (!data) return;

          const { data: state } = await supa
            .from("deal_state")
            .select("saved, dismissed, read_at")
            .eq("deal_id", inserted.deal_id)
            .maybeSingle();

          // deno-lint-ignore no-explicit-any
          const r = data as any;
          const row: FeedRow = {
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

          setRows((prev) => {
            if (prev.some((existing) => existing.match_id === row.match_id)) return prev;
            // Insert in sort order (rss_pub_at desc, matched_at desc tiebreaker).
            const next = [...prev, row].sort((a, b) => {
              const at = a.rss_pub_at ? new Date(a.rss_pub_at).getTime() : 0;
              const bt = b.rss_pub_at ? new Date(b.rss_pub_at).getTime() : 0;
              if (bt !== at) return bt - at;
              return new Date(b.matched_at).getTime() - new Date(a.matched_at).getTime();
            });
            return next;
          });
          setHighlights((prev) => new Set(prev).add(row.match_id));
          setTimeout(() => dropHighlight(row.match_id), HIGHLIGHT_MS);
        },
      )
      .subscribe();

    return () => {
      supa.removeChannel(channel);
    };
  }, [alertFilter, dropHighlight]);

  // Apply tab filters (saved / unread / dismissed) to the live list.
  const visibleRows = rows.filter((r) => {
    if (filter === "dismissed") return r.dismissed;
    if (r.dismissed) return false;
    if (filter === "saved") return r.saved;
    if (filter === "unread") return r.read_at === null;
    return true;
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

      {alerts.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-1 text-xs">
          <AlertChip label="All alerts" href={buildHref({ alert: null })} active={!alertFilter} />
          {alerts.map((a) => (
            <AlertChip key={a.id} label={a.name} href={buildHref({ alert: a.id })} active={alertFilter === a.id} />
          ))}
        </div>
      )}

      {visibleRows.length === 0 ? (
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
          {visibleRows.map((r) => (
            <li key={r.match_id}>
              <FeedItem
                row={r}
                isNew={highlights.has(r.match_id)}
                onClick={() => dropHighlight(r.match_id)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FilterTab({ label, href, active }: { label: string; href: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={
        "px-3 py-1 rounded-md " +
        (active ? "bg-neutral-900 text-white" : "text-neutral-600 hover:bg-neutral-100")
      }
    >
      {label}
    </Link>
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

function FeedItem({ row, isNew, onClick }: { row: FeedRow; isNew: boolean; onClick: () => void }) {
  const unread = !row.read_at;
  return (
    <Link href={`/deal/${row.deal_id}`} onClick={onClick} className="block">
      <article
        className={
          "card p-4 flex gap-4 hover:shadow-md transition " +
          (unread ? "border-l-4 border-l-brand-500 " : "") +
          (isNew ? "feed-row-new" : "")
        }
      >
        {row.thumbnail_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={row.thumbnail_url}
            alt=""
            className="w-[72px] h-[72px] sm:w-24 sm:h-24 shrink-0 object-contain rounded bg-neutral-100"
          />
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
            {isNew && <span className="ml-auto text-xs font-semibold text-yellow-700">NEW</span>}
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
