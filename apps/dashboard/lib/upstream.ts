// =============================================================================
// upstream.ts
// -----------------------------------------------------------------------------
// Checks whether the upstream template repo (Meowssi/slickdeals-alerts) has
// commits this deployment doesn't have yet, so the dashboard can surface an
// "update available" banner. Server-only — uses the *public* GitHub API, so no
// token is required.
//
// The deployed commit is read from VERCEL_GIT_COMMIT_SHA (set automatically by
// Vercel). The user's own repo (where GitHub's "Sync fork" button lives) is
// derived from VERCEL_GIT_REPO_OWNER / VERCEL_GIT_REPO_SLUG.
// =============================================================================

const UPSTREAM_REPO   = process.env.UPSTREAM_REPO   ?? "Meowssi/slickdeals-alerts";
const UPSTREAM_BRANCH = process.env.UPSTREAM_BRANCH ?? "main";

export interface UpdateStatus {
  available: boolean;
  /** Number of upstream commits this deploy is missing (undefined if unknown). */
  commitsBehind?: number;
  /** The user's repo home page, where the "Sync fork" button lives. */
  forkUrl?: string;
  /** Upstream compare / repo URL, so the operator can see what changed. */
  compareUrl?: string;
}

const NOT_AVAILABLE: UpdateStatus = { available: false };

export async function checkForUpdate(): Promise<UpdateStatus> {
  const current = process.env.VERCEL_GIT_COMMIT_SHA;
  if (!current) return NOT_AVAILABLE; // local dev / unknown — nothing to compare.

  const owner = process.env.VERCEL_GIT_REPO_OWNER;
  const slug  = process.env.VERCEL_GIT_REPO_SLUG;
  const forkUrl = owner && slug ? `https://github.com/${owner}/${slug}` : undefined;

  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "slickdeals-alerts-dashboard",
  };
  // Cache for an hour: one upstream call per server instance per hour keeps us
  // well under GitHub's unauthenticated rate limit.
  const fetchOpts = { headers, next: { revalidate: 3600 } } as const;

  try {
    // compare(base=current, head=upstream main): ahead_by = commits on main
    // that `current` doesn't have = updates waiting for us.
    const res = await fetch(
      `https://api.github.com/repos/${UPSTREAM_REPO}/compare/${current}...${UPSTREAM_BRANCH}`,
      fetchOpts,
    );
    if (res.ok) {
      const data = await res.json() as { ahead_by?: number; html_url?: string };
      const commitsBehind = data.ahead_by ?? 0;
      if (commitsBehind <= 0) return NOT_AVAILABLE;
      return {
        available: true,
        commitsBehind,
        forkUrl,
        compareUrl: data.html_url ?? `https://github.com/${UPSTREAM_REPO}`,
      };
    }

    // The current SHA isn't in the upstream repo (the fork has diverged with
    // its own commits). Fall back to a simple HEAD comparison — we can tell
    // there's something new but not how far behind.
    if (res.status === 404) {
      const headRes = await fetch(
        `https://api.github.com/repos/${UPSTREAM_REPO}/commits/${UPSTREAM_BRANCH}`,
        fetchOpts,
      );
      if (!headRes.ok) return NOT_AVAILABLE;
      const head = await headRes.json() as { sha?: string };
      if (head.sha && head.sha !== current) {
        return {
          available: true,
          forkUrl,
          compareUrl: `https://github.com/${UPSTREAM_REPO}/commits/${UPSTREAM_BRANCH}`,
        };
      }
    }
    return NOT_AVAILABLE;
  } catch {
    // Network hiccup / rate limit — fail silent, just don't show the banner.
    return NOT_AVAILABLE;
  }
}
