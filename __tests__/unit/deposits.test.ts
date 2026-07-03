import { describe, it, expect } from "vitest";

import type {
  DepositPolicy,
  Reservation,
} from "../../src/components/merchant/features/types";
import { getDepositDue, getDepositStats } from "../../src/lib/merchant-dashboard";

const policy: DepositPolicy = {
  enabled: true,
  perGuestKES: 500,
  minCovers: 6,
};

function res(
  partial: Partial<Reservation> & Pick<Reservation, "id" | "covers">,
): Reservation {
  return {
    tableNumber: 1,
    customerName: "Guest",
    phone: "",
    date: "2026-07-04",
    time: "19:00",
    status: "confirmed",
    ...partial,
  };
}

describe("getDepositDue", () => {
  it("charges per guest once covers meet the minimum", () => {
    expect(getDepositDue(policy, 6)).toBe(3000);
    expect(getDepositDue(policy, 8)).toBe(4000);
  });
  it("is zero below the minimum or when disabled", () => {
    expect(getDepositDue(policy, 4)).toBe(0);
    expect(getDepositDue({ ...policy, enabled: false }, 10)).toBe(0);
  });
});

describe("getDepositStats", () => {
  it("sums collected/pending/refunded and ignores cancelled/no-show", () => {
    const reservations = [
      res({ id: "a", covers: 8, depositStatus: "paid", depositAmount: 4000 }),
      res({ id: "b", covers: 6 }), // pending 3000
      res({ id: "c", covers: 4 }), // below min -> 0 pending
      res({ id: "d", covers: 10, depositStatus: "refunded", depositAmount: 5000 }),
      res({ id: "e", covers: 8, status: "cancelled" }), // ignored
      res({ id: "f", covers: 8, status: "no-show" }), // ignored
    ];
    const stats = getDepositStats(policy, reservations);
    expect(stats.collected).toBe(4000);
    expect(stats.pending).toBe(3000);
    expect(stats.refunded).toBe(5000);
  });
});
