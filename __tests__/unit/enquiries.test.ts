import { describe, it, expect } from "vitest";

import type {
  Enquiry,
  Reservation,
  TableCombination,
} from "../../src/components/merchant/features/types";
import {
  getNewEnquiries,
  getPendingEnquiryCount,
  suggestPartyAssignment,
  type MerchantTable,
} from "../../src/lib/merchant-dashboard";

function makeTable(tableNumber: number, capacity: number): MerchantTable {
  return {
    id: `table-${tableNumber}`,
    tableNumber,
    capacity,
    bookable: true,
    server: "",
    items: [],
    status: "open",
    openedAt: new Date().toISOString(),
    paidAmount: 0,
    payments: [],
  };
}

function enq(
  partial: Partial<Enquiry> & Pick<Enquiry, "id" | "status">,
): Enquiry {
  return {
    customerName: "Guest",
    phone: "",
    date: "2026-07-04",
    time: "19:00",
    covers: 2,
    source: "web",
    createdAt: "2026-07-04T10:00:00.000Z",
    ...partial,
  };
}

describe("enquiry helpers", () => {
  const enquiries = [
    enq({ id: "e1", status: "new", createdAt: "2026-07-04T10:00:00.000Z" }),
    enq({ id: "e2", status: "approved" }),
    enq({ id: "e3", status: "new", createdAt: "2026-07-04T09:00:00.000Z" }),
    enq({ id: "e4", status: "declined" }),
  ];

  it("getPendingEnquiryCount counts only new", () => {
    expect(getPendingEnquiryCount(enquiries)).toBe(2);
  });

  it("getNewEnquiries returns new only, oldest first", () => {
    expect(getNewEnquiries(enquiries).map((e) => e.id)).toEqual(["e3", "e1"]);
  });
});

describe("suggestPartyAssignment", () => {
  const tables = [makeTable(1, 2), makeTable(2, 4), makeTable(3, 6)];
  const combinations: TableCombination[] = [
    {
      id: "combo-big",
      name: "Big",
      tableNumbers: [2, 3],
      minCapacity: 8,
      maxCapacity: 12,
      priority: 5,
      active: true,
    },
  ];

  it("picks the smallest free single table that fits", () => {
    const a = suggestPartyAssignment(
      tables,
      combinations,
      [],
      "2026-07-04",
      "19:00",
      3,
    );
    expect(a).toEqual({ kind: "table", tableNumber: 2 });
  });

  it("falls back to a combination when no single table fits", () => {
    const a = suggestPartyAssignment(
      tables,
      combinations,
      [],
      "2026-07-04",
      "19:00",
      10,
    );
    expect(a).toEqual({ kind: "combination", combinationId: "combo-big" });
  });

  it("returns null when the slot is fully occupied", () => {
    const reservations: Reservation[] = [
      {
        id: "r1",
        tableNumber: 2,
        customerName: "X",
        phone: "",
        date: "2026-07-04",
        time: "19:00",
        covers: 4,
        status: "confirmed",
      },
      {
        id: "r2",
        tableNumber: 3,
        customerName: "Y",
        phone: "",
        date: "2026-07-04",
        time: "19:00",
        covers: 6,
        status: "confirmed",
      },
    ];
    const a = suggestPartyAssignment(
      tables,
      combinations,
      reservations,
      "2026-07-04",
      "19:00",
      4,
    );
    // table 2 & 3 taken; table 1 too small for 4 -> null
    expect(a).toBeNull();
  });
});
