// Accounts-receivable aging, to the shape every accountant and auditor expects.
//
// The one rule that makes an aging report correct: an invoice ages from the day
// it becomes DUE, not the day it was issued. An invoice raised 45 days ago on
// 60-day terms is CURRENT — reporting it as "31-60 days overdue" overstates
// credit risk, misprices the bad-debt provision and starts collection calls
// against a customer who has done nothing wrong.
//
// Where no due date was captured, the invoice is treated as due on receipt,
// which is the conservative and conventional reading of blank terms.
//
// Balances are minor units, like every other money path here.

export const AGING_BUCKETS = [
  "current",
  "d1_30",
  "d31_60",
  "d61_90",
  "d90_plus",
] as const;

export type AgingBucket = (typeof AGING_BUCKETS)[number];

export const AGING_BUCKET_LABELS: Record<AgingBucket, string> = {
  current: "Current",
  d1_30: "1–30 days",
  d31_60: "31–60 days",
  d61_90: "61–90 days",
  d90_plus: "90+ days",
};

export type AgingInvoice = {
  number: string;
  customerName: string | null;
  phone: string | null;
  balanceMinor: number;
  /** Terms. Null means due on receipt. */
  dueDate: string | null;
  issuedAt: string;
};

export type AgedInvoice = AgingInvoice & {
  daysPastDue: number;
  bucket: AgingBucket;
};

export type AgingCustomer = {
  customerName: string;
  phone: string | null;
  totalMinor: number;
  buckets: Record<AgingBucket, number>;
  oldestDaysPastDue: number;
  invoiceCount: number;
};

export type AgingReport = {
  asOf: string;
  totalMinor: number;
  openCount: number;
  buckets: Record<AgingBucket, number>;
  /** Anything past due at all — the number a credit controller acts on. */
  overdueMinor: number;
  customers: AgingCustomer[];
  invoices: AgedInvoice[];
};

function startOfDayUtc(value: string | Date): number {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return Number.NaN;
  return Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  );
}

const DAY_MS = 86_400_000;

export function daysPastDue(
  invoice: Pick<AgingInvoice, "dueDate" | "issuedAt">,
  asOf: string | Date = new Date(),
): number {
  const due = startOfDayUtc(invoice.dueDate ?? invoice.issuedAt);
  const now = startOfDayUtc(asOf);
  if (Number.isNaN(due) || Number.isNaN(now)) return 0;
  return Math.max(0, Math.round((now - due) / DAY_MS));
}

export function bucketFor(days: number): AgingBucket {
  if (days <= 0) return "current";
  if (days <= 30) return "d1_30";
  if (days <= 60) return "d31_60";
  if (days <= 90) return "d61_90";
  return "d90_plus";
}

function emptyBuckets(): Record<AgingBucket, number> {
  return { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
}

export function buildAgingReport(
  invoices: readonly AgingInvoice[],
  asOf: string | Date = new Date(),
): AgingReport {
  const buckets = emptyBuckets();
  const byCustomer = new Map<string, AgingCustomer>();
  const aged: AgedInvoice[] = [];
  let totalMinor = 0;

  for (const invoice of invoices) {
    const balanceMinor = Math.round(Number(invoice.balanceMinor) || 0);
    if (balanceMinor <= 0) continue;

    const days = daysPastDue(invoice, asOf);
    const bucket = bucketFor(days);
    buckets[bucket] += balanceMinor;
    totalMinor += balanceMinor;
    aged.push({ ...invoice, balanceMinor, daysPastDue: days, bucket });

    // A customer is one payer, so a phone identifies them better than a name
    // that may be typed differently on every invoice.
    const key = invoice.phone?.trim() || invoice.customerName?.trim() || "unknown";
    const existing = byCustomer.get(key);
    if (existing) {
      existing.totalMinor += balanceMinor;
      existing.buckets[bucket] += balanceMinor;
      existing.oldestDaysPastDue = Math.max(existing.oldestDaysPastDue, days);
      existing.invoiceCount += 1;
    } else {
      const customerBuckets = emptyBuckets();
      customerBuckets[bucket] = balanceMinor;
      byCustomer.set(key, {
        customerName: invoice.customerName?.trim() || "Unknown customer",
        phone: invoice.phone?.trim() || null,
        totalMinor: balanceMinor,
        buckets: customerBuckets,
        oldestDaysPastDue: days,
        invoiceCount: 1,
      });
    }
  }

  // Worst debt first: that is the order a credit controller works in.
  const customers = [...byCustomer.values()].sort(
    (a, b) =>
      b.oldestDaysPastDue - a.oldestDaysPastDue || b.totalMinor - a.totalMinor,
  );
  aged.sort((a, b) => b.daysPastDue - a.daysPastDue);

  return {
    asOf: new Date(asOf).toISOString(),
    totalMinor,
    openCount: aged.length,
    buckets,
    overdueMinor: totalMinor - buckets.current,
    customers,
    invoices: aged,
  };
}
