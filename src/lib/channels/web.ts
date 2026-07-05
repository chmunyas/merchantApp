import type { ChannelAdapter, OutboundResult } from "./types";

// The in-app web chat widget. Outbound replies are persisted and pulled by the
// widget (polling / websocket), so send() is a no-op that reports "pull".
export const webAdapter: ChannelAdapter = {
  id: "web",
  capabilities: {
    canSendText: true,
    canSendMedia: false,
    canReceiveReceipts: false,
    requiresWebhookVerify: false,
    outboundMode: "pull",
  },
  async send(): Promise<OutboundResult> {
    return { delivery: "pull" };
  },
};

// Build the collision-free conversation handle for a web session.
export function webHandle(sessionId: string): string {
  return `web:${sessionId}`;
}
