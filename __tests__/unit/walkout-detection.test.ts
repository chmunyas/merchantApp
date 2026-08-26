import { describe, expect, it } from "vitest";

import {
  DEFAULT_WALKOUT_SETTINGS,
  evaluateWalkout,
  isWalkoutCandidate,
  isWalkoutStatus,
  normalizeWalkoutSettings,
  type WalkoutSignals,
  type WalkoutSettings,
} from "../../src/lib/walkouts";

// C9.1. A false positive pages a server away from a live table for nothing; a
// false negative lets a bill walk out of the door. Every case below is a way one
// of those could start happening silently.

const NOW = new Date("2026-08-24T20:00:00.000Z");

function minutesAgo(minutes: number): string {
  return new Date(NOW.getTime() - minutes * 60_000).toISOString();
}

function signals(over: Partial<WalkoutSignals> = {}): WalkoutSignals {
  return {
    orderId: "11111111-1111-4111-8111-111111111111",
    tableKey: "t-12",
    tableLabel: "12",
    totalMinor: 450_00,
    paidMinor: 0,
    currency: "KES",
    orderStatus: "served",
    paidAt: null,
    qrScannedAt: minutesAgo(90),
    lastActivityAt: minutesAgo(60),
    alreadyReported: false,
    ...over,
  };
}

const settings: WalkoutSettings = {
  enabled: true,
  idleMinutes: 45,
  requireQrScan: true,
};

describe("walkout detection predicate", () => {
  it("flags an open balance on a scanned table that has gone idle", () => {
    const verdict = evaluateWalkout(signals(), settings, NOW);
    expect(verdict.candidate).toBe(true);
    expect(verdict.reason).toBe("candidate");
    expect(verdict.outstandingMinor).toBe(450_00);
    expect(verdict.idleMinutes).toBe(60);
  });

  it("does not flag a bill that has been paid in full", () => {
    const verdict = evaluateWalkout(
      signals({ paidMinor: 450_00 }),
      settings,
      NOW,
    );
    expect(verdict.candidate).toBe(false);
    expect(verdict.reason).toBe("no_balance");
    expect(verdict.outstandingMinor).toBe(0);
  });

  it("does not flag a check that already closed, even with an arithmetic gap", () => {
    // paid_at is authoritative: a comped or manually settled check is closed.
    const verdict = evaluateWalkout(
      signals({ paidAt: minutesAgo(10), paidMinor: 0 }),
      settings,
      NOW,
    );
    expect(verdict.candidate).toBe(false);
    expect(verdict.reason).toBe("settled");
  });

  it("does not flag a cancelled check", () => {
    const verdict = evaluateWalkout(
      signals({ orderStatus: "cancelled" }),
      settings,
      NOW,
    );
    expect(verdict.candidate).toBe(false);
    expect(verdict.reason).toBe("check_closed");
  });

  it("does not flag a table whose QR was never scanned", () => {
    // Sunday's precondition: the QR must have been scanned during table service.
    const verdict = evaluateWalkout(
      signals({ qrScannedAt: null }),
      settings,
      NOW,
    );
    expect(verdict.candidate).toBe(false);
    expect(verdict.reason).toBe("no_qr_scan");
  });

  it("flags an unscanned table when the venue does not require a scan", () => {
    const verdict = evaluateWalkout(
      signals({ qrScannedAt: null }),
      { ...settings, requireQrScan: false },
      NOW,
    );
    expect(verdict.candidate).toBe(true);
  });

  it("does not flag a table that is not idle yet", () => {
    const verdict = evaluateWalkout(
      signals({ lastActivityAt: minutesAgo(20) }),
      settings,
      NOW,
    );
    expect(verdict.candidate).toBe(false);
    expect(verdict.reason).toBe("not_idle");
    expect(verdict.idleMinutes).toBe(20);
  });

  it("treats the threshold as inclusive", () => {
    expect(
      isWalkoutCandidate(
        signals({ lastActivityAt: minutesAgo(44) }),
        settings,
        NOW,
      ),
    ).toBe(false);
    expect(
      isWalkoutCandidate(
        signals({ lastActivityAt: minutesAgo(45) }),
        settings,
        NOW,
      ),
    ).toBe(true);
  });

  it("honours a venue's own idle threshold rather than a hardcoded one", () => {
    const patient: WalkoutSettings = { ...settings, idleMinutes: 120 };
    expect(isWalkoutCandidate(signals(), patient, NOW)).toBe(false);
    const twitchy: WalkoutSettings = { ...settings, idleMinutes: 15 };
    expect(isWalkoutCandidate(signals(), twitchy, NOW)).toBe(true);
  });

  it("does not re-flag a walkout somebody already reported", () => {
    const verdict = evaluateWalkout(
      signals({ alreadyReported: true }),
      settings,
      NOW,
    );
    expect(verdict.candidate).toBe(false);
    expect(verdict.reason).toBe("already_reported");
  });

  it("goes quiet entirely when the venue turns detection off", () => {
    const verdict = evaluateWalkout(
      signals(),
      { ...settings, enabled: false },
      NOW,
    );
    expect(verdict.candidate).toBe(false);
    expect(verdict.reason).toBe("detection_disabled");
  });

  it("treats a partially paid split bill as an outstanding balance", () => {
    const verdict = evaluateWalkout(
      signals({ paidMinor: 200_00 }),
      settings,
      NOW,
    );
    expect(verdict.candidate).toBe(true);
    expect(verdict.outstandingMinor).toBe(250_00);
  });

  it("never reports a negative balance when a bill was overpaid", () => {
    const verdict = evaluateWalkout(
      signals({ paidMinor: 900_00 }),
      settings,
      NOW,
    );
    expect(verdict.outstandingMinor).toBe(0);
    expect(verdict.candidate).toBe(false);
  });

  it("does not go back in time when activity is in the future", () => {
    const verdict = evaluateWalkout(
      signals({ lastActivityAt: new Date(NOW.getTime() + 60_000).toISOString() }),
      settings,
      NOW,
    );
    expect(verdict.idleMinutes).toBe(0);
    expect(verdict.candidate).toBe(false);
  });
});

describe("walkout settings", () => {
  it("falls back to the documented defaults", () => {
    expect(normalizeWalkoutSettings({})).toEqual(DEFAULT_WALKOUT_SETTINGS);
    expect(normalizeWalkoutSettings(null)).toEqual(DEFAULT_WALKOUT_SETTINGS);
  });

  it("clamps an out-of-range idle threshold instead of trusting it", () => {
    expect(normalizeWalkoutSettings({ idleMinutes: 0 }).idleMinutes).toBe(5);
    expect(normalizeWalkoutSettings({ idleMinutes: 99999 }).idleMinutes).toBe(1440);
    expect(normalizeWalkoutSettings({ idleMinutes: "nope" }).idleMinutes).toBe(45);
  });
});

describe("walkout lifecycle", () => {
  it("recognises only the statuses the register can hold", () => {
    for (const status of [
      "open",
      "under_review",
      "recovered",
      "written_off",
      "dismissed",
    ]) {
      expect(isWalkoutStatus(status)).toBe(true);
    }
    // Coverage is a commercial decision, not a state this product computes.
    expect(isWalkoutStatus("covered")).toBe(false);
    expect(isWalkoutStatus("reimbursed")).toBe(false);
    expect(isWalkoutStatus("")).toBe(false);
  });
});
