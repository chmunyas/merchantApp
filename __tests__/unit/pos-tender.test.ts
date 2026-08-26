import { describe, expect, it } from "vitest";

import {
  MAX_PUSH_ATTEMPTS,
  PUSH_STATUS_LABEL,
  nextAttempt,
  planPush,
  unsyncedAlertBody,
} from "../../src/lib/pos/tender";
import { parseTenderMap } from "../../src/lib/pos-tender-map";
import { isRetryable } from "../../src/lib/pos/types";

const base = {
  hasConnection: true,
  connectorCanPush: true,
  posBillId: "bill-1",
  grossMinor: 5000,
  tipMinor: 500,
  guestFeeMinor: 0,
};

describe("planPush — what the POS is told, and what it is not", () => {
  it("pushes subtotal plus tip", () => {
    const plan = planPush(base);
    expect(plan).toMatchObject({ push: true, amountMinor: 5000, tipMinor: 500 });
  });

  it("EXCLUDES the guest's digital fee — the guest pays that to us, not the venue", () => {
    const plan = planPush({ ...base, guestFeeMinor: 300 });
    expect(plan).toMatchObject({ push: true, amountMinor: 4700 });
  });

  it("skips, and does not fail, when the venue has no POS", () => {
    expect(planPush({ ...base, hasConnection: false })).toMatchObject({
      push: false,
      status: "skipped",
    });
  });

  it("skips when the connector cannot push tenders at all", () => {
    expect(planPush({ ...base, connectorCanPush: false })).toMatchObject({
      push: false,
      status: "skipped",
    });
  });

  it("skips a payment with no bill behind it rather than alerting a server", () => {
    // A counter sale or a pay link has no check to land on. Treating that as an
    // unsynced payment would page the floor for something nobody can fix.
    expect(planPush({ ...base, posBillId: null })).toMatchObject({
      push: false,
      status: "skipped",
    });
  });

  it("skips when the fee consumes the whole payment", () => {
    expect(planPush({ ...base, grossMinor: 300, guestFeeMinor: 300 })).toMatchObject({
      push: false,
      status: "skipped",
    });
  });

  it("never pushes a negative amount", () => {
    const plan = planPush({ ...base, grossMinor: 100, guestFeeMinor: 900 });
    expect(plan.push).toBe(false);
  });

  it("clamps a tip that exceeds the pushed amount instead of stranding the payment", () => {
    const plan = planPush({ ...base, grossMinor: 1000, tipMinor: 9999 });
    expect(plan).toMatchObject({ push: true, amountMinor: 1000, tipMinor: 1000 });
  });

  it("treats a negative tip as no tip", () => {
    const plan = planPush({ ...base, tipMinor: -50 });
    expect(plan).toMatchObject({ push: true, tipMinor: 0 });
  });
});

describe("nextAttempt — retry, then tell a human", () => {
  it("marks a successful push Notified with no retry", () => {
    expect(nextAttempt({ ok: true }, 0)).toEqual({
      status: "notified",
      retryInSeconds: null,
      alert: false,
    });
  });

  it("backs off exponentially on a transient provider error", () => {
    expect(nextAttempt({ ok: false, error: "provider_error" }, 0).retryInSeconds).toBe(10);
    expect(nextAttempt({ ok: false, error: "provider_error" }, 1).retryInSeconds).toBe(20);
    expect(nextAttempt({ ok: false, error: "provider_error" }, 2).retryInSeconds).toBe(40);
  });

  it("caps the backoff so the guests have not left before we try again", () => {
    const out = nextAttempt({ ok: false, error: "provider_error" }, 3);
    expect(out.retryInSeconds).toBeLessThanOrEqual(300);
  });

  it("goes straight to Not Notified on a refusal, with no pointless backoff", () => {
    const out = nextAttempt({ ok: false, error: "rejected" }, 0);
    expect(out).toEqual({ status: "not_notified", retryInSeconds: null, alert: true });
  });

  it("does not retry an unauthorized or misconfigured venue", () => {
    expect(nextAttempt({ ok: false, error: "unauthorized" }, 0).status).toBe("not_notified");
    expect(nextAttempt({ ok: false, error: "misconfigured" }, 0).status).toBe("not_notified");
    expect(nextAttempt({ ok: false, error: "unsupported" }, 0).status).toBe("not_notified");
  });

  it("gives up at the attempt ceiling and alerts", () => {
    const out = nextAttempt({ ok: false, error: "provider_error" }, MAX_PUSH_ATTEMPTS - 1);
    expect(out).toEqual({ status: "not_notified", retryInSeconds: null, alert: true });
  });

  it("alerts exactly once — only on the transition to Not Notified", () => {
    expect(nextAttempt({ ok: false, error: "provider_error" }, 0).alert).toBe(false);
    expect(nextAttempt({ ok: true }, 4).alert).toBe(false);
    expect(nextAttempt({ ok: false, error: "rejected" }, 0).alert).toBe(true);
  });

  it("classifies retryability so a permanent refusal is never retried", () => {
    expect(isRetryable("provider_error")).toBe(true);
    expect(isRetryable("not_configured")).toBe(true);
    expect(isRetryable("rejected")).toBe(false);
    expect(isRetryable("unauthorized")).toBe(false);
    expect(isRetryable("unsupported")).toBe(false);
  });
});

