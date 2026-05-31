import { createFileRoute } from "@tanstack/react-router";
import { Grid2X2, List, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import type { CatalogueItem } from "@/components/merchant/features/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  ensureMerchantDemoData,
  loadMerchantSnapshot,
  saveMerchantCatalogue,
  type MerchantSnapshot,
} from "@/lib/merchant-dashboard";

export const Route = createFileRoute("/dashboard/menu")({
  component: DashboardMenuPage,
});

type CategoryFilter =
  | "All"
  | "Mains"
  | "Sides"
  | "Drinks"
  | "Cocktails"
  | "Desserts";
type ViewMode = "grid" | "list";

const dietaryOptions = ["vegan", "vegetarian", "gluten-free", "halal"];

function generateDemoData() {
  return ensureMerchantDemoData();
}

function DashboardMenuPage() {
  const [snapshot, setSnapshot] = useState<MerchantSnapshot | null>(null);
  const [category, setCategory] = useState<CategoryFilter>("All");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftItem, setDraftItem] = useState<CatalogueItem>({
    id: "",
    name: "",
    price: 0,
    category: "Mains",
    dietary: [],
    destination: "kitchen",
  });
  const [bulkCategory, setBulkCategory] = useState("Mains");
  const [bulkDestination, setBulkDestination] = useState<"kitchen" | "bar">(
    "kitchen",
  );

  useEffect(() => {
    generateDemoData();
    setSnapshot(loadMerchantSnapshot());
  }, []);

  const items = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.catalogue.filter((item) => {
      const matchesCategory = category === "All" || item.category === category;
      const matchesSearch =
        !search || item.name.toLowerCase().includes(search.toLowerCase());
      return matchesCategory && matchesSearch;
    });
  }, [snapshot, category, search]);

  function persistCatalogue(nextCatalogue: CatalogueItem[]) {
    if (!snapshot) return;
    saveMerchantCatalogue(nextCatalogue);
    setSnapshot({ ...snapshot, catalogue: nextCatalogue });
  }

  function resetDraft() {
    setDraftItem({
      id: "",
      name: "",
      price: 0,
      category: "Mains",
      dietary: [],
      destination: "kitchen",
    });
  }

  function addItem() {
    if (!snapshot || !draftItem.name.trim()) return;
    const nextItem = { ...draftItem, id: `item-${Date.now()}` };
    persistCatalogue([nextItem, ...snapshot.catalogue]);
    toast.success(`${nextItem.name} added to catalogue`);
    setAddOpen(false);
    resetDraft();
  }

  function saveInline(id: string, key: "name" | "price", value: string) {
    if (!snapshot) return;
    const nextCatalogue = snapshot.catalogue.map((item) =>
      item.id === id
        ? { ...item, [key]: key === "price" ? Number(value) : value }
        : item,
    );
    persistCatalogue(nextCatalogue);
  }

  function toggleSelection(id: string) {
    setSelectedIds((current) =>
      current.includes(id)
        ? current.filter((entry) => entry !== id)
        : [...current, id],
    );
  }

  function applyBulkChanges(mode: "delete" | "category" | "destination") {
    if (!snapshot || !selectedIds.length) return;
    let nextCatalogue = snapshot.catalogue;
    if (mode === "delete")
      nextCatalogue = snapshot.catalogue.filter(
        (item) => !selectedIds.includes(item.id),
      );
    if (mode === "category") {
      nextCatalogue = snapshot.catalogue.map((item) =>
        selectedIds.includes(item.id)
          ? { ...item, category: bulkCategory }
          : item,
      );
    }
    if (mode === "destination") {
      nextCatalogue = snapshot.catalogue.map((item) =>
        selectedIds.includes(item.id)
          ? { ...item, destination: bulkDestination }
          : item,
      );
    }
    persistCatalogue(nextCatalogue);
    setSelectedIds([]);
    toast.success("Bulk update complete");
  }

  if (!snapshot) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6">
        Loading menu…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border bg-card p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2">
            {(
              [
                "All",
                "Mains",
                "Sides",
                "Drinks",
                "Cocktails",
                "Desserts",
              ] as CategoryFilter[]
            ).map((item) => (
              <button
                key={item}
                onClick={() => setCategory(item)}
                className={`rounded-full px-4 py-2 text-sm font-medium ${category === item ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"}`}
              >
                {item}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="relative min-w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search menu items"
                className="pl-9"
              />
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-border p-1">
              <Button
                size="icon"
                variant={viewMode === "grid" ? "default" : "ghost"}
                onClick={() => setViewMode("grid")}
              >
                <Grid2X2 className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant={viewMode === "list" ? "default" : "ghost"}
                onClick={() => setViewMode("list")}
              >
                <List className="h-4 w-4" />
              </Button>
            </div>
            <Button onClick={() => setAddOpen(true)} className="gap-2">
              <Plus className="h-4 w-4" /> Add item
            </Button>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="text-sm text-muted-foreground">
            {selectedIds.length} items selected
          </div>
          <div className="flex flex-wrap gap-2">
            <select
              value={bulkCategory}
              onChange={(event) => setBulkCategory(event.target.value)}
              className="rounded-xl border border-border bg-background px-3 py-2 text-sm"
            >
              <option>Mains</option>
              <option>Sides</option>
              <option>Drinks</option>
              <option>Cocktails</option>
              <option>Desserts</option>
            </select>
            <Button
              variant="outline"
              onClick={() => applyBulkChanges("category")}
            >
              Change category
            </Button>
            <select
              value={bulkDestination}
              onChange={(event) =>
                setBulkDestination(event.target.value as "kitchen" | "bar")
              }
              className="rounded-xl border border-border bg-background px-3 py-2 text-sm"
            >
              <option value="kitchen">Kitchen</option>
              <option value="bar">Bar</option>
            </select>
            <Button
              variant="outline"
              onClick={() => applyBulkChanges("destination")}
            >
              Change destination
            </Button>
            <Button
              variant="destructive"
              onClick={() => applyBulkChanges("delete")}
              className="gap-2"
            >
              <Trash2 className="h-4 w-4" /> Delete
            </Button>
          </div>
        </div>
      </div>

      <div
        className={
          viewMode === "grid"
            ? "grid gap-4 md:grid-cols-2 xl:grid-cols-3"
            : "space-y-3"
        }
      >
        {items.map((item) => (
          <div
            key={item.id}
            className="rounded-2xl border border-border bg-card p-5"
          >
            <div className="flex items-start justify-between gap-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selectedIds.includes(item.id)}
                  onChange={() => toggleSelection(item.id)}
                />
                Select
              </label>
              <Button
                size="icon"
                variant="ghost"
                onClick={() =>
                  setEditingId((current) =>
                    current === item.id ? null : item.id,
                  )
                }
              >
                <Pencil className="h-4 w-4" />
              </Button>
            </div>
            <div
              className={
                viewMode === "list"
                  ? "mt-3 flex flex-wrap items-center justify-between gap-4"
                  : "mt-4"
              }
            >
              <div className="space-y-2">
                {editingId === item.id ? (
                  <Input
                    defaultValue={item.name}
                    onBlur={(event) =>
                      saveInline(item.id, "name", event.target.value)
                    }
                  />
                ) : (
                  <h3 className="text-lg font-semibold">{item.name}</h3>
                )}
                <div className="flex flex-wrap gap-2">
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium">
                    {item.category}
                  </span>
                  <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-medium text-blue-700">
                    {item.destination}
                  </span>
                  {(item.dietary || []).map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-700"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
              <div className="min-w-32">
                {editingId === item.id ? (
                  <Input
                    type="number"
                    defaultValue={item.price}
                    onBlur={(event) =>
                      saveInline(item.id, "price", event.target.value)
                    }
                  />
                ) : (
                  <div className="font-mono text-2xl font-semibold">
                    KES {item.price.toLocaleString()}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Add menu item</DialogTitle>
            <DialogDescription>
              Create a new catalogue item for the dining room dashboard.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <Input
              placeholder="Item name"
              value={draftItem.name}
              onChange={(event) =>
                setDraftItem((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
            />
            <Input
              type="number"
              placeholder="Price"
              value={draftItem.price || ""}
              onChange={(event) =>
                setDraftItem((current) => ({
                  ...current,
                  price: Number(event.target.value),
                }))
              }
            />
            <select
              value={draftItem.category}
              onChange={(event) =>
                setDraftItem((current) => ({
                  ...current,
                  category: event.target.value,
                }))
              }
              className="rounded-xl border border-border bg-background px-3 py-2 text-sm"
            >
              <option>Mains</option>
              <option>Sides</option>
              <option>Drinks</option>
              <option>Cocktails</option>
              <option>Desserts</option>
            </select>
            <select
              value={draftItem.destination}
              onChange={(event) =>
                setDraftItem((current) => ({
                  ...current,
                  destination: event.target.value as "kitchen" | "bar",
                }))
              }
              className="rounded-xl border border-border bg-background px-3 py-2 text-sm"
            >
              <option value="kitchen">Kitchen</option>
              <option value="bar">Bar</option>
            </select>
            <div className="grid gap-2 sm:grid-cols-2">
              {dietaryOptions.map((tag) => (
                <label
                  key={tag}
                  className="flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={(draftItem.dietary || []).includes(tag)}
                    onChange={(event) =>
                      setDraftItem((current) => ({
                        ...current,
                        dietary: event.target.checked
                          ? [...(current.dietary || []), tag]
                          : (current.dietary || []).filter(
                              (entry) => entry !== tag,
                            ),
                      }))
                    }
                  />
                  {tag}
                </label>
              ))}
            </div>
            <Button onClick={addItem}>Save item</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
