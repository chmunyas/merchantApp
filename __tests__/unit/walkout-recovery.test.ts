import { describe, expect, it } from "vitest";

import { recoverWalkoutsForPaidOrder } from "../../src/lib/walkouts";
import type { QuerySql } from "../../src/lib/db";

// C9.4. Sunday's contract: if the guest returns to the bill from their phone and
// pays, the check closes automatically — and a walkout reported against that
// check must close with it. A register that keeps claiming a loss on a bill the
// venue was actually paid for is worse than no register at all.

type Walkout = {
  id: string;
  venue: string;
  orderId: string;
  status: string;
  recoveredMinor: number;
  recoveredPaymentId: string | null;
};

type Event = {
  venue: string;
  walkoutId: string;
  event: string;
  toStatus: string | null;
  actorRole: string | null;
  detail: Record<string, unknown>;
};

const LIVE = new Set(["open", "under_review"]);

function makeSql(seed: Walkout[]) {
  const walkouts = seed.map((w) => ({ ...w }));
  const events: Event[] = [];

  const run = (strings: TemplateStringsArray, values: unknown[]) => {
    const text = strings.join("?");

    if (/UPDATE walkouts[\s\S]*SET status = 'recovered'/i.test(text)) {
      // Values, in template order: recoveredMinor, paymentId, venue, orderId.
      const [recovered, paymentId, venue, orderId] = values;
      const hit = walkouts.filter(
        (w) =>
          w.venue === venue && w.orderId === orderId && LIVE.has(w.status),
      );
      for (const w of hit) {
        w.status = "recovered";
        w.recoveredMinor = Math.max(w.recoveredMinor, Number(recovered));
        w.recoveredPaymentId = w.recoveredPaymentId ?? (paymentId as string);
      }
      return Promise.resolve(hit.map((w) => ({ id: w.id })));
    }

    if (/INSERT INTO walkout_events/i.test(text)) {
      const [venue, walkoutId, event, , toStatus, , , actorRole, detail] =
        values;
      events.push({
        venue: String(venue),
        walkoutId: String(walkoutId),
        event: String(event),
        toStatus: toStatus == null ? null : String(toStatus),
        actorRole: actorRole == null ? null : String(actorRole),
        detail: detail as Record<string, unknown>,
      });
      return Promise.resolve([]);
    }

    return Promise.resolve([]);
  };

  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) =>
    run(strings, values)) as unknown as QuerySql & {
    json: (value: unknown) => unknown;
  };
  sql.json = (value: unknown) => value;
  return { sql: sql as QuerySql, walkouts, events };
}

function walkout(over: Partial<Walkout> = {}): Walkout {
  return {
    id: "w-1",
    venue: "v1",
    orderId: "o-1",
    status: "open",
    recoveredMinor: 0,
    recoveredPaymentId: null,
    ...over,
  };
}

describe("walkout auto-close on payment (C9.4)", () => {
  it("closes an open walkout when the guest pays the bill", async () => {
    const { sql, walkouts } = makeSql([walkout()]);

    const closed = await recoverWalkoutsForPaidOrder(sql, {
      venue: "v1",
      orderId: "o-1",
      paymentId: "pay-9",
      paidMinor: 450_00,
    });

    expect(closed).toEqual(["w-1"]);
    expect(walkouts[0].status).toBe("recovered");
    expect(walkouts[0].recoveredMinor).toBe(450_00);
    expect(walkouts[0].recoveredPaymentId).toBe("pay-9");
  });

  it("closes a walkout that a manager had already sent for review", async () => {
    const { sql, walkouts } = makeSql([walkout({ status: "under_review" })]);
    const closed = await recoverWalkoutsForPaidOrder(sql, {
      venue: "v1",
      orderId: "o-1",
      paymentId: "pay-9",
      paidMinor: 450_00,
    });
    expect(closed).toEqual(["w-1"]);
    expect(walkouts[0].status).toBe("recovered");
  });

  it("writes an audit event for every recovery", async () => {
    const { sql, events } = makeSql([walkout()]);
    await recoverWalkoutsForPaidOrder(sql, {
      venue: "v1",
      orderId: "o-1",
      paymentId: "pay-9",
      paidMinor: 450_00,
    });

    expect(events).toHaveLength(1);
    expect(events[0].event).toBe("recovered");
    expect(events[0].toStatus).toBe("recovered");
    expect(events[0].actorRole).toBe("system");
    expect(events[0].detail).toMatchObject({
      order_id: "o-1",
      payment_id: "pay-9",
      recovered_minor: 450_00,
    });
  });

  it("leaves an already-resolved walkout alone", async () => {
    const { sql, walkouts, events } = makeSql([
      walkout({ status: "written_off" }),
    ]);
    const closed = await recoverWalkoutsForPaidOrder(sql, {
      venue: "v1",
      orderId: "o-1",
      paymentId: "pay-9",
      paidMinor: 450_00,
    });
    expect(closed).toEqual([]);
    expect(walkouts[0].status).toBe("written_off");
    expect(events).toHaveLength(0);
  });

  it("never reaches into another venue's register", async () => {
    const { sql, walkouts } = makeSql([walkout({ venue: "v2" })]);
    const closed = await recoverWalkoutsForPaidOrder(sql, {
      venue: "v1",
      orderId: "o-1",
      paymentId: "pay-9",
      paidMinor: 450_00,
    });
    expect(closed).toEqual([]);
    expect(walkouts[0].status).toBe("open");
  });

  it("is a no-op for a check with no walkout on it", async () => {
    const { sql, events } = makeSql([]);
    const closed = await recoverWalkoutsForPaidOrder(sql, {
      venue: "v1",
      orderId: "o-404",
      paymentId: "pay-9",
      paidMinor: 100,
    });
    expect(closed).toEqual([]);
    expect(events).toHaveLength(0);
  });

  it("clamps a nonsense recovered amount to zero rather than storing it", async () => {
    const { sql, walkouts } = makeSql([walkout()]);
    await recoverWalkoutsForPaidOrder(sql, {
      venue: "v1",
      orderId: "o-1",
      paymentId: null,
      paidMinor: -500,
    });
    expect(walkouts[0].recoveredMinor).toBe(0);
    expect(walkouts[0].status).toBe("recovered");
  });
});
