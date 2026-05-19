import { supabaseServer } from "@/lib/supabase/server";
import { SettingsClient } from "@/components/settings-client";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const supa = await supabaseServer();

  const [{ data: settings }, { data: channels }] = await Promise.all([
    supa.from("user_settings").select("*").single(),
    supa.from("notification_channels").select("*").order("created_at"),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <SettingsClient
        settings={settings ?? null}
        channels={channels ?? []}
      />
    </div>
  );
}
