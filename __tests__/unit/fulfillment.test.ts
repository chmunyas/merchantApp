/**
 * Unit tests — order fulfillment helpers (pre-order for collection / dine-in).
 */
import { describe, it, expect } from "vitest";

import {
  fulfillmentLabel,
  normalizeFulfillment,
  parseScheduledAt,
} from "../../src/lib/fulfillment";

describe("normalizeFulfillment", () => {
  it("maps common aliases to the canonical type", () => {
    expect(normalizeFulfillment("collection")).toBe("collection");
    expect(normalizeFulfillment("takeaway")).toBe("collection");
    expect(normalizeFulfillment("pickup")).toBe("collection");
    expect(normalizeFulfillment("eat-in")).toBe("dine_in");
    expect(normalizeFulfillment("dine_in")).toBe("dine_in");
    expect(normalizeFulfillment("delivery")).toBe("delivery");
  });

  it("defaults to dine_in for blank/unknown values", () => {
    expect(normalizeFulfillment("")).toBe("dine_in");
    expect(normalizeFulfillment(undefined)).toBe("dine_in");
    expect(normalizeFulfillment("something")).toBe("dine_in");
  });
});

describe("parseScheduledAt", () => {
  const now = new Date("2026-07-08T12:00:00Z");

  it("accepts a future time and returns ISO", () => {
    const iso = parseScheduledAt("2026-07-08T19:30:00Z", now);
    expect(iso).toBe(new Date("2026-07-08T19:30:00Z").toISOString());
  });

  it("treats a blank / past / invalid value as ASAP (null)", () => {
    expect(parseScheduledAt("", now)).toBeNull();
    expect(parseScheduledAt(undefined, now)).toBeNull();
    expect(parseScheduledAt("2020-01-01T00:00:00Z", now)).toBeNull();
    expect(parseScheduledAt("not-a-date", now)).toBeNull();
  });
});

describe("fulfillmentLabel", () => {
  it("labels each type", () => {
    expect(fulfillmentLabel("collection")).toBe("Collection");
    expect(fulfillmentLabel("delivery")).toBe("Delivery");
    expect(fulfillmentLabel("dine_in")).toBe("Dine-in");
  });
});
