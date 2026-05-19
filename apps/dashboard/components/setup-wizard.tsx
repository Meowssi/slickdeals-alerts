"use client";

// Multi-step onboarding wizard. New users land here after first sign-in.
// Steps:
//   1. Welcome / explainer
//   2. Pick notification channel(s) — Telegram, SMS, ntfy, Pushover, Discord, Email, Webhook
//   3. Configure each picked channel (loop through, with provider-specific UX)
//   4. Add first alert (paste RSS URL)
//   5. Done — mark onboarded_at, drop into the app

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PROVIDER_CATALOG, type ProviderMeta } from "@slickalerts/shared";
import { supabaseBrowser } from "@/lib/supabase/client";

type Step =
  | { kind: "welcome" }
  | { kind: "pick-channels" }
  | { kind: "configure-channel"; queue: string[]; index: number }
  | { kind: "first-alert" }
  | { kind: "done" };

export function SetupWizard({ email }: { email: string }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>({ kind: "welcome" });
  const [picked, setPicked] = useState<Set<string>>(new Set());

  return (
    <div className="card p-8">
      <Progress step={step} />

      {step.kind === "welcome" && (
        <Welcome email={email} onNext={() => setStep({ kind: "pick-channels" })} />
      )}

      {step.kind === "pick-channels" && (
        <PickChannels
          picked={picked}
          setPicked={setPicked}
          onBack={() => setStep({ kind: "welcome" })}
          onNext={() => {
            const queue = Array.from(picked);
            if (queue.length === 0) {
              setStep({ kind: "first-alert" });
              return;
            }
            setStep({ kind: "configure-channel", queue, index: 0 });
          }}
        />
      )}

      {step.kind === "configure-channel" && (
        <ConfigureChannel
          providerType={step.queue[step.index]!}
          stepNumber={step.index + 1}
          totalSteps={step.queue.length}
          onSkip={() => advance(step, setStep)}
          onDone={() => advance(step, setStep)}
        />
      )}

      {step.kind === "first-alert" && (
        <FirstAlert
          onBack={() => setStep({ kind: "pick-channels" })}
          onSkip={() => finish(router)}
          onDone={() => finish(router)}
        />
      )}
    </div>
  );
}

function advance(
  step: Extract<Step, { kind: "configure-channel" }>,
  setStep: (s: Step) => void,
): void {
  if (step.index + 1 >= step.queue.length) {
    setStep({ kind: "first-alert" });
  } else {
    setStep({ kind: "configure-channel", queue: step.queue, index: step.index + 1 });
  }
}

async function finish(router: ReturnType<typeof useRouter>): Promise<void> {
  const supa = supabaseBrowser();
  const { data: { user } } = await supa.auth.getUser();
  if (user) {
    await supa
      .from("user_settings")
      .update({ onboarded_at: new Date().toISOString() })
      .eq("user_id", user.id);
  }
  router.push("/");
  router.refresh();
}

// ============================================================================
// Step components
// ============================================================================

function Progress({ step }: { step: Step }) {
  const stepNum = useMemo(() => {
    switch (step.kind) {
      case "welcome": return 1;
      case "pick-channels": return 2;
      case "configure-channel": return 3;
      case "first-alert": return 4;
      case "done": return 5;
    }
  }, [step]);
  return (
    <div className="mb-8 flex items-center gap-2 text-xs text-neutral-500">
      <span>Step {stepNum} of 4</span>
      <div className="flex-1 h-1 bg-neutral-200 rounded overflow-hidden">
        <div
          className="h-full bg-brand-500 transition-all"
          style={{ width: `${(stepNum / 4) * 100}%` }}
        />
      </div>
    </div>
  );
}

function Welcome({ email, onNext }: { email: string; onNext: () => void }) {
  return (
    <>
      <h1 className="text-2xl font-semibold mb-2">Welcome 👋</h1>
      <p className="text-neutral-600 mb-6">
        Signed in as <strong>{email}</strong>. Let&apos;s get you set up in 3 quick steps:
      </p>
      <ol className="list-decimal list-inside space-y-2 text-neutral-700 mb-8">
        <li>Pick how you want to be notified (Telegram, SMS, email, etc.)</li>
        <li>Connect each notification channel</li>
        <li>Add your first Slickdeals RSS feed</li>
      </ol>
      <div className="flex justify-end">
        <button className="btn-primary" onClick={onNext}>Get started</button>
      </div>
    </>
  );
}

