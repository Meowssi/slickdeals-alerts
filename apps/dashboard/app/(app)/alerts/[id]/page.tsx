import { notFound } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AlertForm } from "@/components/alert-form";

export default async function EditAlertPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supa = await supabaseServer();

  const [{ data: alert }, { data: channels }] = await Promise.all([
    supa.from("alerts").select("*").eq("id", id).single(),
    supa.from("notification_channels").select("id, type, name, verified_at")
        .eq("enabled", true).order("created_at"),
  ]);

  if (!alert) notFound();

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-4">Edit alert</h1>
      <AlertForm
        initial={{
          id: alert.id,
          name: alert.name,
          rss_url: alert.rss_url,
          enabled: alert.enabled,
          priority: alert.priority,
          channel_ids: alert.channel_ids ?? [],
        }}
        channels={(channels ?? []).map((c) => ({
          id: c.id, type: c.type, name: c.name, verified: !!c.verified_at,
        }))}
      />
    </div>
  );
}
