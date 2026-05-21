"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

type Mode = "password" | "magic" | "forgot";
type Status = "idle" | "submitting" | "sent" | "error";

function LoginForm() {
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/";
  const initialNotice = searchParams.get("notice");

  const [mode, setMode] = useState<Mode>("password");
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [msg, setMsg] = useState<string>(initialNotice ?? "");

  const allowedDomain = process.env.NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN;

  function checkDomain(): string | null {
    if (allowedDomain && !email.toLowerCase().endsWith("@" + allowedDomain)) {
      return `Email must end in @${allowedDomain}.`;
    }
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("submitting");
    setMsg("");
    const domainErr = checkDomain();
    if (domainErr) {
      setStatus("error");
      setMsg(domainErr);
      return;
    }
    const supa = supabaseBrowser();

    if (mode === "password") {
      if (isSignUp) {
        const { error } = await supa.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
        });
        if (error) { setStatus("error"); setMsg(error.message); return; }
        setStatus("sent");
        setMsg("Account created. Check your email to confirm, then sign in.");
        return;
      }
      const { error } = await supa.auth.signInWithPassword({ email, password });
      if (error) { setStatus("error"); setMsg(error.message); return; }
      window.location.href = next;
      return;
    }

    if (mode === "magic") {
      const { error } = await supa.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
      });
      if (error) { setStatus("error"); setMsg(error.message); return; }
      setStatus("sent");
      setMsg(`We sent a sign-in link to ${email}.`);
      return;
    }

    if (mode === "forgot") {
      const { error } = await supa.auth.resetPasswordForEmail(email, {
        redirectTo: `${location.origin}/auth/reset-password`,
      });
      if (error) { setStatus("error"); setMsg(error.message); return; }
      setStatus("sent");
      setMsg(`Password reset link sent to ${email}.`);
      return;
    }
  }

  const submitLabel =
    mode === "password"
      ? isSignUp ? "Create account" : "Sign in"
      : mode === "magic" ? "Email me a link"
      : "Send reset link";

  const submitting = status === "submitting";

  return (
    <main className="min-h-screen flex items-center justify-center bg-neutral-50 p-6">
      <div className="card w-full max-w-md p-8">
        <h1 className="text-2xl font-semibold mb-2">Slickdeals Alerts</h1>
        <p className="text-neutral-600 text-sm mb-6">
          {mode === "password" && (isSignUp ? "Create an account to get started." : "Sign in with your email and password.")}
          {mode === "magic" && "We'll email you a one-time sign-in link."}
          {mode === "forgot" && "Enter your email and we'll send a reset link."}
        </p>

        {status === "sent" ? (
          <div className="rounded-md bg-green-50 border border-green-200 p-4 text-sm text-green-900">
            <p>{msg}</p>
            <button
              type="button"
              className="mt-3 text-sm underline"
              onClick={() => { setStatus("idle"); setMsg(""); }}
            >
              Back to sign in
            </button>
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

            {mode === "password" && (
              <input
                type="password"
                required
                minLength={8}
                autoComplete={isSignUp ? "new-password" : "current-password"}
                placeholder="Password (at least 8 characters)"
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}

            {status === "error" && msg && <p className="text-sm text-red-600">{msg}</p>}
            {status === "idle" && msg && <p className="text-sm text-neutral-600">{msg}</p>}

            <button type="submit" disabled={submitting} className="btn-primary w-full disabled:opacity-60">
              {submitting ? "Working..." : submitLabel}
            </button>

            <div className="flex flex-col gap-1 text-sm text-neutral-600 pt-2 border-t">
              {mode === "password" && (
                <>
                  <button type="button" className="text-left underline" onClick={() => { setIsSignUp(!isSignUp); setStatus("idle"); setMsg(""); }}>
                    {isSignUp ? "Already have an account? Sign in" : "First time? Create an account"}
                  </button>
                  <button type="button" className="text-left underline" onClick={() => { setMode("forgot"); setStatus("idle"); setMsg(""); }}>
                    Forgot password?
                  </button>
                  <button type="button" className="text-left underline" onClick={() => { setMode("magic"); setStatus("idle"); setMsg(""); }}>
                    Use magic link instead
                  </button>
                </>
              )}
              {mode === "magic" && (
                <button type="button" className="text-left underline" onClick={() => { setMode("password"); setStatus("idle"); setMsg(""); }}>
                  Use password instead
                </button>
              )}
              {mode === "forgot" && (
                <button type="button" className="text-left underline" onClick={() => { setMode("password"); setStatus("idle"); setMsg(""); }}>
                  Back to sign in
                </button>
              )}
            </div>
          </form>
        )}
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
