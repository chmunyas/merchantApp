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
