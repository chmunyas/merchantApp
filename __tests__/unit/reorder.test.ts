import { describe, it, expect } from "vitest";

import { planReorder, type InventoryStat } from "../../src/lib/reorder";

const items: InventoryStat[] = [
  {
    id: "milk",
    name: "Milk",
    sku: "MLK",
    unit: "L",
    stock: 5,
    reorderLevel: 10,
    cost: 50,
    supplier: "Dairy Co",
    consumedInWindow: 60, // 2/day → 2.5 days left (< 3-day lead) → critical
  },
  {
    id: "bread",
    name: "Bread",
    sku: null,
    unit: "loaf",
    stock: 40,
    reorderLevel: 10,
    cost: 40,
    supplier: "Bakery",
    consumedInWindow: 30, // 1/day → 40 days left → ok
  },
  {
    id: "rice",
    name: "Rice",
    sku: "RCE",
    unit: "kg",
    stock: 8,
    reorderLevel: 20,
    cost: 120,
    supplier: "Dairy Co",
    consumedInWindow: 0, // no velocity but below reorder level → low
  },
  {
    id: "soda",
    name: "Soda",
    sku: null,
    unit: "bottle",
    stock: 200,
    reorderLevel: 20,
    cost: 30,
    supplier: "Bev",
    consumedInWindow: 30, // 1/day → 200 days left → overstocked
  },
];

describe("planReorder", () => {
  const plan = planReorder(items, {
    windowDays: 30,
    leadTimeDays: 3,
    coverDays: 14,
  });
  const byId = Object.fromEntries(plan.lines.map((l) => [l.id, l]));

  it("classifies stock status from velocity + reorder level", () => {
    expect(byId.milk.status).toBe("critical");
    expect(byId.bread.status).toBe("ok");
    expect(byId.rice.status).toBe("low");
    expect(byId.soda.status).toBe("overstocked");
    expect(plan.counts).toEqual({
      critical: 1,
      low: 1,
      ok: 1,
      overstocked: 1,
    });
  });

  it("computes days left and top-up quantities to the cover target", () => {
    expect(byId.milk.daysLeft).toBe(2.5);
    // target = max(2*(3+14)=34, 10) = 34; qty = ceil(34-5) = 29
    expect(byId.milk.suggestedQty).toBe(29);
    expect(byId.milk.lineCost).toBe(29 * 50);
    // rice: no velocity → target = reorderLevel 20; qty = ceil(20-8) = 12
    expect(byId.rice.suggestedQty).toBe(12);
    expect(byId.bread.suggestedQty).toBe(0);
    expect(byId.soda.suggestedQty).toBe(0);
  });

  it("drafts supplier-grouped purchase orders, critical first", () => {
    expect(plan.toOrder.map((l) => l.id)).toEqual(["milk", "rice"]);
    const dairy = plan.bySupplier.find((s) => s.supplier === "Dairy Co")!;
    expect(dairy.lines.map((l) => l.id).sort()).toEqual(["milk", "rice"]);
    expect(dairy.totalCost).toBe(29 * 50 + 12 * 120); // 1450 + 1440
    expect(plan.totalReorderCost).toBe(29 * 50 + 12 * 120);
  });

  it("falls back to an Unassigned supplier bucket", () => {
    const plan2 = planReorder(
      [
        {
          id: "x",
          name: "X",
          sku: null,
          unit: "unit",
          stock: 0,
          reorderLevel: 5,
          cost: 10,
          supplier: null,
          consumedInWindow: 0,
        },
      ],
      {},
    );
    expect(plan2.bySupplier[0].supplier).toBe("Unassigned");
    expect(plan2.lines[0].status).toBe("critical"); // stock 0
  });
});
