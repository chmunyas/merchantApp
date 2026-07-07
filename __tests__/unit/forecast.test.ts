import { describe, it, expect } from "vitest";

import {
  busiestSlots,
  dailyOutlook,
  peaksByDay,
  prepPlan,
  weekdayName,
  type HourSlot,
  type ItemDowStat,
} from "../../src/lib/forecast";

const slots: HourSlot[] = [
  { dow: 5, hour: 18, avgOrders: 20, avgUnits: 50 },
  { dow: 5, hour: 19, avgOrders: 18, avgUnits: 45 },
  { dow: 5, hour: 12, avgOrders: 5, avgUnits: 12 },
  { dow: 1, hour: 12, avgOrders: 8, avgUnits: 20 },
  { dow: 1, hour: 13, avgOrders: 2, avgUnits: 5 },
];

describe("busiestSlots", () => {
  it("ranks slots by average orders", () => {
    const b = busiestSlots(slots, 2);
    expect(b.map((s) => `${s.dow}-${s.hour}`)).toEqual(["5-18", "5-19"]);
  });
});

describe("peaksByDay", () => {
  it("keeps only hours at >= 70% of the day's peak", () => {
    const p = peaksByDay(slots);
    // Friday peak 20 → threshold 14: 18 (20) and 19 (18) qualify, 12 (5) doesn't
    expect(p[5].map((x) => x.hour)).toEqual([18, 19]);
    // Monday peak 8 → threshold 5.6: 12 (8) qualifies, 13 (2) doesn't
    expect(p[1].map((x) => x.hour)).toEqual([12]);
  });
});

describe("dailyOutlook", () => {
  it("projects each date from its weekday's historical totals", () => {
    const start = new Date("2026-07-10T00:00:00Z");
    const out = dailyOutlook(slots, start, 7);
    expect(out).toHaveLength(7);
    expect(out[0].dow).toBe(start.getUTCDay());
    const fri = out.find((o) => o.dow === 5)!;
    expect(fri.predictedOrders).toBe(43); // 20 + 18 + 5
    expect(fri.predictedUnits).toBe(107); // 50 + 45 + 12
    const wed = out.find((o) => o.dow === 3);
    if (wed) expect(wed.predictedOrders).toBe(0); // no history for Wednesday
  });
});

describe("prepPlan", () => {
  it("blends avg + last, adds a buffer, rounds up and sorts desc", () => {
    const items: ItemDowStat[] = [
      { name: "Nyama", avgUnits: 10, lastUnits: 20, observations: 5 },
      { name: "Soup", avgUnits: 2, lastUnits: 1, observations: 1 },
    ];
    const plan = prepPlan(items, 0.15);
    // Nyama baseline 0.6*10 + 0.4*20 = 14; *1.15 = 16.1 → 17
    expect(plan[0].name).toBe("Nyama");
    expect(plan[0].recommended).toBe(17);
    expect(plan[0].confidence).toBe("high");
    // Soup baseline 0.6*2 + 0.4*1 = 1.6; *1.15 = 1.84 → 2
    expect(plan[1].recommended).toBe(2);
    expect(plan[1].confidence).toBe("low");
  });
});

describe("weekdayName", () => {
  it("maps day-of-week to a name", () => {
    expect(weekdayName(0)).toBe("Sunday");
    expect(weekdayName(6)).toBe("Saturday");
  });
});
