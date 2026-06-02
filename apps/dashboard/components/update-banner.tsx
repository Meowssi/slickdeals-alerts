"use client";

import { useEffect, useState } from "react";
import type { UpdateStatus } from "@/lib/upstream";

// Dismissable "update available" banner. Shown only to admins (the operator
// who can actually sync the fork). Dismissal is remembered per upstream-version
// so a new update re-shows it.
export function UpdateBanner({ status }: { status: UpdateStatus }) {
  const dismissKey = `update-dismissed:${status.compareUrl ?? ""}`;
  const [dismissed, setDismissed] = useState(true); // assume dismissed until we read storage (avoids flash)

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

  return (
    <div className="bg-brand-50 dark:bg-brand-700/20 border-b border-brand-100 dark:border-brand-700 text-sm">
      <div className="mx-auto w-full max-w-5xl px-4 py-2 flex items-center gap-3">
        <span className="text-brand-700 dark:text-brand-400">
          🚀 {countLabel} from the upstream template.
        </span>
        <div className="ml-auto flex items-center gap-3 whitespace-nowrap">
          {status.compareUrl && (
            <a
              href={status.compareUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand-700 dark:text-brand-400 underline hover:no-underline"
            >
              What changed
            </a>
          )}
          {status.forkUrl && (
            <a
              href={status.forkUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md bg-brand-600 text-white px-2.5 py-1 font-medium hover:bg-brand-700"
              title="Opens your repo on GitHub — click 'Sync fork' there to update"
            >
              Update (Sync fork)
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
      </div>
    </div>
  );
}
