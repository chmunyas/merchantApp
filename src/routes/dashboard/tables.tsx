import { createFileRoute } from "@tanstack/react-router";
import { LayoutGrid, Layers, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import type {
  Area,
  TableCombination,
  Zone,
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
  DEFAULT_TABLE_CAPACITY,
  ensureMerchantDemoData,
  getBookableTables,
  getCombinationSeats,
  getTableZone,
  isTableBookable,
  pickCombinationForParty,
  saveMerchantAreas,
  saveMerchantTableCombinations,
  saveMerchantTables,
  tableLabel,
  tableSeats,
  type MerchantTable,
} from "@/lib/merchant-dashboard";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/tables")({
  component: DashboardTablesPage,
});

type TabKey = "tables" | "combinations" | "areas";

const TAB_OPTIONS: Array<{ key: TabKey; label: string }> = [
  { key: "tables", label: "Tables" },
  { key: "combinations", label: "Combinations" },
  { key: "areas", label: "Areas" },
];

const PRIORITIES = [1, 2, 3, 4, 5] as const;

function createId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function upsertById<T extends { id: string }>(items: T[], nextItem: T) {
  const exists = items.some((item) => item.id === nextItem.id);
  return exists
    ? items.map((item) => (item.id === nextItem.id ? nextItem : item))
    : [...items, nextItem];
}

function removeById<T extends { id: string }>(items: T[], id: string) {
  return items.filter((item) => item.id !== id);
}

function nextTableNumber(tables: MerchantTable[]) {
  return tables.reduce((max, table) => Math.max(max, table.tableNumber), 0) + 1;
}

function createEmptyTable(tables: MerchantTable[]): MerchantTable {
  return {
    id: createId("table"),
    tableNumber: nextTableNumber(tables),
    capacity: DEFAULT_TABLE_CAPACITY,
    name: "",
    bookable: true,
    server: "",
    items: [],
    status: "open",
    openedAt: new Date().toISOString(),
    paidAmount: 0,
    payments: [],
  };
}

function createEmptyCombination(): TableCombination {
  return {
    id: createId("combo"),
    name: "",
    tableNumbers: [],
    minCapacity: 2,
    maxCapacity: 8,
    priority: 3,
    active: true,
  };
}

function toggleNumber(values: number[], value: number) {
  return values.includes(value)
    ? values.filter((entry) => entry !== value)
    : [...values, value].sort((a, b) => a - b);
}

const STATUS_STYLES: Record<string, string> = {
  open: "bg-emerald-100 text-emerald-700",
  "requesting-bill": "bg-amber-100 text-amber-700",
  "partially-paid": "bg-blue-100 text-blue-700",
  closed: "bg-slate-200 text-slate-700",
};

function createEmptyArea(): Area {
  return {
    id: createId("area"),
    name: "",
    hiddenFromDayPlanner: false,
    tableNumbers: [],
    order: 99,
  };
}

