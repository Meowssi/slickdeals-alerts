// =============================================================================
// upstream.ts
// -----------------------------------------------------------------------------
// Checks whether the upstream template repo (Meowssi/slickdeals-alerts) has
// commits this deployment doesn't have yet, so the dashboard can surface an
// "update available" banner. Server-only.
//
// The deployed commit is read from VERCEL_GIT_COMMIT_SHA (set automatically by
// Vercel). The user's own repo is derived from VERCEL_GIT_REPO_OWNER /
// VERCEL_GIT_REPO_SLUG (overridable via GITHUB_REPO).
//
// Why cross-repo compare: the Deploy-to-Vercel button creates a CLONE, not a
// fork. The user's merge commits get their own SHAs, so asking the upstream
// repo "do you know my deployed SHA?" 404s even when the trees are identical —
// the old code then fell back to a HEAD-SHA comparison and showed a false
// "update available" banner forever. Comparing FROM the user's repo against
// upstream's branch (`base...owner:repo:branch`) reports `identical` /
// `ahead_by` correctly across the repo network.
//
// The user's repo may be private (Deploy button default), in which case the
// cross-repo compare needs GITHUB_TOKEN. Without it we fall back to comparing
// inside the public upstream repo (works for true forks that never merged
// their own PRs), and if we still can't tell, we show nothing — a missing
// banner beats a false alarm with a dead-end button.
// =============================================================================

const UPSTREAM_REPO   = process.env.UPSTREAM_REPO   ?? "Meowssi/slickdeals-alerts";
const UPSTREAM_BRANCH = process.env.UPSTREAM_BRANCH ?? "main";

export interface UpdateStatus {
  available: boolean;
  /** Number of upstream commits this deploy is missing (undefined if unknown). */
  commitsBehind?: number;
  /** The user's repo home page. */
  forkUrl?: string;
  /** Upstream compare / repo URL, so the operator can see what changed. */
  compareUrl?: string;
  /** Link to the sync-upstream workflow in the user's repo ("Run workflow" page). */
  actionsUrl?: string;
  /** True when GITHUB_TOKEN is set, i.e. the banner can trigger the update itself. */
  canTrigger?: boolean;
}

const NOT_AVAILABLE: UpdateStatus = { available: false };

/** "owner/name" of the user's own repo, from Vercel's git env (or GITHUB_REPO). */
export function ownRepo(): string | undefined {
  if (process.env.GITHUB_REPO) return process.env.GITHUB_REPO;
  const owner = process.env.VERCEL_GIT_REPO_OWNER;
  const slug  = process.env.VERCEL_GIT_REPO_SLUG;
  return owner && slug ? `${owner}/${slug}` : undefined;
}

export async function checkForUpdate(): Promise<UpdateStatus> {
  const current = process.env.VERCEL_GIT_COMMIT_SHA;
  if (!current) return NOT_AVAILABLE; // local dev / unknown — nothing to compare.

  const repo = ownRepo();
  const forkUrl = repo ? `https://github.com/${repo}` : undefined;
  const actionsUrl = forkUrl ? `${forkUrl}/actions/workflows/sync-upstream.yml` : undefined;
  const canTrigger = Boolean(repo && process.env.GITHUB_TOKEN);

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "slickdeals-alerts-dashboard",
  };
  // The user's repo may be private; the token also raises the rate limit.
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  // Cache for an hour: one upstream call per server instance per hour keeps us
  // well under GitHub's rate limit even unauthenticated.
  const fetchOpts = { headers, next: { revalidate: 3600 } } as const;

  const [upOwner, upName] = UPSTREAM_REPO.split("/");
  const found = (commitsBehind: number, compareUrl?: string): UpdateStatus => ({
    available: true,
    commitsBehind: commitsBehind > 0 ? commitsBehind : undefined,
    forkUrl,
    compareUrl: compareUrl ?? `https://github.com/${UPSTREAM_REPO}/commits/${UPSTREAM_BRANCH}`,
    actionsUrl,
    canTrigger,
  });

  try {
    // Preferred: compare from the user's repo against upstream's branch.
    // ahead_by = upstream commits this deploy doesn't have = updates waiting.
    if (repo) {
      const res = await fetch(
        `https://api.github.com/repos/${repo}/compare/${current}...${upOwner}:${upName}:${UPSTREAM_BRANCH}`,
        fetchOpts,
      );
      if (res.ok) {
        const data = await res.json() as { ahead_by?: number; html_url?: string };
        const behind = data.ahead_by ?? 0;
        return behind > 0 ? found(behind, data.html_url) : NOT_AVAILABLE;
      }
      // 404 = repo is private and we have no token, or the SHA is unknown.
      // Fall through to the upstream-side compare below.
    }

    // Fallback 1: compare inside the (public) upstream repo. Only works when
    // the deployed SHA exists upstream — true until the user merges their own
    // PRs.
    const res = await fetch(
      `https://api.github.com/repos/${UPSTREAM_REPO}/compare/${current}...${UPSTREAM_BRANCH}`,
      fetchOpts,
    );
    if (res.ok) {
      const data = await res.json() as { ahead_by?: number; html_url?: string };
      const behind = data.ahead_by ?? 0;
      return behind > 0 ? found(behind, data.html_url) : NOT_AVAILABLE;
    }

    // Fallback 2 (zero-token, works for private clones): the build baked in
    // upstream's HEAD as of deploy time (next.config.mjs). Since deploys are
    // (by design) upstream syncs, anything upstream published after this
    // build is an update. Both SHAs live in the public upstream repo, so this
    // compare needs no auth.
    const baked = process.env.UPSTREAM_SHA_AT_BUILD;
    if (baked) {
      const res2 = await fetch(
        `https://api.github.com/repos/${UPSTREAM_REPO}/compare/${baked}...${UPSTREAM_BRANCH}`,
        fetchOpts,
      );
      if (res2.ok) {
        const data = await res2.json() as { ahead_by?: number; html_url?: string };
        const behind = data.ahead_by ?? 0;
        return behind > 0 ? found(behind, data.html_url) : NOT_AVAILABLE;
      }
    }

    // Can't tell (diverged clone, no token, no baked SHA). Stay quiet rather
    // than guess — the old HEAD-SHA fallback here is what produced permanent
    // false alarms.
    return NOT_AVAILABLE;
  } catch {
    // Network hiccup / rate limit — fail silent, just don't show the banner.
    return NOT_AVAILABLE;
  }
}
