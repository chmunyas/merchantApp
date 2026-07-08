import { emailAdapter } from "./email";
import { instagramAdapter } from "./instagram";
import { smsAdapter } from "./sms";
import { telegramAdapter } from "./telegram";
import { webAdapter } from "./web";
import { whatsappAdapter } from "./whatsapp";

import type { ChannelAdapter, ChannelId } from "./types";

// Plugin registry — look an adapter up by channel id. Adding a channel is a
// one-line registration here plus its adapter file (zero pipeline changes).
const registry: Record<string, ChannelAdapter> = {
  [whatsappAdapter.id]: whatsappAdapter,
  [webAdapter.id]: webAdapter,
  [telegramAdapter.id]: telegramAdapter,
  [instagramAdapter.id]: instagramAdapter,
  [smsAdapter.id]: smsAdapter,
  [emailAdapter.id]: emailAdapter,
};

export function getAdapter(channel: ChannelId | string): ChannelAdapter {
  return registry[channel] ?? webAdapter;
}

export function listChannels(): ChannelId[] {
  return Object.keys(registry) as ChannelId[];
}

export type { ChannelAdapter, ChannelId } from "./types";
export { verifyWhatsappWebhook, parseWhatsappInbound } from "./whatsapp";
export { webHandle } from "./web";
