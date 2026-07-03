import { describe, it, expect } from "vitest";

import type {
  Reservation,
  TableCombination,
} from "../../src/components/merchant/features/types";
import {
  getCombinationTables,
  getLiveCombinationForTable,
  getSeatedCombinationIds,
  getSeatedCombinationsByTable,
  type MerchantTable,
} from "../../src/lib/merchant-dashboard";

function makeTable(tableNumber: number): MerchantTable {
  return {
    id: `table-${tableNumber}`,
    tableNumber,
    capacity: 4,
    server: "",
    items: [
      {
        id: `item-${tableNumber}`,
        name: `Dish ${tableNumber}`,
        price: 100,
        qty: 1,
        category: "Mains",
      },
    ],
    status: "open",
    openedAt: new Date().toISOString(),
    paidAmount: 0,
    payments: [],
  };
}

const combinations: TableCombination[] = [
  {
    id: "combo-1",
    name: "Terrace Long Table",
    tableNumbers: [1, 2, 3],
    minCapacity: 6,
    maxCapacity: 12,
    priority: 4,
    active: true,
  },
  {
    id: "combo-2",
    name: "Lounge Booth",
    tableNumbers: [9, 10],
    minCapacity: 5,
    maxCapacity: 8,
    priority: 3,
    active: true,
  },
];

function res(
  partial: Partial<Reservation> & Pick<Reservation, "id" | "status">,
): Reservation {
  return {
    tableNumber: 1,
    customerName: "Guest",
    phone: "",
    date: "2026-07-04",
    time: "19:00",
    covers: 8,
    ...partial,
  };
}

describe("getSeatedCombinationIds", () => {
  it("only includes combinations whose booking is seated", () => {
    const reservations = [
      res({ id: "a", status: "seated", combinationId: "combo-1" }),
      res({ id: "b", status: "confirmed", combinationId: "combo-2" }),
      res({ id: "c", status: "seated" }), // single table, no combo
    ];
    const ids = getSeatedCombinationIds(reservations);
    expect([...ids]).toEqual(["combo-1"]);
  });
});

describe("getLiveCombinationForTable", () => {
  const reservations = [
    res({ id: "a", status: "seated", combinationId: "combo-1" }),
  ];

  it("returns the live combination for any member table", () => {
    expect(
      getLiveCombinationForTable(combinations, reservations, 2)?.id,
    ).toBe("combo-1");
  });

  it("returns null for a table not in a seated combination", () => {
    expect(getLiveCombinationForTable(combinations, reservations, 9)).toBeNull();
    expect(
      getLiveCombinationForTable(combinations, [], 1),
    ).toBeNull();
  });
});

describe("getSeatedCombinationsByTable", () => {
  it("maps every member table of a seated combination to it", () => {
    const reservations = [
      res({ id: "a", status: "seated", combinationId: "combo-1" }),
    ];
    const map = getSeatedCombinationsByTable(combinations, reservations);
    expect(map.get(1)?.name).toBe("Terrace Long Table");
    expect(map.get(3)?.name).toBe("Terrace Long Table");
    expect(map.has(9)).toBe(false);
  });
});

describe("getCombinationTables", () => {
  it("resolves member table numbers to table objects, skipping missing", () => {
    const tables = [makeTable(1), makeTable(3)]; // table 2 missing
    const resolved = getCombinationTables(combinations[0], tables);
    expect(resolved.map((t) => t.tableNumber)).toEqual([1, 3]);
  });
});
