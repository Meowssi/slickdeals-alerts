"use server";

// Server actions invoked from /admin/setup forms. Each runs with full server
// env access (service role + access token). Never import these from client
// components — the "use server" directive lets them be passed as form actions.

import "server-only";
import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { projectRef } from "@/lib/admin-checks";

const MANAGEMENT_API = "https://api.supabase.com";

export interface ActionResult {
  ok: boolean;
  message: string;
}

// ---------------------------------------------------------------------------
// Bootstrap actions
// ---------------------------------------------------------------------------

/** Populate vault with notifier_url + service_role_key. Idempotent. */
export async function populateVaultAction(_prev: ActionResult | null, _formData: FormData): Promise<ActionResult> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const ref = projectRef();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !ref || !serviceKey) {
    return errResult("Missing env vars: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  const notifierUrl = `https://${ref}.functions.supabase.co/notifier`;

  const supa = supabaseAdmin();

  // Wipe any stale entries first (vault names are unique).
  await supa.rpc("admin_upsert_vault_secret", { p_name: "notifier_url",     p_value: notifierUrl });
  await supa.rpc("admin_upsert_vault_secret", { p_name: "service_role_key", p_value: serviceKey });

  revalidatePath("/admin/setup");
  return okResult("Vault populated. The match-notify trigger can now reach the notifier function.");
}

/** Set Supabase project secrets via the Management API. Existing values are overwritten; absent keys are removed only if the value is the empty string. */
export async function setProjectSecretsAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ref = projectRef();
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!ref || !token) return errResult("Missing SUPABASE_ACCESS_TOKEN env var (or NEXT_PUBLIC_SUPABASE_URL to derive the project ref).");

  const payload: Array<{ name: string; value: string }> = [];
  for (const [k, v] of formData.entries()) {
    if (typeof v !== "string") continue;
    if (!k || v.length === 0) continue;
    payload.push({ name: k, value: v });
  }
  if (payload.length === 0) return errResult("No secrets in the form.");

  const res = await fetch(`${MANAGEMENT_API}/v1/projects/${ref}/secrets`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return errResult(`Management API ${res.status}: ${body.slice(0, 200)}`);
  }

  revalidatePath("/admin/setup");
  return okResult(`Set ${payload.length} secret(s): ${payload.map((p) => p.name).join(", ")}.`);
}

/** Register the Telegram webhook with our telegram-webhook edge function. */
export async function registerTelegramWebhookAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const token  = string(formData.get("telegram_bot_token"));
  const secret = string(formData.get("telegram_webhook_secret"));
  const ref    = projectRef();
  if (!token || !secret) return errResult("Telegram bot token and webhook secret are both required.");
  if (!ref) return errResult("Couldn't derive project ref from NEXT_PUBLIC_SUPABASE_URL.");

  const url = `https://${ref}.functions.supabase.co/telegram-webhook?secret=${encodeURIComponent(secret)}`;
  const res = await fetch(
    `https://api.telegram.org/bot${token}/setWebhook`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, allowed_updates: ["message", "callback_query"] }),
    },
  );
  const body = await res.json().catch(() => ({})) as { ok?: boolean; description?: string };
  if (!body.ok) return errResult(`Telegram setWebhook: ${body.description ?? res.status}`);

  revalidatePath("/admin/setup");
  return okResult(`Webhook registered at ${url}`);
}

/** Combined: paste Telegram token+username, generate a webhook secret if missing, save as project secrets, register webhook. One click. */
export async function setupTelegramAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const token    = string(formData.get("token"));
  const username = string(formData.get("username")).replace(/^@/, "");
  let   secret   = string(formData.get("webhook_secret"));
  if (!token)    return errResult("Bot token is required (from BotFather).");
  if (!username) return errResult("Bot username is required.");
  if (!secret)   secret = generateWebhookSecret();

  // 1. Save the three secrets in Supabase.
  const secretsForm = new FormData();
  secretsForm.set("TELEGRAM_BOT_TOKEN",      token);
  secretsForm.set("TELEGRAM_BOT_USERNAME",   username);
  secretsForm.set("TELEGRAM_WEBHOOK_SECRET", secret);
  const setResult = await setProjectSecretsAction(null, secretsForm);
  if (!setResult.ok) return setResult;

  // 2. Register the webhook with Telegram.
  const webhookForm = new FormData();
  webhookForm.set("telegram_bot_token",      token);
  webhookForm.set("telegram_webhook_secret", secret);
  const hookResult = await registerTelegramWebhookAction(null, webhookForm);
  if (!hookResult.ok) {
    return errResult(`Saved secrets, but webhook registration failed: ${hookResult.message}`);
  }

  return okResult(`Telegram is live. Bot username: @${username}. Webhook secret saved.`);
}

/** Trigger a GitHub Actions workflow_dispatch (used for migrations + function deploys without leaving the dashboard). */
export async function triggerWorkflowAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const repo = process.env.GITHUB_REPO; // "Meowssi/slickdeals-alerts"
  const ghToken = process.env.GITHUB_TOKEN;
  if (!repo || !ghToken) {
    return errResult("Set GITHUB_REPO and GITHUB_TOKEN env vars (needs repo+workflow scope) to trigger workflows from the wizard.");
  }
  const workflow = string(formData.get("workflow")); // e.g. "deploy-functions.yml"
  if (!workflow) return errResult("Missing workflow filename.");

  const inputs: Record<string, string> = {};
  if (workflow === "db-migrate.yml") inputs.confirm = "yes";

  const res = await fetch(
    `https://api.github.com/repos/${repo}/actions/workflows/${workflow}/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ghToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref: "main", inputs }),
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return errResult(`GitHub API ${res.status}: ${body.slice(0, 200)}`);
  }
  return okResult(`Triggered ${workflow} on main. Check the Actions tab for progress (≈ 30-60 s).`);
}

/** Configure Supabase auth Site URL + redirect URLs so magic-link sign-in works. */
export async function setAuthRedirectsAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ref   = projectRef();
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!ref || !token) return errResult("Missing SUPABASE_ACCESS_TOKEN env var (or NEXT_PUBLIC_SUPABASE_URL to derive the project ref).");

  const siteUrl = string(formData.get("site_url")).replace(/\/$/, "");
  if (!siteUrl) return errResult("Site URL is required.");

  const res = await fetch(
    `${MANAGEMENT_API}/v1/projects/${ref}/config/auth`,
    {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        site_url: siteUrl,
        uri_allow_list: `${siteUrl}/auth/callback,${siteUrl}/**`,
      }),
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return errResult(`Management API ${res.status}: ${body.slice(0, 200)}`);
  }
  revalidatePath("/admin/setup");
  return okResult(`Site URL set to ${siteUrl}. Magic-link sign-in should now work.`);
}

/** Send a test notification through one of the user's verified channels. */
export async function sendTestAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const channelId = string(formData.get("channel_id"));
  if (!channelId) return errResult("Pick a channel first.");

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return errResult("Missing Supabase env vars.");

  const res = await fetch(`${url}/functions/v1/send-test`, {
    method: "POST",
    headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ channel_id: channelId }),
  });
  const body = await res.json().catch(() => ({})) as { ok?: boolean; error?: string };
  if (!body.ok) return errResult(`Test failed: ${body.error ?? res.status}`);
  return okResult("Test sent. Check the channel.");
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function string(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}

function okResult(message: string): ActionResult  { return { ok: true,  message }; }
function errResult(message: string): ActionResult { return { ok: false, message }; }

function generateWebhookSecret(): string {
  // 32 bytes = 256 bits of entropy as hex.
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}
