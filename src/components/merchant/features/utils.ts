import type {
  FxLock,
  InstallmentPlan,
  Invoice,
  InvoiceTimelineEvent,
  PaymentMethod,
} from "./types";

export const TILL_NUMBER = "247365";
export const MERCHANT_NAME = "Sade's Atelier";

const LOCAL_PAYMENT_METHODS: PaymentMethod[] = [
  { id: "mpesa", name: "M-Pesa", icon: "📱", region: ["KE", "TZ", "UG"] },
  {
    id: "airtel_money",
    name: "Airtel Money",
    icon: "📲",
    region: ["KE", "UG", "NG"],
  },
  {
    id: "bank_transfer",
    name: "Bank Transfer",
    icon: "🏦",
    region: ["GB", "US", "EU", "NG", "KE"],
  },
  { id: "pix", name: "PIX", icon: "⚡", region: ["BR"] },
  { id: "upi", name: "UPI", icon: "🇮🇳", region: ["IN"] },
  {
    id: "card",
    name: "Card (Visa/MC)",
    icon: "💳",
    region: ["US", "GB", "EU", "NG", "KE", "BR", "IN"],
  },
  { id: "ussd", name: "USSD", icon: "📞", region: ["NG"] },
  { id: "coop", name: "Coop Bank Kenya", icon: "🌍", region: ["US", "GB", "EU"] },
  { id: "paypal", name: "PayPal", icon: "🅿️", region: ["US", "GB", "EU"] },
];

export const FX_RATES: Record<string, Record<string, number>> = {
  USD: { EUR: 0.92, GBP: 0.79, KES: 129.5, NGN: 1580, BRL: 5.12, INR: 83.2 },
  EUR: { USD: 1.084, GBP: 0.858, KES: 140.8, NGN: 1718 },
  GBP: { USD: 1.264, EUR: 1.165, KES: 164.1, NGN: 2002 },
  KES: { USD: 0.0077, EUR: 0.0071, GBP: 0.0061 },
  NGN: { USD: 0.00063, EUR: 0.00058, GBP: 0.0005 },
};

export function getPaymentMethodsForRegion(region: string): PaymentMethod[] {
  return LOCAL_PAYMENT_METHODS.filter((m) => m.region.includes(region));
}

export function detectRegionFromCurrency(currency: string): string {
  const map: Record<string, string> = {
    USD: "US",
    EUR: "EU",
    GBP: "GB",
    KES: "KE",
    NGN: "NG",
    BRL: "BR",
    INR: "IN",
  };
  return map[currency] ?? "US";
}

export function lockFxRate(from: string, to: string, hours = 48): FxLock {
  const rate =
    (FX_RATES[from]?.[to] ?? FX_RATES[to]?.[from])
      ? 1 / (FX_RATES[to]?.[from] ?? 1)
      : 1;
  const now = new Date();
  const expires = new Date(now);
  expires.setHours(expires.getHours() + hours);
  return {
    rate,
    from,
    to,
    lockedAt: now.toISOString(),
    expiresAt: expires.toISOString(),
  };
}

export function fxLockTimeRemaining(lock: FxLock): string {
  const now = new Date().getTime();
  const exp = new Date(lock.expiresAt).getTime();
  const diff = exp - now;
  if (diff <= 0) return "Expired";
  const hours = Math.floor(diff / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
}

export function whatsAppLink(invoice: Invoice, payUrl: string): string {
  const text = encodeURIComponent(
    `Hi ${invoice.customer},

Your invoice ${invoice.id} for ${invoice.currency} ${invoice.amount.toLocaleString()} is ready.

Pay here: ${payUrl}

— Sent via PesaSwap`,
  );
  const phone = invoice.customerPhone
    ? invoice.customerPhone.replace(/[^0-9]/g, "")
    : "";
  return `https://wa.me/${phone}?text=${text}`;
}

export function smsLink(invoice: Invoice, payUrl: string): string {
  const text = encodeURIComponent(
    `Invoice ${invoice.id}: ${invoice.currency} ${invoice.amount.toLocaleString()}. Pay: ${payUrl}`,
  );
  const phone = invoice.customerPhone ?? "";
  return `sms:${phone}?body=${text}`;
}

export function shiftTimestamp(base: string | Date, minutes: number) {
  const next = new Date(base);
  next.setMinutes(next.getMinutes() + minutes);
  return next.toISOString();
}

export function nextRecurringDate(frequency: string, base = new Date()) {
  const next = new Date(base);
  const dayMap: Record<string, number> = {
    Weekly: 7,
    "Bi-weekly": 14,
    Monthly: 30,
  };
  next.setDate(next.getDate() + (dayMap[frequency] ?? 30));
  return next.toISOString();
}

export function formatTimelineDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function timeAgo(value: string) {
  const diffMs = Date.now() - new Date(value).getTime();
  const diffMinutes = Math.max(1, Math.floor(diffMs / 60000));
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffMinutes < 1440) return `${Math.floor(diffMinutes / 60)}h ago`;
  return `${Math.floor(diffMinutes / 1440)}d ago`;
}

