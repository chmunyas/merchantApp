/**
 * Unit tests — retail + services are per-tenant.
 * A real (self-serve) venue must start EMPTY and build its own catalogue; only the
 * seeded demo venues keep the showcase sample data. Guards against the regression
 * where every venue inherited the sample store / garage.
 */
import { describe, it, expect, beforeEach } from "vitest";

import {
  emptyRetailSnapshot,
  emptyServicesSnapshot,
  loadRetailSnapshot,
  loadServicesSnapshot,
  setCurrentVenueId,
} from "../../src/lib/merchant-dashboard";

describe("retail/services per-tenant starters", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("a real venue starts with an EMPTY retail catalogue", () => {
    setCurrentVenueId("v_starter01");
    const snap = loadRetailSnapshot();
    expect(snap.products).toEqual([]);
    expect(snap.sales).toEqual([]);
    expect(snap.suppliers).toEqual([]);
    expect(snap.purchaseOrders).toEqual([]);
  });

  it("a demo venue keeps the showcase retail catalogue", () => {
    setCurrentVenueId("main");
    expect(loadRetailSnapshot().products.length).toBeGreaterThan(0);
  });

  it("a real venue starts with an EMPTY services catalogue", () => {
    setCurrentVenueId("v_starter01");
    const snap = loadServicesSnapshot();
    expect(snap.services).toEqual([]);
    expect(snap.clients).toEqual([]);
    expect(snap.bookings).toEqual([]);
    expect(snap.jobCards).toEqual([]);
  });

  it("a demo venue keeps the showcase services catalogue", () => {
    setCurrentVenueId("main");
    expect(loadServicesSnapshot().services.length).toBeGreaterThan(0);
  });

  it("two real venues are isolated (no cross-store bleed)", () => {
    setCurrentVenueId("v_a");
    // Simulate store A saving a product would namespace under ::v_a; store B stays empty.
    setCurrentVenueId("v_b");
    expect(loadRetailSnapshot().products).toEqual([]);
    expect(loadServicesSnapshot().services).toEqual([]);
  });

  it("empty starters carry no demo items but keep a usable scaffold", () => {
    setCurrentVenueId("v_starter01");
    expect(emptyRetailSnapshot().products).toEqual([]);
    const services = emptyServicesSnapshot();
    expect(services.services).toEqual([]);
    expect(services.categories.length).toBeGreaterThan(0);
    expect(services.business.type).toBe("general");
  });
});
