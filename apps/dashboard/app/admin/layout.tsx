import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { supabaseServer } from "@/lib/supabase/server";
import { ADMIN_SESSION_COOKIE, checkAdminGate, passwordToken } from "@/lib/admin-auth";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supa = await supabaseServer();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) redirect("/login?next=/admin/setup");

  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;
  const gate = checkAdminGate({
    userEmail: user.email ?? undefined,
    sessionCookie,
  });

  if (!gate.allowed) {
    if (gate.reason === "not-configured") {
      return (
        <div className="min-h-screen flex items-center justify-center bg-neutral-50 px-4">
          <div className="card p-8 max-w-md text-center space-y-3">
            <h1 className="text-xl font-semibold">Admin lock not configured</h1>
            <p className="text-sm text-neutral-700">
              The <code className="text-xs bg-neutral-100 px-1 py-0.5 rounded">ADMIN_EMAILS</code> env var is empty,
              so this page is refusing to render — otherwise any signed-in user could access it.
            </p>
            <p className="text-sm text-neutral-700">
              Set <code className="text-xs bg-neutral-100 px-1 py-0.5 rounded">ADMIN_EMAILS</code> on your Vercel project (comma-separated emails)
              and redeploy. Optionally also set <code className="text-xs bg-neutral-100 px-1 py-0.5 rounded">ADMIN_PASSWORD</code> for a second layer.
            </p>
          </div>
        </div>
      );
    }
    if (gate.reason === "wrong-email") {
      return (
        <div className="min-h-screen flex items-center justify-center bg-neutral-50 px-4">
          <div className="card p-8 max-w-md text-center">
            <h1 className="text-xl font-semibold mb-2">Admin only</h1>
            <p className="text-sm text-neutral-600">
              You&apos;re signed in as <strong>{gate.email}</strong>, which isn&apos;t in the
              admin allowlist. If this is your deployment, add your email to the{" "}
              <code className="text-xs bg-neutral-100 px-1 py-0.5 rounded">ADMIN_EMAILS</code>{" "}
              env var on Vercel.
            </p>
          </div>
        </div>
      );
    }
    if (gate.reason === "needs-password") {
      return <PasswordPrompt />;
    }
  }

  return (
    <div className="min-h-screen bg-neutral-50">
      <main className="mx-auto max-w-3xl px-4 py-10">{children}</main>
    </div>
  );
}

function PasswordPrompt() {
  async function unlock(formData: FormData) {
    "use server";
    const submitted = String(formData.get("password") ?? "");
    const adminPw = process.env.ADMIN_PASSWORD ?? "";
    if (!submitted || !adminPw) return;
    if (submitted !== adminPw) {
      // Re-render the form. We could surface an error message but for brevity
      // we just reload — the wrong password leaves no cookie, so we end up
      // back at this form.
      redirect("/admin/setup?wrong=1");
    }
    const cookieStore = await cookies();
    cookieStore.set(ADMIN_SESSION_COOKIE, passwordToken(adminPw), {
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/admin",
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });
    redirect("/admin/setup");
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-50 px-4">
      <form action={unlock} className="card p-8 max-w-md w-full space-y-4">
        <h1 className="text-xl font-semibold">Admin password</h1>
        <p className="text-sm text-neutral-600">
          This deployment requires an additional password for the admin pages
          (in addition to the email allowlist).
        </p>
        <input
          type="password"
          name="password"
          required
          autoFocus
          autoComplete="current-password"
          placeholder="ADMIN_PASSWORD"
          className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
        />
        <button
          type="submit"
          className="w-full rounded-md bg-neutral-900 text-white text-sm font-medium px-4 py-2 hover:bg-neutral-800"
        >
          Unlock
        </button>
      </form>
    </div>
  );
}
