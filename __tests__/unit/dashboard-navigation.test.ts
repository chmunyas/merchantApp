import { describe, expect, it } from "vitest";

import {
  dashboardNavigationGroupId,
  isDashboardPathActive,
} from "../../src/lib/dashboard-navigation";

describe("dashboard navigation semantics", () => {
  it("marks Overview current only on the dashboard root", () => {
    expect(isDashboardPathActive("/dashboard", "/dashboard")).toBe(true);
    expect(isDashboardPathActive("/dashboard/payments", "/dashboard")).toBe(
      false,
    );
  });

  it("marks a section current for its exact path and nested routes", () => {
    expect(
      isDashboardPathActive("/dashboard/payments", "/dashboard/payments"),
    ).toBe(true);
    expect(
      isDashboardPathActive(
        "/dashboard/payments/refund",
        "/dashboard/payments",
      ),
    ).toBe(true);
    expect(
      isDashboardPathActive(
        "/dashboard/payment-methods",
        "/dashboard/payments",
      ),
    ).toBe(false);
  });

  it("creates stable ids for visible navigation group headings", () => {
    expect(dashboardNavigationGroupId("Operations & Sales")).toBe(
      "dashboard-nav-operations-sales",
    );
  });
});
