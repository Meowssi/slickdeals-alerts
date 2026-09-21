// Stats dashboard — aggregated server-side, read-only.

import { supabaseServer } from "@/lib/supabase/server";
import { humanAgo } from "@/lib/format";

export const dynamic = "force-dynamic";

interface Notif {
  channel_type: string;
  ok: boolean;
  rss_to_sent_ms: number | null;
  sent_at: string;
}
interface Match { matched_at: string; alert_id: string; deal_id: number }
interface AlertRow {
  id: string;
  name: string;
  last_polled_at: string | null;
  consecutive_errors: number;
  last_error: string | null;
  enabled: boolean;
}
interface ChannelRow { type: string }

export default async function StatsPage() {
  const supa = await supabaseServer();
  const now = Date.now();
  const day = 24 * 3600 * 1000;
  const since24h = new Date(now - day).toISOString();
  const since30d = new Date(now - 30 * day).toISOString();

  const [
    { data: notifs24h },
    { data: notifs30d },
    { data: matches30d },
    { data: alerts },
    { data: dealStates },
    { data: channels },
  ] = await Promise.all([
    supa.from("notifications_sent")
      .select("channel_type, ok, rss_to_sent_ms, sent_at")
      .gte("sent_at", since24h)
      .order("sent_at", { ascending: false }),
    supa.from("notifications_sent")
      .select("channel_type, ok, sent_at")
      .gte("sent_at", since30d),
    supa.from("alert_matches")
      .select("matched_at, alert_id, deal_id")
      .gte("matched_at", since30d),
    supa.from("alerts")
      .select("id, name, last_polled_at, consecutive_errors, last_error, enabled"),
    supa.from("deal_state")
      .select("deal_id, saved, dismissed"),
    supa.from("notification_channels")
      .select("type")
      .eq("enabled", true),
  ]);

  const ok24 = (notifs24h as Notif[] | null ?? []).filter((n) => n.ok);
  const err24 = (notifs24h as Notif[] | null ?? []).filter((n) => !n.ok);
  const latencies = ok24.map((n) => n.rss_to_sent_ms).filter((x): x is number => x != null);
  const p50 = percentile(latencies, 0.5);
  const p95 = percentile(latencies, 0.95);

  // Matches per day, last 30
  const daily = bucketByDay(matches30d as Match[] | null ?? [], 30);

  // Saved/dismissed by deal_id
  const stateByDeal = new Map<number, { saved: boolean; dismissed: boolean }>();
  for (const s of (dealStates as Array<{ deal_id: number; saved: boolean; dismissed: boolean }> | null ?? [])) {
    stateByDeal.set(s.deal_id, { saved: s.saved, dismissed: s.dismissed });
  }

  // Top alerts (last 30d) with save/dismiss rate
  const perAlert = new Map<string, { total: number; saved: number; dismissed: number }>();
  for (const m of (matches30d as Match[] | null ?? [])) {
    const e = perAlert.get(m.alert_id) ?? { total: 0, saved: 0, dismissed: 0 };
    e.total++;
    const st = stateByDeal.get(m.deal_id);
    if (st?.saved) e.saved++;
    if (st?.dismissed) e.dismissed++;
    perAlert.set(m.alert_id, e);
  }
  const alertById = new Map((alerts as AlertRow[] | null ?? []).map((a) => [a.id, a]));
  const topAlerts = [...perAlert.entries()]
    .map(([id, v]) => ({ name: alertById.get(id)?.name ?? id, ...v }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);

  // Per-channel delivery (24h)
  const perChannel = new Map<string, { sent: number; errors: number; latencies: number[] }>();
  for (const n of (notifs24h as Notif[] | null ?? [])) {
    const e = perChannel.get(n.channel_type) ?? { sent: 0, errors: 0, latencies: [] };
    if (n.ok) e.sent++; else e.errors++;
    if (n.ok && n.rss_to_sent_ms != null) e.latencies.push(n.rss_to_sent_ms);
    perChannel.set(n.channel_type, e);
  }
  const channelRows = [...perChannel.entries()]
    .map(([type, v]) => ({
      type,
      sent: v.sent,
      errors: v.errors,
      successRate: v.sent + v.errors === 0 ? null : v.sent / (v.sent + v.errors),
      p50: percentile(v.latencies, 0.5),
    }))
    .sort((a, b) => (b.sent + b.errors) - (a.sent + a.errors));

  const hasTelnyx = (channels as ChannelRow[] | null ?? []).some((c) => c.type === "sms_telnyx");
  const telnyx30dCount = (notifs30d as Notif[] | null ?? []).filter((n) => n.channel_type === "sms_telnyx" && n.ok).length;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Stats</h1>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Notifications (24h)" value={String(ok24.length)} />
        <Stat label="Errors (24h)" value={String(err24.length)} tone={err24.length > 0 ? "warn" : undefined} />
        <Stat label="Median latency" value={fmtSec(p50)} help="RSS pubDate → notification sent" />
        <Stat label="p95 latency" value={fmtSec(p95)} />
      </section>

      <Card title="Matches per day" subtitle="Last 30 days. Hover bars for date.">
        <DayChart daily={daily} />
      </Card>

      <Card title="Top alerts" subtitle="Last 30 days. Save rate hints at signal quality.">
        {topAlerts.length === 0 ? (
          <p className="text-sm text-neutral-500 dark:text-neutral-400">No matches yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-neutral-500 dark:text-neutral-400 border-b border-neutral-200 dark:border-neutral-800">
              <tr>
                <th className="py-2">Alert</th>
                <th className="py-2 text-right">Matches</th>
                <th className="py-2 text-right">Saved</th>
                <th className="py-2 text-right">Dismissed</th>
                <th className="py-2 text-right">Save rate</th>
              </tr>
            </thead>
            <tbody>
              {topAlerts.map((a) => (
                <tr key={a.name} className="border-b border-neutral-100 dark:border-neutral-800/50">
                  <td className="py-1.5 truncate max-w-[200px]">{a.name}</td>
                  <td className="py-1.5 text-right font-mono">{a.total}</td>
                  <td className="py-1.5 text-right font-mono">{a.saved}</td>
                  <td className="py-1.5 text-right font-mono">{a.dismissed}</td>
                  <td className="py-1.5 text-right font-mono">
                    {a.total === 0 ? "—" : `${Math.round((a.saved / a.total) * 100)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Per-channel delivery" subtitle="Last 24 hours.">
        {channelRows.length === 0 ? (
          <p className="text-sm text-neutral-500 dark:text-neutral-400">No notifications yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-neutral-500 dark:text-neutral-400 border-b border-neutral-200 dark:border-neutral-800">
              <tr>
                <th className="py-2">Channel</th>
                <th className="py-2 text-right">Sent</th>
                <th className="py-2 text-right">Errors</th>
                <th className="py-2 text-right">Success</th>
                <th className="py-2 text-right">p50 latency</th>
              </tr>
            </thead>
            <tbody>
              {channelRows.map((r) => (
                <tr key={r.type} className="border-b border-neutral-100 dark:border-neutral-800/50">
                  <td className="py-1.5">{r.type}</td>
                  <td className="py-1.5 text-right font-mono">{r.sent}</td>
                  <td className="py-1.5 text-right font-mono">
                    <span className={r.errors > 0 ? "text-red-600 dark:text-red-400" : ""}>{r.errors}</span>
                  </td>
                  <td className="py-1.5 text-right font-mono">
                    {r.successRate === null ? "—" : `${Math.round(r.successRate * 100)}%`}
                  </td>
                  <td className="py-1.5 text-right font-mono">{fmtSec(r.p50)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {hasTelnyx && (
        <Card title="Telnyx SMS (30 days)" subtitle="Check your Telnyx billing dashboard for exact costs.">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="SMS sent (30d)" value={String(telnyx30dCount)} />
            <Stat label="Est. spend" value={`~$${(telnyx30dCount * 0.005).toFixed(2)}`} help="~$0.005/SMS estimate. Verify in Telnyx billing." />
          </div>
        </Card>
      )}

      <Card title="Alert health">
        {!alerts || alerts.length === 0 ? (
          <p className="text-sm text-neutral-500 dark:text-neutral-400">No alerts.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-neutral-500 dark:text-neutral-400 border-b border-neutral-200 dark:border-neutral-800">
              <tr><th className="py-2">Alert</th><th className="py-2">Last polled</th><th className="py-2">Status</th></tr>
            </thead>
            <tbody>
              {(alerts as AlertRow[]).map((a) => (
                <tr key={a.id} className="border-b border-neutral-100 dark:border-neutral-800/50">
                  <td className="py-1.5 truncate max-w-[200px]">{a.name}</td>
                  <td className="py-1.5">{humanAgo(a.last_polled_at)}</td>
                  <td className="py-1.5">
                    {!a.enabled ? "⏸ paused"
                      : a.consecutive_errors > 0
                        ? <span className="text-red-600 dark:text-red-400">❌ {a.consecutive_errors} errors</span>
                        : <span className="text-green-700 dark:text-green-400">✅ healthy</span>}
                    {a.last_error && (
                      <span className="text-xs text-red-600 dark:text-red-400 ml-2">{a.last_error}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="card p-6">
      <header className="mb-3">
        <h2 className="font-semibold">{title}</h2>
        {subtitle && <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">{subtitle}</p>}
      </header>
      {children}
    </section>
  );
}

function Stat({ label, value, help, tone }: { label: string; value: string; help?: string; tone?: "warn" }) {
  return (
    <div className="card p-4">
      <div className="text-xs text-neutral-500 dark:text-neutral-400">{label}</div>
      <div className={"text-2xl font-semibold mt-1 " + (tone === "warn" ? "text-amber-700 dark:text-amber-400" : "")}>{value}</div>
      {help && <div className="text-[10px] text-neutral-400 dark:text-neutral-500 mt-1">{help}</div>}
    </div>
  );
}

function DayChart({ daily }: { daily: Array<{ date: string; count: number }> }) {
  const max = Math.max(1, ...daily.map((d) => d.count));
  const total = daily.reduce((sum, d) => sum + d.count, 0);
  return (
    <div>
      <div className="flex items-end gap-[2px] h-32">
        {daily.map((d) => {
          const h = (d.count / max) * 100;
          return (
            <div
              key={d.date}
              title={`${d.date}: ${d.count}`}
              className="flex-1 min-w-[6px] bg-brand-500/70 hover:bg-brand-500 transition rounded-t"
              style={{ height: `${Math.max(h, d.count > 0 ? 4 : 0)}%` }}
            />
          );
        })}
      </div>
      <div className="flex justify-between text-[10px] text-neutral-500 dark:text-neutral-400 mt-1">
        <span>{daily[0]?.date.slice(5)}</span>
        <span className="font-mono">{total} matches total</span>
        <span>{daily[daily.length - 1]?.date.slice(5)}</span>
      </div>
    </div>
  );
}

// ---- helpers ----

function fmtSec(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function percentile(arr: number[], q: number): number | null {
  if (arr.length === 0) return null;
  const sorted = arr.slice().sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * q));
  return sorted[idx]!;
}

function bucketByDay(matches: Match[], days: number): Array<{ date: string; count: number }> {
  const buckets: Array<{ date: string; count: number }> = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 24 * 3600 * 1000);
    buckets.push({ date: d.toISOString().slice(0, 10), count: 0 });
  }
  const idxByDate = new Map(buckets.map((b, i) => [b.date, i]));
  for (const m of matches) {
    const date = m.matched_at.slice(0, 10);
    const i = idxByDate.get(date);
    if (i != null) buckets[i]!.count++;
  }
  return buckets;
}
