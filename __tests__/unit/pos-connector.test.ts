import { describe, expect, it } from "vitest";

import {
  normalizeCheck,
  normalizeLine,
  outstandingMinor,
  reconcileTotals,
  toMinor,
} from "../../src/lib/pos/normalize";
import {
  POS_PROVIDERS,
  capabilityVerdict,
  isPosProvider,
  providerCapabilities,
  type PosConnector,
} from "../../src/lib/pos/types";
import { mapToastCheck } from "../../src/lib/pos/toast";

describe("toMinor", () => {
  it("converts major units to minor", () => {
    expect(toMinor(12.34, "major")).toBe(1234);
    expect(toMinor("12.34", "major")).toBe(1234);
  });

  it("passes minor units through, rounded", () => {
    expect(toMinor(1234, "minor")).toBe(1234);
    expect(toMinor(1234.6, "minor")).toBe(1235);
  });

  it("treats an unparseable amount as zero rather than NaN", () => {
    expect(toMinor("not a number", "major")).toBe(0);
    expect(toMinor(undefined, "major")).toBe(0);
    expect(toMinor(null, "minor")).toBe(0);
  });

  it("does not lose a cent to floating point", () => {
    expect(toMinor(0.29, "major")).toBe(29);
    expect(toMinor(1.005, "major")).toBe(101);
  });
});

describe("reconcileTotals — the POS is the authority on what is owed", () => {
  it("keeps the POS total and reports the gap when the parts disagree", () => {
    const out = reconcileTotals({
      subtotalMinor: 1000,
      taxMinor: 160,
      serviceChargeMinor: 100,
      discountMinor: 0,
      statedTotalMinor: 1300,
      lineTotalMinor: 1000,
    });
    expect(out.totalMinor).toBe(1300);
    expect(out.discrepancyMinor).toBe(40);
    expect(out.trusted).toBe(false);
  });

  it("is trusted when the parts add up exactly", () => {
    const out = reconcileTotals({
      subtotalMinor: 1000,
      taxMinor: 160,
      serviceChargeMinor: 100,
      discountMinor: 60,
      statedTotalMinor: 1200,
      lineTotalMinor: 1000,
    });
    expect(out.totalMinor).toBe(1200);
    expect(out.discrepancyMinor).toBe(0);
    expect(out.trusted).toBe(true);
  });

  it("derives the total only when the POS sent none", () => {
    const out = reconcileTotals({
      subtotalMinor: 0,
      taxMinor: 160,
      serviceChargeMinor: 0,
      discountMinor: 0,
      statedTotalMinor: 0,
      lineTotalMinor: 1000,
    });
    expect(out.subtotalMinor).toBe(1000);
    expect(out.totalMinor).toBe(1160);
  });

  it("never produces a negative total from an oversized discount", () => {
    const out = reconcileTotals({
      subtotalMinor: 100,
      taxMinor: 0,
      serviceChargeMinor: 0,
      discountMinor: 500,
      statedTotalMinor: 0,
      lineTotalMinor: 100,
    });
    expect(out.totalMinor).toBe(0);
  });

  it("clamps negative components rather than crediting the guest", () => {
    const out = reconcileTotals({
      subtotalMinor: -500,
      taxMinor: -10,
      serviceChargeMinor: -10,
      discountMinor: -10,
      statedTotalMinor: 0,
      lineTotalMinor: 700,
    });
    expect(out.subtotalMinor).toBe(700);
    expect(out.taxMinor).toBe(0);
    expect(out.totalMinor).toBe(700);
  });
});

