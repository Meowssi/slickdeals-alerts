import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { SetupWizard } from "@/components/setup-wizard";

export default async function SetupPage() {
  const supa = await supabaseServer();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) redirect("/login");

  // /setup is reachable any time from the nav ("Setup" tab). Users may
  // have skipped onboarding originally, or want to re-add channels later —
  // in both cases the wizard is the right surface, not a redirect home.
  // (The wizard's finish step stamps user_settings.onboarded_at again
  //  on completion, which is harmless on re-runs.)

  const adminEmails = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const isAdmin = adminEmails.includes((user.email ?? "").toLowerCase());

  return (
    <div className="min-h-screen bg-neutral-50 py-8 px-4">
      <div className="mx-auto max-w-2xl">
        <SetupWizard email={user.email ?? ""} isAdmin={isAdmin} />
      </div>
    </div>
  );
}
