import { headers } from "next/headers";

export const dynamic = "force-dynamic";

export default async function TermsPage() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "this dashboard";

  return (
    <main className="min-h-screen bg-neutral-50 p-6">
      <div className="mx-auto max-w-2xl card p-8 space-y-4 text-sm text-neutral-700">
        <h1 className="text-2xl font-semibold">Terms of Service</h1>
        <p className="text-xs text-neutral-500">Last updated: 2026-05-22</p>

        <p>
          This is a self-hosted deployment of{" "}
          <a className="underline" href="https://github.com/Meowssi/slickdeals-alerts" target="_blank" rel="noreferrer">
            slickdeals-alerts
          </a>{" "}
          (MIT-licensed open source) running at <code className="bg-neutral-100 px-1 rounded text-xs">{host}</code>.
          Use of this dashboard is governed by these terms.
        </p>

        <h2 className="font-semibold text-base pt-2">What this service does</h2>
        <p>
          The dashboard polls public Slickdeals RSS feeds on your behalf and notifies you (via channels you configure) when matching deals appear. It does not interact with Slickdeals beyond fetching their publicly-published RSS feeds.
        </p>

        <h2 className="font-semibold text-base pt-2">Your responsibilities</h2>
        <ul className="list-disc list-inside space-y-1">
          <li>Keep your account credentials private.</li>
          <li>Only register phone numbers and email addresses that you control or have explicit permission to send notifications to.</li>
          <li>Comply with the terms of any third-party services you connect (Twilio, Telegram, Discord, Pushover, ntfy, Resend, etc.) — including their messaging volume, opt-out, and content policies.</li>
          <li>Don&apos;t use this service to send anything you wouldn&apos;t be willing to receive yourself.</li>
        </ul>

        <h2 className="font-semibold text-base pt-2">Message frequency &amp; data rates</h2>
        <p>
          The number of messages you receive depends entirely on how many of your saved Slickdeals searches match new deals. Volume can range from zero to dozens per day.
          <strong> Message and data rates may apply.</strong>
        </p>

        <h2 className="font-semibold text-base pt-2">Opt-out</h2>
        <p>
          You can stop notifications any time by disabling the relevant channel in Settings, replying <strong>STOP</strong> to an SMS, or deleting your account.
        </p>

        <h2 className="font-semibold text-base pt-2">Warranty disclaimer</h2>
        <p>
          The service is provided &quot;as is&quot; without any warranty. Deals may be missed, notifications may be delayed, and Slickdeals listings may be inaccurate. Decisions to purchase are your own.
        </p>

        <h2 className="font-semibold text-base pt-2">Changes</h2>
        <p>
          These terms may be updated at any time. Continued use of the service after a change constitutes acceptance.
        </p>

        <h2 className="font-semibold text-base pt-2">Contact</h2>
        <p>
          Questions or issues? File an issue at{" "}
          <a className="underline" href="https://github.com/Meowssi/slickdeals-alerts/issues" target="_blank" rel="noreferrer">
            github.com/Meowssi/slickdeals-alerts/issues
          </a>.
        </p>
      </div>
    </main>
  );
}
