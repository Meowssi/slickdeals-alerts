// Latency / health stats. Read-only; aggregated server-side.

import { supabaseServer } from "@/lib/supabase/server";
import { humanAgo } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function StatsPage() {
  const supa = await supabaseServer();

  // Latency stats over last 24h (server-side aggregation via .rpc would be cleaner,
  // but for an MVP we pull the rows and aggregate in TS).
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data: notifs } = await supa
    .from("notifications_sent")
    .select("channel_type, ok, rss_to_sent_ms, poll_to_sent_ms, sent_at")
    .gte("sent_at", since)
    .order("sent_at", { ascending: false });

  const ok = (notifs ?? []).filter((n) => n.ok);
  const errs = (notifs ?? []).filter((n) => !n.ok);
  const rss = ok.map((n) => n.rss_to_sent_ms).filter((x): x is number => x != null);
  const p50 = percentile(rss, 0.5);
  const p95 = percentile(rss, 0.95);
  const p99 = percentile(rss, 0.99);

  const byChannel = new Map<string, number>();
  for (const n of ok) byChannel.set(n.channel_type, (byChannel.get(n.channel_type) ?? 0) + 1);

  // Per-alert health.
  const { data: alerts } = await supa
    .from("alerts")
    .select("id, name, last_polled_at, consecutive_errors, last_error, enabled")
    .order("last_polled_at", { ascending: false });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Stats</h1>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Notifications (24h)" value={String(ok.length)} />
        <Stat label="Errors (24h)" value={String(errs.length)} />
        <Stat label="Median latency"
              value={p50 != null ? `${(p50 / 1000).toFixed(1)}s` : "—"}
              help="From <pubDate> to notification sent" />
        <Stat label="p95 latency"
              value={p95 != null ? `${(p95 / 1000).toFixed(1)}s` : "—"} />
      </section>

      <section className="card p-6">
        <h2 className="font-semibold mb-3">By channel (24h)</h2>
        {byChannel.size === 0 ? (
          <p className="text-sm text-neutral-500">No notifications yet.</p>
        ) : (
          <table className="text-sm">
            <tbody>
              {[...byChannel.entries()].map(([ch, n]) => (
                <tr key={ch} className="border-t border-neutral-100">
                  <td className="py-1 pr-6">{ch}</td>
                  <td className="py-1 font-mono">{n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="text-xs text-neutral-500 mt-3">
          p99 latency: {p99 != null ? `${(p99 / 1000).toFixed(1)}s` : "—"}
        </p>
      </section>

      <section className="card p-6">
        <h2 className="font-semibold mb-3">Alert health</h2>
        {!alerts || alerts.length === 0 ? (
          <p className="text-sm text-neutral-500">No alerts.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-neutral-500">
              <tr><th>Alert</th><th>Last polled</th><th>Status</th></tr>
            </thead>
            <tbody>
              {alerts.map((a) => (
                <tr key={a.id} className="border-t border-neutral-100">
                  <td className="py-1">{a.name}</td>
                  <td className="py-1">{humanAgo(a.last_polled_at)}</td>
                  <td className="py-1">
                    {!a.enabled ? "⏸ paused"
                      : a.consecutive_errors > 0
                        ? `❌ ${a.consecutive_errors} consecutive errors`
                        : "✅ healthy"}
                    {a.last_error && (
                      <span className="text-xs text-red-600 ml-2">{a.last_error}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, help }: { label: string; value: string; help?: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
      {help && <div className="text-[10px] text-neutral-400 mt-1">{help}</div>}
    </div>
  );
}

function percentile(arr: number[], q: number): number | null {
  if (arr.length === 0) return null;
  const sorted = arr.slice().sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * q));
  return sorted[idx]!;
}
