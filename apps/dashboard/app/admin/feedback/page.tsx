import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  updateFeedbackStatusAction,
  respondFeedbackAction,
  deleteFeedbackAction,
} from "@/lib/feedback-actions";
import { humanAgo } from "@/lib/format";

export const dynamic = "force-dynamic";

interface FeedbackRow {
  id: string;
  user_email: string;
  category: string;
  subject: string;
  message: string;
  status: string;
  admin_response: string | null;
  created_at: string;
  updated_at: string;
}

const STATUS_FILTERS = ["all", "open", "in_progress", "resolved"] as const;
type StatusFilter = typeof STATUS_FILTERS[number];
const FETCH_PAGE_SIZE = 1000;
const DISPLAY_PAGE_SIZE = 50;

export default async function AdminFeedbackPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string | string[]; q?: string | string[]; page?: string | string[] }>;
}) {
  const sp = await searchParams;
  const rawStatus = firstParam(sp.status);
  const filter: StatusFilter = (STATUS_FILTERS as readonly string[]).includes(rawStatus)
    ? (rawStatus as StatusFilter)
    : "open";
  const search = firstParam(sp.q).trim();
  const normalizedSearch = search.toLocaleLowerCase();
  const requestedPage = Math.max(1, Number.parseInt(firstParam(sp.page), 10) || 1);

  const supa = supabaseAdmin();
  const feedbackRows: FeedbackRow[] = [];
  for (let from = 0; ; from += FETCH_PAGE_SIZE) {
    const { data, error } = await supa
      .from("feedback")
      .select("id, user_email, category, subject, message, status, admin_response, created_at, updated_at")
      .order("created_at", { ascending: false })
      .range(from, from + FETCH_PAGE_SIZE - 1);
    if (error) {
      console.error("admin feedback query failed", error);
      break;
    }
    const page = (data ?? []) as FeedbackRow[];
    feedbackRows.push(...page);
    if (page.length < FETCH_PAGE_SIZE) break;
  }
  const counts = {
    all:         feedbackRows.length,
    open:        feedbackRows.filter((r) => r.status === "open").length,
    in_progress: feedbackRows.filter((r) => r.status === "in_progress").length,
    resolved:    feedbackRows.filter((r) => r.status === "resolved").length,
  };
  const filteredRows = feedbackRows.filter((r) => {
    if (filter !== "all" && r.status !== filter) return false;
    if (!normalizedSearch) return true;
    return [r.user_email, r.category, r.subject, r.message]
      .join(" ")
      .toLocaleLowerCase()
      .includes(normalizedSearch);
  });
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / DISPLAY_PAGE_SIZE));
  const currentPage = Math.min(requestedPage, totalPages);
  const rows = filteredRows.slice(
    (currentPage - 1) * DISPLAY_PAGE_SIZE,
    currentPage * DISPLAY_PAGE_SIZE,
  );

  return (
    <div className="space-y-6">
      <header className="flex items-baseline justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Feedback queue</h1>
          <p className="text-sm text-neutral-600 mt-1">
            Submitted by users via the <Link href="/feedback" className="underline">/feedback</Link> page.
          </p>
        </div>
        <Link
          href="/admin"
          className="text-sm text-neutral-500 hover:text-neutral-900"
        >
          ← Back to admin
        </Link>
      </header>

      <form method="get" className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="status" value={filter} />
        <label htmlFor="feedback-search" className="sr-only">Search feedback</label>
        <input
          id="feedback-search"
          type="search"
          name="q"
          defaultValue={search}
          placeholder="Search subject, message, email…"
          className="min-w-[16rem] flex-1 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
        />
        <button
          type="submit"
          className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800"
        >
          Search
        </button>
        {search && (
          <Link href={`/admin/feedback?status=${filter}`} className="text-sm text-neutral-500 hover:text-neutral-900">
            Clear
          </Link>
        )}
      </form>

      <nav className="flex flex-wrap gap-1 border-b border-neutral-200">
        {STATUS_FILTERS.map((s) => {
          const active = s === filter;
          return (
            <Link
              key={s}
              href={feedbackHref(s, search)}
              className={
                "px-3 py-1.5 text-sm rounded-t-md border-b-2 -mb-px " +
                (active
                  ? "border-neutral-900 text-neutral-900 font-medium"
                  : "border-transparent text-neutral-500 hover:text-neutral-900")
              }
            >
              {labelFor(s)} ({counts[s]})
            </Link>
          );
        })}
      </nav>

      <p className="text-xs text-neutral-500">
        Showing {filteredRows.length === 0 ? 0 : (currentPage - 1) * DISPLAY_PAGE_SIZE + 1}–{(currentPage - 1) * DISPLAY_PAGE_SIZE + rows.length} of {filteredRows.length} {filter === "all" ? "feedback items" : `${labelFor(filter)} items`}
        {search ? ` matching “${search}”` : ""}.
      </p>

      {rows.length === 0 ? (
        <p className="text-sm text-neutral-500">Nothing here{search ? ` matching “${search}”` : ""}.</p>
      ) : (
        <ul className="space-y-4">
          {rows.map((r) => (
            <li key={r.id} className="card p-4 space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <CategoryPill category={r.category} />
                <StatusPill status={r.status} />
                <span className="text-xs text-neutral-500">from {r.user_email}</span>
                <span className="text-xs text-neutral-400 ml-auto">{humanAgo(r.created_at)}</span>
              </div>

              <div>
                <div className="font-medium">{r.subject}</div>
                <p className="text-sm text-neutral-700 whitespace-pre-wrap mt-1">{r.message}</p>
              </div>

              <div className="flex flex-wrap gap-2 items-center pt-2 border-t border-neutral-100">
                <form action={updateFeedbackStatusAction} className="flex items-center gap-1">
                  <input type="hidden" name="id" value={r.id} />
                  <label className="text-xs text-neutral-500">Status:</label>
                  <select
                    name="status"
                    defaultValue={r.status}
                    className="text-xs rounded border border-neutral-300 bg-white px-2 py-1"
                  >
                    <option value="open">Open</option>
                    <option value="in_progress">In progress</option>
                    <option value="resolved">Resolved</option>
                  </select>
                  <button
                    type="submit"
                    className="text-xs rounded bg-neutral-900 text-white px-2 py-1 hover:bg-neutral-800"
                  >
                    Update
                  </button>
                </form>

                <form action={deleteFeedbackAction} className="ml-auto">
                  <input type="hidden" name="id" value={r.id} />
                  <button
                    type="submit"
                    className="text-xs text-red-600 hover:text-red-800 hover:underline"
                  >
                    Delete
                  </button>
                </form>
              </div>

              <form action={respondFeedbackAction} className="space-y-2">
                <input type="hidden" name="id" value={r.id} />
                <label className="block text-xs font-medium text-neutral-600">
                  Admin response (visible to the user on their /feedback page)
                </label>
                <textarea
                  name="admin_response"
                  defaultValue={r.admin_response ?? ""}
                  rows={2}
                  placeholder="Optional reply…"
                  className="w-full text-sm rounded border border-neutral-300 bg-white px-2 py-1.5"
                />
                <button
                  type="submit"
                  className="text-xs rounded bg-neutral-900 text-white px-2 py-1 hover:bg-neutral-800"
                >
                  Save response
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}

      {totalPages > 1 && (
        <nav aria-label="Feedback pages" className="flex items-center justify-between text-sm">
          <Link
            href={feedbackHref(filter, search, currentPage - 1)}
            aria-disabled={currentPage === 1}
            className={currentPage === 1 ? "pointer-events-none text-neutral-300" : "text-neutral-600 hover:text-neutral-900"}
          >
            ← Newer
          </Link>
          <span className="text-xs text-neutral-500">Page {currentPage} of {totalPages}</span>
          <Link
            href={feedbackHref(filter, search, currentPage + 1)}
            aria-disabled={currentPage === totalPages}
            className={currentPage === totalPages ? "pointer-events-none text-neutral-300" : "text-neutral-600 hover:text-neutral-900"}
          >
            Older →
          </Link>
        </nav>
      )}
    </div>
  );
}

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function feedbackHref(status: StatusFilter, search: string, page = 1): string {
  const params = new URLSearchParams({ status });
  if (search) params.set("q", search);
  if (page > 1) params.set("page", String(page));
  return `/admin/feedback?${params.toString()}`;
}

function labelFor(s: StatusFilter): string {
  if (s === "all") return "All";
  if (s === "in_progress") return "In progress";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function CategoryPill({ category }: { category: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    bug:      { label: "🐞 Bug",     cls: "bg-red-100 text-red-800" },
    feature:  { label: "💡 Feature", cls: "bg-amber-100 text-amber-800" },
    question: { label: "❓ Question", cls: "bg-blue-100 text-blue-800" },
    other:    { label: "📝 Other",   cls: "bg-neutral-200 text-neutral-700" },
  };
  const v = map[category] ?? map.other!;
  return <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${v.cls}`}>{v.label}</span>;
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    open:        { label: "Open",        cls: "bg-neutral-200 text-neutral-800" },
    in_progress: { label: "In progress", cls: "bg-blue-100 text-blue-800" },
    resolved:    { label: "Resolved",    cls: "bg-emerald-100 text-emerald-800" },
  };
  const v = map[status] ?? map.open!;
  return <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${v.cls}`}>{v.label}</span>;
}
