"use client";

// Single channel creation + verification form. Reused by setup wizard and Settings.

import { useEffect, useState } from "react";
import type { ProviderMeta } from "@slickalerts/shared/providers";
import { supabaseBrowser } from "@/lib/supabase/client";

type Phase =
  | { kind: "form" }
  | { kind: "verifying-telegram"; code: string; deeplink: string | null }
  | { kind: "verifying-sms"; channelId: string }
  | { kind: "done" }
  | { kind: "error"; msg: string };

export function ChannelForm({
  meta, onDone, onCancel,
}: {
  meta: ProviderMeta;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [phase, setPhase] = useState<Phase>({ kind: "form" });
  const [smsCode, setSmsCode] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const supa = supabaseBrowser();

    const config: Record<string, unknown> =
      meta.type === "ntfy"
        ? { topic: values.topic, server: values.server || "https://ntfy.sh" }
        : values;

    const { data: ch, error: insErr } = await supa
      .from("notification_channels")
      .insert({ type: meta.type, name: "default", config, enabled: true })
      .select("id")
      .single();
    if (insErr || !ch) {
      setPhase({ kind: "error", msg: insErr?.message ?? "could not save channel" });
      return;
    }

    const { data: { session } } = await supa.auth.getSession();
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/channel-verify`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session?.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ channel_id: ch.id, action: "start" }),
      },
    );
    const json = await res.json();
    if (!res.ok || !json.ok) {
      setPhase({ kind: "error", msg: json.error ?? "verification failed" });
      return;
    }

    if (meta.setup.verifyMode === "telegram") {
      setPhase({ kind: "verifying-telegram", code: json.code, deeplink: json.deeplink });
    } else if (meta.setup.verifyMode === "sms") {
      setPhase({ kind: "verifying-sms", channelId: ch.id });
    } else {
      setPhase({ kind: "done" });
    }
  }

  async function confirmSms() {
    if (phase.kind !== "verifying-sms") return;
    const supa = supabaseBrowser();
    const { data: { session } } = await supa.auth.getSession();
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/channel-verify`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session?.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          channel_id: phase.channelId,
          action: "confirm",
          code: smsCode.trim().toUpperCase(),
        }),
      },
    );
    const json = await res.json();
    if (!res.ok || !json.ok) {
      setPhase({ kind: "error", msg: json.error ?? "invalid code" });
      return;
    }
    setPhase({ kind: "done" });
  }

  // Poll for Telegram verification.
  useEffect(() => {
    if (phase.kind !== "verifying-telegram") return;
    const supa = supabaseBrowser();
    const t = setInterval(async () => {
      const { data } = await supa
        .from("notification_channels")
        .select("verified_at")
        .eq("type", "telegram")
        .not("verified_at", "is", null)
        .order("verified_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data?.verified_at) {
        clearInterval(t);
        setPhase({ kind: "done" });
      }
    }, 2000);
    return () => clearInterval(t);
  }, [phase]);

  if (phase.kind === "done") {
    return (
      <div className="space-y-4">
        <div className="rounded-md bg-green-50 border border-green-200 p-4 text-sm text-green-900">
          ✅ {meta.displayName} connected.
        </div>
        <div className="text-right">
          <button className="btn-primary" onClick={onDone}>Done</button>
        </div>
      </div>
    );
  }

  if (phase.kind === "verifying-telegram") {
    return (
      <div className="space-y-4">
        <div className="rounded-md bg-amber-50 border border-amber-200 p-4 text-sm">
          <p className="font-medium mb-1">Open Telegram now.</p>
          <p>Tap the deep link, or send the bot:</p>
          <p className="font-mono mt-2 text-base bg-white border border-amber-200 rounded px-2 py-1 inline-block">
            /link {phase.code}
          </p>
          {phase.deeplink && (
            <p className="mt-3">
              <a className="btn-primary" href={phase.deeplink} target="_blank" rel="noreferrer">
                Open in Telegram
              </a>
            </p>
          )}
          <p className="mt-3 text-xs">Waiting for confirmation…</p>
        </div>
        <div className="text-right">
          <button className="btn-secondary" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    );
  }

  if (phase.kind === "verifying-sms") {
    return (
      <div className="space-y-4">
        <p className="text-neutral-700">Enter the 6-character code we texted you:</p>
        <input
          className="input font-mono uppercase tracking-widest text-center text-lg"
          maxLength={6}
          value={smsCode}
          onChange={(e) => setSmsCode(e.target.value)}
          placeholder="ABC123"
        />
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onCancel}>Cancel</button>
          <button className="btn-primary" onClick={confirmSms} disabled={smsCode.length < 6}>
            Confirm
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {meta.setup.fields.length === 0 && (
        <p className="text-sm text-neutral-600">
          No config needed — we&apos;ll generate a code and walk you through the rest.
        </p>
      )}
      {meta.setup.fields.map((f) => (
        <div key={f.key}>
          <label className="block text-sm font-medium text-neutral-700 mb-1">
            {f.label}
            {!f.required && <span className="text-neutral-400 font-normal"> (optional)</span>}
          </label>
          <input
            className="input"
            type={f.type ?? "text"}
            required={f.required}
            placeholder={f.placeholder}
            value={values[f.key] ?? ""}
            onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
          />
          {f.help && <p className="text-xs text-neutral-500 mt-1">{f.help}</p>}
        </div>
      ))}
      {phase.kind === "error" && <p className="text-sm text-red-600">{phase.msg}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn-primary">Continue</button>
      </div>
    </form>
  );
}
