import { describe, it, expect } from "vitest";

import { parseTranslation, recommendUpsells } from "../../src/lib/menu-ai";

const menu = [
  { id: "m1", name: "Nyama Choma", category: "Mains", price: 1450, available: true },
  { id: "s1", name: "Chapati", category: "Sides", price: 220, available: true },
  { id: "d1", name: "Tusker", category: "Drinks", price: 340, available: true },
  { id: "d2", name: "Passion Soda", category: "Drinks", price: 180, available: false },
  { id: "des1", name: "Fudge Cake", category: "Desserts", price: 420, available: true },
];

describe("recommendUpsells", () => {
  it("suggests a drink + dessert when the cart has food but neither", () => {
    const recs = recommendUpsells(menu, [{ id: "m1", category: "Mains" }]);
    const cats = recs.map((r) => r.item.category);
    expect(cats).toContain("Drinks");
    expect(cats).toContain("Desserts");
    // cheapest AVAILABLE drink (d1, not the unavailable cheaper d2)
    expect(recs.find((r) => r.item.category === "Drinks")?.item.id).toBe("d1");
  });

  it("never recommends an unavailable or already-in-cart item", () => {
    const recs = recommendUpsells(menu, [
      { id: "m1", category: "Mains" },
      { id: "d1", category: "Drinks" },
    ]);
    const ids = recs.map((r) => r.item.id);
    expect(ids).not.toContain("d1"); // in cart
    expect(ids).not.toContain("d2"); // unavailable
  });

  it("caps at max", () => {
    expect(recommendUpsells(menu, [], 2).length).toBeLessThanOrEqual(2);
  });
});

describe("parseTranslation", () => {
  it("parses a fenced JSON array of the right length", () => {
    const out = parseTranslation(
      '```json\n[{"name":"A","description":"x"},{"name":"B","description":"y"}]\n```',
      2,
    );
    expect(out).toEqual([
      { name: "A", description: "x" },
      { name: "B", description: "y" },
    ]);
  });

  it("returns null on garbage or a length mismatch", () => {
    expect(parseTranslation("not json", 2)).toBeNull();
    expect(parseTranslation('[{"name":"A"}]', 2)).toBeNull();
    expect(parseTranslation(null, 2)).toBeNull();
  });
});
