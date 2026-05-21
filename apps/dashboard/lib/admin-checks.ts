// Health checks run from the /admin/setup page. Each returns a Check with a
// red/green status and a deep link to the relevant section of self-hosting.md.
//
// All checks are server-only (use service-role key + access token from env).
import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

export type CheckStatus = "pass" | "fail" | "warn" | "unknown";

export interface Check {
  /** Stable id for keys/aria. */
  id: string;
  /** Human-readable label. */
  label: string;
  status: CheckStatus;
  /** One-line message shown under the label. */
  message: string;
  /** Anchor in docs/self-hosting.md that explains the fix. */
  fixAnchor?: string;
}

const DOCS_BASE = "https://github.com/Meowssi/slickdeals-alerts/blob/main/docs/self-hosting.md";
const EXPECTED_FUNCTIONS = ["notifier", "telegram-webhook", "channel-verify", "send-test", "poll"];
const EXPECTED_VAULT_SECRETS = ["notifier_url", "service_role_key"];
// Bump when adding a new migration in supabase/migrations/.
const EXPECTED_MIGRATIONS = 12;

const MANAGEMENT_API = "https://api.supabase.com";

interface OptionalChannel {
  id: string;
  label: string;
  envVars: readonly string[];
}

const OPTIONAL_CHANNELS: readonly OptionalChannel[] = [
  { id: "telegram",   label: "Telegram",  envVars: ["TELEGRAM_BOT_TOKEN", "TELEGRAM_BOT_USERNAME", "TELEGRAM_WEBHOOK_SECRET"] },
  { id: "pushover",   label: "Pushover",  envVars: ["PUSHOVER_APP_TOKEN"] },
  // Twilio SMS and Resend Email are per-user (creds live in each channel's
  // notification_channels.config), so no global secrets to check.
];

/** Derive the Supabase project ref from the URL (or env override). */
export function projectRef(): string | undefined {
  if (process.env.SUPABASE_PROJECT_REF) return process.env.SUPABASE_PROJECT_REF;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return undefined;
  // https://<ref>.supabase.co/...
  const m = url.match(/https?:\/\/([^./]+)\.supabase\.co/i);
  return m?.[1];
}