describe("the unsynced alert", () => {
  it("says the money is collected before it says anything else", () => {
    const body = unsyncedAlertBody(428400, "12");
    expect(body).toContain("did not reach the POS");
    expect(body).toContain("money is collected");
    expect(body).toContain('"sunday" payment method');
    expect(body).toContain("table 12");
  });

  it("works for a payment with no table", () => {
    expect(unsyncedAlertBody(1000, null)).not.toContain("table");
  });

  it("uses Sunday's own status vocabulary", () => {
    expect(PUSH_STATUS_LABEL.notified).toBe("Notified");
    expect(PUSH_STATUS_LABEL.not_notified).toBe("Not Notified");
  });
});

describe("parseTenderMap — ambiguity here becomes a reconciliation gap", () => {
  it("accepts one sunday tender and one exception tender", () => {
    const out = parseTenderMap([
      { posPaymentMethodId: "m1", label: "sunday", role: "sunday" },
      { posPaymentMethodId: "m2", label: "sunday flush", role: "exception" },
      { posPaymentMethodId: "m3", label: "Cash", role: "other" },
    ]);
    expect(out).toMatchObject({ tenders: expect.any(Array) });
  });

  it("refuses two sunday tenders", () => {
    const out = parseTenderMap([
      { posPaymentMethodId: "m1", role: "sunday" },
      { posPaymentMethodId: "m2", role: "sunday" },
    ]);
    expect(out).toEqual({
      error: "only one POS payment method can be the sunday tender",
    });
  });

  it("refuses two exception tenders", () => {
    const out = parseTenderMap([
      { posPaymentMethodId: "m1", role: "exception" },
      { posPaymentMethodId: "m2", role: "exception" },
    ]);
    expect("error" in out).toBe(true);
  });

  it("refuses a duplicate payment method id", () => {
    const out = parseTenderMap([
      { posPaymentMethodId: "m1", role: "sunday" },
      { posPaymentMethodId: "m1", role: "other" },
    ]);
    expect(out).toEqual({ error: "duplicate POS payment method m1" });
  });

  it("defaults an unknown role to other rather than guessing sunday", () => {
    const out = parseTenderMap([{ posPaymentMethodId: "m1", role: "primary" }]);
    expect(out).toMatchObject({ tenders: [{ role: "other" }] });
  });

  it("drops an entry with no payment method id", () => {
    const out = parseTenderMap([{ label: "nameless" }, { posPaymentMethodId: "m1" }]);
    expect(out).toMatchObject({ tenders: [{ posPaymentMethodId: "m1" }] });
  });

  it("falls back to the id when no label is given", () => {
    const out = parseTenderMap([{ posPaymentMethodId: "m1" }]);
    expect(out).toMatchObject({ tenders: [{ label: "m1" }] });
  });

  it("rejects a non-array", () => {
    expect(parseTenderMap(null)).toEqual({ error: "tenders must be an array" });
    expect(parseTenderMap({})).toEqual({ error: "tenders must be an array" });
  });
});
