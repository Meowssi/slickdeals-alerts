"use client";

import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

type Step = "intro" | "signup" | "verify-or-sandbox" | "find-key" | "form" | "saving" | "test" | "done";

export function ResendEmailWalkthrough({ onDone, onSkip }: { onDone: () => void; onSkip: () => void }) {
  const [step, setStep] = useState<Step>("intro");
  const [apiKey, setApiKey] = useState("");
  const [fromAddress, setFromAddress] = useState("");
  const [recipient, setRecipient] = useState("");
  const [channelId, setChannelId] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState("");
  const [testStatus, setTestStatus] = useState<"idle" | "sending" | "sent" | "failed">("idle");

  function formValid(): boolean {
    return (
      apiKey.trim().startsWith("re_") &&
      apiKey.trim().length >= 20 &&
      /\S+@\S+\.\S+/.test(fromAddress.trim()) &&
      /\S+@\S+\.\S+/.test(recipient.trim())
    );
  }

  async function saveChannel() {
    setStep("saving");
    setErrMsg("");
    const supa = supabaseBrowser();
    const config = {
      api_key: apiKey.trim(),
      from_address: fromAddress.trim(),
      address: recipient.trim(),
    };

    const { data: existing } = await supa
      .from("notification_channels")
      .select("id")
      .eq("type", "email")
      .eq("name", "default")
      .maybeSingle();

    let chId: string;
    if (existing) {
      const { error: updErr } = await supa
        .from("notification_channels")
        .update({ config, enabled: true, verified_at: null, verification_code: null, verification_expires_at: null })
        .eq("id", existing.id);
      if (updErr) { setErrMsg(updErr.message); setStep("form"); return; }
      chId = existing.id;
    } else {
      const { data: ch, error: insErr } = await supa
        .from("notification_channels")
        .insert({ type: "email", name: "default", config, enabled: true })
        .select("id")
        .single();
      if (insErr || !ch) { setErrMsg(insErr?.message ?? "could not save channel"); setStep("form"); return; }
      chId = ch.id;
    }
    setChannelId(chId);

    const { data: { session } } = await supa.auth.getSession();
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/channel-verify`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${session?.access_token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ channel_id: chId, action: "start" }),
        },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        setErrMsg(json.error ?? `verify failed (HTTP ${res.status})`);
        setStep("form");
        return;
      }
    } catch (e) {
      setErrMsg(`Could not reach channel-verify: ${(e as Error).message}`);
      setStep("form");
      return;
    }
    setStep("test");
  }

  async function sendTest() {
    if (!channelId) return;
    setTestStatus("sending");
    setErrMsg("");
    const supa = supabaseBrowser();
    const { data: { session } } = await supa.auth.getSession();
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/send-test`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${session?.access_token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ channel_id: channelId }),
        },
      );
      const json = await res.json().catch(() => ({}));
      setTestStatus(json.ok ? "sent" : "failed");
      if (!json.ok) setErrMsg(json.error ?? "test send failed");
    } catch (e) {
      setTestStatus("failed");
      setErrMsg(`Could not reach send-test: ${(e as Error).message}`);
    }
  }

  // ---------- step content ----------

  if (step === "intro") {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Connect Email (via Resend)</h2>
        <p className="text-sm text-neutral-700">
          <a className="text-blue-700 underline" href="https://resend.com" target="_blank" rel="noreferrer">Resend</a> is an email API. Free up to 3,000 emails/month, then ~$0.40 per 1,000. You make your own account so volume is yours.
        </p>
        <div className="flex justify-between pt-2">
          <button type="button" className="btn-secondary" onClick={onSkip}>Skip</button>
          <button type="button" className="btn-primary" onClick={() => setStep("signup")}>Get started</button>
        </div>
      </div>
    );
  }

  if (step === "signup") {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Step 1: Create a Resend account</h2>
        <ol className="list-decimal list-inside text-sm text-neutral-700 space-y-1">
          <li>Sign up at <a className="text-blue-700 underline" href="https://resend.com/signup" target="_blank" rel="noreferrer">resend.com/signup</a> (no credit card on the free tier).</li>
          <li>Click the confirmation link Resend emails you.</li>
        </ol>
        <div className="flex justify-between pt-2">
          <button type="button" className="btn-secondary" onClick={() => setStep("intro")}>Back</button>
          <button type="button" className="btn-primary" onClick={() => setStep("verify-or-sandbox")}>Account ready →</button>
        </div>
      </div>
    );
  }

  if (step === "verify-or-sandbox") {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Step 2: Pick a &quot;from&quot; address</h2>
        <p className="text-sm text-neutral-700">Two options:</p>
        <ul className="text-sm text-neutral-700 space-y-2">
          <li>
            <strong>Sandbox (fastest):</strong> use <code className="bg-neutral-100 px-1 rounded">onboarding@resend.dev</code>. Catch: can only email <em>your own</em> signup address.
          </li>
          <li>
            <strong>Your own domain (best):</strong> <a className="text-blue-700 underline" href="https://resend.com/domains" target="_blank" rel="noreferrer">Resend → Domains → Add Domain</a> → add the DNS records to your registrar → send from <code className="bg-neutral-100 px-1 rounded">alerts@yourdomain.com</code> to anyone.
          </li>
        </ul>
        <div className="flex justify-between pt-2">
          <button type="button" className="btn-secondary" onClick={() => setStep("signup")}>Back</button>
          <button type="button" className="btn-primary" onClick={() => setStep("find-key")}>Got it →</button>
        </div>
      </div>
    );
  }

  if (step === "find-key") {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Step 3: Get your API key</h2>
        <ol className="list-decimal list-inside text-sm text-neutral-700 space-y-1">
          <li>Open <a className="text-blue-700 underline" href="https://resend.com/api-keys" target="_blank" rel="noreferrer">resend.com/api-keys</a>.</li>
          <li>Click <strong>Create API Key</strong>. Name it &quot;Slickdeals Alerts&quot;, permission = <strong>Sending access</strong>.</li>
          <li>Copy the key (starts with <code className="bg-neutral-100 px-1 rounded">re_</code>) — Resend only shows it once.</li>
        </ol>
        <div className="flex justify-between pt-2">
          <button type="button" className="btn-secondary" onClick={() => setStep("verify-or-sandbox")}>Back</button>
          <button type="button" className="btn-primary" onClick={() => setStep("form")}>I have the key →</button>
        </div>
      </div>
    );
  }

  if (step === "form" || step === "saving") {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">4. Paste credentials + addresses</h2>
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">Resend API key</label>
          <input
            type="password" className="input font-mono text-xs"
            placeholder="re_..."
            value={apiKey} onChange={(e) => setApiKey(e.target.value)}
            disabled={step === "saving"}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">From address</label>
          <input
            type="email" className="input"
            placeholder="onboarding@resend.dev OR alerts@yourdomain.com"
            value={fromAddress} onChange={(e) => setFromAddress(e.target.value)}
            disabled={step === "saving"}
          />
          <p className="text-xs text-neutral-500 mt-1">Sandbox sender or an address on your verified domain.</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">Recipient (your email)</label>
          <input
            type="email" className="input"
            placeholder="you@example.com"
            value={recipient} onChange={(e) => setRecipient(e.target.value)}
            disabled={step === "saving"}
          />
          <p className="text-xs text-neutral-500 mt-1">Where deal alerts go.</p>
        </div>
        {errMsg && <p className="text-sm text-red-600">{errMsg}</p>}
        <div className="flex justify-between pt-2">
          <button type="button" className="btn-secondary" onClick={() => setStep("find-key")} disabled={step === "saving"}>Back</button>
          <button type="button" className="btn-primary" onClick={saveChannel} disabled={step === "saving" || !formValid()}>
            {step === "saving" ? "Saving..." : "Save and continue"}
          </button>
        </div>
      </div>
    );
  }

  if (step === "test") {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Send a test email</h2>
        <p className="text-sm text-neutral-700">
          We&apos;ll send a test email to <strong>{recipient}</strong> right now.
        </p>
        {testStatus === "idle" && (
          <button type="button" className="btn-primary w-full" onClick={sendTest}>Send test email</button>
        )}
        {testStatus === "sending" && <p className="text-sm text-neutral-600">Sending…</p>}
        {testStatus === "sent" && (
          <div className="rounded-md bg-green-50 border border-green-200 p-3 text-sm text-green-900">✅ Sent. Check your inbox (and spam folder).</div>
        )}
        {testStatus === "failed" && (
          <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-900">❌ Test failed: {errMsg || "unknown error"}</div>
        )}
        <div className="flex justify-between pt-2">
          <button type="button" className="btn-secondary" onClick={() => { setTestStatus("idle"); setErrMsg(""); sendTest(); }} disabled={testStatus === "sending"}>Resend</button>
          <button type="button" className="btn-primary" onClick={onDone}>{testStatus === "sent" ? "Done 🎉" : "Continue anyway"}</button>
        </div>
      </div>
    );
  }

  return null;
}
