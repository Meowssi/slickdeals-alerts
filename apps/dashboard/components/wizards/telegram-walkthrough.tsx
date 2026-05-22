"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

type Step = "intro" | "starting" | "open-telegram" | "needs-admin" | "verified" | "error";

export function TelegramWalkthrough({
  onDone,
  onSkip,
  isAdmin,
}: {
  onDone: () => void;
  onSkip: () => void;
  /** If the current user IS the deployer (their email is in ADMIN_EMAILS), we link them straight to /admin/setup. */
  isAdmin: boolean;
}) {
  const [step, setStep] = useState<Step>("intro");
  const [code, setCode] = useState("");
  const [deeplink, setDeeplink] = useState<string | null>(null);
  const [channelId, setChannelId] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState("");

  async function startVerification() {
    setStep("starting");
    setErrMsg("");
    const supa = supabaseBrowser();

    // 1. Find or create the channel row. The unique key is (user_id, type, name);
    //    reuse an existing "default" row to allow retries after orphaned attempts.
    let chId: string;
    const { data: existing } = await supa
      .from("notification_channels")
      .select("id, verified_at")
      .eq("type", "telegram")
      .eq("name", "default")
      .maybeSingle();

    if (existing?.verified_at) {
      // Already verified — nothing to do, jump to done.
      setChannelId(existing.id);
      setStep("verified");
      return;
    }
    if (existing) {
      // Reuse the unverified row.
      chId = existing.id;
    } else {
      const { data: ch, error: insErr } = await supa
        .from("notification_channels")
        .insert({ type: "telegram", name: "default", config: {}, enabled: true })
        .select("id")
        .single();
      if (insErr || !ch) {
        setStep("error");
        setErrMsg(insErr?.message ?? "could not save channel");
        return;
      }
      chId = ch.id;
    }
    setChannelId(chId);

    // 2. Ask channel-verify for a code + deeplink.
    const { data: { session } } = await supa.auth.getSession();
    let res: Response;
    let json: {
      ok?: boolean;
      error?: string;
      needs_admin?: boolean;
      message?: string;
      code?: string;
      deeplink?: string | null;
    };
    try {
      res = await fetch(
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
      json = await res.json().catch(() => ({}));
    } catch (e) {
      setStep("error");
      setErrMsg(`Could not reach channel-verify: ${(e as Error).message}`);
      return;
    }

    if (json.needs_admin) {
      // Clean up the orphan channel row — we'll start over once admin setup is done.
      await supa.from("notification_channels").delete().eq("id", chId);
      setStep("needs-admin");
      return;
    }
    if (!res.ok || !json.ok) {
      setStep("error");
      setErrMsg(json.message ?? json.error ?? `verify failed (HTTP ${res.status})`);
      return;
    }
    setCode(json.code ?? "");
    setDeeplink(json.deeplink ?? null);
    setStep("open-telegram");
  }

  // Poll for verified_at while the user is in Telegram.
  useEffect(() => {
    if (step !== "open-telegram" || !channelId) return;
    const supa = supabaseBrowser();
    const t = setInterval(async () => {
      const { data } = await supa
        .from("notification_channels")
        .select("verified_at")
        .eq("id", channelId)
        .maybeSingle();
      if (data?.verified_at) {
        clearInterval(t);
        setStep("verified");
      }
    }, 2000);
    return () => clearInterval(t);
  }, [step, channelId]);

  // ---------------- step content ----------------

  if (step === "intro") {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Connect Telegram</h2>
        <p className="text-sm text-neutral-700">
          Free. We generate a code, you tap a link in Telegram, done. Includes inline <strong>Save</strong>/<strong>Dismiss</strong> buttons in chat.
        </p>
        <p className="text-xs text-neutral-500">
          Needs: Telegram app, and your deployer to have set up the bot once at <code className="bg-neutral-100 px-1 rounded">/admin/setup</code>.
        </p>
        <div className="flex justify-between pt-2">
          <button type="button" className="btn-secondary" onClick={onSkip}>Skip</button>
          <button type="button" className="btn-primary" onClick={startVerification}>Get started</button>
        </div>
      </div>
    );
  }

  if (step === "starting") {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Generating your code…</h2>
        <p className="text-sm text-neutral-600">Hold on a sec.</p>
      </div>
    );
  }

  if (step === "needs-admin") {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Telegram bot not set up yet</h2>
        <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-sm text-amber-900">
          {isAdmin ? (
            <p>You&apos;re the deployer — open <a className="underline font-medium" href="/admin/setup" target="_blank" rel="noreferrer">/admin/setup</a>, do the Telegram section (one-time), then come back and click <em>Try again</em>.</p>
          ) : (
            <p>Ask your deployer to do the one-time setup at <code className="bg-white px-1 rounded">/admin/setup</code>. Then click <em>Try again</em>.</p>
          )}
        </div>
        <div className="flex justify-between pt-2">
          <button type="button" className="btn-secondary" onClick={onSkip}>Skip</button>
          <button type="button" className="btn-primary" onClick={startVerification}>Try again</button>
        </div>
      </div>
    );
  }

  if (step === "open-telegram") {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Open Telegram to finish</h2>
        <ol className="list-decimal list-inside space-y-2 text-sm text-neutral-700">
          <li>
            Tap <strong>Open in Telegram</strong> below
            {deeplink && (
              <> (or open Telegram and message the bot with <code className="bg-neutral-100 px-1 rounded">/link {code}</code>)</>
            )}
            .
          </li>
          <li>Telegram opens the bot. Tap the <strong>Start</strong> button.</li>
          <li>The bot will confirm and this page will advance automatically.</li>
        </ol>

        {deeplink && (
          <a className="btn-primary block text-center" href={deeplink} target="_blank" rel="noreferrer">
            Open in Telegram
          </a>
        )}

        <div className="rounded-md bg-neutral-50 border border-neutral-200 p-3 text-xs">
          <p className="text-neutral-600 mb-1">Manual link command (if the button doesn&apos;t work):</p>
          <code className="font-mono text-sm">/link {code}</code>
        </div>

        <p className="text-xs text-neutral-500 text-center">Waiting for Telegram… code expires in 15 min</p>

        <div className="flex justify-between pt-2">
          <button type="button" className="btn-secondary" onClick={onSkip}>Skip for now</button>
        </div>
      </div>
    );
  }

  if (step === "verified") {
    return (
      <div className="space-y-4">
        <div className="rounded-md bg-green-50 border border-green-200 p-4 text-sm text-green-900">
          ✅ Telegram linked! New deal alerts will show up in your chat with Save/Dismiss buttons.
        </div>
        <div className="flex justify-end">
          <button type="button" className="btn-primary" onClick={onDone}>Continue</button>
        </div>
      </div>
    );
  }

  // step === "error"
  return (
    <div className="space-y-4">
      <div className="rounded-md bg-red-50 border border-red-200 p-4 text-sm text-red-900">
        <p className="font-medium">Something went wrong</p>
        <p className="mt-1">{errMsg}</p>
      </div>
      <div className="flex justify-between pt-2">
        <button type="button" className="btn-secondary" onClick={onSkip}>Skip</button>
        <button type="button" className="btn-primary" onClick={startVerification}>Try again</button>
      </div>
    </div>
  );
}
