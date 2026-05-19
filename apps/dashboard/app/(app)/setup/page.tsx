import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { SetupWizard } from "@/components/setup-wizard";

export default async function SetupPage() {
  const supa = await supabaseServer();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) redirect("/login");

  const { data: settings } = await supa
    .from("user_settings")
    .select("onboarded_at")
    .eq("user_id", user.id)
    .single();
  if (settings?.onboarded_at) redirect("/");

  return (
    <div className="min-h-screen bg-neutral-50 py-8 px-4">
      <div className="mx-auto max-w-2xl">
        <SetupWizard email={user.email ?? ""} />
      </div>
    </div>
  );
}
