import { notFound } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { humanAgo, formatPrice } from "@/lib/format";
import { DealActions } from "@/components/deal-actions";

export default async function DealPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supa = await supabaseServer();
  const dealId = Number(id);

  const { data: deal } = await supa.from("deals").select("*").eq("id", dealId).single();
  if (!deal) notFound();

  const { data: state } = await supa
    .from("deal_state").select("*").eq("deal_id", dealId).maybeSingle();

  // Mark read on view.
  if (!state?.read_at) {
    await supa
      .from("deal_state")
      .upsert({ deal_id: dealId, user_id: (await supa.auth.getUser()).data.user!.id, read_at: new Date().toISOString() });
  }

  const { data: notifications } = await supa
    .from("notifications_sent")
    .select("*")
    .eq("deal_id", dealId)
    .order("sent_at", { ascending: false });

  const { data: matchAlerts } = await supa
    .from("alert_matches")
    .select("matched_at, alerts(id, name)")
    .eq("deal_id", dealId);

  return (
    <div className="space-y-6">
      <div className="card p-6">
        <div className="flex items-baseline gap-2 mb-2">
          {deal.price != null && (
            <span className="text-2xl font-bold text-brand-600">{formatPrice(deal.price)}</span>
          )}
          {deal.store && <span className="text-neutral-500">@ {deal.store}</span>}
        </div>
        <h1 className="text-xl font-semibold">{deal.title}</h1>
        <div className="text-sm text-neutral-500 mt-2">
          Posted {humanAgo(deal.rss_pub_at)} · First seen {humanAgo(deal.first_seen_at)}
        </div>
        <div className="mt-4 flex gap-2">
          <a href={deal.url} target="_blank" rel="noreferrer" className="btn-primary">
            View on Slickdeals
          </a>
          <DealActions
            dealId={dealId}
            saved={state?.saved ?? false}
            dismissed={state?.dismissed ?? false}
          />
        </div>
      </div>

      <div className="card p-6">
        <h2 className="font-semibold mb-3">Matched alerts</h2>
        <ul className="space-y-1 text-sm">
          {(matchAlerts ?? []).map((m, i) => (
            // deno-lint-ignore no-explicit-any
            <li key={i}>
              {/* @ts-expect-error supabase join shape */}
              <strong>{m.alerts?.name}</strong>{" "}
              <span className="text-neutral-500">— {humanAgo(m.matched_at)}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="card p-6">
        <h2 className="font-semibold mb-3">Notifications</h2>
        {(notifications?.length ?? 0) === 0 ? (
          <p className="text-sm text-neutral-500">No notifications sent.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-neutral-500">
              <tr><th>Channel</th><th>Sent</th><th>Latency</th><th>Status</th></tr>
            </thead>
            <tbody>
              {notifications!.map((n) => (
                <tr key={n.id} className="border-t border-neutral-100">
                  <td className="py-1">{n.channel_type}</td>
                  <td className="py-1">{humanAgo(n.sent_at)}</td>
                  <td className="py-1">{n.rss_to_sent_ms != null ? `${(n.rss_to_sent_ms / 1000).toFixed(1)}s` : "—"}</td>
                  <td className="py-1">{n.ok ? "✅" : `❌ ${n.error ?? ""}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
