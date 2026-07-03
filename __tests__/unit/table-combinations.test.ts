import { describe, it, expect } from "vitest";

import type { TableCombination } from "../../src/components/merchant/features/types";
import {
  DEFAULT_TABLE_CAPACITY,
  getBookableTables,
  getCombinationSeats,
  isTableBookable,
  pickCombinationForParty,
  tableLabel,
  tableSeats,
  type MerchantTable,
} from "../../src/lib/merchant-dashboard";

function makeTable(tableNumber: number, capacity?: number): MerchantTable {
  return {
    id: `table-${tableNumber}`,
    tableNumber,
    capacity,
    server: "",
    items: [],
    status: "open",
    openedAt: new Date().toISOString(),
    paidAmount: 0,
    payments: [],
  };
}

const combos: TableCombination[] = [
  {
    id: "a",
    name: "A",
    tableNumbers: [1, 2],
    minCapacity: 4,
    maxCapacity: 8,
    priority: 3,
    active: true,
  },
  {
    id: "b",
    name: "B",
    tableNumbers: [3, 4],
    minCapacity: 4,
    maxCapacity: 8,
    priority: 5,
    active: true,
  },
  {
    id: "c",
    name: "C",
    tableNumbers: [5, 6],
    minCapacity: 10,
    maxCapacity: 20,
    priority: 5,
    active: true,
  },
  {
    id: "d",
    name: "D-inactive",
    tableNumbers: [1, 2],
    minCapacity: 4,
    maxCapacity: 8,
    priority: 5,
    active: false,
  },
];

describe("tableSeats", () => {
  it("uses capacity when present and defaults when missing", () => {
    expect(tableSeats(makeTable(1, 6))).toBe(6);
    expect(tableSeats(makeTable(2))).toBe(DEFAULT_TABLE_CAPACITY);
  });
});

describe("bookable + label fields", () => {
  it("treats a table as bookable unless explicitly false", () => {
    expect(isTableBookable(makeTable(1))).toBe(true);
    expect(isTableBookable({ ...makeTable(2), bookable: true })).toBe(true);
    expect(isTableBookable({ ...makeTable(3), bookable: false })).toBe(false);
  });

  it("filters out non-bookable tables", () => {
    const tables = [
      makeTable(1),
      { ...makeTable(2), bookable: false },
      makeTable(3),
    ];
    expect(getBookableTables(tables).map((t) => t.tableNumber)).toEqual([1, 3]);
  });

  it("uses the custom name when set, else falls back to Table N", () => {
    expect(tableLabel({ ...makeTable(4), name: "Bar 1" })).toBe("Bar 1");
    expect(tableLabel(makeTable(4))).toBe("Table 4");
  });
});

describe("getCombinationSeats", () => {
  it("sums member table capacities", () => {
    const tables = [makeTable(1, 4), makeTable(2, 2)];
    expect(getCombinationSeats(combos[0], tables)).toBe(6);
  });

  it("ignores table numbers that no longer exist", () => {
    const tables = [makeTable(1, 4)]; // table 2 removed
    expect(getCombinationSeats(combos[0], tables)).toBe(4);
  });
});

describe("pickCombinationForParty", () => {
  it("picks the highest-priority active combination that fits", () => {
    // A (p3) and B (p5) both fit 6; B wins on priority. D is inactive.
    expect(pickCombinationForParty(combos, 6)?.id).toBe("b");
  });

  it("respects the capacity window", () => {
    expect(pickCombinationForParty(combos, 12)?.id).toBe("c");
  });

  it("returns null when nothing fits", () => {
    expect(pickCombinationForParty(combos, 25)).toBeNull();
  });

  it("never returns an inactive combination", () => {
    const onlyInactive = combos.filter((c) => !c.active);
    expect(pickCombinationForParty(onlyInactive, 6)).toBeNull();
  });
});
