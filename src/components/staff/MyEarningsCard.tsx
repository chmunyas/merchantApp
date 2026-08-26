import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Banknote, Check, Loader2, ShieldCheck } from "lucide-react";

import { authFetch } from "@/lib/auth";

/**
 * A server's own earnings (roadmap B4.1–B4.4).
 *
 * Everything here is scoped to the signed-in staff member: their tip ledger,
 * their payout history, their performance, and their own payout destination.
 * The account number is write-only — once saved, even the person who typed it
 * sees only the last four digits, and no manager ever sees more than that.
 */

type MyTips = {
  payoutDetails: {
    method: string;
    accountName: string;
    bankName: string | null;
    account: string;
    updatedAt: string;
    confirmedVia: string | null;
    confirmedAt: string | null;
  } | null;
  needsPayoutDetails: boolean;
  /** Whether a confirmation code can reach this staff member at all. */
  confirmation: {
    ready: boolean;
    phone: string | null;
    reason: "no-phone" | "unusable-phone" | null;
  };
  balance: { unpaid: number; held: number; paid: number };
  ledger: Array<{
    id: string;
    amount: number;
    stream: string;
    weekStart: string | null;
    payoutStatus: string | null;
    scheduledFor: string | null;
    heldReason: string | null;
  }>;
  payouts: Array<{
    id: string;
    amount: number;
    status: string;
    heldReason: string | null;
    scheduledFor: string | null;
    confirmedAt: string | null;
    createdAt: string;
  }>;
  performance: {
    windowDays: number;
    transactions: number;
    revenue: number;
    tips: number;
    tipRatePct: number;
    averageTicket: number;
    reviews: number;
    averageRating: number;
    adoptionRatePct: number | null;
    adoptionBlockedBy: string;
  };
};

