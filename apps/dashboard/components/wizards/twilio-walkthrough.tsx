"use client";

import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

type Step =
  | "intro"
  | "signup"
  | "onboarding"
  | "verify-phone"
  | "buy-number"
  | "trial-limits"
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

  // -------- step content --------

  if (step === "intro") {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Connect SMS via Twilio</h2>
        <p className="text-sm text-neutral-700">
          Twilio is a paid service that sends real text messages to your phone. It works on any phone — flip phone, iPhone, Android — and doesn&apos;t need an app.
        </p>
        <p className="text-sm text-neutral-700">
          We&apos;ll walk you through every step: making an account, getting a Twilio phone number, copying your credentials, and testing.
          It takes <strong>about 15 minutes</strong>.
        </p>

        <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-sm text-amber-900 space-y-2">
          <p className="font-semibold">💵 What it costs (you pay Twilio directly, not us)</p>
          <ul className="list-disc list-inside space-y-1 text-xs">
            <li>About <strong>$0.008 per SMS</strong> in the US (roughly 1¢)</li>
            <li>About <strong>$1.15/month</strong> for keeping a phone number active</li>
            <li>You get <strong>$15.50 in free trial credit</strong> when you sign up — covers ~1,900 SMS</li>
            <li>Twilio asks for a credit card during signup, but the trial credit comes first</li>
          </ul>
        </div>

        <div className="rounded-md bg-blue-50 border border-blue-200 p-3 text-xs text-blue-900">
          <p className="font-semibold">Not sure you want to pay?</p>
          <p className="mt-1">
            <strong>Telegram</strong> and <strong>ntfy</strong> are completely free and work for the same use case. Click <em>Skip</em> below and pick one of those instead. SMS is best if you have a phone that <em>only</em> does SMS (no smartphone).
          </p>
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
        <h2 className="text-xl font-semibold">Step 1: Sign up for Twilio</h2>
        <ol className="space-y-3 text-sm text-neutral-700">
          <li className="flex gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full bg-neutral-900 text-white text-xs font-bold flex items-center justify-center">1</span>
            <div>
              <p className="font-medium text-neutral-800">Open Twilio&apos;s signup page</p>
              <a href="https://www.twilio.com/try-twilio" target="_blank" rel="noreferrer" className="inline-block mt-1 text-blue-700 underline">
                Open www.twilio.com/try-twilio →
              </a>
              <p className="text-xs text-neutral-500 mt-1">Opens in a new tab. Keep this page open in the background — you&apos;ll come back here.</p>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full bg-neutral-900 text-white text-xs font-bold flex items-center justify-center">2</span>
            <div>
              <p className="font-medium text-neutral-800">Fill in the signup form</p>
              <ul className="text-xs text-neutral-600 mt-1 ml-3 list-disc list-inside space-y-0.5">
                <li><strong>First name + Last name</strong> — your real name</li>
                <li><strong>Email</strong> — a real email you can check (Twilio will send you a verification link)</li>
                <li><strong>Password</strong> — at least 12 characters, mix of letters and numbers</li>
                <li>Accept their Terms of Service</li>
              </ul>
              <p className="text-xs text-neutral-500 mt-1">Click <strong>Start your free trial</strong>.</p>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full bg-neutral-900 text-white text-xs font-bold flex items-center justify-center">3</span>
            <div>
              <p className="font-medium text-neutral-800">Check your email for the verification link</p>
              <p className="text-xs text-neutral-600 mt-1">
                Twilio sends a confirmation email within ~1 minute. Look in your inbox (and spam folder) for an email from <code className="bg-neutral-100 px-1 rounded">no-reply@twilio.com</code>. Click the big <strong>Confirm Your Email</strong> button inside.
              </p>
            </div>
          </li>
        </ol>
        <div className="rounded-md bg-blue-50 border border-blue-200 p-2 text-xs text-blue-900">
          <strong>Tip:</strong> If the email doesn&apos;t arrive in 5 minutes, refresh the Twilio tab and click <em>Resend</em>.
        </div>
        <div className="flex justify-between pt-2">
          <button type="button" className="btn-secondary" onClick={() => setStep("intro")}>Back</button>
          <button type="button" className="btn-primary" onClick={() => setStep("onboarding")}>Email confirmed, next →</button>
        </div>
      </div>
    );
  }

  if (step === "onboarding") {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Step 2: Twilio&apos;s onboarding questions</h2>
        <p className="text-sm text-neutral-700">
          After you confirm your email, Twilio asks a few setup questions. None of them lock you out of anything — pick whatever&apos;s closest. Suggested answers below.
        </p>

        <div className="space-y-3 text-sm">
          <Tip
            q="What do you want to do first?"
            a={<>Pick <strong>&quot;Send and receive SMS&quot;</strong>.</>}
          />
          <Tip
            q="What's your role / what describes you?"
            a={<>Pick anything — <strong>&quot;Developer&quot;</strong> or <strong>&quot;Other&quot;</strong> both work.</>}
          />
          <Tip
            q="What do you want to build?"
            a={<>Pick <strong>&quot;With code&quot;</strong>. (You&apos;re not actually going to code anything — this just unlocks the right dashboard.)</>}
          />
          <Tip
            q="What language do you want to use?"
            a={<>Pick anything — <strong>&quot;Other&quot;</strong> is fine.</>}
          />
        </div>

        <div className="rounded-md bg-yellow-50 border border-yellow-200 p-3 text-xs text-yellow-900 space-y-1">
          <p className="font-semibold">⚠️ Heads-up: pop-ups you can ignore</p>
          <p>Twilio might pop up a tutorial, a &quot;set up a webhook&quot; modal, or a recommendation to install their CLI. Close all of these — you don&apos;t need them. Just click the small <strong>×</strong> in the corner of each.</p>
        </div>

        <p className="text-sm text-neutral-700">
          When you&apos;re done with the survey, you&apos;ll land on the <strong>Twilio Console</strong> — that&apos;s the main dashboard. The URL bar will say <code className="text-xs bg-neutral-100 px-1 rounded">console.twilio.com</code>.
        </p>
        <div className="flex justify-between pt-2">
          <button type="button" className="btn-secondary" onClick={() => setStep("signup")}>Back</button>
          <button type="button" className="btn-primary" onClick={() => setStep("verify-phone")}>I&apos;m on the console</button>
        </div>
      </div>
    );
  }

  if (step === "verify-phone") {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Step 3: Verify your real phone</h2>
        <p className="text-sm text-neutral-700">
          Before you can buy a Twilio number, Twilio needs to confirm your real phone (the one you carry around).
          This isn&apos;t the Twilio number — it&apos;s your actual cell phone. They&apos;ll text you a code.
        </p>

        <ol className="space-y-3 text-sm text-neutral-700">
          <li className="flex gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full bg-neutral-900 text-white text-xs font-bold flex items-center justify-center">1</span>
            <div>
              <p className="font-medium text-neutral-800">Look for the phone-verification prompt</p>
              <p className="text-xs text-neutral-600 mt-1">Right after the onboarding survey, Twilio often shows a banner like &quot;Verify your phone number to get started.&quot; Click it.</p>
              <p className="text-xs text-neutral-600 mt-1">
                If you don&apos;t see the banner, go to:
                {" "}
                <a className="underline text-blue-700" href="https://console.twilio.com/us1/develop/phone-numbers/manage/verified" target="_blank" rel="noreferrer">
                  Phone Numbers → Verified Caller IDs
                </a>
                — that&apos;s the page where you add verified numbers.
              </p>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full bg-neutral-900 text-white text-xs font-bold flex items-center justify-center">2</span>
            <div>
              <p className="font-medium text-neutral-800">Type your real phone in E.164 format</p>
              <p className="text-xs text-neutral-600 mt-1">
                E.164 = a + sign, then country code, then your number, all run together with no spaces or dashes.
                <br />
                US example: phone shown as <code className="bg-neutral-100 px-1 rounded">(555) 123-4567</code> becomes{" "}
                <code className="bg-neutral-100 px-1 rounded">+15551234567</code>.
              </p>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full bg-neutral-900 text-white text-xs font-bold flex items-center justify-center">3</span>
            <div>
              <p className="font-medium text-neutral-800">Receive + enter the 6-digit code</p>
              <p className="text-xs text-neutral-600 mt-1">
                Twilio texts you. Type the code into their page. <strong>Write that phone number down</strong> — it&apos;s the one Twilio is allowed to text from your trial account.
              </p>
            </div>
          </li>
        </ol>

        <div className="flex justify-between pt-2">
          <button type="button" className="btn-secondary" onClick={() => setStep("onboarding")}>Back</button>
          <button type="button" className="btn-primary" onClick={() => setStep("buy-number")}>Phone verified, next →</button>
        </div>
      </div>
    );
  }

  if (step === "buy-number") {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Step 4: Buy a Twilio phone number</h2>
        <p className="text-sm text-neutral-700">
          Twilio sends SMS <em>from</em> a phone number you own through their service. You need to buy one — ~$1.15/month, deducted from your trial credit.
        </p>

        <ol className="space-y-3 text-sm text-neutral-700">
          <li className="flex gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full bg-neutral-900 text-white text-xs font-bold flex items-center justify-center">1</span>
            <div>
              <p className="font-medium text-neutral-800">Go to Buy a Number</p>
              <a href="https://console.twilio.com/us1/develop/phone-numbers/manage/search" target="_blank" rel="noreferrer" className="inline-block mt-1 text-blue-700 underline">
                Open the buy-number page →
              </a>
              <p className="text-xs text-neutral-500 mt-1">
                Or navigate manually in the Twilio Console: left sidebar → <strong>Develop</strong> → <strong>Phone Numbers</strong> → <strong>Manage</strong> → <strong>Buy a number</strong>.
              </p>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full bg-neutral-900 text-white text-xs font-bold flex items-center justify-center">2</span>
            <div>
              <p className="font-medium text-neutral-800">Set the filters at the top</p>
              <ul className="text-xs text-neutral-600 mt-1 ml-3 list-disc list-inside space-y-0.5">
                <li><strong>Country</strong>: United States (or yours)</li>
                <li><strong>Type</strong>: <em>Local</em> — cheapest and works for our use case</li>
                <li><strong>Capabilities</strong>: check <em>SMS</em> ✓ (required). Voice and MMS optional, leave unchecked to keep cost down.</li>
                <li><strong>Number / Location</strong> filters: optional. Leave blank to see all available numbers.</li>
              </ul>
              <p className="text-xs text-neutral-500 mt-1">Click <strong>Search</strong>.</p>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full bg-neutral-900 text-white text-xs font-bold flex items-center justify-center">3</span>
            <div>
              <p className="font-medium text-neutral-800">Pick any number from the list and click <em>Buy</em></p>
              <p className="text-xs text-neutral-600 mt-1">A confirmation modal pops up. Confirm — the cost (~$1.15/month) comes out of your $15.50 trial credit.</p>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full bg-neutral-900 text-white text-xs font-bold flex items-center justify-center">4</span>
            <div>
              <p className="font-medium text-neutral-800">Write down the number in E.164 format</p>
              <p className="text-xs text-neutral-600 mt-1">
                The number shown like <code className="bg-neutral-100 px-1 rounded">(415) 555-0123</code> becomes <code className="bg-neutral-100 px-1 rounded">+14155550123</code>.
                You&apos;ll paste this into a form on the last step.
              </p>
            </div>
          </li>
        </ol>

        <div className="rounded-md bg-yellow-50 border border-yellow-200 p-3 text-xs text-yellow-900">
          <p className="font-semibold">⚠️ Skip the &quot;configure your number&quot; modal</p>
          <p className="mt-1">
            Twilio may ask you to configure messaging webhooks or copilot features for the number. <strong>Close this modal</strong> — we don&apos;t need any of it. Just click the × in the corner.
          </p>
        </div>

        <div className="flex justify-between pt-2">
          <button type="button" className="btn-secondary" onClick={() => setStep("verify-phone")}>Back</button>
          <button type="button" className="btn-primary" onClick={() => setStep("trial-limits")}>Got my number →</button>
        </div>
      </div>
    );
  }

  if (step === "trial-limits") {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Step 5: Understand the trial limit</h2>
        <p className="text-sm text-neutral-700">
          This step is the most common &quot;Why isn&apos;t my SMS arriving?&quot; gotcha — please read.
        </p>

        <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-900 space-y-2">
          <p className="font-semibold">Twilio TRIAL accounts can only send SMS to phone numbers you&apos;ve verified.</p>
          <p className="text-xs">
            On a trial account, Twilio will <strong>refuse to send</strong> SMS to any phone that isn&apos;t in your &quot;Verified Caller IDs&quot; list. The phone you signed up with (from step 3) is already auto-verified. To send to <em>any other phone</em>, you have to verify it first.
          </p>
        </div>

        <div className="rounded-md border border-neutral-200 p-3 text-sm space-y-2">
          <p className="font-medium text-neutral-800">Option A: Use the phone you signed up with</p>
          <p className="text-xs text-neutral-600">Easiest. The phone you verified in step 3 is the only one Twilio will text. Use this number as your &quot;recipient&quot; in the form below.</p>
        </div>

        <div className="rounded-md border border-neutral-200 p-3 text-sm space-y-2">
          <p className="font-medium text-neutral-800">Option B: Verify additional phones</p>
          <p className="text-xs text-neutral-600">
            If you need alerts on a different phone (e.g., spouse&apos;s, work phone), go to:{" "}
            <a className="underline text-blue-700" href="https://console.twilio.com/us1/develop/phone-numbers/manage/verified" target="_blank" rel="noreferrer">
              Phone Numbers → Verified Caller IDs
            </a>
            {" "}→ <strong>Add a new number</strong> → enter the phone in E.164 format → Twilio sends it a code or calls it → enter the code.
            Repeat for each phone.
          </p>
        </div>

        <div className="rounded-md border border-neutral-200 p-3 text-sm space-y-2">
          <p className="font-medium text-neutral-800">Option C: Upgrade your Twilio account (paid)</p>
          <p className="text-xs text-neutral-600">
            Adding $20+ via{" "}
            <a className="underline text-blue-700" href="https://console.twilio.com/us1/billing/manage-billing/billing-overview" target="_blank" rel="noreferrer">
              Billing
            </a>
            {" "}removes the trial restriction. SMS can then go to any number worldwide. Most people skip this unless they outgrow the trial.
          </p>
        </div>

        <div className="flex justify-between pt-2">
          <button type="button" className="btn-secondary" onClick={() => setStep("buy-number")}>Back</button>
          <button type="button" className="btn-primary" onClick={() => setStep("find-creds")}>I get it, next →</button>
        </div>
      </div>
    );
  }

  if (step === "find-creds") {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Step 6: Find your API credentials</h2>
        <p className="text-sm text-neutral-700">
          Two values we need: your <strong>Account SID</strong> (think of it like a username) and your <strong>Auth Token</strong> (think of it like a password). Both are right on Twilio&apos;s main dashboard.
        </p>

        <ol className="space-y-3 text-sm text-neutral-700">
          <li className="flex gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full bg-neutral-900 text-white text-xs font-bold flex items-center justify-center">1</span>
            <div>
              <p className="font-medium text-neutral-800">Open the Twilio Console homepage</p>
              <a href="https://console.twilio.com/" target="_blank" rel="noreferrer" className="inline-block mt-1 text-blue-700 underline">
                Open console.twilio.com →
              </a>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full bg-neutral-900 text-white text-xs font-bold flex items-center justify-center">2</span>
            <div>
              <p className="font-medium text-neutral-800">Find the &quot;Account Info&quot; panel</p>
              <p className="text-xs text-neutral-600 mt-1">
                On the homepage, look for a box titled <strong>Account Info</strong>. It&apos;s usually in the lower-left or right side of the dashboard.
                If you don&apos;t see it, click your Twilio account name in the top-left to return to the homepage.
              </p>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full bg-neutral-900 text-white text-xs font-bold flex items-center justify-center">3</span>
            <div>
              <p className="font-medium text-neutral-800">Copy your <strong>Account SID</strong></p>
              <ul className="text-xs text-neutral-600 mt-1 ml-3 list-disc list-inside space-y-0.5">
                <li>It starts with <code className="bg-neutral-100 px-1 rounded">AC</code></li>
                <li>34 characters long, looks like <code className="bg-neutral-100 px-1 rounded text-[10px]">ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx</code></li>
                <li>There&apos;s usually a small clipboard icon — click it, or click the SID itself to select then Ctrl+C / Cmd+C</li>
              </ul>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full bg-neutral-900 text-white text-xs font-bold flex items-center justify-center">4</span>
            <div>
              <p className="font-medium text-neutral-800">Reveal + copy your <strong>Auth Token</strong></p>
              <ul className="text-xs text-neutral-600 mt-1 ml-3 list-disc list-inside space-y-0.5">
                <li>By default it&apos;s hidden — shown as dots</li>
                <li>Click the eye icon (👁) next to it to reveal</li>
                <li>32 characters of letters and numbers</li>
                <li>Copy it</li>
              </ul>
              <div className="rounded-md bg-red-50 border border-red-200 p-2 text-xs text-red-900 mt-2">
                ⚠️ Treat your Auth Token like a password. Don&apos;t paste it in chat, email, or anywhere public.
                Anyone with it can send SMS billed to your account.
              </div>
            </div>
          </li>
        </ol>

        <div className="flex justify-between pt-2">
          <button type="button" className="btn-secondary" onClick={() => setStep("trial-limits")}>Back</button>
          <button type="button" className="btn-primary" onClick={() => setStep("form")}>I have both, next →</button>
        </div>
      </div>
    );
  }

  if (step === "form" || (step === "verifying" && !channelId)) {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Step 7: Paste everything below</h2>
        <p className="text-sm text-neutral-700">
          When you submit, we&apos;ll text your &quot;recipient&quot; phone a 6-digit code to make sure it all works.
        </p>

        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">Account SID</label>
          <input type="text" className="input font-mono text-xs" placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" value={accountSid} onChange={(e) => setAccountSid(e.target.value)} />
          <p className="text-xs text-neutral-500 mt-1">Starts with AC, 34 characters.</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">Auth Token</label>
          <input type="password" className="input font-mono text-xs" placeholder="32-character secret" value={authToken} onChange={(e) => setAuthToken(e.target.value)} />
          <p className="text-xs text-neutral-500 mt-1">The one you clicked the 👁 to reveal.</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">Your Twilio phone number (from)</label>
          <input type="tel" className="input font-mono text-xs" placeholder="+14155550123" value={fromNumber} onChange={(e) => setFromNumber(e.target.value)} />
          <p className="text-xs text-neutral-500 mt-1">The number you bought in Step 4. <strong>E.164 format</strong> — starts with +.</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">Your real phone number (recipient)</label>
          <input type="tel" className="input font-mono text-xs" placeholder="+15551234567" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <p className="text-xs text-neutral-500 mt-1">
            Where alerts get sent. <strong>Must be a number you verified</strong> on Twilio (the one from step 3, or one you added under Verified Caller IDs).
          </p>
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
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Sending SMS…</h2>
        <p className="text-sm text-neutral-600">Hold on a second.</p>
      </div>
    );
  }

  if (step === "confirm") {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Step 8: Enter the code we texted</h2>
        <p className="text-sm text-neutral-700">
          Check <strong>{phone}</strong> for a text message with a 6-character code. Looks like <code className="bg-neutral-100 px-1 rounded">ABC123</code>.
        </p>
        <input
          className="input font-mono uppercase tracking-widest text-center text-lg"
          maxLength={6}
          value={smsCode}
          onChange={(e) => setSmsCode(e.target.value)}
          placeholder="ABC123"
          autoFocus
        />
        {errMsg && <p className="text-sm text-red-600">{errMsg}</p>}
        <div className="rounded-md bg-blue-50 border border-blue-200 p-2 text-xs text-blue-900">
          <p className="font-medium">Not getting the text?</p>
          <ul className="list-disc list-inside mt-1 space-y-0.5">
            <li>Make sure your recipient phone is in your Twilio <em>Verified Caller IDs</em> (trial accounts restrict this)</li>
            <li>Double-check the recipient number is in E.164 format</li>
            <li>Wait 30 seconds — sometimes carriers delay</li>
            <li>Click <strong>Back</strong>, fix the number, resend</li>
          </ul>
        </div>
        <div className="flex justify-between pt-2">
          <button type="button" className="btn-secondary" onClick={() => setStep("form")}>Back</button>
          <button type="button" className="btn-primary" onClick={confirmCode} disabled={smsCode.trim().length < 6}>Confirm</button>
        </div>
      </div>
    );
  }

  if (step === "verified") {
    return (
      <div className="space-y-4">
        <div className="rounded-md bg-green-50 border border-green-200 p-4 text-sm text-green-900">
          ✅ SMS channel verified. Future deal alerts will text <strong>{phone}</strong> from <strong>{fromNumber}</strong>.
        </div>
        <p className="text-xs text-neutral-500">
          You can come back to <a className="underline" href="/settings">Settings</a> any time to disable or change this channel.
        </p>
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

function Tip({ q, a }: { q: string; a: React.ReactNode }) {
  return (
    <div className="rounded-md border border-neutral-200 p-3 text-sm">
      <p className="font-medium text-neutral-800">{q}</p>
      <p className="text-neutral-700 mt-1 text-xs">{a}</p>
    </div>
  );
}
