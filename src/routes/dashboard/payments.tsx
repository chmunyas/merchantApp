import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { format, isSameDay, subDays } from "date-fns";
import { Download, RefreshCw, RotateCcw, Search, Send } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
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
  getCurrentVenueId,
  loadMerchantSnapshot,
  saveMerchantTables,
  type MerchantPayment,
  type MerchantSnapshot,
} from "@/lib/merchant-dashboard";
import { getBNPLTransactions, type BNPLTransaction } from "@/lib/coop-bnpl";
import { pesaswapClient } from "@/lib/pesaswap-payments";
import { authFetch } from "@/lib/auth";
import { useAuthQuery } from "@/lib/use-auth-query";

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
  refundedAmount: number; // minor units refunded on this payment
  refundOf: string | null; // for a refund row: the payment it reverses
  refundReason: string | null;
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
  const queryClient = useQueryClient();

  // Real transactions from the durable ledger (every attempt, any status) — a PURE
  // DB read (no PesaSwap round-trip) so the panel renders at DB speed. Cached +
  // venue-scoped, so revisiting the page paints INSTANTLY from cache and then
  // revalidates; it self-refreshes every 15s. The authoritative PesaSwap reconcile
  // runs OFF this path (background sync below) and invalidates the cache when done,
  // so the UI never blocks on the network.
  const liveQuery = useAuthQuery<{ payments: LivePayment[] }, LivePayment[]>(
    ["payments-list"],
    "/api/payments/list?limit=100",
    { select: (d) => d.payments ?? [], refetchInterval: 15000 },
  );
  const livePayments = liveQuery.data ?? [];
  const liveLoading = liveQuery.isLoading;

  const refreshLive = useCallback(
    () =>
      queryClient.invalidateQueries({
        queryKey: [getCurrentVenueId(), "payments-list"],
      }),
    [queryClient],
  );

  // Silent background reconcile: pull refunds + stuck payments from PesaSwap into
  // the DB, then invalidate the cached list. Fire-and-forget — never blocks render.
  const backgroundSync = useCallback(async () => {
    try {
      const res = await authFetch("/api/payments/sync", { method: "POST" });
      if (res.ok) {
        await queryClient.invalidateQueries({
          queryKey: [getCurrentVenueId(), "payments-list"],
        });
      }
    } catch {
      /* best-effort — the DB read still shows the latest known state */
    }
  }, [queryClient]);

  useEffect(() => {
    // useQuery drives the fast DB refresh (refetchInterval); this only runs the
    // slower PesaSwap reconcile.
    void backgroundSync();
    const syncPoll = setInterval(backgroundSync, 60000);
    return () => clearInterval(syncPoll);
  }, [backgroundSync]);

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

      <LivePaymentsPanel
        payments={livePayments}
        loading={liveLoading}
        onRefresh={refreshLive}
      />

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
  refunded: "bg-slate-200 text-slate-700",
  partially_refunded: "bg-indigo-100 text-indigo-700",
};

