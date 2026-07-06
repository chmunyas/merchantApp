import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, PackagePlus, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { authFetch } from "@/lib/auth";

export const Route = createFileRoute("/dashboard/inventory")({
  component: DashboardInventoryPage,
});

type InventoryItem = {
  id: string;
  name: string;
  sku?: string | null;
  unit: string;
  stock: number | string;
  reorder_level: number | string;
  cost: number | string;
  supplier?: string | null;
  menu_item_id?: string | null;
  active: boolean;
  created_at?: string;
  updated_at?: string;
};

type InventoryDraft = {
  id?: string;
  name: string;
  sku: string;
  unit: string;
  stock: string;
  reorder_level: string;
  costKes: string;
  supplier: string;
  menu_item_id: string;
};

const currency = new Intl.NumberFormat("en-KE", {
  style: "currency",
  currency: "KES",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function emptyDraft(): InventoryDraft {
  return {
    name: "",
    sku: "",
    unit: "unit",
    stock: "0",
    reorder_level: "0",
    costKes: "0",
    supplier: "",
    menu_item_id: "",
  };
}

function toNumber(value: number | string | null | undefined): number {
  const next = Number(value ?? 0);
  return Number.isFinite(next) ? next : 0;
}

function formatCost(cost: number | string) {
  return currency.format(toNumber(cost) / 100);
}

function toMinorUnits(value: string): number {
  const next = Number(value);
  return Number.isFinite(next) ? Math.round(next * 100) : 0;
}

function draftFromItem(item: InventoryItem): InventoryDraft {
  return {
    id: item.id,
    name: item.name,
    sku: item.sku ?? "",
    unit: item.unit,
    stock: String(item.stock ?? 0),
    reorder_level: String(item.reorder_level ?? 0),
    costKes: String(toNumber(item.cost) / 100),
    supplier: item.supplier ?? "",
    menu_item_id: item.menu_item_id ?? "",
  };
}

function lowStock(item: InventoryItem) {
  return toNumber(item.stock) <= toNumber(item.reorder_level);
}

function DashboardInventoryPage() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [draft, setDraft] = useState<InventoryDraft>(emptyDraft);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const lowStockCount = useMemo(
    () => items.filter((item) => lowStock(item)).length,
    [items],
  );

  async function loadItems() {
    setLoading(true);
    try {
      const res = await authFetch("/api/inventory");
      if (!res.ok) throw new Error("inventory load failed");
      const data = (await res.json()) as { items?: InventoryItem[] };
      setItems(data.items ?? []);
    } catch {
      toast.error("Could not load inventory.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadItems();
  }, []);

  async function saveItem() {
    const name = draft.name.trim();
    if (!name) {
      toast.error("Item name is required.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name,
        sku: draft.sku.trim() || null,
        unit: draft.unit.trim() || "unit",
        stock: Number(draft.stock) || 0,
        reorder_level: Number(draft.reorder_level) || 0,
        cost: toMinorUnits(draft.costKes),
        supplier: draft.supplier.trim() || null,
        menu_item_id: draft.menu_item_id.trim() || null,
      };
      const res = await authFetch(
        draft.id ? `/api/inventory/${draft.id}` : "/api/inventory",
        {
          method: draft.id ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      if (!res.ok) throw new Error("inventory save failed");
      const data = (await res.json()) as { item?: InventoryItem };
      const savedItem = data.item;
      if (savedItem) {
        setItems((current) =>
          draft.id
            ? current.map((item) => (item.id === savedItem.id ? savedItem : item))
            : [...current, savedItem],
        );
      }
      setDraft(emptyDraft());
      toast.success("Inventory item saved.");
    } catch {
      toast.error("Could not save inventory item.");
    } finally {
      setSaving(false);
    }
  }

  async function adjustItem(item: InventoryItem, delta: number) {
    try {
      const res = await authFetch(`/api/inventory/${item.id}/adjust`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          delta,
          reason: delta > 0 ? "Quick stock increase" : "Quick stock decrease",
        }),
      });
      if (!res.ok) throw new Error("stock adjust failed");
      const data = (await res.json()) as { item?: InventoryItem };
      const adjustedItem = data.item;
      if (adjustedItem) {
        setItems((current) =>
          current.map((entry) =>
            entry.id === adjustedItem.id ? adjustedItem : entry,
          ),
        );
      }
    } catch {
      toast.error("Could not adjust stock.");
    }
  }

  async function deleteItem(item: InventoryItem) {
    try {
      const res = await authFetch(`/api/inventory/${item.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("inventory delete failed");
      setItems((current) => current.filter((entry) => entry.id !== item.id));
      if (draft.id === item.id) setDraft(emptyDraft());
      toast.success("Inventory item deleted.");
    } catch {
      toast.error("Could not delete inventory item.");
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="border-slate-200 bg-white/90 shadow-sm">
          <CardContent className="flex items-center gap-3 p-5">
            <PackagePlus className="h-8 w-8 text-emerald-500" />
            <div>
              <p className="text-sm text-slate-500">Active items</p>
              <p className="text-2xl font-semibold text-slate-900">
                {items.length}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-slate-200 bg-white/90 shadow-sm">
          <CardContent className="flex items-center gap-3 p-5">
            <AlertTriangle className="h-8 w-8 text-red-500" />
            <div>
              <p className="text-sm text-slate-500">Low stock alerts</p>
              <p className="text-2xl font-semibold text-slate-900">
                {lowStockCount}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-slate-200 bg-white/90 shadow-sm">
          <CardContent className="flex items-center justify-between gap-3 p-5">
            <div>
              <p className="text-sm text-slate-500">Server inventory</p>
              <p className="text-2xl font-semibold text-slate-900">
                {loading ? "Loading" : "Synced"}
              </p>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={loadItems}>
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.75fr_1.25fr]">
        <Card className="border-slate-200 bg-white/90 shadow-sm">
          <CardHeader>
            <CardTitle>{draft.id ? "Edit item" : "Add inventory item"}</CardTitle>
            <CardDescription>
              Track stock, reorder levels, supplier, and COGS per unit.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="Name">
              <Input
                value={draft.name}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, name: event.target.value }))
                }
                placeholder="Unga wa Dola 2kg"
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="SKU">
                <Input
                  value={draft.sku}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, sku: event.target.value }))
                  }
                  placeholder="SKU-001"
                />
              </Field>
              <Field label="Unit">
                <Input
                  value={draft.unit}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, unit: event.target.value }))
                  }
                  placeholder="unit / kg / carton"
                />
              </Field>
              <Field label="Stock">
                <Input
                  type="number"
                  step="0.01"
                  value={draft.stock}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, stock: event.target.value }))
                  }
                />
              </Field>
              <Field label="Reorder level">
                <Input
                  type="number"
                  step="0.01"
                  value={draft.reorder_level}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      reorder_level: event.target.value,
                    }))
                  }
                />
              </Field>
              <Field label="COGS per unit (KES)">
                <Input
                  type="number"
                  step="0.01"
                  value={draft.costKes}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      costKes: event.target.value,
                    }))
                  }
                />
              </Field>
              <Field label="Supplier">
                <Input
                  value={draft.supplier}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      supplier: event.target.value,
                    }))
                  }
                  placeholder="Supplier name"
                />
              </Field>
            </div>
            <Field label="Linked menu item UUID (optional)">
              <Input
                value={draft.menu_item_id}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    menu_item_id: event.target.value,
                  }))
                }
                placeholder="menu_items.id"
              />
            </Field>
            <div className="flex justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => setDraft(emptyDraft())}
              >
                Reset
              </Button>
              <Button type="button" onClick={saveItem} disabled={saving}>
                {saving ? "Saving..." : "Save item"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white/90 shadow-sm">
          <CardHeader>
            <CardTitle>Inventory</CardTitle>
            <CardDescription>
              Low-stock items are highlighted when stock is at or below reorder.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Stock</TableHead>
                  <TableHead>Reorder</TableHead>
                  <TableHead>COGS</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-slate-900">
                            {item.name}
                          </span>
                          {lowStock(item) ? (
                            <Badge variant="destructive">Low stock</Badge>
                          ) : null}
                        </div>
                        <p className="text-xs text-slate-500">
                          {item.sku || "No SKU"} · {item.unit}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>{toNumber(item.stock)}</TableCell>
                    <TableCell>{toNumber(item.reorder_level)}</TableCell>
                    <TableCell>{formatCost(item.cost)}</TableCell>
                    <TableCell>{item.supplier || "—"}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => adjustItem(item, -1)}
                        >
                          -1
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => adjustItem(item, 1)}
                        >
                          +1
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => setDraft(draftFromItem(item))}
                        >
                          Edit
                        </Button>
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          onClick={() => deleteItem(item)}
                        >
                          Delete
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {!items.length ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="py-8 text-center text-sm text-slate-500"
                    >
                      {loading ? "Loading inventory..." : "No inventory items yet."}
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="space-y-2">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}
