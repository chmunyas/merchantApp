import { describe, it, expect } from "vitest";

import { orderStatusReply } from "../../src/lib/agent";
import { orderReadyMessage, orderStatusMessage } from "../../src/lib/order-notify";

describe("orderReadyMessage", () => {
  it("names the venue and mentions collection", () => {
    const m = orderReadyMessage("Sunset Grill");
    expect(m).toContain("Sunset Grill");
    expect(m).toMatch(/ready for collection/i);
  });

  it("includes the collection slot time when a valid pickup is given", () => {
    const m = orderReadyMessage("Cafe", "2026-07-06T12:30:00Z");
    expect(m).toMatch(/collection slot/i);
  });

  it("falls back gracefully with no venue name", () => {
    expect(orderReadyMessage("")).toContain("the venue");
  });

  it("ignores an invalid pickup time", () => {
    const m = orderReadyMessage("Cafe", "not-a-date");
    expect(m).not.toMatch(/collection slot/i);
  });
});

describe("orderStatusMessage (lifecycle + fulfillment aware)", () => {
  it("acknowledges on accepted", () => {
    const m = orderStatusMessage("accepted", { venueName: "Bistro" });
    expect(m).toContain("Bistro");
    expect(m).toMatch(/received your order/i);
  });

  it("signals preparation on preparing", () => {
    expect(orderStatusMessage("preparing", {})).toMatch(/being prepared/i);
  });

  it("says 'to your table' for dine-in ready, not collection", () => {
    const m = orderStatusMessage("ready", { fulfillment: "dine_in" })!;
    expect(m).toMatch(/to your table/i);
    expect(m).not.toMatch(/collection/i);
  });

  it("says collection (with slot) for collection ready", () => {
    const m = orderStatusMessage("ready", {
      fulfillment: "collection",
      scheduledAt: "2026-07-06T12:30:00Z",
    })!;
    expect(m).toMatch(/ready for collection/i);
    expect(m).toMatch(/collection slot/i);
  });

  it("returns null for statuses the customer should not be alerted on", () => {
    expect(orderStatusMessage("new", {})).toBeNull();
    expect(orderStatusMessage("served", {})).toBeNull();
    expect(orderStatusMessage("cancelled", {})).toBeNull();
  });
});

describe("orderStatusReply (agent 'where is my order')", () => {
  it("reports preparation", () => {
    expect(orderStatusReply("preparing")).toMatch(/being prepared/i);
  });

  it("differentiates dine-in vs collection when ready", () => {
    expect(orderStatusReply("ready", "dine_in")).toMatch(/to your table/i);
    expect(orderStatusReply("ready", "collection")).toMatch(/collection/i);
  });

  it("includes a collection slot time when scheduled", () => {
    const m = orderStatusReply("accepted", "collection", "2026-07-06T12:30:00Z");
    expect(m).toMatch(/collection slot/i);
  });

  it("handles unknown status defensively", () => {
    expect(orderStatusReply("weird")).toMatch(/weird/);
  });
});
