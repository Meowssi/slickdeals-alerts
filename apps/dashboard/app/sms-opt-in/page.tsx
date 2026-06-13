import { headers } from "next/headers";
import Link from "next/link";

export const dynamic = "force-dynamic";

/**
 * Public reference page satisfying A2P 10DLC "Web form opt-in" requirements
 * for carrier campaign registration. Carrier/provider reviewers need a
 * publicly-accessible URL showing exactly how end-users opt in to SMS,
 * including the consent checkbox, frequency disclosure, HELP/STOP
 * instructions, and links to Terms + Privacy.
 *
 * The real signup happens in the authenticated /setup wizard. This page
 * is a static mirror of that form's UI for compliance reference — it
 * does not actually submit anywhere; the "Yes, sign me up!" button
 * routes to /login so a new user can register and reach the real form.
 *
 * ⚠️  SERVER COMPONENT — do NOT add event handlers (onSubmit/onChange/…)
 * to any element here. Passing a function to a host element in an RSC
 * throws at render time; the page then streams as a blank shell (HTTP
 * 200 with no form), causing the campaign to be rejected for an
 * unverifiable Call-to-Action. Keep this page 100% static markup.
 */
export default async function SmsOptInPage() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "this dashboard";

  return (
    <main className="min-h-screen bg-neutral-50 py-10 px-4">
      <div className="mx-auto max-w-2xl space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold">SMS opt-in</h1>
          <p className="text-sm text-neutral-600">
            Sign up to receive Slickdeals deal alerts by text message. The form below mirrors what you&apos;ll see
            in the authenticated dashboard&apos;s setup wizard after sign-in.
          </p>
        </header>

        <div className="card p-6 space-y-4">
          <h2 className="font-semibold">Slickdeals Alerts SMS subscription</h2>

          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1" htmlFor="phone">
              Mobile phone number <span className="text-red-600">*</span>
            </label>
            <input
              id="phone"
              type="tel"
              inputMode="tel"
              placeholder="(555) 123-4567"
              className="input"
            />
          </div>

          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" />
            <span>
              Yes, I&apos;d like to receive automated SMS deal alerts from Slickdeals Alerts when the saved Slickdeals
              searches I configure on my dashboard match new deals. I understand frequency varies based on my own
              alert settings.
            </span>
          </label>

          <div className="text-xs text-neutral-700 space-y-2 border-t border-neutral-100 pt-3">
            <p>
              <strong>Message frequency:</strong> Variable. Depends entirely on how many of <em>your</em> saved Slickdeals
              searches match new deals. Typically a handful per day, can be more during active sales.
            </p>
            <p>
              <strong>Standard rates:</strong> Message and data rates may apply depending on your mobile carrier and plan.
            </p>
            <p>
              <strong>HELP / STOP:</strong> Reply <code className="bg-neutral-100 px-1 rounded">HELP</code> for help.
              Reply <code className="bg-neutral-100 px-1 rounded">STOP</code> at any time to unsubscribe — no further messages
              will be sent.
            </p>
            <p>
              By providing your phone number and checking the box above, you agree to receive text messages from this
              deployment of Slickdeals Alerts. <strong>Consent is not required to make any purchase.</strong> You may
              also stop messages any time by signing into your dashboard and disabling the SMS channel from Settings.
            </p>
            <p>
              <Link href="/terms" className="underline">Terms of Service</Link> ·{" "}
              <Link href="/privacy" className="underline">Privacy Policy</Link>
            </p>
          </div>

          <Link
            href="/login"
            className="block w-full text-center btn-primary"
          >
            Yes, sign me up!
          </Link>
          <p className="text-xs text-neutral-500 text-center">
            Clicking the button takes you to sign-in. After signing in you&apos;ll complete this same form (with verification)
            from the dashboard&apos;s setup wizard.
          </p>
        </div>

        <details className="text-xs text-neutral-500">
          <summary className="cursor-pointer">For A2P/carrier reviewers</summary>
          <div className="mt-2 space-y-2">
            <p>
              This deployment is a self-hosted instance of{" "}
              <a className="underline" href="https://github.com/Meowssi/slickdeals-alerts" target="_blank" rel="noreferrer">
                slickdeals-alerts
              </a>{" "}
              running at <code className="bg-neutral-100 px-1 rounded">{host}</code>.
            </p>
            <p>
              <strong>Opt-in flow:</strong> The end-user (also the deployer of the instance) signs into the dashboard,
              navigates to Settings → Add Channel → SMS, enters their own phone number, checks a consent checkbox,
              receives a 6-digit verification code by SMS, and enters it back into the dashboard to complete double opt-in.
              The verification code SMS is the first message the provider sends to confirm the user controls the number.
            </p>
            <p>
              <strong>Audience:</strong> Personal-use only. Recipient is the same individual operating the deployment.
              No third-party mailing list, no marketing distribution, no data sharing.
            </p>
            <p>
              <strong>Privacy + Terms:</strong>{" "}
              <Link className="underline" href="/privacy">/privacy</Link> · <Link className="underline" href="/terms">/terms</Link>
            </p>
          </div>
        </details>
      </div>
    </main>
  );
}
