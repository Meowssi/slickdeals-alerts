"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PROVIDER_CATALOG, getProviderMeta } from "@slickalerts/shared/providers";
import type { NotificationChannelRow, UserSettingsRow } from "@slickalerts/shared/types";
import { supabaseBrowser } from "@/lib/supabase/client";
import { ChannelForm } from "@/components/channel-form";
import { NtfyWalkthrough } from "@/components/wizards/ntfy-walkthrough";
import { TelegramWalkthrough } from "@/components/wizards/telegram-walkthrough";
import { DiscordWalkthrough } from "@/components/wizards/discord-walkthrough";
import { PushoverWalkthrough } from "@/components/wizards/pushover-walkthrough";
import { TwilioWalkthrough } from "@/components/wizards/twilio-walkthrough";
import { ResendEmailWalkthrough } from "@/components/wizards/resend-email-walkthrough";

const TIMEZONE_FALLBACK = [
  "UTC",
  "America/Los_Angeles", "America/Denver", "America/Chicago", "America/New_York",
  "America/Anchorage", "America/Phoenix", "America/Honolulu",
  "Europe/London", "Europe/Berlin", "Europe/Paris", "Europe/Madrid", "Europe/Rome",
  "Asia/Tokyo", "Asia/Shanghai", "Asia/Hong_Kong", "Asia/Kolkata", "Asia/Dubai",
  "Australia/Sydney", "Pacific/Auckland",
];

function listTimezones(): string[] {
  type WithTz = { supportedValuesOf?: (key: string) => string[] };
  const intl = Intl as unknown as WithTz;
  if (typeof intl.supportedValuesOf === "function") {
    try {
      return intl.supportedValuesOf("timeZone");
    } catch { /* fall through */ }
  }
  return TIMEZONE_FALLBACK;
}

