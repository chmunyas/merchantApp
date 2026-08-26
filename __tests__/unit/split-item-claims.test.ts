import { describe, expect, it } from "vitest";

import {
  claimOrderItems,
  releaseOrderItemClaims,
  type ItemClaimResult,
} from "../../src/lib/split-lock";
import type { Sql } from "../../src/lib/db";

// A2.2 — a stateful stub Postgres modelling just enough of orders, order_items,
// payments, payment_holds and order_item_claims to prove the claim contract:
//
//   * two guests can never hold the same dish;
//   * a dish whose payment SUCCEEDED can never be claimed again, even after the
//     original hold expired;
//   * an abandoned or declined checkout gives the dishes back;
//   * the money reserved for the claimed dishes still competes for ONE balance
//     with the even-split and custom-amount paths (A2.5 must not regress).
//
// The unique index on order_item_id is modelled explicitly, because that index
// IS the race guard.

type Claim = {
  orderItemId: string;
  claimKey: string;
  amount: number;
  status: "held" | "paid";
  expiresAt: number;
};

function makeSql(opts: {
  total?: number;
  items?: Array<{ id: string; qty: number; price: number }>;
  paid?: number;
  supportsTransactions?: boolean;
  now?: () => number;
}) {
  const total = opts.total ?? 100000;
  const items = opts.items ?? [
    { id: "item-a", qty: 1, price: 50000 },
    { id: "item-b", qty: 1, price: 30000 },
    { id: "item-c", qty: 1, price: 20000 },
  ];
  const now = opts.now ?? (() => Date.now());
  const claims = new Map<string, Claim>();
  const holds = new Map<string, { amount: number; expiresAt: number }>();
  // claim keys whose payment has settled
  const settledClaimKeys = new Set<string>();
  const state = { paid: opts.paid ?? 0 };

  const run = (strings: TemplateStringsArray, values: unknown[]) => {
    const text = strings.join("?");

    if (/FROM orders\s+WHERE id = \?/i.test(text)) {
      return Promise.resolve([{ total }]);
    }
    // Promote held claims whose payment succeeded.
    if (/UPDATE order_item_claims c[\s\S]*SET status = 'paid'/i.test(text)) {
      for (const claim of claims.values()) {
        if (claim.status === "held" && settledClaimKeys.has(claim.claimKey)) {
          claim.status = "paid";
        }
      }
      return Promise.resolve([]);
    }
    // Expire held claims.
    if (/DELETE FROM order_item_claims[\s\S]*expires_at <= now\(\)/i.test(text)) {
      for (const [id, claim] of claims) {
        if (claim.status === "held" && claim.expiresAt <= now()) claims.delete(id);
      }
      return Promise.resolve([]);
    }
    // Release / re-compete for our own claim.
    if (/DELETE FROM order_item_claims[\s\S]*claim_key = \?/i.test(text)) {
      const key = String(values[1]);
      for (const [id, claim] of claims) {
        if (claim.status === "held" && claim.claimKey === key) claims.delete(id);
      }
      return Promise.resolve([]);
    }
    if (/DELETE FROM payment_holds/i.test(text)) {
      const key = String(values[1]);
      holds.delete(key);
      for (const [k, hold] of holds) {
        if (hold.expiresAt <= now()) holds.delete(k);
      }
      return Promise.resolve([]);
    }
    if (/FROM order_items\s+WHERE order_id = \?/i.test(text)) {
      return Promise.resolve(items.map((i) => ({ ...i })));
    }
    if (/INSERT INTO order_item_claims/i.test(text)) {
      const itemId = String(values[2]);
      // The unique index: a live row wins, the insert does nothing.
      if (claims.has(itemId)) return Promise.resolve([]);
      claims.set(itemId, {
        orderItemId: itemId,
        claimKey: String(values[3]),
        amount: Number(values[4]),
        status: "held",
        expiresAt: now() + Number(values[5]) * 1000,
      });
      return Promise.resolve([{ order_item_id: itemId }]);
    }
    if (/AS paid,[\s\S]*AS held/i.test(text)) {
      let held = 0;
      for (const hold of holds.values()) {
        if (hold.expiresAt > now()) held += hold.amount;
      }
      return Promise.resolve([{ paid: state.paid, held }]);
    }
    if (/INSERT INTO payment_holds/i.test(text)) {
      holds.set(String(values[2]), {
        amount: Number(values[3]),
        expiresAt: now() + Number(values[4]) * 1000,
      });
      return Promise.resolve([]);
    }
    if (/SELECT order_item_id, claim_key/i.test(text)) {
      return Promise.resolve(
        [...claims.values()].map((c) => ({
          order_item_id: c.orderItemId,
          claim_key: c.claimKey,
          amount: c.amount,
          status: c.status,
        })),
      );
    }
    return Promise.resolve([]);
  };

  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) =>
    run(strings, values)) as unknown as Sql & {
    begin: (fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>;
  };
  sql.begin = (fn) => {
    if (opts.supportsTransactions === false) {
      return Promise.reject(new Error("transactions unsupported"));
    }
    return fn(sql);
  };
  return { sql, claims, holds, settledClaimKeys, state };
}

