// Provider registry. To add a new provider:
//   1. Drop a new module in this folder exporting a `Provider`.
//   2. Add an import + entry below.
//   3. Add a setup component to the dashboard's onboarding wizard.

import type { Provider } from "./types.ts";
import { telegramProvider } from "./telegram.ts";
import { ntfyProvider } from "./ntfy.ts";
import { smsTelnyxProvider } from "./sms_telnyx.ts";
import { pushoverProvider } from "./pushover.ts";
import { discordProvider } from "./discord.ts";
import { emailProvider } from "./email.ts";
import { webhookProvider } from "./webhook.ts";

// Legacy stub so existing sms_twilio DB rows don't silently fail — they'll
// get a clear error message in logs rather than an "unknown provider" crash.
// Users should delete their Twilio channel and add SMS via Telnyx.
const smsTwilioLegacy: Provider = {
  type: "sms_twilio",
  displayName: "SMS (Twilio — removed)",
  description: "Twilio has been replaced by Telnyx. Delete this channel and add SMS via Telnyx.",
  requiresGlobalSecrets: false,
  async send(): Promise<{ ok: false; error: string }> {
    return { ok: false, error: "Twilio is no longer supported. Open Settings, delete this channel, and add SMS via Telnyx." };
  },
};

export const providers: Record<string, Provider> = {
  [telegramProvider.type]:    telegramProvider,
  [ntfyProvider.type]:        ntfyProvider,
  [smsTelnyxProvider.type]:   smsTelnyxProvider,
  [smsTwilioLegacy.type]:     smsTwilioLegacy,
  [pushoverProvider.type]:    pushoverProvider,
  [discordProvider.type]:     discordProvider,
  [emailProvider.type]:       emailProvider,
  [webhookProvider.type]:     webhookProvider,
};

export type { Provider, Notification, SendResult, ChannelConfig } from "./types.ts";
