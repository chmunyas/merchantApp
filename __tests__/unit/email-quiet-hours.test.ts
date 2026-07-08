/**
 * Unit tests — Email adapter inbound parsing + SMS quiet-hours gate.
 */
import { describe, it, expect } from "vitest";

import { parseEmailInbound } from "../../src/lib/channels/email";
import { withinQuietHours, hourAtOffset } from "../../src/lib/quiet-hours";

describe("parseEmailInbound", () => {
  it("parses a SendGrid-style inbound (from/text) and extracts the address", () => {
    const [msg] = parseEmailInbound({
      from: "Chris Munyasya <chris@example.com>",
      text: "Do you have a table for 4 tonight?",
      "message-id": "abc123",
    });
    expect(msg.channel).toBe("email");
    expect(msg.handle).toBe("chris@example.com");
    expect(msg.platformUserId).toBe("chris@example.com");
    expect(msg.name).toBe("Chris Munyasya");
    expect(msg.text).toContain("table for 4");
    expect(msg.providerMsgId).toBe("email:abc123");
  });

  it("parses a Mailgun-style inbound (sender/body-plain)", () => {
    const [msg] = parseEmailInbound({
      sender: "guest@domain.co.ke",
      "body-plain": "What time do you open?",
    });
    expect(msg.handle).toBe("guest@domain.co.ke");
    expect(msg.text).toBe("What time do you open?");
  });

  it("ignores a payload without a from/text or a valid address", () => {
    expect(parseEmailInbound({ text: "hi" })).toHaveLength(0);
    expect(parseEmailInbound({ from: "not-an-email", text: "hi" })).toHaveLength(0);
  });
});

describe("withinQuietHours", () => {
  it("handles a window that wraps past midnight (21:00–08:00)", () => {
    expect(withinQuietHours(22, 21, 8)).toBe(true);
    expect(withinQuietHours(3, 21, 8)).toBe(true);
    expect(withinQuietHours(7, 21, 8)).toBe(true);
    expect(withinQuietHours(8, 21, 8)).toBe(false); // end is exclusive
    expect(withinQuietHours(12, 21, 8)).toBe(false);
    expect(withinQuietHours(20, 21, 8)).toBe(false);
  });

  it("handles a same-day window (12:00–14:00)", () => {
    expect(withinQuietHours(13, 12, 14)).toBe(true);
    expect(withinQuietHours(14, 12, 14)).toBe(false);
    expect(withinQuietHours(11, 12, 14)).toBe(false);
  });

  it("treats an empty window (start === end) as never quiet", () => {
    expect(withinQuietHours(3, 9, 9)).toBe(false);
  });
});

describe("hourAtOffset", () => {
  it("returns the wall-clock hour at a UTC offset", () => {
    // 2026-01-01T00:30:00Z at +180 (EAT) is 03:30 -> hour 3.
    expect(hourAtOffset(new Date("2026-01-01T00:30:00Z"), 180)).toBe(3);
  });
});
