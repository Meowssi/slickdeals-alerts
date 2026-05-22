"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

type Step =
  | "intro"
  | "signup"
  | "onboarding"
  | "verify-phone"
  | "buy-number"
  | "review-purchase"
  | "upgrade-account"
  | "a2p-register"
  | "trial-limits"
  | "find-creds"
  | "form"
  | "saving"
  | "credentials-saved"
  | "sending-sms"
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
  const [hasExistingChannel, setHasExistingChannel] = useState(false);
  const [errMsg, setErrMsg] = useState("");

  // On mount, check if a Twilio channel already exists. If it does, load
  // its config into the form state (so navigating back to the form doesn't
  // lose anything) and remember the channelId — but DO NOT auto-skip ahead
  // to credentials-saved. The user might have saved creds before finishing
  // A2P registration and needs to navigate back to those steps. Instead,
  // show an "offer to skip ahead" banner on the intro.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supa = supabaseBrowser();
      const { data } = await supa
        .from("notification_channels")
        .select("id, verified_at, config")
        .eq("type", "sms_twilio")
        .eq("name", "default")
        .maybeSingle();
      if (cancelled || !data) return;
      const cfg = (data.config ?? {}) as Partial<TwilioConfig>;
      setChannelId(data.id);
      setHasExistingChannel(true);
      if (cfg.account_sid) setAccountSid(cfg.account_sid);
      if (cfg.from_number) setFromNumber(cfg.from_number);
      if (cfg.phone)       setPhone(cfg.phone);
      // Auth token intentionally not pre-filled — keep secret out of the DOM.
      // If user leaves it blank on re-save, we'll keep the existing value.
    })();
    return () => { cancelled = true; };
  }, []);

  const isE164 = (s: string) => /^\+[1-9]\d{6,14}$/.test(s.trim());

  function formValid(): boolean {
    return (
      accountSid.trim().startsWith("AC") &&
      accountSid.trim().length >= 30 &&
      // Auth token: required if no existing channel, otherwise can be blank to
      // keep the stored value
      (hasExistingChannel || authToken.trim().length >= 30) &&
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
      .eq("type", "sms_twilio")
      .eq("name", "default")
      .maybeSingle();

    // If user left the auth_token field blank on re-save, keep the stored one.
    const existingConfig = (existing?.config ?? {}) as Partial<TwilioConfig>;
    const authTokenFinal = authToken.trim() || existingConfig.auth_token || "";
    if (!authTokenFinal) {
      setStep("form");
      setErrMsg("Auth token is required.");
      return;
    }
    const config: TwilioConfig = {
      account_sid: accountSid.trim(),
      auth_token: authTokenFinal,
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
        .insert({ type: "sms_twilio", name: "default", config, enabled: true })
        .select("id")
        .single();
      if (insErr || !ch) { setStep("error"); setErrMsg(insErr?.message ?? "could not save channel"); return; }
      chId = ch.id;
    }
    setChannelId(chId);
    setStep("credentials-saved");
  }

  async function triggerVerificationSms() {
    if (!channelId) {
      setStep("error");
      setErrMsg("No channel id. Save credentials first.");
      return;
    }
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
        setErrMsg(
          json.error?.includes("30034") || (json.error ?? "").toLowerCase().includes("unregistered")
            ? "Twilio rejected the SMS with 'Unregistered Number' (error 30034). Your A2P 10DLC registration isn't approved yet — check both your Brand AND your Campaign in Twilio. Come back here once both show 'Approved'."
            : `Twilio rejected the SMS: ${json.error ?? `HTTP ${res.status}`}`,
        );
        return;
      }
    } catch (e) {
      setStep("credentials-saved");
      setErrMsg(`Couldn't reach our verification function: ${(e as Error).message}`);
      return;
    }
    setStep("confirm");
  }

  async function confirmCode() {
    setStep("sending-sms");
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

        {hasExistingChannel && (
          <div className="rounded-md bg-blue-50 border border-blue-200 p-3 text-sm text-blue-900 space-y-2">
            <p className="font-semibold">👋 Welcome back — picking up where you left off?</p>
            <p className="text-xs">
              You&apos;ve already saved Twilio credentials. Pick how you want to continue:
            </p>
            <div className="flex flex-wrap gap-2 mt-2">
              <button type="button" className="btn-primary text-xs" onClick={() => setStep("credentials-saved")}>
                Skip to verification
              </button>
              <button type="button" className="btn-secondary text-xs" onClick={() => setStep("upgrade-account")}>
                Jump to account upgrade
              </button>
              <button type="button" className="btn-secondary text-xs" onClick={() => setStep("a2p-register")}>
                Jump to A2P registration
              </button>
              <button type="button" className="btn-secondary text-xs" onClick={() => setStep("form")}>
                Review my credentials
              </button>
            </div>
            <p className="text-[11px] text-blue-700 mt-1">Or walk through every step from the top below.</p>
          </div>
        )}

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
            <li><strong>~$0.008 per SMS</strong> in the US (~1¢ each)</li>
            <li><strong>~$1.15/month</strong> for keeping a phone number active</li>
            <li><strong>~$4 one-time + ~$2/month</strong> for A2P 10DLC registration (required for US)</li>
            <li><strong>$20 minimum prefund</strong> required to upgrade out of trial — this becomes future SMS credit, you don&apos;t lose it</li>
            <li>You get $15.50 in trial credit at signup, but US SMS won&apos;t actually deliver until you upgrade + register A2P</li>
          </ul>
          <p className="text-xs">
            All-in real-world cost to get started: <strong>$20 upfront</strong> (becomes SMS credit) + <strong>~$3/month</strong> ongoing.
          </p>
        </div>

        <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-900 space-y-2">
          <p className="font-semibold">⚠️ Honest warning: US SMS through Twilio takes ~3 days to fully set up</p>
          <p className="text-xs">
            Since 2023, US mobile carriers (T-Mobile, AT&amp;T, Verizon) block SMS from unregistered numbers — even trial-account messages to verified phones get filtered with the &quot;A2P 10DLC&quot; error.
            You have to register a <strong>&quot;Sole Proprietor brand&quot; + &quot;Low-Volume campaign&quot;</strong> (~$4 one-time + ~$2/mo) and wait 1-3 days for approval before SMS reliably works.
          </p>
          <p className="text-xs">
            The walkthrough covers every step, but if you want notifications working in the next 5 minutes, the right answer is almost always <strong>Telegram or ntfy instead</strong> (both 100% free, instant setup, no carrier filtering).
          </p>
        </div>

        <div className="rounded-md bg-blue-50 border border-blue-200 p-3 text-xs text-blue-900">
          <p className="font-semibold">Still want SMS?</p>
          <p className="mt-1">Reasons it&apos;s worth the wait: works on flip phones / dumb phones / Apple Watches without your phone, doesn&apos;t require an app, more familiar to non-techy family members. If none of those apply, hit Skip below.</p>
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
          When you&apos;re done with the survey, you&apos;ll land on the <strong>Twilio Console</strong> — that&apos;s the main dashboard. The URL bar will say <code className="text-xs bg-neutral-100 px-1 rounded">1console.twilio.com</code> (Twilio&apos;s new console; the old <code className="text-xs bg-neutral-100 px-1 rounded">console.twilio.com</code> redirects here).
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
                <a className="underline text-blue-700" href="https://1console.twilio.com/us1/develop/phone-numbers/manage/verified" target="_blank" rel="noreferrer">
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
          Twilio sends messages <em>from</em> a phone number you own through their service. You need to buy one — ~$1.15/month, deducted from your trial credit.
        </p>

        <ol className="space-y-3 text-sm text-neutral-700">
          <li className="flex gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full bg-neutral-900 text-white text-xs font-bold flex items-center justify-center">1</span>
            <div>
              <p className="font-medium text-neutral-800">Go to Buy a Number</p>
              <a href="https://1console.twilio.com/us1/develop/phone-numbers/manage/search" target="_blank" rel="noreferrer" className="inline-block mt-1 text-blue-700 underline">
                Open the buy-number page →
              </a>
              <p className="text-xs text-neutral-500 mt-1">
                Or navigate manually: left sidebar → <strong>Develop</strong> → <strong>Phone Numbers</strong> → <strong>Manage</strong> → <strong>Buy a number</strong>.
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
                <li><strong>Capabilities</strong>: check both <em>SMS</em> ✓ <strong>and</strong> <em>MMS</em> ✓. MMS is what lets us include the deal&apos;s image in the text (text-only deals are fine too — toggle per-alert later).</li>
                <li>Voice and Fax: optional, leave unchecked unless you specifically want them</li>
                <li><strong>Number / Location</strong> filters: optional. Leave blank to see all available numbers.</li>
              </ul>
              <p className="text-xs text-neutral-500 mt-1">Click <strong>Search</strong>.</p>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full bg-neutral-900 text-white text-xs font-bold flex items-center justify-center">3</span>
            <div>
              <p className="font-medium text-neutral-800">Pick any number from the list and click <em>Buy</em></p>
              <p className="text-xs text-neutral-600 mt-1">A <strong>&quot;Review Phone Number&quot;</strong> modal pops up. The next step explains every confusing thing on it.</p>
            </div>
          </li>
        </ol>

        <div className="flex justify-between pt-2">
          <button type="button" className="btn-secondary" onClick={() => setStep("verify-phone")}>Back</button>
          <button type="button" className="btn-primary" onClick={() => setStep("review-purchase")}>I clicked Buy →</button>
        </div>
      </div>
    );
  }

  if (step === "review-purchase") {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Step 4b: The &quot;Review Phone Number&quot; modal</h2>
        <p className="text-sm text-neutral-700">
          Twilio shows you a busy-looking screen with several warnings before letting you buy. None of them block our use case — here&apos;s what each one means.
        </p>

        <div className="rounded-md border border-neutral-200 p-3 text-sm space-y-2">
          <p className="font-medium text-neutral-800">📋 &quot;A2P 10DLC registration required&quot;</p>
          <p className="text-xs text-neutral-600">
            US carriers (T-Mobile, AT&amp;T, Verizon) require registering an &quot;Application-to-Person&quot; sender before
            you can send high-volume SMS reliably. <strong>For our use case (a personal alerts bot texting just you):</strong>
          </p>
          <ul className="text-xs text-neutral-600 ml-3 list-disc list-inside space-y-0.5">
            <li><strong>You can ignore it during purchase</strong> — just click Buy. The warning stays on your number forever; it&apos;s not blocking anything.</li>
            <li>On a trial Twilio account, SMS to <em>verified caller IDs</em> works without registering.</li>
            <li>If you later upgrade to a paid Twilio account, you may want to do the <em>Low-Volume Standard</em> registration: cheap (~$2/mo) and fast. Twilio nags you about it. Optional.</li>
          </ul>
        </div>

        <div className="rounded-md border border-neutral-200 p-3 text-sm space-y-2">
          <p className="font-medium text-neutral-800">🚨 &quot;Emergency Calling Enablement&quot; checkbox</p>
          <p className="text-xs text-neutral-600">
            US FCC rules force Twilio to support 911 from voice-capable numbers. The fine print:
          </p>
          <ul className="text-xs text-neutral-600 ml-3 list-disc list-inside space-y-0.5">
            <li>If <em>someone calls 911</em> from this number <em>and</em> you haven&apos;t set up an emergency address, Twilio charges $75 for that call.</li>
            <li>You&apos;re using this number for <strong>SMS only</strong> — nobody will dial 911 from it.</li>
            <li><strong>Check the box.</strong> You&apos;re agreeing to comply with their voice/911 terms, which only matters if you ever use the number for voice.</li>
          </ul>
        </div>

        <div className="rounded-md border border-neutral-200 p-3 text-sm space-y-2">
          <p className="font-medium text-neutral-800">💰 &quot;$1.15 monthly fee&quot;</p>
          <p className="text-xs text-neutral-600">
            Charged from your trial credit. The first $1.15 comes off immediately, then again each month. Your $15.50 trial covers ~13 months of number rental on its own (or fewer months + however many SMS you send).
          </p>
        </div>

        <div className="rounded-md bg-yellow-50 border border-yellow-200 p-3 text-xs text-yellow-900">
          <p className="font-semibold">After clicking the blue Buy button:</p>
          <ul className="list-disc list-inside mt-1 space-y-0.5">
            <li><strong>Close any &quot;configure your number&quot; modal that pops up</strong> — webhook setup is not needed for our use case. Click the × in the corner.</li>
            <li>Write down the number in E.164 format (e.g. <code className="bg-white px-1 rounded">+14159378455</code>) — you&apos;ll paste it in the form a few steps from now.</li>
          </ul>
        </div>

        <div className="flex justify-between pt-2">
          <button type="button" className="btn-secondary" onClick={() => setStep("buy-number")}>Back</button>
          <button type="button" className="btn-primary" onClick={() => setStep("upgrade-account")}>Bought it, next →</button>
        </div>
      </div>
    );
  }

  if (step === "upgrade-account") {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Step 5: Upgrade your account (required before A2P)</h2>
        <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-900">
          <p className="font-semibold">⚠️ Trial accounts CANNOT register for A2P 10DLC.</p>
          <p className="text-xs mt-1">
            If you skip this step and try the next one, you&apos;ll get the error: <em>&quot;You cannot register for A2P Messaging in a trial account. Please upgrade your account to register.&quot;</em>
          </p>
        </div>

        <p className="text-sm text-neutral-700">
          To upgrade, Twilio asks you to:
          {" "}<strong>(1)</strong> create a Customer Profile (Trust Hub),
          {" "}<strong>(2)</strong> add billing details,
          {" "}<strong>(3)</strong> prefund at least <strong>$20</strong>.
          The $20 becomes future SMS credit — you don&apos;t lose it, it just gets spent against SMS sends as you go.
        </p>

        <ol className="space-y-3 text-sm text-neutral-700">
          <li className="flex gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full bg-neutral-900 text-white text-xs font-bold flex items-center justify-center">1</span>
            <div>
              <p className="font-medium text-neutral-800">Open Trust Hub → Customer Profiles</p>
              <a href="https://1console.twilio.com/us1/trusthub/customer-profiles" target="_blank" rel="noreferrer" className="inline-block mt-1 text-blue-700 underline">
                Open Customer Profiles page →
              </a>
              <p className="text-xs text-neutral-500 mt-1">Or navigate via the left sidebar: <strong>Trust Hub</strong> → <strong>Customer Profiles</strong>.</p>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full bg-neutral-900 text-white text-xs font-bold flex items-center justify-center">2</span>
            <div>
              <p className="font-medium text-neutral-800">Click <em>Create a Customer Profile</em></p>
              <ul className="text-xs text-neutral-600 mt-1 ml-3 list-disc list-inside space-y-0.5">
                <li>Pick <strong>Sole Proprietor</strong> (for personal use). Cheaper, faster, no business tax ID required.</li>
                <li>Fill in your legal name, address, email, mobile</li>
                <li>Provide a website (your dashboard URL is fine — or skip if optional)</li>
              </ul>
              <p className="text-xs text-neutral-500 mt-1">Submit. This is the same data the A2P Brand registration uses, so you only fill it once.</p>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full bg-neutral-900 text-white text-xs font-bold flex items-center justify-center">3</span>
            <div>
              <p className="font-medium text-neutral-800">Add a payment method + prefund $20</p>
              <a href="https://1console.twilio.com/us1/billing/manage-billing/billing-overview" target="_blank" rel="noreferrer" className="inline-block mt-1 text-blue-700 underline">
                Open Billing page →
              </a>
              <ul className="text-xs text-neutral-600 mt-1 ml-3 list-disc list-inside space-y-0.5">
                <li>Add a credit/debit card</li>
                <li>Use <strong>Add Funds</strong> (or Twilio prompts you automatically) to add $20</li>
                <li>This flips your account from &quot;Trial&quot; to &quot;Paid&quot; — confirm by checking the top-left of the console (no more orange &quot;Trial&quot; badge)</li>
              </ul>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full bg-neutral-900 text-white text-xs font-bold flex items-center justify-center">4</span>
            <div>
              <p className="font-medium text-neutral-800">Done. You can now register A2P.</p>
              <p className="text-xs text-neutral-600 mt-1">Click Next below to continue to A2P registration.</p>
            </div>
          </li>
        </ol>

        <div className="rounded-md bg-blue-50 border border-blue-200 p-3 text-xs text-blue-900">
          <p className="font-semibold">💡 Why Twilio gates this</p>
          <p className="mt-1">
            A2P 10DLC registration involves US carriers (T-Mobile, AT&amp;T, Verizon) verifying your business identity.
            Twilio doesn&apos;t want trial fraudsters jamming up the registration system, so they only accept registrations from accounts that have skin in the game (the $20 prefund).
            On the bright side, that $20 isn&apos;t a fee — it&apos;s prepaid SMS credit.
          </p>
        </div>

        <div className="flex justify-between pt-2">
          <button type="button" className="btn-secondary" onClick={() => setStep("review-purchase")}>Back</button>
          <button type="button" className="btn-primary" onClick={() => setStep("a2p-register")}>Account upgraded, next →</button>
        </div>
      </div>
    );
  }

  if (step === "a2p-register") {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Step 6: Register A2P 10DLC (required)</h2>
        <p className="text-sm text-neutral-700">
          The actual gate that keeps SMS from delivering. Two things have to be approved in order: <strong>Brand</strong> first, then <strong>Campaign</strong>.
          For Sole Proprietor brands, the brand approves in <strong>minutes</strong> (a phone confirmation, not a multi-day TCR review), and the campaign typically approves within an hour.
          Skip this and SMS gets blocked with error <code className="bg-neutral-100 px-1 rounded">30034</code>.
        </p>
        <div className="rounded-md bg-blue-50 border border-blue-200 p-2 text-xs text-blue-900">
          <strong>Prereq:</strong> Step 5 (Upgrade your account) must be done first. A2P registration is blocked on trial accounts.
        </div>

        <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-900">
          <p className="font-semibold">⚠️ Order matters</p>
          <p className="text-xs mt-1">
            Twilio&apos;s console has tabs for both <strong>Brands</strong> and <strong>Campaigns</strong>. Don&apos;t start on Campaigns — Twilio won&apos;t let you create one until your Brand is confirmed. Do Part A first.
          </p>
        </div>

        <div className="rounded-md border-2 border-neutral-300 p-4 space-y-3">
          <h3 className="font-semibold text-base">Part A — Register your Brand (do this FIRST)</h3>
          <a href="https://1console.twilio.com/us1/trusthub/registrations/a2p-brands" target="_blank" rel="noreferrer" className="inline-block text-blue-700 underline">
            Open the A2P Brands page →
          </a>
          <p className="text-xs text-neutral-500">
            Or sidebar: <strong>Trust Hub</strong> → <strong>Registrations</strong> → <strong>A2P Brands</strong>.
          </p>
          <ol className="space-y-3 text-sm text-neutral-700">
            <li className="flex gap-3">
              <span className="shrink-0 w-6 h-6 rounded-full bg-neutral-900 text-white text-xs font-bold flex items-center justify-center">A1</span>
              <div>
                <p className="font-medium text-neutral-800">Click <em>Create a Brand</em> (or <em>Register a Brand</em>)</p>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="shrink-0 w-6 h-6 rounded-full bg-neutral-900 text-white text-xs font-bold flex items-center justify-center">A2</span>
              <div>
                <p className="font-medium text-neutral-800">Pick <strong>Sole Proprietor</strong></p>
                <p className="text-xs text-neutral-600 mt-1">
                  Other options (&quot;Standard&quot;, &quot;Low-Volume Standard&quot;) are for businesses with an EIN. Sole Proprietor is for individuals — cheaper, faster, no business tax ID required.
                </p>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="shrink-0 w-6 h-6 rounded-full bg-neutral-900 text-white text-xs font-bold flex items-center justify-center">A3</span>
              <div>
                <p className="font-medium text-neutral-800">Fill the brand form</p>
                <ul className="text-xs text-neutral-600 mt-1 ml-3 list-disc list-inside space-y-0.5">
                  <li>Brand name: anything readable (e.g. <em>&quot;Personal Alerts&quot;</em>)</li>
                  <li>Vertical: <em>Other</em> or <em>Technology</em></li>
                  <li>Legal name, address, email, mobile phone — uses the Customer Profile from Step 5</li>
                  <li>Website: your dashboard URL is fine; can leave blank</li>
                </ul>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="shrink-0 w-6 h-6 rounded-full bg-neutral-900 text-white text-xs font-bold flex items-center justify-center">A4</span>
              <div>
                <p className="font-medium text-neutral-800">Submit + pay ~$4 one-time</p>
                <p className="text-xs text-neutral-600 mt-1">
                  Twilio charges $4 (one-time) to register the Sole Proprietor brand.
                </p>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="shrink-0 w-6 h-6 rounded-full bg-neutral-900 text-white text-xs font-bold flex items-center justify-center">A5</span>
              <div>
                <p className="font-medium text-neutral-800">Confirm the phone number Twilio sends a code to</p>
                <p className="text-xs text-neutral-600 mt-1">
                  Twilio texts a verification code to the mobile number on the brand. Enter it back in the console. <strong>This is what unlocks the brand</strong> — for Sole Proprietor, brand approval happens in minutes once you confirm.
                </p>
                <p className="text-xs text-neutral-500 mt-1">Status flips to <strong>Approved</strong>. Move straight on to Part B.</p>
              </div>
            </li>
          </ol>
        </div>

        <div className="rounded-md border-2 border-neutral-300 p-4 space-y-3">
          <h3 className="font-semibold text-base">Part B — Register your Campaign (only AFTER Brand is approved)</h3>
          <a href="https://1console.twilio.com/us1/trusthub/registrations/a2p-campaigns/campaigns" target="_blank" rel="noreferrer" className="inline-block text-blue-700 underline">
            Open the A2P Campaigns page →
          </a>
          <p className="text-xs text-neutral-500">
            Or sidebar: <strong>Trust Hub</strong> → <strong>Registrations</strong> → <strong>A2P Campaigns</strong>.
          </p>
          <p className="text-xs text-neutral-700">
            <strong>Cost:</strong> Sole Proprietor campaigns are <strong>$2/month</strong> + $15 one-time per campaign registration.
            Charged from your prefunded balance.
          </p>
          <ol className="space-y-3 text-sm text-neutral-700">
            <li className="flex gap-3">
              <span className="shrink-0 w-6 h-6 rounded-full bg-neutral-900 text-white text-xs font-bold flex items-center justify-center">B1</span>
              <div>
                <p className="font-medium text-neutral-800">Click <em>Create a Campaign</em></p>
                <p className="text-xs text-neutral-600 mt-1">
                  Twilio opens a modal titled <strong>&quot;Create an A2P Campaign&quot;</strong> with your brand pre-filled.
                </p>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="shrink-0 w-6 h-6 rounded-full bg-neutral-900 text-white text-xs font-bold flex items-center justify-center">B2</span>
              <div>
                <p className="font-medium text-neutral-800">Pick a Messaging Service</p>
                <p className="text-xs text-neutral-600 mt-1">
                  Twilio asks: <em>&quot;Use an existing Messaging Service or create a new one?&quot;</em>
                </p>
                <p className="text-xs text-neutral-600 mt-1">
                  <strong>Pick &quot;Create a new Messaging Service&quot;</strong> — cleaner than reusing the auto-generated one.
                  When prompted for a name, use <code className="bg-neutral-100 px-1 rounded">Slickdeals Alerts</code>.
                </p>
                <p className="text-xs text-neutral-500 mt-1">
                  What&apos;s a Messaging Service? A Twilio container that holds your phone number(s) and the campaign together.
                </p>
                <p className="text-xs text-neutral-500 mt-1">Click <strong>Get started</strong>.</p>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="shrink-0 w-6 h-6 rounded-full bg-neutral-900 text-white text-xs font-bold flex items-center justify-center">B3</span>
              <div>
                <p className="font-medium text-neutral-800">&quot;Basic information&quot; screen → registration name</p>
                <p className="text-xs text-neutral-600 mt-1">
                  Field: <strong>A2P Campaign registration name</strong> — just an internal label. Type something like:
                </p>
                <code className="block mt-1 text-[10px] bg-neutral-100 p-2 rounded font-mono">Slickdeals Alerts campaign</code>
                <p className="text-xs text-neutral-500 mt-1">Click <strong>Next</strong>.</p>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="shrink-0 w-6 h-6 rounded-full bg-neutral-900 text-white text-xs font-bold flex items-center justify-center">B4</span>
              <div>
                <p className="font-medium text-neutral-800">&quot;Use case&quot; dropdown</p>
                <p className="text-xs text-neutral-600 mt-1">
                  Only one option: <strong>Sole Proprietor</strong> (because your brand is Sole Proprietor). Pick it. Click <strong>Next</strong>.
                </p>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="shrink-0 w-6 h-6 rounded-full bg-neutral-900 text-white text-xs font-bold flex items-center justify-center">B5</span>
              <div>
                <p className="font-medium text-neutral-800">Campaign description</p>
                <p className="text-xs text-neutral-600 mt-1">Paste this:</p>
                <code className="block mt-1 text-[10px] bg-neutral-100 p-2 rounded font-mono">
                  Personal Slickdeals deal alerts to my own phone via a self-hosted dashboard
                </code>
                <p className="text-xs text-neutral-500 mt-1">Click <strong>Next</strong>.</p>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="shrink-0 w-6 h-6 rounded-full bg-neutral-900 text-white text-xs font-bold flex items-center justify-center">B6</span>
              <div>
                <p className="font-medium text-neutral-800">Recipient consent (Message flow)</p>
                <p className="text-xs text-neutral-600 mt-1">Checkboxes for &quot;How do end-users opt in?&quot; — check <strong>Web Form</strong> (since you opt in by saving the channel in our dashboard&apos;s settings form).</p>
                <p className="text-xs text-neutral-600 mt-1"><em>How do end-users consent to receive messages?</em> text box — paste:</p>
                <code className="block mt-1 text-[10px] bg-neutral-100 p-2 rounded font-mono">
                  {`The end-user opts in by entering their own phone number in the recipient field of the SMS channel form in the dashboard's settings, then confirming a 6-digit verification code sent to that number. This is a personal-use deployment — recipient is the same individual operating the dashboard.`}
                </code>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="shrink-0 w-6 h-6 rounded-full bg-neutral-900 text-white text-xs font-bold flex items-center justify-center">B7</span>
              <div>
                <p className="font-medium text-neutral-800">Message contents</p>
                <p className="text-xs text-neutral-600 mt-1">Check <strong>Embedded links</strong> (we send slickdeals.net deal URLs). Leave the others unchecked — we don&apos;t do phone numbers / lending / age-gated content.</p>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="shrink-0 w-6 h-6 rounded-full bg-neutral-900 text-white text-xs font-bold flex items-center justify-center">B8</span>
              <div>
                <p className="font-medium text-neutral-800">Privacy policy + Terms URLs</p>
                <p className="text-xs text-neutral-600 mt-1">
                  Both are required. We host both on your own deployment:
                </p>
                <ul className="text-xs text-neutral-600 mt-1 ml-3 list-disc list-inside space-y-0.5">
                  <li>Privacy policy: <code className="bg-neutral-100 px-1 rounded">https://YOUR-DASHBOARD/privacy</code></li>
                  <li>Terms &amp; conditions: <code className="bg-neutral-100 px-1 rounded">https://YOUR-DASHBOARD/terms</code></li>
                </ul>
                <p className="text-xs text-neutral-600 mt-1">
                  Replace <code className="bg-neutral-100 px-1 rounded">YOUR-DASHBOARD</code> with the URL of this dashboard (the one in your browser&apos;s address bar). Both pages render the required disclosures (non-sharing of mobile numbers, message frequency, &quot;message and data rates may apply&quot;).
                </p>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="shrink-0 w-6 h-6 rounded-full bg-neutral-900 text-white text-xs font-bold flex items-center justify-center">B9</span>
              <div>
                <p className="font-medium text-neutral-800">Sample messages (if asked — 2 messages)</p>
                <p className="text-xs text-neutral-600 mt-1">Paste:</p>
                <div className="mt-1 space-y-1">
                  <code className="block text-[10px] bg-neutral-100 p-2 rounded font-mono">
                    [Slickdeals Alerts] $9.99 — 50ft Cat6 Cable @ Best Buy. slickdeals.net/f/12345
                  </code>
                  <code className="block text-[10px] bg-neutral-100 p-2 rounded font-mono">
                    [Slickdeals Alerts] $42 — Anker 65W USB-C @ Amazon. slickdeals.net/f/67890
                  </code>
                </div>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="shrink-0 w-6 h-6 rounded-full bg-neutral-900 text-white text-xs font-bold flex items-center justify-center">B10</span>
              <div>
                <p className="font-medium text-neutral-800">Submit + pay ~$15 + $2/mo</p>
                <p className="text-xs text-neutral-600 mt-1">
                  Per-request $15 charge + $2/month ongoing. Sole Proprietor campaigns typically approve <strong>within an hour</strong> (sometimes immediately) — not the 1-2 days the older walkthroughs warned about. Check the campaign status in Trust Hub; once it reads <strong>Approved</strong>, move on.
                </p>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="shrink-0 w-6 h-6 rounded-full bg-neutral-900 text-white text-xs font-bold flex items-center justify-center">B11</span>
              <div>
                <p className="font-medium text-neutral-800">Attach your Twilio number to the Messaging Service</p>
                <p className="text-xs text-neutral-600 mt-1">
                  Open the Messaging Service (<em>Slickdeals Alerts</em>) → <strong>Sender Pool</strong> → <strong>Add Senders</strong> → pick the phone number you bought in Step 4. Saves immediately.
                </p>
                <p className="text-xs text-neutral-500 mt-1">
                  SMS deliveries through Twilio start working the moment this attachment is saved. Come back to this wizard and hit <em>Send verification SMS now</em>.
                </p>
              </div>
            </li>
          </ol>
        </div>

        <div className="rounded-md bg-blue-50 border border-blue-200 p-3 text-sm text-blue-900">
          <p className="font-semibold">Sole Proprietor timing</p>
          <p className="text-xs mt-1">
            Brand: confirms in <strong>minutes</strong> via the SMS code in A5. Campaign: typically <strong>under an hour</strong>, sometimes immediate. Total: same-day, not multi-day.
          </p>
          <p className="text-xs mt-1">
            (Standard / Low-Volume brands have longer review by The Campaign Registry — but you&apos;re not using those.)
          </p>
        </div>

        <div className="flex justify-between pt-2">
          <button type="button" className="btn-secondary" onClick={() => setStep("upgrade-account")}>Back</button>
          <button type="button" className="btn-primary" onClick={() => setStep("trial-limits")}>I&apos;ll do this, next step →</button>
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
            <a className="underline text-blue-700" href="https://1console.twilio.com/us1/develop/phone-numbers/manage/verified" target="_blank" rel="noreferrer">
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
            <a className="underline text-blue-700" href="https://1console.twilio.com/us1/billing/manage-billing/billing-overview" target="_blank" rel="noreferrer">
              Billing
            </a>
            {" "}removes the trial restriction. SMS can then go to any number worldwide. Most people skip this unless they outgrow the trial.
          </p>
        </div>

        <div className="flex justify-between pt-2">
          <button type="button" className="btn-secondary" onClick={() => setStep("a2p-register")}>Back</button>
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
              <a href="https://1console.twilio.com/" target="_blank" rel="noreferrer" className="inline-block mt-1 text-blue-700 underline">
                Open 1console.twilio.com →
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

  if (step === "form" || step === "saving") {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Step 7: Paste everything below</h2>
        <p className="text-sm text-neutral-700">
          We&apos;ll <strong>save these credentials</strong> so they&apos;re ready for when your A2P registration is approved. No SMS will be sent at this stage.
        </p>

        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">Account SID</label>
          <input type="text" className="input font-mono text-xs" placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" value={accountSid} onChange={(e) => setAccountSid(e.target.value)} />
          <p className="text-xs text-neutral-500 mt-1">Starts with AC, 34 characters.</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">Auth Token</label>
          <input
            type="password"
            className="input font-mono text-xs"
            placeholder={hasExistingChannel ? "Leave blank to keep the saved token" : "32-character secret"}
            value={authToken}
            onChange={(e) => setAuthToken(e.target.value)}
          />
          <p className="text-xs text-neutral-500 mt-1">
            {hasExistingChannel
              ? "We don't display the saved token (security). Leave blank to keep using it, or paste a new one to replace."
              : "The one you clicked the 👁 to reveal."}
          </p>
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
        <h2 className="text-xl font-semibold">Step 8: Wait for A2P approval</h2>
        <div className="rounded-md bg-green-50 border border-green-200 p-3 text-sm text-green-900">
          ✅ Your Twilio credentials are saved.
        </div>

        <details className="text-xs">
          <summary className="cursor-pointer text-neutral-600 underline">
            Haven&apos;t finished the setup steps yet? Click to navigate back
          </summary>
          <div className="mt-2 ml-2 flex flex-wrap gap-2">
            <button type="button" className="btn-secondary text-xs" onClick={() => setStep("intro")}>← Start over (intro)</button>
            <button type="button" className="btn-secondary text-xs" onClick={() => setStep("buy-number")}>← Buy a number</button>
            <button type="button" className="btn-secondary text-xs" onClick={() => setStep("upgrade-account")}>← Upgrade account</button>
            <button type="button" className="btn-secondary text-xs" onClick={() => setStep("a2p-register")}>← A2P registration</button>
            <button type="button" className="btn-secondary text-xs" onClick={() => setStep("find-creds")}>← Find credentials</button>
            <button type="button" className="btn-secondary text-xs" onClick={() => setStep("form")}>← Edit credentials</button>
          </div>
        </details>

        <p className="text-sm text-neutral-700">
          From here it&apos;s a waiting game. Twilio reviews your A2P registration (Brand + Campaign) and gates outbound SMS until both are approved.
        </p>

        <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-sm text-amber-900 space-y-2">
          <p className="font-semibold">📅 Sole Proprietor timeline</p>
          <ul className="text-xs list-disc list-inside space-y-1">
            <li><strong>Brand:</strong> confirms in <em>minutes</em> after you enter the SMS code Twilio sends.</li>
            <li><strong>Campaign:</strong> typically approves within <em>an hour</em>, sometimes immediately. Watch the status in Trust Hub.</li>
            <li><strong>Attach number → SMS works:</strong> the moment the number lands in the Messaging Service&apos;s Sender Pool.</li>
          </ul>
          <p className="text-xs">
            If you finish A2P right after seeing this page, click <strong>&quot;Send verification SMS now&quot;</strong> below to wrap up.
          </p>
        </div>

        <div className="rounded-md bg-blue-50 border border-blue-200 p-3 text-sm text-blue-900 space-y-1">
          <p className="font-semibold">Check status in Twilio:</p>
          <p className="text-xs">
            <a className="underline" href="https://1console.twilio.com/us1/trusthub/registrations/a2p-brands" target="_blank" rel="noreferrer">
              Brand status →
            </a>
            {" "}|{" "}
            <a className="underline" href="https://1console.twilio.com/us1/trusthub/registrations/a2p-campaigns/campaigns" target="_blank" rel="noreferrer">
              Campaign status →
            </a>
          </p>
          <p className="text-xs">Both must read <strong>&quot;Approved&quot;</strong> before SMS will deliver.</p>
        </div>

        <p className="text-sm text-neutral-700">
          In the meantime, your <strong>Telegram / ntfy / Discord / email</strong> channels (whichever you set up) keep working normally. Alerts won&apos;t route to SMS until you finish verification here.
        </p>

        {errMsg && (
          <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-900">
            <p className="font-medium">Last attempt:</p>
            <p className="mt-1 text-xs">{errMsg}</p>
          </div>
        )}

        <div className="flex justify-between pt-2 flex-wrap gap-2">
          <button type="button" className="btn-secondary" onClick={onDone}>I&apos;ll come back later</button>
          <button type="button" className="btn-primary" onClick={triggerVerificationSms}>
            Send verification SMS now
          </button>
        </div>
        <p className="text-xs text-neutral-500 text-center">
          You can re-open this wizard any time from Settings → Add channel → SMS to retry.
        </p>
      </div>
    );
  }

  if (step === "sending-sms") {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Sending SMS…</h2>
        <p className="text-sm text-neutral-600">Twilio is processing the request. This takes a few seconds.</p>
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
        <button type="button" className="btn-primary" onClick={() => setStep(channelId ? "credentials-saved" : "form")}>Try again</button>
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
