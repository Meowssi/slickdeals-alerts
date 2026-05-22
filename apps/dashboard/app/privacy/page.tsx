import { headers } from "next/headers";

export const dynamic = "force-dynamic";

export default async function PrivacyPage() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "this dashboard";

  return (
    <main className="min-h-screen bg-neutral-50 p-6">
      <div className="mx-auto max-w-2xl card p-8 space-y-4 text-sm text-neutral-700">
        <h1 className="text-2xl font-semibold">Privacy Policy</h1>
        <p className="text-xs text-neutral-500">Last updated: 2026-05-22</p>

        <h2 className="font-semibold text-base pt-2">Who runs this deployment</h2>
        <p>
          This is a self-hosted deployment of{" "}
          <a className="underline" href="https://github.com/Meowssi/slickdeals-alerts" target="_blank" rel="noreferrer">
            slickdeals-alerts
          </a>{" "}
          running at <code className="bg-neutral-100 px-1 rounded text-xs">{host}</code>.
          It is operated personally — there is no company, marketing list, or commercial entity behind it.
        </p>

        <h2 className="font-semibold text-base pt-2">What information we collect</h2>
        <ul className="list-disc list-inside space-y-1">
          <li>Email address (for sign-in)</li>
          <li>Phone number you optionally register as a notification recipient</li>
          <li>RSS feed URLs you configure as alerts</li>
          <li>Records of deals matched against your alerts</li>
          <li>Channel credentials you paste in (Twilio SID/token, etc.) — encrypted at rest in our database</li>
        </ul>

        <h2 className="font-semibold text-base pt-2">How we use it</h2>
        <p>
          We use it solely to deliver the notifications you signed up for. <strong>Mobile phone numbers are never shared with third parties</strong> for any purpose.
        </p>

        <h2 className="font-semibold text-base pt-2">Message frequency &amp; data rates</h2>
        <p>
          Message frequency varies based on how many of your saved Slickdeals searches match new deals — typically a few per day, sometimes a few per hour during sales.
          <strong> Message and data rates may apply.</strong> Standard carrier charges from your mobile provider are your responsibility.
        </p>

        <h2 className="font-semibold text-base pt-2">Opt-out</h2>
        <p>
          You can stop notifications any time by:
        </p>
        <ul className="list-disc list-inside space-y-1">
          <li>Disabling the channel from your dashboard&apos;s Settings page, or</li>
          <li>Replying <strong>STOP</strong> to any SMS, or</li>
          <li>Deleting your account</li>
        </ul>

        <h2 className="font-semibold text-base pt-2">Third-party services</h2>
        <p>
          To deliver notifications, we route messages through providers you configure (Twilio for SMS, Telegram for chat, Resend for email, etc.).
          Each is subject to its own privacy policy. We do not sell or share your data with anyone else.
        </p>

        <h2 className="font-semibold text-base pt-2">Contact</h2>
        <p>
          Questions about this policy? File an issue at{" "}
          <a className="underline" href="https://github.com/Meowssi/slickdeals-alerts/issues" target="_blank" rel="noreferrer">
            github.com/Meowssi/slickdeals-alerts/issues
          </a>.
        </p>
      </div>
    </main>
  );
}