export function appendTimelineEvent(
  timeline: InvoiceTimelineEvent[] | undefined,
  event: InvoiceTimelineEvent,
) {
  const events = timeline ?? [];
  const existing = events.find((item) => item.label === event.label);
  const next = existing
    ? events.map((item) => (item.label === event.label ? event : item))
    : [...events, event];

  return [...next].sort(
    (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime(),
  );
}

export function timelineFor(invoice: Invoice) {
  let timeline = invoice.timeline ?? [];

  if (!timeline.some((event) => event.label === "Created")) {
    const createdAt = invoice.paidAt
      ? shiftTimestamp(invoice.paidAt, -60 * 24 * 2)
      : shiftTimestamp(
          new Date(),
          invoice.status === "Overdue" ? -60 * 24 * 4 : -90,
        );
    timeline = appendTimelineEvent(timeline, {
      label: "Created",
      at: createdAt,
    });
  }

  if (!timeline.some((event) => event.label === "QR shared")) {
    const createdAt =
      timeline.find((event) => event.label === "Created")?.at ??
      new Date().toISOString();
    timeline = appendTimelineEvent(timeline, {
      label: "QR shared",
      at: shiftTimestamp(createdAt, 12),
    });
  }

  if (invoice.lastReminder) {
    timeline = appendTimelineEvent(timeline, {
      label: "Reminder sent",
      at: invoice.lastReminder,
    });
  }

  if (invoice.status === "Paid") {
    const paymentAt =
      invoice.paidAt ??
      shiftTimestamp(
        timeline.find((event) => event.label === "QR shared")?.at ?? new Date(),
        95,
      );
    timeline = appendTimelineEvent(timeline, {
      label: "Payment received",
      at: paymentAt,
    });
    timeline = appendTimelineEvent(timeline, {
      label: `Settled via ${invoice.paidVia ?? "Coop Bank Kenya"}`,
      at: shiftTimestamp(paymentAt, 18),
    });
  }

  return timeline;
}

export function totalPaid(invoice: Invoice): number {
  return (invoice.payments ?? []).reduce((sum, p) => sum + p.amount, 0);
}

export function amountRemaining(invoice: Invoice): number {
  return Math.max(0, invoice.amount - totalPaid(invoice));
}

export function generateInstallments(
  totalAmount: number,
  count: number,
  frequency: "Weekly" | "Bi-weekly" | "Monthly",
  startDate = new Date(),
): InstallmentPlan["installments"] {
  const perInstallment = Math.round((totalAmount / count) * 100) / 100;
  const dayMap: Record<string, number> = {
    Weekly: 7,
    "Bi-weekly": 14,
    Monthly: 30,
  };
  const days = dayMap[frequency];

  return Array.from({ length: count }, (_, i) => {
    const due = new Date(startDate);
    due.setDate(due.getDate() + days * (i + 1));
    const isFirst = i === 0;
    return {
      number: i + 1,
      amount:
        i === count - 1
          ? Math.round((totalAmount - perInstallment * (count - 1)) * 100) / 100
          : perInstallment,
      dueDate: due.toISOString(),
      status: isFirst ? ("Due" as const) : ("Upcoming" as const),
    };
  });
}

export function payloadFor(inv: Invoice) {
  return JSON.stringify({
    type: "fx-engine/invoice",
    id: inv.id,
    amount: inv.amount,
    currency: inv.currency,
    customer: inv.customer,
    note: inv.note,
  });
}

export function payLink(inv: Invoice) {
  if (typeof window === "undefined") return "";
  const u = new URL(window.location.origin + "/merchant");
  u.searchParams.set("pay", inv.id);
  return u.toString();
}
