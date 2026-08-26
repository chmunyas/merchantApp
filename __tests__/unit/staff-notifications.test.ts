import { describe, it, expect } from "vitest";
import {
  STAFF_NOTIFICATION_TYPES,
  STAFF_NOTIFICATION_TYPE_LIST,
  classifyPaymentFailure,
  formatStaffNotification,
  isStaffNotificationType,
  selectRecipients,
  typeEnabled,
  type NotificationCandidate,
} from "../../src/lib/staff-notifications";

// A server is only useful on a busy floor if they are paged for THEIR tables and
// nothing else. Every case below is a way that guarantee could silently break.

function candidate(
  over: Partial<NotificationCandidate> & { staffId: string },
): NotificationCandidate {
  return {
    venue: "v1",
    follows: [],
    prefs: {},
    onShift: null,
    ...over,
  };
}

const alice = candidate({
  staffId: "alice",
  follows: [{ key: "t-12", label: "12" }],
});
const bob = candidate({
  staffId: "bob",
  follows: [{ key: "t-7", label: "7" }],
});

describe("staff notification recipients", () => {
  it("pages only the servers following that table", () => {
    const got = selectRecipients(
      { venue: "v1", type: "payment.full", tableKey: "t-12", tableLabel: "12" },
      [alice, bob],
    );
    expect(got).toEqual(["alice"]);
  });

  it("does not page a server who follows nothing", () => {
    const got = selectRecipients(
      { venue: "v1", type: "payment.full", tableKey: "t-12", tableLabel: "12" },
      [candidate({ staffId: "carol" })],
    );
    expect(got).toEqual([]);
  });

  it("matches a payment that only knows the table label", () => {
    // Orders carry a floorplan uuid; payment metadata usually carries "12".
    const got = selectRecipients(
      { venue: "v1", type: "payment.partial", tableKey: null, tableLabel: "12" },
      [alice, bob],
    );
    expect(got).toEqual(["alice"]);
  });

  it("matches the table label case-insensitively", () => {
    const terrace = candidate({
      staffId: "dan",
      follows: [{ key: null, label: "Terrace 4" }],
    });
    const got = selectRecipients(
      { venue: "v1", type: "order.new", tableKey: null, tableLabel: "terrace 4" },
      [terrace],
    );
    expect(got).toEqual(["dan"]);
  });

  it("never leaks across venues", () => {
    const intruder = candidate({
      staffId: "mallory",
      venue: "v2",
      follows: [{ key: "t-12", label: "12" }],
    });
    const got = selectRecipients(
      { venue: "v1", type: "payment.full", tableKey: "t-12", tableLabel: "12" },
      [intruder],
    );
    expect(got).toEqual([]);
  });

  it("respects a disabled notification type", () => {
    const muted = candidate({
      staffId: "alice",
      follows: [{ key: "t-12", label: "12" }],
      prefs: { "payment.full": false },
    });
    const got = selectRecipients(
      { venue: "v1", type: "payment.full", tableKey: "t-12", tableLabel: "12" },
      [muted],
    );
    expect(got).toEqual([]);
  });

  it("honours an explicit opt-IN for a type that is off by default", () => {
    expect(STAFF_NOTIFICATION_TYPES["payment.received"].defaultEnabled).toBe(
      false,
    );
    const keen = candidate({
      staffId: "alice",
      follows: [{ key: "t-12", label: "12" }],
      prefs: { "payment.received": true },
    });
    const got = selectRecipients(
      { venue: "v1", type: "payment.received", tableKey: "t-12", tableLabel: "12" },
      [keen],
    );
    expect(got).toEqual(["alice"]);
  });

  it("skips a clocked-out server but not one with no shift history", () => {
    const clockedOut = candidate({
      staffId: "alice",
      follows: [{ key: "t-12", label: "12" }],
      onShift: false,
    });
    const noShifts = candidate({
      staffId: "bob",
      follows: [{ key: "t-12", label: "12" }],
      onShift: null,
    });
    const got = selectRecipients(
      { venue: "v1", type: "payment.full", tableKey: "t-12", tableLabel: "12" },
      [clockedOut, noShifts],
    );
    expect(got).toEqual(["bob"]);
  });

  it("never broadcasts a table-scoped alert that has no table", () => {
    const got = selectRecipients(
      { venue: "v1", type: "payment.full", tableKey: null, tableLabel: null },
      [alice, bob],
    );
    expect(got).toEqual([]);
  });

  it("sends a directly attributed tip only to that server", () => {
    const got = selectRecipients(
      { venue: "v1", type: "tip.new", tableKey: "t-7", tableLabel: "7", targetStaffId: "alice" },
      [alice, bob],
    );
    // bob follows table 7, but the tip belongs to alice.
    expect(got).toEqual(["alice"]);
  });

  it("delivers a venue-wide type with no table to everyone who wants it", () => {
    const got = selectRecipients(
      { venue: "v1", type: "review.new", tableKey: null, tableLabel: null },
      [alice, bob],
    );
    expect(got).toEqual(["alice", "bob"]);
  });

  it("never returns a duplicate recipient", () => {
    const twice = candidate({
      staffId: "alice",
      follows: [
        { key: "t-12", label: "12" },
        { key: null, label: "12" },
      ],
    });
    const got = selectRecipients(
      { venue: "v1", type: "payment.full", tableKey: "t-12", tableLabel: "12" },
      [twice, twice],
    );
    expect(got).toEqual(["alice"]);
  });
});