function LivePaymentsPanel({
  payments,
  loading,
  onRefresh,
}: {
  payments: LivePayment[];
  loading: boolean;
  onRefresh: () => Promise<void>;
}) {
  const [statusFilter, setStatusFilter] = useState<
    "all" | "succeeded" | "processing" | "failed" | "refunded"
  >("all");
  const [modalTarget, setModalTarget] = useState<LivePayment | null>(null);
  const [requestOpen, setRequestOpen] = useState(false);
  const [detailTarget, setDetailTarget] = useState<LivePayment | null>(null);
  const [syncing, setSyncing] = useState(false);

  async function forceSync() {
    setSyncing(true);
    try {
      const res = await authFetch("/api/payments/sync", { method: "POST" });
      if (res.ok) {
        const d = (await res.json()) as {
          refundsSynced?: number;
          paymentsSynced?: number;
        };
        const parts: string[] = [];
        if (d.refundsSynced) parts.push(`${d.refundsSynced} refund(s)`);
        if (d.paymentsSynced) parts.push(`${d.paymentsSynced} payment(s)`);
        toast.success(
          parts.length ? `Synced ${parts.join(" + ")}` : "Already up to date",
        );
      } else {
        toast.error("Sync failed. Try again.");
      }
    } catch {
      toast.error("Sync failed. Try again.");
    } finally {
      await onRefresh();
      setSyncing(false);
    }
  }

  const succeeded = payments.filter((p) =>
    ["succeeded", "paid", "captured"].includes(p.status),
  );
  // Net of refunds: gross settled minus what has been refunded back out.
  const gross = succeeded.reduce((sum, p) => sum + p.amount, 0) / 100;
  const refundedTotal =
    payments.reduce((sum, p) => sum + (p.refundedAmount || 0), 0) / 100;

  const filtered = payments.filter((p) => {
    if (statusFilter === "all") return true;
    if (statusFilter === "succeeded")
      return ["succeeded", "paid", "captured"].includes(p.status);
    if (statusFilter === "failed")
      return ["failed", "cancelled"].includes(p.status);
    if (statusFilter === "refunded")
      return (
        ["refunded", "partially_refunded", "refund"].includes(p.status) ||
        p.refundedAmount > 0
      );
    return p.status === statusFilter;
  });

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
          <button
            onClick={forceSync}
            disabled={syncing}
            title="Pull the latest payments + refunds from PesaSwap now"
            className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-background px-3 py-2 text-sm font-semibold hover:bg-muted disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Syncing…" : "Force sync"}
          </button>
          <button
            onClick={() => setRequestOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
          >
            <Send className="h-4 w-4" /> Request payment
          </button>
          <select
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(
                e.target.value as
                  | "all"
                  | "succeeded"
                  | "processing"
                  | "failed"
                  | "refunded",
              )
            }
            className="rounded-xl border border-border bg-background px-3 py-2 text-sm"
          >
            <option value="all">All statuses</option>
            <option value="succeeded">Succeeded</option>
            <option value="processing">Processing</option>
            <option value="failed">Failed / declined</option>
            <option value="refunded">Refunded</option>
          </select>
          <div className="text-right">
            <p className="text-2xl font-semibold">{liveCurrency.format(gross)}</p>
            <p className="text-xs text-muted-foreground">
              {succeeded.length} succeeded · {payments.length} total
              {refundedTotal > 0
                ? ` · ${liveCurrency.format(refundedTotal)} refunded`
                : ""}
            </p>
          </div>
        </div>
      </div>
      {requestOpen ? (
        <RequestPaymentModal onClose={() => setRequestOpen(false)} />
      ) : null}

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
                  <tr
                    key={p.id}
                    onClick={() => setDetailTarget(p)}
                    className="cursor-pointer border-b border-border/50 hover:bg-muted/40"
                  >
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
                      {p.refundedAmount > 0 ? (
                        <span className="ml-1 text-xs font-semibold text-indigo-600">
                          (−{liveCurrency.format(p.refundedAmount / 100)} refunded)
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
                        {p.status.replace(/_/g, " ")}
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
                          onClick={(e) => {
                            e.stopPropagation();
                            setModalTarget(p);
                          }}
                          className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
                        >
                          <RotateCcw className="h-3 w-3" />
                          Re-request
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

      {modalTarget ? (
        <ReRequestModal
          payment={modalTarget}
          onClose={() => setModalTarget(null)}
        />
      ) : null}
      {detailTarget ? (
        <PaymentDetailModal
          payment={detailTarget}
          onClose={() => setDetailTarget(null)}
        />
      ) : null}
    </div>
  );
}

// Per-transaction detail — the full trail so the merchant can trace any payment:
// amount + tip, status + decline reason, M-Pesa receipt (REF), customer, flow,
// initiator (human/agent) and the internal payment id.
function PaymentDetailModal({
  payment,
  onClose,
}: {
  payment: LivePayment;
  onClose: () => void;
}) {
  const rows: Array<[string, string]> = [
    ["Amount", liveCurrency.format(payment.amount / 100)],
    ...(payment.tipAmount > 0
      ? ([["Tip", liveCurrency.format(payment.tipAmount / 100)]] as Array<
          [string, string]
        >)
      : []),
    ["Status", payment.status],
    ...(payment.errorMessage
      ? ([["Reason", payment.errorMessage]] as Array<[string, string]>)
      : []),
    ["M-Pesa receipt (REF)", payment.providerRef || "—"],
    ...(payment.refundedAmount > 0
      ? ([
          [
            "Refunded",
            `${liveCurrency.format(payment.refundedAmount / 100)}${
              payment.refundedAmount >= payment.amount ? " (full)" : " (partial)"
            }`,
          ],
        ] as Array<[string, string]>)
      : []),
    ...(payment.refundOf
      ? ([["Refund of", payment.refundOf]] as Array<[string, string]>)
      : []),
    ...(payment.refundReason
      ? ([["Refund reason", payment.refundReason]] as Array<[string, string]>)
      : []),
    ["Customer", payment.customerName || payment.customerPhone || "—"],
    ...(payment.customerName && payment.customerPhone
      ? ([["Phone", payment.customerPhone]] as Array<[string, string]>)
      : []),
    ["Flow", payment.flowType || payment.kind],
    ["Initiator", payment.initiator],
    ["Time", format(new Date(payment.createdAt), "d MMM yyyy, HH:mm:ss")],
    ["Payment ID", payment.id],
  ];
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-3xl bg-card p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-bold">Transaction detail</h3>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              LIVE_STATUS_STYLE[payment.status] ?? "bg-slate-100 text-slate-700"
            }`}
          >
            {payment.status.replace(/_/g, " ")}
          </span>
        </div>
        <div className="divide-y divide-border rounded-2xl border border-border">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-start justify-between gap-4 px-4 py-2.5">
              <span className="text-xs text-muted-foreground">{k}</span>
              <span className="max-w-[60%] break-all text-right font-mono text-xs font-medium">
                {v}
              </span>
            </div>
          ))}
        </div>
        <button
          onClick={onClose}
          className="mt-4 w-full rounded-2xl border border-border py-2.5 text-sm font-semibold"
        >
          Close
        </button>
      </div>
    </div>
  );
}

// Merchant re-request modal — edit the amount + phone, then re-send the M-Pesa STK.
// Merchant "Request payment" — mint a server-bound pay link for any amount and send
// it to a customer over WhatsApp / Telegram / SMS (or copy it), in one step.
function RequestPaymentModal({ onClose }: { onClose: () => void }) {
  const [amountKes, setAmountKes] = useState("");
  const [phone, setPhone] = useState("");
  const [description, setDescription] = useState("");
  const [channel, setChannel] = useState<"whatsapp" | "telegram" | "sms">(
    "whatsapp",
  );
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const amount = Math.max(0, Math.round(Number(amountKes) || 0));

  async function mintAndSend() {
    if (amount <= 0) {
      toast.error("Enter an amount.");
      return;
    }
    setBusy(true);
    try {
      const res = await authFetch("/api/pay-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amountKes: amount,
          description: description || undefined,
          kind: "request",
          phone: phone || undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        url?: string;
        error?: string;
      };
      if (!res.ok || !data.url) {
        toast.error(data.error || "Couldn't create the pay link");
        return;
      }
      setLink(data.url);
      const message = `Here's your secure payment link for KES ${amount.toLocaleString()}${
        description ? ` (${description})` : ""
      }. Tap to pay 👇`;
      if (phone.trim()) {
        const shareRes = await authFetch("/api/share", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            channel,
            to: phone,
            text: message,
            link: data.url,
            kind: "pay-request",
          }),
        });
        const sd = (await shareRes.json().catch(() => ({}))) as {
          delivery?: string;
        };
        if (sd.delivery === "sent") {
          toast.success(`Payment link sent on ${channel}.`);
        } else if (sd.delivery === "suppressed") {
          toast.error("This customer has opted out.");
        } else {
          toast.info("Link created — copy it below to send.");
        }
      } else {
        toast.success("Payment link created — copy it below.");
      }
    } catch {
      toast.error("Couldn't create the pay link");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-3xl bg-card p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-2xl bg-emerald-100">
            <Send className="size-5 text-emerald-600" />
          </div>
          <div>
            <h3 className="text-base font-bold">Request payment</h3>
            <p className="text-xs text-muted-foreground">
              Send a secure pay link over any channel
            </p>
          </div>
        </div>

        <label className="mb-1 block text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
          Amount
        </label>
        <div className="mb-3 flex items-center rounded-xl border border-border bg-background px-3">
          <span className="text-sm font-mono font-bold text-muted-foreground">
            KES
          </span>
          <input
            type="tel"
            inputMode="numeric"
            value={amountKes}
            onChange={(e) => setAmountKes(e.target.value.replace(/[^0-9]/g, ""))}
            placeholder="0"
            className="w-full bg-transparent px-2 py-3 text-center text-2xl font-bold font-mono focus:outline-none"
          />
        </div>

        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What's it for? (optional)"
          className="mb-3 w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />

        <div className="mb-3 grid grid-cols-3 gap-2">
          {(["whatsapp", "telegram", "sms"] as const).map((c) => (
            <button
              key={c}
              onClick={() => setChannel(c)}
              className={`rounded-xl border py-2 text-xs font-medium capitalize ${
                channel === c
                  ? "border-foreground bg-foreground text-background"
                  : "border-border text-muted-foreground"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="Customer phone (optional — or just copy the link)"
          className="mb-4 w-full rounded-xl border border-border bg-background px-4 py-2.5 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />

        {link ? (
          <div className="mb-3 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-2">
            <span className="flex-1 truncate font-mono text-xs text-emerald-800">
              {link}
            </span>
            <button
              onClick={() => {
                void navigator.clipboard?.writeText(link);
                toast.success("Copied");
              }}
              className="rounded-lg bg-emerald-600 px-2 py-1 text-xs font-semibold text-white"
            >
              Copy
            </button>
          </div>
        ) : null}

        <button
          onClick={mintAndSend}
          disabled={busy || amount <= 0}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 py-3.5 text-sm font-bold text-white disabled:opacity-40"
        >
          <Send className="size-4" />
          {busy
            ? "Working…"
            : phone.trim()
              ? `Send link · KES ${amount.toLocaleString()}`
              : `Create link · KES ${amount.toLocaleString()}`}
        </button>
        <button
          onClick={onClose}
          className="mt-2 w-full rounded-2xl py-2.5 text-sm text-muted-foreground"
        >
          Close
        </button>
      </div>
    </div>
  );
}

