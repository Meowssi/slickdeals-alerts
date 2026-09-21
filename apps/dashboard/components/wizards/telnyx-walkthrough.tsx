"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { CopyableUrl, CopyableText } from "@/components/footer";

type Step =
  | "intro"
  | "signup"
  | "buy-number"
  | "get-api-key"
  | "a2p-brand"
  | "a2p-campaign"
  | "form"
  | "saving"
  | "credentials-saved"
  | "sending-sms"
  | "confirm"
  | "verified"
  | "error";

interface TelnyxConfig {
  api_key: string;
  from_number: string;
  phone: string;
}

export function TelnyxWalkthrough({ onDone, onSkip }: { onDone: () => void; onSkip: () => void }) {
  const [step, setStep] = useState<Step>("intro");
  const [apiKey, setApiKey] = useState("");
  const [fromNumber, setFromNumber] = useState("");
  const [phone, setPhone] = useState("");
  const [smsCode, setSmsCode] = useState("");
  const [channelId, setChannelId] = useState<string | null>(null);
  const [hasExistingChannel, setHasExistingChannel] = useState(false);
  const [errMsg, setErrMsg] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supa = supabaseBrowser();
      const { data } = await supa
        .from("notification_channels")
        .select("id, verified_at, config")
        .eq("type", "sms_telnyx")
        .eq("name", "default")
        .maybeSingle();
      if (cancelled || !data) return;
      const cfg = (data.config ?? {}) as Partial<TelnyxConfig>;
      setChannelId(data.id);
      setHasExistingChannel(true);
      if (cfg.from_number) setFromNumber(cfg.from_number);
      if (cfg.phone)       setPhone(cfg.phone);
    })();
    return () => { cancelled = true; };
  }, []);

  const isE164 = (s: string) => /^\+[1-9]\d{6,14}$/.test(s.trim());

  function formValid(): boolean {
    return (
      (hasExistingChannel || apiKey.trim().length >= 20) &&
      isE164(fromNumber) &&
      isE164(phone)
    );
  }

  async function saveCredentials() {
    setStep("saving");
    setErrMsg("");
    const supa = supabaseBrowser();

    const { data: existing } = await supa
      .from("notification_channels")
      .select("id, config")
      .eq("type", "sms_telnyx")
      .eq("name", "default")
      .maybeSingle();

    const existingConfig = (existing?.config ?? {}) as Partial<TelnyxConfig>;
    const apiKeyFinal = apiKey.trim() || existingConfig.api_key || "";
    if (!apiKeyFinal) {
      setStep("form");
      setErrMsg("API key is required.");
      return;
    }
    const config: TelnyxConfig = {
      api_key: apiKeyFinal,
      from_number: fromNumber.trim(),
      phone: phone.trim(),
    };

    let chId: string;
    if (existing) {
      const { error: updErr } = await supa
        .from("notification_channels")
        .update({ config, enabled: true, verified_at: null, verification_code: null, verification_expires_at: null })
        .eq("id", existing.id);
      if (updErr) { setStep("error"); setErrMsg(updErr.message); return; }
      chId = existing.id;
    } else {
      const { data: ch, error: insErr } = await supa
        .from("notification_channels")
        .insert({ type: "sms_telnyx", name: "default", config, enabled: true })
        .select("id")
        .single();
      if (insErr || !ch) { setStep("error"); setErrMsg(insErr?.message ?? "could not save channel"); return; }
      chId = ch.id;
    }
    setChannelId(chId);
    setStep("credentials-saved");
  }

  async function triggerVerificationSms() {
    if (!channelId) { setStep("error"); setErrMsg("No channel id. Save credentials first."); return; }
    setStep("sending-sms");
    setErrMsg("");
    const supa = supabaseBrowser();
    const { data: { session } } = await supa.auth.getSession();
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/channel-verify`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${session?.access_token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ channel_id: channelId, action: "start" }),
        },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        setStep("credentials-saved");
        setErrMsg(`Telnyx rejected: ${json.error ?? `HTTP ${res.status}`}`);
        return;
      }
    } catch (e) {
      setStep("credentials-saved");
      setErrMsg(`Couldn't reach verification function: ${(e as Error).message}`);
      return;
    }
    setStep("confirm");
  }

  async function confirmCode() {
    if (!channelId) { setStep("error"); setErrMsg("No channel ID — save credentials first."); return; }
    const supa = supabaseBrowser();
    const { data: { session } } = await supa.auth.getSession();
    if (!session?.access_token) { setStep("error"); setErrMsg("Session expired — please sign in again."); return; }
    setStep("sending-sms");
    setErrMsg("");
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/channel-verify`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${session?.access_token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ channel_id: channelId, action: "confirm", code: smsCode.trim().toUpperCase() }),
        },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        setStep("confirm");
        setErrMsg(json.error ?? `invalid code (HTTP ${res.status})`);
        return;
      }
    } catch (e) {
      setStep("confirm");
      setErrMsg(`Could not reach channel-verify: ${(e as Error).message}`);
      return;
    }
    setStep("verified");
  }

  // ---- step renders ----

  if (step === "intro") {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Connect SMS via Telnyx</h2>

        {hasExistingChannel && (
          <div className="rounded-md bg-blue-50 border border-blue-200 p-3 text-sm text-blue-900 space-y-2">
            <p className="font-semibold">Picking up where you left off?</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-primary text-xs" onClick={() => setStep("credentials-saved")}>Skip to verification</button>
              <button type="button" className="btn-secondary text-xs" onClick={() => setStep("a2p-brand")}>A2P Brand</button>
              <button type="button" className="btn-secondary text-xs" onClick={() => setStep("a2p-campaign")}>A2P Campaign</button>
            </div>
          </div>
        )}

        <p className="text-sm text-neutral-700">
          Telnyx sends real SMS to any phone — even flip phones. Setup takes about 15 minutes of clicking plus a few hours waiting for A2P campaign approval.
        </p>

        <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-sm text-amber-900 space-y-1">
          <p className="font-semibold">You pay Telnyx (not us)</p>
          <ul className="list-disc list-inside text-xs space-y-0.5">
            <li>$4.50 one-time brand registration</li>
            <li>$15 one-time campaign registration</li>
            <li>$1.50/month A2P campaign fee</li>
            <li>~$1/month per phone number</li>
            <li>~$0.005 per SMS sent</li>
            <li><strong>All-in: ~$22 to start, then ~$2.50/month</strong></li>
          </ul>
          <p className="text-xs text-amber-800 mt-1">
            No prepaid balance required. Telnyx bills your card monthly for actual usage.
          </p>
        </div>

        <div className="rounded-md bg-blue-50 border border-blue-200 p-3 text-xs text-blue-900">
          <strong>Want notifications working in 5 minutes instead?</strong> Use Telegram or ntfy — both free, no carrier registration. Hit Skip below.
        </div>

        <div className="flex justify-between pt-2">
          <button type="button" className="btn-secondary" onClick={onSkip}>Skip — use another channel</button>
          <button type="button" className="btn-primary" onClick={() => setStep("signup")}>I want SMS, let&apos;s go</button>
        </div>
      </div>
    );
  }

  if (step === "signup") {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Step 1: Sign up for Telnyx</h2>
        <ul className="list-disc list-inside text-sm text-neutral-700 space-y-1">
          <li>Go to <a className="text-blue-700 underline" href="https://telnyx.com" target="_blank" rel="noreferrer">telnyx.com</a> → click <strong>Sign Up Free</strong>.</li>
          <li>Enter your name, email, and a password. Confirm your email.</li>
          <li>Sign back in. You&apos;ll land on the <strong>Mission Control Portal</strong> — their dashboard.</li>
          <li>They&apos;ll ask for a credit card to activate your account. Add one — no charge upfront.</li>
        </ul>
        <div className="flex justify-between pt-2">
          <button type="button" className="btn-secondary" onClick={() => setStep("intro")}>Back</button>
          <button type="button" className="btn-primary" onClick={() => setStep("buy-number")}>Account ready →</button>
        </div>
      </div>
    );
  }

  if (step === "buy-number") {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Step 2: Buy a Telnyx phone number</h2>
        <p className="text-sm text-neutral-700">~$1/month. Billed to your card monthly.</p>
        <ol className="list-decimal list-inside text-sm text-neutral-700 space-y-1">
          <li>In Mission Control: <strong>Numbers</strong> → <strong>Buy numbers</strong>.</li>
          <li>Set Country = <strong>United States</strong>, Features = <strong>SMS + MMS</strong>.</li>
          <li>Click <strong>Search</strong>, pick any number, click the cart icon, then <strong>Checkout</strong>.</li>
          <li>Write down the number in E.164 format (e.g. <code className="bg-neutral-100 px-1 rounded">+14155550123</code>) — you&apos;ll need it in the credentials form.</li>
        </ol>
        <div className="flex justify-between pt-2">
          <button type="button" className="btn-secondary" onClick={() => setStep("signup")}>Back</button>
          <button type="button" className="btn-primary" onClick={() => setStep("get-api-key")}>Number purchased →</button>
        </div>
      </div>
    );
  }

  if (step === "get-api-key") {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Step 3: Create an API key</h2>
        <ol className="list-decimal list-inside text-sm text-neutral-700 space-y-1">
          <li>Mission Control sidebar: <strong>API Keys</strong>.</li>
          <li>Click <strong>Create API Key</strong>.</li>
          <li>Give it a name (e.g. <em>slickdeals-alerts</em>). Leave permissions at the default.</li>
          <li>Copy the key — it starts with <code className="bg-neutral-100 px-1 rounded">KEY</code>. <strong>Save it somewhere safe.</strong> It won&apos;t be shown again.</li>
        </ol>
        <div className="flex justify-between pt-2">
          <button type="button" className="btn-secondary" onClick={() => setStep("buy-number")}>Back</button>
          <button type="button" className="btn-primary" onClick={() => setStep("a2p-brand")}>Got my key →</button>
        </div>
      </div>
    );
  }

  if (step === "a2p-brand") {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Step 4: A2P 10DLC Brand</h2>
        <p className="text-sm text-neutral-700">
          US carriers require a registered Brand + Campaign before allowing app-to-person SMS. Do Brand first — Campaign can&apos;t be created without it.
        </p>

        <ol className="list-decimal list-inside text-sm text-neutral-700 space-y-1">
          <li>Mission Control sidebar: <strong>Compliance</strong> → <strong>10DLC</strong> → <strong>Brand Registrations</strong>.</li>
          <li>Click <strong>Create Brand</strong>. Select <strong>Sole Proprietor</strong>.</li>
          <li>Fill in your legal name, address, mobile phone, and email.</li>
          <li>Submit. Telnyx charges <strong>$4.50 one-time</strong>.</li>
          <li>Telnyx texts a code to your mobile for identity verification — enter it.</li>
          <li>Brand approval is typically <strong>within minutes</strong>.</li>
        </ol>

        <div className="flex justify-between pt-2">
          <button type="button" className="btn-secondary" onClick={() => setStep("get-api-key")}>Back</button>
          <button type="button" className="btn-primary" onClick={() => setStep("a2p-campaign")}>Brand approved →</button>
        </div>
      </div>
    );
  }

  if (step === "a2p-campaign") {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Step 5: A2P 10DLC Campaign</h2>
        <p className="text-sm text-neutral-700">
          Mission Control: <strong>Compliance</strong> → <strong>10DLC</strong> → <strong>Campaigns</strong> → <strong>Create Campaign</strong>.
        </p>
        <p className="text-xs text-neutral-500">Cost: $15 one-time + $1.50/month. Approves within a few hours, often faster.</p>

        <p className="text-sm font-medium pt-2">Fill in the fields as follows:</p>

        <Section label="Use case">
          <p>Select <strong>Mixed</strong> (or <strong>Low Volume Mixed</strong> if shown — same thing for Sole Proprietor).</p>
        </Section>

        <Section label="Campaign description">
          <CopyableText template="Personal Slickdeals deal alerts to my own phone via a self-hosted dashboard" />
        </Section>

        <Section label="Sample messages (2 required)">
          <CopyableText template="[Slickdeals Alerts] $9.99 — 50ft Cat6 Cable @ Best Buy. slickdeals.net/f/12345" />
          <CopyableText template="[Slickdeals Alerts] $42 — Anker 65W USB-C @ Amazon. slickdeals.net/f/67890" />
        </Section>

        <Section label="Message contents">
          <p>Check <strong>Embedded links</strong> only (we send slickdeals.net URLs).</p>
        </Section>

        <Section label="Opt-in type">
          <p>Select <strong>Web Form</strong>.</p>
        </Section>

        <Section label="Opt-in description / CTA URL">
          <p className="text-xs mb-2">Paste this — include your actual domain URL so the reviewer can verify the form exists:</p>
          <CopyableText template={`End-users opt in via the public web form at {ORIGIN}/sms-opt-in. The form requires the user to enter their mobile number, actively check an unchecked consent checkbox, and click submit. The form discloses message frequency, HELP/STOP instructions, and links to the privacy policy and terms of service. This is a personal-use deployment — the only recipient is the person who deployed and operates the instance.`} />
        </Section>

        <Section label="Privacy policy URL">
          <CopyableUrl path="/privacy" />
        </Section>

        <Section label="Terms of service URL">
          <CopyableUrl path="/terms" />
        </Section>

        <Section label="Opt-in message">
          <CopyableText template="Slickdeals Alerts: You're now subscribed to deal alerts. Reply HELP for help, STOP to opt out. Msg & data rates may apply." />
        </Section>

        <Section label="Opt-out message">
          <CopyableText template="Slickdeals Alerts: You have been unsubscribed and will receive no further messages. Reply START to resubscribe." />
        </Section>

        <Section label="Help message">
          <CopyableText template={`Slickdeals Alerts: For help, sign into your dashboard at {ORIGIN} or open an issue at github.com/Meowssi/slickdeals-alerts/issues. Reply STOP to unsubscribe. Msg & data rates may apply.`} />
        </Section>

        <Section label="Attach your number">
          <p>After the campaign shows <strong>Approved</strong>: go to <strong>Numbers</strong> → click your number → <strong>Messaging</strong> tab → set the Messaging Profile to the one linked to your campaign. SMS unlocks immediately.</p>
        </Section>

        <div className="flex justify-between pt-2">
          <button type="button" className="btn-secondary" onClick={() => setStep("a2p-brand")}>Back</button>
          <button type="button" className="btn-primary" onClick={() => setStep("form")}>Campaign submitted →</button>
        </div>
      </div>
    );
  }

  if (step === "form" || step === "saving") {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Step 6: Enter credentials</h2>
        <p className="text-sm text-neutral-700">Credentials are stored in your database. Verification happens after A2P campaign is approved.</p>

        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">Telnyx API key</label>
          <input
            type="password" className="input font-mono text-xs"
            placeholder={hasExistingChannel ? "Leave blank to keep the saved key" : "KEY..."}
            value={apiKey} onChange={(e) => setApiKey(e.target.value)}
          />
          {hasExistingChannel && (
            <p className="text-xs text-neutral-500 mt-1">Already saved. Blank = keep it; paste new = replace.</p>
          )}
        </div>
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">Your Telnyx number (from)</label>
          <input type="tel" className="input font-mono text-xs" placeholder="+14155550123" value={fromNumber} onChange={(e) => setFromNumber(e.target.value)} />
        </div>
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">Your real phone (recipient)</label>
          <input type="tel" className="input font-mono text-xs" placeholder="+15551234567" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>

        {errMsg && <p className="text-sm text-red-600">{errMsg}</p>}

        <div className="flex justify-between pt-2">
          <button type="button" className="btn-secondary" onClick={() => setStep("a2p-campaign")}>Back</button>
          <button type="button" className="btn-primary" onClick={saveCredentials} disabled={!formValid() || step === "saving"}>
            {step === "saving" ? "Saving…" : "Save credentials"}
          </button>
        </div>
      </div>
    );
  }

  if (step === "credentials-saved") {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Step 7: Wait for approval, then verify</h2>
        <div className="rounded-md bg-green-50 border border-green-200 p-3 text-sm text-green-900">Credentials saved.</div>

        <details className="text-xs">
          <summary className="cursor-pointer text-neutral-600 underline">Need to navigate back?</summary>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className="btn-secondary text-xs" onClick={() => setStep("intro")}>Start over</button>
            <button type="button" className="btn-secondary text-xs" onClick={() => setStep("a2p-brand")}>A2P Brand</button>
            <button type="button" className="btn-secondary text-xs" onClick={() => setStep("a2p-campaign")}>A2P Campaign</button>
            <button type="button" className="btn-secondary text-xs" onClick={() => setStep("form")}>Edit credentials</button>
          </div>
        </details>

        <p className="text-sm text-neutral-700">
          Once your A2P Campaign shows <strong>Approved</strong> in Mission Control and your number is attached to the campaign&apos;s messaging profile, click below to send a verification SMS.
        </p>

        <p className="text-xs text-neutral-500">
          Your other channels (Telegram, ntfy, Discord, email) keep working in the meantime.
        </p>

        {errMsg && (
          <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-900">{errMsg}</div>
        )}

        <div className="flex justify-between flex-wrap gap-2 pt-2">
          <button type="button" className="btn-secondary" onClick={onDone}>I&apos;ll come back later</button>
          <button type="button" className="btn-primary" onClick={triggerVerificationSms}>Send verification SMS now</button>
        </div>
      </div>
    );
  }

  if (step === "sending-sms") {
    return <p className="text-sm text-neutral-600">Sending…</p>;
  }

  if (step === "confirm") {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Step 8: Enter the code</h2>
        <p className="text-sm text-neutral-700">Check <strong>{phone}</strong> for a 6-character code.</p>
        <input
          className="input font-mono uppercase tracking-widest text-center text-lg"
          maxLength={6}
          value={smsCode}
          onChange={(e) => setSmsCode(e.target.value)}
          placeholder="ABC123"
          autoFocus
        />
        {errMsg && <p className="text-sm text-red-600">{errMsg}</p>}
        <p className="text-xs text-neutral-500">
          Didn&apos;t arrive? Confirm the campaign is Approved and your number is attached to the messaging profile in Mission Control.
        </p>
        <div className="flex justify-between pt-2">
          <button type="button" className="btn-secondary" onClick={() => setStep("credentials-saved")}>Back</button>
          <button type="button" className="btn-primary" onClick={confirmCode} disabled={smsCode.trim().length < 6}>Confirm</button>
        </div>
      </div>
    );
  }

  if (step === "verified") {
    return (
      <div className="space-y-4">
        <div className="rounded-md bg-green-50 border border-green-200 p-4 text-sm text-green-900">
          SMS channel verified. Deal alerts will text <strong>{phone}</strong> from <strong>{fromNumber}</strong>.
        </div>
        <div className="flex justify-end">
          <button className="btn-primary" onClick={onDone}>Continue</button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md bg-red-50 border border-red-200 p-4 text-sm text-red-900">
        <p className="font-medium">Something went wrong</p>
        <p className="mt-1">{errMsg}</p>
      </div>
      <div className="flex justify-between pt-2">
        <button type="button" className="btn-secondary" onClick={onSkip}>Skip</button>
        <button type="button" className="btn-primary" onClick={() => setStep(channelId ? "credentials-saved" : "form")}>Try again</button>
      </div>
    </div>
  );
}

function Section({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="border-l-2 border-neutral-200 pl-3 space-y-1">
      <p className="text-xs font-semibold text-neutral-700">{label}</p>
      <div className="text-sm text-neutral-700 space-y-1">{children}</div>
    </div>
  );
}
