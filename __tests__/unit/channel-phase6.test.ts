import { describe, expect, it } from "vitest";

import { getAdapter } from "../../src/lib/channels";
import { telegramAdapter } from "../../src/lib/channels/telegram";
import {
  channelWindowDecision,
  isWithinMessagingWindow,
} from "../../src/lib/outbound-policy";

const now = new Date("2026-03-01T12:00:00.000Z");

describe("Phase 6 channel trust boundaries", () => {
  it("rejects unknown channels instead of falling back to web", () => {
    expect(() => getAdapter("carrier-pigeon")).toThrow("unsupported channel");
  });

  it("distinguishes provider acceptance from delivery", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({ ok: true, result: { message_id: 42 } }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    try {
      const result = await telegramAdapter.send(
        "tg:123",
        "hello",
        { TELEGRAM_BOT_TOKEN: "token" },
      );
      expect(result).toMatchObject({
        delivery: "accepted",
        providerMessageId: "42",
        retryable: false,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("fails closed when channel credentials are missing", async () => {
    await expect(telegramAdapter.send("tg:123", "hello", {}, "main")).resolves.toMatchObject({
      delivery: "failed",
      retryable: false,
    });
  });
});

describe("Phase 6 messaging windows", () => {
  it("treats exactly 24 hours as in-window and later messages as out-of-window", () => {
    expect(isWithinMessagingWindow(new Date("2026-02-28T12:00:00.000Z"), now)).toBe(true);
    expect(isWithinMessagingWindow(new Date("2026-02-28T11:59:59.999Z"), now)).toBe(false);
  });

  it("requires approved WhatsApp templates outside the customer-service window", () => {
    const lastInbound = new Date("2026-02-27T12:00:00.000Z");
    expect(channelWindowDecision({ channel: "whatsapp", lastInbound, now })).toMatchObject({ allowed: false });
    expect(channelWindowDecision({ channel: "whatsapp", lastInbound, now, templateApproved: true })).toEqual({ allowed: true });
  });

  it("prevents unsolicited Telegram and out-of-window Instagram automation", () => {
    expect(channelWindowDecision({ channel: "telegram", lastInbound: null, now })).toMatchObject({ allowed: false });
    expect(channelWindowDecision({ channel: "instagram", lastInbound: null, now })).toMatchObject({ allowed: false });
    expect(channelWindowDecision({ channel: "instagram", lastInbound: null, now, replyToInbound: true })).toMatchObject({ allowed: false });
  });
});
