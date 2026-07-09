import { useState } from "react";
import { Lock, Pencil, QrCode } from "lucide-react";

import type { Invoice } from "./types";
import {
  FX_RATES,
  generateInstallments,
  lockFxRate,
  nextRecurringDate,
  shiftTimestamp,
} from "./utils";

export function InvoiceCreator({
  onCreate,
  initialInvoice,
  mode = "create",
  onCancel,
}: {
  onCreate: (i: Invoice) => void;
  initialInvoice?: Invoice;
  mode?: "create" | "edit";
  onCancel?: () => void;
}) {
  const [customer, setCustomer] = useState(initialInvoice?.customer ?? "");
  const [amount, setAmount] = useState(
    initialInvoice ? String(initialInvoice.amount) : "",
  );
  const [currency, setCurrency] = useState(initialInvoice?.currency ?? "USD");
  const [note, setNote] = useState(initialInvoice?.note ?? "");
  const [isRecurring, setIsRecurring] = useState(
    Boolean(initialInvoice?.recurring),
  );
  const [frequency, setFrequency] = useState(
    initialInvoice?.recurring?.frequency ?? "Monthly",
  );
  const [hasInstallments, setHasInstallments] = useState(
    Boolean(initialInvoice?.installmentPlan),
  );
  const [installmentCount, setInstallmentCount] = useState(
    initialInvoice?.installmentPlan?.count ?? 3,
  );
  const [installmentFreq, setInstallmentFreq] = useState<
    "Weekly" | "Bi-weekly" | "Monthly"
  >(initialInvoice?.installmentPlan?.frequency ?? "Monthly");
  const [lockFx, setLockFx] = useState(Boolean(initialInvoice?.fxLock));
  const [lockHours, setLockHours] = useState(48);
  const [lockTo, setLockTo] = useState("USD");
  const [deliveryChannel, setDeliveryChannel] = useState<
    Invoice["deliveryChannel"]
  >(initialInvoice?.deliveryChannel ?? "link");
  const [customerPhone, setCustomerPhone] = useState(
    initialInvoice?.customerPhone ?? "",
  );

  const valid = customer.trim().length > 0 && Number(amount) > 0;
  const recurring = isRecurring
    ? {
        frequency,
        nextDate:
          initialInvoice?.recurring?.frequency === frequency
            ? initialInvoice.recurring.nextDate
            : nextRecurringDate(frequency),
      }
    : undefined;

  return (
    <div className="px-5 pt-3 space-y-4">
      <div>
        <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
          {mode === "edit" ? "Edit invoice" : "New invoice"}
        </p>
        <h1 className="text-lg font-bold">
          {mode === "edit" ? "Update payment request" : "Request a payment"}
        </h1>
      </div>

      <div className="space-y-3">
        <Field label="Customer">
          <input
            value={customer}
            onChange={(e) => setCustomer(e.target.value)}
            placeholder="Acme Ltd."
            className="w-full bg-transparent text-sm font-medium outline-none"
          />
        </Field>

        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <Field label="Amount">
              <input
                value={amount}
                onChange={(e) =>
                  setAmount(e.target.value.replace(/[^0-9.]/g, ""))
                }
                placeholder="0.00"
                inputMode="decimal"
                className="w-full bg-transparent text-2xl font-bold font-mono outline-none"
              />
            </Field>
          </div>
          <Field label="Currency">
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="w-full bg-transparent text-sm font-bold font-mono outline-none"
            >
              {["USD", "EUR", "GBP", "NGN", "KES"].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Note (optional)">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Design retainer - Oct"
            className="w-full bg-transparent text-sm outline-none"
          />
        </Field>

        <div className="rounded-xl border border-border bg-card p-3 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">
                Recurring
              </p>
              <p className="text-xs font-medium">
                Repeat this invoice automatically
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsRecurring((value) => !value)}
              className={`relative h-7 w-12 rounded-full transition-colors ${
                isRecurring ? "bg-foreground" : "bg-muted"
              }`}
            >
              <span
                className={`absolute top-1 size-5 rounded-full bg-background transition-all ${
                  isRecurring ? "left-6" : "left-1"
                }`}
              />
            </button>
          </div>
          {isRecurring && (
            <div className="grid grid-cols-3 gap-2">
              {(["Weekly", "Bi-weekly", "Monthly"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setFrequency(option)}
                  className={`rounded-xl border px-2 py-2 text-[10px] font-mono uppercase tracking-widest transition-colors ${
                    frequency === option
                      ? "border-foreground bg-foreground text-background"
                      : "border-border text-muted-foreground"
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-border bg-card p-3 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">
                Installments
              </p>
              <p className="text-xs font-medium">
                Split into multiple payments
              </p>
            </div>
            <button
              type="button"
              onClick={() => setHasInstallments((v) => !v)}
              className={`relative h-7 w-12 rounded-full transition-colors ${
                hasInstallments ? "bg-foreground" : "bg-muted"
              }`}
            >
              <span
                className={`absolute top-1 size-5 rounded-full bg-background transition-all ${
                  hasInstallments ? "left-6" : "left-1"
                }`}
              />
            </button>
          </div>
          {hasInstallments && (
            <div className="space-y-2">
              <div className="grid grid-cols-4 gap-2">
                {[2, 3, 4, 6].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setInstallmentCount(n)}
                    className={`rounded-xl border px-2 py-2 text-[10px] font-mono uppercase tracking-widest transition-colors ${
                      installmentCount === n
                        ? "border-foreground bg-foreground text-background"
                        : "border-border text-muted-foreground"
                    }`}
                  >
                    {n}×
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-3 gap-2">
                {(["Weekly", "Bi-weekly", "Monthly"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setInstallmentFreq(option)}
                    className={`rounded-xl border px-2 py-2 text-[10px] font-mono uppercase tracking-widest transition-colors ${
                      installmentFreq === option
                        ? "border-foreground bg-foreground text-background"
                        : "border-border text-muted-foreground"
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>
              {Number(amount) > 0 && (
                <p className="text-[10px] text-muted-foreground text-center font-mono">
                  {installmentCount} payments of {currency}{" "}
                  {Math.round(
                    ((Number(amount) / installmentCount) * 100) / 100,
                  ).toLocaleString()}{" "}
                  each
                </p>
              )}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-border bg-card p-3 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">
                FX Rate Lock
              </p>
              <p className="text-xs font-medium">Guarantee rate for customer</p>
            </div>
            <button
              type="button"
              onClick={() => setLockFx((v) => !v)}
              className={`relative h-7 w-12 rounded-full transition-colors ${
                lockFx ? "bg-foreground" : "bg-muted"
              }`}
            >
              <span
                className={`absolute top-1 size-5 rounded-full bg-background transition-all ${
                  lockFx ? "left-6" : "left-1"
                }`}
              />
            </button>
          </div>
          {lockFx && (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg border border-border px-2 py-1.5">
                  <p className="text-[8px] font-mono uppercase text-muted-foreground">
                    Settle to
                  </p>
                  <select
                    value={lockTo}
                    onChange={(e) => setLockTo(e.target.value)}
                    className="w-full bg-transparent text-xs font-bold font-mono outline-none"
                  >
                    {["USD", "EUR", "GBP"]
                      .filter((c) => c !== currency)
                      .map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                  </select>
                </div>
                <div className="rounded-lg border border-border px-2 py-1.5">
                  <p className="text-[8px] font-mono uppercase text-muted-foreground">
                    Lock duration
                  </p>
                  <select
                    value={lockHours}
                    onChange={(e) => setLockHours(Number(e.target.value))}
                    className="w-full bg-transparent text-xs font-bold font-mono outline-none"
                  >
                    <option value={24}>24 hours</option>
                    <option value={48}>48 hours</option>
                    <option value={72}>72 hours</option>
                  </select>
                </div>
              </div>
              {Number(amount) > 0 && currency !== lockTo && (
                <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 flex items-center gap-2">
                  <Lock className="size-3.5 text-emerald-600" />
                  <p className="text-[10px] font-mono text-emerald-700">
                    Locked: 1 {currency} ={" "}
                    {(FX_RATES[currency]?.[lockTo] ?? 1).toFixed(4)} {lockTo} ·
                    receives {lockTo}{" "}
                    {(
                      Number(amount) * (FX_RATES[currency]?.[lockTo] ?? 1)
                    ).toFixed(2)}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-border bg-card p-3 space-y-3">
          <div>
            <p className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">
              Delivery channel
            </p>
            <p className="text-xs font-medium">How to send the invoice</p>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {[
              { id: "link" as const, icon: "🔗", label: "Link" },
              { id: "whatsapp" as const, icon: "💬", label: "WhatsApp" },
              { id: "sms" as const, icon: "📱", label: "SMS" },
              { id: "email" as const, icon: "✉️", label: "Email" },
            ].map((ch) => (
              <button
                key={ch.id}
                type="button"
                onClick={() => setDeliveryChannel(ch.id)}
                className={`rounded-xl border px-1 py-2.5 text-center transition-colors ${
                  deliveryChannel === ch.id
                    ? "border-foreground bg-foreground text-background"
                    : "border-border text-muted-foreground"
                }`}
              >
                <span className="text-sm block">{ch.icon}</span>
                <span className="text-[9px] font-mono uppercase tracking-widest">
                  {ch.label}
                </span>
              </button>
            ))}
          </div>
          {(deliveryChannel === "whatsapp" || deliveryChannel === "sms") && (
            <div className="rounded-lg border border-border px-3 py-2">
              <p className="text-[8px] font-mono uppercase text-muted-foreground">
                Phone number
              </p>
              <input
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                placeholder="+254 7XX XXX XXX"
                className="w-full bg-transparent text-sm font-mono outline-none mt-0.5"
              />
            </div>
          )}
        </div>

        <div className="rounded-xl bg-muted p-3 flex justify-between text-[11px]">
          <span className="text-muted-foreground">FX routing</span>
          <span className="font-mono font-semibold">
            {lockFx ? `Locked · ${lockHours}h` : "Best rate · Coop Bank Kenya"}
          </span>
        </div>
        <div className="rounded-xl bg-muted p-3 flex justify-between text-[11px]">
          <span className="text-muted-foreground">Settles to</span>
          <span className="font-mono font-semibold">
            {lockFx ? `${lockTo} wallet` : "USD wallet"}
          </span>
        </div>
      </div>

      <div
        className={`grid gap-2 ${mode === "edit" ? "grid-cols-2" : "grid-cols-1"}`}
      >
        {mode === "edit" && onCancel && (
          <button
            onClick={onCancel}
            className="w-full border border-border py-3.5 rounded-xl text-sm font-semibold"
          >
            Cancel
          </button>
        )}
        <button
          disabled={!valid}
          onClick={() =>
            onCreate({
              id:
                initialInvoice?.id ??
                `INV-${Math.floor(10000 + Math.random() * 89999)}`,
              customer: customer.trim(),
              amount: Number(amount),
              currency,
              note: note.trim() || undefined,
              status: initialInvoice?.status ?? "Pending",
              date: initialInvoice?.date ?? "Today",
              paidAt: initialInvoice?.paidAt,
              paidVia: initialInvoice?.paidVia,
              recurring,
              installmentPlan: hasInstallments
                ? {
                    count: installmentCount,
                    frequency: installmentFreq,
                    installments: generateInstallments(
                      Number(amount),
                      installmentCount,
                      installmentFreq,
                    ),
                  }
                : undefined,
              fxLock:
                lockFx && currency !== lockTo
                  ? lockFxRate(currency, lockTo, lockHours)
                  : undefined,
              deliveryChannel,
              customerPhone: customerPhone.trim() || undefined,
              lastReminder: initialInvoice?.lastReminder,
              timeline: initialInvoice?.timeline ?? [
                { label: "Created", at: new Date().toISOString() },
                ...(lockFx
                  ? [
                      {
                        label: `FX rate locked · ${lockHours}h`,
                        at: shiftTimestamp(new Date(), 1),
                      },
                    ]
                  : []),
                {
                  label:
                    deliveryChannel === "whatsapp"
                      ? "Sent via WhatsApp"
                      : deliveryChannel === "sms"
                        ? "Sent via SMS"
                        : "QR shared",
                  at: shiftTimestamp(new Date(), 12),
                },
              ],
            })
          }
          className="w-full bg-foreground text-background py-3.5 rounded-xl text-sm font-semibold disabled:opacity-40 flex items-center justify-center gap-2"
        >
          {mode === "edit" ? (
            <Pencil className="size-4" />
          ) : (
            <QrCode className="size-4" />
          )}
          {mode === "edit" ? "Save changes" : "Generate QR invoice"}
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2">
      <p className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
      {children}
    </div>
  );
}
