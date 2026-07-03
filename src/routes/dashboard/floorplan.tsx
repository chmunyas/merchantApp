import { createFileRoute } from "@tanstack/react-router";
import { Armchair, Link2, MapPin, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type {
  Area,
  Reservation,
  TableCombination,
} from "@/components/merchant/features/types";
import { Badge } from "@/components/ui/badge";
import {
  ensureMerchantDemoData,
  getAreaForTable,
  getReservationTableNumbers,
  getSeatedCombinationsByTable,
  tableLabel,
  tableSeats,
  type MerchantTable,
} from "@/lib/merchant-dashboard";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/floorplan")({
  component: DashboardFloorplanPage,
});

const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  "requesting-bill": "Requesting bill",
  "partially-paid": "Partially paid",
  closed: "Closed",
};

const TOKEN_STYLES: Record<string, string> = {
  open: "border-emerald-300 bg-emerald-50 text-emerald-900",
  "requesting-bill": "border-amber-300 bg-amber-50 text-amber-900",
  "partially-paid": "border-blue-300 bg-blue-50 text-blue-900",
  closed: "border-slate-300 bg-slate-100 text-slate-500",
};

function tokenStyle(status: string) {
  return TOKEN_STYLES[status] ?? "border-slate-300 bg-white text-slate-700";
}

