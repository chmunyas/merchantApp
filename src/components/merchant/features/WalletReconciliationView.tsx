import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw, Zap } from "lucide-react";

import type { Invoice, WalletProvider, WalletTransaction } from "./types";

const WALLET_PROVIDERS: WalletProvider[] = [
  {
    id: "mpesa",
    name: "M-Pesa",
    icon: "🟢",
    color: "text-green-700",
    bgColor: "bg-green-50",
    connected: true,
    balance: 45200,
    currency: "KES",
    lastSync: "2 min ago",
    txCount: 23,
  },
  {
    id: "mtn_momo",
    name: "MTN MoMo",
    icon: "🟡",
    color: "text-yellow-700",
    bgColor: "bg-yellow-50",
    connected: true,
    balance: 1280000,
    currency: "NGN",
    lastSync: "5 min ago",
    txCount: 12,
  },
  {
    id: "airtel",
    name: "Airtel Money",
    icon: "🔴",
    color: "text-red-700",
    bgColor: "bg-red-50",
    connected: true,
    balance: 8400,
    currency: "KES",
    lastSync: "12 min ago",
    txCount: 7,
  },
  {
    id: "bank",
    name: "Bank (KCB)",
    icon: "🏦",
    color: "text-blue-700",
    bgColor: "bg-blue-50",
    connected: true,
    balance: 234500,
    currency: "KES",
    lastSync: "1 hr ago",
    txCount: 5,
  },
  {
    id: "wise",
    name: "Wise",
    icon: "🌍",
    color: "text-emerald-700",
    bgColor: "bg-emerald-50",
    connected: false,
    balance: 0,
    currency: "USD",
    lastSync: "—",
    txCount: 0,
  },
];

function generateWalletTransactions(invoices: Invoice[]): WalletTransaction[] {
  const txs: WalletTransaction[] = [
    {
      id: "TX-001",
      wallet: "mpesa",
      type: "credit",
      amount: 2500,
      currency: "KES",
      from: "0722***456",
      reference: "QJ4K8M2N",
      timestamp: "2026-05-30T14:22:00.000Z",
      matched: true,
      matchedInvoiceId: "INV-10233",
      status: "confirmed",
    },
    {
      id: "TX-002",
      wallet: "mpesa",
      type: "credit",
      amount: 1800,
      currency: "KES",
      from: "0733***789",
      reference: "MK9P3L7R",
      timestamp: "2026-05-30T13:45:00.000Z",
      matched: false,
      status: "confirmed",
    },
    {
      id: "TX-003",
      wallet: "mtn_momo",
      type: "credit",
      amount: 450000,
      currency: "NGN",
      from: "080***1234",
      reference: "MTN-8847291",
      timestamp: "2026-05-30T12:30:00.000Z",
      matched: true,
      matchedInvoiceId: "INV-10240",
      status: "confirmed",
    },
    {
      id: "TX-004",
      wallet: "mpesa",
      type: "credit",
      amount: 5000,
      currency: "KES",
      from: "0711***222",
      reference: "PL2M9K4X",
      timestamp: "2026-05-30T11:15:00.000Z",
      matched: true,
      matchedInvoiceId: "INV-10233",
      status: "confirmed",
    },
    {
      id: "TX-005",
      wallet: "airtel",
      type: "credit",
      amount: 3200,
      currency: "KES",
      from: "0734***567",
      reference: "AIR-662841",
      timestamp: "2026-05-30T10:50:00.000Z",
      matched: false,
      status: "confirmed",
    },
    {
      id: "TX-006",
      wallet: "mtn_momo",
      type: "credit",
      amount: 125000,
      currency: "NGN",
      from: "070***5678",
      reference: "MTN-9912034",
      timestamp: "2026-05-30T09:20:00.000Z",
      matched: false,
      status: "pending",
    },
    {
      id: "TX-007",
      wallet: "bank",
      type: "credit",
      amount: 15000,
      currency: "KES",
      from: "KCB REF 44821",
      reference: "BNK-44821",
      timestamp: "2026-05-30T08:00:00.000Z",
      matched: true,
      matchedInvoiceId: "INV-10238",
      status: "confirmed",
    },
    {
      id: "TX-008",
      wallet: "mpesa",
      type: "debit",
      amount: 500,
      currency: "KES",
      from: "Float withdrawal",
      reference: "WD-8844",
      timestamp: "2026-05-30T07:30:00.000Z",
      matched: true,
      status: "confirmed",
    },
  ];
  return txs;
}

