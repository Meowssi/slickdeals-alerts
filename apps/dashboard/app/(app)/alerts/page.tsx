import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { humanAgo } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AlertsPage() {
  const supa = await supabaseServer();
  const { data: alerts } = await supa
    .from("alerts")
    .select("id, name, rss_url, enabled, last_polled_at, consecutive_errors, last_error")
    .order("created_at", { ascending: false });

  return (
    <div>
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Alerts</h1>
        <Link href="/alerts/new" className="btn-primary">+ New alert</Link>
      </header>

      {!alerts || alerts.length === 0 ? (
        <div className="card p-8 text-center text-neutral-500">
          <p className="mb-2">No alerts yet.</p>
          <Link href="/alerts/new" className="btn-primary">Create your first alert</Link>
        </div>
      ) : (
        <ul className="space-y-2">
          {alerts.map((a) => (
            <li key={a.id} className="card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium truncate">{a.name}</h3>
                    {!a.enabled && (
                      <span className="text-xs px-2 py-0.5 rounded bg-neutral-100 text-neutral-600">
                        paused
                      </span>
                    )}
                    {a.consecutive_errors > 0 && (
                      <span className="text-xs px-2 py-0.5 rounded bg-red-50 text-red-700">
                        {a.consecutive_errors} errors
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-neutral-500 mt-1 truncate">{a.rss_url}</div>
                </div>

                <div className="shrink-0 flex flex-col items-end gap-2">
                  <Link href={`/alerts/${a.id}`} className="btn-primary text-xs">
                    Edit
                  </Link>
                  <div className="text-xs text-neutral-500">
                    {a.last_polled_at ? `Polled ${humanAgo(a.last_polled_at)}` : "never polled"}
                  </div>
                </div>
              </div>

              {a.last_error && (
                <p className="text-xs text-red-600 mt-2 truncate">⚠ {a.last_error}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
