import { describe, it, expect, beforeEach } from "vitest";

import {
  DEFAULT_TABLE_CAPACITY,
  SCHEMA_VERSION,
  STORAGE_KEYS,
  ensureMerchantDemoData,
  readStorage,
  type MerchantTable,
} from "../../src/lib/merchant-dashboard";

const VERSION_KEY = "fxengine.merchant.schemaVersion";

beforeEach(() => {
  localStorage.clear();
});

describe("schema migration", () => {
  it("backfills capacity/bookable for legacy (v1) tables and stamps the version", () => {
    const legacyTable = {
      id: "table-1",
      tableNumber: 1,
      server: "Grace",
      items: [],
      status: "open",
      openedAt: new Date().toISOString(),
      paidAmount: 0,
      payments: [],
    };
    localStorage.setItem(STORAGE_KEYS.tables, JSON.stringify([legacyTable]));

    ensureMerchantDemoData();

    const tables = readStorage<MerchantTable[]>(STORAGE_KEYS.tables, []);
    expect(tables[0].capacity).toBe(DEFAULT_TABLE_CAPACITY);
    expect(tables[0].bookable).toBe(true);
    expect(localStorage.getItem(VERSION_KEY)).toBe(
      JSON.stringify(SCHEMA_VERSION),
    );
  });

  it("is idempotent once migrated", () => {
    ensureMerchantDemoData();
    const first = localStorage.getItem(VERSION_KEY);
    ensureMerchantDemoData();
    const second = localStorage.getItem(VERSION_KEY);
    expect(first).toBe(JSON.stringify(SCHEMA_VERSION));
    expect(second).toBe(first);
  });
});
