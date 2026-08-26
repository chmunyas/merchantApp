import { describe, expect, it } from "vitest";

import {
  addDaysToIsoDate,
  currentCollectionWeek,
  jarIsOpen,
  localWeekStart,
  openJarWeek,
  payoutMondayFor,
  tipCadenceStatus,
  tipWeek,
  weeksLateFor,
} from "../../src/lib/tip-cadence";

const NAIROBI = "Africa/Nairobi"; // UTC+3, never observes DST
const PARIS = "Europe/Paris"; // UTC+1 / UTC+2 — exercises the DST boundary

/** Nairobi is UTC+3, so a local wall-clock time is that time minus 3 hours UTC. */
function nairobi(local: string): Date {
  return new Date(`${local}+03:00`);
}

describe("localWeekStart", () => {
  it("anchors on Monday, not Sunday", () => {
    // 2026-08-24 is a Monday.
    expect(localWeekStart(nairobi("2026-08-24T00:00:00"), NAIROBI)).toBe("2026-08-24");
    expect(localWeekStart(nairobi("2026-08-24T23:59:00"), NAIROBI)).toBe("2026-08-24");
    expect(localWeekStart(nairobi("2026-08-30T23:59:00"), NAIROBI)).toBe("2026-08-24");
    expect(localWeekStart(nairobi("2026-08-31T00:00:00"), NAIROBI)).toBe("2026-08-31");
  });

  it("uses venue-local midnight, not UTC midnight", () => {
    // 2026-08-31T00:30 Nairobi is 2026-08-30T21:30Z — still Sunday in UTC.
    expect(localWeekStart(nairobi("2026-08-31T00:30:00"), NAIROBI)).toBe("2026-08-31");
    expect(localWeekStart(new Date("2026-08-30T21:30:00Z"), "UTC")).toBe("2026-08-24");
  });
});

describe("tipWeek", () => {
  const week = tipWeek("2026-08-17", NAIROBI);

  it("runs Monday 00:00 to the next Monday 00:00 venue-local", () => {
    expect(week.collectionStart.toISOString()).toBe("2026-08-16T21:00:00.000Z");
    expect(week.collectionEnd.toISOString()).toBe("2026-08-23T21:00:00.000Z");
  });

  it("opens the jar at 18:00 on the Monday AFTER the week closes", () => {
    // Monday 2026-08-24 18:00 Nairobi === 15:00Z.
    expect(week.opensAt.toISOString()).toBe("2026-08-24T15:00:00.000Z");
  });

  it("schedules the on-time payout for the Monday after the distribution week", () => {
    expect(week.onTimeDeadline.toISOString()).toBe("2026-08-30T21:00:00.000Z");
    expect(week.scheduledPayoutAt.toISOString()).toBe("2026-08-30T21:00:00.000Z");
  });

  it("survives a DST transition in the middle of the cadence", () => {
    // Paris leaves CEST (UTC+2) for CET (UTC+1) on Sunday 2026-10-25.
    const dstWeek = tipWeek("2026-10-19", PARIS);
    expect(dstWeek.collectionStart.toISOString()).toBe("2026-10-18T22:00:00.000Z");
    // The following Monday is already CET, so local midnight is 23:00Z.
    expect(dstWeek.collectionEnd.toISOString()).toBe("2026-10-25T23:00:00.000Z");
    expect(dstWeek.opensAt.toISOString()).toBe("2026-10-26T17:00:00.000Z");
  });
});

describe("jar opening (Monday 18:00)", () => {
  const week = tipWeek("2026-08-17", NAIROBI);

  it("is shut at 17:59 on the Monday and open at 18:00", () => {
    expect(jarIsOpen(week, nairobi("2026-08-24T17:59:59"))).toBe(false);
    expect(jarIsOpen(week, nairobi("2026-08-24T18:00:00"))).toBe(true);
  });

  it("is shut for the whole of the collection week itself", () => {
    expect(jarIsOpen(week, nairobi("2026-08-23T23:59:00"))).toBe(false);
  });
});

