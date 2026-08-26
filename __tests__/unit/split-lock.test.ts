import { describe, it, expect } from "vitest";
import {
  holdOrderShare,
  releaseOrderShare,
  type HoldResult,
} from "../../src/lib/split-lock";
import type { Sql } from "../../src/lib/db";

// A stateful stub Postgres modelling just enough of orders + payments +
// payment_holds to prove the split-pay reservation contract: a granted share is
// visible to the NEXT guest, so two people checking out against the same bill
// can never both be handed the whole remainder.
function makeSql(opts: {
  orderTotal?: number | null;
  paid?: number;
  supportsTransactions?: boolean;
}) {
  const holds = new Map<string, number>();
  const orderTotal = opts.orderTotal === undefined ? 1000 : opts.orderTotal;
  const paid = opts.paid ?? 0;
  const calls: Array<{ text: string; values: unknown[] }> = [];

  const run = (strings: TemplateStringsArray, values: unknown[]) => {
    const text = strings.join("?");
    calls.push({ text, values });

    if (/FROM orders\s+WHERE id = \? AND venue_id = \?\s+FOR UPDATE/i.test(text)) {
      return Promise.resolve(
        orderTotal === null ? [] : [{ total: orderTotal }],
      );
    }
    // In-transaction housekeeping: drop our own hold + anything expired.
    if (/DELETE FROM payment_holds[\s\S]*OR expires_at <= now\(\)/i.test(text)) {
      holds.delete(String(values[1]));
      return Promise.resolve([]);
    }
    // Explicit release.
    if (/DELETE FROM payment_holds[\s\S]*hold_key = \?/i.test(text)) {
      holds.delete(String(values[1]));
      return Promise.resolve([]);
    }
    if (/AS paid,[\s\S]*AS held/i.test(text)) {
      let held = 0;
      for (const amount of holds.values()) held += amount;
      return Promise.resolve([{ paid, held }]);
    }
    if (/INSERT INTO payment_holds/i.test(text)) {
      holds.set(String(values[2]), Number(values[3]));
      return Promise.resolve([]);
    }
    // Unlocked fallback clamp (no transaction support).
    if (/FROM orders o WHERE o\.id = \? AND o\.venue_id = \? LIMIT 1/i.test(text)) {
      return Promise.resolve(
        orderTotal === null ? [] : [{ total: orderTotal, paid }],
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
  return { sql, holds, calls };
}

const ORDER = "11111111-1111-1111-1111-111111111111";

describe("split-pay concurrency lock", () => {
  it("grants the outstanding balance to the first guest and nothing to the second", async () => {
    const { sql } = makeSql({ orderTotal: 1000 });

    const first = (await holdOrderShare(sql, {
      orderId: ORDER,
      venue: "v1",
      holdKey: "guest-a",
      requestedMinor: 1000,
    })) as HoldResult;
    expect(first.grantedMinor).toBe(1000);
    expect(first.serialised).toBe(true);

    // Second guest arrives BEFORE guest A's payment reaches the ledger. Without
    // the hold this returned 1000 again and the check was overpaid.
    const second = (await holdOrderShare(sql, {
      orderId: ORDER,
      venue: "v1",
      holdKey: "guest-b",
      requestedMinor: 1000,
    })) as HoldResult;
    expect(second.grantedMinor).toBe(0);
    expect(second.remainingMinor).toBe(0);
  });

  it("splits the bill between two concurrent guests without exceeding the total", async () => {
    const { sql } = makeSql({ orderTotal: 1000 });

    const a = (await holdOrderShare(sql, {
      orderId: ORDER,
      venue: "v1",
      holdKey: "guest-a",
      requestedMinor: 600,
    })) as HoldResult;
    const b = (await holdOrderShare(sql, {
      orderId: ORDER,
      venue: "v1",
      holdKey: "guest-b",
      requestedMinor: 600,
    })) as HoldResult;

    expect(a.grantedMinor).toBe(600);
    expect(b.grantedMinor).toBe(400);
    expect(a.grantedMinor + b.grantedMinor).toBe(1000);
  });

  it("counts already-settled payments against the balance", async () => {
    const { sql } = makeSql({ orderTotal: 1000, paid: 750 });
    const hold = (await holdOrderShare(sql, {
      orderId: ORDER,
      venue: "v1",
      holdKey: "guest-a",
      requestedMinor: 1000,
    })) as HoldResult;
    expect(hold.grantedMinor).toBe(250);
  });

  it("lets the same attempt retry against its own held share", async () => {
    const { sql } = makeSql({ orderTotal: 1000 });

    const first = (await holdOrderShare(sql, {
      orderId: ORDER,
      venue: "v1",
      holdKey: "same-key",
      requestedMinor: 1000,
    })) as HoldResult;
    const retry = (await holdOrderShare(sql, {
      orderId: ORDER,
      venue: "v1",
      holdKey: "same-key",
      requestedMinor: 1000,
    })) as HoldResult;

    expect(first.grantedMinor).toBe(1000);
    expect(retry.grantedMinor).toBe(1000);
  });

  it("frees the share when an attempt is released", async () => {
    const { sql } = makeSql({ orderTotal: 1000 });

    await holdOrderShare(sql, {
      orderId: ORDER,
      venue: "v1",
      holdKey: "guest-a",
      requestedMinor: 1000,
    });
    await releaseOrderShare(sql, ORDER, "guest-a");

    const next = (await holdOrderShare(sql, {
      orderId: ORDER,
      venue: "v1",
      holdKey: "guest-b",
      requestedMinor: 1000,
    })) as HoldResult;
    expect(next.grantedMinor).toBe(1000);
  });

  it("returns null for an unknown order so unrelated charges are untouched", async () => {
    const { sql } = makeSql({ orderTotal: null });
    const hold = await holdOrderShare(sql, {
      orderId: ORDER,
      venue: "v1",
      holdKey: "guest-a",
      requestedMinor: 1000,
    });
    expect(hold).toBeNull();
  });

  it("falls back to an unlocked clamp when transactions are unavailable", async () => {
    const { sql } = makeSql({
      orderTotal: 1000,
      paid: 400,
      supportsTransactions: false,
    });
    const hold = (await holdOrderShare(sql, {
      orderId: ORDER,
      venue: "v1",
      holdKey: "guest-a",
      requestedMinor: 1000,
    })) as HoldResult;

    expect(hold.grantedMinor).toBe(600);
    expect(hold.serialised).toBe(false);
  });

  it("never writes a hold larger than the outstanding balance", async () => {
    const { sql, holds } = makeSql({ orderTotal: 500 });
    await holdOrderShare(sql, {
      orderId: ORDER,
      venue: "v1",
      holdKey: "guest-a",
      requestedMinor: 99_999,
    });
    expect(holds.get("guest-a")).toBe(500);
  });

  // The shared function performs the payments read. Pin the venue argument at
  // this caller boundary so a future refactor cannot ask it about another store.
  it("scopes every balance read to the venue", async () => {
    const { sql, calls } = makeSql({ orderTotal: 1000 });
    await holdOrderShare(sql, {
      orderId: ORDER,
      venue: "v1",
      holdKey: "guest-a",
      requestedMinor: 400,
    });
    const balanceReads = calls.filter((call) =>
      /order_paid_minor\(\?, \?::uuid\)/i.test(call.text),
    );
    expect(balanceReads.length).toBeGreaterThan(0);
    for (const call of balanceReads) {
      expect(call.values[0]).toBe("v1");
    }
  });

  it("scopes the unlocked fallback clamp to the venue too", async () => {
    const { sql, calls } = makeSql({
      orderTotal: 1000,
      supportsTransactions: false,
    });
    await holdOrderShare(sql, {
      orderId: ORDER,
      venue: "v1",
      holdKey: "guest-a",
      requestedMinor: 400,
    });
    const balanceReads = calls.filter((call) =>
      /order_paid_minor\(\?, \?::uuid\)/i.test(call.text),
    );
    expect(balanceReads.length).toBeGreaterThan(0);
    for (const call of balanceReads) {
      expect(call.values[0]).toBe("v1");
    }
  });
});
