export type CustomerHealthInvoice = {
  amount: number;
  status: "Paid" | "Pending" | "Overdue" | "Partial" | "Void";
  date?: string;
  paidAt?: string;
  timeline?: Array<{ label: string; at: string }>;
  payments?: Array<{ amount: number; paidAt: string }>;
};

export type CustomerHealthBand = "Healthy" | "Watch" | "At risk";

export type CustomerHealthScore = {
  score: number;
  band: CustomerHealthBand;
  paymentReliability: number;
  recency: number;
  engagement: number;
  exposure: number;
  paidInvoices: number;
  totalInvoices: number;
  outstanding: number;
  averageDaysToPay: number;
};

function daysBetween(start: string, end: string): number {
  const diff = new Date(end).getTime() - new Date(start).getTime();
  return Number.isFinite(diff) ? Math.max(0, Math.round(diff / 86400000)) : 0;
}

function createdAt(invoice: CustomerHealthInvoice): string | null {
  return invoice.timeline?.find((event) => event.label === "Created")?.at ?? null;
}

export function scoreCustomerHealth(
  invoices: CustomerHealthInvoice[],
  now = new Date(),
): CustomerHealthScore {
  const active = invoices.filter((invoice) => invoice.status !== "Void");
  const paid = active.filter((invoice) => invoice.status === "Paid");
  const total = active.reduce((sum, invoice) => sum + Math.max(0, invoice.amount), 0);
  const paidTotal = paid.reduce((sum, invoice) => sum + Math.max(0, invoice.amount), 0);
  const outstanding = Math.max(0, total - paidTotal);
  const paidDays = paid
    .map((invoice) => {
      const created = createdAt(invoice);
      return created && invoice.paidAt ? daysBetween(created, invoice.paidAt) : null;
    })
    .filter((days): days is number => days !== null);
  const averageDaysToPay = paidDays.length
    ? Math.round(paidDays.reduce((sum, days) => sum + days, 0) / paidDays.length)
    : 0;
  const paymentReliability = active.length
    ? Math.round((paid.length / active.length) * 40)
    : 0;
  const latestActivity = active
    .map((invoice) => invoice.paidAt ?? createdAt(invoice))
    .filter((date): date is string => Boolean(date))
    .sort()
    .at(-1);
  const daysSinceActivity = latestActivity
    ? Math.max(0, Math.round((now.getTime() - new Date(latestActivity).getTime()) / 86400000))
    : 365;
  const recency = Math.max(0, 25 - Math.min(25, daysSinceActivity));
  const engagement = Math.min(20, active.length * 5);
  const exposure = total > 0 ? Math.round((1 - outstanding / total) * 15) : 0;
  const score = Math.max(0, Math.min(100, paymentReliability + recency + engagement + exposure));
  const band: CustomerHealthBand = score >= 70 ? "Healthy" : score >= 40 ? "Watch" : "At risk";

  return {
    score,
    band,
    paymentReliability,
    recency,
    engagement,
    exposure,
    paidInvoices: paid.length,
    totalInvoices: active.length,
    outstanding,
    averageDaysToPay,
  };
}