describe("notification type catalogue", () => {
  it("exposes every Sunday alert", () => {
    // Sunday's full documented set of 12, plus B2.12 "table fully paid".
    // B2.9 payment.unsynced completes the set — it was the last one blocked on
    // the POS connector.
    expect(STAFF_NOTIFICATION_TYPE_LIST).toHaveLength(13);
    expect(STAFF_NOTIFICATION_TYPE_LIST).toContain("walkout.potential");
    expect(STAFF_NOTIFICATION_TYPE_LIST).toContain("payment.unsynced");
  });

  it("validates unknown types", () => {
    expect(isStaffNotificationType("payment.full")).toBe(true);
    expect(isStaffNotificationType("payment.nope")).toBe(false);
    expect(isStaffNotificationType(null)).toBe(false);
  });

  it("falls back to the type default when there is no override", () => {
    expect(typeEnabled("payment.full", {})).toBe(true);
    expect(typeEnabled("payment.received", {})).toBe(false);
    expect(typeEnabled("payment.received", { "payment.received": true })).toBe(true);
  });
});

describe("payment failure classification", () => {
  it("prefers fraud over 3DS — it is the one needing action before the guest leaves", () => {
    expect(
      classifyPaymentFailure({
        fraudDecision: "reject",
        errorMessage: "3ds authentication_failed",
      }),
    ).toBe("payment.fraud");
  });

  it("detects 3DS failures", () => {
    expect(
      classifyPaymentFailure({ errorCode: "three_ds_failed" }),
    ).toBe("payment.failed_3ds");
  });

  it("falls back to a plain decline", () => {
    expect(
      classifyPaymentFailure({ errorMessage: "insufficient funds" }),
    ).toBe("payment.failed");
  });
});

describe("notification copy", () => {
  it("names the table and the outstanding balance on a split bill", () => {
    const { title, body } = formatStaffNotification("payment.partial", {
      tableLabel: "12",
      amountMinor: 150_000,
      remainingMinor: 50_000,
      currency: "KES",
    });
    expect(title).toBe("Partial Payment (Split Bill)");
    expect(body).toContain('Table "12"');
    expect(body).toContain("KES 1,500");
    expect(body).toContain("KES 500");
  });

  it("uses Sunday's exact alert names", () => {
    expect(formatStaffNotification("payment.full").title).toBe("Full Payment");
    expect(formatStaffNotification("payment.failed_3ds").title).toBe(
      "3DS Payment Failed",
    );
    expect(formatStaffNotification("payment.fraud").title).toBe(
      "Potential Fraud",
    );
  });

  it("tells the server what is owed and to leave the check open (B2.8)", () => {
    const { title, body } = formatStaffNotification("walkout.potential", {
      tableLabel: "12",
      remainingMinor: 45_000,
      idleMinutes: 60,
      currency: "KES",
    });
    expect(title).toBe('Potential Walkout on Table "12"');
    expect(body).toContain("KES 450");
    expect(body).toContain("60 min");
    // Sunday step 1: closing the check is the one irreversible mistake.
    expect(body).toContain("leave the check open");
  });
});
