import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { supabaseServer } from "@/lib/supabase/server";
import {
  ADMIN_TOTP_SESSION_COOKIE,
  checkAdminGate,
  getAdminTotpSecret,
  totpSessionToken,
} from "@/lib/admin-auth";
import { verifyCode } from "@/lib/totp";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supa = await supabaseServer();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) redirect("/login?next=/admin/setup");

  const cookieStore = await cookies();
  const totpCookie = cookieStore.get(ADMIN_TOTP_SESSION_COOKIE)?.value;
  const totpSecret = await getAdminTotpSecret();

  const gate = checkAdminGate({
    userEmail: user.email ?? undefined,
    totpCookie,
    totpSecret,
  });

  if (!gate.allowed) {
    if (gate.reason === "not-configured") {
      return (
        <div className="min-h-screen flex items-center justify-center bg-neutral-50 px-4">
          <div className="card p-8 max-w-md text-center space-y-3">
            <h1 className="text-xl font-semibold">Admin lock not configured</h1>
            <p className="text-sm text-neutral-700">
              The <code className="text-xs bg-neutral-100 px-1 py-0.5 rounded">ADMIN_EMAILS</code> env var is empty.
              Set it (comma-separated emails) in Vercel and redeploy. Then configure 2FA from this page for
              the second layer.
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
              You&apos;re signed in as <strong>{gate.email}</strong>, which isn&apos;t in the admin allowlist.
            </p>
          </div>
        </div>
      );
    }
    if (gate.reason === "needs-totp" && totpSecret) {
      return <TotpPrompt secret={totpSecret} />;
    }
  }

  return (
    <div className="min-h-screen bg-neutral-50">
      <main className="mx-auto max-w-3xl px-4 py-10">{children}</main>
    </div>
  );
}

function TotpPrompt({ secret }: { secret: string }) {
  async function unlock(formData: FormData) {
    "use server";
    const code = String(formData.get("code") ?? "");
    if (!verifyCode(secret, code)) {
      redirect("/admin/setup?wrong_code=1");
    }
    const cookieStore = await cookies();
    cookieStore.set(ADMIN_TOTP_SESSION_COOKIE, totpSessionToken(secret), {
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/admin",
      maxAge: 60 * 60 * 24 * 30,
    });
    redirect("/admin/setup");
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-50 px-4">
      <form action={unlock} className="card p-8 max-w-md w-full space-y-4">
        <h1 className="text-xl font-semibold">Admin 2FA</h1>
        <p className="text-sm text-neutral-600">
          Enter the current 6-digit code from your authenticator app.
        </p>
        <input
          type="text"
          name="code"
          required
          autoFocus
          inputMode="numeric"
          pattern="[0-9]{6}"
          maxLength={6}
          placeholder="123456"
          autoComplete="one-time-code"
          className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-lg text-center tracking-widest font-mono focus:border-blue-500 focus:outline-none"
        />
        <button type="submit" className="w-full rounded-md bg-neutral-900 text-white text-sm font-medium px-4 py-2 hover:bg-neutral-800">
          Unlock
        </button>
      </form>
    </div>
  );
}