function kes(minor: number): string {
  return `KES ${(Number(minor || 0) / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function day(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

export function MyEarningsCard() {
  const [data, setData] = useState<MyTips | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [editing, setEditing] = useState(false);
  // "details" collects where the money goes; "confirm" proves the person asking
  // is the person whose phone is on file.
  const [step, setStep] = useState<"details" | "confirm">("details");
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [sentVia, setSentVia] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [form, setForm] = useState({
    method: "mpesa",
    accountName: "",
    bankName: "",
    accountNumber: "",
  });

  const load = useCallback(async () => {
    try {
      const res = await authFetch("/api/tips/me");
      if (!res.ok) {
        setUnavailable(true);
        return;
      }
      const body = (await res.json()) as MyTips;
      setData(body);
      setEditing(body.needsPayoutDetails);
      setForm((current) => ({
        ...current,
        method: body.payoutDetails?.method ?? "mpesa",
        accountName: body.payoutDetails?.accountName ?? "",
        bankName: body.payoutDetails?.bankName ?? "",
        accountNumber: "",
      }));
    } catch {
      setUnavailable(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const resetFlow = useCallback(() => {
    setStep("details");
    setCode("");
    setSentTo(null);
    setSentVia(null);
    setDevCode(null);
    setError(null);
  }, []);

  // Step 1 → 2. The code goes to the number on the staff record; it is never
  // something this form can influence.
  const requestCode = useCallback(async () => {
    setSending(true);
    setError(null);
    try {
      const res = await authFetch("/api/tips/me/payout-details/challenge", {
        method: "POST",
      });
      const body = (await res.json().catch(() => ({}))) as {
        sentTo?: string;
        channel?: string | null;
        devCode?: string;
        error?: string;
      };
      if (!res.ok) {
        setError(body.error ?? "We couldn't send a confirmation code.");
        return;
      }
      setSentTo(body.sentTo ?? null);
      setSentVia(body.channel ?? null);
      setDevCode(body.devCode ?? null);
      setCode("");
      setStep("confirm");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSending(false);
    }
  }, []);

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await authFetch("/api/tips/me/payout-details", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          method: form.method,
          accountName: form.accountName,
          bankName: form.method === "bank" ? form.bankName : null,
          accountNumber: form.accountNumber,
          code,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        code?: string;
      };
      if (!res.ok) {
        setError(body.error ?? "Your details could not be saved.");
        // An expired or spent code cannot be retried — send a fresh one.
        if (body.code === "confirmation-required" || res.status === 429) {
          setStep("details");
          setCode("");
        }
        return;
      }
      setEditing(false);
      resetFlow();
      await load();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }, [form, code, load, resetFlow]);

  if (unavailable) return null;

  if (!data) {
    return (
      <section className="flex items-center gap-2 rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading your earnings…
      </section>
    );
  }

  const { balance, performance } = data;

  return (
    <section className="space-y-4 rounded-2xl border border-border bg-card p-6">
      <header className="flex items-center gap-2">
        <Banknote className="size-5 text-emerald-500" />
        <h2 className="text-lg font-semibold">My earnings</h2>
      </header>

      {/* B4.2 — held, not lost. */}
      {data.needsPayoutDetails && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-400 bg-amber-50 p-4 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 size-5 shrink-0" />
          <div>
            <p className="font-semibold">Add your payout details to get paid</p>
            <p className="mt-1">
              {balance.unpaid > 0
                ? `${kes(balance.unpaid)} is being held for you. It is safe — it will be sent as soon as you add your details.`
                : "Your tips will be held until you tell us where to send them."}
            </p>
          </div>
        </div>
      )}
      {balance.held > 0 && !data.needsPayoutDetails && (
        <div className="rounded-xl border border-amber-400 bg-amber-50 p-4 text-sm text-amber-900">
          {kes(balance.held)} is on hold. We will retry it on the next payout run.
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl bg-foreground/5 p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Awaiting payout</p>
          <p className="mt-1 text-2xl font-bold">{kes(balance.unpaid)}</p>
        </div>
        <div className="rounded-xl bg-foreground/5 p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">On hold</p>
          <p className="mt-1 text-2xl font-bold">{kes(balance.held)}</p>
        </div>
        <div className="rounded-xl bg-foreground/5 p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Paid to date</p>
          <p className="mt-1 text-2xl font-bold">{kes(balance.paid)}</p>
        </div>
      </div>

      {/* B4.1 — the staff member's own payout destination. */}
      <div className="rounded-xl border border-border p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">Where your tips are sent</p>
          {!editing && (
            <button
              type="button"
              onClick={() => {
                resetFlow();
                setEditing(true);
              }}
              className="text-xs underline"
            >
              {data.payoutDetails ? "Change" : "Add"}
            </button>
          )}
        </div>

        {!editing ? (
          data.payoutDetails ? (
            <div className="mt-2 space-y-1">
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Check className="size-4 text-emerald-500" />
                {data.payoutDetails.accountName} ·{" "}
                {data.payoutDetails.bankName ?? data.payoutDetails.method} ·{" "}
                {data.payoutDetails.account}
              </p>
              {data.payoutDetails.confirmedVia && (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <ShieldCheck className="size-3.5 text-emerald-500" />
                  Confirmed from {data.payoutDetails.confirmedVia}
                  {data.payoutDetails.confirmedAt
                    ? ` on ${day(data.payoutDetails.confirmedAt)}`
                    : ""}
                </p>
              )}
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">Nothing on file yet.</p>
          )
        ) : !data.confirmation.ready ? (
          // Deliberately not self-serviceable: if staff could supply the number,
          // proving control of it would prove nothing.
          <div className="mt-3 flex items-start gap-3 rounded-xl border border-amber-400 bg-amber-50 p-4 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 size-5 shrink-0" />
            <div>
              <p className="font-semibold">
                Your manager needs to add your phone number first
              </p>
              <p className="mt-1">
                {data.confirmation.reason === "no-phone"
                  ? "There's no phone number on your staff record."
                  : "The phone number on your staff record isn't a valid mobile number."}{" "}
                We send a confirmation code there before changing where your money
                goes — so you can't set this up until it's correct.
              </p>
            </div>
          </div>
        ) : step === "details" ? (
          <div className="mt-3 space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm">
                <span className="text-xs text-muted-foreground">Send to</span>
                <select
                  value={form.method}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, method: event.target.value }))
                  }
                  className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2"
                >
                  <option value="mpesa">M-Pesa</option>
                  <option value="bank">Bank account</option>
                </select>
              </label>
              <label className="text-sm">
                <span className="text-xs text-muted-foreground">Account holder</span>
                <input
                  value={form.accountName}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, accountName: event.target.value }))
                  }
                  className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2"
                />
              </label>
              {form.method === "bank" && (
                <label className="text-sm">
                  <span className="text-xs text-muted-foreground">Bank</span>
                  <input
                    value={form.bankName}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, bankName: event.target.value }))
                    }
                    className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2"
                  />
                </label>
              )}
              <label className="text-sm">
                <span className="text-xs text-muted-foreground">
                  {form.method === "bank" ? "Account number" : "M-Pesa number"}
                </span>
                <input
                  value={form.accountNumber}
                  autoComplete="off"
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      accountNumber: event.target.value,
                    }))
                  }
                  className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2"
                />
              </label>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <p className="text-xs text-muted-foreground">
              Stored encrypted. After saving, only the last four digits are ever shown —
              to you or to your manager. We'll send a code to{" "}
              {data.confirmation.phone} to confirm it's really you.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={sending || !form.accountName.trim() || !form.accountNumber.trim()}
                onClick={() => void requestCode()}
                className="rounded-xl bg-foreground px-4 py-2 text-sm font-semibold text-background disabled:opacity-50"
              >
                {sending ? "Sending code…" : "Continue"}
              </button>
              {data.payoutDetails && (
                <button
                  type="button"
                  onClick={() => {
                    setEditing(false);
                    resetFlow();
                  }}
                  className="rounded-xl border border-border px-4 py-2 text-sm"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="mt-3 space-y-3">
            <div className="flex items-start gap-3 rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900">
              <ShieldCheck className="mt-0.5 size-5 shrink-0" />
              <div>
                <p className="font-semibold">
                  Enter the code we sent to {sentTo}
                </p>
                <p className="mt-1">
                  {sentVia === "sms" ? "Sent by SMS" : "Sent on WhatsApp"} · expires in
                  10 minutes. If you didn't ask for this, tell your manager — someone
                  may have your login.
                </p>
              </div>
            </div>
            <label className="block text-sm">
              <span className="text-xs text-muted-foreground">6-digit code</span>
              <input
                value={code}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                onChange={(event) =>
                  setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
                }
                className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-center font-mono text-2xl tracking-[0.4em]"
              />
            </label>
            {devCode && (
              <p className="rounded-lg bg-foreground/5 px-3 py-2 text-xs text-muted-foreground">
                Dev only — code is <span className="font-mono">{devCode}</span>
              </p>
            )}
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={saving || code.length !== 6}
                onClick={() => void save()}
                className="rounded-xl bg-foreground px-4 py-2 text-sm font-semibold text-background disabled:opacity-50"
              >
                {saving ? "Confirming…" : "Confirm and save"}
              </button>
              <button
                type="button"
                disabled={sending}
                onClick={() => void requestCode()}
                className="rounded-xl border border-border px-4 py-2 text-sm disabled:opacity-50"
              >
                {sending ? "Sending…" : "Resend code"}
              </button>
              <button
                type="button"
                onClick={resetFlow}
                className="rounded-xl px-4 py-2 text-sm text-muted-foreground underline"
              >
                Back
              </button>
            </div>
          </div>
        )}
      </div>

      {/* B4.4 — personal performance. */}
      <div className="rounded-xl border border-border p-4">
        <p className="text-sm font-semibold">
          My last {performance.windowDays} days
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <p className="text-xs text-muted-foreground">Tip rate</p>
            <p className="text-lg font-semibold">{performance.tipRatePct}%</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Revenue</p>
            <p className="text-lg font-semibold">{kes(performance.revenue)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Average bill</p>
            <p className="text-lg font-semibold">{kes(performance.averageTicket)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Reviews</p>
            <p className="text-lg font-semibold">
              {performance.reviews > 0
                ? `${performance.averageRating}★ (${performance.reviews})`
                : "—"}
            </p>
          </div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Adoption rate needs the POS connection and is not available yet.
        </p>
      </div>

      {/* B4.3 — ledger + payout history. */}
      <div className="rounded-xl border border-border p-4">
        <p className="text-sm font-semibold">Tip ledger</p>
        {data.ledger.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No allocations yet.</p>
        ) : (
          <table className="mt-2 w-full text-sm">
            <tbody>
              {data.ledger.slice(0, 12).map((row) => (
                <tr key={row.id} className="border-t border-border">
                  <td className="py-1">{day(row.weekStart)}</td>
                  <td className="capitalize text-muted-foreground">{row.stream}</td>
                  <td className="text-muted-foreground">
                    {row.payoutStatus === "held"
                      ? "held"
                      : (row.payoutStatus ?? "awaiting payout")}
                  </td>
                  <td className="text-right font-medium">{kes(row.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <p className="mt-4 text-sm font-semibold">Payouts</p>
        {data.payouts.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Nothing paid out yet.</p>
        ) : (
          <table className="mt-2 w-full text-sm">
            <tbody>
              {data.payouts.slice(0, 8).map((row) => (
                <tr key={row.id} className="border-t border-border">
                  <td className="py-1">{day(row.scheduledFor ?? row.createdAt)}</td>
                  <td className="text-muted-foreground">{row.status}</td>
                  <td className="text-right font-medium">{kes(row.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