export function SettingsClient({
  settings, channels, isAdmin,
}: {
  settings: UserSettingsRow | null;
  channels: NotificationChannelRow[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState<string | null>(null);

  async function deleteChannel(id: string) {
    if (!confirm("Delete this channel?")) return;
    const supa = supabaseBrowser();
    await supa.from("notification_channels").delete().eq("id", id);
    router.refresh();
  }

  async function toggleChannel(id: string, enabled: boolean) {
    const supa = supabaseBrowser();
    await supa.from("notification_channels").update({ enabled }).eq("id", id);
    router.refresh();
  }

  async function sendTest(id: string) {
    const supa = supabaseBrowser();
    const { data: { session } } = await supa.auth.getSession();
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/send-test`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session?.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ channel_id: id }),
      },
    );
    const json = await res.json();
    alert(json.ok ? "✅ Sent" : `❌ ${json.error}`);
  }

  return (
    <>
      <section className="card p-6 space-y-4">
        <h2 className="font-semibold">Preferences</h2>
        <PreferencesForm settings={settings} />
      </section>

      <section className="card p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold">Notification channels</h2>
          <select
            className="input max-w-xs"
            value=""
            onChange={(e) => e.target.value && setAdding(e.target.value)}
          >
            <option value="">+ Add channel…</option>
            {PROVIDER_CATALOG.map((p) => (
              <option key={p.type} value={p.type}>{p.displayName}</option>
            ))}
          </select>
        </div>

        {channels.length === 0 ? (
          <p className="text-sm text-neutral-500">No channels yet. Pick one above.</p>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {channels.map((c) => {
              const meta = getProviderMeta(c.type);
              return (
                <li key={c.id} className="py-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{meta?.displayName ?? c.type}</span>
                      <span className="text-xs text-neutral-500">— {c.name}</span>
                      {c.verified_at ? (
                        <span className="text-xs text-green-700">✓ verified</span>
                      ) : (
                        <span className="text-xs text-amber-700">unverified</span>
                      )}
                    </div>
                    <div className="text-xs text-neutral-500 mt-0.5 truncate">
                      {summarizeConfig(c.type, c.config)}
                    </div>
                  </div>
                  {!c.verified_at && (
                    <button className="btn-primary text-xs" onClick={() => setAdding(c.type)}>
                      Finish setup
                    </button>
                  )}
                  {c.verified_at && (
                    <button className="btn-secondary text-xs" onClick={() => setAdding(c.type)}>
                      Edit
                    </button>
                  )}
                  <button className="btn-secondary text-xs"
                          onClick={() => sendTest(c.id)} disabled={!c.verified_at}>
                    Send test
                  </button>
                  <button className="btn-secondary text-xs"
                          onClick={() => toggleChannel(c.id, !c.enabled)}>
                    {c.enabled ? "Disable" : "Enable"}
                  </button>
                  <button className="btn-danger text-xs" onClick={() => deleteChannel(c.id)}>
                    Delete
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {adding && (
        <AddChannelModal
          providerType={adding}
          isAdmin={isAdmin}
          onClose={() => { setAdding(null); router.refresh(); }}
        />
      )}
    </>
  );
}

function summarizeConfig(type: string, cfg: Record<string, unknown>): string {
  if (type === "telegram") return cfg.chat_id ? `chat ${cfg.chat_id}` : "(not linked)";
  if (type === "ntfy") return `topic ${cfg.topic ?? ""}`;
  if (type === "sms_twilio") return String(cfg.phone ?? "");
  if (type === "pushover") return `user_key ****${String(cfg.user_key ?? "").slice(-4)}`;
  if (type === "discord") return "webhook configured";
  if (type === "email") return String(cfg.address ?? "");
  if (type === "webhook") return String(cfg.url ?? "");
  return JSON.stringify(cfg).slice(0, 80);
}

function PreferencesForm({ settings }: { settings: UserSettingsRow | null }) {
  const router = useRouter();
  const [tz, setTz] = useState(settings?.timezone ?? "America/Los_Angeles");
  const [qs, setQs] = useState(settings?.quiet_hours_start ?? "");
  const [qe, setQe] = useState(settings?.quiet_hours_end ?? "");
  const [digest, setDigest] = useState(settings?.digest_mode ?? false);

  async function save() {
    const supa = supabaseBrowser();
    await supa
      .from("user_settings")
      .update({
        timezone: tz,
        quiet_hours_start: qs || null,
        quiet_hours_end: qe || null,
        digest_mode: digest,
      })
      .eq("user_id", (await supa.auth.getUser()).data.user!.id);
    router.refresh();
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div>
        <label className="block text-sm font-medium mb-1">Timezone</label>
        <TimezoneSelect value={tz} onChange={setTz} />
        <p className="text-xs text-neutral-500 mt-1">Used for quiet-hours math.</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-sm font-medium mb-1">Quiet start</label>
          <input className="input" type="time" value={qs} onChange={(e) => setQs(e.target.value)} />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Quiet end</label>
          <input className="input" type="time" value={qe} onChange={(e) => setQe(e.target.value)} />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={digest} onChange={(e) => setDigest(e.target.checked)} />
        Digest mode — batch non-urgent matches into hourly summaries
      </label>
      <div className="md:col-span-2 text-right">
        <button className="btn-primary" onClick={save}>Save preferences</button>
      </div>
    </div>
  );
}

function TimezoneSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const zones = useMemo(listTimezones, []);
  // Include the user's current value even if it's not in the supported list
  // (e.g., legacy data from a different Node/Intl version).
  const options = useMemo(
    () => (zones.includes(value) ? zones : [value, ...zones]),
    [zones, value],
  );

  function useBrowserDefault() {
    try {
      const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (browserTz) onChange(browserTz);
    } catch { /* noop */ }
  }

  return (
    <div className="flex gap-2">
      <select
        className="input flex-1"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((tz) => (
          <option key={tz} value={tz}>{tz}</option>
        ))}
      </select>
      <button type="button" className="btn-secondary text-xs whitespace-nowrap" onClick={useBrowserDefault}>
        Use my browser
      </button>
    </div>
  );
}

function AddChannelModal({
  providerType, onClose, isAdmin,
}: { providerType: string; onClose: () => void; isAdmin: boolean }) {
  const meta = getProviderMeta(providerType);
  if (!meta) return null;

  // Per-channel walkthroughs render their own headings; the generic
  // ChannelForm needs a wrapper title.
  const hasOwnHeader =
    providerType === "ntfy" ||
    providerType === "telegram" ||
    providerType === "discord" ||
    providerType === "pushover" ||
    providerType === "sms_twilio" ||
    providerType === "email";

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <div className="card max-w-xl w-full p-6 max-h-[90vh] overflow-y-auto relative">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 w-7 h-7 rounded-full text-neutral-500 hover:bg-neutral-100 flex items-center justify-center"
        >
          ✕
        </button>

        {!hasOwnHeader && (
          <>
            <h2 className="text-xl font-semibold mb-1">Add {meta.displayName}</h2>
            <p className="text-sm text-neutral-600 mb-4">{meta.setup.instructions}</p>
          </>
        )}

        {providerType === "ntfy"      && <NtfyWalkthrough     onDone={onClose} onSkip={onClose} />}
        {providerType === "telegram"  && <TelegramWalkthrough onDone={onClose} onSkip={onClose} isAdmin={isAdmin} />}
        {providerType === "discord"   && <DiscordWalkthrough  onDone={onClose} onSkip={onClose} />}
        {providerType === "pushover"  && <PushoverWalkthrough onDone={onClose} onSkip={onClose} isAdmin={isAdmin} />}
        {providerType === "sms_twilio"&& <TwilioWalkthrough   onDone={onClose} onSkip={onClose} />}
        {providerType === "email"     && <ResendEmailWalkthrough onDone={onClose} onSkip={onClose} />}
        {!hasOwnHeader && <ChannelForm meta={meta} onDone={onClose} onCancel={onClose} />}
      </div>
    </div>
  );
}
