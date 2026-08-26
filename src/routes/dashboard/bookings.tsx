import { createFileRoute } from "@tanstack/react-router";
import { CalendarDays, Check, Layers, MapPin, Send, Users } from "lucide-react";
import { useMemo, useEffect, useState } from "react";
import { toast } from "sonner";

import { OmniShare } from "@/components/merchant/OmniShare";
import type {
  Area,
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
import { ModalOverlay } from "@/components/ui/modal-overlay";
import { authFetch } from "@/lib/auth";
import {
  ensureMerchantDemoData,
  getAvailableCombinationsForParty,
  getAvailableTablesForParty,
  getBookingsByArea,
  getBookingStats,
  getCombinationSeats,
  getOccupiedTableNumbers,
  saveMerchantReservations,
  tableLabel,
  tableSeats,
  type MerchantTable,
} from "@/lib/merchant-dashboard";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/bookings")({
  component: DashboardBookingsPage,
});

type Assignment =
  | { kind: "table"; tableNumber: number }
  | { kind: "combination"; combinationId: string };

const RES_STATUS_STYLES: Record<Reservation["status"], string> = {
  confirmed: "bg-emerald-100 text-emerald-700",
  seated: "bg-blue-100 text-blue-700",
  cancelled: "bg-slate-200 text-slate-600",
  "no-show": "bg-rose-100 text-rose-700",
};

function createId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function sameAssignment(a: Assignment | null, b: Assignment | null) {
  if (!a || !b || a.kind !== b.kind) return false;
  return a.kind === "table" && b.kind === "table"
    ? a.tableNumber === b.tableNumber
    : a.kind === "combination" &&
        b.kind === "combination" &&
        a.combinationId === b.combinationId;
}

