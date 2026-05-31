import { useEffect, useState } from "react";

import type { Invoice, PartialPayment } from "./types";
import { appendTimelineEvent, timelineFor } from "./utils";

const STORAGE_KEY = "fxengine.merchant.invoices";
const seed: Invoice[] = [
  {
    id: "INV-10241",
    customer: "Lumio Studios",
    amount: 1240,
    currency: "USD",
    status: "Paid",
    date: "Oct 24",
    paidVia: "Wise",
    paidAt: "2026-05-26T12:20:00.000Z",
    timeline: [
      { label: "Created", at: "2026-05-24T08:30:00.000Z" },
      { label: "QR shared", at: "2026-05-24T08:42:00.000Z" },
      { label: "Payment received", at: "2026-05-26T12:20:00.000Z" },
      { label: "Settled via Wise", at: "2026-05-26T12:38:00.000Z" },
    ],
  },
  {
    id: "INV-10240",
    customer: "Northwind GmbH",
    amount: 4820,
    currency: "EUR",
    status: "Pending",
    date: "Oct 23",
    recurring: { frequency: "Monthly", nextDate: "2026-06-23T09:00:00.000Z" },
    timeline: [
      { label: "Created", at: "2026-05-23T09:00:00.000Z" },
      { label: "QR shared", at: "2026-05-23T09:14:00.000Z" },
    ],
  },
  {
    id: "INV-10238",
    customer: "Acme Trading",
    amount: 920,
    currency: "GBP",
    status: "Overdue",
    date: "Oct 19",
    lastReminder: "2026-05-29T10:45:00.000Z",
    timeline: [
      { label: "Created", at: "2026-05-19T11:15:00.000Z" },
      { label: "QR shared", at: "2026-05-19T11:28:00.000Z" },
      { label: "Reminder sent", at: "2026-05-29T10:45:00.000Z" },
    ],
  },
  {
    id: "INV-10235",
    customer: "Brava Holdings",
    amount: 3100,
    currency: "USD",
    status: "Paid",
    date: "Oct 17",
    paidVia: "Currencycloud",
  },
  {
    id: "INV-10233",
    customer: "Safari Exports",
    amount: 5000,
    currency: "KES",
    status: "Partial",
    date: "Oct 15",
    payments: [
      {
        id: "PAY-a1",
        amount: 2000,
        paidAt: "2026-05-20T14:00:00.000Z",
        paidVia: "M-Pesa",
      },
      {
        id: "PAY-a2",
        amount: 1000,
        paidAt: "2026-05-27T09:30:00.000Z",
        paidVia: "Bank Transfer",
      },
    ],
    installmentPlan: {
      count: 3,
      frequency: "Monthly",
      installments: [
        {
          number: 1,
          amount: 2000,
          dueDate: "2026-05-20T00:00:00.000Z",
          status: "Paid",
          paidAt: "2026-05-20T14:00:00.000Z",
        },
        {
          number: 2,
          amount: 2000,
          dueDate: "2026-06-20T00:00:00.000Z",
          status: "Due",
        },
        {
          number: 3,
          amount: 1000,
          dueDate: "2026-07-20T00:00:00.000Z",
          status: "Upcoming",
        },
      ],
    },
    timeline: [
      { label: "Created", at: "2026-05-15T08:00:00.000Z" },
      { label: "QR shared", at: "2026-05-15T08:12:00.000Z" },
      { label: "Partial payment · KES 2,000", at: "2026-05-20T14:00:00.000Z" },
      { label: "Partial payment · KES 1,000", at: "2026-05-27T09:30:00.000Z" },
    ],
  },
];

export function useInvoices() {
  const [invoices, setInvoices] = useState<Invoice[]>(() => {
    if (typeof window === "undefined") return seed;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as Invoice[]) : seed;
    } catch {
      return seed;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(invoices));
    } catch {
      /* ignore */
    }
  }, [invoices]);

  return {
    invoices,
    add: (inv: Invoice) => setInvoices((prev) => [inv, ...prev]),
    markPaid: (id: string, via = "FX Engine") =>
      setInvoices((prev) =>
        prev.map((i) =>
          i.id === id
            ? (() => {
                const paidAt = new Date().toISOString();
                const baseTimeline = timelineFor(i);
                return {
                  ...i,
                  status: "Paid" as const,
                  paidAt,
                  paidVia: via,
                  timeline: appendTimelineEvent(
                    appendTimelineEvent(baseTimeline, {
                      label: "Payment received",
                      at: paidAt,
                    }),
                    {
                      label: `Settled via ${via}`,
                      at: new Date(
                        new Date(paidAt).getTime() + 18 * 60000,
                      ).toISOString(),
                    },
                  ),
                };
              })()
            : i,
        ),
      ),
    update: (id: string, patch: Partial<Invoice>) =>
      setInvoices((prev) =>
        prev.map((i) => (i.id === id ? { ...i, ...patch } : i)),
      ),
    recordPayment: (id: string, paymentAmount: number, via = "FX Engine") =>
      setInvoices((prev) =>
        prev.map((i) => {
          if (i.id !== id) return i;
          const payment: PartialPayment = {
            id: `PAY-${Date.now().toString(36)}`,
            amount: paymentAmount,
            paidAt: new Date().toISOString(),
            paidVia: via,
          };
          const updatedPayments = [...(i.payments ?? []), payment];
          const paid = updatedPayments.reduce((s, p) => s + p.amount, 0);
          const fullyPaid = paid >= i.amount;

          let updatedPlan = i.installmentPlan;
          if (updatedPlan) {
            const nextDue = updatedPlan.installments.findIndex(
              (inst) => inst.status === "Due" || inst.status === "Overdue",
            );
            if (nextDue >= 0) {
              updatedPlan = {
                ...updatedPlan,
                installments: updatedPlan.installments.map((inst, idx) =>
                  idx === nextDue
                    ? {
                        ...inst,
                        status: "Paid" as const,
                        paidAt: payment.paidAt,
                      }
                    : idx === nextDue + 1 && inst.status === "Upcoming"
                      ? { ...inst, status: "Due" as const }
                      : inst,
                ),
              };
            }
          }

          return {
            ...i,
            payments: updatedPayments,
            installmentPlan: updatedPlan,
            status: fullyPaid ? ("Paid" as const) : ("Partial" as const),
            paidAt: fullyPaid ? payment.paidAt : i.paidAt,
            paidVia: fullyPaid ? via : i.paidVia,
            timeline: appendTimelineEvent(timelineFor(i), {
              label: fullyPaid
                ? "Payment received (final)"
                : `Partial payment · ${i.currency} ${paymentAmount.toLocaleString()}`,
              at: payment.paidAt,
            }),
          };
        }),
      ),
    reset: () => setInvoices(seed),
  };
}
