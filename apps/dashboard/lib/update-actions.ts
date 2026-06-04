"use server";

// Server action behind the update banner's "Update now" button. Dispatches
// the sync-upstream.yml workflow in the user's own repo via the GitHub API;
// the workflow merges the upstream template and pushes, Vercel redeploys, and
// the prebuild applies any new DB migrations. Requires GITHUB_TOKEN (PAT with
// repo+workflow scopes) — see /admin/setup. Without it the banner falls back
// to a link to the workflow's "Run workflow" page on GitHub.

import "server-only";
import { supabaseServer } from "@/lib/supabase/server";
import { adminEmails } from "@/lib/admin-auth";
import { ownRepo } from "@/lib/upstream";

export interface SyncUpstreamResult {
  ok: boolean;
  message: string;
}

export async function syncUpstreamAction(): Promise<SyncUpstreamResult> {
  // The banner is only rendered for admins, but server actions are reachable
  // endpoints in their own right — re-check here.
  const supa = await supabaseServer();
  const { data: { user } } = await supa.auth.getUser();
  if (!adminEmails().includes((user?.email ?? "").toLowerCase())) {
    return { ok: false, message: "Forbidden." };
  }

  const repo = ownRepo();
  const token = process.env.GITHUB_TOKEN;
  if (!repo || !token) {
    return {
      ok: false,
      message: "Set the GITHUB_TOKEN env var (PAT with repo+workflow scopes) to update from here — or run the 'Sync from upstream template' workflow from your repo's Actions tab.",
    };
  }

  const res = await fetch(
    `https://api.github.com/repos/${repo}/actions/workflows/sync-upstream.yml/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref: "main" }),
    },
  );

  if (res.status === 404) {
    // Workflow file not in the user's repo yet (first update after it shipped
    // upstream): they need one manual sync to receive it.
    return {
      ok: false,
      message: `Your repo doesn't have the updater workflow yet. One-time step: open https://github.com/${repo}, and merge the latest changes from the template once — every update after that is one click here.`,
    };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { ok: false, message: `GitHub API ${res.status}: ${body.slice(0, 200)}` };
  }

  return {
    ok: true,
    message: "Update started! Your repo is syncing with the template and Vercel will redeploy — the new version is live in ~3 minutes. New database migrations apply automatically during the build.",
  };
}
