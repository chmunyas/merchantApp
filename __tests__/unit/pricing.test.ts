import { describe, it, expect } from "vitest";

import {
  happyHourWindows,
  suggestPrices,
  type DemandSlotLite,
  type PricingInput,
} from "../../src/lib/pricing";

const items: PricingInput[] = [
  {
    name: "Fries",
    category: "Sides",
    price: 500,
    margin: 100,
    unitsSold: 60,
    quadrant: "plowhorse",
    hasCost: true,
  },
  {
    name: "Steak",
    category: "Mains",
    price: 1000,
    margin: 800,
    unitsSold: 50,
    quadrant: "star",
    hasCost: true,
  },
  {
    name: "Lobster",
    category: "Mains",
    price: 1200,
    margin: 900,
    unitsSold: 5,
    quadrant: "puzzle",
    hasCost: true,
  },
  {
    name: "Soup",
    category: "Starters",
    price: 400,
    margin: 50,
    unitsSold: 3,
    quadrant: "dog",
    hasCost: false,
  },
];

describe("suggestPrices", () => {
  const { suggestions, counts, totalWeeklyUpside } = suggestPrices(items, 30);
  const byName = Object.fromEntries(suggestions.map((s) => [s.name, s]));

  it("raises plowhorses ~10% with a positive weekly impact", () => {
    expect(byName.Fries.action).toBe("raise");
    expect(byName.Fries.suggestedPrice).toBe(550); // round(550,10)
    expect(byName.Fries.changePct).toBe(0.1);
    // (550-500) * (60*7/30 = 14) = 700
    expect(byName.Fries.weeklyImpact).toBe(700);
    expect(byName.Fries.confidence).toBe("high");
  });

  it("nudges stars +5%", () => {
    expect(byName.Steak.action).toBe("raise");
    expect(byName.Steak.suggestedPrice).toBe(1050);
    expect(byName.Steak.changePct).toBe(0.05);
  });

  it("promotes puzzles (price held, growth-potential impact)", () => {
    expect(byName.Lobster.action).toBe("promote");
    expect(byName.Lobster.suggestedPrice).toBe(1200);
    expect(byName.Lobster.changePct).toBe(0);
    // 0.25 * (5*7/30 = 1.1667) * 900 = 262.5 → 263
    expect(byName.Lobster.weeklyImpact).toBe(263);
  });

  it("flags dogs for removal and downgrades confidence without a cost", () => {
    expect(byName.Soup.action).toBe("remove");
    expect(byName.Soup.weeklyImpact).toBe(0);
    expect(byName.Soup.confidence).toBe("low");
    expect(byName.Soup.rationale).toMatch(/add an item cost/i);
  });

  it("summarises counts and total upside", () => {
    expect(counts).toEqual({ raise: 2, promote: 1, remove: 1, hold: 0 });
    expect(totalWeeklyUpside).toBeGreaterThan(700);
  });
});

describe("happyHourWindows", () => {
  // Friday: quiet 15–17, busy 18–20.
  const slots: DemandSlotLite[] = [
    { dow: 5, hour: 15, avgOrders: 1 },
    { dow: 5, hour: 16, avgOrders: 1 },
    { dow: 5, hour: 17, avgOrders: 2 },
    { dow: 5, hour: 18, avgOrders: 10 },
    { dow: 5, hour: 19, avgOrders: 12 },
    { dow: 5, hour: 20, avgOrders: 11 },
  ];

  it("finds the contiguous quiet window inside trading hours", () => {
    const w = happyHourWindows(slots);
    expect(w).toHaveLength(1);
    expect(w[0].dow).toBe(5);
    expect(w[0].startHour).toBe(15);
    expect(w[0].endHour).toBe(18); // exclusive → covers 15,16,17
    expect(w[0].weekday).toBe("Friday");
  });

  it("skips days with too little signal", () => {
    const w = happyHourWindows([
      { dow: 2, hour: 12, avgOrders: 5 },
      { dow: 2, hour: 13, avgOrders: 4 },
    ]);
    expect(w).toHaveLength(0);
  });
});
