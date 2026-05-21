// Helpers for /admin auth: stacked gates.
//   1. ADMIN_EMAILS allowlist (required to be set — empty refuses access).
//   2. (Optional) ADMIN_PASSWORD env var.
//   3. (Optional) TOTP secret in Supabase Vault.
//
// All configured gates must pass.

import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";

const PASSWORD_COOKIE = "admin_session";
const TOTP_COOKIE     = "admin_totp_session";
const VAULT_TOTP_NAME = "admin_totp_secret";

export const ADMIN_SESSION_COOKIE      = PASSWORD_COOKIE;
export const ADMIN_TOTP_SESSION_COOKIE = TOTP_COOKIE;
export const ADMIN_TOTP_VAULT_NAME     = VAULT_TOTP_NAME;

export function passwordToken(password: string): string {
  return createHash("sha256")
    .update("slickdeals-alerts-admin-session::" + password)
    .digest("hex");
}

export function totpSessionToken(secret: string): string {
  // Cookie value is a hash of the TOTP shared secret. Owning the cookie
  // means the user has previously proven possession of the secret via a
  // valid TOTP code.
  return createHash("sha256")
    .update("slickdeals-alerts-admin-totp::" + secret)
    .digest("hex");
}

export function constantTimeEquals(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export async function getAdminTotpSecret(): Promise<string | null> {
  try {
    const supa = supabaseAdmin();
    const { data, error } = await supa.rpc("admin_get_vault_secret", { p_name: VAULT_TOTP_NAME });
    if (error) return null;
    if (typeof data === "string" && data.length > 0) return data;
    return null;
  } catch {
    return null;
  }
}

export async function saveAdminTotpSecret(secret: string): Promise<void> {
  const supa = supabaseAdmin();
  await supa.rpc("admin_upsert_vault_secret", { p_name: VAULT_TOTP_NAME, p_value: secret });
}

export async function clearAdminTotpSecret(): Promise<void> {
  const supa = supabaseAdmin();
  // Setting to empty string effectively disables the gate. We could delete
  // the entry instead, but admin_upsert_vault_secret is the existing
  // contract; this keeps the surface small.
  await supa.rpc("admin_upsert_vault_secret", { p_name: VAULT_TOTP_NAME, p_value: "" });
}

export interface AdminGateResult {
  allowed: boolean;
  reason?: "not-configured" | "wrong-email" | "needs-password" | "needs-totp";
  email?: string;
}

export interface AdminGateInput {
  userEmail: string | undefined;
  passwordCookie: string | undefined;
  totpCookie: string | undefined;
  totpSecret: string | null;
}

export function checkAdminGate(opts: AdminGateInput): AdminGateResult {
  const allow = adminEmails();
  if (allow.length === 0) {
    return { allowed: false, reason: "not-configured" };
  }

  const email = (opts.userEmail ?? "").toLowerCase();
  if (!allow.includes(email)) {
    return { allowed: false, reason: "wrong-email", email };
  }

  const adminPw = process.env.ADMIN_PASSWORD;
  if (adminPw && adminPw.length > 0) {
    const expected = passwordToken(adminPw);
    if (!opts.passwordCookie || !constantTimeEquals(opts.passwordCookie, expected)) {
      return { allowed: false, reason: "needs-password", email };
    }
  }

  if (opts.totpSecret && opts.totpSecret.length > 0) {
    const expected = totpSessionToken(opts.totpSecret);
    if (!opts.totpCookie || !constantTimeEquals(opts.totpCookie, expected)) {
      return { allowed: false, reason: "needs-totp", email };
    }
  }

  return { allowed: true, email };
}

