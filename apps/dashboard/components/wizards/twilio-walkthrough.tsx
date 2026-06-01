"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { CopyableUrl, CopyableText } from "@/components/footer";

type Step =
  | "intro"
  | "signup"
  | "onboarding"
  | "verify-phone"
  | "buy-number"
  | "review-purchase"
  | "upgrade-account"
  | "a2p-brand"
  | "a2p-campaign"
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

  // On mount, load any existing Twilio channel's config into the form so
  // navigating back doesn't lose data. Don't auto-skip — user may have
  // saved before finishing A2P and needs to access earlier steps.
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
    })();
    return () => { cancelled = true; };
  }, []);

  const isE164 = (s: string) => /^\+[1-9]\d{6,14}$/.test(s.trim());

  function formValid(): boolean {
    return (
      accountSid.trim().startsWith("AC") &&
      accountSid.trim().length >= 30 &&
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
            ? "Twilio rejected with error 30034 (Unregistered Number). Your A2P 10DLC isn't approved yet — both Brand and Campaign must show 'Approved' in Trust Hub."
            : `Twilio rejected: ${json.error ?? `HTTP ${res.status}`}`,
        );
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

  // ---- step renders ----

  if (step === "intro") {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Connect SMS via Twilio</h2>

        {hasExistingChannel && (
          <div className="rounded-md bg-blue-50 border border-blue-200 p-3 text-sm text-blue-900 space-y-2">
            <p className="font-semibold">👋 Picking up where you left off?</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-primary text-xs" onClick={() => setStep("credentials-saved")}>Skip to verification</button>
              <button type="button" className="btn-secondary text-xs" onClick={() => setStep("upgrade-account")}>Upgrade account</button>
              <button type="button" className="btn-secondary text-xs" onClick={() => setStep("a2p-brand")}>A2P Brand</button>
              <button type="button" className="btn-secondary text-xs" onClick={() => setStep("a2p-campaign")}>A2P Campaign</button>
            </div>
          </div>
        )}

        <p className="text-sm text-neutral-700">
          Twilio sends real SMS to any phone — even flip phones. Takes ~15 minutes of clicking + a few hours waiting for one approval.
        </p>

        <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-sm text-amber-900 space-y-1">
          <p className="font-semibold">💵 You pay Twilio (not us)</p>
          <ul className="list-disc list-inside text-xs space-y-0.5">
            <li>$20 prefund upfront (becomes SMS credit, not a fee)</li>
            <li>$4 one-time brand + $15 one-time campaign + $2/month A2P fees</li>
            <li>~1¢ per SMS, ~$1.15/month per phone number</li>
            <li><strong>All-in: ~$40 to get started, then ~$3/month</strong></li>
          </ul>
        </div>

        <div className="rounded-md bg-blue-50 border border-blue-200 p-3 text-xs text-blue-900">
          <strong>Want notifications working in 5 minutes instead?</strong> Use Telegram or ntfy — both free, no carrier filtering. Hit Skip below.
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
        <ul className="list-disc list-inside text-sm text-neutral-700 space-y-1">
          <li>Go to <a className="text-blue-700 underline" href="https://www.twilio.com/try-twilio" target="_blank" rel="noreferrer">twilio.com/try-twilio</a> in a new tab.</li>
          <li>Fill in your name, real email, and a strong password.</li>
          <li>Confirm your email — Twilio sends a link.</li>
          <li>Sign back in. You&apos;ll land on the Twilio Console (the dashboard).</li>
        </ul>
        <div className="flex justify-between pt-2">
          <button type="button" className="btn-secondary" onClick={() => setStep("intro")}>Back</button>
          <button type="button" className="btn-primary" onClick={() => setStep("onboarding")}>Email confirmed →</button>
        </div>
      </div>
    );
  }

  if (step === "onboarding") {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Step 2: Onboarding survey</h2>
        <p className="text-sm text-neutral-700">Twilio asks a few setup questions. Suggested answers:</p>
        <ul className="list-disc list-inside text-sm text-neutral-700 space-y-1">
          <li><strong>What do you want to do first?</strong> &quot;Send and receive SMS&quot;</li>
          <li><strong>Role?</strong> &quot;Developer&quot; or &quot;Other&quot;</li>
          <li><strong>How to build?</strong> &quot;With code&quot;</li>
          <li><strong>Language?</strong> &quot;Other&quot;</li>
        </ul>
        <p className="text-xs text-neutral-500">
          Close any tutorial / webhook / CLI pop-ups they show. You&apos;re done when you land on the main Console.
        </p>
        <div className="flex justify-between pt-2">
          <button type="button" className="btn-secondary" onClick={() => setStep("signup")}>Back</button>
          <button type="button" className="btn-primary" onClick={() => setStep("verify-phone")}>I&apos;m on the Console →</button>
        </div>
      </div>
    );
  }

  if (step === "verify-phone") {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Step 3: Verify your real phone</h2>
        <p className="text-sm text-neutral-700">
          Twilio needs to text your actual phone (the one you carry — not a Twilio number) before letting you buy a number.
        </p>
        <ul className="list-disc list-inside text-sm text-neutral-700 space-y-1">
          <li>In the Console sidebar: <strong>Phone Numbers</strong> → <strong>Manage</strong> → <strong>Verified Caller IDs</strong>.</li>
          <li>Enter your phone in <strong>E.164 format</strong>: <code className="bg-neutral-100 px-1 rounded">+15551234567</code> (country code + number, no spaces).</li>
          <li>Twilio texts a code. Type it in. Done.</li>
        </ul>
        <div className="flex justify-between pt-2">
          <button type="button" className="btn-secondary" onClick={() => setStep("onboarding")}>Back</button>
          <button type="button" className="btn-primary" onClick={() => setStep("buy-number")}>Phone verified →</button>
        </div>
      </div>
    );
  }

  if (step === "buy-number") {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Step 4: Buy a Twilio phone number</h2>
        <p className="text-sm text-neutral-700">~$1.15/month. Comes out of your trial credit (or prefund later).</p>
        <ul className="list-disc list-inside text-sm text-neutral-700 space-y-1">
          <li>Sidebar: <strong>Phone Numbers</strong> → <strong>Manage</strong> → <strong>Buy a number</strong>.</li>
          <li>Filters: Country = US (or yours), Type = <em>Local</em>, Capabilities = <strong>SMS ✓ + MMS ✓</strong> (so we can send deal images).</li>
          <li>Click <strong>Search</strong>, pick any number, click <strong>Buy</strong>.</li>
          <li>The &quot;Review Phone Number&quot; modal pops up — explained next.</li>
        </ul>
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
        <p className="text-sm text-neutral-700">Two confusing things to know:</p>
        <ul className="list-disc list-inside text-sm text-neutral-700 space-y-2">
          <li>
            <strong>&quot;A2P 10DLC registration required&quot;:</strong> ignore for now — we&apos;ll do this in Step 6. The warning doesn&apos;t block the purchase.
          </li>
          <li>
            <strong>&quot;Emergency Calling Enablement&quot; checkbox:</strong> <em>check it.</em> Only matters if someone calls 911 from this number. You&apos;re using it for SMS only, so the $75 emergency-call fee will never fire.
          </li>
        </ul>
        <p className="text-sm text-neutral-700">Click <strong>Buy</strong>. Write down the number in E.164 format (<code className="bg-neutral-100 px-1 rounded">+14155550123</code>) — you&apos;ll need it later. Close any &quot;configure your number&quot; modal that pops up.</p>
        <div className="flex justify-between pt-2">
          <button type="button" className="btn-secondary" onClick={() => setStep("buy-number")}>Back</button>
          <button type="button" className="btn-primary" onClick={() => setStep("upgrade-account")}>Bought it →</button>
        </div>
      </div>
    );
  }

  if (step === "upgrade-account") {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Step 5: Upgrade your account (required)</h2>
        <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-900">
          Trial accounts can&apos;t register for A2P 10DLC. If you skip this, the next step blocks with &quot;cannot register in a trial account.&quot;
        </div>
        <p className="text-sm text-neutral-700">Three things, all in the Twilio Console:</p>
        <ol className="list-decimal list-inside text-sm text-neutral-700 space-y-1">
          <li>Sidebar: <strong>Trust Hub</strong> → <strong>Customer Profiles</strong> → <strong>Create a Customer Profile</strong> → pick <strong>Sole Proprietor</strong>. Fill in your legal name, address, mobile, email.</li>
          <li>Sidebar: <strong>Admin</strong> → <strong>Billing</strong>. Add a credit card.</li>
          <li>Same Billing page: click <strong>Add Funds</strong> → <strong>$20</strong>. Submit.</li>
        </ol>
        <p className="text-xs text-neutral-500">
          The $20 becomes future SMS credit, not a fee. Once paid, the orange &quot;Trial&quot; badge in the top-left disappears. Now you can register A2P.
        </p>
        <div className="flex justify-between pt-2">
          <button type="button" className="btn-secondary" onClick={() => setStep("review-purchase")}>Back</button>
          <button type="button" className="btn-primary" onClick={() => setStep("a2p-brand")}>Account upgraded →</button>
        </div>
      </div>
    );
  }

  if (step === "a2p-brand") {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Step 6: A2P 10DLC Brand (do this first)</h2>
        <p className="text-sm text-neutral-700">
          Two things to register in order: <strong>Brand</strong> first, then <strong>Campaign</strong>. Same-day total.
        </p>
        <div className="rounded-md bg-red-50 border border-red-200 p-2 text-xs text-red-900">
          Don&apos;t start on Campaigns — Twilio won&apos;t let you create one until a Brand is registered.
        </div>

        <p className="text-sm text-neutral-700"><strong>How to get there:</strong></p>
        <p className="text-sm text-neutral-700">Sidebar: <strong>Trust Hub</strong> → <strong>Registrations</strong> → <strong>A2P Brands</strong>.</p>

        <ol className="list-decimal list-inside text-sm text-neutral-700 space-y-1">
          <li>Click <strong>Create a Brand</strong>.</li>
          <li>Pick <strong>Sole Proprietor</strong>.</li>
          <li>Form fields: Brand name (e.g. <em>Personal Alerts</em>), Vertical = <em>Other</em>, your legal info (already filled in from the Customer Profile).</li>
          <li>Submit. Twilio charges <strong>$4 one-time</strong>.</li>
          <li>Twilio texts a verification code to your phone — enter it. <strong>Brand approves in minutes.</strong></li>
        </ol>

        <div className="flex justify-between pt-2">
          <button type="button" className="btn-secondary" onClick={() => setStep("upgrade-account")}>Back</button>
          <button type="button" className="btn-primary" onClick={() => setStep("a2p-campaign")}>Brand approved →</button>
        </div>
      </div>
    );
  }

  if (step === "a2p-campaign") {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Step 7: A2P 10DLC Campaign</h2>
        <p className="text-sm text-neutral-700">
          Sidebar: <strong>Trust Hub</strong> → <strong>Registrations</strong> → <strong>A2P Campaigns</strong> → <strong>Create a Campaign</strong>.
        </p>
        <p className="text-xs text-neutral-500">Cost: $15 one-time + $2/month. Approves <strong>within an hour</strong>, often immediately.</p>

        <p className="text-sm font-medium pt-2">Click through each screen, paste the values below:</p>

        <Section label="Messaging Service">
          <p>Pick <strong>Create a new Messaging Service</strong>, name it <code className="bg-neutral-100 px-1 rounded">Slickdeals Alerts</code>. Click <strong>Get started</strong>.</p>
        </Section>

        <Section label="A2P Campaign registration name">
          <CopyableText template="Slickdeals Alerts campaign" />
        </Section>

        <Section label="Use case">
          <p>Only one option — <strong>Sole Proprietor</strong>. Pick it.</p>
        </Section>

        <Section label="Campaign description">
          <CopyableText template="Personal Slickdeals deal alerts to my own phone via a self-hosted dashboard" />
        </Section>

        <Section label="Sample messages (2)">
          <CopyableText template="[Slickdeals Alerts] $9.99 — 50ft Cat6 Cable @ Best Buy. slickdeals.net/f/12345" />
          <CopyableText template="[Slickdeals Alerts] $42 — Anker 65W USB-C @ Amazon. slickdeals.net/f/67890" />
        </Section>

        <Section label="Message contents">
          <p>Check <strong>Embedded links</strong> only (we send slickdeals.net URLs). Leave the others unchecked.</p>
        </Section>

        <Section label="Privacy policy URL">
          <CopyableUrl path="/privacy" />
        </Section>

        <Section label="Terms &amp; conditions URL">
          <CopyableUrl path="/terms" />
        </Section>

        <Section label="Opt-in proof URL (if asked)">
          <CopyableUrl path="/sms-opt-in" />
        </Section>

        <Section label="Recipient consent">
          <p className="text-xs mb-2">Check <strong>Web Form</strong>. Then in &quot;How do end-users consent?&quot; paste this:</p>
          <div className="rounded-md bg-red-50 border border-red-200 p-2 text-[11px] text-red-900 mb-2">
            ⚠️ Don&apos;t skip the URL — Twilio rejects with error 30896 if no public opt-in URL is mentioned.
          </div>
          <CopyableText template={`End-users opt in via the public web form at {ORIGIN}/sms-opt-in. The form requires the user to:
(1) enter their mobile phone number
(2) actively check a consent checkbox (NOT pre-checked) agreeing to receive automated SMS deal alerts about deals matching their saved Slickdeals searches
(3) read the message frequency disclosure, standard rates disclaimer, HELP/STOP instructions, and links to the privacy policy and terms of service
(4) click "Yes, sign me up!" to submit

After submission the user signs into the dashboard, enters the same phone number into the SMS channel form, and receives a 6-digit verification code by SMS — they enter the code back into the dashboard to complete double opt-in. This is a personal-use deployment; the recipient is the same individual who registered.`} />
        </Section>

        <Section label="Opt-in keywords + message">
          <p className="text-xs mb-2">Keywords: <em>leave blank</em> (Twilio uses START/YES/UNSTOP defaults). Message:</p>
          <CopyableText template="Slickdeals Alerts: You're now subscribed to deal alerts about saved Slickdeals searches. Message frequency varies based on your alert settings. Reply HELP for help, STOP to opt out. Msg & data rates may apply." />
        </Section>

        <Section label="Opt-out message">
          <CopyableText template="Slickdeals Alerts: You have been unsubscribed. You will not receive any more messages from this number. Reply START to resubscribe." />
        </Section>

        <Section label="Help message">
          <p className="text-xs text-neutral-600 mb-2">
            Must include brand name + a real help destination. &quot;Reply STOP&quot; alone gets rejected as not actually helpful.
          </p>
          <CopyableText template={`Slickdeals Alerts: For help, sign into your dashboard at {ORIGIN} or open an issue at github.com/Meowssi/slickdeals-alerts/issues. Reply STOP to unsubscribe. Msg & data rates may apply.`} />
        </Section>

        <Section label="Final step: attach your number">
          <p>After the campaign is <strong>Approved</strong>: open the Messaging Service you named &quot;Slickdeals Alerts&quot; → <strong>Sender Pool</strong> → <strong>Add Senders</strong> → pick the phone number you bought. SMS unlocks immediately.</p>
        </Section>

        <div className="flex justify-between pt-2">
          <button type="button" className="btn-secondary" onClick={() => setStep("a2p-brand")}>Back</button>
          <button type="button" className="btn-primary" onClick={() => setStep("trial-limits")}>Campaign submitted →</button>
        </div>
      </div>
    );
  }

  if (step === "trial-limits") {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Step 8: Trial-account recipient limit</h2>
        <p className="text-sm text-neutral-700">
          If you haven&apos;t upgraded yet (or are testing while waiting for A2P), trial Twilio can only SMS phones in your <strong>Verified Caller IDs</strong>.
        </p>
        <ul className="list-disc list-inside text-sm text-neutral-700 space-y-1">
          <li>The phone you verified in Step 3 is already in there.</li>
          <li>To text other phones: sidebar → <strong>Phone Numbers</strong> → <strong>Manage</strong> → <strong>Verified Caller IDs</strong> → add each.</li>
          <li>Once you&apos;ve upgraded (Step 5) <em>and</em> A2P is approved (Step 7), the restriction goes away — SMS works to anyone.</li>
        </ul>
        <div className="flex justify-between pt-2">
          <button type="button" className="btn-secondary" onClick={() => setStep("a2p-campaign")}>Back</button>
          <button type="button" className="btn-primary" onClick={() => setStep("find-creds")}>Got it →</button>
        </div>
      </div>
    );
  }

  if (step === "find-creds") {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Step 9: Find your API credentials</h2>
        <p className="text-sm text-neutral-700">
          Two values from the Twilio Console homepage&apos;s <strong>Account Info</strong> panel:
        </p>
        <ul className="list-disc list-inside text-sm text-neutral-700 space-y-1">
          <li><strong>Account SID</strong> — starts with <code className="bg-neutral-100 px-1 rounded">AC</code>, 34 chars. Click to copy.</li>
          <li><strong>Auth Token</strong> — click the 👁 to reveal, then copy. <em>Treat like a password.</em></li>
        </ul>
        <div className="flex justify-between pt-2">
          <button type="button" className="btn-secondary" onClick={() => setStep("trial-limits")}>Back</button>
          <button type="button" className="btn-primary" onClick={() => setStep("form")}>I have both →</button>
        </div>
      </div>
    );
  }

  if (step === "form" || step === "saving") {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Step 10: Paste credentials</h2>
        <p className="text-sm text-neutral-700">We&apos;ll save these. SMS verification happens after A2P is approved.</p>

        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">Account SID</label>
          <input type="text" className="input font-mono text-xs" placeholder="ACxxxxxxxx..." value={accountSid} onChange={(e) => setAccountSid(e.target.value)} />
        </div>
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">Auth Token</label>
          <input
            type="password" className="input font-mono text-xs"
            placeholder={hasExistingChannel ? "Leave blank to keep the saved token" : "32-char secret"}
            value={authToken} onChange={(e) => setAuthToken(e.target.value)}
          />
          {hasExistingChannel && (
            <p className="text-xs text-neutral-500 mt-1">Already saved. Blank = keep it; paste new = replace.</p>
          )}
        </div>
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">Your Twilio number (from)</label>
          <input type="tel" className="input font-mono text-xs" placeholder="+14155550123" value={fromNumber} onChange={(e) => setFromNumber(e.target.value)} />
        </div>
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">Your real phone (recipient)</label>
          <input type="tel" className="input font-mono text-xs" placeholder="+15551234567" value={phone} onChange={(e) => setPhone(e.target.value)} />
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
        <h2 className="text-xl font-semibold">Step 11: Wait for A2P approval, then verify</h2>
        <div className="rounded-md bg-green-50 border border-green-200 p-3 text-sm text-green-900">✅ Credentials saved.</div>

        <details className="text-xs">
          <summary className="cursor-pointer text-neutral-600 underline">Need to navigate back?</summary>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className="btn-secondary text-xs" onClick={() => setStep("intro")}>Start over</button>
            <button type="button" className="btn-secondary text-xs" onClick={() => setStep("upgrade-account")}>Upgrade account</button>
            <button type="button" className="btn-secondary text-xs" onClick={() => setStep("a2p-brand")}>A2P Brand</button>
            <button type="button" className="btn-secondary text-xs" onClick={() => setStep("a2p-campaign")}>A2P Campaign</button>
            <button type="button" className="btn-secondary text-xs" onClick={() => setStep("form")}>Edit credentials</button>
          </div>
        </details>

        <p className="text-sm text-neutral-700">
          When your A2P Brand AND Campaign both show <strong>Approved</strong> in Trust Hub, and your number is attached to the Messaging Service&apos;s Sender Pool, click below to send a real verification SMS.
        </p>

        <p className="text-xs text-neutral-500">
          Your Telegram / ntfy / Discord / email channels keep working in the meantime. Nothing breaks.
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
        <h2 className="text-xl font-semibold">Step 12: Enter the code</h2>
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
          Didn&apos;t arrive? Check the recipient&apos;s in Verified Caller IDs (trial) and verify A2P shows Approved.
        </p>
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
          ✅ SMS channel verified. Deal alerts will text <strong>{phone}</strong> from <strong>{fromNumber}</strong>.
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
