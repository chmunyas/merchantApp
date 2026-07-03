import { describe, it, expect } from "vitest";

import type {
  LoyaltyCustomer,
  Reservation,
} from "../../src/components/merchant/features/types";
import {
  getCampaignRecipients,
  matchReservationsForTrigger,
  renderTemplate,
} from "../../src/lib/merchant-dashboard";

describe("renderTemplate", () => {
  it("substitutes known variables and blanks unknown ones", () => {
    expect(
      renderTemplate("Hi {{name}}, table for {{covers}} at {{venue}}.", {
        name: "Amina",
        covers: 6,
        venue: "Sade's",
      }),
    ).toBe("Hi Amina, table for 6 at Sade's.");
    expect(renderTemplate("{{missing}} end", {})).toBe(" end");
  });
});

describe("getCampaignRecipients", () => {
  const now = new Date("2026-07-04T00:00:00.000Z");
  const customers: LoyaltyCustomer[] = [
    {
      phone: "1",
      name: "Plat",
      points: 0,
      totalSpent: 0,
      visits: 1,
      tier: "Platinum",
      lastVisit: "2026-07-01",
    },
    {
      phone: "2",
      name: "Gold",
      points: 0,
      totalSpent: 0,
      visits: 1,
      tier: "Gold",
      lastVisit: "2026-05-01",
    },
    {
      phone: "3",
      name: "Silver",
      points: 0,
      totalSpent: 0,
      visits: 1,
      tier: "Silver",
      lastVisit: "2026-07-02",
    },
  ];

  it("returns all contacts for the 'all' segment", () => {
    expect(getCampaignRecipients("all", customers, now)).toHaveLength(3);
  });

  it("filters Gold & Platinum for 'gold_plus'", () => {
    expect(
      getCampaignRecipients("gold_plus", customers, now).map((c) => c.name),
    ).toEqual(["Plat", "Gold"]);
  });

  it("filters contacts inactive 30+ days for 'lapsed'", () => {
    // only Gold (last visit 2026-05-01) is >30 days before 2026-07-04
    expect(
      getCampaignRecipients("lapsed", customers, now).map((c) => c.name),
    ).toEqual(["Gold"]);
  });
});

describe("matchReservationsForTrigger", () => {
  function res(
    partial: Partial<Reservation> & Pick<Reservation, "id" | "status">,
  ): Reservation {
    return {
      tableNumber: 1,
      customerName: "G",
      phone: "",
      date: "2026-07-04",
      time: "19:00",
      covers: 2,
      ...partial,
    };
  }
  const reservations = [
    res({ id: "a", status: "confirmed" }),
    res({ id: "b", status: "seated" }),
    res({ id: "c", status: "no-show" }),
    res({ id: "d", status: "confirmed", date: "2026-07-05" }),
  ];

  it("booking_created -> confirmed today", () => {
    expect(
      matchReservationsForTrigger("booking_created", reservations, "2026-07-04").map(
        (r) => r.id,
      ),
    ).toEqual(["a"]);
  });
  it("reminder -> confirmed + seated today", () => {
    expect(
      matchReservationsForTrigger("reminder", reservations, "2026-07-04").map(
        (r) => r.id,
      ),
    ).toEqual(["a", "b"]);
  });
  it("post_visit -> seated today", () => {
    expect(
      matchReservationsForTrigger("post_visit", reservations, "2026-07-04").map(
        (r) => r.id,
      ),
    ).toEqual(["b"]);
  });
  it("no_show -> no-show today", () => {
    expect(
      matchReservationsForTrigger("no_show", reservations, "2026-07-04").map(
        (r) => r.id,
      ),
    ).toEqual(["c"]);
  });
});
