"use client";

import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

type Step =
  | "intro"
  | "signup"
  | "buy-number"
  | "find-creds"
  | "form"
  | "verifying"
  | "confirm"
  | "verified"
  | "error";

interface TwilioConfig {
  account_sid: string;
  auth_token: string;
  from_number: string;
  phone: string;
}

export function TwilioWalkthrough({ onDone, onSkip }: { onDone: () => void; onSkip: () => void }) {
  const [step, setStep] = useState<Step>("intro");
  const [accountSid, setAccountSid] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [fromNumber, setFromNumber] = useState("");
  const [phone, setPhone] = useState("");
  const [smsCode, setSmsCode] = useState("");
  const [channelId, setChannelId] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState("");

  const isE164 = (s: string) => /^\+[1-9]\d{6,14}$/.test(s.trim());

  function formValid(): boolean {
    return (
      accountSid.trim().startsWith("AC") &&
      accountSid.trim().length >= 30 &&
      authToken.trim().length >= 30 &&
      isE164(fromNumber) &&
      isE164(phone)
    );
  }

  async function startVerification() {
    setStep("verifying");
    setErrMsg("");
    const supa = supabaseBrowser();
    const config: TwilioConfig = {
      account_sid: accountSid.trim(),
      auth_token: authToken.trim(),
      from_number: fromNumber.trim(),
      phone: phone.trim(),
    };

    const { data: existing } = await supa
      .from("notification_channels")
      .select("id")
      .eq("type", "sms_twilio")
      .eq("name", "default")
      .maybeSingle();

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
        .insert({ type: "sms_twilio", name: "default", config, enabled: true })
        .select("id")
        .single();
      if (insErr || !ch) { setStep("error"); setErrMsg(insErr?.message ?? "could not save channel"); return; }
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
        setStep("error");
        setErrMsg(json.error ?? `verify failed (HTTP ${res.status})`);
        return;
      }
    } catch (e) {
      setStep("error");
      setErrMsg(`Could not reach channel-verify: ${(e as Error).message}`);
      return;
    }
    setStep("confirm");
  }

  async function confirmCode() {
    setStep("verifying");
    setErrMsg("");
    if (!channelId) return;
    const supa = supabaseBrowser();
    const { data: { session } } = await supa.auth.getSession();
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

  // ---------- step content ----------

  if (step === "intro") {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Connect SMS via Twilio</h2>
        <p className="text-sm text-neutral-700">
          Twilio is a paid SMS service. We&apos;ll walk you through creating your own Twilio account so
          your card pays for your own SMS — no surprise bills for anyone else.
        </p>
        <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900 space-y-1">
          <p className="font-medium">⚠️ Costs ~$0.008 per SMS, billed to your Twilio card</p>
          <p>Trial accounts get $15.50 free credit (around 1,900 SMS to the U.S.). You also pay ~$1/month per phone number you keep.</p>
          <p>If that&apos;s too much hassle, use Telegram or ntfy instead — both free.</p>
        </div>
        <div className="flex justify-between pt-2">
          <button type="button" className="btn-secondary" onClick={onSkip}>Skip</button>
          <button type="button" className="btn-primary" onClick={() => setStep("signup")}>I&apos;m in</button>
        </div>
      </div>
    );
  }

  if (step === "signup") {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">1. Create a Twilio account</h2>
        <ol className="space-y-3 text-sm text-neutral-700">
          <li className="flex gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full bg-neutral-900 text-white text-xs font-bold flex items-center justify-center">1</span>
            <div>
              <p className="font-medium text-neutral-800">Sign up for a free Twilio account</p>
              <a href="https://www.twilio.com/try-twilio" target="_blank" rel="noreferrer" className="inline-block mt-1 text-blue-700 underline text-sm">Open twilio.com/try-twilio →</a>
              <p className="text-xs text-neutral-500 mt-0.5">You&apos;ll get $15.50 in free trial credit.</p>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full bg-neutral-900 text-white text-xs font-bold flex items-center justify-center">2</span>
            <div>
              <p className="font-medium text-neutral-800">Verify your phone number</p>
              <p className="text-xs text-neutral-600 mt-0.5">Twilio sends a verification code by SMS to confirm you&apos;re real.</p>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full bg-neutral-900 text-white text-xs font-bold flex items-center justify-center">3</span>
            <div>
              <p className="font-medium text-neutral-800">Answer the onboarding questions</p>
              <p className="text-xs text-neutral-600 mt-0.5">Pick anything reasonable — e.g., &quot;Send notifications,&quot; &quot;No-code,&quot; &quot;SMS.&quot;</p>
            </div>
          </li>
        </ol>
        <div className="flex justify-between pt-2">
          <button type="button" className="btn-secondary" onClick={() => setStep("intro")}>Back</button>
          <button type="button" className="btn-primary" onClick={() => setStep("buy-number")}>Account ready</button>
        </div>
      </div>
    );
  }

  if (step === "buy-number") {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">2. Get a Twilio phone number</h2>
        <ol className="space-y-3 text-sm text-neutral-700">
          <li className="flex gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full bg-neutral-900 text-white text-xs font-bold flex items-center justify-center">1</span>
            <div>
              <p className="font-medium text-neutral-800">In the Twilio Console, go to Phone Numbers → Buy a Number</p>
              <a href="https://console.twilio.com/us1/develop/phone-numbers/manage/search" target="_blank" rel="noreferrer" className="inline-block mt-1 text-blue-700 underline text-sm">Open the buy-number page →</a>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full bg-neutral-900 text-white text-xs font-bold flex items-center justify-center">2</span>
            <div>
              <p className="font-medium text-neutral-800">Pick a number with SMS capability</p>
              <p className="text-xs text-neutral-600 mt-0.5">
                Filter for your country and check the <strong>SMS</strong> capability box.
                Cost: about $1/month per number, deducted from your trial credit.
              </p>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full bg-neutral-900 text-white text-xs font-bold flex items-center justify-center">3</span>
            <div>
              <p className="font-medium text-neutral-800">Click Buy → copy the number in E.164 format</p>
              <p className="text-xs text-neutral-600 mt-0.5">
                E.164 = country code + number, no spaces or dashes. Example: <code className="bg-neutral-100 px-1 rounded">+15551234567</code>
              </p>
              <div className="text-xs text-amber-700 mt-1">
                <strong>Trial limitation:</strong> Trial Twilio numbers can only send SMS to numbers you&apos;ve verified.
                The number you signed up with is auto-verified. To text other numbers, verify them at
                <a href="https://console.twilio.com/us1/develop/phone-numbers/manage/verified" className="underline ml-1" target="_blank" rel="noreferrer">Phone Numbers → Verified Caller IDs</a>.
                (Or upgrade your account — minimum $20 top-up, removes the restriction.)
              </div>
            </div>
          </li>
        </ol>
        <div className="flex justify-between pt-2">
          <button type="button" className="btn-secondary" onClick={() => setStep("signup")}>Back</button>
          <button type="button" className="btn-primary" onClick={() => setStep("find-creds")}>Number purchased</button>
        </div>
      </div>
    );
  }

  if (step === "find-creds") {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">3. Find your API credentials</h2>
        <ol className="space-y-3 text-sm text-neutral-700">
          <li className="flex gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full bg-neutral-900 text-white text-xs font-bold flex items-center justify-center">1</span>
            <div>
              <p className="font-medium text-neutral-800">Open the Twilio Console homepage</p>
              <a href="https://console.twilio.com/" target="_blank" rel="noreferrer" className="inline-block mt-1 text-blue-700 underline text-sm">Open console.twilio.com →</a>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full bg-neutral-900 text-white text-xs font-bold flex items-center justify-center">2</span>
            <div>
              <p className="font-medium text-neutral-800">In the &quot;Account Info&quot; panel, copy:</p>
              <ul className="text-xs text-neutral-600 mt-1 list-disc list-inside space-y-1">
                <li><strong>Account SID</strong> — starts with <code className="bg-neutral-100 px-1 rounded">AC</code>, 34 chars</li>
                <li><strong>Auth Token</strong> — click the eye icon to reveal, then copy. 32 chars.</li>
              </ul>
              <p className="text-xs text-neutral-500 mt-1">Both are sensitive. We&apos;ll store them per-user in your Supabase row.</p>
            </div>
          </li>
        </ol>
        <div className="flex justify-between pt-2">
          <button type="button" className="btn-secondary" onClick={() => setStep("buy-number")}>Back</button>
          <button type="button" className="btn-primary" onClick={() => setStep("form")}>I have the creds</button>
        </div>
      </div>
    );
  }

  if (step === "form" || step === "verifying" && !channelId) {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">4. Paste credentials + phones</h2>
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">Account SID</label>
          <input
            type="text" className="input font-mono text-xs"
            placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
            value={accountSid} onChange={(e) => setAccountSid(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">Auth Token</label>
          <input
            type="password" className="input font-mono text-xs"
            placeholder="32-character secret"
            value={authToken} onChange={(e) => setAuthToken(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">From number (your Twilio number)</label>
          <input
            type="tel" className="input font-mono text-xs"
            placeholder="+15551234567"
            value={fromNumber} onChange={(e) => setFromNumber(e.target.value)}
          />
          <p className="text-xs text-neutral-500 mt-1">E.164 format — country code + number, no spaces.</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">Your phone (recipient)</label>
          <input
            type="tel" className="input font-mono text-xs"
            placeholder="+15555550100"
            value={phone} onChange={(e) => setPhone(e.target.value)}
          />
          <p className="text-xs text-neutral-500 mt-1">Where deal alerts go. Must be a verified number if your Twilio is on trial.</p>
        </div>
        {errMsg && <p className="text-sm text-red-600">{errMsg}</p>}
        <div className="flex justify-between pt-2">
          <button type="button" className="btn-secondary" onClick={() => setStep("find-creds")}>Back</button>
          <button type="button" className="btn-primary" onClick={startVerification} disabled={!formValid()}>
            Send verification SMS
          </button>
        </div>
      </div>
    );
  }

  if (step === "verifying") {
    return <div className="space-y-4"><p className="text-sm text-neutral-600">Sending SMS…</p></div>;
  }

  if (step === "confirm") {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">5. Enter the code we texted you</h2>
        <p className="text-sm text-neutral-700">Check <strong>{phone}</strong> for a 6-character code.</p>
        <input
          className="input font-mono uppercase tracking-widest text-center text-lg"
          maxLength={6}
          value={smsCode}
          onChange={(e) => setSmsCode(e.target.value)}
          placeholder="ABC123"
        />
        {errMsg && <p className="text-sm text-red-600">{errMsg}</p>}
        <div className="flex justify-between pt-2">
          <button type="button" className="btn-secondary" onClick={onSkip}>Skip</button>
          <button type="button" className="btn-primary" onClick={confirmCode} disabled={smsCode.trim().length < 6}>Confirm</button>
        </div>
      </div>
    );
  }

  if (step === "verified") {
    return (
      <div className="space-y-4">
        <div className="rounded-md bg-green-50 border border-green-200 p-4 text-sm text-green-900">
          ✅ SMS channel verified. Alerts will text {phone} from {fromNumber}.
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
        <button type="button" className="btn-primary" onClick={() => setStep("form")}>Try again</button>
      </div>
    </div>
  );
}
