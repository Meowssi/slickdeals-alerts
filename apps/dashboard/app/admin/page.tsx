// /admin — landing hub for admin-only tools. The layout gate handles auth.

import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function AdminHubPage() {
  const supa = supabaseAdmin();
  const { data: counts } = await supa
    .from("feedback")
    .select("status")
    .order("created_at", { ascending: false });

  const open       = (counts ?? []).filter((r) => r.status === "open").length;
  const inProgress = (counts ?? []).filter((r) => r.status === "in_progress").length;
  const resolved   = (counts ?? []).filter((r) => r.status === "resolved").length;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Admin</h1>
        <p className="text-sm text-neutral-600 mt-1">
          Tools only available to addresses in <code className="text-xs bg-neutral-100 px-1 py-0.5 rounded">ADMIN_EMAILS</code>.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <Link
          href="/admin/setup"
          className="card p-6 hover:border-neutral-400 dark:hover:border-neutral-600 transition block"
        >
          <div className="text-lg font-semibold">Setup wizard ↗</div>
          <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-2">
            Live readiness checks + interactive forms to finish configuring
            Supabase secrets, Telegram bot, edge functions, vault, and 2FA.
          </p>
        </Link>

        <Link
          href="/admin/feedback"
          className="card p-6 hover:border-neutral-400 dark:hover:border-neutral-600 transition block"
        >
          <div className="flex items-baseline justify-between">
            <div className="text-lg font-semibold">Feedback queue ↗</div>
            {open > 0 && (
              <span className="text-[11px] bg-brand-500 text-white px-2 py-0.5 rounded-full font-semibold">
                {open} new
              </span>
            )}
          </div>
          <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-2">
            All bug reports, feature ideas, and questions submitted by users.
          </p>
          <div className="text-xs text-neutral-500 dark:text-neutral-500 mt-3 flex gap-3">
            <span><strong className="text-neutral-700 dark:text-neutral-300">{open}</strong> open</span>
            <span><strong className="text-neutral-700 dark:text-neutral-300">{inProgress}</strong> in progress</span>
            <span><strong className="text-neutral-700 dark:text-neutral-300">{resolved}</strong> resolved</span>
          </div>
        </Link>
      </div>
    </div>
  );
}
