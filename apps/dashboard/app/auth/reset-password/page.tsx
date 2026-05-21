"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [hasSession, setHasSession] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    const supa = supabaseBrowser();
    supa.auth.getSession().then(({ data }) => {
      setHasSession(!!data.session);
      if (!data.session) setMsg("Reset link is invalid or expired. Request a new one from the login page.");
    });
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("submitting");
    setMsg("");
    if (password !== confirm) { setStatus("error"); setMsg("Passwords don't match."); return; }
    const supa = supabaseBrowser();
    const { error } = await supa.auth.updateUser({ password });
    if (error) { setStatus("error"); setMsg(error.message); return; }
    setStatus("done");
    setMsg("Password updated. Redirecting...");
    setTimeout(() => router.push("/"), 1200);
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-neutral-50 p-6">
      <div className="card w-full max-w-md p-8">
        <h1 className="text-2xl font-semibold mb-2">Set new password</h1>
        {hasSession === false ? (
          <>
            <p className="text-sm text-red-600 mb-4">{msg}</p>
            <a href="/login" className="underline text-sm">Back to login</a>
          </>
        ) : hasSession === null ? (
          <p className="text-sm text-neutral-600">Checking reset link...</p>
        ) : status === "done" ? (
          <p className="text-sm text-green-700">{msg}</p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <input
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              placeholder="New password (at least 8 characters)"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <input
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              placeholder="Confirm new password"
              className="input"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
            {status === "error" && msg && <p className="text-sm text-red-600">{msg}</p>}
            <button type="submit" disabled={status === "submitting"} className="btn-primary w-full disabled:opacity-60">
              {status === "submitting" ? "Updating..." : "Update password"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
