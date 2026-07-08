/**
 * Unit tests — dispute / chargeback classification + status normalization.
 */
import { describe, it, expect } from "vitest";

import { isDisputeEvent, mapDisputeStatus } from "../../src/lib/disputes";

describe("isDisputeEvent", () => {
  it("detects a dispute by the resource dispute_id", () => {
    expect(isDisputeEvent("payment.updated", { dispute_id: "dp_1" })).toBe(true);
  });

  it("detects a dispute / chargeback by the event name", () => {
    expect(isDisputeEvent("dispute.created", {})).toBe(true);
    expect(isDisputeEvent("payment_chargeback", {})).toBe(true);
    expect(isDisputeEvent("DISPUTE_OPENED", {})).toBe(true);
  });

  it("does NOT flag a normal payment or refund event", () => {
    expect(isDisputeEvent("payment_succeeded", {})).toBe(false);
    expect(isDisputeEvent("refund.created", { refund_id: "re_1" })).toBe(false);
  });
});

describe("mapDisputeStatus", () => {
  it("normalises provider statuses to our lifecycle", () => {
    expect(mapDisputeStatus("dispute_opened")).toBe("open");
    expect(mapDisputeStatus("warning_needs_response")).toBe("open");
    expect(mapDisputeStatus("under_review")).toBe("under_review");
    expect(mapDisputeStatus("dispute_challenged")).toBe("under_review");
    expect(mapDisputeStatus("dispute_won")).toBe("won");
    expect(mapDisputeStatus("dispute_lost")).toBe("lost");
    expect(mapDisputeStatus("dispute_cancelled")).toBe("withdrawn");
  });

  it("defaults to open when empty and passes through an unknown status", () => {
    expect(mapDisputeStatus("")).toBe("open");
    expect(mapDisputeStatus(null)).toBe("open");
    expect(mapDisputeStatus("some_new_status")).toBe("some_new_status");
  });
});
