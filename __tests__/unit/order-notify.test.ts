import { describe, it, expect } from "vitest";

import { orderReadyMessage } from "../../src/lib/order-notify";

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
