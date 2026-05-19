import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supa = await supabaseServer();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) redirect("/login?next=/admin/setup");

  const allow = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  if (allow.length > 0 && !allow.includes((user.email ?? "").toLowerCase())) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50 px-4">
        <div className="card p-8 max-w-md text-center">
          <h1 className="text-xl font-semibold mb-2">Admin only</h1>
          <p className="text-sm text-neutral-600">
            This page is restricted to deployers. Add your email to the{" "}
            <code className="text-xs bg-neutral-100 px-1 py-0.5 rounded">ADMIN_EMAILS</code>{" "}
            env var on Vercel to access it.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-50">
      <main className="mx-auto max-w-3xl px-4 py-10">{children}</main>
    </div>
  );
}