describe("normalizeLine", () => {
  const line = (over: Record<string, unknown> = {}) => ({
    id: "l1",
    name: "Pilau",
    quantity: 2,
    unitPrice: 9,
    ...over,
  });

  it("drops a line with no stable provider id", () => {
    expect(normalizeLine(line({ id: "" }), "major")).toBeNull();
    expect(normalizeLine(line({ id: undefined }), "major")).toBeNull();
  });

  it("drops a nameless line", () => {
    expect(normalizeLine(line({ name: "  " }), "major")).toBeNull();
  });

  it("trusts the provider's line total when it sent one", () => {
    const out = normalizeLine(line({ total: 17 }), "major");
    expect(out?.totalMinor).toBe(1700);
  });

  it("derives the total from qty and modifiers when the provider sent none", () => {
    const out = normalizeLine(
      line({ total: 0, modifiers: [{ name: "Extra sauce", price: 1 }] }),
      "major",
    );
    expect(out?.totalMinor).toBe(2 * 900 + 100);
  });

  it("falls back to a quantity of one on a nonsense quantity", () => {
    expect(normalizeLine(line({ quantity: 0 }), "major")?.qty).toBe(1);
    expect(normalizeLine(line({ quantity: -3 }), "major")?.qty).toBe(1);
    expect(normalizeLine(line({ quantity: "abc" }), "major")?.qty).toBe(1);
  });

  it("keeps a weighed quantity to three decimals", () => {
    expect(normalizeLine(line({ quantity: 0.4567 }), "major")?.qty).toBe(0.457);
  });

  it("drops modifiers that carry no name", () => {
    const out = normalizeLine(
      line({ modifiers: [{ price: 5 }, { name: "Large", price: 2 }] }),
      "major",
    );
    expect(out?.modifiers).toEqual([{ name: "Large", priceMinor: 200 }]);
  });
});

describe("normalizeCheck", () => {
  const base = {
    posBillId: "bill-1",
    total: 42.84,
    subtotal: 34,
    tax: 5.44,
    serviceCharge: 3.4,
    lines: [{ id: "l1", name: "Nyama", quantity: 1, unitPrice: 34, total: 34 }],
  };

  it("refuses a check with no bill id — it could never be reconciled", () => {
    expect(normalizeCheck({ ...base, posBillId: "" })).toBeNull();
    expect(normalizeCheck({ ...base, posBillId: null })).toBeNull();
  });

  it("carries the auto-gratuity through, which is what A3.2's tip tiers need", () => {
    expect(normalizeCheck(base)?.serviceChargeMinor).toBe(340);
  });

  it("keeps covers only when it is a sane guest count", () => {
    expect(normalizeCheck({ ...base, covers: 4 })?.covers).toBe(4);
    expect(normalizeCheck({ ...base, covers: -1 })?.covers).toBeNull();
    expect(normalizeCheck({ ...base, covers: 2.5 })?.covers).toBeNull();
    expect(normalizeCheck({ ...base, covers: 5000 })?.covers).toBeNull();
  });

  it("excludes voided lines from the derived subtotal", () => {
    const out = normalizeCheck({
      ...base,
      subtotal: 0,
      total: 0,
      tax: 0,
      serviceCharge: 0,
      lines: [
        { id: "l1", name: "Kept", quantity: 1, unitPrice: 10, total: 10 },
        { id: "l2", name: "Voided", quantity: 1, unitPrice: 10, total: 10, voided: true },
      ],
    });
    expect(out?.subtotalMinor).toBe(1000);
  });

  it("normalizes the currency and defaults it", () => {
    expect(normalizeCheck({ ...base, currency: "usd" })?.currency).toBe("USD");
    expect(normalizeCheck(base)?.currency).toBe("KES");
  });

  it("rejects an unparseable timestamp instead of inventing one", () => {
    expect(normalizeCheck({ ...base, openedAt: "yesterday" })?.openedAt).toBeNull();
    expect(normalizeCheck({ ...base, openedAt: "2026-08-24T10:00:00Z" })?.openedAt).toBe(
      "2026-08-24T10:00:00.000Z",
    );
  });
});

describe("outstandingMinor", () => {
  it("never reports a negative balance when a check is overpaid", () => {
    const check = normalizeCheck({ posBillId: "b", total: 10, paid: 25 })!;
    expect(outstandingMinor(check)).toBe(0);
  });

  it("reports the remaining balance on a part-paid check", () => {
    const check = normalizeCheck({ posBillId: "b", total: 20, paid: 8 })!;
    expect(outstandingMinor(check)).toBe(1200);
  });
});

