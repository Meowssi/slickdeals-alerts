"use client";

import { useEffect, useState } from "react";
import type { UpdateStatus } from "@/lib/upstream";
import { syncUpstreamAction, type SyncUpstreamResult } from "@/lib/update-actions";

// Dismissable "update available" banner. Shown only to admins (the operator
// who can actually update the deployment). Dismissal is remembered per
// upstream-version so a new update re-shows it.
//
// Updates are hands-off by default: the sync-upstream workflow in the user's
// repo applies them automatically every ~6 hours, so the banner's job is
// mostly to say "new stuff is coming on its own". For the impatient:
//   1. GITHUB_TOKEN configured → "Update now" button triggers the workflow
//      right here; Vercel redeploys automatically.
//   2. No token → link to the workflow's "Run workflow" page on GitHub, with
//      a plain-English hint of the one button to press there.
export function UpdateBanner({ status }: { status: UpdateStatus }) {
  const dismissKey = `update-dismissed:${status.compareUrl ?? ""}`;
  const [dismissed, setDismissed] = useState(true); // assume dismissed until we read storage (avoids flash)
  const [result, setResult] = useState<SyncUpstreamResult | null>(null);
  // Plain state, NOT useTransition: in React 18 an async transition callback
  // releases isPending at its first await, which would re-enable the button
  // mid-request and allow duplicate workflow dispatches.
  const [pending, setPending] = useState(false);

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(dismissKey) === "1");
    } catch {
      setDismissed(false);
    }
  }, [dismissKey]);

  if (!status.available || dismissed) return null;

  const count = status.commitsBehind;
  const countLabel =
    count && count > 0
      ? `${count} new ${count === 1 ? "update" : "updates"} available`
      : "An update is available";

  const runUpdate = async () => {
    if (pending) return;
    setPending(true);
    try {
      setResult(await syncUpstreamAction());
    } catch {
      setResult({ ok: false, message: "Couldn't reach the server — check your connection and try again." });
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="bg-brand-50 dark:bg-brand-700/20 border-b border-brand-100 dark:border-brand-700 text-sm">
      <div className="mx-auto w-full max-w-5xl px-4 py-2 flex items-center gap-3 flex-wrap">
        <span className="text-brand-700 dark:text-brand-400">
          {result?.ok ? <>✅ {result.message}</> : <>🚀 {countLabel} from the upstream template.</>}
        </span>
        <div className="ml-auto flex items-center gap-3 whitespace-nowrap">
          {!result?.ok && status.compareUrl && (
            <a
              href={status.compareUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand-700 dark:text-brand-400 underline hover:no-underline"
            >
              What changed
            </a>
          )}
          {!result?.ok && status.canTrigger && (
            <button
              type="button"
              onClick={runUpdate}
              disabled={pending}
              className="rounded-md bg-brand-600 text-white px-2.5 py-1 font-medium hover:bg-brand-700 disabled:opacity-60"
            >
              {pending ? "Starting update…" : "Update now"}
            </button>
          )}
          {!result?.ok && !status.canTrigger && status.actionsUrl && (
            <a
              href={status.actionsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md bg-brand-600 text-white px-2.5 py-1 font-medium hover:bg-brand-700"
              title="Opens GitHub Actions — press 'Run workflow' there and your dashboard updates itself in ~3 minutes"
            >
              Update on GitHub
            </a>
          )}
          <button
            type="button"
            onClick={() => {
              try { localStorage.setItem(dismissKey, "1"); } catch { /* ignore */ }
              setDismissed(true);
            }}
            aria-label="Dismiss"
            className="text-brand-500 hover:text-brand-700"
          >
            ✕
          </button>
        </div>
        {!result?.ok && (
          <p className="basis-full text-xs text-brand-700/80 dark:text-brand-400/80 m-0">
            {status.canTrigger || !status.actionsUrl ? (
              <>No rush — updates install themselves automatically within ~6 hours.</>
            ) : (
              <>
                No rush — updates install themselves automatically within ~6 hours. In a hurry?
                Open the link, press <strong>Run workflow</strong>, done — your dashboard rebuilds
                itself (including database changes) in ~3 minutes.
              </>
            )}
          </p>
        )}
        {result && !result.ok && (
          <p className="basis-full text-xs text-red-700 dark:text-red-400 m-0">{result.message}</p>
        )}
      </div>
    </div>
  );
}
