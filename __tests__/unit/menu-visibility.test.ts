import { describe, expect, it } from "vitest";

import {
  formatWindow,
  isVisibilityWindow,
  menuVisibleAt,
  menuVisibleAtLocal,
  resolveMenuMode,
  visibleMenus,
  windowCoversLocal,
  type SchedulableMenu,
  type VisibilityWindow,
} from "../../src/lib/menu-visibility";
import { localDayAndMinutes } from "../../src/lib/business-day";

const NAIROBI = "Africa/Nairobi"; // UTC+3, no DST
const LONDON = "Europe/London"; // UTC+0 / UTC+1, has DST

const window = (
  day: number,
  startMinutes: number,
  endMinutes: number,
): VisibilityWindow => ({ day, startMinutes, endMinutes });

// Sunday's documented example: "For a Lunch Menu, select Monday through Friday
// and set the hours from 9:00 AM to 2:59 PM."
const LUNCH = [1, 2, 3, 4, 5].map((day) => window(day, 9 * 60, 14 * 60 + 59));

const menu = (over: Partial<SchedulableMenu> = {}): SchedulableMenu => ({
  id: "menu-1",
  name: "Lunch",
  isActive: true,
  visibleOnPayAtTable: true,
  displayOrder: 0,
  windows: [],
  ...over,
});

describe("visibility window validation", () => {
  it("accepts a well-formed window and rejects out-of-range values", () => {
    expect(isVisibilityWindow(window(0, 0, 1439))).toBe(true);
    expect(isVisibilityWindow(window(7, 0, 60))).toBe(false);
    expect(isVisibilityWindow(window(-1, 0, 60))).toBe(false);
    expect(isVisibilityWindow(window(1, 0, 1440))).toBe(false);
    expect(isVisibilityWindow({ day: 1, startMinutes: 9.5, endMinutes: 60 })).toBe(
      false,
    );
    expect(isVisibilityWindow(null)).toBe(false);
    expect(isVisibilityWindow([window(1, 0, 60)])).toBe(false);
  });
});

describe("windowCoversLocal — same-day ranges", () => {
  const lunch = window(1, 9 * 60, 14 * 60 + 59); // Monday 09:00–14:59

  it("is inside the window at the start minute", () => {
    expect(windowCoversLocal(lunch, 1, 9 * 60)).toBe(true);
  });

  it("is inside the window at the documented 14:59 end minute", () => {
    expect(windowCoversLocal(lunch, 1, 14 * 60 + 59)).toBe(true);
  });

  it("is outside one minute before and one minute after", () => {
    expect(windowCoversLocal(lunch, 1, 9 * 60 - 1)).toBe(false);
    expect(windowCoversLocal(lunch, 1, 15 * 60)).toBe(false);
  });

  it("does not leak into an adjacent day", () => {
    expect(windowCoversLocal(lunch, 0, 12 * 60)).toBe(false); // Sunday
    expect(windowCoversLocal(lunch, 2, 12 * 60)).toBe(false); // Tuesday
  });

  it("treats start === end as a one-minute window, not all day", () => {
    const instant = window(3, 12 * 60, 12 * 60);
    expect(windowCoversLocal(instant, 3, 12 * 60)).toBe(true);
    expect(windowCoversLocal(instant, 3, 12 * 60 + 1)).toBe(false);
    expect(windowCoversLocal(instant, 3, 0)).toBe(false);
  });
});