function ReRequestModal({
  payment,
  onClose,
}: {
  payment: LivePayment;
  onClose: () => void;
}) {
  const [amountKes, setAmountKes] = useState(
    String(Math.round(payment.amount / 100)),
  );
  const [phone, setPhone] = useState(payment.customerPhone ?? "");
  const [sending, setSending] = useState(false);
  const amount = Math.max(0, Math.round(Number(amountKes) || 0));

  async function send() {
    if (amount <= 0 || !phone) return;
    setSending(true);
    try {
      const res = await authFetch(`/api/payments/${payment.id}/retry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: amount * 100, phone }),
      });
      if (res.ok) {
        toast.success(`M-Pesa prompt for KES ${amount.toLocaleString()} sent to ${phone}`);
        onClose();
      } else {
        const d = (await res.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        toast.error(d.error?.message || "Couldn't re-request payment");
      }
    } catch {
      toast.error("Couldn't re-request payment");
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-3xl bg-card p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-2xl bg-emerald-100">
            <RotateCcw className="size-5 text-emerald-600" />
          </div>
          <div>
            <h3 className="text-base font-bold">Re-request payment</h3>
            <p className="text-xs text-muted-foreground">
              Send a fresh M-Pesa prompt to the customer
            </p>
          </div>
        </div>

        <label className="mb-1 block text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
          Amount
        </label>
        <div className="mb-3 flex items-center gap-2">
          <button
            onClick={() => setAmountKes(String(Math.max(0, amount - 50)))}
            className="size-11 shrink-0 rounded-xl border border-border text-lg font-bold text-muted-foreground"
          >
            −
          </button>
          <div className="flex flex-1 items-center rounded-xl border border-border bg-background px-3">
            <span className="text-sm font-mono font-bold text-muted-foreground">
              KES
            </span>
            <input
              type="tel"
              inputMode="numeric"
              value={amountKes}
              onChange={(e) => setAmountKes(e.target.value.replace(/[^0-9]/g, ""))}
              className="w-full bg-transparent px-2 py-3 text-center text-2xl font-bold font-mono focus:outline-none"
            />
          </div>
          <button
            onClick={() => setAmountKes(String(amount + 50))}
            className="size-11 shrink-0 rounded-xl border border-border text-lg font-bold text-muted-foreground"
          >
            +
          </button>
        </div>

        <label className="mb-1 block text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
          Customer M-Pesa number
        </label>
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+2547XXXXXXXX"
          className="mb-5 w-full rounded-xl border border-border bg-background px-4 py-3 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />

        <button
          onClick={send}
          disabled={sending || amount <= 0 || !phone}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 py-3.5 text-sm font-bold text-white disabled:opacity-40"
        >
          <Send className="size-4" />
          {sending ? "Sending…" : `Send prompt · KES ${amount.toLocaleString()}`}
        </button>
        <button
          onClick={onClose}
          className="mt-2 w-full rounded-2xl py-2.5 text-sm text-muted-foreground"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
