import { useEffect, useMemo, useState } from "react";
import { Loader2, Printer, Receipt, RotateCcw, Search, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

import { authFetch } from "@/lib/auth";
import { PrintReceiptSheet } from "@/components/staff/PrintReceiptSheet";
import type { PrintableReceipt } from "@/lib/receipt-print";

type TableRow = { id: string; label: string; section: string | null };

type PaymentRow = {
  id: string;
  orderId: string | null;
  orderStatus: string | null;
  amount: number;
  tip: number;
  refunded: number;
  currency: string;
  status: string;
  customerPhone: string | null;
  createdAt: string;
};

const REFUND_REASONS = [
  { value: "customer_request", label: "Customer request" },
  { value: "item_quality", label: "Item quality" },
  { value: "overcharge", label: "Overcharge" },
  { value: "duplicate", label: "Duplicate charge" },
  { value: "other", label: "Other" },
] as const;

const SETTLED = new Set(["succeeded", "paid", "captured", "partially_refunded"]);

/**
 * B3.1 + B3.5 — act on a bill from the floor.
 *
 * A server searches the table they are standing at, sees that table's payments,
 * resends the bill or receipt to the guest, and — if they are a manager —
 * refunds.
 *
 * On the refund boundary: refunds are manager+ and `payments:write`, enforced by
 * POST /api/refunds. This component does NOT hide the control from a server, and
 * it does not try to route around the check. It renders a real, disabled button
 * with a visible "needs a manager" explanation, because a server who cannot see
 * the action cannot ask for it, and a server who taps a button that silently
 * 403s learns nothing. The server's own read is redacted and table-scoped.
 */
export function TableFloorActionsCard() {
  const [tables, setTables] = useState<TableRow[] | null>(null);
  const [query, setQuery] = useState("");
  const [activeTable, setActiveTable] = useState<TableRow | null>(null);
  const [payments, setPayments] = useState<PaymentRow[] | null>(null);
  const [canRefund, setCanRefund] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [refundTarget, setRefundTarget] = useState<string | null>(null);
  const [refundReason, setRefundReason] =
    useState<(typeof REFUND_REASONS)[number]["value"]>("customer_request");
  const [unavailable, setUnavailable] = useState(false);
  const [printReceipt, setPrintReceipt] = useState<PrintableReceipt | null>(null);

  useEffect(() => {
    let cancelled = false;
    authFetch("/api/tables")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { tables?: TableRow[] }) => {
        if (!cancelled) setTables(d.tables ?? []);
      })
      .catch(() => {
        if (!cancelled) setUnavailable(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const all = tables ?? [];
    if (!needle) return all.slice(0, 8);
    return all
      .filter(
        (t) =>
          t.label.toLowerCase().includes(needle) ||
          (t.section ?? "").toLowerCase().includes(needle),
      )
      .slice(0, 8);
  }, [tables, query]);

  async function openTable(table: TableRow) {
    setActiveTable(table);
    setPayments(null);
    setRefundTarget(null);
    setLoading(true);
    try {
      const res = await authFetch(
        `/api/tables/${encodeURIComponent(table.id)}/payments`,
      );
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as {
        payments?: PaymentRow[];
        canRefund?: boolean;
      };
      setPayments(data.payments ?? []);
      setCanRefund(Boolean(data.canRefund));
    } catch {
      setPayments([]);
      toast.error("Couldn't load this table's payments.");
    } finally {
      setLoading(false);
    }
  }

  async function resend(payment: PaymentRow) {
    if (!payment.orderId) return;
    setBusyId(payment.id);
    try {
      const res = await authFetch(
        `/api/orders/${encodeURIComponent(payment.orderId)}/receipt`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      const data = (await res.json().catch(() => ({}))) as {
        kind?: string;
        error?: string;
      };
      if (!res.ok) {
        toast.error(data.error ?? "Couldn't send that to the guest.");
        return;
      }
      toast.success(
        data.kind === "receipt" ? "Receipt sent to the guest" : "Bill sent to the guest",
      );
    } catch {
      toast.error("Couldn't send that to the guest.");
    } finally {
      setBusyId(null);
    }
  }

  // A1.4 — the guest wants it on paper. Same endpoint, same permission, same
  // totals as the digital resend above; only the delivery differs.
  async function print(payment: PaymentRow) {
    if (!payment.orderId) return;
    setBusyId(payment.id);
    try {
      const res = await authFetch(
        `/api/orders/${encodeURIComponent(payment.orderId)}/receipt`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channel: "print" }),
        },
      );
      const data = (await res.json().catch(() => ({}))) as {
        receipt?: PrintableReceipt;
        error?: string;
      };
      if (!res.ok || !data.receipt) {
        toast.error(data.error ?? "Couldn't build a printable receipt.");
        return;
      }
      setPrintReceipt(data.receipt);
    } catch {
      toast.error("Couldn't build a printable receipt.");
    } finally {
      setBusyId(null);
    }
  }

  async function refund(payment: PaymentRow) {
    setBusyId(payment.id);
    try {
      const res = await authFetch("/api/refunds", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // One refund per attempt, even if the floor taps twice on a bad signal.
          "Idempotency-Key": `floor-${payment.id}-${refundReason}`,
        },
        body: JSON.stringify({ payment_id: payment.id, reason: refundReason }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: { message?: string } | string;
      };
      if (!res.ok) {
        const message =
          typeof data.error === "string"
            ? data.error
            : (data.error?.message ?? "Refund was declined.");
        toast.error(
          res.status === 403 ? "A manager has to approve this refund." : message,
        );
        return;
      }
      toast.success("Refund submitted");
      setRefundTarget(null);
      if (activeTable) await openTable(activeTable);
    } catch {
      toast.error("Refund failed. Please try again.");
    } finally {
      setBusyId(null);
    }
  }

  if (unavailable) return null;

  return (
    <section className="rounded-2xl border border-border bg-card p-6">
      <div className="flex items-center gap-2">
        <Search className="size-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Find a table</h2>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Open a table to resend the bill or receipt, and to refund.
      </p>

      <label htmlFor="floor-table-search" className="sr-only">
        Search tables by name or section
      </label>
      <input
        id="floor-table-search"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Table 12, Terrace…"
        className="mt-4 min-h-[44px] w-full rounded-xl border border-border bg-background px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-emerald-500"
      />

      <ul className="mt-3 flex flex-wrap gap-2">
        {matches.map((t) => (
          <li key={t.id}>
            <button
              type="button"
              onClick={() => void openTable(t)}
              aria-pressed={activeTable?.id === t.id}
              className={`min-h-[44px] rounded-xl border px-4 py-2 text-sm font-medium ${
                activeTable?.id === t.id
                  ? "border-emerald-500 bg-emerald-50 text-emerald-900"
                  : "border-border bg-background"
              }`}
            >
              {t.label}
              {t.section ? (
                <span className="ml-2 text-xs text-muted-foreground">
                  {t.section}
                </span>
              ) : null}
            </button>
          </li>
        ))}
        {tables && matches.length === 0 ? (
          <li className="text-sm text-muted-foreground">No table matches that.</li>
        ) : null}
      </ul>

      {activeTable ? (
        <div className="mt-5" aria-live="polite">
          <h3 className="text-sm font-semibold">
            {activeTable.label} · payments
          </h3>
          {loading ? (
            <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading payments…
            </p>
          ) : payments && payments.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">
              No payments on this table yet.
            </p>
          ) : (
            <ul className="mt-3 space-y-3">
              {(payments ?? []).map((p) => {
                const refundable = SETTLED.has(p.status) && p.refunded < p.amount;
                return (
                  <li
                    key={p.id}
                    className="rounded-xl border border-border bg-background p-3"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-mono text-base font-bold">
                        {p.currency} {p.amount.toLocaleString()}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {p.status}
                        {p.tip > 0
                          ? ` · tip ${p.currency} ${p.tip.toLocaleString()}`
                          : ""}
                        {p.refunded > 0
                          ? ` · refunded ${p.currency} ${p.refunded.toLocaleString()}`
                          : ""}
                        {p.customerPhone ? ` · ${p.customerPhone}` : ""}
                      </span>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void resend(p)}
                        disabled={!p.orderId || busyId === p.id}
                        className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm font-medium disabled:opacity-50"
                      >
                        <Receipt className="size-4" />
                        Resend to guest
                      </button>

                      <button
                        type="button"
                        onClick={() => void print(p)}
                        disabled={!p.orderId || busyId === p.id}
                        className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm font-medium disabled:opacity-50"
                      >
                        <Printer className="size-4" aria-hidden="true" />
                        Print receipt
                      </button>

                      {canRefund ? (
                        <button
                          type="button"
                          onClick={() =>
                            setRefundTarget(refundTarget === p.id ? null : p.id)
                          }
                          disabled={!refundable || busyId === p.id}
                          aria-expanded={refundTarget === p.id}
                          className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm font-medium disabled:opacity-50"
                        >
                          <RotateCcw className="size-4" />
                          Refund
                        </button>
                      ) : (
                        <>
                          {/* Not hidden, not a privilege escalation: a real,
                              disabled control with the reason stated. */}
                          <button
                            type="button"
                            disabled
                            aria-describedby={`refund-gate-${p.id}`}
                            className="inline-flex min-h-[44px] cursor-not-allowed items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm font-medium opacity-60"
                          >
                            <RotateCcw className="size-4" />
                            Refund
                          </button>
                          <p
                            id={`refund-gate-${p.id}`}
                            className="flex items-center gap-1.5 self-center text-xs text-amber-700"
                          >
                            <ShieldAlert className="size-3.5" />
                            Needs a manager
                          </p>
                        </>
                      )}
                    </div>

                    {canRefund && refundTarget === p.id ? (
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <label
                          htmlFor={`refund-reason-${p.id}`}
                          className="text-xs text-muted-foreground"
                        >
                          Reason
                        </label>
                        <select
                          id={`refund-reason-${p.id}`}
                          value={refundReason}
                          onChange={(e) =>
                            setRefundReason(
                              e.target
                                .value as (typeof REFUND_REASONS)[number]["value"],
                            )
                          }
                          className="min-h-[44px] rounded-xl border border-border bg-background px-3 py-2 text-sm"
                        >
                          {REFUND_REASONS.map((r) => (
                            <option key={r.value} value={r.value}>
                              {r.label}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => void refund(p)}
                          disabled={busyId === p.id}
                          className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                        >
                          {busyId === p.id ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : null}
                          Refund {p.currency}{" "}
                          {(p.amount - p.refunded).toLocaleString()}
                        </button>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}

      {printReceipt ? (
        <PrintReceiptSheet
          receipt={printReceipt}
          onClose={() => setPrintReceipt(null)}
        />
      ) : null}
    </section>
  );
}
