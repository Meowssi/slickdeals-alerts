"use client";

import { useFormState, useFormStatus } from "react-dom";
import type { ActionResult } from "@/lib/admin-actions";

export function AdminTelegramSetup({
  action,
}: {
  action: (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;
}) {
  const [result, formAction] = useFormState<ActionResult | null, FormData>(action, null);

  return (
    <section className="card p-5 space-y-4">
      <header>
        <h3 className="font-semibold">Telegram bot (recommended)</h3>
        <p className="text-sm text-neutral-600 mt-1">
          One-time setup. Once done, any user on this deployment can connect their Telegram chat from
          the user wizard.
        </p>
      </header>

      <ol className="space-y-3 text-sm">
        <li className="flex gap-3">
          <span className="shrink-0 w-6 h-6 rounded-full bg-neutral-900 text-white text-xs font-bold flex items-center justify-center">1</span>
          <div>
            <p className="font-medium text-neutral-800">Open BotFather</p>
            <p className="text-neutral-600 text-xs mt-0.5">Click below to open the official bot-creation bot in Telegram (or copy the URL into Telegram&apos;s search).</p>
            <a
              href="https://t.me/BotFather"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 mt-2 text-blue-700 underline text-sm"
            >
              Open @BotFather →
            </a>
          </div>
        </li>

        <li className="flex gap-3">
          <span className="shrink-0 w-6 h-6 rounded-full bg-neutral-900 text-white text-xs font-bold flex items-center justify-center">2</span>
          <div>
            <p className="font-medium text-neutral-800">Send <code className="bg-neutral-100 px-1 rounded">/newbot</code></p>
            <p className="text-neutral-600 text-xs mt-0.5">BotFather will ask for:</p>
            <ul className="text-neutral-600 text-xs mt-1 ml-3 list-disc list-inside space-y-0.5">
              <li>A <strong>name</strong> for the bot (any string, e.g. &quot;My Deal Alerts&quot;)</li>
              <li>A <strong>username</strong> (must end in <code className="bg-neutral-100 px-1 rounded">bot</code>, e.g. <code className="bg-neutral-100 px-1 rounded">mydealsbot</code>)</li>
            </ul>
          </div>
        </li>

        <li className="flex gap-3">
          <span className="shrink-0 w-6 h-6 rounded-full bg-neutral-900 text-white text-xs font-bold flex items-center justify-center">3</span>
          <div>
            <p className="font-medium text-neutral-800">Copy the token</p>
            <p className="text-neutral-600 text-xs mt-0.5">
              BotFather replies with a token formatted like{" "}
              <code className="bg-neutral-100 px-1 rounded font-mono">123456789:AAHcAbCdEfGhIjK...</code>.
              Copy the entire string. Treat it like a password — keep it secret.
            </p>
          </div>
        </li>

        <li className="flex gap-3">
          <span className="shrink-0 w-6 h-6 rounded-full bg-neutral-900 text-white text-xs font-bold flex items-center justify-center">4</span>
          <div className="flex-1">
            <p className="font-medium text-neutral-800">Paste both below and submit</p>
            <p className="text-neutral-600 text-xs mt-0.5 mb-3">
              We&apos;ll save the token + username as Supabase function secrets, generate a webhook secret,
              and register the webhook with Telegram in one click.
            </p>

            <form action={formAction} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-neutral-700 mb-1" htmlFor="token">
                  Bot token (from BotFather) <span className="text-red-600">*</span>
                </label>
                <input
                  id="token"
                  name="token"
                  type="password"
                  placeholder="123456789:AAH..."
                  required
                  autoComplete="off"
                  spellCheck={false}
                  className="w-full rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-mono placeholder:text-neutral-400 focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-700 mb-1" htmlFor="username">
                  Bot username (without @) <span className="text-red-600">*</span>
                </label>
                <input
                  id="username"
                  name="username"
                  type="text"
                  placeholder="mydealsbot"
                  required
                  autoComplete="off"
                  spellCheck={false}
                  className="w-full rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-mono placeholder:text-neutral-400 focus:border-blue-500 focus:outline-none"
                />
                <p className="text-[11px] text-neutral-500 mt-1">
                  Just the part before &quot;.t.me&quot; — no @ sign.
                </p>
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-700 mb-1" htmlFor="webhook_secret">
                  Webhook secret <span className="text-neutral-400 font-normal">(leave blank to auto-generate)</span>
                </label>
                <input
                  id="webhook_secret"
                  name="webhook_secret"
                  type="text"
                  placeholder="auto-generated 64-char hex if blank"
                  autoComplete="off"
                  spellCheck={false}
                  className="w-full rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-mono placeholder:text-neutral-400 focus:border-blue-500 focus:outline-none"
                />
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
      {pending ? "Working…" : "Set up Telegram bot"}
    </button>
  );
}
