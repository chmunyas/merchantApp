import { useMemo } from "react";
import {
  AlertTriangle,
  BarChart3,
  Brain,
  TrendingUp,
  Users,
} from "lucide-react";

import type {
  ChaseStep,
  CustomerScore,
  Invoice,
  PaymentPrediction,
} from "./types";

const CHASE_SEQUENCE: ChaseStep[] = [
  { day: 1, tone: "gentle", label: "Friendly reminder" },
  { day: 7, tone: "firm", label: "Follow-up notice" },
  { day: 14, tone: "urgent", label: "Urgent: payment overdue" },
  { day: 21, tone: "final", label: "Final notice before escalation" },
];

function computeCustomerScores(invoices: Invoice[]): CustomerScore[] {
  const customers = new Map<
    string,
    { paid: number[]; total: number; revenue: number; onTime: number }
  >();

  invoices.forEach((inv) => {
    if (!customers.has(inv.customer)) {
      customers.set(inv.customer, {
        paid: [],
        total: 0,
        revenue: 0,
        onTime: 0,
      });
    }
    const c = customers.get(inv.customer)!;
    c.total++;
    c.revenue += inv.amount;
    if (inv.status === "Paid" && inv.paidAt) {
      const created = inv.timeline?.[0]?.at;
      if (created) {
        const days = Math.max(
          1,
          Math.round(
            (new Date(inv.paidAt).getTime() - new Date(created).getTime()) /
              86400000,
          ),
        );
        c.paid.push(days);
        if (days <= 7) c.onTime++;
      }
    }
  });

  return Array.from(customers.entries()).map(([name, data]) => {
    const avgDays =
      data.paid.length > 0
        ? Math.round(data.paid.reduce((a, b) => a + b, 0) / data.paid.length)
        : 14;
    const onTimeRate = data.total > 0 ? data.onTime / data.total : 0;
    const grade: "A" | "B" | "C" =
      avgDays <= 5 && onTimeRate >= 0.8 ? "A" : avgDays <= 14 ? "B" : "C";
    return {
      name,
      grade,
      avgDaysToPay: avgDays,
      totalInvoices: data.total,
      totalRevenue: data.revenue,
      onTimeRate,
    };
  });
}

function computePredictions(
  invoices: Invoice[],
  scores: CustomerScore[],
): PaymentPrediction[] {
  const pending = invoices.filter(
    (i) =>
      i.status === "Pending" ||
      i.status === "Overdue" ||
      i.status === "Partial",
  );
  return pending.map((inv) => {
    const score = scores.find((s) => s.name === inv.customer);
    const baseDays = score?.avgDaysToPay ?? 10;
    const jitter = Math.round((Math.random() - 0.5) * 3);
    const predictedDays = Math.max(1, baseDays + jitter);
    const confidence = score ? Math.min(95, 60 + score.totalInvoices * 10) : 45;
    return {
      invoiceId: inv.id,
      customer: inv.customer,
      predictedDays,
      confidence,
      amount: inv.amount,
      currency: inv.currency,
    };
  });
}

function computeCashFlowForecast(
  invoices: Invoice[],
  predictions: PaymentPrediction[],
): { day: string; amount: number }[] {
  const forecast: { day: string; amount: number }[] = [];
  const today = new Date();
  for (let d = 0; d < 7; d++) {
    const date = new Date(today);
    date.setDate(date.getDate() + d);
    const dayLabel =
      d === 0
        ? "Today"
        : d === 1
          ? "Tomorrow"
          : date.toLocaleDateString("en-US", { weekday: "short" });
    const expectedAmount = predictions
      .filter((p) => p.predictedDays >= d && p.predictedDays < d + 2)
      .reduce((sum, p) => sum + p.amount, 0);
    forecast.push({ day: dayLabel, amount: expectedAmount });
  }
  return forecast;
}

