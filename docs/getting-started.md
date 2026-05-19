# Getting started (end user)

This is for **coworkers using the shared instance**. (Self-hosting? See `self-hosting.md`.)

## 1. Sign in

1. Go to the dashboard URL (ask the admin).
2. Enter your email, hit **Email me a link**.
3. Open the email, click the link. You'll land in the setup wizard.

## 2. Pick how you want to be notified

You can pick one or many. You can change later from Settings.

| Channel | What you need | Pros | Cons |
|---|---|---|---|
| **Telegram** | Telegram app installed | Free, fastest, supports Save/Dismiss buttons inline | Requires Telegram account |
| **SMS** | A phone number | Works without internet | Costs the admin a fraction of a cent per message |
| **ntfy.sh** | The free [ntfy app](https://ntfy.sh/app) | Free, open source, no account | One more app on your phone |
| **Pushover** | Pushover account + $5 one-time | Best polish, "emergency" priority bypasses DND | Costs $5 |
| **Discord** | A Discord webhook URL | Routes to a team channel easily | Public-ish (anyone in the channel sees it) |
| **Email** | An email address | Lowest friction | Slowest |
| **Webhook** | Any URL that accepts POST | Wire up to Zapier, IFTTT, Apple Shortcuts, home automation | More setup |

## 3. Connect each channel

The wizard walks you through each one you picked. Most are "paste a URL or address." A few need verification:

- **Telegram:** the wizard shows you a 6-character code. Tap the deep link (or send `/link CODE` to the bot). The wizard waits and turns green when it's done.
- **SMS:** you'll get a text with a 6-character code. Paste it back in.

## 4. Add your first alert

Open **slickdeals.net** in another tab. Build any search:
- Type keywords in the search box.
- Apply filters: store, category, price range, on the page.
- Click the **RSS icon** (orange feed symbol) on the results page.
- **Copy the URL.**

Back on the dashboard, paste that URL. Give the alert a name. Save.

> 💡 You don't need to use Slickdeals' "Deal Alert" feature at all. Any search-with-filters URL has an RSS feed.

## 5. Wait for matches

When a deal posts that matches your search, you'll see it in two places:
1. Your phone, via whichever channels you set up.
2. The dashboard **Feed** page, sorted newest-first.

## Day-to-day use

- **Save** interesting deals (★) for later.
- **Dismiss** ones you don't care about.
- Filter the feed by Unread / Saved / Dismissed.
- Each notification has a **View Deal** link straight to Slickdeals.
- Telegram notifications also have **Save** / **Dismiss** inline buttons.

## Adding more alerts

**Alerts → + New alert.** Same paste-RSS-URL flow. You can also:

- Add **extra filters** on top of the RSS (title must include/exclude, min/max price).
- Pick which channels this alert routes to (or leave empty = all channels).
- Set a per-alert **priority** (urgent bypasses your quiet hours).

## Settings worth knowing

- **Quiet hours** — silence non-urgent notifications during a time window.
- **Timezone** — make sure this is right or quiet hours will be off.
- **Digest mode** — batch non-urgent matches into hourly summaries.
- **Send test** on any channel to confirm it's wired up.