export async function runAllChecks(): Promise<Check[]> {
  const ref = projectRef();
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN;

  const settled = await Promise.allSettled([
    checkMigrations(),
    checkFunctions(ref, accessToken),
    checkVault(),
    checkTelegramWebhook(),
    checkPollerHeartbeat(),
    checkOptionalChannels(ref, accessToken),
  ]);

  const out: Check[] = [];
  for (const r of settled) {
    if (r.status === "fulfilled") {
      if (Array.isArray(r.value)) out.push(...r.value);
      else out.push(r.value);
    } else {
      out.push({
        id: `error-${out.length}`,
        label: "Check crashed",
        status: "fail",
        message: String(r.reason).slice(0, 200),
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// individual checks
// ---------------------------------------------------------------------------

async function checkMigrations(): Promise<Check> {
  const supa = supabaseAdmin();
  // The supabase_migrations schema is internal; use a SQL function call.
  const { data, error } = await supa.rpc("count_schema_migrations").maybeSingle();
  if (!error && data != null) {
    const n = Number((data as { count?: number }).count ?? 0);
    return {
      id: "migrations",
      label: "Database migrations",
      status: n >= EXPECTED_MIGRATIONS ? "pass" : "fail",
      message: `${n} migrations applied (expected ≥ ${EXPECTED_MIGRATIONS}).`,
      fixAnchor: "phase-1--supabase-project",
    };
  }
  // Fallback: count rows in any of our domain tables to confirm SOMETHING is there.
  const { error: probe } = await supa.from("alerts").select("id", { count: "exact", head: true });
  if (!probe) {
    return {
      id: "migrations",
      label: "Database migrations",
      status: "warn",
      message: "Couldn't count migrations precisely, but `alerts` table exists. (Add a `count_schema_migrations` SQL function for a stricter check.)",
      fixAnchor: "phase-1--supabase-project",
    };
  }
  return {
    id: "migrations",
    label: "Database migrations",
    status: "fail",
    message: "Couldn't reach the database. Have migrations been applied?",
    fixAnchor: "phase-1--supabase-project",
  };
}

async function checkFunctions(
  ref: string | undefined,
  accessToken: string | undefined,
): Promise<Check> {
  if (!ref || !accessToken) {
    return {
      id: "functions",
      label: "Edge functions",
      status: "unknown",
      message: "Set SUPABASE_ACCESS_TOKEN env var to enable this check (we derive the project ref from NEXT_PUBLIC_SUPABASE_URL).",
      fixAnchor: "phase-5--dashboard-on-vercel",
    };
  }
  try {
    const res = await fetch(
      `${MANAGEMENT_API}/v1/projects/${ref}/functions`,
      { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" },
    );
    if (!res.ok) {
      return {
        id: "functions",
        label: "Edge functions",
        status: "fail",
        message: `Management API returned ${res.status}.`,
        fixAnchor: "phase-2--fork--github-secrets",
      };
    }
    const list = await res.json() as Array<{ slug: string; status: string }>;
    const active = new Set(list.filter((f) => f.status === "ACTIVE").map((f) => f.slug));
    const missing = EXPECTED_FUNCTIONS.filter((slug) => !active.has(slug));
    if (missing.length === 0) {
      return {
        id: "functions",
        label: "Edge functions",
        status: "pass",
        message: `All 4 functions ACTIVE: ${EXPECTED_FUNCTIONS.join(", ")}.`,
      };
    }
    return {
      id: "functions",
      label: "Edge functions",
      status: "fail",
      message: `Missing or inactive: ${missing.join(", ")}. Trigger the "Deploy edge functions" workflow.`,
      fixAnchor: "phase-2--fork--github-secrets",
    };
  } catch (e) {
    return {
      id: "functions",
      label: "Edge functions",
      status: "fail",
      message: `Couldn't reach Management API: ${String(e).slice(0, 150)}`,
    };
  }
}

async function checkVault(): Promise<Check> {
  const supa = supabaseAdmin();
  const { data, error } = await supa.rpc("admin_list_vault_secrets");
  if (error) {
    return {
      id: "vault",
      label: "Vault secrets",
      status: "unknown",
      message: `Add the admin_list_vault_secrets() SQL function (see docs) for this check. Error: ${error.message.slice(0, 150)}`,
      fixAnchor: "phase-1--supabase-project",
    };
  }
  const names = new Set(((data as Array<{ name: string }> | null) ?? []).map((r) => r.name));
  const missing = EXPECTED_VAULT_SECRETS.filter((n) => !names.has(n));
  if (missing.length === 0) {
    return {
      id: "vault",
      label: "Vault secrets",
      status: "pass",
      message: "notifier_url and service_role_key are populated.",
    };
  }
  return {
    id: "vault",
    label: "Vault secrets",
    status: "fail",
    message: `Missing in vault: ${missing.join(", ")}. Run the SQL in Phase 1.4.`,
    fixAnchor: "phase-1--supabase-project",
  };
}

async function checkTelegramWebhook(): Promise<Check> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return {
      id: "telegram",
      label: "Telegram webhook",
      status: "unknown",
      message: "Set TELEGRAM_BOT_TOKEN env var (server-only) to enable this check. Skip if you're not using Telegram.",
      fixAnchor: "telegram-recommended",
    };
  }
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${token}/getWebhookInfo`,
      { cache: "no-store" },
    );
    const body = await res.json() as { ok: boolean; result?: { url?: string; last_error_message?: string } };
    if (!body.ok || !body.result?.url) {
      return {
        id: "telegram",
        label: "Telegram webhook",
        status: "fail",
        message: "No webhook registered. Run the setWebhook curl from Phase 3.T.3.",
        fixAnchor: "telegram-recommended",
      };
    }
    if (body.result.last_error_message) {
      return {
        id: "telegram",
        label: "Telegram webhook",
        status: "warn",
        message: `Registered at ${body.result.url}, but Telegram reports: ${body.result.last_error_message}`,
        fixAnchor: "telegram-recommended",
      };
    }
    return {
      id: "telegram",
      label: "Telegram webhook",
      status: "pass",
      message: `Registered: ${body.result.url}`,
    };
  } catch (e) {
    return {
      id: "telegram",
      label: "Telegram webhook",
      status: "fail",
      message: `Couldn't reach Telegram API: ${String(e).slice(0, 150)}`,
    };
  }
}

async function checkPollerHeartbeat(): Promise<Check> {
  const supa = supabaseAdmin();
  const { data: alerts, error } = await supa
    .from("alerts")
    .select("last_polled_at")
    .not("last_polled_at", "is", null)
    .order("last_polled_at", { ascending: false })
    .limit(1);
  if (error) {
    return {
      id: "poller",
      label: "Poller heartbeat",
      status: "fail",
      message: `Couldn't read alerts: ${error.message.slice(0, 150)}`,
    };
  }
  if (!alerts || alerts.length === 0) {
    return {
      id: "poller",
      label: "Poller heartbeat",
      status: "unknown",
      message: "No alerts have been polled yet. Create one and recheck.",
      fixAnchor: "add-your-first-alert",
    };
  }
  const last = new Date(alerts[0]!.last_polled_at!).getTime();
  const ageSec = Math.floor((Date.now() - last) / 1000);
  if (ageSec < 300) {
    return {
      id: "poller",
      label: "Poller heartbeat",
      status: "pass",
      message: `Last poll ${ageSec}s ago.`,
    };
  }
  return {
    id: "poller",
    label: "Poller heartbeat",
    status: "fail",
    message: `Last poll ${Math.floor(ageSec / 60)}m ago — poller may be down. Check Fly logs.`,
    fixAnchor: "phase-4--poller-on-flyio",
  };
}

async function checkOptionalChannels(
  ref: string | undefined,
  accessToken: string | undefined,
): Promise<Check[]> {
  if (!ref || !accessToken) {
    return [{
      id: "channels",
      label: "Notification channels (function secrets)",
      status: "unknown",
      message: "Set SUPABASE_ACCESS_TOKEN env var to enable per-channel checks.",
      fixAnchor: "phase-3--notification-channels",
    }];
  }
  let names: Set<string>;
  try {
    const res = await fetch(
      `${MANAGEMENT_API}/v1/projects/${ref}/secrets`,
      { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" },
    );
    if (!res.ok) {
      return [{
        id: "channels",
        label: "Notification channels",
        status: "fail",
        message: `Management API secrets endpoint returned ${res.status}.`,
      }];
    }
    const list = await res.json() as Array<{ name: string }>;
    names = new Set(list.map((s) => s.name));
  } catch (e) {
    return [{
      id: "channels",
      label: "Notification channels",
      status: "fail",
      message: `Couldn't list secrets: ${String(e).slice(0, 150)}`,
    }];
  }
  return OPTIONAL_CHANNELS.map((ch) => {
    const missing = ch.envVars.filter((v) => !names.has(v));
    const present = ch.envVars.filter((v) => names.has(v));
    if (missing.length === 0) {
      return {
        id: `channel-${ch.id}`,
        label: ch.label,
        status: "pass" as const,
        message: `All ${ch.envVars.length} secret(s) set.`,
      };
    }
    if (present.length === 0) {
      return {
        id: `channel-${ch.id}`,
        label: ch.label,
        status: "unknown" as const,
        message: "No secrets set. Skip if you're not using this channel.",
        fixAnchor: "phase-3--notification-channels",
      };
    }
    return {
      id: `channel-${ch.id}`,
      label: ch.label,
      status: "warn" as const,
      message: `Partial setup — missing: ${missing.join(", ")}.`,
      fixAnchor: "phase-3--notification-channels",
    };
  });
}

export function docsLink(anchor?: string): string {
  return anchor ? `${DOCS_BASE}#${anchor}` : DOCS_BASE;
}
