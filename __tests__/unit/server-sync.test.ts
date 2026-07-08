/**
 * Unit tests — server → localStorage hydration mappers.
 * The server (menu_items / dining_tables) is authoritative for its columns, but
 * the mapping must PRESERVE client-only decorations (menu modifiers/image, a
 * table's live open-order session) so hydration never wipes local richness.
 */
import { describe, it, expect } from "vitest";

import { mapApiMenuItem, mapApiTable } from "../../src/lib/server-sync";
import type { MerchantTable } from "../../src/lib/merchant-dashboard";
import type { CatalogueItem } from "../../src/components/merchant/features/types";

describe("mapApiMenuItem", () => {
  it("maps the server columns and routes drinks to the bar", () => {
    const item = mapApiMenuItem({
      id: "m1",
      name: "Latte",
      category: "Drinks",
      price: "350",
      dietary: ["vegan"],
      available: true,
    });
    expect(item.id).toBe("m1");
    expect(item.price).toBe(350);
    expect(item.category).toBe("Drinks");
    expect(item.destination).toBe("bar");
    expect(item.available).toBe(true);
  });

  it("routes food to the kitchen", () => {
    expect(
      mapApiMenuItem({ id: "m2", name: "Pilau", category: "Mains", price: 780 })
        .destination,
    ).toBe("kitchen");
  });

  it("lets the server win on price but preserves client-only fields", () => {
    const base = mapApiMenuItem({
      id: "m1",
      name: "Latte",
      category: "Drinks",
      price: 350,
    });
    const existing: CatalogueItem = {
      ...base,
      image: "data:img",
      description: "House blend",
      modifiers: [
        { id: "x", name: "Size", options: [] },
      ] as CatalogueItem["modifiers"],
      linkedProductIds: ["p1"],
    };
    const merged = mapApiMenuItem(
      { id: "m1", name: "Latte", category: "Drinks", price: 400 },
      existing,
    );
    expect(merged.price).toBe(400); // server is authoritative for price
    expect(merged.image).toBe("data:img"); // client-only preserved
    expect(merged.modifiers).toHaveLength(1);
    expect(merged.linkedProductIds).toEqual(["p1"]);
    expect(merged.description).toBe("House blend");
  });
});

describe("mapApiTable", () => {
  it("derives the table number from the label and maps seats/section", () => {
    const table = mapApiTable(
      { id: "t1", label: "Table 5", seats: 4, section: "Patio", active: true },
      0,
    );
    expect(table.tableNumber).toBe(5);
    expect(table.capacity).toBe(4);
    expect(table.bookable).toBe(true);
    expect(table.server).toBe("Patio");
  });

  it("lets the server win on seats but preserves the live open-order session", () => {
    const base = mapApiTable({ id: "t1", label: "Table 5", seats: 4 }, 0);
    const existing = {
      ...base,
      items: [{ id: "i" }],
      status: "open",
      paidAmount: 100,
      payments: [{ id: "p" }],
    } as unknown as MerchantTable;
    const merged = mapApiTable(
      { id: "t1", label: "Table 5", seats: 6 },
      0,
      existing,
    );
    expect(merged.capacity).toBe(6); // server is authoritative for seats
    expect(merged.items).toHaveLength(1); // live session preserved
    expect(merged.paidAmount).toBe(100);
    expect(merged.payments).toHaveLength(1);
  });
});
