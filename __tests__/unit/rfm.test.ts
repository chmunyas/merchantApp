import { describe, it, expect } from "vitest";

import { scoreCustomers, type CustomerStat } from "../../src/lib/rfm";

const fixture: CustomerStat[] = [
  {
    ref: "+254700000001",
    name: "Champion",
    tier: "Platinum",
    recencyDays: 2,
    frequency: 20,
    monetary: 50000,
    tenureDays: 300,
  },
  {
    ref: "+254700000002",
    name: "Loyal",
    tier: "Gold",
    recencyDays: 20,
    frequency: 12,
    monetary: 20000,
    tenureDays: 250,
  },
  {
    ref: "+254700000003",
    name: "Newbie",
    tier: "Bronze",
    recencyDays: 3,
    frequency: 1,
    monetary: 1500,
    tenureDays: 5,
  },
  {
    ref: "+254700000004",
    name: "Slipping",
    tier: "Gold",
    recencyDays: 90,
    frequency: 8,
    monetary: 30000,
    tenureDays: 300,
  },
  {
    ref: "+254700000005",
    name: "Gone",
    tier: "Bronze",
    recencyDays: 200,
    frequency: 1,
    monetary: 800,
    tenureDays: 210,
  },
];

describe("scoreCustomers", () => {
  const result = scoreCustomers(fixture);
  const byName = Object.fromEntries(result.customers.map((c) => [c.name, c]));

  it("assigns the expected segments", () => {
    expect(byName.Champion.segment).toBe("Champions");
    expect(byName.Loyal.segment).toBe("Loyal");
    expect(byName.Newbie.segment).toBe("Promising");
    expect(byName.Slipping.segment).toBe("At risk");
    expect(byName.Gone.segment).toBe("Lost");
  });

  it("counts each segment", () => {
    expect(result.segments).toEqual({
      Champions: 1,
      Loyal: 1,
      Promising: 1,
      "At risk": 1,
      Lost: 1,
      "Needs attention": 0,
    });
  });

  it("flags churn risk from recency vs the customer's own cadence", () => {
    expect(byName.Champion.churnRisk).toBe("low");
    expect(byName.Slipping.churnRisk).toBe("high"); // frequent buyer gone quiet
    expect(byName.Gone.churnRisk).toBe("medium"); // one-off, long silent
  });

  it("computes average order value + a projected annual value", () => {
    expect(byName.Champion.avgOrderValue).toBe(2500); // 50000 / 20
    // 2500 * (20/300*365 = 24.33) ≈ 60833
    expect(byName.Champion.predictedAnnualValue).toBeGreaterThan(50000);
    // A one-off, brand-new customer isn't annualised into a huge LTV.
    expect(byName.Newbie.predictedAnnualValue).toBe(byName.Newbie.avgOrderValue);
  });

  it("ranks win-back targets by value, highest first", () => {
    expect(result.atRisk.map((c) => c.name)).toEqual(["Slipping", "Gone"]);
    expect(result.customers[0].name).toBe("Champion"); // sorted by monetary desc
    expect(result.totalMonetary).toBe(102300);
  });

  it("handles an empty cohort", () => {
    const empty = scoreCustomers([]);
    expect(empty.totalCustomers).toBe(0);
    expect(empty.atRisk).toEqual([]);
  });
});
