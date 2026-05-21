"use client";

import { useFormState, useFormStatus } from "react-dom";
import type { ActionResult } from "@/lib/admin-actions";

export function AdminPushoverSetup({
  action,
}: {
  action: (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;
}) {
  const [result, formAction] = useFormState<ActionResult | null, FormData>(action, null);

  return (
    <section className="card p-5 space-y-4">
      <header>
        <h3 className="font-semibold">Pushover (optional)</h3>
        <p className="text-sm text-neutral-600 mt-1">
          Free for you — register one Pushover &quot;Application&quot; and any user can connect. Users pay $5 to Pushover for their own device, not to you.
        </p>
      </header>

      <ol className="space-y-3 text-sm">
        <li className="flex gap-3">
          <span className="shrink-0 w-6 h-6 rounded-full bg-neutral-900 text-white text-xs font-bold flex items-center justify-center">1</span>
          <div>
            <p className="font-medium text-neutral-800">Sign up at Pushover (free)</p>
            <a href="https://pushover.net/signup" target="_blank" rel="noreferrer" className="inline-block mt-1 text-blue-700 underline text-sm">Open pushover.net/signup →</a>
            <p className="text-xs text-neutral-500 mt-0.5">Skip this step if you already have a Pushover account.</p>
          </div>
        </li>

        <li className="flex gap-3">
          <span className="shrink-0 w-6 h-6 rounded-full bg-neutral-900 text-white text-xs font-bold flex items-center justify-center">2</span>
          <div>
            <p className="font-medium text-neutral-800">Register an application</p>
            <a href="https://pushover.net/apps/build" target="_blank" rel="noreferrer" className="inline-block mt-1 text-blue-700 underline text-sm">Open pushover.net/apps/build →</a>
            <p className="text-xs text-neutral-600 mt-1">Fill out the form:</p>
            <ul className="text-xs text-neutral-600 mt-1 ml-3 list-disc list-inside space-y-0.5">
              <li><strong>Name</strong>: anything (e.g., &quot;Slickdeals Alerts&quot;)</li>
              <li><strong>Type</strong>: Application</li>
              <li><strong>Description</strong>: optional</li>
              <li><strong>URL</strong>: your dashboard URL (optional)</li>
              <li><strong>Icon</strong>: upload <code className="bg-neutral-100 px-1 rounded">docs/bot-assets/bot-pic.png</code> from the repo (optional)</li>
            </ul>
            <p className="text-xs text-neutral-500 mt-1">Submit. The next page shows your <strong>API Token/Key</strong> — copy it.</p>
          </div>
        </li>

        <li className="flex gap-3">
          <span className="shrink-0 w-6 h-6 rounded-full bg-neutral-900 text-white text-xs font-bold flex items-center justify-center">3</span>
          <div className="flex-1">
            <p className="font-medium text-neutral-800">Paste the token below</p>
            <p className="text-xs text-neutral-600 mt-0.5 mb-3">
              We&apos;ll save it as the <code className="bg-neutral-100 px-1 rounded">PUSHOVER_APP_TOKEN</code> Supabase function secret so the notifier can deliver via Pushover for any user.
            </p>

            <form action={formAction} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-neutral-700 mb-1" htmlFor="PUSHOVER_APP_TOKEN">
                  Pushover API Token <span className="text-red-600">*</span>
                </label>
                <input
                  id="PUSHOVER_APP_TOKEN"
                  name="PUSHOVER_APP_TOKEN"
                  type="password"
                  placeholder="a..."
                  required
                  autoComplete="off"
                  spellCheck={false}
                  className="w-full rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-mono placeholder:text-neutral-400 focus:border-blue-500 focus:outline-none"
                />
                <p className="text-[11px] text-neutral-500 mt-1">30 characters, starts with &quot;a&quot;.</p>
              </div>

              <div className="flex items-center gap-3 flex-wrap pt-1">
                <SubmitButton />
                {result && (
                  <span className={`text-sm ${result.ok ? "text-emerald-700" : "text-red-700"}`}>
                    {result.ok ? "✓" : "✗"} {result.message}
                  </span>
                )}
              </div>
            </form>
          </div>
        </li>
      </ol>
    </section>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-neutral-900 text-white text-sm font-medium px-4 py-1.5 hover:bg-neutral-800 disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {pending ? "Working…" : "Save Pushover token"}
    </button>
  );
}