function DashboardBookingsPage() {
  const [hydrated, setHydrated] = useState(false);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [tables, setTables] = useState<MerchantTable[]>([]);
  const [combinations, setCombinations] = useState<TableCombination[]>([]);

  const [customerName, setCustomerName] = useState("");
  const [phone, setPhone] = useState("");
  const [date, setDate] = useState(todayISO());
  const [time, setTime] = useState("19:00");
  const [covers, setCovers] = useState(2);
  const [manualAssignment, setManualAssignment] = useState<Assignment | null>(
    null,
  );
  const [bookingTab, setBookingTab] = useState<"planner" | "new">("planner");
  const [depositTarget, setDepositTarget] = useState<Reservation | null>(null);
  const [plannerDate, setPlannerDate] = useState(todayISO());
  const [areas, setAreas] = useState<Area[]>([]);

  useEffect(() => {
    const snapshot = ensureMerchantDemoData();
    setReservations(snapshot.reservations);
    setTables(snapshot.tables);
    setCombinations(snapshot.tableCombinations);
    setAreas(snapshot.areas);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    saveMerchantReservations(reservations);
  }, [hydrated, reservations]);

  const occupied = useMemo(
    () => getOccupiedTableNumbers(reservations, combinations, date, time),
    [reservations, combinations, date, time],
  );

  const availableTables = useMemo(
    () => getAvailableTablesForParty(tables, covers, occupied),
    [tables, covers, occupied],
  );

  const availableCombinations = useMemo(
    () => getAvailableCombinationsForParty(combinations, covers, occupied),
    [combinations, covers, occupied],
  );

  // Prefer the smallest single table that fits; fall back to the highest
  // priority combination when the party is too large for any single table.
  const suggestion: Assignment | null = useMemo(() => {
    if (availableTables[0]) {
      return { kind: "table", tableNumber: availableTables[0].tableNumber };
    }
    if (availableCombinations[0]) {
      return { kind: "combination", combinationId: availableCombinations[0].id };
    }
    return null;
  }, [availableTables, availableCombinations]);

  const effectiveAssignment = manualAssignment ?? suggestion;

  const sortedReservations = useMemo(
    () =>
      [...reservations].sort(
        (a, b) =>
          `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`),
      ),
    [reservations],
  );

  const plannerStats = useMemo(
    () => getBookingStats(reservations, plannerDate),
    [reservations, plannerDate],
  );

  const plannerGroups = useMemo(
    () => getBookingsByArea(areas, reservations, combinations, plannerDate),
    [areas, reservations, combinations, plannerDate],
  );

  function resetAssignment() {
    setManualAssignment(null);
  }

  function assignmentLabel(assignment: Assignment): string {
    if (assignment.kind === "table") {
      const table = tables.find((t) => t.tableNumber === assignment.tableNumber);
      return table ? tableLabel(table) : `Table ${assignment.tableNumber}`;
    }
    const combination = combinations.find(
      (c) => c.id === assignment.combinationId,
    );
    return combination ? combination.name : "Combination";
  }

  function reservationAssignmentLabel(reservation: Reservation): string {
    if (reservation.combinationId) {
      const combination = combinations.find(
        (c) => c.id === reservation.combinationId,
      );
      if (combination) return `${combination.name} (combined)`;
    }
    const table = tables.find(
      (t) => t.tableNumber === reservation.tableNumber,
    );
    return table ? tableLabel(table) : `Table ${reservation.tableNumber}`;
  }

  function handleConfirm() {
    if (!customerName.trim()) {
      toast.error("Enter the guest name.");
      return;
    }
    if (!effectiveAssignment) {
      toast.error("No available table or combination for this party and time.");
      return;
    }

    // Re-check availability against the latest state to prevent double-booking.
    const latestOccupied = getOccupiedTableNumbers(
      reservations,
      combinations,
      date,
      time,
    );
    if (
      effectiveAssignment.kind === "table" &&
      latestOccupied.has(effectiveAssignment.tableNumber)
    ) {
      toast.error("That table was just booked — pick another.");
      return;
    }
    let primaryTable = 0;
    if (effectiveAssignment.kind === "combination") {
      const combination = combinations.find(
        (c) => c.id === effectiveAssignment.combinationId,
      );
      if (
        !combination ||
        combination.tableNumbers.some((n) => latestOccupied.has(n))
      ) {
        toast.error("That combination is no longer available for this slot.");
        return;
      }
      primaryTable = combination.tableNumbers[0] ?? 0;
    } else {
      primaryTable = effectiveAssignment.tableNumber;
    }

    const reservation: Reservation = {
      id: createId("res"),
      tableNumber: primaryTable,
      combinationId:
        effectiveAssignment.kind === "combination"
          ? effectiveAssignment.combinationId
          : undefined,
      customerName: customerName.trim(),
      phone: phone.trim(),
      date,
      time,
      covers,
      status: "confirmed",
    };

    setReservations((current) => [...current, reservation]);
    toast.success(
      `Booked ${assignmentLabel(effectiveAssignment)} for ${reservation.customerName} · ${covers} covers`,
    );
    setCustomerName("");
    setPhone("");
    setManualAssignment(null);
  }

  function setStatus(id: string, status: Reservation["status"]) {
    setReservations((current) =>
      current.map((reservation) =>
        reservation.id === id ? { ...reservation, status } : reservation,
      ),
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {(
          [
            { key: "planner", label: "Day Planner" },
            { key: "new", label: "New booking" },
          ] as const
        ).map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setBookingTab(tab.key)}
            className={cn(
              "rounded-full px-4 py-2 text-sm font-medium transition",
              bookingTab === tab.key
                ? "bg-slate-900 text-white"
                : "bg-white text-slate-600 hover:bg-slate-100",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {bookingTab === "planner" ? (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">
                Day Planner
              </h2>
              <p className="text-sm text-muted-foreground">
                Bookings for the day, grouped by area.
              </p>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <span>Date</span>
              <Input
                type="date"
                value={plannerDate}
                onChange={(event) => setPlannerDate(event.target.value)}
                className="w-44"
              />
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { label: "Bookings", value: plannerStats.bookings },
              { label: "Covers", value: plannerStats.covers },
              { label: "Confirmed", value: plannerStats.confirmed },
              { label: "Seated", value: plannerStats.seated },
            ].map((stat) => (
              <div
                key={stat.label}
                className="rounded-2xl border border-border bg-card p-5"
              >
                <p className="font-mono text-2xl font-semibold">{stat.value}</p>
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  {stat.label}
                </p>
              </div>
            ))}
          </div>

          <div className="space-y-4">
            {plannerGroups.every(
              (group) => group.reservations.length === 0,
            ) ? (
              <Card className="border-dashed border-slate-300 bg-white/60">
                <CardContent className="p-6 text-center text-sm text-slate-500">
                  No bookings for this day.
                </CardContent>
              </Card>
            ) : (
              plannerGroups.map((group) => (
                <Card
                  key={group.area ? group.area.id : "unassigned"}
                  className="border-slate-200 bg-white/90 shadow-sm"
                >
                  <CardContent className="space-y-3 p-5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <MapPin className="h-4 w-4 text-slate-400" />
                        <h3 className="font-semibold text-slate-950">
                          {group.area ? group.area.name : "Unassigned"}
                        </h3>
                      </div>
                      <Badge
                        variant="outline"
                        className="border-slate-200 text-slate-600"
                      >
                        {group.reservations.length} booking
                        {group.reservations.length === 1 ? "" : "s"}
                      </Badge>
                    </div>
                    {group.reservations.length === 0 ? (
                      <p className="text-sm text-slate-400">No bookings.</p>
                    ) : (
                      <div className="space-y-2">
                        {group.reservations.map((reservation) => (
                          <div
                            key={reservation.id}
                            className="flex items-center justify-between rounded-2xl border border-slate-200 px-3 py-2.5"
                          >
                            <div>
                              <p className="text-sm font-medium text-slate-900">
                                {reservation.time} · {reservation.customerName}
                              </p>
                              <p className="text-xs text-slate-500">
                                {reservation.covers} covers ·{" "}
                                {reservationAssignmentLabel(reservation)}
                              </p>
                            </div>
                            <span
                              className={cn(
                                "rounded-full px-2.5 py-1 text-xs font-medium",
                                RES_STATUS_STYLES[reservation.status],
                              )}
                            >
                              {reservation.status.replace("-", " ")}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </div>
      ) : null}

      {bookingTab === "new" ? (
        <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <Card className="border-slate-200 bg-white/90 shadow-sm">
          <CardHeader>
            <CardTitle>New booking</CardTitle>
            <CardDescription>
              Pick a party size and slot — we auto-assign the best free table,
              or a combined table for larger groups.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Guest name">
                  <Input
                    value={customerName}
                    onChange={(event) => setCustomerName(event.target.value)}
                    placeholder="Njeri Family"
                  />
                </Field>
                <Field label="Phone (optional)">
                  <Input
                    value={phone}
                    onChange={(event) => setPhone(event.target.value)}
                    placeholder="+2547..."
                  />
                </Field>
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                <Field label="Date">
                  <Input
                    type="date"
                    value={date}
                    onChange={(event) => {
                      setDate(event.target.value);
                      resetAssignment();
                    }}
                  />
                </Field>
                <Field label="Time">
                  <Input
                    type="time"
                    value={time}
                    onChange={(event) => {
                      setTime(event.target.value);
                      resetAssignment();
                    }}
                  />
                </Field>
                <Field label="Covers">
                  <Input
                    type="number"
                    min="1"
                    value={covers}
                    onChange={(event) => {
                      setCovers(Number(event.target.value) || 1);
                      resetAssignment();
                    }}
                  />
                </Field>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-slate-700">
                    Assign to
                  </p>
                  {effectiveAssignment ? (
                    <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
                      {assignmentLabel(effectiveAssignment)}
                    </Badge>
                  ) : (
                    <Badge
                      variant="outline"
                      className="border-rose-200 text-rose-600"
                    >
                      No availability
                    </Badge>
                  )}
                </div>

                {availableTables.length === 0 &&
                availableCombinations.length === 0 ? (
                  <p className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
                    Nothing free for {covers} guests at {time}. Try another
                    slot, or set up a combination on the Tables page.
                  </p>
                ) : null}

                {availableTables.length > 0 ? (
                  <div className="space-y-2">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                      Single tables
                    </p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {availableTables.map((table) => {
                        const assignment: Assignment = {
                          kind: "table",
                          tableNumber: table.tableNumber,
                        };
                        const selected = sameAssignment(
                          effectiveAssignment,
                          assignment,
                        );
                        return (
                          <button
                            key={table.id}
                            type="button"
                            onClick={() => setManualAssignment(assignment)}
                            className={cn(
                              "flex items-center justify-between rounded-2xl border px-3 py-2.5 text-left text-sm transition",
                              selected
                                ? "border-emerald-300 bg-emerald-50"
                                : "border-slate-200 bg-white hover:bg-slate-50",
                            )}
                          >
                            <span className="flex items-center gap-2 font-medium text-slate-900">
                              <Users className="h-4 w-4 text-slate-400" />
                              {tableLabel(table)}
                            </span>
                            <span className="text-xs text-slate-500">
                              {tableSeats(table)} seats
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                {availableCombinations.length > 0 ? (
                  <div className="space-y-2">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                      Combinations
                    </p>
                    <div className="grid gap-2">
                      {availableCombinations.map((combination) => {
                        const assignment: Assignment = {
                          kind: "combination",
                          combinationId: combination.id,
                        };
                        const selected = sameAssignment(
                          effectiveAssignment,
                          assignment,
                        );
                        return (
                          <button
                            key={combination.id}
                            type="button"
                            onClick={() => setManualAssignment(assignment)}
                            className={cn(
                              "flex items-center justify-between rounded-2xl border px-3 py-2.5 text-left text-sm transition",
                              selected
                                ? "border-emerald-300 bg-emerald-50"
                                : "border-slate-200 bg-white hover:bg-slate-50",
                            )}
                          >
                            <span className="flex items-center gap-2 font-medium text-slate-900">
                              <Layers className="h-4 w-4 text-slate-400" />
                              {combination.name}
                            </span>
                            <span className="text-xs text-slate-500">
                              {getCombinationSeats(combination, tables)} seats ·
                              P{combination.priority}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="flex justify-end">
                <Button
                  type="button"
                  onClick={handleConfirm}
                  disabled={!effectiveAssignment}
                >
                  Confirm booking
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <p className="text-sm font-semibold text-slate-800">
            Bookings ({sortedReservations.length})
          </p>
          {sortedReservations.length === 0 ? (
            <Card className="border-dashed border-slate-300 bg-white/60">
              <CardContent className="p-6 text-center text-sm text-slate-500">
                No bookings yet.
              </CardContent>
            </Card>
          ) : (
            sortedReservations.map((reservation) => (
              <Card
                key={reservation.id}
                className="border-slate-200 bg-white/90 shadow-sm"
              >
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-slate-950">
                        {reservation.customerName}
                      </p>
                      <p className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
                        <CalendarDays className="h-3.5 w-3.5" />
                        {reservation.date} · {reservation.time} ·{" "}
                        {reservation.covers} covers
                      </p>
                    </div>
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-1 text-xs font-medium",
                        RES_STATUS_STYLES[reservation.status],
                      )}
                    >
                      {reservation.status.replace("-", " ")}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="outline"
                      className="border-slate-200 text-slate-600"
                    >
                      {reservationAssignmentLabel(reservation)}
                    </Badge>
                    {reservation.depositStatus === "paid" ? (
                      <Badge className="bg-emerald-100 text-emerald-700">
                        Deposit paid
                      </Badge>
                    ) : null}
                  </div>
                  {reservation.status !== "cancelled" &&
                  reservation.depositStatus !== "paid" &&
                  reservation.phone ? (
                    <button
                      type="button"
                      onClick={() => setDepositTarget(reservation)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
                    >
                      <Send className="h-3.5 w-3.5" /> Request deposit
                    </button>
                  ) : null}
                  {reservation.status === "confirmed" ||
                  reservation.status === "seated" ? (
                    <div className="flex justify-end gap-2">
                      {reservation.status === "confirmed" ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setStatus(reservation.id, "seated")}
                        >
                          <Check className="mr-1 h-3.5 w-3.5" /> Seat
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="border-rose-200 text-rose-600 hover:bg-rose-50"
                        onClick={() => setStatus(reservation.id, "cancelled")}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>
      ) : null}
      {depositTarget ? (
        <DepositRequestModal
          reservation={depositTarget}
          onClose={() => setDepositTarget(null)}
        />
      ) : null}
    </div>
  );
}

// Collect a booking deposit as a shareable server-bound pay-link (kind=deposit,
// referenced to the reservation), then send it over WhatsApp/Telegram/SMS.
function DepositRequestModal({
  reservation,
  onClose,
}: {
  reservation: Reservation;
  onClose: () => void;
}) {
  const [amountKes, setAmountKes] = useState(
    String(reservation.depositAmount || 500),
  );
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const amount = Math.max(0, Math.round(Number(amountKes) || 0));

  async function mint() {
    if (amount <= 0) {
      toast.error("Enter a deposit amount.");
      return;
    }
    setBusy(true);
    try {
      const res = await authFetch("/api/pay-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amountKes: amount,
          kind: "deposit",
          reference: reservation.id,
          description: `Booking deposit — ${reservation.date} ${reservation.time} (${reservation.covers} covers)`,
          phone: reservation.phone,
          name: reservation.customerName,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        url?: string;
        error?: string;
      };
      if (!res.ok || !data.url) {
        toast.error(data.error || "Couldn't create the deposit link");
        return;
      }
      setLink(data.url);
    } catch {
      toast.error("Couldn't create the deposit link");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalOverlay
      onClose={onClose}
      labelledBy="deposit-modal-heading"
      className="flex items-end justify-center p-4 sm:items-center"
      panelClassName="w-full max-w-sm rounded-3xl bg-white p-6 shadow-xl"
      closeLabel="Close deposit request"
    >
        <h3 id="deposit-modal-heading" className="text-base font-bold">
          Request deposit
        </h3>
        <p className="mb-4 text-xs text-slate-500">
          {reservation.customerName} · {reservation.date} {reservation.time}
        </p>
        <label className="mb-1 block text-[10px] font-mono uppercase tracking-widest text-slate-400">
          Deposit amount
        </label>
        <div className="mb-4 flex items-center rounded-xl border border-slate-200 px-3">
          <span className="text-sm font-mono font-bold text-slate-400">KES</span>
          <input
            type="tel"
            inputMode="numeric"
            value={amountKes}
            onChange={(e) => setAmountKes(e.target.value.replace(/[^0-9]/g, ""))}
            className="w-full bg-transparent px-2 py-3 text-center text-2xl font-bold font-mono focus:outline-none"
          />
        </div>
        {link ? (
          <OmniShare
            kind="booking"
            open={!!link}
            onClose={onClose}
            title={`Send KES ${amount.toLocaleString()} deposit link`}
            message={`Please secure your booking for ${reservation.date} at ${reservation.time} with a KES ${amount.toLocaleString()} deposit. Tap to pay 👇`}
            link={link}
            defaultPhone={reservation.phone}
          />
        ) : (
          <>
            <button
              onClick={mint}
              disabled={busy || amount <= 0}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 py-3.5 text-sm font-bold text-white disabled:opacity-40"
            >
              <Send className="size-4" />
              {busy ? "Creating…" : "Create deposit link"}
            </button>
            <button
              onClick={onClose}
              className="mt-2 w-full rounded-2xl py-2.5 text-sm text-slate-500"
            >
              Cancel
            </button>
          </>
        )}
    </ModalOverlay>
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