function getChaseStatus(invoice: Invoice): {
  currentStep: number;
  nextAction: ChaseStep | null;
  daysOverdue: number;
} {
  const created = invoice.timeline?.[0]?.at;
  if (!created)
    return { currentStep: 0, nextAction: CHASE_SEQUENCE[0], daysOverdue: 0 };
  const days = Math.round(
    (Date.now() - new Date(created).getTime()) / 86400000,
  );
  const reminders = (invoice.timeline ?? []).filter(
    (e) => e.label.includes("Reminder") || e.label.includes("reminder"),
  ).length;
  const currentStep = Math.min(reminders, CHASE_SEQUENCE.length - 1);
  const nextAction =
    currentStep < CHASE_SEQUENCE.length - 1
      ? CHASE_SEQUENCE[currentStep + 1]
      : null;
  return { currentStep, nextAction, daysOverdue: days };
}

export function AIInsightsView({
  invoices,
  onOpen,
}: {
  invoices: Invoice[];
  onOpen: (inv: Invoice) => void;
}) {
  const scores = useMemo(() => computeCustomerScores(invoices), [invoices]);
  const predictions = useMemo(
    () => computePredictions(invoices, scores),
    [invoices, scores],
  );
  const forecast = useMemo(
    () => computeCashFlowForecast(invoices, predictions),
    [invoices, predictions],
  );
  const maxForecast = Math.max(...forecast.map((f) => f.amount), 1);

  const pendingInvoices = invoices.filter(
    (i) =>
      i.status === "Pending" ||
      i.status === "Overdue" ||
      i.status === "Partial",
  );
  const avgDSO =
    scores.length > 0
      ? Math.round(
          scores.reduce((s, c) => s + c.avgDaysToPay, 0) / scores.length,
        )
      : 0;

  return (
    <div className="px-5 pt-3 space-y-5">
      <div className="flex justify-between items-start">
        <div>
          <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            AI Insights
          </p>
          <h1 className="text-lg font-bold">Intelligence Hub</h1>
        </div>
        <div className="flex items-center gap-1 rounded-full bg-purple-100 px-2 py-1">
          <Brain className="size-3 text-purple-600" />
          <span className="text-[9px] font-mono text-purple-700 uppercase">
            Live
          </span>
        </div>
      </div>

      {/* DSO Metric */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl bg-muted p-3 text-center">
          <p className="text-[9px] font-mono uppercase text-muted-foreground">
            Avg DSO
          </p>
          <p className="text-xl font-bold font-mono">{avgDSO}d</p>
        </div>
        <div className="rounded-xl bg-muted p-3 text-center">
          <p className="text-[9px] font-mono uppercase text-muted-foreground">
            At risk
          </p>
          <p className="text-xl font-bold font-mono text-amber-600">
            {pendingInvoices.filter((i) => i.status === "Overdue").length}
          </p>
        </div>
        <div className="rounded-xl bg-muted p-3 text-center">
          <p className="text-[9px] font-mono uppercase text-muted-foreground">
            Score avg
          </p>
          <p className="text-xl font-bold font-mono">
            {scores.length > 0
              ? scores.filter((s) => s.grade === "A").length > scores.length / 2
                ? "A"
                : scores.filter((s) => s.grade === "C").length >
                    scores.length / 2
                  ? "C"
                  : "B"
              : "—"}
          </p>
        </div>
      </div>

      {/* Cash Flow Forecast */}
      <div className="rounded-2xl border border-border bg-background p-4">
        <div className="flex items-center gap-2 mb-3">
          <BarChart3 className="size-3.5 text-purple-500" />
          <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            7-day cash flow forecast
          </p>
        </div>
        <div className="space-y-2">
          {forecast.map((f) => (
            <div key={f.day} className="flex items-center gap-3">
              <span className="text-[10px] font-mono text-muted-foreground w-16">
                {f.day}
              </span>
              <div className="flex-1 h-4 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-purple-400 to-purple-600 transition-all"
                  style={{
                    width: `${f.amount > 0 ? Math.max(8, (f.amount / maxForecast) * 100) : 0}%`,
                  }}
                />
              </div>
              <span className="text-[10px] font-mono font-semibold w-14 text-right">
                {f.amount > 0 ? `$${(f.amount / 1000).toFixed(1)}k` : "—"}
              </span>
            </div>
          ))}
        </div>
        <p className="text-[9px] text-muted-foreground mt-2 italic">
          Based on customer payment patterns & outstanding invoices
        </p>
      </div>

      {/* Payment Predictions */}
      <div className="rounded-2xl border border-border bg-background p-4">
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp className="size-3.5 text-blue-500" />
          <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            Payment predictions
          </p>
        </div>
        <div className="space-y-2">
          {predictions.slice(0, 4).map((pred) => (
            <button
              key={pred.invoiceId}
              onClick={() => {
                const inv = invoices.find((i) => i.id === pred.invoiceId);
                if (inv) onOpen(inv);
              }}
              className="w-full flex items-center justify-between p-2.5 rounded-xl bg-muted hover:bg-foreground/5 transition-colors text-left"
            >
              <div>
                <p className="text-[11px] font-semibold">{pred.customer}</p>
                <p className="text-[10px] font-mono text-muted-foreground">
                  Expected in ~{pred.predictedDays} days
                </p>
              </div>
              <div className="text-right">
                <p className="text-[11px] font-mono font-bold">
                  {pred.currency} {pred.amount.toLocaleString()}
                </p>
                <div className="flex items-center gap-1 justify-end">
                  <div className="h-1.5 w-12 rounded-full bg-background overflow-hidden">
                    <div
                      className="h-full rounded-full bg-blue-500"
                      style={{ width: `${pred.confidence}%` }}
                    />
                  </div>
                  <span className="text-[9px] font-mono text-muted-foreground">
                    {pred.confidence}%
                  </span>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Auto-Chase Sequences */}
      <div className="rounded-2xl border border-border bg-background p-4">
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle className="size-3.5 text-amber-500" />
          <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            Auto-chase status
          </p>
        </div>
        <div className="space-y-3">
          {pendingInvoices.slice(0, 3).map((inv) => {
            const chase = getChaseStatus(inv);
            return (
              <div key={inv.id} className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-semibold">{inv.customer}</p>
                  <span className="text-[9px] font-mono text-muted-foreground">
                    {chase.daysOverdue}d old
                  </span>
                </div>
                <div className="flex gap-1">
                  {CHASE_SEQUENCE.map((step, idx) => (
                    <div
                      key={step.day}
                      className="flex-1 flex flex-col items-center gap-0.5"
                    >
                      <div
                        className={`h-1.5 w-full rounded-full ${
                          idx <= chase.currentStep
                            ? step.tone === "gentle"
                              ? "bg-green-400"
                              : step.tone === "firm"
                                ? "bg-amber-400"
                                : step.tone === "urgent"
                                  ? "bg-orange-500"
                                  : "bg-red-500"
                            : "bg-muted"
                        }`}
                      />
                      <span className="text-[7px] font-mono text-muted-foreground">
                        {step.tone[0].toUpperCase()}
                      </span>
                    </div>
                  ))}
                </div>
                {chase.nextAction && (
                  <p className="text-[9px] text-muted-foreground">
                    Next:{" "}
                    <span className="font-semibold">
                      {chase.nextAction.label}
                    </span>{" "}
                    on day {chase.nextAction.day}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Customer Health Scores */}
      <div className="rounded-2xl border border-border bg-background p-4">
        <div className="flex items-center gap-2 mb-3">
          <Users className="size-3.5 text-emerald-500" />
          <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            Customer health scores
          </p>
        </div>
        <div className="space-y-2">
          {scores.map((customer) => (
            <div
              key={customer.name}
              className="flex items-center gap-3 p-2.5 rounded-xl bg-muted"
            >
              <span
                className={`size-7 rounded-full flex items-center justify-center text-xs font-bold ${
                  customer.grade === "A"
                    ? "bg-emerald-100 text-emerald-700"
                    : customer.grade === "B"
                      ? "bg-amber-100 text-amber-700"
                      : "bg-red-100 text-red-700"
                }`}
              >
                {customer.grade}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-semibold truncate">
                  {customer.name}
                </p>
                <p className="text-[9px] font-mono text-muted-foreground">
                  {customer.avgDaysToPay}d avg · {customer.totalInvoices}{" "}
                  invoices · {Math.round(customer.onTimeRate * 100)}% on-time
                </p>
              </div>
              <span className="text-[10px] font-mono font-bold">
                ${(customer.totalRevenue / 1000).toFixed(1)}k
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
