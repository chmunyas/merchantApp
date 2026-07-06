import { describe, it, expect } from "vitest";

import { canAccessPath } from "../../src/lib/rbac";

describe("canAccessPath — front-of-house ops stay open", () => {
  const opsPages = [
    "/dashboard",
    "/dashboard/orders",
    "/dashboard/tables",
    "/dashboard/floorplan",
    "/dashboard/bookings",
    "/dashboard/enquiries",
    "/dashboard/payments",
    "/dashboard/invoices",
    "/dashboard/inbox",
    "/dashboard/contacts",
    "/dashboard/qr",
  ];
  it("lets staff open every ops page", () => {
    for (const p of opsPages) expect(canAccessPath("staff", p)).toBe(true);
  });
});

describe("canAccessPath — owner-only pages", () => {
  const ownerPages = [
    "/dashboard/settings",
    "/dashboard/staff",
    "/dashboard/whatsapp",
    "/dashboard/telegram",
  ];
  it("blocks staff, supervisor and manager; allows owner + admin", () => {
    for (const p of ownerPages) {
      expect(canAccessPath("staff", p)).toBe(false);
      expect(canAccessPath("supervisor", p)).toBe(false);
      expect(canAccessPath("manager", p)).toBe(false);
      expect(canAccessPath("merchant", p)).toBe(true);
      expect(canAccessPath("admin", p)).toBe(true);
    }
  });
});

describe("canAccessPath — manager+ pages", () => {
  const managerPages = [
    "/dashboard/accounting",
    "/dashboard/settlement",
    "/dashboard/reports",
    "/dashboard/analytics",
    "/dashboard/menu",
  ];
  it("blocks staff/supervisor, allows manager and owner", () => {
    for (const p of managerPages) {
      expect(canAccessPath("staff", p)).toBe(false);
      expect(canAccessPath("supervisor", p)).toBe(false);
      expect(canAccessPath("manager", p)).toBe(true);
      expect(canAccessPath("merchant", p)).toBe(true);
    }
  });
});

describe("canAccessPath — nested paths inherit the parent gate", () => {
  it("gates children of an owner-only route", () => {
    expect(canAccessPath("staff", "/dashboard/settings/branding")).toBe(false);
    expect(canAccessPath("merchant", "/dashboard/settings/plan")).toBe(true);
  });
});
