import { supabaseServer } from "@/lib/supabase/server";
import { AlertForm } from "@/components/alert-form";

export default async function NewAlertPage() {
  const supa = await supabaseServer();
  const { data: channels } = await supa
    .from("notification_channels")
    .select("id, type, name, verified_at")
    .eq("enabled", true)
    .order("created_at");

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-4">New alert</h1>
      <AlertForm
        channels={(channels ?? []).map((c) => ({
          id: c.id, type: c.type, name: c.name, verified: !!c.verified_at,
        }))}
      />
    </div>
  );
}
