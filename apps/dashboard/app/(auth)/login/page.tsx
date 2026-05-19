"use client";

import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errMsg, setErrMsg] = useState("");

  const allowedDomain = process.env.NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setErrMsg("");
    if (allowedDomain && !email.toLowerCase().endsWith("@" + allowedDomain)) {
      setStatus("error");
      setErrMsg(`Email must end in @${allowedDomain}.`);
      return;
    }
    const supa = supabaseBrowser();
    const { error } = await supa.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${location.origin}/auth/callback` },
    });
    if (error) {
      setStatus("error");
      setErrMsg(error.message);
      return;
    }
    setStatus("sent");
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-neutral-50 p-6">
      <div className="card w-full max-w-md p-8">
        <h1 className="text-2xl font-semibold mb-2">Slickdeals Alerts</h1>
        <p className="text-neutral-600 text-sm mb-6">
          Sign in with your email — we&apos;ll send you a magic link.
        </p>

        {status === "sent" ? (
          <div className="rounded-md bg-green-50 border border-green-200 p-4 text-sm text-green-900">
            <p className="font-medium">Check your email</p>
            <p className="mt-1">We sent a sign-in link to <strong>{email}</strong>.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <input
              type="email"
              required
              autoComplete="email"
              placeholder={allowedDomain ? `you@${allowedDomain}` : "you@example.com"}
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            {errMsg && <p className="text-sm text-red-600">{errMsg}</p>}
            <button
              type="submit"
              disabled={status === "sending"}
              className="btn-primary w-full disabled:opacity-60"
            >
              {status === "sending" ? "Sending..." : "Email me a link"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
