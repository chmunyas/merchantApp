import { createFileRoute } from "@tanstack/react-router";
import { CalendarDays, Check, Undo2, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import type {
  DepositPolicy,
  Reservation,
  TableCombination,
} from "@/components/merchant/features/types";
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
import { Switch } from "@/components/ui/switch";
import {
  ensureMerchantDemoData,
  getDepositDue,
  getDepositStats,
  saveMerchantDepositPolicy,
  saveMerchantReservations,
  tableLabel,
  type MerchantTable,
} from "@/lib/merchant-dashboard";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/deposits")({
  component: DashboardDepositsPage,
});

const money = new Intl.NumberFormat("en-KE", {
  style: "currency",
  currency: "KES",
  maximumFractionDigits: 0,
});

function DashboardDepositsPage() {
  const [hydrated, setHydrated] = useState(false);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [tables, setTables] = useState<MerchantTable[]>([]);
  const [combinations, setCombinations] = useState<TableCombination[]>([]);
  const [policy, setPolicy] = useState<DepositPolicy>({
    enabled: true,
    perGuestKES: 500,
    minCovers: 6,
  });

  useEffect(() => {
    const snapshot = ensureMerchantDemoData();
    setReservations(snapshot.reservations);
    setTables(snapshot.tables);
    setCombinations(snapshot.tableCombinations);
    setPolicy(snapshot.depositPolicy);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    saveMerchantReservations(reservations);
  }, [hydrated, reservations]);

  useEffect(() => {
    if (!hydrated) return;
    saveMerchantDepositPolicy(policy);
  }, [hydrated, policy]);

  const stats = useMemo(
    () => getDepositStats(policy, reservations),
    [policy, reservations],
  );

  const relevant = useMemo(
    () =>
      reservations
        .filter(
          (reservation) =>
            reservation.status !== "cancelled" &&
            reservation.status !== "no-show",
        )
        .sort((a, b) =>
          `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`),
        ),
    [reservations],
  );

  function reservationLabel(reservation: Reservation) {
    if (reservation.combinationId) {
      const combo = combinations.find(
        (entry) => entry.id === reservation.combinationId,
      );
      if (combo) return combo.name;
    }
    const table = tables.find(
      (entry) => entry.tableNumber === reservation.tableNumber,
    );
    return table ? tableLabel(table) : `Table ${reservation.tableNumber}`;
  }

  function updateReservation(id: string, patch: Partial<Reservation>) {
    setReservations((current) =>
      current.map((reservation) =>
        reservation.id === id ? { ...reservation, ...patch } : reservation,
      ),
    );
  }

  function handleMarkPaid(reservation: Reservation) {
    const due = getDepositDue(policy, reservation.covers);
    if (due <= 0) {
      toast.error("No deposit required for this booking.");
      return;
    }
    updateReservation(reservation.id, {
      depositAmount: due,
      depositStatus: "paid",
      depositPaidAt: new Date().toISOString(),
    });
    toast.success(`Deposit of ${money.format(due)} recorded.`);
  }

  function handleRefund(reservation: Reservation) {
    updateReservation(reservation.id, { depositStatus: "refunded" });
    toast.success("Deposit refunded.");
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryCard
          label="Collected"
          value={money.format(stats.collected)}
          accent="text-emerald-500"
        />
        <SummaryCard
          label="Pending"
          value={money.format(stats.pending)}
          accent="text-amber-500"
        />
        <SummaryCard
          label="Refunded"
          value={money.format(stats.refunded)}
          accent="text-slate-400"
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
        <Card className="border-slate-200 bg-white/90 shadow-sm">
          <CardHeader>
            <CardTitle>Deposit policy</CardTitle>
            <CardDescription>
              Require a deposit for larger parties to reduce no-shows.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <label className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-slate-800">
                    Require deposits
                  </p>
                  <p className="text-xs text-slate-500">
                    Turn deposit collection on or off.
                  </p>
                </div>
                <Switch
                  checked={policy.enabled}
                  onCheckedChange={(checked) =>
                    setPolicy((current) => ({ ...current, enabled: checked }))
                  }
                />
              </label>
              <Field label="Amount per guest (KES)">
                <Input
                  type="number"
                  min="0"
                  value={policy.perGuestKES}
                  onChange={(event) =>
                    setPolicy((current) => ({
                      ...current,
                      perGuestKES: Number(event.target.value) || 0,
                    }))
                  }
                />
              </Field>
              <Field label="Minimum covers to require a deposit">
                <Input
                  type="number"
                  min="1"
                  value={policy.minCovers}
                  onChange={(event) =>
                    setPolicy((current) => ({
                      ...current,
                      minCovers: Number(event.target.value) || 1,
                    }))
                  }
                />
              </Field>
              <p className="rounded-2xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
                Example: a party of {policy.minCovers} owes{" "}
                {money.format(getDepositDue(policy, policy.minCovers))}.
                Marking a deposit paid simulates an M-Pesa collection.
              </p>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-slate-800">
            Bookings ({relevant.length})
          </h3>
          {relevant.length === 0 ? (
            <Card className="border-dashed border-slate-300 bg-white/60">
              <CardContent className="p-6 text-center text-sm text-slate-500">
                No bookings to track deposits for.
              </CardContent>
            </Card>
          ) : (
            relevant.map((reservation) => {
              const due = getDepositDue(policy, reservation.covers);
              const status = reservation.depositStatus;
              return (
                <Card
                  key={reservation.id}
                  className="border-slate-200 bg-white/90 shadow-sm"
                >
                  <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                    <div>
                      <p className="font-medium text-slate-950">
                        {reservation.customerName}
                      </p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-slate-500">
                        <span className="flex items-center gap-1">
                          <CalendarDays className="h-3.5 w-3.5" />
                          {reservation.date} · {reservation.time}
                        </span>
                        <span className="flex items-center gap-1">
                          <Users className="h-3.5 w-3.5" />
                          {reservation.covers}
                        </span>
                        <span>{reservationLabel(reservation)}</span>
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      {status === "paid" ? (
                        <>
                          <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
                            Paid {money.format(reservation.depositAmount ?? 0)}
                          </Badge>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="border-slate-200 text-slate-600"
                            onClick={() => handleRefund(reservation)}
                          >
                            <Undo2 className="mr-1 h-3.5 w-3.5" /> Refund
                          </Button>
                        </>
                      ) : status === "refunded" ? (
                        <Badge
                          variant="outline"
                          className="border-slate-200 text-slate-500"
                        >
                          Refunded
                        </Badge>
                      ) : due > 0 ? (
                        <>
                          <span className="text-sm font-medium text-amber-600">
                            {money.format(due)} due
                          </span>
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => handleMarkPaid(reservation)}
                          >
                            <Check className="mr-1 h-3.5 w-3.5" /> Mark paid
                          </Button>
                        </>
                      ) : (
                        <Badge
                          variant="outline"
                          className="border-slate-200 text-slate-400"
                        >
                          No deposit
                        </Badge>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <p className={cn("font-mono text-2xl font-semibold", accent)}>{value}</p>
      <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
        {label}
      </p>
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
    <label className="space-y-2">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}