describe("windowCoversLocal — overnight ranges", () => {
  // Friday 21:00 → Saturday 02:00.
  const lateNight = window(5, 21 * 60, 2 * 60);

  it("covers the tail of its own day", () => {
    expect(windowCoversLocal(lateNight, 5, 21 * 60)).toBe(true);
    expect(windowCoversLocal(lateNight, 5, 23 * 60 + 59)).toBe(true);
  });

  it("covers the head of the following day", () => {
    expect(windowCoversLocal(lateNight, 6, 0)).toBe(true);
    expect(windowCoversLocal(lateNight, 6, 2 * 60)).toBe(true);
  });

  it("stops at the end minute on the following day", () => {
    expect(windowCoversLocal(lateNight, 6, 2 * 60 + 1)).toBe(false);
  });

  it("does not cover the gap before the window opens", () => {
    expect(windowCoversLocal(lateNight, 5, 20 * 60 + 59)).toBe(false);
    expect(windowCoversLocal(lateNight, 4, 23 * 60)).toBe(false);
  });

  it("wraps Saturday into Sunday across the week boundary", () => {
    const saturdayNight = window(6, 22 * 60, 60); // Sat 22:00 → Sun 01:00
    expect(windowCoversLocal(saturdayNight, 6, 23 * 60)).toBe(true);
    expect(windowCoversLocal(saturdayNight, 0, 30)).toBe(true);
    expect(windowCoversLocal(saturdayNight, 0, 61)).toBe(false);
  });
});

describe("menuVisibleAtLocal", () => {
  it("is always visible when no schedule has been set", () => {
    expect(menuVisibleAtLocal([], 3, 4 * 60)).toBe(true);
  });

  it("matches Sunday's Monday-to-Friday lunch example", () => {
    expect(menuVisibleAtLocal(LUNCH, 1, 12 * 60)).toBe(true); // Monday noon
    expect(menuVisibleAtLocal(LUNCH, 5, 14 * 60 + 59)).toBe(true); // Friday 14:59
    expect(menuVisibleAtLocal(LUNCH, 5, 15 * 60)).toBe(false); // Friday 15:00
    expect(menuVisibleAtLocal(LUNCH, 6, 12 * 60)).toBe(false); // Saturday
    expect(menuVisibleAtLocal(LUNCH, 0, 12 * 60)).toBe(false); // Sunday
  });

  it("ignores malformed windows rather than throwing", () => {
    const windows = [
      { day: 9, startMinutes: 0, endMinutes: 60 } as VisibilityWindow,
      window(1, 9 * 60, 10 * 60),
    ];
    expect(menuVisibleAtLocal(windows, 1, 9 * 60 + 30)).toBe(true);
    expect(menuVisibleAtLocal(windows, 1, 11 * 60)).toBe(false);
  });

  it("falls back to always-visible when every window is malformed", () => {
    const windows = [{ day: 9, startMinutes: -5, endMinutes: 60 } as VisibilityWindow];
    expect(menuVisibleAtLocal(windows, 1, 11 * 60)).toBe(true);
  });
});

describe("venue timezone resolution", () => {
  it("reads the local weekday and minute in the venue timezone, not UTC", () => {
    // 2026-03-02 is a Monday. 22:30 UTC is already Tuesday 01:30 in Nairobi.
    const instant = new Date("2026-03-02T22:30:00Z");
    expect(localDayAndMinutes(instant, "UTC")).toEqual({ day: 1, minutes: 22 * 60 + 30 });
    expect(localDayAndMinutes(instant, NAIROBI)).toEqual({ day: 2, minutes: 90 });
  });

  it("shows a Nairobi lunch menu at local noon, not UTC noon", () => {
    // Monday 2026-03-02, 09:00 UTC = 12:00 in Nairobi.
    expect(menuVisibleAt(LUNCH, new Date("2026-03-02T09:00:00Z"), NAIROBI)).toBe(true);
    // Monday 15:00 UTC = 18:00 Nairobi — closed, even though it is noon-ish UTC.
    expect(menuVisibleAt(LUNCH, new Date("2026-03-02T15:00:00Z"), NAIROBI)).toBe(false);
  });

  it("crosses the local day boundary correctly for a late-night menu", () => {
    const lateNight = [window(5, 21 * 60, 2 * 60)]; // Fri 21:00 → Sat 02:00
    // Friday 2026-03-06 23:00 Nairobi = 20:00 UTC.
    expect(menuVisibleAt(lateNight, new Date("2026-03-06T20:00:00Z"), NAIROBI)).toBe(true);
    // Saturday 01:00 Nairobi = Friday 22:00 UTC — still inside the window.
    expect(menuVisibleAt(lateNight, new Date("2026-03-06T22:00:00Z"), NAIROBI)).toBe(true);
    // Saturday 03:00 Nairobi = Saturday 00:00 UTC — closed.
    expect(menuVisibleAt(lateNight, new Date("2026-03-07T00:00:00Z"), NAIROBI)).toBe(false);
  });

  it("respects daylight saving in the venue timezone", () => {
    const breakfast = [window(0, 9 * 60, 10 * 60)]; // Sunday 09:00–10:00 local
    // 2026-06-14 is a Sunday; London is BST (UTC+1), so 08:30 UTC = 09:30 local.
    expect(menuVisibleAt(breakfast, new Date("2026-06-14T08:30:00Z"), LONDON)).toBe(true);
    // 2026-01-11 is a Sunday; London is GMT, so 08:30 UTC = 08:30 local — closed.
    expect(menuVisibleAt(breakfast, new Date("2026-01-11T08:30:00Z"), LONDON)).toBe(false);
  });
});

