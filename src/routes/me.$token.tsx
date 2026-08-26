import { createFileRoute } from "@tanstack/react-router";
import {
  Gift,
  Loader2,
  ReceiptText,
  ShieldCheck,
  Sparkles,
  WalletCards,
} from "lucide-react";
import { useEffect, useState } from "react";

import {
  paymentFlowLabel,
  paymentStatusLabel,
} from "@/lib/payment-ledger";

export const Route = createFileRoute("/me/$token")({
  component: CustomerPortalPage,
});

type Branding = {
  businessName: string;
  logoUrl: string | null;
  primaryColor: string | null;
  reseller: { name: string; poweredBy: string | null; logoUrl: string | null } | null;
};

type Reward = {
  id: string;
  name: string;
  description: string | null;
  pointsCost: number;
};

type Invoice = {
  id: string;
  number: string;
  amount: number | string;
  currency: string;
  description: string | null;
  status: string;
  pay_link: string | null;
  due_date?: string | null;
  balance_minor?: number | string;
  created_at: string;
};

type Payment = {
  id: string;
  amount: number;
  principalAmount: number;
  tipAmount: number;
  currency: string;
  status: string;
  kind: string;
  reference: string | null;
  providerRef: string | null;
  flowType: string | null;
  sourceId: string | null;
  invoiceNumber: string | null;
  errorMessage: string | null;
  refundedAmount: number;
  refundOf: string | null;
  refundReason: string | null;
  canRequestRefund: boolean;
  createdAt: string;
};

type Redemption = {
  id: string;
  reward_name: string | null;
  points_spent: number;
  code: string | null;
  status: string;
  created_at: string;
};

type PortalPayload = {
  venue: string;
  branding: Branding;
  contact: { name: string; points: number; tier: string };
  progress?: {
    tier: string;
    nextTier: string | null;
    pointsToNext: number;
    progressPct: number;
    atTop: boolean;
  };
  benefits?: {
    tier: string;
    current: string[];
    next: { tier: string; benefits: string[] } | null;
  };
  expiry?: { expiresAt: string | null; atRisk: boolean; daysLeft: number | null };
  invoices: Invoice[];
  payments: Payment[];
  rewards: Reward[];
  redemptions: Redemption[];
};

