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

export default async function AdminFeedbackPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const sp = await searchParams;
  const filter: StatusFilter = (STATUS_FILTERS as readonly string[]).includes(sp.status ?? "")
    ? (sp.status as StatusFilter)
    : "open";

  const supa = supabaseAdmin();
  let query = supa
    .from("feedback")
    .select("id, user_email, category, subject, message, status, admin_response, created_at, updated_at")
    .order("created_at", { ascending: false });
  if (filter !== "all") query = query.eq("status", filter);
  const { data: rows } = await query;

  // counts for tabs
  const { data: allRows } = await supa.from("feedback").select("status");
  const counts = {
    all:         (allRows ?? []).length,
    open:        (allRows ?? []).filter((r) => r.status === "open").length,
    in_progress: (allRows ?? []).filter((r) => r.status === "in_progress").length,
    resolved:    (allRows ?? []).filter((r) => r.status === "resolved").length,
  };

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

      <nav className="flex flex-wrap gap-1 border-b border-neutral-200">
        {STATUS_FILTERS.map((s) => {
          const active = s === filter;
          return (
            <Link
              key={s}
              href={`/admin/feedback?status=${s}`}
              className={
                "px-3 py-1.5 text-sm rounded-t-md border-b-2 -mb-px " +
                (active
                  ? "border-brand-500 text-brand-700 font-medium"
                  : "border-transparent text-neutral-600 hover:text-neutral-900")
              }
            >
              {labelFor(s)} <span className="text-xs text-neutral-400">({counts[s]})</span>
            </Link>
          );
        })}
      </nav>

      {!rows || rows.length === 0 ? (
        <p className="text-sm text-neutral-500">Nothing here.</p>
      ) : (
        <ul className="space-y-4">
          {(rows as FeedbackRow[]).map((r) => (
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
    </div>
  );
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
