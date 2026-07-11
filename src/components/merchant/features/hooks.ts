import { useCallback, useEffect, useState } from "react";

import { authFetch, getToken } from "@/lib/auth";
import type { Invoice, PartialPayment } from "./types";
import { appendTimelineEvent, timelineFor } from "./utils";

// Map a server invoice row (/api/invoices, same source as the dashboard) to the
// app's Invoice shape, so the mobile app shows EXACTLY the logged-in venue's data.
type ServerInvoice = {
  id?: string | number;
  number?: string;
  customer_name?: string;
  phone?: string | null;
  amount?: number;
  amount_paid?: number;
  currency?: string;
  status?: string;
  display_status?: string;
  channel?: string | null;
  created_at?: string;
  paid_at?: string | null;
  paid_ref?: string | null;
};

function mapStatus(s: string): Invoice["status"] {
  const x = String(s ?? "").toLowerCase();
  if (x === "paid" || x === "void") return "Paid";
  if (x === "partial") return "Partial";
  if (x === "overdue") return "Overdue";
  return "Pending";
}

function fmtDate(iso?: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

function mapServerInvoice(r: ServerInvoice): Invoice {
  const amount = Number(r.amount) || 0;
  const paid = Number(r.amount_paid) || 0;
  const status = mapStatus(r.display_status ?? r.status ?? "");
  return {
    id: String(r.number ?? r.id ?? ""),
    serverId: r.id != null ? String(r.id) : undefined,
    customer: String(r.customer_name ?? "Customer"),
    amount,
    currency: String(r.currency ?? "KES"),
    status,
    date: fmtDate(r.created_at),
    paidVia: r.channel ? String(r.channel) : undefined,
    paidAt: r.paid_at ?? undefined,
    paidRef: r.paid_ref ?? undefined,
    customerPhone: r.phone ?? undefined,
    payments:
      paid > 0 && status !== "Paid"
        ? [
            {
              id: `PAY-${r.id ?? r.number}`,
              amount: paid,
              paidAt: r.paid_at ?? new Date().toISOString(),
              paidVia: r.channel ?? "PesaSwap",
            },
          ]
        : undefined,
  };
}

const STORAGE_KEY = "fxengine.merchant.invoices";

// The venue a token is bound to, if it's a REAL merchant login (v_…) — not a demo
// session (venue "main") or a venue-less principal. Used to decide whether to load
// live invoices or keep the showcase seed.
function realVenueFromToken(): string | null {
  const token = getToken();
  if (!token) return null;
  try {
    const b64 = token.split(".")[1]?.replace(/-/g, "+").replace(/_/g, "/");
    if (!b64) return null;
    const padded = b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), "=");
    const venue = (JSON.parse(atob(padded)) as { venue?: string }).venue;
    return venue && venue !== "main" ? venue : null;
  } catch {
    return null;
  }
}
const seed: Invoice[] = [
  {
    id: "INV-10241",
    customer: "Lumio Studios",
    amount: 1240,
    currency: "USD",
    status: "Paid",
    date: "Oct 24",
    paidVia: "Coop Bank Kenya",
    paidAt: "2026-05-26T12:20:00.000Z",
    timeline: [
      { label: "Created", at: "2026-05-24T08:30:00.000Z" },
      { label: "QR shared", at: "2026-05-24T08:42:00.000Z" },
      { label: "Payment received", at: "2026-05-26T12:20:00.000Z" },
      { label: "Settled via Coop Bank Kenya", at: "2026-05-26T12:38:00.000Z" },
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
    paidVia: "Coop Bank Kenya",
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
  // A real signed-in venue, OR a launch handoff (#token=), loads live invoices
  // from the server (below). Start empty in those cases so the demo seed never
  // flashes for a logged-in merchant; demo/anonymous sessions keep the seed.
  const launching =
    typeof window !== "undefined" &&
    (Boolean(realVenueFromToken()) || window.location.hash.includes("token="));
  const [invoices, setInvoices] = useState<Invoice[]>(() => {
    if (typeof window === "undefined") return seed;
    if (launching) return [];
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as Invoice[]) : seed;
    } catch {
      return seed;
    }
  });
  const [authed, setAuthed] = useState<boolean>(launching);

  // Pull the venue's live invoices from the server (the SAME source the dashboard
  // uses) so both surfaces always agree. No-op for demo/anonymous sessions.
  const refetch = useCallback(async () => {
    if (!realVenueFromToken()) return;
    try {
      const res = await authFetch("/api/invoices");
      if (!res.ok) return;
      const data = (await res.json()) as { invoices?: ServerInvoice[] };
      if (Array.isArray(data.invoices)) {
        setInvoices(data.invoices.map(mapServerInvoice));
      }
    } catch {
      /* keep whatever is on screen if the fetch fails */
    }
  }, []);

  // Load real invoices on mount + whenever auth/venue changes — including the
  // launch handoff, which sets the token AFTER this hook mounts.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sync = () => {
      setAuthed(Boolean(realVenueFromToken()));
      void refetch();
    };
    sync();
    window.addEventListener("pesaswap:auth-changed", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("pesaswap:auth-changed", sync);
      window.removeEventListener("storage", sync);
    };
  }, [refetch]);

  // Persist ONLY anonymous/demo edits — never a real tenant's server data into the
  // shared demo key (which would leak across accounts / into the anonymous demo).
  useEffect(() => {
    if (authed) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(invoices));
    } catch {
      /* ignore */
    }
  }, [invoices, authed]);

  return {
    invoices,
    refetch,
    add: async (inv: Invoice) => {
      // A real venue persists to the server (same create the dashboard uses), so
      // the new invoice shows up on BOTH surfaces. Demo sessions stay local.
      if (realVenueFromToken()) {
        try {
          await authFetch("/api/invoices", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              customerName: inv.customer,
              amount: inv.amount,
              phone: inv.customerPhone,
              notes: inv.note,
            }),
          });
          await refetch();
        } catch {
          /* ignore — the list will re-sync on next load */
        }
        return;
      }
      setInvoices((prev) => [inv, ...prev]);
    },
    markPaid: async (id: string, via = "PesaSwap") => {
      const target = invoices.find((i) => i.id === id);
      if (realVenueFromToken() && target?.serverId) {
        try {
          await authFetch(
            `/api/invoices/${encodeURIComponent(target.serverId)}/paid`,
            { method: "POST" },
          );
          await refetch();
        } catch {
          /* ignore */
        }
        return;
      }
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
      );
    },
    update: (id: string, patch: Partial<Invoice>) =>
      setInvoices((prev) =>
        prev.map((i) => (i.id === id ? { ...i, ...patch } : i)),
      ),
    recordPayment: async (id: string, paymentAmount: number, via = "PesaSwap") => {
      const target = invoices.find((i) => i.id === id);
      if (realVenueFromToken() && target?.serverId) {
        try {
          await authFetch(
            `/api/invoices/${encodeURIComponent(target.serverId)}/pay`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ amount: paymentAmount }),
            },
          );
          await refetch();
        } catch {
          /* ignore */
        }
        return;
      }
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
      );
    },
    reset: () => setInvoices(seed),
  };
}
