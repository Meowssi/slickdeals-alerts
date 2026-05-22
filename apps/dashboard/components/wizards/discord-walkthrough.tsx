"use client";

import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

type Step = "intro" | "create" | "form" | "saving" | "test" | "done";

export function DiscordWalkthrough({ onDone, onSkip }: { onDone: () => void; onSkip: () => void }) {
  const [step, setStep] = useState<Step>("intro");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [channelId, setChannelId] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState("");
  const [testStatus, setTestStatus] = useState<"idle" | "sending" | "sent" | "failed">("idle");

  function valid(): boolean {
    return /^https:\/\/(discord(app)?\.com|discord)\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+$/.test(webhookUrl.trim());
  }

  async function saveChannel() {
    setStep("saving");
    setErrMsg("");
    const supa = supabaseBrowser();
    const config = { webhook_url: webhookUrl.trim() };

    const { data: existing } = await supa
      .from("notification_channels")
      .select("id")
      .eq("type", "discord")
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
        .insert({ type: "discord", name: "default", config, enabled: true })
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

  // -------- step content --------

  if (step === "intro") {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Connect Discord</h2>
        <p className="text-sm text-neutral-700">
          Free. We post deal alerts to a Discord channel via a webhook URL — no bot or extra permissions.
        </p>
        <p className="text-xs text-neutral-500">The URL is sensitive: anyone who has it can post to that channel.</p>
        <div className="flex justify-between pt-2">
          <button type="button" className="btn-secondary" onClick={onSkip}>Skip</button>
          <button type="button" className="btn-primary" onClick={() => setStep("create")}>Get started</button>
        </div>
      </div>
    );
  }

  if (step === "create") {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Create a Discord webhook</h2>
        <ol className="list-decimal list-inside text-sm text-neutral-700 space-y-2">
          <li>Open Discord, go to your server.</li>
          <li>Right-click the channel where alerts should appear → <strong>Edit Channel</strong>.</li>
          <li><strong>Integrations</strong> → <strong>Webhooks</strong> → <strong>New Webhook</strong>.</li>
          <li>Name it (e.g. &quot;Slickdeals Alerts&quot;), click <strong>Copy Webhook URL</strong>.</li>
        </ol>
        <div className="flex justify-between pt-2">
          <button type="button" className="btn-secondary" onClick={() => setStep("intro")}>Back</button>
          <button type="button" className="btn-primary" onClick={() => setStep("form")}>URL copied →</button>
        </div>
      </div>
    );
  }

  if (step === "form" || step === "saving") {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Paste the webhook URL</h2>
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">Webhook URL</label>
          <input
            type="url"
            className="input font-mono text-xs"
            placeholder="https://discord.com/api/webhooks/123456789012345678/abc...xyz"
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            disabled={step === "saving"}
          />
          <p className="text-xs text-neutral-500 mt-1">
            Looks like <code className="bg-neutral-100 px-1 rounded">https://discord.com/api/webhooks/&lt;numbers&gt;/&lt;letters&gt;</code>
          </p>
        </div>
        {errMsg && <p className="text-sm text-red-600">{errMsg}</p>}
        <div className="flex justify-between pt-2">
          <button type="button" className="btn-secondary" onClick={() => setStep("create")} disabled={step === "saving"}>Back</button>
          <button type="button" className="btn-primary" onClick={saveChannel} disabled={step === "saving" || !valid()}>
            {step === "saving" ? "Saving..." : "Save and continue"}
          </button>
        </div>
      </div>
    );
  }

  if (step === "test") {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Send a test message</h2>
        <p className="text-sm text-neutral-700">
          We&apos;ll post a test message to your Discord channel right now.
        </p>

        {testStatus === "idle" && (
          <button type="button" className="btn-primary w-full" onClick={sendTest}>
            Send test message
          </button>
        )}
        {testStatus === "sending" && <p className="text-sm text-neutral-600">Sending…</p>}
        {testStatus === "sent" && (
          <div className="rounded-md bg-green-50 border border-green-200 p-3 text-sm text-green-900">
            ✅ Sent. Check your Discord channel.
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
            {testStatus === "sent" ? "Done 🎉" : "Continue anyway"}
          </button>
        </div>
      </div>
    );
  }

  return null;
}