function DashboardTablesPage() {
  const [hydrated, setHydrated] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>("tables");
  const [tables, setTables] = useState<MerchantTable[]>([]);
  const [combinations, setCombinations] = useState<TableCombination[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [tableDraft, setTableDraft] = useState<MerchantTable | null>(null);
  const [comboDraft, setComboDraft] = useState<TableCombination | null>(null);
  const [previewCovers, setPreviewCovers] = useState(6);
  const [areas, setAreas] = useState<Area[]>([]);
  const [areaDraft, setAreaDraft] = useState<Area | null>(null);

  useEffect(() => {
    const snapshot = ensureMerchantDemoData();
    setTables(snapshot.tables);
    setCombinations(snapshot.tableCombinations);
    setZones(snapshot.zones);
    setAreas(snapshot.areas);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    saveMerchantTables(tables);
  }, [hydrated, tables]);

  useEffect(() => {
    if (!hydrated) return;
    saveMerchantTableCombinations(combinations);
  }, [combinations, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    saveMerchantAreas(areas);
  }, [areas, hydrated]);

  const sortedTables = useMemo(
    () => [...tables].sort((a, b) => a.tableNumber - b.tableNumber),
    [tables],
  );

  const bookableTables = useMemo(
    () => getBookableTables(sortedTables),
    [sortedTables],
  );

  const totalSeats = useMemo(
    () => tables.reduce((sum, table) => sum + tableSeats(table), 0),
    [tables],
  );

  const previewMatch = useMemo(
    () => pickCombinationForParty(combinations, previewCovers),
    [combinations, previewCovers],
  );

  function handleSaveTable() {
    if (!tableDraft) return;
    const tableNumber = Number(tableDraft.tableNumber);
    const capacity = Number(tableDraft.capacity ?? DEFAULT_TABLE_CAPACITY);
    if (!tableNumber || tableNumber < 1) {
      toast.error("Enter a valid table number.");
      return;
    }
    if (!capacity || capacity < 1) {
      toast.error("Seats must be at least 1.");
      return;
    }
    const duplicate = tables.some(
      (table) =>
        table.tableNumber === tableNumber && table.id !== tableDraft.id,
    );
    if (duplicate) {
      toast.error(`Table ${tableNumber} already exists.`);
      return;
    }
    setTables((current) =>
      upsertById(current, { ...tableDraft, tableNumber, capacity }),
    );
    toast.success(`Table ${tableNumber} saved.`);
    setTableDraft(null);
  }

  function handleDeleteTable(table: MerchantTable) {
    setTables((current) => removeById(current, table.id));
    setCombinations((current) =>
      current.map((combo) => ({
        ...combo,
        tableNumbers: combo.tableNumbers.filter(
          (number) => number !== table.tableNumber,
        ),
      })),
    );
    if (tableDraft?.id === table.id) setTableDraft(null);
    toast.success(`Table ${table.tableNumber} removed.`);
  }

  function handleSaveCombination() {
    if (!comboDraft) return;
    const name = comboDraft.name.trim();
    if (!name) {
      toast.error("Give the combination a name.");
      return;
    }
    if (comboDraft.tableNumbers.length < 2) {
      toast.error("Select at least two tables to combine.");
      return;
    }
    const minCapacity = Number(comboDraft.minCapacity) || 1;
    const maxCapacity = Number(comboDraft.maxCapacity) || minCapacity;
    if (maxCapacity < minCapacity) {
      toast.error("Max capacity must be greater than or equal to min.");
      return;
    }
    setCombinations((current) =>
      upsertById(current, { ...comboDraft, name, minCapacity, maxCapacity }),
    );
    toast.success(`Combination "${name}" saved.`);
    setComboDraft(null);
  }

  function handleSaveArea() {
    if (!areaDraft) return;
    const name = areaDraft.name.trim();
    if (!name) {
      toast.error("Give the area a name.");
      return;
    }
    setAreas((current) => upsertById(current, { ...areaDraft, name }));
    toast.success(`Area "${name}" saved.`);
    setAreaDraft(null);
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryCard
          icon={LayoutGrid}
          label="Tables"
          value={tables.length.toString()}
          accent="text-emerald-500"
        />
        <SummaryCard
          icon={Users}
          label="Total seats"
          value={totalSeats.toString()}
          accent="text-blue-500"
        />
        <SummaryCard
          icon={Layers}
          label="Active combinations"
          value={combinations.filter((combo) => combo.active).length.toString()}
          accent="text-purple-500"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {TAB_OPTIONS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              "rounded-full px-4 py-2 text-sm font-medium transition",
              activeTab === tab.key
                ? "bg-slate-900 text-white"
                : "bg-white text-slate-600 hover:bg-slate-100",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "tables" ? (
        <div className="grid gap-6 xl:grid-cols-[0.85fr_1.15fr]">
          <Card className="border-slate-200 bg-white/90 shadow-sm">
            <CardHeader>
              <CardTitle>
                {tableDraft && tables.some((t) => t.id === tableDraft.id)
                  ? `Edit table ${tableDraft.tableNumber}`
                  : "Create table"}
              </CardTitle>
              <CardDescription>
                Set the table number and how many guests it seats. Seats power
                booking capacity and combinations.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Table number">
                    <Input
                      type="number"
                      min="1"
                      value={tableDraft?.tableNumber ?? nextTableNumber(tables)}
                      onChange={(event) =>
                        setTableDraft((current) => ({
                          ...(current ?? createEmptyTable(tables)),
                          tableNumber: Number(event.target.value) || 1,
                        }))
                      }
                    />
                  </Field>
                  <Field label="Seats (capacity)">
                    <Input
                      type="number"
                      min="1"
                      value={tableDraft?.capacity ?? DEFAULT_TABLE_CAPACITY}
                      onChange={(event) =>
                        setTableDraft((current) => ({
                          ...(current ?? createEmptyTable(tables)),
                          capacity: Number(event.target.value) || 1,
                        }))
                      }
                    />
                  </Field>
                </div>
                <Field label="Table name (optional)">
                  <Input
                    value={tableDraft?.name ?? ""}
                    onChange={(event) =>
                      setTableDraft((current) => ({
                        ...(current ?? createEmptyTable(tables)),
                        name: event.target.value,
                      }))
                    }
                    placeholder="Bar 1 / Patio A"
                  />
                </Field>
                <Field label="Server (optional)">
                  <Input
                    value={tableDraft?.server ?? ""}
                    onChange={(event) =>
                      setTableDraft((current) => ({
                        ...(current ?? createEmptyTable(tables)),
                        server: event.target.value,
                      }))
                    }
                    placeholder="Grace M."
                  />
                </Field>
                <label className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-slate-800">
                      Bookable
                    </p>
                    <p className="text-xs text-slate-500">
                      Allow this table to be reserved and combined.
                    </p>
                  </div>
                  <Switch
                    checked={tableDraft?.bookable ?? true}
                    onCheckedChange={(checked) =>
                      setTableDraft((current) => ({
                        ...(current ?? createEmptyTable(tables)),
                        bookable: checked,
                      }))
                    }
                  />
                </label>
                <div className="flex justify-end gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setTableDraft(createEmptyTable(tables))}
                  >
                    Reset
                  </Button>
                  <Button type="button" onClick={handleSaveTable}>
                    Save table
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {sortedTables.map((table) => {
              const zone = getTableZone(zones, table.tableNumber);
              return (
                <Card
                  key={table.id}
                  className="border-slate-200 bg-white/90 shadow-sm"
                >
                  <CardContent className="space-y-3 p-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                          Table
                        </p>
                        <p className="text-2xl font-semibold text-slate-950">
                          {table.tableNumber}
                        </p>
                        {table.name ? (
                          <p className="text-xs text-slate-500">{table.name}</p>
                        ) : null}
                      </div>
                      <span
                        className={cn(
                          "rounded-full px-2.5 py-1 text-xs font-medium",
                          STATUS_STYLES[table.status] ??
                            "bg-slate-200 text-slate-700",
                        )}
                      >
                        {table.status.replace("-", " ")}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-slate-600">
                      <Users className="h-4 w-4" /> {tableSeats(table)} seats
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {isTableBookable(table) ? null : (
                        <Badge
                          variant="outline"
                          className="border-amber-200 text-amber-700"
                        >
                          Not bookable
                        </Badge>
                      )}
                      {zone ? (
                        <Badge
                          variant="outline"
                          className="border-slate-200 text-slate-600"
                        >
                          {zone.name}
                        </Badge>
                      ) : null}
                      {table.server ? (
                        <Badge
                          variant="outline"
                          className="border-slate-200 text-slate-600"
                        >
                          {table.server}
                        </Badge>
                      ) : null}
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setTableDraft(table)}
                      >
                        Edit
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="border-rose-200 text-rose-600 hover:bg-rose-50"
                        onClick={() => handleDeleteTable(table)}
                      >
                        Delete
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      ) : null}

      {activeTab === "combinations" ? (
        <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
          <Card className="border-slate-200 bg-white/90 shadow-sm">
            <CardHeader>
              <CardTitle>
                {comboDraft && combinations.some((c) => c.id === comboDraft.id)
                  ? "Edit combination"
                  : "Create combination"}
              </CardTitle>
              <CardDescription>
                Merge several tables to seat larger parties, then set the
                capacity window, booking priority and whether it is active.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <Field label="Combination name">
                  <Input
                    value={comboDraft?.name ?? ""}
                    onChange={(event) =>
                      setComboDraft((current) => ({
                        ...(current ?? createEmptyCombination()),
                        name: event.target.value,
                      }))
                    }
                    placeholder="Bar Area"
                  />
                </Field>

                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-4">
                    <p className="text-sm font-medium text-slate-700">
                      Tables in this combination
                    </p>
                    <Badge
                      variant="outline"
                      className="border-slate-200 text-slate-600"
                    >
                      {comboDraft
                        ? getCombinationSeats(comboDraft, tables)
                        : 0}{" "}
                      seats
                    </Badge>
                  </div>
                  <div className="grid max-h-56 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
                    {bookableTables.map((table) => {
                      const selected =
                        comboDraft?.tableNumbers.includes(table.tableNumber) ??
                        false;
                      return (
                        <button
                          key={table.id}
                          type="button"
                          onClick={() =>
                            setComboDraft((current) => ({
                              ...(current ?? createEmptyCombination()),
                              tableNumbers: toggleNumber(
                                current?.tableNumbers ?? [],
                                table.tableNumber,
                              ),
                            }))
                          }
                          className={cn(
                            "rounded-2xl border px-3 py-2 text-left text-sm transition",
                            selected
                              ? "border-emerald-300 bg-emerald-50"
                              : "border-slate-200 bg-white hover:bg-slate-50",
                          )}
                        >
                          <span className="block font-medium text-slate-900">
                            {tableLabel(table)}
                          </span>
                          <span className="block text-xs text-slate-500">
                            {tableSeats(table)} seats
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Min capacity">
                    <Input
                      type="number"
                      min="1"
                      value={comboDraft?.minCapacity ?? 2}
                      onChange={(event) =>
                        setComboDraft((current) => ({
                          ...(current ?? createEmptyCombination()),
                          minCapacity: Number(event.target.value) || 1,
                        }))
                      }
                    />
                  </Field>
                  <Field label="Max capacity">
                    <Input
                      type="number"
                      min="1"
                      value={comboDraft?.maxCapacity ?? 8}
                      onChange={(event) =>
                        setComboDraft((current) => ({
                          ...(current ?? createEmptyCombination()),
                          maxCapacity: Number(event.target.value) || 1,
                        }))
                      }
                    />
                  </Field>
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-medium text-slate-700">
                    Priority
                    <span className="ml-1 text-xs font-normal text-slate-400">
                      (1 lowest · 5 highest)
                    </span>
                  </p>
                  <div className="flex gap-2">
                    {PRIORITIES.map((priority) => {
                      const active =
                        (comboDraft?.priority ?? 3) === priority;
                      return (
                        <button
                          key={priority}
                          type="button"
                          onClick={() =>
                            setComboDraft((current) => ({
                              ...(current ?? createEmptyCombination()),
                              priority,
                            }))
                          }
                          className={cn(
                            "h-10 w-10 rounded-xl border text-sm font-semibold transition",
                            active
                              ? "border-slate-900 bg-slate-900 text-white"
                              : "border-slate-200 bg-white text-slate-600 hover:bg-slate-100",
                          )}
                        >
                          {priority}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <label className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-slate-800">Active</p>
                    <p className="text-xs text-slate-500">
                      Enable bookings for this combination.
                    </p>
                  </div>
                  <Switch
                    checked={comboDraft?.active ?? true}
                    onCheckedChange={(checked) =>
                      setComboDraft((current) => ({
                        ...(current ?? createEmptyCombination()),
                        active: checked,
                      }))
                    }
                  />
                </label>

                <div className="flex justify-end gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setComboDraft(createEmptyCombination())}
                  >
                    Reset
                  </Button>
                  <Button type="button" onClick={handleSaveCombination}>
                    Save combination
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-4">
            <Card className="border-slate-200 bg-white/90 shadow-sm">
              <CardContent className="space-y-3 p-5">
                <p className="text-sm font-semibold text-slate-800">
                  Booking allocation preview
                </p>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-slate-600">Party of</span>
                  <Input
                    type="number"
                    min="1"
                    value={previewCovers}
                    onChange={(event) =>
                      setPreviewCovers(Number(event.target.value) || 1)
                    }
                    className="w-24"
                  />
                </div>
                <p className="text-sm text-slate-600">
                  {previewMatch ? (
                    <>
                      Best fit:{" "}
                      <span className="font-semibold text-emerald-600">
                        {previewMatch.name}
                      </span>{" "}
                      (priority {previewMatch.priority},{" "}
                      {previewMatch.minCapacity}–{previewMatch.maxCapacity} pax)
                    </>
                  ) : (
                    <span className="text-slate-500">
                      No active combination fits {previewCovers} guests.
                    </span>
                  )}
                </p>
              </CardContent>
            </Card>

            {combinations.length === 0 ? (
              <Card className="border-dashed border-slate-300 bg-white/60">
                <CardContent className="p-6 text-center text-sm text-slate-500">
                  No combinations yet. Merge tables on the left to seat larger
                  parties.
                </CardContent>
              </Card>
            ) : (
              combinations.map((combo) => (
                <Card
                  key={combo.id}
                  className={cn(
                    "border-l-4 bg-white/90 shadow-sm",
                    combo.active ? "border-emerald-400" : "border-slate-200",
                  )}
                >
                  <CardContent className="space-y-4 p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h3 className="text-lg font-semibold text-slate-950">
                          {combo.name}
                        </h3>
                        <p className="mt-1 text-sm text-slate-500">
                          {combo.minCapacity}–{combo.maxCapacity} guests ·{" "}
                          {getCombinationSeats(combo, tables)} seats · priority{" "}
                          {combo.priority}
                        </p>
                      </div>
                      <Switch
                        checked={combo.active}
                        onCheckedChange={(checked) =>
                          setCombinations((current) =>
                            current.map((entry) =>
                              entry.id === combo.id
                                ? { ...entry, active: checked }
                                : entry,
                            ),
                          )
                        }
                      />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {combo.tableNumbers.map((tableNumber) => (
                        <Badge
                          key={`${combo.id}-${tableNumber}`}
                          variant="outline"
                          className="border-slate-200 text-slate-600"
                        >
                          Table {tableNumber}
                        </Badge>
                      ))}
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setComboDraft(combo)}
                      >
                        Edit
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="border-rose-200 text-rose-600 hover:bg-rose-50"
                        onClick={() =>
                          setCombinations((current) =>
                            removeById(current, combo.id),
                          )
                        }
                      >
                        Delete
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </div>
      ) : null}

      {activeTab === "areas" ? (
        <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
          <Card className="border-slate-200 bg-white/90 shadow-sm">
            <CardHeader>
              <CardTitle>
                {areaDraft && areas.some((a) => a.id === areaDraft.id)
                  ? "Edit area"
                  : "Create area"}
              </CardTitle>
              <CardDescription>
                Group tables into areas (Terrace, Bar, Main Dining). Areas
                organise the Day Planner so staff see bookings by section.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-5">
                <div className="space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                    Basic information
                  </p>
                  <Field label="Area name">
                    <Input
                      value={areaDraft?.name ?? ""}
                      onChange={(event) =>
                        setAreaDraft((current) => ({
                          ...(current ?? createEmptyArea()),
                          name: event.target.value,
                        }))
                      }
                      placeholder="Terrace"
                    />
                  </Field>
                </div>

                <div className="space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                    Visibility &amp; configuration
                  </p>
                  <label className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3">
                    <div>
                      <p className="text-sm font-medium text-slate-800">
                        Hidden from Day Planner
                      </p>
                      <p className="text-xs text-slate-500">
                        Hide this area from the Day Planner view.
                      </p>
                    </div>
                    <Switch
                      checked={areaDraft?.hiddenFromDayPlanner ?? false}
                      onCheckedChange={(checked) =>
                        setAreaDraft((current) => ({
                          ...(current ?? createEmptyArea()),
                          hiddenFromDayPlanner: checked,
                        }))
                      }
                    />
                  </label>
                  <Field label="Display order">
                    <Input
                      type="number"
                      min="1"
                      value={areaDraft?.order ?? 99}
                      onChange={(event) =>
                        setAreaDraft((current) => ({
                          ...(current ?? createEmptyArea()),
                          order: Number(event.target.value) || 1,
                        }))
                      }
                    />
                  </Field>
                </div>

                <div className="space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                    Tables &amp; assignment
                  </p>
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-slate-700">
                      Available tables
                    </p>
                    <Badge
                      variant="outline"
                      className="border-slate-200 text-slate-600"
                    >
                      {(areaDraft?.tableNumbers ?? []).length} selected
                    </Badge>
                  </div>
                  <p className="text-xs text-slate-500">
                    Select tables to associate with this area.
                  </p>
                  <div className="grid max-h-56 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
                    {sortedTables.map((table) => {
                      const selected =
                        areaDraft?.tableNumbers.includes(table.tableNumber) ??
                        false;
                      return (
                        <button
                          key={table.id}
                          type="button"
                          onClick={() =>
                            setAreaDraft((current) => ({
                              ...(current ?? createEmptyArea()),
                              tableNumbers: toggleNumber(
                                current?.tableNumbers ?? [],
                                table.tableNumber,
                              ),
                            }))
                          }
                          className={cn(
                            "rounded-2xl border px-3 py-2 text-left text-sm transition",
                            selected
                              ? "border-emerald-300 bg-emerald-50"
                              : "border-slate-200 bg-white hover:bg-slate-50",
                          )}
                        >
                          <span className="block font-medium text-slate-900">
                            {tableLabel(table)}
                          </span>
                          <span className="block text-xs text-slate-500">
                            {tableSeats(table)} seats
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="flex justify-end gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setAreaDraft(createEmptyArea())}
                  >
                    Reset
                  </Button>
                  <Button type="button" onClick={handleSaveArea}>
                    Save area
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-4">
            {areas.length === 0 ? (
              <Card className="border-dashed border-slate-300 bg-white/60">
                <CardContent className="p-6 text-center text-sm text-slate-500">
                  No areas yet. Create one to group your tables.
                </CardContent>
              </Card>
            ) : (
              [...areas]
                .sort((a, b) => a.order - b.order)
                .map((area) => (
                  <Card
                    key={area.id}
                    className="border-slate-200 bg-white/90 shadow-sm"
                  >
                    <CardContent className="space-y-3 p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="text-lg font-semibold text-slate-950">
                            {area.name}
                          </h3>
                          <p className="mt-1 text-sm text-slate-500">
                            {area.tableNumbers.length} tables · order{" "}
                            {area.order}
                          </p>
                        </div>
                        {area.hiddenFromDayPlanner ? (
                          <Badge
                            variant="outline"
                            className="border-amber-200 text-amber-700"
                          >
                            Hidden
                          </Badge>
                        ) : (
                          <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
                            In Day Planner
                          </Badge>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {area.tableNumbers.map((tableNumber) => (
                          <Badge
                            key={`${area.id}-${tableNumber}`}
                            variant="outline"
                            className="border-slate-200 text-slate-600"
                          >
                            Table {tableNumber}
                          </Badge>
                        ))}
                      </div>
                      <div className="flex justify-end gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setAreaDraft(area)}
                        >
                          Edit
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="border-rose-200 text-rose-600 hover:bg-rose-50"
                          onClick={() =>
                            setAreas((current) => removeById(current, area.id))
                          }
                        >
                          Delete
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: typeof LayoutGrid;
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{label}</p>
        <Icon className={cn("h-5 w-5", accent)} />
      </div>
      <p className="mt-3 font-mono text-2xl font-semibold">{value}</p>
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
