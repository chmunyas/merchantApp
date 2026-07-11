import { createFileRoute } from "@tanstack/react-router";
import {
  Bell,
  Check,
  Plus,
  Receipt,
  Repeat,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { buildKeQr, resolveKeQrMerchant } from "@/lib/ke-qr";
import {
  getCurrentVenueId,
  MERCHANT_NAME,
  TILL_NUMBER,
} from "@/lib/merchant-dashboard";
import { authFetch } from "@/lib/auth";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/invoices")({
  component: InvoicesPage,
});

type LineItem = { description: string; qty: number; price: number };

type Invoice = {
  id: string;
  number: string;
  customer_name: string | null;
  phone: string | null;
  amount: string | number;
  currency: string;
  description: string | null;
  display_status: string;
  channel: string | null;
  pay_link: string | null;
  due_date: string | null;
  amount_paid: string | number;
  balance: string | number;
  paid_ref?: string | null;
  reminder_count: number;
  created_at: string;
};

type Recurring = {
  id: string;
  customer_name: string | null;
  phone: string | null;
  amount: string | number;
  currency: string;
  description: string | null;
  cadence: string;
  next_run_at: string;
  active: boolean;
  auto_send: boolean;
};

type Stats = {
  outstanding: string | number;
  overdue: string | number;
  collected: string | number;
  open_count: number;
  paid_count: number;
  draft_count: number;
};

type ActivityEvent = {
  type: string;
  detail: string | null;
  amount: string | number | null;
  channel: string | null;
  delivery: string | null;
  created_at: string;
};

const STATUS_STYLES: Record<string, string> = {
  paid: "bg-emerald-100 text-emerald-700",
  partial: "bg-amber-100 text-amber-700",
  sent: "bg-blue-100 text-blue-700",
  overdue: "bg-red-100 text-red-700",
  draft: "bg-slate-200 text-slate-700",
  void: "bg-slate-300 text-slate-500",
};

const money = (value: string | number, currency = "KES") =>
  `${currency} ${Number(value).toLocaleString()}`;

function absoluteLink(link: string | null): string {
  if (!link) return "";
  if (link.startsWith("http")) return link;
  if (typeof window !== "undefined") return `${window.location.origin}${link}`;
  return link;
}

