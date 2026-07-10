import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { authFetch, refreshToken } from "@/lib/auth";

export const Route = createFileRoute("/dashboard/billing")({
  component: BillingPage,
});

type Plan = {
  id: string;
  name: string;
  priceKes: number;
  interval: string;
  tagline: string;
  features: string[];
};

type Subscription = {
  plan: string;
  status: string;
  currentPeriodEnd: string | null;
  amount: number;
  lastPaymentId: string | null;
};

type BillingData = {
  plan: string;
  tokenPlan: string;
  subscription: Subscription | null;
  plans: Plan[];
  limits: Record<string, number>;
  usage: { menu_items: number; staff: number; contacts: number };
};

const kes = (whole: number) => `KES ${whole.toLocaleString()}`;

const STATUS_VARIANT: Record<string, "secondary" | "destructive" | "outline"> = {
  active: "secondary",
  past_due: "destructive",
  canceled: "outline",
};

function BillingPage() {
  const [data, setData] = useState<BillingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [dialogPlan, setDialogPlan] = useState<Plan | null>(null);
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const res = await authFetch("/api/billing");
    if (res.ok) setData((await res.json()) as BillingData);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  // Poll until the venue's subscription reflects the target plan (payment settled),
  // then refresh the JWT so the new plan's limits take effect immediately.
  async function pollActive(target: string): Promise<boolean> {
    for (let i = 0; i < 20; i += 1) {
      await new Promise((r) => setTimeout(r, 3000));
      const res = await authFetch("/api/billing");
      if (res.ok) {
        const d = (await res.json()) as BillingData;
        if (d.plan === target && d.subscription?.status === "active") {
          setData(d);
          return true;
        }
      }
    }
    return false;
  }

  async function changePlan(plan: Plan) {
    // Free is immediate + needs no payment.
    if (plan.priceKes === 0) {
      setBusy(true);
      try {
        const res = await authFetch("/api/billing/subscribe", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ plan: plan.id }),
        });
        if (!res.ok) {
          toast.error("Could not change plan.");
          return;
        }
        await refreshToken();
        await load();
        toast.success("You're on the Free plan.");
      } finally {
        setBusy(false);
      }
      return;
    }
    setPhone("");
    setDialogPlan(plan);
  }

  async function confirmSubscribe() {
    if (!dialogPlan) return;
    if (!phone.trim()) {
      toast.error("Enter your M-Pesa phone number.");
      return;
    }
    setBusy(true);
    try {
      const res = await authFetch("/api/billing/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan: dialogPlan.id, phone: phone.trim() }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        status?: string;
        message?: string;
        error?: string;
      };
      if (!res.ok) {
        toast.error(body.error ?? "Subscription failed.");
        return;
      }
      const target = dialogPlan.id;
      setDialogPlan(null);
      if (body.status === "succeeded") {
        await refreshToken();
        await load();
        toast.success(`You're on ${target.toUpperCase()}. Enjoy!`);
        return;
      }
      toast.message("Check your phone", {
        description: "Approve the M-Pesa prompt to activate your plan.",
      });
      const ok = await pollActive(target);
      if (ok) {
        await refreshToken();
        toast.success(`Payment received — you're on ${target.toUpperCase()}.`);
      } else {
        toast.error("Payment not confirmed yet. It'll activate once M-Pesa clears.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    setBusy(true);
    try {
      const res = await authFetch("/api/billing/cancel", { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) {
        toast.error("Could not cancel.");
        return;
      }
      await refreshToken();
      await load();
      toast.success(body.message ?? "Subscription cancelled.");
    } finally {
      setBusy(false);
    }
  }

  const currentPlan = data?.plan ?? "free";
  const sub = data?.subscription;
  const renewal = sub?.currentPeriodEnd
    ? new Date(sub.currentPeriodEnd).toLocaleDateString()
    : null;

  const meters: Array<[string, number, number]> = data
    ? [
        ["Menu items", data.usage.menu_items, data.limits.menu_items ?? 0],
        ["Staff", data.usage.staff, data.limits.staff ?? 0],
        ["Contacts", data.usage.contacts, data.limits.contacts ?? 0],
      ]
    : [];

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Billing &amp; plan</h1>
        <p className="text-sm text-muted-foreground">
          Pay by M-Pesa. Upgrade unlocks higher limits instantly on payment.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardDescription>Current plan</CardDescription>
            <CardTitle className="flex items-center gap-2 text-2xl capitalize">
              {currentPlan}
              {sub?.status && (
                <Badge variant={STATUS_VARIANT[sub.status] ?? "outline"}>
                  {sub.status.replace("_", " ")}
                </Badge>
              )}
            </CardTitle>
            {renewal && (
              <p className="mt-1 text-sm text-muted-foreground">
                {sub?.status === "canceled"
                  ? `Access until ${renewal}, then Free.`
                  : `Renews ${renewal}`}
              </p>
            )}
          </div>
          {currentPlan !== "free" && sub?.status !== "canceled" && (
            <Button variant="outline" onClick={() => void cancel()} disabled={busy}>
              Cancel
            </Button>
          )}
        </CardHeader>
        {meters.length > 0 && (
          <CardContent className="grid gap-4 sm:grid-cols-3">
            {meters.map(([label, used, limit]) => {
              const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
              return (
                <div key={label}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span className="text-muted-foreground">{label}</span>
                    <span className={used >= limit ? "font-semibold text-destructive" : ""}>
                      {used} / {limit}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className={`h-full ${pct >= 100 ? "bg-destructive" : "bg-primary"}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </CardContent>
        )}
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {(data?.plans ?? []).map((plan) => {
          const isCurrent = plan.id === currentPlan;
          return (
            <Card key={plan.id} className={isCurrent ? "border-primary" : ""}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>{plan.name}</CardTitle>
                  {isCurrent && <Badge>Current</Badge>}
                </div>
                <CardDescription>{plan.tagline}</CardDescription>
                <div className="pt-2 text-3xl font-bold">
                  {plan.priceKes === 0 ? "Free" : kes(plan.priceKes)}
                  {plan.priceKes > 0 && (
                    <span className="text-base font-normal text-muted-foreground">
                      {" "}
                      / {plan.interval}
                    </span>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <ul className="space-y-1 text-sm">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-center gap-2">
                      <span className="text-primary">✓</span>
                      {f}
                    </li>
                  ))}
                </ul>
                <Button
                  className="w-full"
                  variant={isCurrent ? "outline" : plan.priceKes === 0 ? "outline" : "default"}
                  disabled={isCurrent || busy || loading}
                  onClick={() => void changePlan(plan)}
                >
                  {isCurrent
                    ? "Current plan"
                    : plan.priceKes === 0
                      ? "Switch to Free"
                      : `Upgrade to ${plan.name}`}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog open={!!dialogPlan} onOpenChange={(o) => !o && setDialogPlan(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Subscribe to {dialogPlan?.name}</DialogTitle>
            <DialogDescription>
              {dialogPlan && kes(dialogPlan.priceKes)} / {dialogPlan?.interval}. Enter the
              M-Pesa number to receive the STK push.
            </DialogDescription>
          </DialogHeader>
          <Input
            placeholder="07XX XXX XXX"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogPlan(null)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={() => void confirmSubscribe()} disabled={busy}>
              {busy ? "Sending…" : "Pay with M-Pesa"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
