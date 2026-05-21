"use client";

import { useFormState, useFormStatus } from "react-dom";
import type { ActionResult } from "@/lib/admin-actions";
import type { ComponentProps } from "react";

interface Props {
  state: "off" | "on";
  qrDataUrl: string | null;
  pendingSecret: string | null;
  enableAction: (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  disableAction: (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;
}

export function AdminTotpSetup({ state, qrDataUrl, pendingSecret, enableAction, disableAction }: Props) {
  const [enableResult, enableForm] = useFormState<ActionResult | null, FormData>(enableAction, null);
  const [disableResult, disableForm] = useFormState<ActionResult | null, FormData>(disableAction, null);

  if (state === "on") {
    return (
      <section className="card p-5 space-y-4 border-emerald-200 bg-emerald-50">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="font-semibold">2FA: enabled ✓</h3>
            <p className="text-sm text-emerald-900 mt-1">
              Admin pages require a 6-digit code from your authenticator app. Nice.
            </p>
          </div>
          <form action={disableForm}>
            <Submit label="Disable 2FA" intent="danger" />
          </form>
        </div>
        {disableResult && (
          <p className={`text-sm ${disableResult.ok ? "text-emerald-700" : "text-red-700"}`}>
            {disableResult.ok ? "✓" : "✗"} {disableResult.message}
          </p>
        )}
      </section>
    );
  }

  return (
    <section className="card p-5 space-y-4">
      <header>
        <h3 className="font-semibold">Admin 2FA (recommended)</h3>
        <p className="text-sm text-neutral-600 mt-1">
          Adds a TOTP gate to every <code className="bg-neutral-100 px-1 rounded">/admin/*</code> page.
          You scan a QR code into Google Authenticator (or Authy / 1Password / any TOTP app),
          and from then on the admin pages require the rotating 6-digit code from your phone.
        </p>
      </header>

      {qrDataUrl && pendingSecret ? (
        <div className="space-y-3">
          <ol className="space-y-2 text-sm text-neutral-700">
            <li><strong>1.</strong> Open your authenticator app and scan the QR below.</li>
            <li><strong>2.</strong> Enter the 6-digit code the app shows to confirm.</li>
            <li><strong>3.</strong> We&apos;ll save the secret in Supabase Vault. The same QR works across redeploys.</li>
          </ol>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qrDataUrl} alt="TOTP QR code" className="border border-neutral-200 rounded mx-auto" />
          <details className="text-xs text-neutral-600">
            <summary className="cursor-pointer">Can&apos;t scan? Enter secret manually</summary>
            <code className="block mt-1 bg-neutral-50 p-2 rounded font-mono break-all">{pendingSecret}</code>
          </details>

          <form action={enableForm} className="space-y-2">
            <input type="hidden" name="pending_secret" value={pendingSecret} />
            <label className="block text-sm font-medium text-neutral-700">Code from your app</label>
            <input
              type="text"
              name="code"
              required
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              placeholder="123456"
              autoComplete="off"
              className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-lg text-center tracking-widest font-mono focus:border-blue-500 focus:outline-none"
            />
            <Submit label="Confirm and enable 2FA" />
            {enableResult && (
              <p className={`text-sm ${enableResult.ok ? "text-emerald-700" : "text-red-700"}`}>
                {enableResult.ok ? "✓" : "✗"} {enableResult.message}
              </p>
            )}
          </form>
        </div>
      ) : (
        <form action={enableForm}>
          <Submit label="Generate QR code" />
          {enableResult && (
            <p className={`text-sm mt-2 ${enableResult.ok ? "text-emerald-700" : "text-red-700"}`}>
              {enableResult.ok ? "✓" : "✗"} {enableResult.message}
            </p>
          )}
        </form>
      )}
    </section>
  );
}

function Submit({ label, intent }: { label: string; intent?: "danger" }) {
  const { pending } = useFormStatus();
  const base = "rounded-md text-sm font-medium px-4 py-1.5 disabled:opacity-50";
  const className =
    intent === "danger"
      ? `${base} border border-red-300 text-red-700 hover:bg-red-50`
      : `${base} bg-neutral-900 text-white hover:bg-neutral-800`;
  return (
    <button type="submit" disabled={pending} className={className}>
      {pending ? "Working…" : label}
    </button>
  );
}

// Re-export so /admin/setup/page.tsx can pass the right type. (TS convenience.)
export type AdminTotpSetupProps = ComponentProps<typeof AdminTotpSetup>;
