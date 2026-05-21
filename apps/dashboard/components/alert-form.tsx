"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AlertPriority } from "@slickalerts/shared/types";
import { supabaseBrowser } from "@/lib/supabase/client";

interface AlertFormProps {
  initial?: {
    id?: string;
    name?: string;
    rss_url?: string;
    enabled?: boolean;
    priority?: AlertPriority;
    channel_ids?: string[];
    include_images?: boolean;
  };
  channels: Array<{ id: string; type: string; name: string; verified: boolean }>;
}

export function AlertForm({ initial = {}, channels }: AlertFormProps) {
  const router = useRouter();
  const [name, setName] = useState(initial.name ?? "");
  const [rssUrl, setRssUrl] = useState(initial.rss_url ?? "");
  const [enabled, setEnabled] = useState(initial.enabled ?? true);
  const [priority, setPriority] = useState<AlertPriority>(initial.priority ?? "normal");
  const [channelIds, setChannelIds] = useState<string[]>(initial.channel_ids ?? []);
  const [includeImages, setIncludeImages] = useState(initial.include_images ?? true);
  const [submitting, setSubmitting] = useState(false);
  const [errMsg, setErrMsg] = useState("");
  const [testResult, setTestResult] = useState<string | null>(null);

  // True when this alert will route to an SMS channel (Twilio) — used to warn
  // about MMS cost when include_images is on.
  const targetsTwilio = (() => {
    const targeted = channelIds.length > 0
      ? channels.filter((c) => channelIds.includes(c.id))
      : channels;
    return targeted.some((c) => c.type === "sms_twilio");
  })();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setErrMsg("");
    const supa = supabaseBrowser();
    const payload = {
      name: name.trim(),
      rss_url: rssUrl.trim(),
      enabled,
      priority,
      channel_ids: channelIds,
      include_images: includeImages,
    };

    const { error } = initial.id
      ? await supa.from("alerts").update(payload).eq("id", initial.id)
      : await supa.from("alerts").insert(payload);

    setSubmitting(false);
    if (error) { setErrMsg(error.message); return; }
    router.push("/alerts");
    router.refresh();
  }

  async function handleDelete() {
    if (!initial.id) return;
    if (!confirm("Delete this alert? Matches and notification history are preserved.")) return;
    const supa = supabaseBrowser();
    await supa.from("alerts").delete().eq("id", initial.id);
    router.push("/alerts");
    router.refresh();
  }

  async function handleTestFetch() {
    setTestResult("Fetching...");
    try {
      const res = await fetch(`/api/alert-test?url=${encodeURIComponent(rssUrl)}`);
      const json = await res.json();
      if (!res.ok) {
        setTestResult(`❌ ${json.error}`);
      } else {
        setTestResult(`✅ Fetched ${json.itemCount} item(s). Latest: "${json.latestTitle ?? "(none)"}"`);
      }
    } catch (e) {
      setTestResult(`❌ ${String(e)}`);
    }
  }

  function toggleChannel(id: string) {
    setChannelIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="card p-6 space-y-4">
        <h2 className="font-semibold">Basics</h2>
        <Field label="Name">
          <input
            className="input" required value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Cat6 cables under $20"
          />
        </Field>
        <Field label="Slickdeals RSS URL"
               help="Build any search on slickdeals.net with the filters you want, then click the RSS icon and paste the URL.">
          <input
            className="input" required type="url" value={rssUrl}
            onChange={(e) => setRssUrl(e.target.value)}
            placeholder="https://slickdeals.net/newsearch.php?..."
          />
          <button type="button" className="btn-secondary mt-2 text-xs" onClick={handleTestFetch}>
            Test fetch
          </button>
          {testResult && <p className="text-xs mt-2">{testResult}</p>}
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Enabled (uncheck to pause without deleting)
        </label>
      </div>

      <div className="card p-6 space-y-4">
        <h2 className="font-semibold">Delivery</h2>
        <Field label="Priority">
          <select className="input" value={priority}
                  onChange={(e) => setPriority(e.target.value as AlertPriority)}>
            <option value="silent">Silent (no sound)</option>
            <option value="normal">Normal</option>
            <option value="urgent">Urgent (bypass quiet hours / DND)</option>
          </select>
        </Field>
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-2">
            Send to (leave empty to use all verified channels)
          </label>
          {channels.length === 0 ? (
            <p className="text-sm text-neutral-500">
              No channels yet. <a href="/settings" className="underline">Add one in Settings.</a>
            </p>
          ) : (
            <div className="space-y-2">
              {channels.map((c) => (
                <label key={c.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={channelIds.includes(c.id)}
                    onChange={() => toggleChannel(c.id)}
                    disabled={!c.verified}
                  />
                  <span className={c.verified ? "" : "text-neutral-400"}>
                    {c.type} — {c.name}
                    {!c.verified && " (unverified)"}
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="pt-2 border-t border-neutral-100">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={includeImages}
              onChange={(e) => setIncludeImages(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium">Include deal images in notifications</span>
              <span className="block text-xs text-neutral-500 mt-0.5">
                Telegram / Discord show the thumbnail above the text. ntfy / Pushover / email render inline images too.
              </span>
            </span>
          </label>
          {includeImages && targetsTwilio && (
            <div className="mt-2 ml-6 rounded-md bg-amber-50 border border-amber-200 p-2 text-xs text-amber-900">
              <strong>⚠️ Note for SMS:</strong> With images on, each Twilio message becomes an MMS — that&apos;s about{" "}
              <strong>$0.02 per text</strong> instead of $0.008 (2.5× more). If you want cheap SMS, uncheck this
              or only route this alert to non-SMS channels above.
            </div>
          )}
        </div>
      </div>

      {errMsg && <p className="text-sm text-red-600">{errMsg}</p>}

      <div className="flex justify-between">
        {initial.id ? (
          <button type="button" className="btn-danger" onClick={handleDelete}>
            Delete alert
          </button>
        ) : <span />}
        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting ? "Saving..." : initial.id ? "Save changes" : "Create alert"}
        </button>
      </div>
    </form>
  );
}

function Field({
  label, help, children,
}: { label: string; help?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-neutral-700 mb-1">{label}</label>
      {children}
      {help && <p className="text-xs text-neutral-500 mt-1">{help}</p>}
    </div>
  );
}
