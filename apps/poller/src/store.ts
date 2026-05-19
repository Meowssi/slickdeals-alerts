// Supabase data access for the poller. Uses the service role key, bypasses RLS.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AlertRow, DealItem } from "@slickalerts/shared";
import { config } from "./config.js";
import { log } from "./log.js";

let _client: SupabaseClient | null = null;
export function db(): SupabaseClient {
  if (_client) return _client;
  _client = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return _client;
}

export async function listEnabledAlerts(): Promise<AlertRow[]> {
  const { data, error } = await db()
    .from("alerts")
    .select("*")
    .eq("enabled", true)
    .order("last_polled_at", { ascending: true, nullsFirst: true });
  if (error) {
    log.error("listEnabledAlerts failed", { error: error.message });
    return [];
  }
  return (data ?? []) as AlertRow[];
}

export async function updateAlertPollMeta(
  alertId: string,
  patch: {
    last_polled_at?: string;
    last_etag?: string | null;
    last_modified?: string | null;
    last_error?: string | null;
    consecutive_errors?: number;
  },
): Promise<void> {
  const { error } = await db().from("alerts").update(patch).eq("id", alertId);
  if (error) log.warn("updateAlertPollMeta failed", { alertId, error: error.message });
}

/**
 * Insert a deal if not already present, return the deal_id.
 * Uses upsert on slickdeals_id (unique).
 */
export async function upsertDeal(item: DealItem): Promise<number | null> {
  const { data, error } = await db()
    .from("deals")
    .upsert(
      {
        slickdeals_id: item.slickdealsId,
        title: item.title,
        url: item.url,
        price: item.price,
        store: item.store,
        thumbnail_url: item.thumbnailUrl,
        rss_pub_at: item.pubAt?.toISOString() ?? null,
        raw: item.raw as Record<string, unknown>,
      },
      { onConflict: "slickdeals_id", ignoreDuplicates: false },
    )
    .select("id")
    .single();

  if (error) {
    log.warn("upsertDeal failed", {
      slickdealsId: item.slickdealsId,
      error: error.message,
    });
    return null;
  }
  return data?.id ?? null;
}

/**
 * Insert match row. The DB trigger then fires the notifier.
 * Returns true if a new match was inserted (false if it already existed).
 */
export async function insertMatch(
  userId: string,
  alertId: string,
  dealId: number,
): Promise<boolean> {
  const { error, count } = await db()
    .from("alert_matches")
    .insert(
      { user_id: userId, alert_id: alertId, deal_id: dealId },
      { count: "exact" },
    );

  if (error) {
    // Unique violation = already matched; expected on re-poll, not a real error.
    if (error.code === "23505") return false;
    log.warn("insertMatch failed", {
      alertId,
      dealId,
      error: error.message,
    });
    return false;
  }
  return (count ?? 0) > 0;
}
