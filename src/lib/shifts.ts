// End-of-shift Z-report maths. Pure (no DB/network) so it is unit-testable.
// All amounts are in MINOR units (cents), matching the payments ledger.

const SUCCEEDED = ["succeeded", "paid", "captured"];

export type ShiftPayment = {
  amount: number | string;
  tip_amount?: number | string | null;
  staff_id?: string | null;
  status: string;
};

export type ZReport = {
  digitalTotal: number; // M-Pesa / card / QR via PesaSwap
  tips: number;
  txCount: number;
  cashSales: number;
  openingFloat: number;
  expectedCash: number; // float + cash sales
  cashCounted: number | null;
  variance: number | null; // counted - expected (negative = short)
  grossTotal: number; // digital + cash sales
  byStaff: { staffId: string | null; total: number; tips: number; count: number }[];
};

const n = (v: unknown) => Number(v) || 0;

// Build the Z-report for a shift window from its digital payments + the manual
// cash figures captured at close.
export function zReport(input: {
  payments: ShiftPayment[];
  openingFloat?: number;
  cashSales?: number;
  cashCounted?: number | null;
}): ZReport {
  const succeeded = input.payments.filter((p) => SUCCEEDED.includes(p.status));
  const digitalTotal = succeeded.reduce((s, p) => s + n(p.amount), 0);
  const tips = succeeded.reduce((s, p) => s + n(p.tip_amount), 0);
  const txCount = succeeded.length;

  const openingFloat = Math.max(0, n(input.openingFloat));
  const cashSales = Math.max(0, n(input.cashSales));
  const expectedCash = openingFloat + cashSales;
  const cashCounted =
    input.cashCounted == null ? null : Math.max(0, n(input.cashCounted));
  const variance = cashCounted == null ? null : cashCounted - expectedCash;

  const staffMap = new Map<
    string | null,
    { staffId: string | null; total: number; tips: number; count: number }
  >();
  for (const p of succeeded) {
    const key = p.staff_id ?? null;
    const row =
      staffMap.get(key) ?? { staffId: key, total: 0, tips: 0, count: 0 };
    row.total += n(p.amount);
    row.tips += n(p.tip_amount);
    row.count += 1;
    staffMap.set(key, row);
  }

  return {
    digitalTotal,
    tips,
    txCount,
    cashSales,
    openingFloat,
    expectedCash,
    cashCounted,
    variance,
    grossTotal: digitalTotal + cashSales,
    byStaff: [...staffMap.values()].sort((a, b) => b.total - a.total),
  };
}
