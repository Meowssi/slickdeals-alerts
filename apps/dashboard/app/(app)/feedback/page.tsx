import { supabaseServer } from "@/lib/supabase/server";
import { submitFeedbackAction } from "@/lib/feedback-actions";
import { humanAgo } from "@/lib/format";

export const dynamic = "force-dynamic";

interface FeedbackRow {
  id: string;
  category: string;
  subject: string;
  message: string;
  status: string;
  admin_response: string | null;
  created_at: string;
}

const ERRORS: Record<string, string> = {
  category: "Please choose a category.",
  subject:  "Subject must be 1–200 characters.",
  message:  "Message must be 1–5000 characters.",
  save:     "We couldn't save your feedback. Try again in a moment.",
};

export default async function FeedbackPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  const supa = await supabaseServer();
  const { data: rows } = await supa
    .from("feedback")
    .select("id, category, subject, message, status, admin_response, created_at")
    .order("created_at", { ascending: false });

  const sp = await searchParams;
  const errorMessage = sp.err ? (ERRORS[sp.err] ?? "Something went wrong.") : null;
  const ok = sp.ok === "1";

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Feedback</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-1">
          Bug reports, feature ideas, or questions for the admin. Replies show up below.
        </p>
      </header>

      {ok && (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200">
          Thanks! Your feedback was submitted.
        </div>
      )}
      {errorMessage && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-700 dark:bg-red-900/30 dark:text-red-200">
          {errorMessage}
        </div>
      )}

      <form action={submitFeedbackAction} className="card p-6 space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Category</label>
          <select name="category" defaultValue="bug" required className="input">
            <option value="bug">🐞 Bug</option>
            <option value="feature">💡 Feature idea</option>
            <option value="question">❓ Question</option>
            <option value="other">📝 Other</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Subject</label>
          <input
            type="text"
            name="subject"
            required
            maxLength={200}
            placeholder="One-liner — what's this about?"
            className="input"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Message</label>
          <textarea
            name="message"
            required
            maxLength={5000}
            rows={6}
            placeholder="What happened? What did you expect to happen? Steps to reproduce help a ton for bugs."
            className="input"
          />
        </div>

        <button
          type="submit"
          className="rounded-md bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 text-sm font-medium px-4 py-2 hover:opacity-90"
        >
          Submit feedback
        </button>
      </form>

      <section>
        <h2 className="text-lg font-semibold mb-3">Your past feedback</h2>
        {!rows || rows.length === 0 ? (
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            Nothing submitted yet.
          </p>
        ) : (
          <ul className="space-y-3">
            {(rows as FeedbackRow[]).map((r) => (
              <li key={r.id} className="card p-4 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <CategoryPill category={r.category} />
                  <StatusPill status={r.status} />
                  <span className="text-xs text-neutral-500 dark:text-neutral-400 ml-auto">
                    {humanAgo(r.created_at)}
                  </span>
                </div>
                <div className="font-medium">{r.subject}</div>
                <p className="text-sm text-neutral-700 dark:text-neutral-300 whitespace-pre-wrap">
                  {r.message}
                </p>
                {r.admin_response && (
                  <div className="mt-2 border-l-2 border-brand-500 pl-3 bg-brand-50/50 dark:bg-brand-500/10 py-2 rounded-r">
                    <div className="text-[11px] font-semibold text-brand-700 dark:text-brand-400 uppercase tracking-wide mb-1">
                      Admin response
                    </div>
                    <p className="text-sm whitespace-pre-wrap">{r.admin_response}</p>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function CategoryPill({ category }: { category: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    bug:      { label: "🐞 Bug",     cls: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200" },
    feature:  { label: "💡 Feature", cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200" },
    question: { label: "❓ Question", cls: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200" },
    other:    { label: "📝 Other",   cls: "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200" },
  };
  const v = map[category] ?? map.other!;
  return <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${v.cls}`}>{v.label}</span>;
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    open:        { label: "Open",        cls: "bg-neutral-200 text-neutral-800 dark:bg-neutral-700 dark:text-neutral-200" },
    in_progress: { label: "In progress", cls: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200" },
    resolved:    { label: "Resolved",    cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200" },
  };
  const v = map[status] ?? map.open!;
  return <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${v.cls}`}>{v.label}</span>;
}
