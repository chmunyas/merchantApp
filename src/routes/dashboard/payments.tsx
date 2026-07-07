import { createFileRoute } from "@tanstack/react-router";
import { format, isSameDay, subDays } from "date-fns";
import { Download, RotateCcw, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  ensureMerchantDemoData,
  flattenTransactions,
  loadMerchantSnapshot,
  saveMerchantTables,
  type MerchantPayment,
  type MerchantSnapshot,
} from "@/lib/merchant-dashboard";
import { getBNPLTransactions, type BNPLTransaction } from "@/lib/coop-bnpl";
import { pesaswapClient } from "@/lib/pesaswap-payments";
import { authFetch } from "@/lib/auth";

type LivePayment = {
  id: string;
  amount: number; // minor units
  currency: string;
  status: string;
  kind: string;
  reference: string | null;
  providerRef: string | null;
  tipAmount: number;
  initiator: string;
  customerPhone: string | null;
  customerName: string | null;
  flowType: string | null;
  errorMessage: string | null;
  createdAt: string;
};

export const Route = createFileRoute("/dashboard/payments")({
  component: DashboardPaymentsPage,
});

const currency = new Intl.NumberFormat("en-KE", {
  style: "currency",
  currency: "KES",
  maximumFractionDigits: 0,
});

const pageSize = 20;

type DateFilter = "today" | "yesterday" | "last7" | "last30" | "custom";
type StatusFilter = "all" | "succeeded" | "refunded" | "failed";

function generateDemoData() {
  return ensureMerchantDemoData();
}

