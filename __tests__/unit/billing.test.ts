import { describe, it, expect } from "vitest";

import type { Sql } from "../../src/lib/db";
import {
  BILLING_PLANS,
  activateSubscription,
  downgradeToFree,
  findPlan,
  isPaidPlan,
  planPriceMinor,
} from "../../src/lib/billing";

// A capturing stub for the tagged-template `sql` client so we can assert exactly
// what activateSubscription / downgradeToFree write, with no DB.
function fakeSql() {
  const calls: { text: string; values: unknown[] }[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ text: strings.join("?"), values });
    return Promise.resolve([] as unknown[]);
  }) as unknown as Sql;
  return { sql, calls };
}

describe("billing plan catalogue", () => {
  it("prices free=0 and pro=290000 minor units", () => {
    expect(planPriceMinor("free")).toBe(0);
    expect(planPriceMinor("pro")).toBe(290000);
    expect(planPriceMinor("bogus")).toBe(0);
  });

  it("classifies paid vs free", () => {
    expect(isPaidPlan("free")).toBe(false);
    expect(isPaidPlan("pro")).toBe(true);
  });

  it("exposes free + pro with feature lists", () => {
    expect(BILLING_PLANS.map((p) => p.id).sort()).toEqual(["free", "pro"]);
    expect(findPlan("pro")?.features.length).toBeGreaterThan(0);
    expect(findPlan("nope")).toBeUndefined();
  });
});

describe("activateSubscription", () => {
  it("upserts an active 30-day subscription and bumps app_users.plan", async () => {
    const { sql, calls } = fakeSql();
    await activateSubscription(sql, "v_1", "pro", "pay_1", 290000);

    const sub = calls.find((c) => /into subscriptions/i.test(c.text));
    expect(sub).toBeTruthy();
    expect(sub!.values).toContain("v_1");
    expect(sub!.values).toContain("pro");
    expect(sub!.values).toContain(290000);
    expect(sub!.values).toContain("pay_1");

    const upd = calls.find((c) => /update app_users set plan/i.test(c.text));
    expect(upd).toBeTruthy();
    expect(upd!.values).toEqual(["pro", "v_1"]);
  });
});

describe("downgradeToFree", () => {
  it("cancels the subscription and resets app_users.plan to free", async () => {
    const { sql, calls } = fakeSql();
    await downgradeToFree(sql, "v_2");
    expect(
      calls.some((c) => /into subscriptions/i.test(c.text) && c.values.includes("v_2")),
    ).toBe(true);
    const upd = calls.find((c) => /update app_users set plan/i.test(c.text));
    expect(upd!.values).toContain("v_2");
  });
});
