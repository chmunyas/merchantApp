import { describe, it, expect } from "vitest";

import {
  buildHeadline,
  classifyMenu,
  type MenuStat,
} from "../../src/lib/menu-engineering";

const fixture: MenuStat[] = [
  { name: "Steak", category: "Mains", price: 1000, cost: 200, unitsSold: 50 }, // star
  { name: "Fries", category: "Sides", price: 500, cost: 400, unitsSold: 60 }, // plowhorse
  { name: "Lobster", category: "Mains", price: 1200, cost: 300, unitsSold: 5 }, // puzzle
  { name: "Soup", category: "Starters", price: 400, cost: 350, unitsSold: 3 }, // dog
];

describe("classifyMenu", () => {
  const result = classifyMenu(fixture);
  const byName = Object.fromEntries(result.items.map((i) => [i.name, i]));

  it("assigns the four quadrants correctly", () => {
    expect(byName.Steak.quadrant).toBe("star");
    expect(byName.Fries.quadrant).toBe("plowhorse");
    expect(byName.Lobster.quadrant).toBe("puzzle");
    expect(byName.Soup.quadrant).toBe("dog");
  });

  it("computes margin, menu-mix and the 70% popularity threshold", () => {
    expect(byName.Steak.margin).toBe(800);
    expect(result.totalUnits).toBe(118);
    expect(result.popularityThreshold).toBe(0.18); // (1/4)*0.7 rounded
    expect(byName.Steak.menuMixPct).toBeCloseTo(50 / 118, 2);
    // weighted avg CM per unit = 50650 / 118
    expect(result.avgMarginPerUnit).toBeCloseTo(429.24, 1);
  });

  it("counts quadrants and sorts stars first", () => {
    expect(result.counts).toEqual({
      star: 1,
      plowhorse: 1,
      puzzle: 1,
      dog: 1,
    });
    expect(result.items[0].quadrant).toBe("star");
  });

  it("flags items without a cost", () => {
    const [item] = classifyMenu([
      { name: "Mystery", category: "Mains", price: 900, cost: 0, unitsSold: 10 },
    ]).items;
    expect(item.hasCost).toBe(false);
    expect(item.recommendation).toMatch(/unit cost/i);
  });

  it("treats every item as unpopular when nothing has sold", () => {
    const zero = classifyMenu([
      { name: "A", category: "Mains", price: 500, cost: 100, unitsSold: 0 },
      { name: "B", category: "Mains", price: 300, cost: 250, unitsSold: 0 },
    ]);
    expect(zero.totalUnits).toBe(0);
    expect(zero.items.every((i) => i.popularity === "low")).toBe(true);
    // profitability axis still splits on margin
    expect(zero.items.find((i) => i.name === "A")!.profitability).toBe("high");
  });
});

describe("buildHeadline", () => {
  it("summarises counts with actions", () => {
    const h = buildHeadline({ star: 2, plowhorse: 1, puzzle: 0, dog: 3 });
    expect(h).toMatch(/2 stars/);
    expect(h).toMatch(/raise prices on plowhorses/);
    expect(h).toMatch(/rework or retire dogs/);
  });

  it("handles an empty menu", () => {
    expect(buildHeadline({ star: 0, plowhorse: 0, puzzle: 0, dog: 0 })).toMatch(
      /No menu items/i,
    );
  });
});
