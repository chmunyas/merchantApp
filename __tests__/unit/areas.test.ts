import { describe, it, expect } from "vitest";

import type {
  Area,
  Reservation,
  TableCombination,
} from "../../src/components/merchant/features/types";
import {
  getAreaForTable,
  getBookingsByArea,
  getBookingStats,
  getReservationTableNumbers,
  getVisibleAreas,
} from "../../src/lib/merchant-dashboard";

const areas: Area[] = [
  {
    id: "a1",
    name: "Terrace",
    hiddenFromDayPlanner: false,
    tableNumbers: [1, 2],
    order: 2,
  },
  {
    id: "a2",
    name: "Bar",
    hiddenFromDayPlanner: false,
    tableNumbers: [3, 4],
    order: 1,
  },
  {
    id: "a3",
    name: "Private",
    hiddenFromDayPlanner: true,
    tableNumbers: [5],
    order: 3,
  },
];

const combinations: TableCombination[] = [
  {
    id: "c1",
    name: "Terrace Long",
    tableNumbers: [1, 2],
    minCapacity: 4,
    maxCapacity: 8,
    priority: 3,
    active: true,
  },
];

function res(
  partial: Partial<Reservation> & Pick<Reservation, "id" | "tableNumber">,
): Reservation {
  return {
    customerName: "Guest",
    phone: "",
    date: "2026-07-04",
    time: "19:00",
    covers: 2,
    status: "confirmed",
    ...partial,
  };
}

const reservations: Reservation[] = [
  res({ id: "r1", tableNumber: 1, time: "18:00", covers: 2 }),
  res({ id: "r2", tableNumber: 3, time: "19:00", covers: 4, status: "seated" }),
  res({ id: "r3", tableNumber: 5, time: "20:00", covers: 2 }),
  res({
    id: "r4",
    tableNumber: 1,
    combinationId: "c1",
    time: "12:00",
    covers: 6,
  }),
  res({ id: "r5", tableNumber: 9, time: "21:00", covers: 2 }),
  res({ id: "r6", tableNumber: 1, status: "cancelled" }),
  res({ id: "r7", tableNumber: 1, date: "2026-07-05" }),
];

describe("getVisibleAreas", () => {
  it("drops hidden areas and sorts by order", () => {
    expect(getVisibleAreas(areas).map((a) => a.name)).toEqual([
      "Bar",
      "Terrace",
    ]);
  });
});

describe("getAreaForTable", () => {
  it("finds the area containing a table, else null", () => {
    expect(getAreaForTable(areas, 1)?.name).toBe("Terrace");
    expect(getAreaForTable(areas, 3)?.name).toBe("Bar");
    expect(getAreaForTable(areas, 5)?.name).toBe("Private");
    expect(getAreaForTable(areas, 9)).toBeNull();
  });
});

describe("getReservationTableNumbers", () => {
  it("expands a combination booking to its tables", () => {
    expect(getReservationTableNumbers(reservations[3], combinations)).toEqual([
      1, 2,
    ]);
  });
  it("returns the single table otherwise", () => {
    expect(getReservationTableNumbers(reservations[0], combinations)).toEqual([
      1,
    ]);
  });
});

describe("getBookingStats", () => {
  it("counts bookings/covers/confirmed/seated for the date", () => {
    const stats = getBookingStats(reservations, "2026-07-04");
    // r1,r2,r3,r4,r5 count; r6 cancelled and r7 other date excluded.
    expect(stats.bookings).toBe(5);
    expect(stats.covers).toBe(16);
    expect(stats.confirmed).toBe(4);
    expect(stats.seated).toBe(1);
  });
});

describe("getBookingsByArea", () => {
  const groups = getBookingsByArea(
    areas,
    reservations,
    combinations,
    "2026-07-04",
  );

  it("groups by visible area (order) with a trailing Unassigned group", () => {
    expect(groups.map((g) => (g.area ? g.area.name : "Unassigned"))).toEqual([
      "Bar",
      "Terrace",
      "Unassigned",
    ]);
  });

  it("assigns bookings to the right area and sorts by time", () => {
    const bar = groups[0];
    const terrace = groups[1];
    const unassigned = groups[2];
    expect(bar.reservations.map((r) => r.id)).toEqual(["r2"]);
    // r4 (12:00 combo tables 1,2) before r1 (18:00 table 1)
    expect(terrace.reservations.map((r) => r.id)).toEqual(["r4", "r1"]);
    // table 5 is only in the hidden area, table 9 in none -> unassigned
    expect(unassigned.reservations.map((r) => r.id)).toEqual(["r3", "r5"]);
  });
});