describe("openJarWeek", () => {
  it("before Monday 18:00 the newest open jar is still the week before last", () => {
    const week = openJarWeek(nairobi("2026-08-24T12:00:00"), NAIROBI);
    expect(week.weekStart).toBe("2026-08-10");
  });

  it("from Monday 18:00 the week that just closed becomes distributable", () => {
    const week = openJarWeek(nairobi("2026-08-24T18:00:00"), NAIROBI);
    expect(week.weekStart).toBe("2026-08-17");
  });

  it("stays on that week for the rest of the distribution window", () => {
    expect(openJarWeek(nairobi("2026-08-30T23:59:00"), NAIROBI).weekStart).toBe("2026-08-17");
  });

  it("rolls forward once the next Monday 18:00 arrives", () => {
    expect(openJarWeek(nairobi("2026-08-31T18:00:00"), NAIROBI).weekStart).toBe("2026-08-24");
  });
});

describe("payout Monday", () => {
  it("pays on the Monday following the distribution week", () => {
    // Distribute Wednesday 2026-08-26 → Monday 2026-08-31 local midnight.
    expect(payoutMondayFor(nairobi("2026-08-26T10:00:00"), NAIROBI).toISOString()).toBe(
      "2026-08-30T21:00:00.000Z",
    );
  });

  it("treats the whole Monday-to-Sunday window as one distribution week", () => {
    const monday = payoutMondayFor(nairobi("2026-08-24T18:00:00"), NAIROBI).toISOString();
    const sunday = payoutMondayFor(nairobi("2026-08-30T23:59:00"), NAIROBI).toISOString();
    expect(monday).toBe(sunday);
    expect(monday).toBe("2026-08-30T21:00:00.000Z");
  });
});

describe("lateness (the S+2 rule)", () => {
  const week = tipWeek("2026-08-17", NAIROBI);

  it("is on time anywhere in the Monday-to-Sunday window", () => {
    expect(weeksLateFor(week, nairobi("2026-08-24T18:00:00"), NAIROBI)).toBe(0);
    expect(weeksLateFor(week, nairobi("2026-08-27T09:00:00"), NAIROBI)).toBe(0);
    expect(weeksLateFor(week, nairobi("2026-08-30T23:59:00"), NAIROBI)).toBe(0);
  });

  it("slipping a week pays on the Monday of the second week", () => {
    // Distribution slips into 2026-08-31..09-06 → paid Monday 2026-09-07,
    // one week after the promised 2026-08-31, i.e. S+2 from the jar opening.
    expect(weeksLateFor(week, nairobi("2026-09-02T11:00:00"), NAIROBI)).toBe(1);
    expect(payoutMondayFor(nairobi("2026-09-02T11:00:00"), NAIROBI).toISOString()).toBe(
      "2026-09-06T21:00:00.000Z",
    );
  });

  it("slipping two weeks compounds rather than resetting", () => {
    expect(weeksLateFor(week, nairobi("2026-09-09T11:00:00"), NAIROBI)).toBe(2);
  });

  it("never reports negative lateness for an early clock skew", () => {
    expect(weeksLateFor(week, nairobi("2026-08-18T11:00:00"), NAIROBI)).toBe(0);
  });
});

describe("tipCadenceStatus", () => {
  it("reports the open jar, its deadline and where it would land today", () => {
    const status = tipCadenceStatus(nairobi("2026-08-26T09:00:00"), NAIROBI);
    expect(status.week.weekStart).toBe("2026-08-17");
    expect(status.isOpen).toBe(true);
    expect(status.isLate).toBe(false);
    expect(status.weeksLateIfDistributedNow).toBe(0);
    expect(status.payoutIfDistributedNow.toISOString()).toBe("2026-08-30T21:00:00.000Z");
  });

  it("flags a jar whose on-time window has already elapsed", () => {
    const status = tipCadenceStatus(
      nairobi("2026-09-02T09:00:00"),
      NAIROBI,
      tipWeek("2026-08-17", NAIROBI),
    );
    expect(status.isLate).toBe(true);
    expect(status.weeksLateIfDistributedNow).toBe(1);
  });
});

describe("currentCollectionWeek", () => {
  it("is the week guests are tipping into right now", () => {
    expect(currentCollectionWeek(nairobi("2026-08-26T09:00:00"), NAIROBI).weekStart).toBe(
      "2026-08-24",
    );
  });
});

describe("addDaysToIsoDate", () => {
  it("crosses month and year boundaries", () => {
    expect(addDaysToIsoDate("2026-08-31", 7)).toBe("2026-09-07");
    expect(addDaysToIsoDate("2027-01-04", -7)).toBe("2026-12-28");
  });
});