function DashboardPaymentsPage() {
  const [snapshot, setSnapshot] = useState<MerchantSnapshot | null>(null);
  const [search, setSearch] = useState("");
  const [dateFilter, setDateFilter] = useState<DateFilter>("last7");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<MerchantPayment | null>(null);
  const [refundLoading, setRefundLoading] = useState(false);
  const [bnplTransactions, setBnplTransactions] = useState<BNPLTransaction[]>(
    [],
  );
  const [livePayments, setLivePayments] = useState<LivePayment[]>([]);
  const [liveLoading, setLiveLoading] = useState(true);

  // Real transactions from the durable ledger (every attempt, any status) — live
  // PesaSwap / M-Pesa sales that don't live in the localStorage demo snapshot.
  useEffect(() => {
    let active = true;
    async function loadLive() {
      try {
        const res = await authFetch("/api/payments/list?limit=100");
        if (res.ok && active) {
          const data = (await res.json()) as { payments: LivePayment[] };
          setLivePayments(data.payments ?? []);
        }
      } catch {
        /* ledger unavailable — the demo snapshot below still renders */
      } finally {
        if (active) setLiveLoading(false);
      }
    }
    void loadLive();
    const t = setInterval(loadLive, 15000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    generateDemoData();
    setSnapshot(loadMerchantSnapshot());
    setBnplTransactions(getBNPLTransactions());
  }, []);

  useEffect(() => {
    function syncBnplTransactions() {
      setBnplTransactions(getBNPLTransactions());
    }

    window.addEventListener("storage", syncBnplTransactions);
    window.addEventListener("focus", syncBnplTransactions);
    return () => {
      window.removeEventListener("storage", syncBnplTransactions);
      window.removeEventListener("focus", syncBnplTransactions);
    };
  }, []);

  const transactions = useMemo(() => {
    if (!snapshot) return [];
    return flattenTransactions(snapshot.tables);
  }, [snapshot]);

  const filtered = useMemo(() => {
    const now = new Date();
    const normalizedSearch = search.trim().toLowerCase();

    return transactions.filter((transaction) => {
      const createdAt = new Date(transaction.createdAt);
      const matchesSearch =
        !normalizedSearch ||
        transaction.phone.toLowerCase().includes(normalizedSearch) ||
        transaction.reference.toLowerCase().includes(normalizedSearch) ||
        transaction.customerName.toLowerCase().includes(normalizedSearch);

      let matchesDate = true;
      if (dateFilter === "today") matchesDate = isSameDay(createdAt, now);
      if (dateFilter === "yesterday")
        matchesDate = isSameDay(createdAt, subDays(now, 1));
      if (dateFilter === "last7") matchesDate = createdAt >= subDays(now, 7);
      if (dateFilter === "last30") matchesDate = createdAt >= subDays(now, 30);
      if (dateFilter === "custom" && customStart && customEnd) {
        matchesDate =
          createdAt >= new Date(customStart) &&
          createdAt <= new Date(`${customEnd}T23:59:59`);
      }

      const matchesStatus =
        statusFilter === "all" || transaction.status === statusFilter;
      return matchesSearch && matchesDate && matchesStatus;
    });
  }, [transactions, search, dateFilter, statusFilter, customStart, customEnd]);

  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const bnplSummary = useMemo(() => {
    const now = new Date();
    const totalVolume = bnplTransactions.reduce(
      (sum, transaction) => sum + transaction.amount,
      0,
    );
    const pendingSettlements = bnplTransactions.filter(
      (transaction) =>
        transaction.status === "approved" && !transaction.merchantPaidAt,
    );
    const settledThisMonth = bnplTransactions.filter((transaction) => {
      if (!transaction.merchantPaidAt) return false;
      const settledAt = new Date(transaction.merchantPaidAt);
      return (
        settledAt.getMonth() === now.getMonth() &&
        settledAt.getFullYear() === now.getFullYear()
      );
    });

    return {
      pendingAmount: pendingSettlements.reduce(
        (sum, transaction) => sum + transaction.amount,
        0,
      ),
      pendingCount: pendingSettlements.length,
      settledAmount: settledThisMonth.reduce(
        (sum, transaction) => sum + transaction.amount,
        0,
      ),
      totalVolume,
    };
  }, [bnplTransactions]);

  useEffect(() => {
    setPage(1);
  }, [search, dateFilter, statusFilter, customStart, customEnd]);

  async function handleRefund(payment: MerchantPayment) {
    if (!snapshot) return;
    setRefundLoading(true);

    try {
      await pesaswapClient.processRefund({
        payment_id: payment.paymentId,
        amount: payment.amount,
        reason: "customer_request",
        refunded_by: "Dashboard Manager",
        items: payment.items.map((item) => ({
          id: item.id,
          name: item.name,
          price: item.price,
          qty: item.qty,
        })),
      });
      toast.success(`Refund processed for ${payment.reference}`);
    } catch {
      toast.info(
        "Refund API unavailable. Marking transaction as refunded locally.",
      );
    } finally {
      const nextTables = snapshot.tables.map((table) => ({
        ...table,
        payments: table.payments.map((entry) =>
          entry.paymentId === payment.paymentId
            ? { ...entry, status: "refunded" as const }
            : entry,
        ),
      }));
      saveMerchantTables(nextTables);
      const nextSnapshot = { ...snapshot, tables: nextTables };
      setSnapshot(nextSnapshot);
      setSelected({ ...payment, status: "refunded" });
      setRefundLoading(false);
    }
  }

  function handleExport() {
    const header = [
      "Time",
      "Reference",
      "Customer",
      "Phone",
      "Amount",
      "Tip",
      "Method",
      "Status",
    ];
    const lines = filtered.map((transaction) =>
      [
        format(new Date(transaction.createdAt), "yyyy-MM-dd HH:mm"),
        transaction.reference,
        transaction.customerName,
        transaction.phone,
        transaction.amount,
        transaction.tip,
        transaction.method,
        transaction.status,
      ].join(","),
    );
    const blob = new Blob([[header.join(","), ...lines].join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "pesaswap-payments.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  if (!snapshot) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6">
        Loading payments…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border bg-card p-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="grid gap-3 md:grid-cols-2 xl:flex xl:flex-1 xl:items-center">
            <div className="relative xl:max-w-sm xl:flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search phone, reference, customer"
                className="pl-9"
              />
            </div>
            <select
              value={dateFilter}
              onChange={(event) =>
                setDateFilter(event.target.value as DateFilter)
              }
              className="rounded-xl border border-border bg-background px-3 py-2 text-sm"
            >
              <option value="today">Today</option>
              <option value="yesterday">Yesterday</option>
              <option value="last7">Last 7 days</option>
              <option value="last30">Last 30 days</option>
              <option value="custom">Custom</option>
            </select>
            <select
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(event.target.value as StatusFilter)
              }
              className="rounded-xl border border-border bg-background px-3 py-2 text-sm"
            >
              <option value="all">All statuses</option>
              <option value="succeeded">Succeeded</option>
              <option value="refunded">Refunded</option>
              <option value="failed">Failed</option>
            </select>
            {dateFilter === "custom" ? (
              <div className="grid gap-2 sm:grid-cols-2">
                <Input
                  type="date"
                  value={customStart}
                  onChange={(event) => setCustomStart(event.target.value)}
                />
                <Input
                  type="date"
                  value={customEnd}
                  onChange={(event) => setCustomEnd(event.target.value)}
                />
              </div>
            ) : null}
          </div>
          <Button onClick={handleExport} className="gap-2">
            <Download className="h-4 w-4" /> Export CSV
          </Button>
        </div>
      </div>

      <LivePaymentsPanel payments={livePayments} loading={liveLoading} />

      <div className="rounded-2xl border border-border bg-card p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold">Co-op BNPL transactions</h2>
            <p className="text-sm text-muted-foreground">
              Track financed checkouts, pending settlements and Co-op
              references.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-border bg-slate-50 p-4">
              <p className="text-sm text-muted-foreground">Total BNPL volume</p>
              <p className="mt-2 text-2xl font-semibold">
                {currency.format(bnplSummary.totalVolume)}
              </p>
            </div>
            <div className="rounded-2xl border border-border bg-slate-50 p-4">
              <p className="text-sm text-muted-foreground">
                Pending settlements
              </p>
              <p className="mt-2 text-2xl font-semibold">
                {currency.format(bnplSummary.pendingAmount)}
              </p>
              <p className="text-xs text-muted-foreground">
                {bnplSummary.pendingCount} waiting for Co-op settlement
              </p>
            </div>
            <div className="rounded-2xl border border-border bg-slate-50 p-4">
              <p className="text-sm text-muted-foreground">
                Settled this month
              </p>
              <p className="mt-2 text-2xl font-semibold">
                {currency.format(bnplSummary.settledAmount)}
              </p>
            </div>
          </div>
        </div>

        <div className="mt-6 overflow-x-auto rounded-2xl border border-border">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-muted-foreground">
              <tr>
                {[
                  "Date",
                  "Customer",
                  "Amount",
                  "Tenure",
                  "Status",
                  "Co-op Ref",
                ].map((column) => (
                  <th key={column} className="px-4 py-3 font-medium">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bnplTransactions.length ? (
                bnplTransactions.map((transaction, index) => (
                  <tr
                    key={transaction.id}
                    className={`border-t border-border ${index % 2 === 0 ? "bg-white" : "bg-slate-50/40"}`}
                  >
                    <td className="px-4 py-3">
                      {format(new Date(transaction.createdAt), "dd MMM yyyy")}
                    </td>
                    <td className="px-4 py-3">
                      <div>{transaction.customerName}</div>
                      <div className="text-xs text-muted-foreground">
                        {transaction.nationalId}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono">
                      {currency.format(transaction.amount)}
                    </td>
                    <td className="px-4 py-3">{transaction.tenure} days</td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-medium text-blue-700">
                        {transaction.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {transaction.coopReference || "Pending"}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-8 text-center text-sm text-muted-foreground"
                  >
                    No BNPL transactions yet. Complete a Co-op BNPL checkout to
                    see it here.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-muted-foreground">
              <tr>
                {[
                  "Time",
                  "Reference",
                  "Customer",
                  "Amount",
                  "Tip",
                  "Method",
                  "Status",
                  "Actions",
                ].map((column) => (
                  <th key={column} className="px-4 py-3 font-medium">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paginated.map((transaction, index) => (
                <tr
                  key={transaction.id}
                  className={`cursor-pointer border-t border-border hover:bg-slate-50 ${index % 2 === 0 ? "bg-white" : "bg-slate-50/50"}`}
                  onClick={() => setSelected(transaction)}
                >
                  <td className="px-4 py-3">
                    {format(new Date(transaction.createdAt), "HH:mm")}
                  </td>
                  <td className="px-4 py-3 font-medium">
                    {transaction.reference}
                  </td>
                  <td className="px-4 py-3">
                    <div>{transaction.customerName}</div>
                    <div className="text-xs text-muted-foreground">
                      {transaction.phone}
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono">
                    {currency.format(transaction.amount)}
                  </td>
                  <td className="px-4 py-3 font-mono">
                    {currency.format(transaction.tip)}
                  </td>
                  <td className="px-4 py-3">{transaction.method}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                        transaction.status === "succeeded"
                          ? "bg-emerald-100 text-emerald-700"
                          : transaction.status === "refunded"
                            ? "bg-amber-100 text-amber-700"
                            : "bg-rose-100 text-rose-700"
                      }`}
                    >
                      {transaction.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelected(transaction);
                      }}
                    >
                      View
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm">
          <span className="text-muted-foreground">
            Showing {(page - 1) * pageSize + 1}-
            {Math.min(page * pageSize, filtered.length)} of {filtered.length}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 1}
              onClick={() => setPage((value) => value - 1)}
            >
              Previous
            </Button>
            <span className="font-medium">
              Page {page} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page === totalPages}
              onClick={() => setPage((value) => value + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      </div>

      <Sheet
        open={Boolean(selected)}
        onOpenChange={(open) => !open && setSelected(null)}
      >
        <SheetContent
          side="right"
          className="w-full overflow-y-auto sm:max-w-2xl"
        >
          {selected ? (
            <>
              <SheetHeader>
                <SheetTitle>{selected.reference}</SheetTitle>
                <SheetDescription>
                  {selected.customerName} · Table {selected.tableNumber} ·{" "}
                  {format(new Date(selected.createdAt), "dd MMM yyyy HH:mm")}
                </SheetDescription>
              </SheetHeader>

              <div className="mt-6 space-y-6 text-sm">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-2xl border border-border bg-slate-50 p-4">
                    <p className="text-muted-foreground">Amount</p>
                    <p className="mt-2 font-mono text-2xl font-semibold">
                      {currency.format(selected.amount)}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Tip {currency.format(selected.tip)}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-border bg-slate-50 p-4">
                    <p className="text-muted-foreground">Method & status</p>
                    <p className="mt-2 text-base font-semibold">
                      {selected.method}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {selected.status}
                    </p>
                  </div>
                </div>

                <div className="rounded-2xl border border-border bg-card p-4">
                  <h4 className="font-semibold">Items</h4>
                  <div className="mt-3 space-y-2">
                    {selected.items.map((item) => (
                      <div
                        key={`${selected.id}-${item.id}`}
                        className="flex items-center justify-between rounded-xl border border-border px-3 py-2"
                      >
                        <div>
                          <div className="font-medium">{item.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {item.qty} × {currency.format(item.price)}
                          </div>
                        </div>
                        <div className="font-mono text-sm">
                          {currency.format(item.qty * item.price)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {selected.splitInfo ? (
                  <div className="rounded-2xl border border-border bg-card p-4">
                    <h4 className="font-semibold">Split details</h4>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {selected.splitInfo.participants} participants
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {selected.splitInfo.shares.map((share, index) => (
                        <span
                          key={share + index}
                          className="rounded-full bg-blue-100 px-3 py-1 text-xs font-medium text-blue-700"
                        >
                          Share {index + 1}: {currency.format(share)}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="rounded-2xl border border-border bg-card p-4">
                  <h4 className="font-semibold">Metadata</h4>
                  <div className="mt-3 grid gap-2">
                    {Object.entries(selected.metadata).map(([key, value]) => (
                      <div
                        key={key}
                        className="flex items-center justify-between rounded-xl border border-border px-3 py-2"
                      >
                        <span className="text-muted-foreground">{key}</span>
                        <span className="font-medium">{String(value)}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <Button
                  className="w-full gap-2"
                  variant="outline"
                  disabled={selected.status !== "succeeded" || refundLoading}
                  onClick={() => handleRefund(selected)}
                >
                  <RotateCcw className="h-4 w-4" />{" "}
                  {refundLoading ? "Processing refund..." : "Process refund"}
                </Button>
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

const liveCurrency = new Intl.NumberFormat("en-KE", {
  style: "currency",
  currency: "KES",
  maximumFractionDigits: 2,
});

const LIVE_STATUS_STYLE: Record<string, string> = {
  succeeded: "bg-emerald-100 text-emerald-700",
  paid: "bg-emerald-100 text-emerald-700",
  captured: "bg-emerald-100 text-emerald-700",
  processing: "bg-amber-100 text-amber-700",
  failed: "bg-rose-100 text-rose-700",
  cancelled: "bg-rose-100 text-rose-700",
  refund: "bg-slate-200 text-slate-700",
};

function LivePaymentsPanel({
  payments,
  loading,
}: {
  payments: LivePayment[];
  loading: boolean;
}) {
  const [statusFilter, setStatusFilter] = useState<
    "all" | "succeeded" | "processing" | "failed"
  >("all");
  const [retrying, setRetrying] = useState<string | null>(null);

  const succeeded = payments.filter((p) =>
    ["succeeded", "paid", "captured"].includes(p.status),
  );
  const gross = succeeded.reduce((sum, p) => sum + p.amount, 0) / 100;

  const filtered = payments.filter((p) => {
    if (statusFilter === "all") return true;
    if (statusFilter === "succeeded")
      return ["succeeded", "paid", "captured"].includes(p.status);
    if (statusFilter === "failed")
      return ["failed", "cancelled"].includes(p.status);
    return p.status === statusFilter;
  });

  async function reRequest(id: string) {
    setRetrying(id);
    try {
      const res = await authFetch(`/api/payments/${id}/retry`, {
        method: "POST",
      });
      if (res.ok) {
        toast.success("M-Pesa prompt re-sent to the customer");
      } else {
        const d = (await res.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        toast.error(d.error?.message || "Couldn't re-request payment");
      }
    } catch {
      toast.error("Couldn't re-request payment");
    } finally {
      setRetrying(null);
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
            </span>
            Live payments
          </h2>
          <p className="text-sm text-muted-foreground">
            Real transactions from the PesaSwap ledger (M-Pesa, cards, wallets) —
            every attempt, updated automatically.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(
                e.target.value as "all" | "succeeded" | "processing" | "failed",
              )
            }
            className="rounded-xl border border-border bg-background px-3 py-2 text-sm"
          >
            <option value="all">All statuses</option>
            <option value="succeeded">Succeeded</option>
            <option value="processing">Processing</option>
            <option value="failed">Failed / declined</option>
          </select>
          <div className="text-right">
            <p className="text-2xl font-semibold">{liveCurrency.format(gross)}</p>
            <p className="text-xs text-muted-foreground">
              {succeeded.length} succeeded · {payments.length} total
            </p>
          </div>
        </div>
      </div>

      <div className="mt-4 overflow-x-auto">
        {loading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Loading live transactions…
          </p>
        ) : filtered.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {payments.length === 0
              ? "No live transactions yet. A real payment will appear here the moment it is attempted."
              : "No transactions match this filter."}
          </p>
        ) : (
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-4">Time</th>
                <th className="py-2 pr-4">Amount</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Customer</th>
                <th className="py-2 pr-4">Flow</th>
                <th className="py-2 pr-4">Ref</th>
                <th className="py-2 pr-4"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const isFailed = ["failed", "cancelled"].includes(p.status);
                const canRetry = isFailed || p.status === "processing";
                return (
                  <tr key={p.id} className="border-b border-border/50">
                    <td className="py-2 pr-4 whitespace-nowrap text-muted-foreground">
                      {format(new Date(p.createdAt), "d MMM HH:mm")}
                    </td>
                    <td className="py-2 pr-4 font-medium">
                      {liveCurrency.format(p.amount / 100)}
                      {p.tipAmount > 0 ? (
                        <span className="ml-1 text-xs text-muted-foreground">
                          (+{liveCurrency.format(p.tipAmount / 100)} tip)
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-4">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          LIVE_STATUS_STYLE[p.status] ??
                          "bg-slate-100 text-slate-700"
                        }`}
                      >
                        {p.status}
                      </span>
                      {p.errorMessage ? (
                        <span className="ml-2 text-xs text-rose-600">
                          {p.errorMessage}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-4">
                      {p.customerName || p.customerPhone || "—"}
                      {p.initiator === "agent" ? (
                        <span className="ml-1 rounded bg-purple-100 px-1 text-[10px] font-medium text-purple-700">
                          agent
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-4 text-muted-foreground">
                      {p.flowType || p.kind}
                    </td>
                    <td className="py-2 pr-4 font-mono text-xs text-muted-foreground">
                      {p.providerRef || "—"}
                    </td>
                    <td className="py-2 pr-4 text-right">
                      {canRetry && p.customerPhone ? (
                        <button
                          onClick={() => reRequest(p.id)}
                          disabled={retrying === p.id}
                          className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                        >
                          <RotateCcw className="h-3 w-3" />
                          {retrying === p.id ? "Sending…" : "Re-request"}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
