// Channel abstraction — one uniform surface for every messaging channel, so the
// inbound pipeline and the Inbox never special-case a provider. Mirrors Omni's
// BaseChannelPlugin/ChannelCapabilities pattern, adapted to our serverless stack.

export type ChannelId =
  | "whatsapp"
  | "web"
  | "telegram"
  | "instagram"
  | "sms";

export type ChannelCapabilities = {
  canSendText: boolean;
  canSendMedia: boolean;
  canReceiveReceipts: boolean;
  requiresWebhookVerify: boolean;
  // "push" = the channel actively delivers outbound (WhatsApp/SMS).
  // "pull" = the client fetches replies (web widget polling / websocket).
  outboundMode: "push" | "pull";
};

// A normalized inbound message, produced by each adapter's parser.
export type InboundMessage = {
  channel: ChannelId;
  // Channel-native conversation handle used as conversations.wa_id, e.g.
  // '+2547...' (whatsapp) or 'web:<sessionId>'. Guaranteed collision-free.
  handle: string;
  // The native user id for the identity graph (phone, session id, tg id...).
  platformUserId: string;
  name: string | null;
  text: string;
  // Provider message id for inbound dedupe (null when none, e.g. simulator).
  providerMsgId: string | null;
};

export type OutboundResult = { delivery: "sent" | "simulated" | "pull" };

export type ChannelAdapter = {
  id: ChannelId;
  capabilities: ChannelCapabilities;
  // Deliver an outbound reply. "pull" channels persist only (handled upstream).
  send(handle: string, text: string, env: unknown): Promise<OutboundResult>;
  // Optional GET webhook verification handshake (Meta-style hub.challenge).
  verifyWebhook?(url: URL, env: unknown): Response | null;
  // Optional inbound normalizer for this channel's webhook payload.
  parseInbound?(body: unknown): InboundMessage[];
};
