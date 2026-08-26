import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  beginFinancialEffect,
  claimFinancialOutbox,
  completeFinancialEffect,
  failFinancialEffect,
  PAYMENT_CONSUMERS,
  REFUND_CONSUMERS,
} from "../../src/lib/financial-events";
import { cumulativeAllocation } from "../../src/lib/financial-consumers";


describe("financial event consumer inventory", () => {
  it("covers all succeeded payment side-effect domains", () => {
    expect(PAYMENT_CONSUMERS).toEqual(
      expect.arrayContaining([
        "accounting",
        "invoice",
        "commission",
        "subscription",
        "loyalty",
        "saved-method",
        "order",
        "pay-link",
      ]),
    );
  });

  it("covers proportional refund reversal domains", () => {
    expect(REFUND_CONSUMERS).toEqual(
      expect.arrayContaining([
        "accounting-reversal",
        "commission-reversal",
        "loyalty-reversal",
        "tip-reversal",
        "cogs-reversal",
        "order-reversal",
        "pay-link-reversal",
        "invoice-reversal",
        "settlement-reversal",
      ]),
    );
  });

  it("has no duplicate consumer names", () => {
    expect(new Set(PAYMENT_CONSUMERS).size).toBe(PAYMENT_CONSUMERS.length);
    expect(new Set(REFUND_CONSUMERS).size).toBe(REFUND_CONSUMERS.length);
  });

  it("makes cumulative partial-refund component allocation partition invariant", () => {
    const component = 137;
    const gross = 1_000;
    const refunds = [333, 333, 334];
    let before = 0;
    let allocated = 0;
    for (const refund of refunds) {
      const after = before + refund;
      allocated +=
        cumulativeAllocation(component, gross, after) -
        cumulativeAllocation(component, gross, before);
      before = after;
    }
    expect(allocated).toBe(component);
    expect(cumulativeAllocation(component, gross, gross)).toBe(component);
  });

  it("reclaims stale processing leases with one atomic claim and a fresh fence", async () => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ text: strings.join("?"), values });
      return Promise.resolve([]);
    }) as unknown as Parameters<typeof claimFinancialOutbox>[0];
    await claimFinancialOutbox(sql, 250);
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toMatch(/status = 'processing' AND o\.lease_expires_at < now\(\)/);
    expect(calls[0].text).toMatch(/claim_token = \?/);
    expect(calls[0].text).toMatch(/FOR UPDATE OF o SKIP LOCKED/);
    expect(calls[0].text).toMatch(/prior\.event_sequence/);
    expect(calls[0].text).toMatch(/active_outbox\.status = 'processing'/);
    expect(calls[0].values).toContain(100);
    expect(String(calls[0].values[1])).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("fences begin, complete, and fail operations to the current claim token", async () => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join("?");
      calls.push({ text, values });
      if (/SELECT 1 FROM financial_outbox/.test(text)) return Promise.resolve([{ ok: 1 }]);
      if (/INSERT INTO financial_effects/.test(text)) return Promise.resolve([{ event_id: "event-1" }]);
      if (/UPDATE financial_outbox/.test(text)) return Promise.resolve([{ id: "outbox-1" }]);
      return Promise.resolve([]);
    }) as unknown as Parameters<typeof beginFinancialEffect>[0];
    Object.assign(sql, { json: (value: unknown) => value });
    const row = {
      id: "outbox-1",
      event_id: "event-1",
      consumer: "loyalty",
      claim_token: "33333333-3333-4333-8333-333333333333",
      attempts: 1,
    };
    expect(await beginFinancialEffect(sql, row)).toBe(true);
    expect(await completeFinancialEffect(sql, row, { ok: true })).toBe(true);
    await failFinancialEffect(sql as never, row, new Error("boom"));
    const fenced = calls.filter((call) => /claim_token = \?::uuid/.test(call.text));
    expect(fenced.length).toBeGreaterThanOrEqual(3);
    for (const call of fenced) {
      expect(call.values).toContain(row.claim_token);
    }
  });

  it("ships lease, refund-command, snapshot, and append-only database guards", () => {
    const migration = readFileSync(
      resolve(process.cwd(), "db/63-financial-events.sql"),
      "utf8",
    );
    expect(migration).toMatch(/lease_expires_at/i);
    expect(migration).toMatch(/claim_token/i);
    expect(migration).toMatch(/'unknown'.*'pending'.*'booked'/s);
    expect(migration).toMatch(/financial_payment_snapshots/i);
    expect(migration).toMatch(/financial_reversals_append_only/i);
    expect(migration).toMatch(/journal_entries_append_only/i);
  });
});
