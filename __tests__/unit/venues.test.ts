import { describe, it, expect, beforeEach } from "vitest";

import {
  getCurrentVenue,
  getCurrentVenueId,
  getVenues,
  loadMerchantSnapshot,
  saveMerchantTables,
  setCurrentVenueId,
  type MerchantTable,
} from "../../src/lib/merchant-dashboard";

beforeEach(() => {
  localStorage.clear();
});

function makeTable(tableNumber: number): MerchantTable {
  return {
    id: `t${tableNumber}`,
    tableNumber,
    capacity: 2,
    server: "",
    items: [],
    status: "open",
    openedAt: new Date().toISOString(),
    paidAmount: 0,
    payments: [],
  };
}

describe("multi-venue", () => {
  it("lists venues and defaults to main", () => {
    expect(getVenues().length).toBeGreaterThanOrEqual(2);
    expect(getCurrentVenueId()).toBe("main");
    expect(getCurrentVenue().id).toBe("main");
  });

  it("isolates merchant data per venue", () => {
    setCurrentVenueId("cbd");
    saveMerchantTables([makeTable(1)]);
    expect(loadMerchantSnapshot().tables).toHaveLength(1);

    // main is a separate namespace -> falls back to the seeded demo (12 tables)
    setCurrentVenueId("main");
    expect(loadMerchantSnapshot().tables.length).toBeGreaterThan(1);

    // switching back to cbd still returns its single saved table
    setCurrentVenueId("cbd");
    expect(loadMerchantSnapshot().tables).toHaveLength(1);
  });
});
