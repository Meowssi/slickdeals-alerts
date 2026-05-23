import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { Nav } from "@/components/nav";
import { adminEmails } from "@/lib/admin-auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supa = await supabaseServer();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) redirect("/login");

  // If user hasn't completed onboarding, push them to the wizard.
  const { data: settings } = await supa
    .from("user_settings")
    .select("onboarded_at")
    .eq("user_id", user.id)
    .single();
  if (!settings?.onboarded_at) redirect("/setup");

  const isAdmin = adminEmails().includes((user.email ?? "").toLowerCase());

  return (
    <div className="min-h-screen flex flex-col">
      <Nav email={user.email ?? ""} isAdmin={isAdmin} />
      <main className="flex-1 mx-auto w-full max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}
