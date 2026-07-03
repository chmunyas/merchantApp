import { describe, it, expect } from "vitest";

import type {
  Reservation,
  TableCombination,
} from "../../src/components/merchant/features/types";
import {
  getAvailableCombinationsForParty,
  getAvailableTablesForParty,
  getOccupiedTableNumbers,
  type MerchantTable,
} from "../../src/lib/merchant-dashboard";

function makeTable(
  tableNumber: number,
  capacity: number,
  bookable = true,
): MerchantTable {
  return {
    id: `table-${tableNumber}`,
    tableNumber,
    capacity,
    bookable,
    server: "",
    items: [],
    status: "open",
    openedAt: new Date().toISOString(),
    paidAmount: 0,
    payments: [],
  };
}

function makeReservation(
  partial: Partial<Reservation> & Pick<Reservation, "tableNumber">,
): Reservation {
  return {
    id: `res-${partial.tableNumber}-${partial.time ?? "x"}`,
    customerName: "Guest",
    phone: "",
    date: "2026-07-04",
    time: "19:00",
    covers: 2,
    status: "confirmed",
    ...partial,
  };
}

const tables = [
  makeTable(1, 2),
  makeTable(2, 4),
  makeTable(3, 6),
  makeTable(4, 8, false), // not bookable
];

const combinations: TableCombination[] = [
  {
    id: "combo-a",
    name: "A",
    tableNumbers: [1, 2],
    minCapacity: 4,
    maxCapacity: 8,
    priority: 3,
    active: true,
  },
  {
    id: "combo-b",
    name: "B",
    tableNumbers: [2, 3],
    minCapacity: 6,
    maxCapacity: 12,
    priority: 5,
    active: true,
  },
];

describe("getOccupiedTableNumbers", () => {
  it("marks a single-table booking as occupied for its slot", () => {
    const reservations = [makeReservation({ tableNumber: 2 })];
    const occupied = getOccupiedTableNumbers(
      reservations,
      combinations,
      "2026-07-04",
      "19:00",
    );
    expect(occupied.has(2)).toBe(true);
    expect(occupied.has(1)).toBe(false);
  });

  it("expands a combination booking to all its member tables", () => {
    const reservations = [
      makeReservation({ tableNumber: 2, combinationId: "combo-b" }),
    ];
    const occupied = getOccupiedTableNumbers(
      reservations,
      combinations,
      "2026-07-04",
      "19:00",
    );
    expect([...occupied].sort()).toEqual([2, 3]);
  });

  it("ignores other slots and cancelled/no-show bookings", () => {
    const reservations = [
      makeReservation({ tableNumber: 1, time: "20:00" }),
      makeReservation({ tableNumber: 2, status: "cancelled" }),
      makeReservation({ tableNumber: 3, status: "no-show" }),
    ];
    const occupied = getOccupiedTableNumbers(
      reservations,
      combinations,
      "2026-07-04",
      "19:00",
    );
    expect(occupied.size).toBe(0);
  });
});

describe("getAvailableTablesForParty", () => {
  it("returns bookable, free tables that fit, smallest first", () => {
    const available = getAvailableTablesForParty(tables, 3, new Set());
    // table 1 (2 seats) too small, table 4 not bookable -> [2, 3]
    expect(available.map((t) => t.tableNumber)).toEqual([2, 3]);
  });

  it("excludes occupied tables", () => {
    const available = getAvailableTablesForParty(tables, 3, new Set([2]));
    expect(available.map((t) => t.tableNumber)).toEqual([3]);
  });
});

describe("getAvailableCombinationsForParty", () => {
  it("returns fitting active combinations with all tables free, priority first", () => {
    const available = getAvailableCombinationsForParty(
      combinations,
      6,
      new Set(),
    );
    // both fit 6; B (p5) before A (p3)
    expect(available.map((c) => c.id)).toEqual(["combo-b", "combo-a"]);
  });

  it("drops a combination when any member table is occupied", () => {
    const available = getAvailableCombinationsForParty(
      combinations,
      6,
      new Set([3]),
    );
    expect(available.map((c) => c.id)).toEqual(["combo-a"]);
  });
});
