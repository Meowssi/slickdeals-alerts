"use client";

import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

type Step = "intro" | "signup" | "form" | "saving" | "test" | "done" | "needs-admin";

export function PushoverWalkthrough({ onDone, onSkip, isAdmin }: { onDone: () => void; onSkip: () => void; isAdmin: boolean }) {
  const [step, setStep] = useState<Step>("intro");
  const [userKey, setUserKey] = useState("");
  const [device, setDevice] = useState("");
  const [channelId, setChannelId] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState("");
  const [testStatus, setTestStatus] = useState<"idle" | "sending" | "sent" | "failed">("idle");

  async function saveChannel() {
    setStep("saving");
    setErrMsg("");
    const supa = supabaseBrowser();
    const config: { user_key: string; device?: string } = { user_key: userKey.trim() };
    if (device.trim()) config.device = device.trim();

    const { data: existing } = await supa
      .from("notification_channels")
      .select("id")
      .eq("type", "pushover")
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
        .insert({ type: "pushover", name: "default", config, enabled: true })
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
      if (json.needs_admin || (json.error && /app_token/i.test(json.error ?? ""))) {
        setStep("needs-admin");
        return;
      }
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
        <h2 className="text-xl font-semibold">Connect Pushover</h2>
        <p className="text-sm text-neutral-700">
          <a className="underline" href="https://pushover.net" target="_blank" rel="noreferrer">Pushover</a> is a premium push-notification service ($5 one-time per platform).
          It&apos;s the only channel that supports <strong>Emergency priority</strong> — alerts that bypass Do-Not-Disturb and keep retrying until you acknowledge.
        </p>
        <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900">
          <p className="font-medium mb-1">⚠️ Costs $5 (you pay Pushover directly)</p>
          <p>Pushover charges $5 one-time per platform you want to use (iOS, Android, Desktop). 7-day free trial included. If you don&apos;t want to pay, use Telegram or ntfy instead — both free.</p>
        </div>
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
        <h2 className="text-xl font-semibold">Sign up + find your User Key</h2>
        <ol className="space-y-3 text-sm text-neutral-700">
          <li className="flex gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full bg-neutral-900 text-white text-xs font-bold flex items-center justify-center">1</span>
            <div>
              <p className="font-medium text-neutral-800">Sign up at Pushover</p>
              <a href="https://pushover.net/signup" target="_blank" rel="noreferrer" className="inline-block mt-1 text-blue-700 underline text-sm">Open pushover.net/signup →</a>
              <p className="text-xs text-neutral-500 mt-1">Free 7-day trial; pay $5 per device platform after.</p>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full bg-neutral-900 text-white text-xs font-bold flex items-center justify-center">2</span>
            <div>
              <p className="font-medium text-neutral-800">Install the Pushover app on your device</p>
              <p className="text-xs text-neutral-500 mt-0.5">
                <a className="underline" href="https://apps.apple.com/us/app/pushover-notifications/id506088175" target="_blank" rel="noreferrer">iOS</a>{" • "}
                <a className="underline" href="https://play.google.com/store/apps/details?id=net.superblock.pushover" target="_blank" rel="noreferrer">Android</a>{" • "}
                <a className="underline" href="https://pushover.net/clients/desktop" target="_blank" rel="noreferrer">Desktop</a>
              </p>
              <p className="text-xs text-neutral-500 mt-1">Sign in with the Pushover account you just made.</p>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full bg-neutral-900 text-white text-xs font-bold flex items-center justify-center">3</span>
            <div>
              <p className="font-medium text-neutral-800">Find your User Key</p>
              <p className="text-xs text-neutral-600 mt-0.5">
                Go to <a className="underline" href="https://pushover.net" target="_blank" rel="noreferrer">pushover.net</a> (logged in). Your <strong>User Key</strong> is in the top-right of the main dashboard.
                It looks like: <code className="bg-neutral-100 px-1 rounded text-[10px] font-mono">u1Abc23DefGhij4kLmn5OpQrSt6Uvw</code>
              </p>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full bg-neutral-900 text-white text-xs font-bold flex items-center justify-center">4</span>
            <div>
              <p className="font-medium text-neutral-800">(Optional) Note a device name</p>
              <p className="text-xs text-neutral-600 mt-0.5">
                Below the User Key, Pushover lists your devices. If you want alerts only on one device (e.g., just your iPhone), copy that device&apos;s name. Otherwise leave blank to send to all.
              </p>
            </div>
          </li>
        </ol>
        <div className="flex justify-between pt-2">
          <button type="button" className="btn-secondary" onClick={() => setStep("intro")}>Back</button>
          <button type="button" className="btn-primary" onClick={() => setStep("form")}>I have my User Key</button>
        </div>
      </div>
    );
  }

  if (step === "form" || step === "saving") {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Paste your User Key</h2>
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">User Key</label>
          <input
            type="text"
            className="input font-mono text-sm"
            placeholder="u1Abc23DefGhij4kLmn5OpQrSt6Uvw"
            value={userKey}
            onChange={(e) => setUserKey(e.target.value)}
            disabled={step === "saving"}
          />
          <p className="text-xs text-neutral-500 mt-1">30 characters, starts with &quot;u&quot;.</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">
            Device <span className="text-neutral-400 font-normal">(optional)</span>
          </label>
          <input
            type="text"
            className="input font-mono text-sm"
            placeholder="leave blank to send to all"
            value={device}
            onChange={(e) => setDevice(e.target.value)}
            disabled={step === "saving"}
          />
        </div>
        {errMsg && <p className="text-sm text-red-600">{errMsg}</p>}
        <div className="flex justify-between pt-2">
          <button type="button" className="btn-secondary" onClick={() => setStep("signup")} disabled={step === "saving"}>Back</button>
          <button type="button" className="btn-primary" onClick={saveChannel} disabled={step === "saving" || userKey.trim().length < 20}>
            {step === "saving" ? "Saving..." : "Save and continue"}
          </button>
        </div>
      </div>
    );
  }

  if (step === "needs-admin") {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Pushover app token isn&apos;t set up yet</h2>
        <p className="text-sm text-neutral-700">
          Pushover requires a one-time <strong>app token</strong> on the server side (free — registered at pushover.net).
          Once your deployer adds it, this step will work for any user.
        </p>
        <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900 space-y-2">
          {isAdmin ? (
            <>
              <p className="font-medium">You&apos;re the deployer.</p>
              <p>Open <a className="underline font-medium" href="/admin/setup" target="_blank" rel="noreferrer">/admin/setup</a>, scroll to <strong>Pushover</strong>, and register a free Pushover application. The deployer walkthrough has the details.</p>
            </>
          ) : (
            <>
              <p className="font-medium">Ask your deployer</p>
              <p>Send them: <code className="bg-white px-1 rounded">/admin/setup</code> — they need to register a Pushover application (free). Then this step will work.</p>
            </>
          )}
        </div>
        <div className="flex justify-between pt-2">
          <button type="button" className="btn-secondary" onClick={onSkip}>Skip for now</button>
          <button type="button" className="btn-primary" onClick={() => setStep("form")}>Try again</button>
        </div>
      </div>
    );
  }

  if (step === "test") {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Send a test notification</h2>
        <p className="text-sm text-neutral-700">
          We&apos;ll push a test alert to your Pushover. You should see it on your device within a few seconds.
        </p>
        {testStatus === "idle" && (
          <button type="button" className="btn-primary w-full" onClick={sendTest}>Send test notification</button>
        )}
        {testStatus === "sending" && <p className="text-sm text-neutral-600">Sending…</p>}
        {testStatus === "sent" && (
          <div className="rounded-md bg-green-50 border border-green-200 p-3 text-sm text-green-900">✅ Sent.</div>
        )}
        {testStatus === "failed" && (
          <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-900">
            ❌ Test failed: {errMsg || "unknown error"}
          </div>
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
