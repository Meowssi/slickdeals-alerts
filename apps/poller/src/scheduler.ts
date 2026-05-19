// Self-paced scheduler.
//
// - On each tick we list enabled alerts ordered by last_polled_at asc
//   (oldest first), then process at most `maxConcurrent` in parallel.
// - Sleep `pollIntervalSeconds` between ticks.
// - Per-alert exponential backoff is encoded in `consecutive_errors`.

import { dealMatchesAlert, parseRss } from "@slickalerts/shared/rss";
import { config } from "./config.js";
import { fetchFeed } from "./fetcher.js";
import { log } from "./log.js";
import {
  insertMatch,
  listEnabledAlerts,
  updateAlertPollMeta,
  upsertDeal,
} from "./store.js";

const MAX_BACKOFF_SECONDS = 10 * 60;

export async function runScheduler(signal: AbortSignal): Promise<void> {
  log.info("scheduler started", {
    pollIntervalSeconds: config.pollIntervalSeconds,
    maxConcurrent: config.maxConcurrent,
  });

  while (!signal.aborted) {
    const tickStart = Date.now();
    try {
      await tick();
    } catch (err) {
      log.error("tick crashed", { error: String(err) });
    }
    const elapsed = (Date.now() - tickStart) / 1000;
    const sleepFor = Math.max(0, config.pollIntervalSeconds - elapsed);
    await sleep(sleepFor * 1000, signal);
  }
}

async function tick(): Promise<void> {
  const alerts = await listEnabledAlerts();
  if (alerts.length === 0) {
    log.debug("no enabled alerts");
    return;
  }

  // Filter out alerts still in backoff window.
  const now = Date.now();
  const due = alerts.filter((a) => isDue(a, now));
  log.debug("tick", { total: alerts.length, due: due.length });

  // Process with bounded concurrency.
  await runWithConcurrency(due, config.maxConcurrent, pollOne);
}

function isDue(
  alert: {
    last_polled_at: string | null;
    consecutive_errors: number;
  },
  now: number,
): boolean {
  if (!alert.last_polled_at) return true;
  if (alert.consecutive_errors === 0) return true;
  const backoffSec = Math.min(
    MAX_BACKOFF_SECONDS,
    Math.pow(2, alert.consecutive_errors) * 5,
  );
  const last = new Date(alert.last_polled_at).getTime();
  return now - last >= backoffSec * 1000;
}

async function pollOne(alert: {
  id: string;
  user_id: string;
  name: string;
  rss_url: string;
  title_include: string[];
  title_exclude: string[];
  min_price: number | null;
  max_price: number | null;
  last_etag: string | null;
  last_modified: string | null;
  consecutive_errors: number;
}): Promise<void> {
  const start = Date.now();
  const ctx = { alertId: alert.id, name: alert.name };

  try {
    const res = await fetchFeed(alert.rss_url, {
      etag: alert.last_etag,
      lastModified: alert.last_modified,
    });

    if (res.status === 304) {
      await updateAlertPollMeta(alert.id, {
        last_polled_at: new Date().toISOString(),
        last_error: null,
        consecutive_errors: 0,
      });
      log.debug("not modified", { ...ctx, ms: Date.now() - start });
      return;
    }
    if (res.status >= 400 || !res.body) {
      const errMsg = `HTTP ${res.status}`;
      await updateAlertPollMeta(alert.id, {
        last_polled_at: new Date().toISOString(),
        last_error: errMsg,
        consecutive_errors: alert.consecutive_errors + 1,
      });
      log.warn("fetch failed", { ...ctx, status: res.status });
      return;
    }

    const items = parseRss(res.body);
    let newMatches = 0;

    for (const item of items) {
      if (
        !dealMatchesAlert(item, {
          title_include: alert.title_include,
          title_exclude: alert.title_exclude,
          min_price: alert.min_price,
          max_price: alert.max_price,
        })
      ) {
        continue;
      }
      const dealId = await upsertDeal(item);
      if (!dealId) continue;
      const inserted = await insertMatch(alert.user_id, alert.id, dealId);
      if (inserted) newMatches++;
    }

    await updateAlertPollMeta(alert.id, {
      last_polled_at: new Date().toISOString(),
      last_etag: res.etag,
      last_modified: res.lastModified,
      last_error: null,
      consecutive_errors: 0,
    });

    log.info("polled", {
      ...ctx,
      items: items.length,
      newMatches,
      ms: Date.now() - start,
    });
  } catch (err) {
    await updateAlertPollMeta(alert.id, {
      last_polled_at: new Date().toISOString(),
      last_error: String(err),
      consecutive_errors: alert.consecutive_errors + 1,
    });
    log.error("poll error", { ...ctx, error: String(err) });
  }
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  const queue = items.slice();
  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(concurrency, queue.length); i++) {
    workers.push(
      (async () => {
        while (queue.length > 0) {
          const next = queue.shift();
          if (!next) return;
          await worker(next);
        }
      })(),
    );
  }
  await Promise.all(workers);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      resolve();
    }, { once: true });
  });
}