const ORDER = "22222222-2222-2222-2222-222222222222";

const claim = (
  sql: Sql,
  claimKey: string,
  itemIds: string[],
): Promise<ItemClaimResult | null> =>
  claimOrderItems(sql, { orderId: ORDER, venue: "v1", claimKey, itemIds });

describe("split-by-item claims", () => {
  it("gives a guest their dishes plus their slice of the bill total", async () => {
    // Item subtotal 100000; the authoritative total is 110000 (10% service).
    const { sql } = makeSql({ total: 110000 });
    const result = (await claim(sql, "guest-alpha", ["item-a"])) as ItemClaimResult;
    expect(result.claimedItemIds).toEqual(["item-a"]);
    // 50000/100000 of 110000.
    expect(result.grantedMinor).toBe(55000);
    expect(result.itemsMinor).toBe(55000);
  });

  it("refuses a dish another guest already holds — and charges nothing for it", async () => {
    const { sql } = makeSql({});
    const first = (await claim(sql, "guest-alpha", [
      "item-a",
      "item-b",
    ])) as ItemClaimResult;
    expect(first.claimedItemIds).toEqual(["item-a", "item-b"]);

    const second = (await claim(sql, "guest-beta", [
      "item-b",
      "item-c",
    ])) as ItemClaimResult;
    expect(second.conflictItemIds).toEqual(["item-b"]);
    expect(second.claimedItemIds).toEqual(["item-c"]);
    expect(second.grantedMinor).toBe(20000);
  });

  it("keeps a PAID dish unclaimable forever, even once the hold expires", async () => {
    let clock = 1_000_000;
    const { sql, settledClaimKeys } = makeSql({ now: () => clock });
    await claim(sql, "guest-alpha", ["item-a"]);
    // Guest alpha's payment lands.
    settledClaimKeys.add("guest-alpha");
    // Long past the five-minute reservation window.
    clock += 60 * 60 * 1000;

    const other = (await claim(sql, "guest-beta", ["item-a"])) as ItemClaimResult;
    expect(other.claimedItemIds).toEqual([]);
    expect(other.conflictItemIds).toEqual(["item-a"]);
  });

  it("frees an ABANDONED dish once its reservation expires", async () => {
    let clock = 1_000_000;
    const { sql } = makeSql({ now: () => clock });
    await claim(sql, "guest-alpha", ["item-a"]);
    clock += 60 * 60 * 1000; // the guest walked away, nothing was ever charged

    const other = (await claim(sql, "guest-beta", ["item-a"])) as ItemClaimResult;
    expect(other.claimedItemIds).toEqual(["item-a"]);
    expect(other.conflictItemIds).toEqual([]);
  });

  it("releases the dishes AND the money when a payment fails", async () => {
    const { sql, claims, holds } = makeSql({});
    await claim(sql, "guest-alpha", ["item-a", "item-b"]);
    expect(claims.size).toBe(2);
    expect(holds.has("guest-alpha")).toBe(true);

    await releaseOrderItemClaims(sql, ORDER, "guest-alpha");
    expect(claims.size).toBe(0);
    expect(holds.has("guest-alpha")).toBe(false);

    // The dishes are immediately available to the next phone.
    const next = (await claim(sql, "guest-beta", ["item-a"])) as ItemClaimResult;
    expect(next.claimedItemIds).toEqual(["item-a"]);
  });

  it("never releases a dish that was already PAID", async () => {
    const { sql, claims, settledClaimKeys } = makeSql({});
    await claim(sql, "guest-alpha", ["item-a"]);
    settledClaimKeys.add("guest-alpha");
    // Reconcile promotes the claim to paid.
    await claim(sql, "guest-beta", ["item-b"]);
    expect(claims.get("item-a")?.status).toBe("paid");

    await releaseOrderItemClaims(sql, ORDER, "guest-alpha");
    expect(claims.get("item-a")?.status).toBe("paid");
  });

  it("lets a retry re-compete for its OWN reservation instead of self-blocking", async () => {
    const { sql } = makeSql({});
    const first = (await claim(sql, "guest-alpha", ["item-a"])) as ItemClaimResult;
    const retry = (await claim(sql, "guest-alpha", [
      "item-a",
      "item-b",
    ])) as ItemClaimResult;
    expect(first.claimedItemIds).toEqual(["item-a"]);
    expect(retry.claimedItemIds).toEqual(["item-a", "item-b"]);
    expect(retry.conflictItemIds).toEqual([]);
  });

  it("does not regress A2.5 — an item claim can never exceed the balance", async () => {
    // Someone already paid 90000 of the 100000 bill with a custom amount.
    const { sql } = makeSql({ paid: 90000 });
    const result = (await claim(sql, "guest-alpha", ["item-a"])) as ItemClaimResult;
    expect(result.itemsMinor).toBe(50000);
    // Only 10000 is actually outstanding, so only 10000 may be charged.
    expect(result.grantedMinor).toBe(10000);
    expect(result.remainingMinor).toBe(10000);
  });

  it("refuses outright and hands the dishes back when the bill is already covered", async () => {
    const { sql, claims } = makeSql({ paid: 100000 });
    const result = (await claim(sql, "guest-alpha", ["item-a"])) as ItemClaimResult;
    expect(result.grantedMinor).toBe(0);
    expect(result.claimedItemIds).toEqual([]);
    expect(result.conflictItemIds).toEqual(["item-a"]);
    expect(claims.size).toBe(0);
  });

  it("holds the money it claimed, so a concurrent even split cannot double-spend it", async () => {
    const { sql, holds } = makeSql({});
    const first = (await claim(sql, "guest-alpha", [
      "item-a",
      "item-b",
    ])) as ItemClaimResult;
    expect(first.grantedMinor).toBe(80000);
    expect(holds.get("guest-alpha")?.amount).toBe(80000);

    // A second guest claiming the last dish sees only 20000 left on the bill.
    const second = (await claim(sql, "guest-beta", ["item-c"])) as ItemClaimResult;
    expect(second.remainingMinor).toBe(20000);
    expect(first.grantedMinor + second.grantedMinor).toBe(100000);
  });

  it("refuses a line that is not on this bill", async () => {
    const { sql } = makeSql({});
    const result = (await claim(sql, "guest-alpha", [
      "not-a-line",
    ])) as ItemClaimResult;
    expect(result.claimedItemIds).toEqual([]);
    expect(result.conflictItemIds).toEqual(["not-a-line"]);
  });

  it("still prevents a double claim without transaction support", async () => {
    const { sql } = makeSql({ supportsTransactions: false });
    const first = (await claim(sql, "guest-alpha", ["item-a"])) as ItemClaimResult;
    const second = (await claim(sql, "guest-beta", ["item-a"])) as ItemClaimResult;
    expect(first.claimedItemIds).toEqual(["item-a"]);
    expect(first.serialised).toBe(false);
    expect(second.claimedItemIds).toEqual([]);
    expect(second.conflictItemIds).toEqual(["item-a"]);
  });
});