function PickChannels(props: {
  picked: Set<string>;
  setPicked: (s: Set<string>) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  function toggle(type: string) {
    const next = new Set(props.picked);
    if (next.has(type)) next.delete(type); else next.add(type);
    props.setPicked(next);
  }
  return (
    <>
      <h1 className="text-2xl font-semibold mb-2">How do you want to be notified?</h1>
      <p className="text-neutral-600 mb-6">
        Pick one or more. You can add or remove channels anytime from Settings.
      </p>
      <div className="grid sm:grid-cols-2 gap-3 mb-6">
        {PROVIDER_CATALOG.map((p) => (
          <button
            key={p.type}
            type="button"
            onClick={() => toggle(p.type)}
            className={
              "text-left p-4 rounded-lg border-2 transition " +
              (props.picked.has(p.type)
                ? "border-brand-500 bg-brand-50"
                : "border-neutral-200 hover:border-neutral-300")
            }
          >
            <div className="font-medium">{p.displayName}</div>
            <div className="text-xs text-neutral-600 mt-1">{p.description}</div>
          </button>
        ))}
      </div>
      <div className="flex justify-between">
        <button className="btn-secondary" onClick={props.onBack}>Back</button>
        <button className="btn-primary" onClick={props.onNext}>
          {props.picked.size === 0 ? "Skip for now" : `Continue (${props.picked.size})`}
        </button>
      </div>
    </>
  );
}

function ConfigureChannel(props: {
  providerType: string;
  stepNumber: number;
  totalSteps: number;
  onSkip: () => void;
  onDone: () => void;
}) {
  const meta = PROVIDER_CATALOG.find((p) => p.type === props.providerType);
  if (!meta) return <p>Unknown provider.</p>;

  return (
    <>
      <div className="text-xs text-neutral-500 mb-2">
        Channel {props.stepNumber} of {props.totalSteps}
      </div>
      <h1 className="text-2xl font-semibold mb-2">Connect {meta.displayName}</h1>
      <p className="text-neutral-600 mb-4">{meta.setup.instructions}</p>

      <ChannelForm meta={meta} onDone={props.onDone} onSkip={props.onSkip} />
    </>
  );
}

function ChannelForm({
  meta, onDone, onSkip,
}: { meta: ProviderMeta; onDone: () => void; onSkip: () => void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [phase, setPhase] = useState<"form" | "verifying" | "verified" | "error">("form");
  const [verifyInfo, setVerifyInfo] = useState<
    | { kind: "telegram"; code: string; deeplink: string | null }
    | { kind: "sms"; channelId: string }
    | null
  >(null);
  const [smsCode, setSmsCode] = useState("");
  const [errMsg, setErrMsg] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPhase("verifying");
    setErrMsg("");
    const supa = supabaseBrowser();

    // 1. Insert channel row (RLS lets the user write their own).
    const { data: ch, error: insErr } = await supa
      .from("notification_channels")
      .insert({
        type: meta.type,
        name: "default",
        config: meta.type === "ntfy"
          ? { topic: values.topic, server: values.server || "https://ntfy.sh" }
          : values,
        enabled: true,
      })
      .select("id")
      .single();

    if (insErr || !ch) {
      setPhase("error");
      setErrMsg(insErr?.message ?? "could not save channel");
      return;
    }

    // 2. Kick off verification.
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
      setPhase("error");
      setErrMsg(json.error ?? "verification failed");
      return;
    }

    if (meta.setup.verifyMode === "telegram") {
      setVerifyInfo({ kind: "telegram", code: json.code, deeplink: json.deeplink });
      setPhase("verifying"); // user takes action in Telegram
    } else if (meta.setup.verifyMode === "sms") {
      setVerifyInfo({ kind: "sms", channelId: ch.id });
      setPhase("verifying");
    } else {
      setPhase("verified");
    }
  }

  async function confirmSms() {
    setPhase("verifying");
    const supa = supabaseBrowser();
    const { data: { session } } = await supa.auth.getSession();
    const info = verifyInfo as Extract<typeof verifyInfo, { kind: "sms" }>;
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/channel-verify`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session?.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          channel_id: info.channelId,
          action: "confirm",
          code: smsCode.trim().toUpperCase(),
        }),
      },
    );
    const json = await res.json();
    if (!res.ok || !json.ok) {
      setPhase("error");
      setErrMsg(json.error ?? "invalid code");
      return;
    }
    setPhase("verified");
  }

  // Telegram doesn't get a "click confirm" UX — the bot side does it. We poll.
  useEffect(() => {
    if (phase !== "verifying" || verifyInfo?.kind !== "telegram") return;
    const supa = supabaseBrowser();
    const t = setInterval(async () => {
      const { data } = await supa
        .from("notification_channels")
        .select("verified_at")
        .eq("verification_code", null)
        .eq("type", "telegram")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data?.verified_at) {
        clearInterval(t);
        setPhase("verified");
      }
    }, 2000);
    return () => clearInterval(t);
  }, [phase, verifyInfo]);

  if (phase === "verified") {
    return (
      <div>
        <div className="rounded-md bg-green-50 border border-green-200 p-4 text-sm text-green-900 mb-4">
          ✅ Connected {meta.displayName}.
        </div>
        <div className="flex justify-end">
          <button className="btn-primary" onClick={onDone}>Continue</button>
        </div>
      </div>
    );
  }

  if (verifyInfo?.kind === "telegram") {
    return (
      <div className="space-y-4">
        <div className="rounded-md bg-amber-50 border border-amber-200 p-4 text-sm text-amber-900">
          <p className="font-medium mb-1">Almost there — open Telegram now.</p>
          <p>Tap the deep link below, or message the bot:</p>
          <p className="font-mono mt-2 text-base bg-white border border-amber-200 rounded px-2 py-1 inline-block">
            /link {verifyInfo.code}
          </p>
          {verifyInfo.deeplink && (
            <p className="mt-3">
              <a className="btn-primary" href={verifyInfo.deeplink} target="_blank" rel="noreferrer">
                Open in Telegram
              </a>
            </p>
          )}
          <p className="mt-3 text-xs">Waiting for confirmation…</p>
        </div>
        <div className="flex justify-between">
          <button className="btn-secondary" onClick={onSkip}>Skip for now</button>
        </div>
      </div>
    );
  }

  if (verifyInfo?.kind === "sms") {
    return (
      <div className="space-y-4">
        <p className="text-neutral-700">We texted you a 6-character code. Enter it below:</p>
        <input
          className="input font-mono uppercase tracking-widest text-center text-lg"
          maxLength={6}
          value={smsCode}
          onChange={(e) => setSmsCode(e.target.value)}
          placeholder="ABC123"
        />
        {errMsg && <p className="text-sm text-red-600">{errMsg}</p>}
        <div className="flex justify-between">
          <button className="btn-secondary" onClick={onSkip}>Skip</button>
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
          We&apos;ll generate a code and walk you through the rest.
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
      {errMsg && <p className="text-sm text-red-600">{errMsg}</p>}
      <div className="flex justify-between">
        <button type="button" className="btn-secondary" onClick={onSkip}>Skip</button>
        <button type="submit" className="btn-primary" disabled={phase === "verifying"}>
          {phase === "verifying" ? "Working..." : "Continue"}
        </button>
      </div>
    </form>
  );
}

function FirstAlert(props: {
  onBack: () => void;
  onSkip: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [errMsg, setErrMsg] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErrMsg("");
    const supa = supabaseBrowser();
    const { error } = await supa.from("alerts").insert({
      name: name.trim(),
      rss_url: url.trim(),
    });
    setSaving(false);
    if (error) {
      setErrMsg(error.message);
      return;
    }
    props.onDone();
  }

  return (
    <>
      <h1 className="text-2xl font-semibold mb-2">Add your first alert</h1>
      <p className="text-neutral-600 mb-6">
        Build a search on{" "}
        <a href="https://slickdeals.net" target="_blank" rel="noreferrer" className="text-brand-600 underline">
          slickdeals.net
        </a>{" "}
        with the keywords/filters you care about, then click the RSS icon and paste the URL here.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">Alert name</label>
          <input
            className="input"
            required
            placeholder="Cat6 cables under $20"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">RSS feed URL</label>
          <input
            className="input"
            required
            type="url"
            placeholder="https://slickdeals.net/newsearch.php?..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </div>
        {errMsg && <p className="text-sm text-red-600">{errMsg}</p>}
        <div className="flex justify-between">
          <button type="button" className="btn-secondary" onClick={props.onBack}>Back</button>
          <div className="flex gap-2">
            <button type="button" className="btn-secondary" onClick={props.onSkip}>
              Skip for now
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? "Saving..." : "Save & finish"}
            </button>
          </div>
        </div>
      </form>
    </>
  );
}