describe("capability verdicts — degradation is stated, not silent", () => {
  const connector = (caps: string[]) =>
    ({ capabilities: new Set(caps) } as unknown as PosConnector);

  it("says the POS cannot do it when the provider profile lacks it", () => {
    const verdict = capabilityVerdict("zonal", connector([]), "reconciliation.export");
    expect(verdict).toMatchObject({ available: false, reason: "provider" });
  });

  it("says it is our gap when the provider supports it but we have not built it", () => {
    const verdict = capabilityVerdict("toast", connector(["check.pull"]), "menu.sync");
    expect(verdict).toMatchObject({ available: false, reason: "connector" });
  });

  it("blames the connector, not the POS, when no connector exists at all", () => {
    const verdict = capabilityVerdict("zelty", null, "check.pull");
    expect(verdict).toMatchObject({ available: false, reason: "connector" });
  });

  it("is available only when both sides agree", () => {
    expect(
      capabilityVerdict("toast", connector(["check.pull"]), "check.pull"),
    ).toEqual({ available: true });
  });

  it("marks exactly the four providers Sunday names as reconciliation-incompatible", () => {
    const incompatible = (Object.keys(POS_PROVIDERS) as Array<keyof typeof POS_PROVIDERS>)
      .filter((p) => p !== "simulator")
      .filter((p) => !providerCapabilities(p).has("reconciliation.export"))
      .sort();
    expect(incompatible).toEqual(["clover", "comtrex", "pi_electronique", "zonal"]);
  });

  it("claims menu sync only where Sunday documents it", () => {
    const withMenuSync = (Object.keys(POS_PROVIDERS) as Array<keyof typeof POS_PROVIDERS>)
      .filter((p) => p !== "simulator")
      .filter((p) => providerCapabilities(p).has("menu.sync"))
      .sort();
    expect(withMenuSync).toEqual(["ncr_aloha", "toast"]);
  });

  it("recognises only known providers", () => {
    expect(isPosProvider("toast")).toBe(true);
    expect(isPosProvider("square")).toBe(false);
    expect(isPosProvider(null)).toBe(false);
  });
});

describe("mapToastCheck", () => {
  const order = {
    numberOfGuests: 3,
    table: { name: "12" },
    server: { guid: "srv-1", firstName: "Amina", lastName: "K" },
    revenueCenter: { name: "Terrace" },
    openedDate: "2026-08-24T10:00:00Z",
  };

  it("maps a Toast check into our shape, in minor units", () => {
    const out = mapToastCheck(
      {
        guid: "chk-1",
        displayNumber: "104",
        amount: 34,
        taxAmount: 5.44,
        totalAmount: 42.84,
        appliedServiceCharges: [{ chargeAmount: 3.4 }],
        selections: [
          {
            guid: "sel-1",
            displayName: "Nyama Choma",
            item: { guid: "item-1" },
            quantity: 1,
            price: 34,
            modifiers: [{ displayName: "Extra kachumbari", price: 0 }],
          },
        ],
      },
      order,
    );
    expect(out?.posBillId).toBe("chk-1");
    expect(out?.totalMinor).toBe(4284);
    expect(out?.serviceChargeMinor).toBe(340);
    expect(out?.covers).toBe(3);
    expect(out?.posTableRef).toBe("12");
    expect(out?.posServerName).toBe("Amina K");
    expect(out?.revenueCentre).toBe("Terrace");
    expect(out?.lines[0]?.modifiers[0]?.name).toBe("Extra kachumbari");
  });

  it("sums several Toast service charges into one auto-gratuity", () => {
    const out = mapToastCheck(
      {
        guid: "chk-2",
        amount: 10,
        totalAmount: 14,
        appliedServiceCharges: [{ chargeAmount: 2 }, { chargeAmount: 2 }],
        selections: [],
      },
      order,
    );
    expect(out?.serviceChargeMinor).toBe(400);
  });

  it("does not invent a service — lunch vs dinner is ours to derive", () => {
    const out = mapToastCheck({ guid: "chk-3", totalAmount: 5, selections: [] }, order);
    expect(out?.service).toBeNull();
  });

  it("treats an unpaid check as owing its full total", () => {
    const out = mapToastCheck({ guid: "chk-4", totalAmount: 20, selections: [] }, order);
    expect(out?.paidMinor).toBe(0);
    expect(outstandingMinor(out!)).toBe(2000);
  });
});