export function WalletReconciliationView({
  invoices,
}: {
  invoices: Invoice[];
}) {
  const [selectedWallet, setSelectedWallet] = useState<string | null>(null);
  const [showUnmatched, setShowUnmatched] = useState(false);
  const transactions = useMemo(
    () => generateWalletTransactions(invoices),
    [invoices],
  );

  const connectedWallets = WALLET_PROVIDERS.filter((w) => w.connected);
  const totalBalance = connectedWallets.reduce((sum, w) => {
    // Normalize to KES for display
    const rate =
      w.currency === "KES"
        ? 1
        : w.currency === "NGN"
          ? 0.082
          : w.currency === "USD"
            ? 129.5
            : 1;
    return sum + w.balance * rate;
  }, 0);

  const matchedCount = transactions.filter((t) => t.matched).length;
  const unmatchedCount = transactions.filter((t) => !t.matched).length;
  const filteredTxs = transactions.filter((t) => {
    if (selectedWallet && t.wallet !== selectedWallet) return false;
    if (showUnmatched && t.matched) return false;
    return true;
  });

  return (
    <div className="px-5 pt-3 space-y-5">
      <div className="flex justify-between items-start">
        <div>
          <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            Reconciliation
          </p>
          <h1 className="text-lg font-bold">Multi-Wallet Hub</h1>
        </div>
        <button className="flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-1">
          <RefreshCw className="size-3 text-emerald-600" />
          <span className="text-[9px] font-mono text-emerald-700 uppercase">
            Sync all
          </span>
        </button>
      </div>

      {/* Consolidated Balance */}
      <div className="rounded-2xl bg-foreground text-background p-5 text-center">
        <p className="text-[10px] font-mono uppercase tracking-widest opacity-60">
          Consolidated balance
        </p>
        <p className="text-3xl font-bold font-mono mt-1">
          KES{" "}
          {totalBalance.toLocaleString(undefined, { maximumFractionDigits: 0 })}
        </p>
        <p className="text-[10px] opacity-60 mt-1">
          Across {connectedWallets.length} connected wallets
        </p>
      </div>

      {/* Reconciliation Stats */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-center">
          <CheckCircle2 className="size-4 text-emerald-600 mx-auto" />
          <p className="text-lg font-bold font-mono text-emerald-700 mt-1">
            {matchedCount}
          </p>
          <p className="text-[8px] font-mono uppercase text-emerald-600">
            Matched
          </p>
        </div>
        <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-center">
          <AlertTriangle className="size-4 text-amber-600 mx-auto" />
          <p className="text-lg font-bold font-mono text-amber-700 mt-1">
            {unmatchedCount}
          </p>
          <p className="text-[8px] font-mono uppercase text-amber-600">
            Unmatched
          </p>
        </div>
        <div className="rounded-xl bg-blue-50 border border-blue-200 p-3 text-center">
          <Zap className="size-4 text-blue-600 mx-auto" />
          <p className="text-lg font-bold font-mono text-blue-700 mt-1">
            {Math.round((matchedCount / transactions.length) * 100)}%
          </p>
          <p className="text-[8px] font-mono uppercase text-blue-600">
            Auto-match
          </p>
        </div>
      </div>

      {/* Connected Wallets */}
      <div className="rounded-2xl border border-border bg-background p-4">
        <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-3">
          Connected wallets
        </p>
        <div className="space-y-2">
          {WALLET_PROVIDERS.map((wallet) => (
            <button
              key={wallet.id}
              onClick={() =>
                setSelectedWallet(
                  selectedWallet === wallet.id ? null : wallet.id,
                )
              }
              className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-colors text-left ${
                selectedWallet === wallet.id
                  ? "border-foreground bg-muted"
                  : wallet.connected
                    ? "border-border hover:bg-muted"
                    : "border-dashed border-border opacity-50"
              }`}
            >
              <span className="text-lg">{wallet.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-[11px] font-semibold">{wallet.name}</p>
                  {wallet.connected && (
                    <span className="size-1.5 rounded-full bg-emerald-500" />
                  )}
                </div>
                <p className="text-[9px] font-mono text-muted-foreground">
                  {wallet.connected
                    ? `Synced ${wallet.lastSync} · ${wallet.txCount} txns today`
                    : "Not connected"}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[11px] font-mono font-bold">
                  {wallet.connected
                    ? `${wallet.currency} ${wallet.balance.toLocaleString()}`
                    : "—"}
                </p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Transaction Feed */}
      <div className="rounded-2xl border border-border bg-background p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            Transaction feed
          </p>
          <button
            onClick={() => setShowUnmatched((v) => !v)}
            className={`text-[9px] font-mono uppercase px-2 py-1 rounded-full border transition-colors ${
              showUnmatched
                ? "bg-amber-100 border-amber-300 text-amber-700"
                : "border-border text-muted-foreground"
            }`}
          >
            {showUnmatched ? "Unmatched only" : "All"}
          </button>
        </div>
        <div className="space-y-2">
          {filteredTxs.map((tx) => {
            const wallet = WALLET_PROVIDERS.find((w) => w.id === tx.wallet);
            return (
              <div
                key={tx.id}
                className={`p-3 rounded-xl border ${
                  tx.matched
                    ? "border-border bg-card"
                    : "border-amber-200 bg-amber-50"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">{wallet?.icon}</span>
                    <div>
                      <p className="text-[11px] font-semibold">{tx.from}</p>
                      <p className="text-[9px] font-mono text-muted-foreground">
                        {tx.reference}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p
                      className={`text-[11px] font-mono font-bold ${tx.type === "credit" ? "text-emerald-600" : "text-red-600"}`}
                    >
                      {tx.type === "credit" ? "+" : "-"}
                      {tx.currency} {tx.amount.toLocaleString()}
                    </p>
                    <p className="text-[8px] font-mono text-muted-foreground">
                      {new Date(tx.timestamp).toLocaleTimeString("en-US", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                </div>
                <div className="flex items-center justify-between mt-2 pt-2 border-t border-border">
                  {tx.matched ? (
                    <span className="inline-flex items-center gap-1 text-[9px] font-mono text-emerald-600">
                      <CheckCircle2 className="size-3" />
                      Matched → {tx.matchedInvoiceId}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[9px] font-mono text-amber-600">
                      <AlertTriangle className="size-3" />
                      Unmatched — tap to reconcile
                    </span>
                  )}
                  <span
                    className={`text-[8px] font-mono px-1.5 py-0.5 rounded-full ${
                      tx.status === "confirmed"
                        ? "bg-emerald-100 text-emerald-700"
                        : tx.status === "pending"
                          ? "bg-amber-100 text-amber-700"
                          : "bg-red-100 text-red-700"
                    }`}
                  >
                    {tx.status}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Auto-reconciliation rules */}
      <div className="rounded-2xl border border-border bg-background p-4">
        <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-3">
          Auto-match rules
        </p>
        <div className="space-y-2">
          {[
            {
              rule: "Match by invoice reference in payment note",
              active: true,
              matches: 4,
            },
            {
              rule: "Match by exact amount + customer phone",
              active: true,
              matches: 2,
            },
            {
              rule: "Match by amount ±5% within 24h of due date",
              active: true,
              matches: 1,
            },
            {
              rule: "Flag duplicate payments (same amount, same day)",
              active: false,
              matches: 0,
            },
          ].map((r) => (
            <div
              key={r.rule}
              className="flex items-center gap-3 p-2 rounded-lg bg-muted"
            >
              <span
                className={`size-2 rounded-full ${r.active ? "bg-emerald-500" : "bg-muted-foreground/30"}`}
              />
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-medium truncate">{r.rule}</p>
              </div>
              <span className="text-[9px] font-mono text-muted-foreground">
                {r.matches} hits
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── AI INSIGHTS ENGINE ───────────────────────────────────────────────────────
