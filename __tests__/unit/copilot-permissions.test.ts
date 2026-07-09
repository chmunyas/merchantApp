/**
 * Unit tests — merchant copilot role-based access.
 * Money + PII (sales, payments, settlement, customer spend, phone numbers) are
 * owner-only: staff / supervisor / manager sessions are denied, the merchant
 * owner + platform/reseller admin are allowed. Operational tools stay open.
 */
import { describe, it, expect } from "vitest";

import { canSeeSensitive, runCopilotTools } from "../../src/lib/copilot-tools";

describe("canSeeSensitive (owner-only money + PII)", () => {
  it("allows only owner-level roles", () => {
    expect(canSeeSensitive("merchant")).toBe(true);
    expect(canSeeSensitive("admin")).toBe(true);
    expect(canSeeSensitive("reseller_admin")).toBe(true);
  });

  it("denies operational roles", () => {
    expect(canSeeSensitive("manager")).toBe(false);
    expect(canSeeSensitive("supervisor")).toBe(false);
    expect(canSeeSensitive("staff")).toBe(false);
    expect(canSeeSensitive("customer")).toBe(false);
    expect(canSeeSensitive("")).toBe(false);
  });
});

describe("copilot tools enforce the sensitive gate", () => {
  const ctx = (role: string) => ({ venue: "v_perm_test", env: {}, role });

  it("denies sales figures to a staff session", async () => {
    const r = await runCopilotTools("how much did we make today", ctx("staff"));
    expect(r?.reply).toMatch(/owner-only/i);
  });

  it("denies top spenders to a manager", async () => {
    const r = await runCopilotTools("who are my top spenders", ctx("manager"));
    expect(r?.reply).toMatch(/owner-only/i);
  });

  it("denies settlement figures to a supervisor", async () => {
    const r = await runCopilotTools("how much is unsettled", ctx("supervisor"));
    expect(r?.reply).toMatch(/owner-only/i);
  });

  it("denies creating a bill to a staff session", async () => {
    const r = await runCopilotTools("bill 500 to +254712345678", ctx("staff"));
    expect(r?.reply).toMatch(/owner-only/i);
  });

  it("lets an owner past the sales gate", async () => {
    const r = await runCopilotTools("how much did we make today", ctx("merchant"));
    expect(r?.reply).not.toMatch(/owner-only/i);
  });

  it("keeps operational tools (low stock) open to any role", async () => {
    const r = await runCopilotTools("what is running low on stock", ctx("staff"));
    expect(r?.reply).not.toMatch(/owner-only/i);
  });
});