describe("visibleMenus", () => {
  const noon = new Date("2026-03-02T09:00:00Z"); // Monday 12:00 Nairobi

  it("hides inactive menus regardless of schedule", () => {
    const menus = [menu({ isActive: false, windows: LUNCH })];
    expect(visibleMenus(menus, noon, NAIROBI)).toEqual([]);
  });

  it("hides a menu that is not marked visible on Pay at Table, on that surface only", () => {
    const menus = [menu({ visibleOnPayAtTable: false })];
    expect(visibleMenus(menus, noon, NAIROBI, "qr")).toHaveLength(1);
    expect(visibleMenus(menus, noon, NAIROBI, "pay-at-table")).toHaveLength(0);
  });

  it("returns menus in the merchant's display order, then by name", () => {
    const menus = [
      menu({ id: "c", name: "Drinks", displayOrder: 2 }),
      menu({ id: "a", name: "Zebra", displayOrder: 0 }),
      menu({ id: "b", name: "Apple", displayOrder: 0 }),
    ];
    expect(visibleMenus(menus, noon, NAIROBI).map((m) => m.id)).toEqual([
      "b",
      "a",
      "c",
    ]);
  });

  it("filters on the schedule at the moment of the scan", () => {
    const menus = [
      menu({ id: "lunch", name: "Lunch", windows: LUNCH }),
      menu({ id: "dinner", name: "Dinner", windows: [window(1, 18 * 60, 22 * 60)] }),
    ];
    expect(visibleMenus(menus, noon, NAIROBI).map((m) => m.id)).toEqual(["lunch"]);
    const evening = new Date("2026-03-02T16:00:00Z"); // Monday 19:00 Nairobi
    expect(visibleMenus(menus, evening, NAIROBI).map((m) => m.id)).toEqual(["dinner"]);
  });
});

describe("resolveMenuMode — C6.1 / C6.12", () => {
  const external = { name: "Wine list", kind: "pdf" as const, url: "https://cdn.test/a.pdf" };

  it("serves the dynamic menu and suppresses the PDF when the toggle is on", () => {
    expect(
      resolveMenuMode({ dynamicMenuEnabled: true, externalMenu: external }),
    ).toEqual({ mode: "dynamic", external: null });
  });

  it("restores the external menu when the toggle is turned back off", () => {
    expect(
      resolveMenuMode({ dynamicMenuEnabled: false, externalMenu: external }),
    ).toEqual({ mode: "external", external });
  });

  it("reports 'none' when neither is configured", () => {
    expect(
      resolveMenuMode({ dynamicMenuEnabled: false, externalMenu: null }),
    ).toEqual({ mode: "none", external: null });
  });
});

describe("formatWindow", () => {
  it("renders zero-padded venue-local times", () => {
    expect(formatWindow(window(1, 9 * 60, 14 * 60 + 59))).toBe("09:00–14:59");
    expect(formatWindow(window(1, 0, 5))).toBe("00:00–00:05");
  });
});