function formatKes(value: number | string): string {
  const amount = Number(value);
  return `KES ${(amount / 100).toLocaleString(undefined, {
    minimumFractionDigits: amount % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString();
}

const PORTAL_PAYMENT_STATUS_STYLE: Record<string, string> = {
  succeeded: "bg-emerald-100 text-emerald-800",
  paid: "bg-emerald-100 text-emerald-800",
  captured: "bg-emerald-100 text-emerald-800",
  processing: "bg-amber-100 text-amber-800",
  failed: "bg-rose-100 text-rose-800",
  cancelled: "bg-slate-200 text-slate-700",
  partially_refunded: "bg-indigo-100 text-indigo-800",
  refunded: "bg-indigo-100 text-indigo-800",
};

function CustomerPortalPage() {
  const { token } = Route.useParams();
  const [payload, setPayload] = useState<PortalPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [redeeming, setRedeeming] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);

  // A5.4 — asking the VENUE for a refund. Sunday's answer to "I paid with sunday
  // and I need a refund" is "reach out to the restaurant directly"; this is that
  // conversation, recorded. It creates a request. It cannot move money.
  const [refundFor, setRefundFor] = useState<string | null>(null);
  const [refundReason, setRefundReason] = useState("");
  const [requestBusy, setRequestBusy] = useState(false);
  const [requestStatus, setRequestStatus] = useState("");
  const [requestError, setRequestError] = useState<string | null>(null);

  // A5.6 — delete or correct my details.
  const [dataKind, setDataKind] = useState<"erasure" | "rectification">(
    "erasure",
  );
  const [dataNote, setDataNote] = useState("");

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/portal/${encodeURIComponent(token)}`);
      if (!res.ok) throw new Error("This portal link could not be loaded.");
      setPayload((await res.json()) as PortalPayload);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Portal unavailable.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function redeem(reward: Reward) {
    setRedeeming(reward.id);
    setCode(null);
    try {
      const res = await fetch(`/api/portal/${encodeURIComponent(token)}/redeem`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rewardId: reward.id }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        code?: string;
        error?: string;
      };
      if (!res.ok || !data.code) {
        throw new Error(data.error ?? "Could not redeem reward.");
      }
      setCode(data.code);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not redeem reward.");
    } finally {
      setRedeeming(null);
    }
  }

  async function submitRefundRequest(event: React.FormEvent) {
    event.preventDefault();
    if (!refundFor) return;
    setRequestBusy(true);
    setRequestError(null);
    setRequestStatus("Sending your request to the venue…");
    try {
      const res = await fetch(
        `/api/portal/${encodeURIComponent(token)}/refund-request`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            paymentId: refundFor,
            reason: refundReason.trim(),
          }),
        },
      );
      const data = (await res.json().catch(() => ({}))) as {
        message?: string;
        duplicate?: boolean;
        error?: string;
      };
      if (!res.ok) {
        setRequestError(data.error ?? "We couldn't send that request.");
        setRequestStatus("Request not sent.");
        return;
      }
      setRefundFor(null);
      setRefundReason("");
      setRequestStatus(
        data.duplicate
          ? "You already have a request open on this payment. The venue has it."
          : (data.message ??
            "Your request has been sent to the venue."),
      );
    } catch {
      setRequestError("We couldn't send that request.");
      setRequestStatus("Request not sent.");
    } finally {
      setRequestBusy(false);
    }
  }

  async function submitDataRequest(event: React.FormEvent) {
    event.preventDefault();
    setRequestBusy(true);
    setRequestError(null);
    setRequestStatus("Sending your request…");
    try {
      const res = await fetch(
        `/api/portal/${encodeURIComponent(token)}/data-request`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ kind: dataKind, note: dataNote.trim() }),
        },
      );
      const data = (await res.json().catch(() => ({}))) as {
        duplicate?: boolean;
        error?: string;
      };
      if (!res.ok) {
        setRequestError(data.error ?? "We couldn't send that request.");
        setRequestStatus("Request not sent.");
        return;
      }
      setDataNote("");
      setRequestStatus(
        data.duplicate
          ? "You already have a request of this type open. The venue has it."
          : "Recorded. The venue has 30 days to respond, and you'll be contacted on this number.",
      );
    } catch {
      setRequestError("We couldn't send that request.");
      setRequestStatus("Request not sent.");
    } finally {
      setRequestBusy(false);
    }
  }

  if (loading && !payload) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 text-white">
        <Loader2 className="h-8 w-8 animate-spin" />
      </main>
    );
  }

  if (error && !payload) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-center text-white">
        <div>
          <p className="text-lg font-semibold">Portal unavailable</p>
          <p className="mt-2 text-sm text-slate-300">{error}</p>
        </div>
      </main>
    );
  }

  if (!payload) return null;
  const accent = payload.branding.primaryColor ?? "#059669";

  return (
    <main className="min-h-screen bg-slate-100 pb-10">
      <section
        className="rounded-b-[2rem] px-5 pb-8 pt-6 text-white shadow-xl"
        style={{ background: accent }}
      >
        <div className="mx-auto max-w-md">
          <div className="flex items-center gap-3">
            {payload.branding.logoUrl ? (
              <img
                src={payload.branding.logoUrl}
                alt=""
                className="h-12 w-12 rounded-2xl bg-white object-contain p-1"
              />
            ) : (
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15">
                <Sparkles className="h-6 w-6" />
              </div>
            )}
            <div>
              <p className="text-xs uppercase tracking-[0.2em] opacity-75">
                My rewards
              </p>
              <h1 className="text-2xl font-black">{payload.branding.businessName}</h1>
            </div>
          </div>
          <div className="mt-7 rounded-3xl bg-white/15 p-5 backdrop-blur">
            <p className="text-sm opacity-80">Welcome back, {payload.contact.name}</p>
            <div className="mt-2 flex items-end justify-between gap-3">
              <div>
                <p className="text-5xl font-black">
                  {payload.contact.points.toLocaleString()}
                </p>
                <p className="text-sm font-semibold">available points</p>
              </div>
              <span className="rounded-full bg-white px-3 py-1 text-sm font-bold text-slate-900">
                {payload.contact.tier}
              </span>
            </div>
            {payload.progress ? (
              <div className="mt-4">
                {payload.progress.atTop ? (
                  <p className="text-xs font-semibold opacity-90">
                    🎉 You&apos;re at our top tier
                  </p>
                ) : (
                  <>
                    <div className="flex justify-between text-[11px] font-semibold opacity-90">
                      <span>{payload.progress.tier}</span>
                      <span>
                        {payload.progress.pointsToNext.toLocaleString()} pts to{" "}
                        {payload.progress.nextTier}
                      </span>
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-white/25">
                      <div
                        className="h-full rounded-full bg-white transition-all"
                        style={{ width: `${payload.progress.progressPct}%` }}
                      />
                    </div>
                  </>
                )}
              </div>
            ) : null}
          </div>
          {payload.branding.reseller?.poweredBy ? (
            <p className="mt-4 text-xs opacity-75">
              {payload.branding.reseller.poweredBy}
            </p>
          ) : null}
        </div>
      </section>

      <section className="mx-auto max-w-md space-y-5 px-4 pt-5">
        {code ? (
          <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5 text-center">
            <p className="text-sm font-semibold text-emerald-700">Show this code</p>
            <p className="mt-1 font-mono text-4xl font-black tracking-widest text-emerald-950">
              {code}
            </p>
          </div>
        ) : null}
        {error ? <p className="rounded-2xl bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
        {payload.expiry?.atRisk && payload.expiry.expiresAt ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-center text-sm font-semibold text-amber-800">
            ⏳ {payload.contact.points.toLocaleString()} points expire on{" "}
            {payload.expiry.expiresAt}
            {typeof payload.expiry.daysLeft === "number"
              ? ` (${payload.expiry.daysLeft} days)`
              : ""}{" "}
            — redeem or visit to keep them.
          </div>
        ) : null}

        <div>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-black uppercase tracking-[0.2em] text-slate-500">
            <Gift className="h-4 w-4" /> Redeem rewards
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {payload.rewards.map((reward) => {
              const canRedeem = payload.contact.points >= reward.pointsCost;
              return (
                <article key={reward.id} className="rounded-3xl bg-white p-4 shadow-sm">
                  <h3 className="font-bold text-slate-950">{reward.name}</h3>
                  {reward.description ? (
                    <p className="mt-1 text-sm text-slate-500">{reward.description}</p>
                  ) : null}
                  <div className="mt-4 flex items-center justify-between gap-3">
                    <span className="font-mono text-sm font-black text-slate-700">
                      {reward.pointsCost} pts
                    </span>
                    <button
                      type="button"
                      disabled={!canRedeem || redeeming === reward.id}
                      onClick={() => redeem(reward)}
                      className="rounded-full px-4 py-2 text-sm font-black text-white disabled:opacity-40"
                      style={{ background: accent }}
                    >
                      {redeeming === reward.id ? "..." : "Redeem"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </div>

        {payload.benefits ? (
          <div className="rounded-3xl bg-white p-5 shadow-sm">
            <h2 className="flex items-center gap-2 font-black text-slate-950">
              <Sparkles className="h-4 w-4" /> Your {payload.benefits.tier} perks
            </h2>
            <ul className="mt-3 space-y-1.5 text-sm text-slate-600">
              {payload.benefits.current.map((b) => (
                <li key={b} className="flex gap-2">
                  <span style={{ color: accent }}>✓</span>
                  {b}
                </li>
              ))}
            </ul>
            {payload.benefits.next ? (
              <div className="mt-4 rounded-2xl bg-slate-50 p-3">
                <p className="text-xs font-bold text-slate-700">
                  Unlock {payload.benefits.next.tier}
                </p>
                <ul className="mt-1 space-y-1 text-xs text-slate-500">
                  {payload.benefits.next.benefits
                    .filter((b) => !b.startsWith("Everything"))
                    .slice(0, 3)
                    .map((b) => (
                      <li key={b}>＋ {b}</li>
                    ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="rounded-3xl bg-white p-5 shadow-sm">
          <h2 className="flex items-center gap-2 font-black text-slate-950">
            <ReceiptText className="h-4 w-4" aria-hidden="true" /> Recent invoices
          </h2>
          {payload.invoices.length === 0 ? (
            <p className="py-3 text-sm text-slate-500">No invoices yet.</p>
          ) : (
            <ul className="mt-3 divide-y">
              {payload.invoices.map((invoice) => {
                const balanceMinor = Number(invoice.balance_minor ?? 0);
                const payable =
                  Boolean(invoice.pay_link) &&
                  balanceMinor > 0 &&
                  invoice.status !== "void";
                const outstanding = formatKes(balanceMinor / 100);
                return (
                  <li
                    key={invoice.id}
                    className="flex flex-wrap items-center justify-between gap-3 py-3"
                  >
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-900">{invoice.number}</p>
                      <p className="text-xs text-slate-500">
                        {formatDate(invoice.created_at)} · {invoice.status}
                        {payable && invoice.due_date
                          ? ` · due ${formatDate(invoice.due_date)}`
                          : ""}
                      </p>
                      {payable ? (
                        <p className="text-xs font-semibold text-slate-700">
                          {outstanding} outstanding
                        </p>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-3">
                      <p className="font-mono text-sm font-bold">
                        {formatKes(invoice.amount)}
                      </p>
                      {payable ? (
                        <a
                          href={invoice.pay_link as string}
                          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
                        >
                          {/* The visible word is "Pay"; the link's accessible name
                              says which invoice and how much. */}
                          <span aria-hidden="true">Pay</span>
                          <span className="sr-only">
                            {`Pay invoice ${invoice.number}, ${outstanding} outstanding`}
                          </span>
                        </a>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="rounded-3xl bg-white p-5 shadow-sm">
          <h2 className="flex items-center gap-2 font-black text-slate-950">
            <WalletCards className="h-4 w-4" /> Payment history
          </h2>
          {/* One live region for every asynchronous request outcome on this page. */}
          <p role="status" aria-live="polite" className="sr-only">
            {requestStatus}
          </p>
          {requestStatus ? (
            <p className="mt-3 rounded-2xl bg-slate-50 p-3 text-sm text-slate-700">
              {requestStatus}
            </p>
          ) : null}
          <div className="mt-3 divide-y">
            {payload.payments.length === 0 ? (
              <p className="py-3 text-sm text-slate-500">No payments yet.</p>
            ) : (
              payload.payments.map((payment) => (
                <article key={payment.id} className="py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-900">
                        {paymentFlowLabel(payment)}
                      </p>
                      <p className="text-xs text-slate-500">
                        {formatDate(payment.createdAt)}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-bold ${
                        PORTAL_PAYMENT_STATUS_STYLE[payment.status] ??
                        "bg-slate-100 text-slate-700"
                      }`}
                    >
                      {paymentStatusLabel(payment.status)}
                    </span>
                  </div>

                  <div className="mt-3 flex items-end justify-between gap-3">
                    <div>
                      <p className="font-mono text-lg font-black text-slate-950">
                        {payment.kind === "refund" ? "−" : ""}
                        {formatKes(payment.amount)}
                      </p>
                      {payment.tipAmount > 0 ? (
                        <p className="text-xs text-slate-500">
                          Bill {formatKes(payment.principalAmount)} + tip {formatKes(payment.tipAmount)}
                        </p>
                      ) : null}
                    </div>
                    <p className="max-w-[52%] break-all text-right font-mono text-[11px] text-slate-500">
                      Receipt {payment.providerRef ?? payment.reference ?? payment.sourceId ?? payment.id}
                    </p>
                  </div>

                  {payment.refundedAmount > 0 ? (
                    <p className="mt-2 rounded-xl bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-800">
                      {formatKes(payment.refundedAmount)} returned to you
                      {payment.refundReason ? ` · ${payment.refundReason}` : ""}
                    </p>
                  ) : null}
                  {payment.kind === "refund" && payment.refundOf ? (
                    <p className="mt-2 text-xs text-slate-500">
                      Refund for payment {payment.refundOf}
                      {payment.refundReason ? ` · ${payment.refundReason}` : ""}
                    </p>
                  ) : null}
                  {payment.errorMessage ? (
                    <p className="mt-2 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">
                      {payment.errorMessage}
                    </p>
                  ) : null}

                  {payment.canRequestRefund ? (
                    <button
                      type="button"
                      onClick={() =>
                        setRefundFor(
                          refundFor === payment.id ? null : payment.id,
                        )
                      }
                      aria-expanded={refundFor === payment.id}
                      aria-controls={`refund-form-${payment.id}`}
                      className="mt-2 inline-flex min-h-[44px] items-center rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700"
                    >
                      Ask the venue for a refund
                    </button>
                  ) : null}

                  {refundFor === payment.id ? (
                    <form
                      id={`refund-form-${payment.id}`}
                      onSubmit={submitRefundRequest}
                      className="mt-3 space-y-2"
                      noValidate
                    >
                      <label
                        htmlFor={`refund-reason-${payment.id}`}
                        className="block text-sm font-medium text-slate-800"
                      >
                        What went wrong?
                      </label>
                      <p
                        id={`refund-hint-${payment.id}`}
                        className="text-xs text-slate-500"
                      >
                        Only the venue can approve a refund. This sends them your
                        request — it does not return any money on its own.
                      </p>
                      <textarea
                        id={`refund-reason-${payment.id}`}
                        value={refundReason}
                        onChange={(e) => setRefundReason(e.target.value)}
                        required
                        rows={3}
                        maxLength={200}
                        aria-describedby={
                          requestError
                            ? `refund-hint-${payment.id} request-error`
                            : `refund-hint-${payment.id}`
                        }
                        aria-invalid={requestError ? true : undefined}
                        className="w-full rounded-xl border border-slate-200 p-3 text-sm"
                      />
                      <button
                        type="submit"
                        disabled={requestBusy || !refundReason.trim()}
                        className="inline-flex min-h-[44px] items-center justify-center rounded-xl px-4 py-2 text-sm font-black text-white disabled:opacity-40"
                        style={{ background: accent }}
                      >
                        Send request
                      </button>
                    </form>
                  ) : null}
                </article>
              ))
            )}
          </div>
        </div>

        {payload.redemptions.length > 0 ? (
          <div className="rounded-3xl bg-white p-5 shadow-sm">
            <h2 className="font-black text-slate-950">Recent redemptions</h2>
            <div className="mt-3 divide-y">
              {payload.redemptions.map((redemption) => (
                <div key={redemption.id} className="flex items-center justify-between gap-3 py-3">
                  <div>
                    <p className="font-semibold text-slate-900">
                      {redemption.reward_name ?? "Reward"}
                    </p>
                    <p className="text-xs text-slate-500">
                      {formatDate(redemption.created_at)} · {redemption.status}
                    </p>
                  </div>
                  <p className="font-mono text-sm font-bold">{redemption.code}</p>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {/* A5.6 — delete or correct my details. Explicit about the boundary:
            identifiers can go, financial records must stay. */}
        <div className="rounded-3xl bg-white p-5 shadow-sm">
          <h2 className="flex items-center gap-2 font-black text-slate-950">
            <ShieldCheck className="h-4 w-4" /> My data
          </h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl bg-emerald-50 p-3">
              <p className="text-xs font-black uppercase tracking-wide text-emerald-800">
                Can be deleted
              </p>
              <ul className="mt-2 space-y-1 text-xs text-emerald-900">
                <li>Your name as the venue stored it</li>
                <li>Your phone number and email address</li>
                <li>Notes and tags added to your customer record</li>
                <li>Your marketing contact preferences</li>
              </ul>
            </div>
            <div className="rounded-2xl bg-slate-50 p-3">
              <p className="text-xs font-black uppercase tracking-wide text-slate-700">
                Must be kept
              </p>
              <ul className="mt-2 space-y-1 text-xs text-slate-600">
                <li>Payments, refunds and their amounts</li>
                <li>Invoices and receipts already issued</li>
                <li>Tips paid to staff and their payouts</li>
                <li>Accounting entries and the audit trail</li>
              </ul>
              <p className="mt-2 text-[11px] text-slate-500">
                These are business records the venue must retain for accounting
                and tax. Your identity is removed from them, not the records.
              </p>
            </div>
          </div>

          <form onSubmit={submitDataRequest} className="mt-4 space-y-3" noValidate>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-slate-800">
                What would you like us to do?
              </legend>
              {(
                [
                  { id: "erasure", label: "Delete my personal details" },
                  { id: "rectification", label: "Correct my personal details" },
                ] as const
              ).map((option) => (
                <label
                  key={option.id}
                  htmlFor={`data-kind-${option.id}`}
                  className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-xl border border-slate-200 px-4 py-2 text-sm"
                >
                  <input
                    id={`data-kind-${option.id}`}
                    type="radio"
                    name="data-kind"
                    value={option.id}
                    checked={dataKind === option.id}
                    onChange={() => setDataKind(option.id)}
                    className="size-4"
                  />
                  {option.label}
                </label>
              ))}
            </fieldset>

            <label
              htmlFor="data-note"
              className="block text-sm font-medium text-slate-800"
            >
              Anything we should know?
            </label>
            <p id="data-note-hint" className="text-xs text-slate-500">
              Optional. For a correction, tell us what the right details are.
            </p>
            <textarea
              id="data-note"
              value={dataNote}
              onChange={(e) => setDataNote(e.target.value)}
              rows={3}
              maxLength={1000}
              aria-describedby={
                requestError ? "data-note-hint request-error" : "data-note-hint"
              }
              aria-invalid={requestError ? true : undefined}
              className="w-full rounded-xl border border-slate-200 p-3 text-sm"
            />

            {requestError ? (
              <p id="request-error" className="text-sm text-red-600">
                {requestError}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={requestBusy}
              className="inline-flex min-h-[44px] items-center justify-center rounded-xl px-4 py-2 text-sm font-black text-white disabled:opacity-40"
              style={{ background: accent }}
            >
              Send request
            </button>
          </form>
        </div>

        <a
          href="/enquire"
          className="block rounded-3xl px-5 py-4 text-center text-sm font-black text-white shadow-sm"
          style={{ background: accent }}
        >
          Book again
        </a>
      </section>
    </main>
  );
}
