// /admin/setup — deployer wizard. Runs live checks at the top, then renders
// interactive forms (server actions) that finish configuration.

import { runAllChecks, docsLink, type Check, type CheckStatus } from "@/lib/admin-checks";
import {
  populateVaultAction,
  setupTelegramAction,
  setProjectSecretsAction,
  setAuthRedirectsAction,
  triggerWorkflowAction,
} from "@/lib/admin-actions";
import { ActionForm } from "@/components/admin/action-form";
import { AdminTelegramSetup } from "@/components/admin/telegram-setup";
import { AdminPushoverSetup } from "@/components/admin/pushover-setup";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

export const dynamic = "force-dynamic";

export default async function AdminSetupPage() {
  const checks = await runAllChecks();
  const summary = countByStatus(checks);
  const allGreen = summary.fail === 0 && summary.warn === 0 && summary.unknown === 0;

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? "https";
  const siteUrlGuess = host ? `${proto}://${host}` : "";

  async function refresh(): Promise<void> {
    "use server";
    revalidatePath("/admin/setup");
  }

  return (
    <div className="space-y-8">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Setup wizard</h1>
          <p className="text-sm text-neutral-600 mt-1 max-w-prose">
            Live checks + interactive forms to finish configuring your deployment. Run the actions below in order, top to bottom. Each one re-runs the checks at the top.
          </p>
        </div>
        <form action={refresh}>
          <button
            type="submit"
            className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-neutral-50"
          >
            Re-run checks
          </button>
        </form>
      </header>

      <section className={`card p-5 flex items-center gap-4 ${allGreen ? "border-emerald-300 bg-emerald-50" : ""}`}>
        <Indicator status={allGreen ? "pass" : (summary.fail > 0 ? "fail" : "warn")} size="lg" />
        <div className="min-w-0">
          <div className="font-semibold">
            {allGreen ? "All systems go" : "Setup incomplete"}
          </div>
          <div className="text-sm text-neutral-600">
            {summary.pass} passing · {summary.warn} warnings · {summary.fail} failing · {summary.unknown} skipped
          </div>
        </div>
      </section>

      <Group title="Live checks">
        <ol className="space-y-3">
          {checks.map((c) => <CheckRow key={c.id} check={c} />)}
        </ol>
      </Group>

      <Group title="1. Database setup" description="Run these once per deployment to get the schema in shape.">
        <ActionForm
          title="Populate vault"
          description="Stores notifier_url and service_role_key in Supabase Vault so the alert-match trigger can call the notifier function. Idempotent — safe to re-run."
          action={populateVaultAction}
          fields={[]}
          submitLabel="Populate vault now"
          singleButton
        />

        <ActionForm
          title="Apply migrations"
          description="Triggers the db-migrate GitHub workflow on main. Only needed if migrations were added since your last deploy. Requires GITHUB_REPO + GITHUB_TOKEN env vars."
          action={triggerWorkflowAction}
          fields={[
            { name: "workflow", label: "Workflow", defaultValue: "db-migrate.yml", required: true, help: "Don't change unless you renamed the workflow." },
          ]}
          submitLabel="Trigger db-migrate.yml"
        />

        <ActionForm
          title="Redeploy edge functions"
          description="Triggers the deploy-functions GitHub workflow. Same env-var requirements."
          action={triggerWorkflowAction}
          fields={[
            { name: "workflow", label: "Workflow", defaultValue: "deploy-functions.yml", required: true },
          ]}
          submitLabel="Trigger deploy-functions.yml"
        />
      </Group>

      <Group title="2. Auth redirect URLs" description="Tell Supabase about your Vercel domain so magic-link sign-in actually works.">
        <ActionForm
          title="Configure Site URL + redirect allowlist"
          description="Sets site_url to your dashboard origin and adds /auth/callback to the allow list."
          action={setAuthRedirectsAction}
          fields={[
            { name: "site_url", label: "Dashboard URL", placeholder: "https://your-app.vercel.app", required: true, defaultValue: siteUrlGuess, help: "Auto-detected from this request — change if your custom domain differs." },
          ]}
          submitLabel="Save auth URLs"
        />
      </Group>

      <Group title="3. Notification channels" description="Set up each channel you want to support. Skip what you don't need.">
        <AdminTelegramSetup action={setupTelegramAction} />

        <AdminPushoverSetup action={setProjectSecretsAction} />

        <section className="card p-5 space-y-1 bg-neutral-50">
          <h3 className="font-semibold text-sm text-neutral-700">Twilio SMS &amp; Resend Email — per-user</h3>
          <p className="text-xs text-neutral-600">
            These channels were moved to per-user setup. Each user signs up for their own Twilio / Resend
            account in the user wizard at <code className="bg-white px-1 rounded">/setup</code> — they get
            billed for their own usage, you don&apos;t pay anything. No admin action needed.
          </p>
        </section>
      </Group>

      <footer className="text-xs text-neutral-500 pt-4 border-t border-neutral-200 space-y-1">
        <p>Need the full walkthrough? <a className="underline" href={docsLink()} target="_blank" rel="noreferrer">docs/self-hosting.md</a></p>
        <p>Some checks/actions require extra env vars: <code>SUPABASE_SERVICE_ROLE_KEY</code>, <code>SUPABASE_ACCESS_TOKEN</code>, <code>ADMIN_EMAILS</code>, and (for workflow triggers) <code>GITHUB_TOKEN</code> + <code>GITHUB_REPO</code>.</p>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function Group({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      {description && <p className="text-sm text-neutral-600">{description}</p>}
      {children}
    </section>
  );
}

function ChannelSecretForm({ title, fields }: { title: string; fields: { name: string; label: string; placeholder?: string; type?: "text" | "password"; required?: boolean; help?: string }[] }) {
  return (
    <ActionForm
      title={title}
      description="Sets the listed Supabase edge function secrets via the Management API."
      action={setProjectSecretsAction}
      fields={fields}
      submitLabel="Save secrets"
    />
  );
}

function countByStatus(checks: Check[]): Record<CheckStatus, number> {
  const out: Record<CheckStatus, number> = { pass: 0, fail: 0, warn: 0, unknown: 0 };
  for (const c of checks) out[c.status]++;
  return out;
}

function CheckRow({ check }: { check: Check }) {
  return (
    <li className="card p-4 flex gap-4 items-start">
      <Indicator status={check.status} />
      <div className="flex-1 min-w-0">
        <div className="font-medium">{check.label}</div>
        <div className="text-sm text-neutral-600 mt-0.5 break-words">{check.message}</div>
      </div>
      {check.fixAnchor && check.status !== "pass" && (
        <a
          href={docsLink(check.fixAnchor)}
          target="_blank"
          rel="noreferrer"
          className="text-sm text-blue-700 underline self-center shrink-0"
        >
          How to fix
        </a>
      )}
    </li>
  );
}

function Indicator({ status, size = "md" }: { status: CheckStatus; size?: "md" | "lg" }) {
  const colors: Record<CheckStatus, string> = {
    pass:    "bg-emerald-500",
    warn:    "bg-amber-400",
    fail:    "bg-red-500",
    unknown: "bg-neutral-300",
  };
  const labels: Record<CheckStatus, string> = {
    pass: "OK", warn: "!", fail: "X", unknown: "?",
  };
  const dim = size === "lg" ? "w-10 h-10 text-sm" : "w-7 h-7 text-xs";
  return (
    <span
      aria-label={status}
      className={`${dim} ${colors[status]} text-white font-bold rounded-full flex items-center justify-center shrink-0`}
    >
      {labels[status]}
    </span>
  );
}
