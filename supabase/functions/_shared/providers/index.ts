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

export const providers: Record<string, Provider> = {
  [telegramProvider.type]:    telegramProvider,
  [ntfyProvider.type]:        ntfyProvider,
  [smsTelnyxProvider.type]:   smsTelnyxProvider,
  [pushoverProvider.type]:    pushoverProvider,
  [discordProvider.type]:     discordProvider,
  [emailProvider.type]:       emailProvider,
  [webhookProvider.type]:     webhookProvider,
};

export type { Provider, Notification, SendResult, ChannelConfig } from "./types.ts";
