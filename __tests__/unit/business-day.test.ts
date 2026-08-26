import { describe, expect, it } from "vitest";

import {
  businessDateFor,
  formatMinutes,
  isVenueServiceSettings,
  parseTime,
} from "../../src/lib/business-day";

describe("venue business day", () => {
  it("uses the venue-local 04:00 boundary", () => {
    expect(businessDateFor(new Date("2026-08-24T00:59:00Z"), "Africa/Nairobi", 240)).toBe("2026-08-23");
    expect(businessDateFor(new Date("2026-08-24T01:00:00Z"), "Africa/Nairobi", 240)).toBe("2026-08-24");
  });

  it("validates bounded daily lunch and dinner hours", () => {
    expect(isVenueServiceSettings({
      businessDayStartMinutes: 240,
      serviceHours: [{ day: 1, service: "lunch", startMinutes: 720, endMinutes: 900 }],
    })).toBe(true);
    expect(isVenueServiceSettings({ businessDayStartMinutes: 1440, serviceHours: [] })).toBe(false);
    expect(isVenueServiceSettings({ businessDayStartMinutes: 240, serviceHours: [{ day: 7 }] })).toBe(false);
  });

  it("round-trips HTML time values", () => {
    expect(parseTime("04:00")).toBe(240);
    expect(parseTime("24:00")).toBeNull();
    expect(formatMinutes(240)).toBe("04:00");
  });
});
