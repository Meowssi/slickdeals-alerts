"use client";

import { useCallback, useEffect, useRef, useState, type MouseEventHandler } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
  merchant: string | null;
  merchant_domain: string | null;
  thumb_score: number | null;
  thumbnail_url: string | null;
  rss_pub_at: string | null;
  last_score_refresh_at: string | null;
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
  searchQuery: string | null;
  minVotes: number | null;
  days: number | null;
  sort: string | null;
}

const HIGHLIGHT_MS = 30_000;

export function FeedClient({ initialRows, alerts, filter, alertFilter, searchQuery, minVotes, days, sort }: Props) {
  const router = useRouter();
  const [rows, setRows] = useState<FeedRow[]>(initialRows);
  const [highlights, setHighlights] = useState<Set<number>>(new Set());
  const [inputVal, setInputVal] = useState(searchQuery ?? "");
  const [votesInput, setVotesInput] = useState(minVotes != null ? String(minVotes) : "");
  const [refreshing, setRefreshing] = useState<Set<number>>(new Set());
  const [refreshingAll, setRefreshingAll] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const votesDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset state when filter/alertFilter changes (server re-renders with new initialRows).
  const initialRef = useRef(initialRows);
  useEffect(() => {
    if (initialRef.current !== initialRows) {
      initialRef.current = initialRows;
      setRows(initialRows);
      setHighlights(new Set());
    }
  }, [initialRows]);

  // Sync inputs when browser back/forward changes the URL params — but don't
  // stomp the box while the user's keystrokes are still in flight to the URL
  // (the prop lags the input by a debounce + server round-trip).
  useEffect(() => {
    setInputVal((cur) => ((searchQuery ?? "") === cur.trim() ? cur : (searchQuery ?? "")));
  }, [searchQuery]);
  useEffect(() => {
    setVotesInput(minVotes != null ? String(minVotes) : "");
  }, [minVotes]);

  const dropHighlight = useCallback((matchId: number) => {
    setHighlights((prev) => {
      if (!prev.has(matchId)) return prev;
      const next = new Set(prev);
      next.delete(matchId);
      return next;
    });
  }, []);

  // Manually re-scrape vote scores for the given deals via the refresh-scores
  // edge function, then patch thumb_score in place. The function caps the
  // fan-out and rate-limits per deal, so a "refresh all visible" click is safe.
  const refreshScores = useCallback(async (dealIds: number[]) => {
    const ids = [...new Set(dealIds)];
    if (ids.length === 0) return;
    try {
      const supa = supabaseBrowser();
      const { data: { session } } = await supa.auth.getSession();
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/refresh-scores`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session?.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ deal_ids: ids }),
        },
      );
      const json = await res.json().catch(() => null) as
        | { ok: boolean; scores?: { id: number; score: number | null; refreshed_at?: string | null }[] }
        | null;
      if (!json?.ok || !json.scores) return;
      const byId = new Map(json.scores.map((s) => [s.id, s]));
      setRows((prev) =>
        prev.map((r) => {
          const s = byId.get(r.deal_id);
          if (!s) return r;
          return {
            ...r,
            thumb_score: s.score ?? r.thumb_score,
            last_score_refresh_at: s.refreshed_at ?? r.last_score_refresh_at,
          };
        }),
      );
    } catch {
      // Network/transient failure — leave the existing scores untouched.
    }
  }, []);

  // Mark a deal read without visiting the detail page — the direct Slickdeals
  // button skips /deal/[id] (which is where read_at normally gets stamped), so
  // stamp it here. Optimistic local update first, then the same deal_state
  // upsert the detail page performs. Supabase reports failures as returned
  // { error } values rather than exceptions, so check them explicitly — on
  // any failure, roll the optimistic flag back so the UI doesn't show "read"
  // for a row that will resurrect as unread on the next load.
  const markRead = useCallback(async (dealId: number) => {
    const now = new Date().toISOString();
    setRows((prev) =>
      prev.map((r) => (r.deal_id === dealId && !r.read_at ? { ...r, read_at: now } : r)),
    );
    try {
      const supa = supabaseBrowser();
      const { data: { user }, error: userError } = await supa.auth.getUser();
      if (userError || !user) throw userError ?? new Error("no authenticated user");
      const { error } = await supa
        .from("deal_state")
        .upsert({ deal_id: dealId, user_id: user.id, read_at: now });
      if (error) throw error;
    } catch (err) {
      console.warn("Failed to persist read state for deal", dealId, err);
      setRows((prev) =>
        prev.map((r) => (r.deal_id === dealId && r.read_at === now ? { ...r, read_at: null } : r)),
      );
    }
  }, []);

  const refreshOne = useCallback(async (dealId: number) => {
    setRefreshing((prev) => new Set(prev).add(dealId));
    try {
      await refreshScores([dealId]);
    } finally {
      setRefreshing((prev) => {
        const next = new Set(prev);
        next.delete(dealId);
        return next;
      });
    }
  }, [refreshScores]);

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
              deals!inner(id, title, url, price, store, merchant, merchant_domain, thumb_score, thumbnail_url, rss_pub_at, last_score_refresh_at)
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
            merchant: r.deals.merchant ?? null,
            merchant_domain: r.deals.merchant_domain ?? null,
            thumb_score: r.deals.thumb_score ?? null,
            thumbnail_url: r.deals.thumbnail_url,
            rss_pub_at: r.deals.rss_pub_at,
            last_score_refresh_at: r.deals.last_score_refresh_at ?? null,
            saved: state?.saved ?? false,
            dismissed: state?.dismissed ?? false,
            read_at: state?.read_at ?? null,
          };

          setRows((prev) => {
            if (prev.some((existing) => existing.match_id === row.match_id)) return prev;
            // Insert in default sort order (matched_at desc, rss_pub_at desc
            // tiebreaker) — a fresh match goes to the top even if the deal
            // itself was posted days ago.
            const next = [...prev, row].sort((a, b) => {
              const mt = new Date(b.matched_at).getTime() - new Date(a.matched_at).getTime();
              if (mt !== 0) return mt;
              const at = a.rss_pub_at ? new Date(a.rss_pub_at).getTime() : 0;
              const bt = b.rss_pub_at ? new Date(b.rss_pub_at).getTime() : 0;
              return bt - at;
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

  // Apply tab filters (saved / unread / dismissed), then vote/date filters,
  // then search query.
  const needle = searchQuery?.trim().toLowerCase() ?? "";
  const cutoff = days != null ? Date.now() - days * 86_400_000 : null;
  const visibleRows = rows.filter((r) => {
    if (filter === "dismissed") { if (!r.dismissed) return false; }
    else {
      if (r.dismissed) return false;
      if (filter === "saved" && !r.saved) return false;
      if (filter === "unread" && r.read_at !== null) return false;
    }
    if (minVotes != null && (r.thumb_score ?? -Infinity) < minVotes) return false;
    if (cutoff != null) {
      const t = r.rss_pub_at ? new Date(r.rss_pub_at).getTime() : 0;
      if (t < cutoff) return false;
    }
    if (!needle) return true;
    return (
      r.title.toLowerCase().includes(needle) ||
      (r.store ?? "").toLowerCase().includes(needle) ||
      (r.merchant ?? "").toLowerCase().includes(needle) ||
      (r.merchant_domain ?? "").toLowerCase().includes(needle)
    );
  });

  // Sort: by votes or post date when requested, else newest-match-first (the
  // default the server already applied).
  if (sort === "votes_desc" || sort === "votes_asc") {
    const dir = sort === "votes_desc" ? -1 : 1;
    visibleRows.sort((a, b) => dir * ((a.thumb_score ?? -Infinity) - (b.thumb_score ?? -Infinity)));
  } else if (sort === "posted_desc") {
    visibleRows.sort((a, b) => {
      const at = a.rss_pub_at ? new Date(a.rss_pub_at).getTime() : 0;
      const bt = b.rss_pub_at ? new Date(b.rss_pub_at).getTime() : 0;
      if (bt !== at) return bt - at;
      return new Date(b.matched_at).getTime() - new Date(a.matched_at).getTime();
    });
  }

  const filtersActive = minVotes != null || days != null || !!sort || !!needle;

  const buildHref = (next: {
    filter?: string | null; alert?: string | null; q?: string | null;
    votes?: number | null; days?: number | null; sort?: string | null;
  }): string => {
    const sp = new URLSearchParams();
    const f = next.filter !== undefined ? next.filter : filter;
    const a = next.alert  !== undefined ? next.alert  : alertFilter;
    // q/votes carry over from the LIVE inputs, not the server-confirmed
    // props: the URL only catches up to the inputs after a debounce + server
    // round-trip, so navigating via tabs/chips/selects inside that window
    // would resurrect a search term the user already cleared (and the
    // searchQuery sync effect would then write it back into the box).
    const liveVotes = votesInput.trim() === "" ? null : Number(votesInput);
    const q = next.q !== undefined ? next.q : (inputVal.trim() || null);
    const v = next.votes !== undefined
      ? next.votes
      : (liveVotes != null && Number.isFinite(liveVotes) ? liveVotes : null);
    const d = next.days  !== undefined ? next.days  : days;
    const s = next.sort  !== undefined ? next.sort  : sort;
    if (f) sp.set("filter", f);
    if (a) sp.set("alert", a);
    if (q) sp.set("q", q);
    if (v != null) sp.set("votes", String(v));
    if (d != null) sp.set("days", String(d));
    if (s) sp.set("sort", s);
    const qs = sp.toString();
    return qs ? `/?${qs}` : "/";
  };

  const handleRefreshAll = async () => {
    if (refreshingAll) return;
    setRefreshingAll(true);
    try {
      await refreshScores(visibleRows.map((r) => r.deal_id));
    } finally {
      setRefreshingAll(false);
    }
  };

  const handleSearchChange = (val: string) => {
    setInputVal(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      router.replace(buildHref({ q: val.trim() || null }));
    }, 300);
  };

  const handleVotesChange = (val: string) => {
    setVotesInput(val);
    if (votesDebounceRef.current) clearTimeout(votesDebounceRef.current);
    votesDebounceRef.current = setTimeout(() => {
      const n = val.trim() === "" ? null : Number(val);
      router.replace(buildHref({ votes: n != null && Number.isFinite(n) ? n : null }));
    }, 400);
  };

  // A pending debounced replace would fire with the *previous* render's
  // filter/alert closed over — navigating and then letting it fire would undo
  // the navigation. Cancel before any explicit navigation.
  const cancelPendingUrlSync = () => {
    if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null; }
    if (votesDebounceRef.current) { clearTimeout(votesDebounceRef.current); votesDebounceRef.current = null; }
  };

  // Clear pending timers on unmount — a debounced replace firing after the
  // user navigated away (e.g. into a deal page) would yank them back to "/".
  useEffect(() => cancelPendingUrlSync, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Link-click variant: only cancel when the click navigates THIS tab.
  // Ctrl/cmd/shift/middle-clicks open elsewhere and shouldn't kill the
  // current tab's pending URL sync.
  const cancelOnSameTabNav: MouseEventHandler<HTMLAnchorElement> = (e) => {
    if (e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
      cancelPendingUrlSync();
    }
  };

  const resetFilters = () => {
    cancelPendingUrlSync();
    setInputVal("");
    setVotesInput("");
    router.replace(buildHref({ q: null, votes: null, days: null, sort: null }));
  };

  return (
    <div>
      <header className="mb-4 space-y-3 sm:space-y-0 sm:flex sm:flex-wrap sm:items-center sm:justify-between sm:gap-3">
        <h1 className="text-2xl font-semibold">Feed</h1>
        <div className="flex items-center gap-2">
          <div className="flex gap-1 text-sm overflow-x-auto -mx-1 px-1">
            <FilterTab label="All"       href={buildHref({ filter: null })}      active={!filter}              onClick={cancelOnSameTabNav} />
            <FilterTab label="Unread"    href={buildHref({ filter: "unread" })}    active={filter === "unread"}    onClick={cancelOnSameTabNav} />
            <FilterTab label="Saved"     href={buildHref({ filter: "saved" })}     active={filter === "saved"}     onClick={cancelOnSameTabNav} />
            <FilterTab label="Dismissed" href={buildHref({ filter: "dismissed" })} active={filter === "dismissed"} onClick={cancelOnSameTabNav} />
          </div>
          <button
            type="button"
            onClick={handleRefreshAll}
            disabled={refreshingAll || visibleRows.length === 0}
            title="Refresh vote scores for the deals shown below"
            className="shrink-0 inline-flex items-center gap-1.5 rounded-md border border-neutral-200 dark:border-neutral-700 px-2.5 py-1 text-sm text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-50"
          >
            <RefreshIcon spinning={refreshingAll} />
            <span className="hidden sm:inline">{refreshingAll ? "Refreshing…" : "Refresh votes"}</span>
          </button>
        </div>
      </header>

      {alerts.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-1 text-xs">
          <AlertChip label="All alerts" href={buildHref({ alert: null })} active={!alertFilter} onClick={cancelOnSameTabNav} />
          {alerts.map((a) => (
            <AlertChip key={a.id} label={a.name} href={buildHref({ alert: a.id })} active={alertFilter === a.id} onClick={cancelOnSameTabNav} />
          ))}
        </div>
      )}

      <div className="mb-4 relative">
        <span className="absolute inset-y-0 left-3 flex items-center pointer-events-none text-neutral-400">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
          </svg>
        </span>
        <input
          type="search"
          value={inputVal}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder="Search deals…"
          className="w-full rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 pl-9 pr-4 py-2 text-sm placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <div className="flex items-center gap-1.5">
          <span className="text-neutral-500 dark:text-neutral-400 whitespace-nowrap">👍 ≥</span>
          <input
            type="number"
            inputMode="numeric"
            value={votesInput}
            onChange={(e) => handleVotesChange(e.target.value)}
            placeholder="any"
            aria-label="Minimum votes"
            className="w-20 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <select
          value={days ?? ""}
          onChange={(e) => { cancelPendingUrlSync(); router.replace(buildHref({ days: e.target.value ? Number(e.target.value) : null })); }}
          aria-label="Posted within"
          className="rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          <option value="">Any time</option>
          <option value="1">Past 24h</option>
          <option value="3">Past 3 days</option>
          <option value="7">Past 7 days</option>
          <option value="30">Past 30 days</option>
        </select>
        <select
          value={sort ?? ""}
          onChange={(e) => { cancelPendingUrlSync(); router.replace(buildHref({ sort: e.target.value || null })); }}
          aria-label="Sort by"
          className="rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          <option value="">Newest by Match</option>
          <option value="posted_desc">Newest by Post</option>
          <option value="votes_desc">Most votes</option>
          <option value="votes_asc">Fewest votes</option>
        </select>
        {filtersActive && (
          <button
            type="button"
            onClick={resetFilters}
            className="ml-auto text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200 underline whitespace-nowrap"
          >
            Reset filters
          </button>
        )}
      </div>

      {visibleRows.length === 0 ? (
        <div className="card p-8 text-center text-neutral-500">
          <p className="mb-2">{needle ? `No deals match "${needle}".` : "No matches yet."}</p>
          <p className="text-sm">
            {needle
              ? "Try a different search term."
              : alertFilter
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
                refreshing={refreshing.has(r.deal_id)}
                onClick={(e) => { cancelOnSameTabNav(e); dropHighlight(r.match_id); }}
                onRefresh={() => refreshOne(r.deal_id)}
                onOpenSlickdeals={() => {
                  dropHighlight(r.match_id);
                  if (!r.read_at) markRead(r.deal_id);
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FilterTab({ label, href, active, onClick }: { label: string; href: string; active: boolean; onClick?: MouseEventHandler<HTMLAnchorElement> }) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={
        "px-3 py-1 rounded-md " +
        (active ? "bg-neutral-900 text-white" : "text-neutral-600 hover:bg-neutral-100")
      }
    >
      {label}
    </Link>
  );
}

function AlertChip({ label, href, active, onClick }: { label: string; href: string; active: boolean; onClick?: MouseEventHandler<HTMLAnchorElement> }) {
  return (
    <Link
      href={href}
      onClick={onClick}
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

// deals.url originates from RSS ingestion (untrusted <link> values). Ingestion
// now rejects non-http(s) links, but rows persisted before that check — or a
// compromised feed — shouldn't become a javascript:/data: navigation here.
function safeHttpUrl(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

function merchantLabel(row: FeedRow): string | null {
  if (row.merchant_domain) return row.merchant_domain;
  if (row.merchant) {
    return row.merchant
      .split("-")
      .map((w) => (w.length === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1)))
      .join(" ");
  }
  return row.store;
}

function RefreshIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className={"h-3.5 w-3.5 " + (spinning ? "animate-spin" : "")}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 0 0 4.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 0 1-15.357-2m15.357 2H15" />
    </svg>
  );
}

function FeedItem({
  row,
  isNew,
  refreshing,
  onClick,
  onRefresh,
  onOpenSlickdeals,
}: {
  row: FeedRow;
  isNew: boolean;
  refreshing: boolean;
  onClick: MouseEventHandler<HTMLAnchorElement>;
  onRefresh: () => void;
  onOpenSlickdeals: () => void;
}) {
  const unread = !row.read_at;
  const slickdealsHref = safeHttpUrl(row.url);
  return (
    <article
      className={
        "card relative p-3 sm:p-4 flex gap-3 sm:gap-4 hover:shadow-md transition " +
        (unread ? "border-l-4 border-l-brand-500 " : "") +
        (isNew ? "feed-row-new" : "")
      }
    >
      {/* Stretched link: the whole card still navigates to /deal/[id], but as
          an absolutely-positioned sibling overlay rather than a wrapper, so
          the refresh/Slickdeals controls below aren't interactive content
          nested inside an anchor. Controls sit above it via relative z-10. */}
      <Link href={`/deal/${row.deal_id}`} onClick={onClick} aria-label={row.title} className="absolute inset-0" />
      {row.thumbnail_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={row.thumbnail_url}
          alt=""
          className="w-16 h-16 sm:w-24 sm:h-24 shrink-0 object-contain rounded bg-neutral-100 dark:bg-neutral-800"
        />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          {row.price != null && (
            <span className="text-base sm:text-lg font-semibold text-brand-600 dark:text-brand-400">
              {formatPrice(row.price)}
            </span>
          )}
          {merchantLabel(row) && (
            <span className="text-xs sm:text-sm text-neutral-500 dark:text-neutral-400 truncate">
              @ {merchantLabel(row)}
            </span>
          )}
          {row.thumb_score != null && (
            <span
              className={
                "text-[11px] font-medium px-1.5 py-0.5 rounded-full whitespace-nowrap " +
                (row.thumb_score >= 0
                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
                  : "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200")
              }
              title="Slickdeals community thumb score"
            >
              {row.thumb_score >= 0 ? `👍 +${row.thumb_score}` : `👎 ${row.thumb_score}`}
            </span>
          )}
          <button
            type="button"
            onClick={() => {
              if (!refreshing) onRefresh();
            }}
            disabled={refreshing}
            title="Refresh this deal's vote score"
            aria-label="Refresh vote score"
            className="relative z-10 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 disabled:opacity-50"
          >
            <RefreshIcon spinning={refreshing} />
          </button>
          {row.saved && <span className="ml-auto text-xs text-amber-600 dark:text-amber-400">★ saved</span>}
          {isNew && <span className="ml-auto text-xs font-semibold text-yellow-700 dark:text-yellow-400">NEW</span>}
        </div>
        <h3 className="font-medium text-sm sm:text-base line-clamp-2 sm:truncate leading-snug mt-0.5">{row.title}</h3>
        <div className="text-[11px] sm:text-xs text-neutral-500 dark:text-neutral-400 mt-1 truncate">
          <span className="truncate">{row.alert_name}</span>
          <span className="mx-1.5">·</span>
          <span>posted {humanAgo(row.rss_pub_at)}</span>
          <span className="hidden sm:inline mx-1.5">·</span>
          <span className="hidden sm:inline">matched {humanAgo(row.matched_at)}</span>
          {row.last_score_refresh_at && (
            <>
              <span className="hidden sm:inline mx-1.5">·</span>
              <span className="hidden sm:inline" title="Votes last fetched from Slickdeals">
                votes fetched {humanAgo(row.last_score_refresh_at)}
              </span>
            </>
          )}
        </div>
      </div>
      {/* Direct path to the Slickdeals thread — skips the /deal/[id] detour
          so feed → purchase is one click. A real anchor (middle/ctrl-click
          friendly), valid now that the card link is a sibling overlay instead
          of a wrapper. Only rendered when the stored URL is a real http(s)
          link — see safeHttpUrl. */}
      {slickdealsHref && (
        <div className="relative z-10 flex items-center shrink-0">
          <a
            href={slickdealsHref}
            target="_blank"
            rel="noopener noreferrer"
            onClick={onOpenSlickdeals}
            title="Open the Slickdeals thread in a new tab"
            className="inline-flex items-center gap-1 rounded-md border border-neutral-200 dark:border-neutral-700 px-2 py-1.5 text-xs text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 whitespace-nowrap"
          >
            <span className="hidden sm:inline">Slickdeals</span>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>
        </div>
      )}
    </article>
  );
}
