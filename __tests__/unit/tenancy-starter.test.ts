/**
 * Unit tests — multitenancy client helpers.
 * A real (self-serve) venue must get an EMPTY starter keyed to its own business,
 * never the shared "Sade's Atelier" demo data.
 */
import { describe, it, expect } from "vitest";

import {
  createMerchantStarterData,
  isDemoVenue,
} from "../../src/lib/merchant-dashboard";

describe("isDemoVenue", () => {
  it("recognises the seeded demo venues", () => {
    expect(isDemoVenue("main")).toBe(true);
    expect(isDemoVenue("cbd")).toBe(true);
    expect(isDemoVenue("kisumu")).toBe(true);
  });

  it("treats a real self-serve venue (v_*) as non-demo", () => {
    expect(isDemoVenue("v_a9962010")).toBe(false);
    expect(isDemoVenue("")).toBe(false);
  });
});

describe("createMerchantStarterData", () => {
  const starter = createMerchantStarterData({ name: "Acme Coffee", till: "" });

  it("uses the merchant's own business name", () => {
    expect(starter.settings.businessProfile.name).toBe("Acme Coffee");
  });

  it("leaves the till blank until the merchant configures M-Pesa", () => {
    expect(starter.settings.businessProfile.tillNumber).toBe("");
  });

  it("ships NO demo catalogue / menus / orders / staff / loyalty", () => {
    expect(starter.catalogue).toEqual([]);
    expect(starter.menus).toEqual([]);
    expect(starter.tables).toEqual([]);
    expect(starter.orders).toEqual([]);
    expect(starter.reservations).toEqual([]);
    expect(starter.enquiries).toEqual([]);
    expect(starter.staffMembers).toEqual([]);
    expect(starter.loyaltyCustomers).toEqual([]);
    expect(starter.reviews).toEqual([]);
  });

  it("falls back to a placeholder name when none is given", () => {
    expect(
      createMerchantStarterData({ name: "" }).settings.businessProfile.name,
    ).toBe("My Business");
  });
});
