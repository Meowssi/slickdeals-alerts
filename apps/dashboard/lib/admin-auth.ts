// Helpers for /admin auth: ADMIN_EMAILS allowlist + optional ADMIN_PASSWORD
// session cookie. Both layers stack: if both are configured, the user must
// pass both. If ADMIN_PASSWORD is unset, only the email gate applies.

import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";

const COOKIE = "admin_session";

/** Stable signed token derived from the password. We avoid plaintext in the
 * cookie but don't need true secret-key signing — possession of the env var
 * is the privileged secret. */
export function passwordToken(password: string): string {
  return createHash("sha256")
    .update("slickdeals-alerts-admin-session::" + password)
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

export interface AdminGateResult {
  allowed: boolean;
  /** Why we blocked — drives the UI shown in admin/layout. */
  reason?: "not-configured" | "wrong-email" | "needs-password";
  email?: string;
}

export function checkAdminGate(opts: {
  userEmail: string | undefined;
  sessionCookie: string | undefined;
}): AdminGateResult {
  const allow = adminEmails();
  if (allow.length === 0) {
    // SECURITY: refuse to render /admin if the deployer hasn't locked it
    // down. Without ADMIN_EMAILS set, the page was open to any signed-in
    // user — including random users who signed up on this deployment.
    return { allowed: false, reason: "not-configured" };
  }

  const email = (opts.userEmail ?? "").toLowerCase();
  if (!allow.includes(email)) {
    return { allowed: false, reason: "wrong-email", email };
  }

  const adminPw = process.env.ADMIN_PASSWORD;
  if (adminPw && adminPw.length > 0) {
    const expected = passwordToken(adminPw);
    if (!opts.sessionCookie || !constantTimeEquals(opts.sessionCookie, expected)) {
      return { allowed: false, reason: "needs-password", email };
    }
  }

  return { allowed: true, email };
}

export const ADMIN_SESSION_COOKIE = COOKIE;
