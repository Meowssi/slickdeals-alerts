# Troubleshooting

## "I added an alert but no deals are showing up"

1. Visit **Stats → Alert health**. Is your alert showing recent polls?
   - If `last_polled_at` is null or hours-old → poller is down or your URL is broken.
2. Click into the alert. Use the **Test fetch** button — it tells you whether the URL returns valid RSS items.
3. Check `consecutive_errors` and `last_error` on the same page.
4. Sanity check: paste the RSS URL into your browser. You should see XML.

## "Deals show up in the dashboard but no notification"

Most common cause: you haven't **verified** a channel.

1. Open **Settings**. Each channel must show ✓ verified.
2. Click **Send test** on a verified channel to confirm.
3. If test works but real deals don't: check the alert's "Send to" — make sure either it's empty (sends to all verified channels) or includes the channel you tested.

## "Telegram says 'Not linked' when I tap Save/Dismiss"

Your bot has a `chat_id` you haven't connected to your account. Re-run onboarding (Settings → delete Telegram channel → re-add).

## "Verification SMS never arrives"

- Phone number must be **E.164** format (`+15551234567` — leading `+` and country code).
- Check Twilio console → Logs to see if the message was sent at all.
- Some carriers block A2P SMS without prior registration. See **[A2P 10DLC campaign registration](self-hosting.md#a2p-10dlc-campaign-registration-required-for-us-numbers)** in the self-hosting guide.

## "Twilio rejected my A2P campaign — Error 30909 (CTA could not be verified)"

"CTA" = **Call-to-Action**, i.e. your opt-in flow. There's no field literally labeled "CTA" in the form — it maps to the **"How do end-users consent to receive messages?"** box plus the **opt-in URL** referenced there. 30909 means the reviewer opened that URL and couldn't confirm a working consent flow.

Checklist, most-likely cause first:

1. **Open `https://<your-domain>/sms-opt-in` in a logged-out (incognito) browser** — this is the #1 cause. It must show the consent form (phone field, an *unchecked* consent checkbox, the frequency / "msg & data rates" / HELP / STOP disclosures, and Terms + Privacy links). Two ways it commonly fails:
   - **It redirects you to `/login`** → the route isn't on the auth allowlist. Add `path === "/sms-opt-in"` to `isPublic` in `apps/dashboard/lib/supabase/middleware.ts` (next to `/privacy` and `/terms`).
   - **It loads blank (HTTP 200, no form)** → the page is a Server Component and an event handler (`onSubmit`/`onChange`) was added to it, which crashes the render. Keep it 100% static markup.
2. Confirm `https://<your-domain>/privacy` loads and states **mobile numbers are never shared or sold to third parties** — carriers require this assurance.
3. Confirm `https://<your-domain>/terms` loads.
4. In the consent box, describe the flow **and paste the opt-in URL** so the reviewer can reach it. Copy-paste text is in [SMS via Twilio → A2P 10DLC](self-hosting.md#a2p-10dlc-campaign-registration-required-for-us-numbers).
5. Tick the confirmation checkbox and resubmit. You do **not** need to change any dropdown or selection once the opt-in page renders correctly.

## "Notifications are X minutes late"

Check **Stats** page. The "Median latency" is `<pubDate> → notification sent`. If it's high:
- Polling is fine but RSS lags real deal-post → not fixable on our end (Slickdeals' RSS is the floor).
- Polling is slow → check poller cadence env (`POLL_INTERVAL_SECONDS`).
- Pipeline is slow → check Supabase function logs.

## "I'm getting too many notifications"

Options, ordered by aggressiveness:
1. Set **Quiet hours** in Settings.
2. On the noisy alert: change priority to **Silent** so it doesn't ring.
3. Tighten the alert's title-include / max-price filters.
4. Toggle **Digest mode** in Settings to batch non-urgent matches hourly.
5. Disable the alert (paused; keeps history).

## "I want to receive on a service that isn't supported"

If it has a webhook URL (Zapier, IFTTT, Apple Shortcuts, Home Assistant, Slack's incoming webhook, etc.), use the **Generic Webhook** channel.

Otherwise, file an issue with the `feature` label — adding a new provider is a single file plus a dashboard entry.

## "Sign-in link doesn't work"

- The link expires in 10 minutes.
- Make sure your email matches the allowed domain (if set).
- Magic-link clicks must happen in the same browser the link was sent from (Supabase sets cookies that way).