function InvoicesPage() {
  const venue = useMemo(() => getCurrentVenueId(), []);
  const [tab, setTab] = useState<"invoices" | "recurring">("invoices");
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [recurring, setRecurring] = useState<Recurring[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState<{
    number: string;
    events: ActivityEvent[];
  } | null>(null);

  // Invoice form
  const [customerName, setCustomerName] = useState("");
  const [phone, setPhone] = useState("");
  const [channel, setChannel] = useState("whatsapp");
  const [dueDate, setDueDate] = useState("");
  const [taxRate, setTaxRate] = useState("0");
  const [items, setItems] = useState<LineItem[]>([
    { description: "", qty: 1, price: 0 },
  ]);

  // Recurring form
  const [rName, setRName] = useState("");
  const [rPhone, setRPhone] = useState("");
  const [rAmount, setRAmount] = useState("");
  const [rCadence, setRCadence] = useState("monthly");
  const [rAutoSend, setRAutoSend] = useState(true);

  async function loadAll() {
    try {
      const [inv, st, rec] = await Promise.all([
        authFetch(`/api/invoices?venue=${venue}`).then((r) => r.json()),
        authFetch(`/api/invoices/stats?venue=${venue}`).then((r) => r.json()),
        authFetch(`/api/recurring?venue=${venue}`).then((r) => r.json()),
      ]);
      setInvoices((inv as { invoices?: Invoice[] }).invoices ?? []);
      setStats(st as Stats);
      setRecurring((rec as { schedules?: Recurring[] }).schedules ?? []);
    } catch {
      /* offline */
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venue]);

  const subtotal = items.reduce((s, i) => s + Number(i.qty) * Number(i.price), 0);
  const taxAmount = Math.round((subtotal * Number(taxRate || 0)) / 100);
  const total = subtotal + taxAmount;

  function updateItem(index: number, patch: Partial<LineItem>) {
    setItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    );
  }

  async function createInvoice() {
    const cleanItems = items.filter((i) => i.description.trim() && i.price > 0);
    if (cleanItems.length === 0) {
      toast.error("Add at least one line item with a price.");
      return;
    }
    setBusy(true);
    try {
      const res = await authFetch(`/api/invoices?venue=${venue}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          customerName,
          phone,
          channel: phone ? channel : undefined,
          dueDate: dueDate || undefined,
          taxRate: Number(taxRate || 0),
          lineItems: cleanItems,
          amount: total,
        }),
      });
      if (!res.ok) throw new Error("failed");
      const data = (await res.json()) as { number?: string; delivery?: string };
      toast.success(
        `Invoice ${data.number} created${
          data.delivery && data.delivery !== "none" ? ` · ${data.delivery}` : ""
        }.`,
      );
      setCustomerName("");
      setPhone("");
      setDueDate("");
      setTaxRate("0");
      setItems([{ description: "", qty: 1, price: 0 }]);
      await loadAll();
    } catch {
      toast.error("Could not create invoice (cloud backend offline).");
    } finally {
      setBusy(false);
    }
  }

  async function invoiceAction(id: string, action: string, body?: unknown) {
    try {
      const res = await authFetch(`/api/invoices/${id}/${action}?venue=${venue}`, {
        method: "POST",
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) throw new Error("failed");
      await loadAll();
      return true;
    } catch {
      toast.error("Action failed.");
      return false;
    }
  }

  async function recordPayment(inv: Invoice) {
    const input = window.prompt(
      `Record a payment for ${inv.number} (balance ${money(inv.balance, inv.currency)}):`,
      String(inv.balance),
    );
    if (!input) return;
    const amount = Number(input);
    if (!amount || amount <= 0) return;
    if (await invoiceAction(inv.id, "pay", { amount })) {
      toast.success("Payment recorded.");
    }
  }

  async function remind(inv: Invoice) {
    if (!inv.phone) {
      toast.error("No recipient phone on this invoice.");
      return;
    }
    if (await invoiceAction(inv.id, "remind")) toast.success("Reminder sent.");
  }

  async function openActivity(inv: Invoice) {
    try {
      const res = await authFetch(`/api/invoices/${inv.id}/activity?venue=${venue}`);
      const data = (await res.json()) as { events?: ActivityEvent[] };
      setActivity({ number: inv.number, events: data.events ?? [] });
    } catch {
      toast.error("Could not load activity.");
    }
  }

  async function createRecurring() {
    if (!rAmount || Number(rAmount) <= 0) {
      toast.error("Enter an amount.");
      return;
    }
    setBusy(true);
    try {
      const res = await authFetch(`/api/recurring?venue=${venue}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          customerName: rName,
          phone: rPhone,
          amount: Number(rAmount),
          cadence: rCadence,
          autoSend: rAutoSend,
          startNow: false,
        }),
      });
      if (!res.ok) throw new Error("failed");
      toast.success("Recurring invoice scheduled.");
      setRName("");
      setRPhone("");
      setRAmount("");
      await loadAll();
    } catch {
      toast.error("Could not schedule.");
    } finally {
      setBusy(false);
    }
  }

  async function runNow() {
    try {
      const res = await fetch(`/api/invoicing/run?venue=${venue}`, {
        method: "POST",
      });
      const data = (await res.json()) as {
        remindersSent?: number;
        recurringGenerated?: number;
      };
      toast.success(
        `Ran: ${data.recurringGenerated ?? 0} generated, ${data.remindersSent ?? 0} reminders.`,
      );
      await loadAll();
    } catch {
      toast.error("Run failed.");
    }
  }

  const statCards = stats
    ? [
        { label: "Outstanding", value: money(stats.outstanding), tone: "text-slate-900" },
        { label: "Overdue", value: money(stats.overdue), tone: "text-red-600" },
        { label: "Collected", value: money(stats.collected), tone: "text-emerald-600" },
        {
          label: "Open / Paid / Draft",
          value: `${stats.open_count} / ${stats.paid_count} / ${stats.draft_count}`,
          tone: "text-slate-900",
        },
      ]
    : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">Invoicing</h2>
          <p className="text-sm text-muted-foreground">
            Send invoices over WhatsApp &amp; other channels, track delivery,
            auto-chase payments, and run recurring billing.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={runNow} className="gap-1">
          <Bell className="h-3.5 w-3.5" /> Run reminders &amp; recurring
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {statCards.map((card) => (
          <div
            key={card.label}
            className="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm"
          >
            <p className="text-xs text-muted-foreground">{card.label}</p>
            <p className={cn("mt-1 text-xl font-bold", card.tone)}>{card.value}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-2 rounded-2xl bg-slate-100 p-1">
        {(["invoices", "recurring"] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              "flex items-center gap-1 rounded-2xl px-4 py-2 text-sm font-medium capitalize transition",
              tab === key
                ? "bg-white text-slate-950 shadow-sm"
                : "text-slate-500 hover:text-slate-800",
            )}
          >
            {key === "invoices" ? (
              <Receipt className="h-3.5 w-3.5" />
            ) : (
              <Repeat className="h-3.5 w-3.5" />
            )}
            {key}
          </button>
        ))}
      </div>

      {tab === "invoices" ? (
        <>
          <Card className="border-slate-200 bg-white/90 shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">New invoice</CardTitle>
              <CardDescription>
                Add line items; add a phone to deliver the pay link on a channel.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Input
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Customer"
                />
                <Input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+2547… (optional)"
                />
                <select
                  value={channel}
                  onChange={(e) => setChannel(e.target.value)}
                  className="h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-sm"
                >
                  <option value="whatsapp">WhatsApp</option>
                  <option value="sms">SMS</option>
                  <option value="telegram">Telegram</option>
                </select>
                <Input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  placeholder="Due date"
                />
              </div>

              <div className="space-y-2">
                {items.map((item, index) => (
                  <div
                    key={index}
                    className="grid gap-2 sm:grid-cols-[1fr_80px_120px_auto]"
                  >
                    <Input
                      value={item.description}
                      onChange={(e) =>
                        updateItem(index, { description: e.target.value })
                      }
                      placeholder="Item description"
                    />
                    <Input
                      type="number"
                      value={item.qty}
                      onChange={(e) =>
                        updateItem(index, { qty: Number(e.target.value) })
                      }
                      placeholder="Qty"
                    />
                    <Input
                      type="number"
                      value={item.price}
                      onChange={(e) =>
                        updateItem(index, { price: Number(e.target.value) })
                      }
                      placeholder="Unit price"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 text-slate-400 hover:text-red-500"
                      onClick={() =>
                        setItems((prev) =>
                          prev.length > 1
                            ? prev.filter((_, i) => i !== index)
                            : prev,
                        )
                      }
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="gap-1"
                  onClick={() =>
                    setItems((prev) => [
                      ...prev,
                      { description: "", qty: 1, price: 0 },
                    ])
                  }
                >
                  <Plus className="h-3.5 w-3.5" /> Add line
                </Button>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">Tax %</span>
                  <Input
                    type="number"
                    value={taxRate}
                    onChange={(e) => setTaxRate(e.target.value)}
                    className="h-8 w-20"
                  />
                  <span className="text-muted-foreground">
                    Subtotal {money(subtotal)} · Tax {money(taxAmount)}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-lg font-bold text-slate-900">
                    Total {money(total)}
                  </span>
                  <Button type="button" onClick={createInvoice} disabled={busy}>
                    <Send className="mr-1 h-3.5 w-3.5" /> Create &amp; send
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-3">
            {invoices.length === 0 ? (
              <Card className="border-dashed border-slate-300 bg-white/60">
                <CardContent className="p-6 text-center text-sm text-slate-500">
                  No invoices yet.
                </CardContent>
              </Card>
            ) : (
              invoices.map((invoice) => (
                <Card
                  key={invoice.id}
                  className="border-slate-200 bg-white/90 shadow-sm"
                >
                  <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4">
                    <div className="flex items-center gap-4">
                      {invoice.pay_link && (
                        <div className="rounded-lg bg-white p-1.5 ring-1 ring-slate-100">
                          <QRCodeSVG
                            value={
                              invoice.currency === "KES"
                                ? buildKeQr(
                                    resolveKeQrMerchant({
                                      name: MERCHANT_NAME,
                                      merchantId: TILL_NUMBER,
                                    }),
                                    {
                                      amountMinor: Math.round(
                                        Number(invoice.amount) * 100,
                                      ),
                                      reference: invoice.number,
                                    },
                                  )
                                : absoluteLink(invoice.pay_link)
                            }
                            size={56}
                          />
                        </div>
                      )}
                      <div>
                        <p className="font-mono text-sm font-semibold text-slate-950">
                          {invoice.number}
                        </p>
                        <p className="text-lg font-bold text-slate-900">
                          {money(invoice.amount, invoice.currency)}
                          {Number(invoice.balance) > 0 &&
                            Number(invoice.balance) < Number(invoice.amount) && (
                              <span className="ml-2 text-xs font-normal text-amber-600">
                                {money(invoice.balance, invoice.currency)} due
                              </span>
                            )}
                        </p>
                        <p className="text-xs text-slate-500">
                          {invoice.customer_name ?? "—"}
                          {invoice.phone ? ` · ${invoice.phone}` : ""}
                          {invoice.due_date ? ` · due ${invoice.due_date}` : ""}
                          {invoice.reminder_count > 0
                            ? ` · ${invoice.reminder_count} reminder(s)`
                            : ""}
                          {invoice.paid_ref ? ` · REF ${invoice.paid_ref}` : ""}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        className={cn(
                          "capitalize",
                          STATUS_STYLES[invoice.display_status] ??
                            "bg-slate-100 text-slate-600",
                        )}
                      >
                        {invoice.display_status}
                      </Badge>
                      {invoice.display_status !== "paid" &&
                        invoice.display_status !== "void" && (
                          <>
                            {invoice.phone && (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="gap-1"
                                onClick={() => remind(invoice)}
                              >
                                <Bell className="h-3.5 w-3.5" /> Remind
                              </Button>
                            )}
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => recordPayment(invoice)}
                            >
                              Record payment
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="gap-1"
                              onClick={() => invoiceAction(invoice.id, "paid")}
                            >
                              <Check className="h-3.5 w-3.5" /> Paid
                            </Button>
                          </>
                        )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => openActivity(invoice)}
                      >
                        Activity
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </>
      ) : (
        <>
          <Card className="border-slate-200 bg-white/90 shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">New recurring invoice</CardTitle>
              <CardDescription>
                Auto-generate and send invoices on a schedule (subscriptions,
                retainers). The bridge runs these 24/7.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <Input
                  value={rName}
                  onChange={(e) => setRName(e.target.value)}
                  placeholder="Customer"
                />
                <Input
                  value={rPhone}
                  onChange={(e) => setRPhone(e.target.value)}
                  placeholder="+2547…"
                />
                <Input
                  type="number"
                  value={rAmount}
                  onChange={(e) => setRAmount(e.target.value)}
                  placeholder="Amount"
                />
                <select
                  value={rCadence}
                  onChange={(e) => setRCadence(e.target.value)}
                  className="h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-sm"
                >
                  <option value="monthly">Monthly</option>
                  <option value="weekly">Weekly</option>
                </select>
                <Button type="button" onClick={createRecurring} disabled={busy}>
                  Schedule
                </Button>
              </div>
              <label className="mt-3 flex items-center gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={rAutoSend}
                  onChange={(e) => setRAutoSend(e.target.checked)}
                />
                Auto-send each generated invoice on WhatsApp
              </label>
            </CardContent>
          </Card>

          <div className="space-y-3">
            {recurring.length === 0 ? (
              <Card className="border-dashed border-slate-300 bg-white/60">
                <CardContent className="p-6 text-center text-sm text-slate-500">
                  No recurring schedules yet.
                </CardContent>
              </Card>
            ) : (
              recurring.map((schedule) => (
                <Card
                  key={schedule.id}
                  className="border-slate-200 bg-white/90 shadow-sm"
                >
                  <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                    <div>
                      <p className="font-medium text-slate-950">
                        {money(schedule.amount, schedule.currency)} ·{" "}
                        <span className="capitalize">{schedule.cadence}</span>
                      </p>
                      <p className="text-xs text-slate-500">
                        {schedule.customer_name ?? "—"}
                        {schedule.phone ? ` · ${schedule.phone}` : ""} · next{" "}
                        {new Date(schedule.next_run_at).toLocaleDateString()}
                        {schedule.auto_send ? " · auto-send" : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge
                        className={
                          schedule.active
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-slate-200 text-slate-600"
                        }
                      >
                        {schedule.active ? "Active" : "Paused"}
                      </Badge>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={async () => {
                          await authFetch(
                            `/api/recurring/${schedule.id}/toggle?venue=${venue}`,
                            { method: "POST" },
                          );
                          await loadAll();
                        }}
                      >
                        {schedule.active ? "Pause" : "Resume"}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-slate-400 hover:text-red-500"
                        onClick={async () => {
                          await authFetch(
                            `/api/recurring/${schedule.id}?venue=${venue}`,
                            { method: "DELETE" },
                          );
                          await loadAll();
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </>
      )}

      {activity && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setActivity(null)}
        >
          <div
            className="flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <p className="text-sm font-semibold">
                Activity · {activity.number}
              </p>
              <button
                type="button"
                onClick={() => setActivity(null)}
                className="rounded-full p-1 hover:bg-slate-100"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto p-4">
              {activity.events.length === 0 ? (
                <p className="text-center text-sm text-slate-400">
                  No activity yet.
                </p>
              ) : (
                activity.events.map((event, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm"
                  >
                    <div>
                      <span className="font-medium capitalize text-slate-900">
                        {event.type}
                      </span>
                      {event.detail ? (
                        <span className="text-slate-500"> — {event.detail}</span>
                      ) : null}
                      {event.delivery ? (
                        <span className="ml-1 text-[10px] text-slate-400">
                          [{event.delivery}]
                        </span>
                      ) : null}
                    </div>
                    <span className="shrink-0 text-[10px] text-slate-400">
                      {new Date(event.created_at).toLocaleString()}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
