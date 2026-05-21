"use client";

import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

type Step = "intro" | "topic" | "saving" | "subscribe" | "test" | "done";

export function NtfyWalkthrough({ onDone, onSkip }: { onDone: () => void; onSkip: () => void }) {
  const [step, setStep] = useState<Step>("intro");
  const [topic, setTopic] = useState(suggestTopic);
  const [server, setServer] = useState("https://ntfy.sh");
  const [channelId, setChannelId] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState("");
  const [testStatus, setTestStatus] = useState<"idle" | "sending" | "sent" | "failed">("idle");

  function regenerateTopic() {
    setTopic(suggestTopic());
  }

  async function saveChannel() {
    setStep("saving");
    setErrMsg("");
    const supa = supabaseBrowser();
    const config = { topic: topic.trim(), server: server.trim() || "https://ntfy.sh" };

    // Find or create. Unique key is (user_id, type, name) — reuse "default" row
    // if it exists (e.g., user retrying after an error or changing their topic).
    const { data: existing } = await supa
      .from("notification_channels")
      .select("id")
      .eq("type", "ntfy")
      .eq("name", "default")
      .maybeSingle();

    let chId: string;
    if (existing) {
      // Update config + clear any verification state from a prior attempt.
      const { error: updErr } = await supa
        .from("notification_channels")
        .update({ config, enabled: true, verified_at: null, verification_code: null, verification_expires_at: null })
        .eq("id", existing.id);
      if (updErr) {
        setErrMsg(updErr.message);
        setStep("topic");
        return;
      }
      chId = existing.id;
    } else {
      const { data: ch, error: insErr } = await supa
        .from("notification_channels")
        .insert({ type: "ntfy", name: "default", config, enabled: true })
        .select("id")
        .single();
      if (insErr || !ch) {
        setErrMsg(insErr?.message ?? "could not save channel");
        setStep("topic");
        return;
      }
      chId = ch.id;
    }
    setChannelId(chId);

    const { data: { session } } = await supa.auth.getSession();
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/channel-verify`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session?.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ channel_id: chId, action: "start" }),
        },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        setErrMsg(json.error ?? `verify failed (HTTP ${res.status})`);
        setStep("topic");
        return;
      }
    } catch (e) {
      setErrMsg(`Could not reach channel-verify: ${(e as Error).message}`);
      setStep("topic");
      return;
    }
    setStep("subscribe");
  }

  async function sendTest() {
    if (!channelId) return;
    setTestStatus("sending");
    const supa = supabaseBrowser();
    const { data: { session } } = await supa.auth.getSession();
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/send-test`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session?.access_token}`,
            "Content-Type": "application/json",
          },
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

  // -------- step content --------

  if (step === "intro") {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Connect ntfy.sh</h2>
        <p className="text-sm text-neutral-700">
          <a className="underline" href="https://ntfy.sh" target="_blank" rel="noreferrer">ntfy.sh</a>{" "}
          is a free, open-source push notification service. You subscribe to a private &quot;topic&quot; name
          on your phone (or any device with the ntfy app or browser) and we send notifications to that topic.
        </p>
        <ul className="text-sm text-neutral-700 list-disc list-inside space-y-1">
          <li>No account needed — just pick a topic name.</li>
          <li>Works on iOS, Android, desktop, web.</li>
          <li>Privacy: anyone who knows your topic name can read it, so we pick a random one for you.</li>
        </ul>
        <div className="flex justify-between pt-2">
          <button type="button" className="btn-secondary" onClick={onSkip}>Skip</button>
          <button type="button" className="btn-primary" onClick={() => setStep("topic")}>Get started</button>
        </div>
      </div>
    );
  }

  if (step === "topic" || step === "saving") {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Pick your topic</h2>
        <p className="text-sm text-neutral-700">
          We&apos;ve generated a random hard-to-guess topic. Treat it like a password —
          anyone who knows it can read your alerts.
        </p>
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">Topic name</label>
          <div className="flex gap-2">
            <input
              className="input flex-1 font-mono text-sm"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              disabled={step === "saving"}
            />
            <button
              type="button"
              className="btn-secondary text-xs"
              onClick={regenerateTopic}
              disabled={step === "saving"}
            >
              Regenerate
            </button>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">
            Server URL <span className="text-neutral-400 font-normal">(optional)</span>
          </label>
          <input
            className="input"
            value={server}
            onChange={(e) => setServer(e.target.value)}
            disabled={step === "saving"}
            placeholder="https://ntfy.sh"
          />
          <p className="text-xs text-neutral-500 mt-1">Leave default unless you self-host ntfy.</p>
        </div>
        {errMsg && <p className="text-sm text-red-600">{errMsg}</p>}
        <div className="flex justify-between pt-2">
          <button type="button" className="btn-secondary" onClick={() => setStep("intro")} disabled={step === "saving"}>Back</button>
          <button type="button" className="btn-primary" onClick={saveChannel} disabled={step === "saving" || !topic.trim()}>
            {step === "saving" ? "Saving..." : "Save and continue"}
          </button>
        </div>
      </div>
    );
  }

  if (step === "subscribe") {
    const subscribeUrl = `${server.replace(/\/$/, "")}/${topic}`;
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Subscribe on your device</h2>
        <p className="text-sm text-neutral-700">Open the ntfy app (or use the web subscriber) and subscribe to:</p>

        <div className="rounded-md bg-neutral-100 border border-neutral-200 p-3 font-mono text-sm break-all">
          {topic}
        </div>

        <div className="grid sm:grid-cols-3 gap-2">
          <a
            href="https://apps.apple.com/us/app/ntfy/id1625396347"
            target="_blank"
            rel="noreferrer"
            className="btn-secondary text-center text-sm"
          >
            📱 iOS app
          </a>
          <a
            href="https://play.google.com/store/apps/details?id=io.heckel.ntfy"
            target="_blank"
            rel="noreferrer"
            className="btn-secondary text-center text-sm"
          >
            🤖 Android app
          </a>
          <a
            href={subscribeUrl}
            target="_blank"
            rel="noreferrer"
            className="btn-secondary text-center text-sm"
          >
            🌐 Open in browser
          </a>
        </div>

        <div className="rounded-md bg-blue-50 border border-blue-200 p-3 text-xs text-blue-900">
          <p className="font-medium mb-1">How to subscribe:</p>
          <ol className="list-decimal list-inside space-y-1">
            <li>Open the ntfy app on your phone.</li>
            <li>Tap the + button to add a subscription.</li>
            <li>Enter the topic name above (or scan the QR if your app supports it).</li>
            <li>If using a custom server, change the server URL in the app first.</li>
          </ol>
        </div>

        <div className="flex justify-between pt-2">
          <button type="button" className="btn-secondary" onClick={onSkip}>Skip test, I&apos;m done</button>
          <button type="button" className="btn-primary" onClick={() => setStep("test")}>I&apos;ve subscribed, send a test</button>
        </div>
      </div>
    );
  }

  if (step === "test") {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Send a test notification</h2>
        <p className="text-sm text-neutral-700">
          We&apos;ll push a test notification to topic <code className="bg-neutral-100 px-1 py-0.5 rounded text-xs">{topic}</code>.
          You should see it on your device within a few seconds.
        </p>

        {testStatus === "idle" && (
          <button type="button" className="btn-primary w-full" onClick={sendTest}>
            Send test notification
          </button>
        )}
        {testStatus === "sending" && (
          <p className="text-sm text-neutral-600">Sending…</p>
        )}
        {testStatus === "sent" && (
          <div className="rounded-md bg-green-50 border border-green-200 p-3 text-sm text-green-900">
            ✅ Sent. If you didn&apos;t receive it: check the topic name matches, check the ntfy app is subscribed, check notifications aren&apos;t blocked.
          </div>
        )}
        {testStatus === "failed" && (
          <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-900">
            ❌ Test failed: {errMsg || "unknown error"}
          </div>
        )}

        <div className="flex justify-between pt-2">
          <button type="button" className="btn-secondary" onClick={() => { setTestStatus("idle"); setErrMsg(""); sendTest(); }} disabled={testStatus === "sending"}>
            Resend
          </button>
          <button type="button" className="btn-primary" onClick={onDone}>
            {testStatus === "sent" ? "Done 🎉" : "I'll figure it out later, continue"}
          </button>
        </div>
      </div>
    );
  }

  return null;
}

function suggestTopic(): string {
  // 16 chars of url-safe entropy.
  const chars = "abcdefghijkmnpqrstuvwxyz23456789";
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  let out = "slickalerts-";
  for (let i = 0; i < 16; i++) out += chars[buf[i]! % chars.length];
  return out;
}