function tokenSize(capacity: number) {
  if (capacity <= 2) return "h-16 w-16 rounded-full";
  if (capacity <= 4) return "h-20 w-20 rounded-2xl";
  if (capacity <= 6) return "h-20 w-28 rounded-2xl";
  return "h-24 w-36 rounded-2xl";
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function DashboardFloorplanPage() {
  const [tables, setTables] = useState<MerchantTable[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [combinations, setCombinations] = useState<TableCombination[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [selected, setSelected] = useState<number | null>(null);

  useEffect(() => {
    const snapshot = ensureMerchantDemoData();
    setTables(snapshot.tables);
    setAreas(snapshot.areas);
    setCombinations(snapshot.tableCombinations);
    setReservations(snapshot.reservations);
  }, []);

  const today = todayISO();

  const seatedByTable = useMemo(
    () => getSeatedCombinationsByTable(combinations, reservations),
    [combinations, reservations],
  );

  const bookingsByTable = useMemo(() => {
    const map = new Map<number, Reservation[]>();
    reservations
      .filter(
        (reservation) =>
          reservation.date === today &&
          reservation.status !== "cancelled" &&
          reservation.status !== "no-show",
      )
      .forEach((reservation) => {
        getReservationTableNumbers(reservation, combinations).forEach(
          (tableNumber) => {
            const list = map.get(tableNumber) ?? [];
            list.push(reservation);
            map.set(tableNumber, list);
          },
        );
      });
    return map;
  }, [reservations, combinations, today]);

  // Group tables by area (all areas, ordered), trailing "Unassigned".
  const groups = useMemo(() => {
    const byNumber = new Map(tables.map((table) => [table.tableNumber, table]));
    const sortedAreas = [...areas].sort((a, b) => a.order - b.order);
    const assigned = new Set<number>();
    const areaGroups = sortedAreas.map((area) => {
      const areaTables = [...area.tableNumbers]
        .sort((a, b) => a - b)
        .map((tableNumber) => {
          assigned.add(tableNumber);
          return byNumber.get(tableNumber);
        })
        .filter((table): table is MerchantTable => Boolean(table));
      return { area, tables: areaTables };
    });
    const unassigned = [...tables]
      .filter((table) => !assigned.has(table.tableNumber))
      .sort((a, b) => a.tableNumber - b.tableNumber);
    if (unassigned.length > 0) {
      areaGroups.push({
        area: null as unknown as Area,
        tables: unassigned,
      });
    }
    return areaGroups;
  }, [tables, areas]);

  const selectedTable = useMemo(
    () =>
      selected === null
        ? null
        : (tables.find((table) => table.tableNumber === selected) ?? null),
    [selected, tables],
  );

  return (
    <div className="grid gap-6 xl:grid-cols-[1.35fr_0.65fr]">
      <div className="space-y-6">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">Floor plan</h2>
          <p className="text-sm text-muted-foreground">
            Live table view grouped by area. Tap a table for details.
          </p>
        </div>

        {groups.map((group) => (
          <div
            key={group.area ? group.area.id : "unassigned"}
            className="rounded-3xl border border-border bg-card p-5"
          >
            <div className="mb-4 flex items-center justify-between">
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
                {group.tables.length} tables ·{" "}
                {group.tables.reduce((sum, table) => sum + tableSeats(table), 0)}{" "}
                seats
              </Badge>
            </div>
            {group.tables.length === 0 ? (
              <p className="text-sm text-slate-400">No tables in this area.</p>
            ) : (
              <div className="flex flex-wrap gap-4">
                {group.tables.map((table) => {
                  const combo = seatedByTable.get(table.tableNumber);
                  const bookingCount =
                    bookingsByTable.get(table.tableNumber)?.length ?? 0;
                  const isSelected = selected === table.tableNumber;
                  return (
                    <button
                      key={table.id}
                      type="button"
                      onClick={() => setSelected(table.tableNumber)}
                      className={cn(
                        "relative flex flex-col items-center justify-center border-2 p-2 text-center shadow-sm transition hover:scale-[1.03]",
                        tokenSize(tableSeats(table)),
                        tokenStyle(table.status),
                        isSelected && "ring-2 ring-slate-900 ring-offset-2",
                      )}
                      title={`${tableLabel(table)} · ${STATUS_LABELS[table.status] ?? table.status}`}
                    >
                      <span className="text-lg font-bold leading-none">
                        {table.tableNumber}
                      </span>
                      <span className="mt-1 flex items-center gap-1 text-[11px] font-medium opacity-80">
                        <Users className="h-3 w-3" />
                        {tableSeats(table)}
                      </span>
                      {combo ? (
                        <span
                          className="absolute -left-1.5 -top-1.5 rounded-full bg-slate-900 p-1 text-white"
                          title={`Combined: ${combo.name}`}
                        >
                          <Link2 className="h-3 w-3" />
                        </span>
                      ) : null}
                      {bookingCount > 0 ? (
                        <span
                          className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-violet-600 px-1 text-[11px] font-semibold text-white"
                          title={`${bookingCount} booking(s) today`}
                        >
                          {bookingCount}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="space-y-4 xl:sticky xl:top-6 xl:self-start">
        <div className="rounded-3xl border border-border bg-card p-5">
          <p className="text-sm font-semibold text-slate-800">Legend</p>
          <div className="mt-3 space-y-2">
            {Object.entries(STATUS_LABELS).map(([status, label]) => (
              <div key={status} className="flex items-center gap-2 text-sm">
                <span
                  className={cn(
                    "h-4 w-4 rounded-md border-2",
                    tokenStyle(status),
                  )}
                />
                <span className="text-slate-600">{label}</span>
              </div>
            ))}
            <div className="flex items-center gap-2 text-sm">
              <span className="rounded-full bg-slate-900 p-1 text-white">
                <Link2 className="h-3 w-3" />
              </span>
              <span className="text-slate-600">Combined (seated)</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-violet-600 px-1 text-[11px] font-semibold text-white">
                n
              </span>
              <span className="text-slate-600">Bookings today</span>
            </div>
          </div>
        </div>

        <div className="rounded-3xl border border-border bg-card p-5">
          {selectedTable ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                    Table
                  </p>
                  <h3 className="text-xl font-semibold text-slate-950">
                    {tableLabel(selectedTable)}
                  </h3>
                </div>
                <span
                  className={cn(
                    "rounded-full border-2 px-2.5 py-1 text-xs font-medium",
                    tokenStyle(selectedTable.status),
                  )}
                >
                  {STATUS_LABELS[selectedTable.status] ?? selectedTable.status}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-2xl border border-slate-200 p-3">
                  <p className="text-xs text-slate-500">Seats</p>
                  <p className="font-semibold text-slate-900">
                    {tableSeats(selectedTable)}
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200 p-3">
                  <p className="text-xs text-slate-500">Area</p>
                  <p className="font-semibold text-slate-900">
                    {getAreaForTable(areas, selectedTable.tableNumber)?.name ??
                      "Unassigned"}
                  </p>
                </div>
              </div>

              {seatedByTable.get(selectedTable.tableNumber) ? (
                <div className="flex items-center gap-2 rounded-2xl bg-slate-900 px-3 py-2 text-sm text-white">
                  <Link2 className="h-4 w-4" />
                  Combined: {seatedByTable.get(selectedTable.tableNumber)?.name}
                </div>
              ) : null}

              <div>
                <p className="mb-2 text-sm font-medium text-slate-700">
                  Today's bookings
                </p>
                {(bookingsByTable.get(selectedTable.tableNumber)?.length ?? 0) ===
                0 ? (
                  <p className="text-sm text-slate-400">No bookings today.</p>
                ) : (
                  <div className="space-y-2">
                    {bookingsByTable
                      .get(selectedTable.tableNumber)
                      ?.sort((a, b) => a.time.localeCompare(b.time))
                      .map((reservation) => (
                        <div
                          key={reservation.id}
                          className="rounded-2xl border border-slate-200 px-3 py-2 text-sm"
                        >
                          <span className="font-medium text-slate-900">
                            {reservation.time} · {reservation.customerName}
                          </span>
                          <span className="block text-xs text-slate-500">
                            {reservation.covers} covers · {reservation.status}
                          </span>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-10 text-center text-sm text-slate-500">
              <Armchair className="mb-2 h-6 w-6 text-slate-300" />
              Select a table to see its status, area and bookings.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
