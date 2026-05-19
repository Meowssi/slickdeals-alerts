// Runtime config read from env. Fail fast on missing required vars.

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`FATAL: required env var ${name} is not set`);
    process.exit(1);
  }
  return v;
}

export const config = {
  supabaseUrl: required("SUPABASE_URL"),
  supabaseServiceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
  pollIntervalSeconds: Number(process.env.POLL_INTERVAL_SECONDS ?? 30),
  maxConcurrent: Number(process.env.POLL_MAX_CONCURRENT ?? 2),
  userAgent:
    process.env.POLL_USER_AGENT ??
    "SlickdealsAlerts/0.1 (+https://github.com/your-org/slickdeals-alerts)",
  logLevel: (process.env.LOG_LEVEL ?? "info") as
    | "debug"
    | "info"
    | "warn"
    | "error",
  port: Number(process.env.PORT ?? 8080),
};
