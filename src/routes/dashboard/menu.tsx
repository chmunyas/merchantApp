import { createFileRoute } from "@tanstack/react-router";
import {
  Camera,
  ChevronDown,
  ChevronUp,
  Clock3,
  Grid2X2,
  ImageIcon,
  List,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { toast } from "sonner";

import type {
  CatalogueItem,
  ItemModifier,
  MenuSchedule,
} from "@/components/merchant/features/types";
import { Badge } from "@/components/ui/badge";
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  ensureMerchantDemoData,
  getActiveMenuSchedule,
  getScheduleDayIndex,
  isMenuScheduleActive,
  loadMerchantSnapshot,
  saveMerchantCatalogue,
  saveMerchantMenuSchedules,
  type MerchantSnapshot,
} from "@/lib/merchant-dashboard";

export const Route = createFileRoute("/dashboard/menu")({
  component: DashboardMenuPage,
});

type ViewMode = "grid" | "list";
type MenuTab = "items" | "schedules";

type ItemSwitchProps = {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
};

type ScheduleDraft = MenuSchedule;

const dietaryOptions = ["vegan", "vegetarian", "gluten-free", "halal"];
const weekDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const defaultCategories = ["Mains", "Sides", "Drinks", "Cocktails", "Desserts"];

function emptyDraftItem(): CatalogueItem {
  return {
    id: "",
    name: "",
    price: 0,
    category: "Mains",
    dietary: [],
    destination: "kitchen",
    image: "",
    available: true,
    description: "",
    modifiers: [],
  };
}

function emptyScheduleDraft(): ScheduleDraft {
  return {
    id: "",
    name: "",
    days: [],
    startTime: "09:00",
    endTime: "17:00",
    categories: [],
  };
}

function cloneModifiers(modifiers?: ItemModifier[]) {
  return (modifiers || []).map((modifier) => ({
    ...modifier,
    options: modifier.options.map((option) => ({ ...option })),
  }));
}

function readImageAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Image upload failed"));
    reader.readAsDataURL(file);
  });
}

function Switch({ checked, onCheckedChange }: ItemSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
        checked ? "bg-emerald-500" : "bg-slate-300",
      )}
    >
      <span
        className={cn(
          "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform",
          checked ? "translate-x-5" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

function formatScheduleDays(days: number[]) {
  return days
    .slice()
    .sort((a, b) => a - b)
    .map((day) => weekDays[day])
    .join(" · ");
}

function getModifierSummary(modifiers?: ItemModifier[]) {
  if (!modifiers?.length) return "No modifiers";
  return `${modifiers.length} modifier group${modifiers.length === 1 ? "" : "s"}`;
}

function DashboardMenuPage() {
  const [snapshot, setSnapshot] = useState<MerchantSnapshot | null>(null);
  const [activeTab, setActiveTab] = useState<MenuTab>("items");
  const [category, setCategory] = useState("All");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [detailItem, setDetailItem] = useState<CatalogueItem | null>(null);
  const [draftItem, setDraftItem] = useState<CatalogueItem>(emptyDraftItem());
  const [modifiersExpanded, setModifiersExpanded] = useState(true);
  const [bulkCategory, setBulkCategory] = useState("Mains");
  const [bulkDestination, setBulkDestination] = useState<"kitchen" | "bar">(
    "kitchen",
  );
  const [scheduleDraft, setScheduleDraft] =
    useState<ScheduleDraft>(emptyScheduleDraft());
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(
    null,
  );

  useEffect(() => {
    ensureMerchantDemoData();
    setSnapshot(loadMerchantSnapshot());
  }, []);

  const categories = useMemo(() => {
    if (!snapshot) return defaultCategories;
    return Array.from(
      new Set([
        ...defaultCategories,
        ...snapshot.catalogue.map((item) => item.category),
        ...snapshot.menuSchedules.flatMap((schedule) => schedule.categories),
      ]),
    );
  }, [snapshot]);

  const items = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.catalogue.filter((item) => {
      const matchesCategory = category === "All" || item.category === category;
      const haystack = `${item.name} ${item.description || ""}`.toLowerCase();
      const matchesSearch = !search || haystack.includes(search.toLowerCase());
      return matchesCategory && matchesSearch;
    });
  }, [snapshot, category, search]);

  const activeSchedule = useMemo(
    () => (snapshot ? getActiveMenuSchedule(snapshot.menuSchedules) : null),
    [snapshot],
  );

  function persistCatalogue(nextCatalogue: CatalogueItem[]) {
    if (!snapshot) return;
    saveMerchantCatalogue(nextCatalogue);
    setSnapshot({ ...snapshot, catalogue: nextCatalogue });
  }

  function persistSchedules(nextSchedules: MenuSchedule[]) {
    if (!snapshot) return;
    saveMerchantMenuSchedules(nextSchedules);
    setSnapshot({ ...snapshot, menuSchedules: nextSchedules });
  }

  function resetDraft() {
    setDraftItem(emptyDraftItem());
    setEditingId(null);
    setModifiersExpanded(true);
  }

  function openAddDialog() {
    resetDraft();
    setDialogOpen(true);
  }

  function openEditDialog(item: CatalogueItem) {
    setEditingId(item.id);
    setDraftItem({
      ...emptyDraftItem(),
      ...item,
      dietary: [...(item.dietary || [])],
      available: item.available ?? true,
      modifiers: cloneModifiers(item.modifiers),
    });
    setDialogOpen(true);
  }

  function saveItem() {
    if (!snapshot || !draftItem.name.trim() || draftItem.price <= 0) return;

    const nextItem: CatalogueItem = {
      ...draftItem,
      id: editingId || `item-${Date.now()}`,
      name: draftItem.name.trim(),
      dietary: draftItem.dietary?.filter(Boolean) || [],
      available: draftItem.available ?? true,
      image: draftItem.image || undefined,
      description: draftItem.description?.trim() || undefined,
      modifiers:
        draftItem.modifiers
          ?.map((modifier) => ({
            ...modifier,
            name: modifier.name.trim(),
            options: modifier.options
              .map((option) => ({
                ...option,
                label: option.label.trim(),
                priceAdjustment: Number(option.priceAdjustment) || 0,
              }))
              .filter((option) => option.label),
          }))
          .filter((modifier) => modifier.name && modifier.options.length > 0) ||
        undefined,
    };

    const nextCatalogue = editingId
      ? snapshot.catalogue.map((item) =>
          item.id === editingId ? nextItem : item,
        )
      : [nextItem, ...snapshot.catalogue];

    persistCatalogue(nextCatalogue);
    toast.success(editingId ? "Menu item updated" : "Menu item added");
    setDialogOpen(false);
    resetDraft();
  }

  function toggleSelection(id: string) {
    setSelectedIds((current) =>
      current.includes(id)
        ? current.filter((entry) => entry !== id)
        : [...current, id],
    );
  }

  function updateItem(id: string, updates: Partial<CatalogueItem>) {
    if (!snapshot) return;
    persistCatalogue(
      snapshot.catalogue.map((item) =>
        item.id === id ? { ...item, ...updates } : item,
      ),
    );
  }

  function toggleAvailability(id: string, available: boolean) {
    updateItem(id, { available });
  }

  function markSoldOut(id: string) {
    updateItem(id, { available: false });
    toast.success("Item marked as sold out");
  }

  function applyBulkChanges(mode: "delete" | "category" | "destination") {
    if (!snapshot || !selectedIds.length) return;
    let nextCatalogue = snapshot.catalogue;

    if (mode === "delete") {
      nextCatalogue = snapshot.catalogue.filter(
        (item) => !selectedIds.includes(item.id),
      );
    }

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

  async function handleImageUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const image = await readImageAsDataUrl(file);
      setDraftItem((current) => ({ ...current, image }));
    } catch {
      toast.error("Could not upload image");
    }
  }

  function addModifierGroup() {
    setDraftItem((current) => ({
      ...current,
      modifiers: [
        ...(current.modifiers || []),
        {
          id: `modifier-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name: "",
          options: [
            {
              id: `option-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              label: "",
              priceAdjustment: 0,
            },
          ],
        },
      ],
    }));
  }

  function updateModifierGroup(
    modifierId: string,
    updates: Partial<ItemModifier>,
  ) {
    setDraftItem((current) => ({
      ...current,
      modifiers: (current.modifiers || []).map((modifier) =>
        modifier.id === modifierId ? { ...modifier, ...updates } : modifier,
      ),
    }));
  }

  function removeModifierGroup(modifierId: string) {
    setDraftItem((current) => ({
      ...current,
      modifiers: (current.modifiers || []).filter(
        (modifier) => modifier.id !== modifierId,
      ),
    }));
  }

  function addModifierOption(modifierId: string) {
    setDraftItem((current) => ({
      ...current,
      modifiers: (current.modifiers || []).map((modifier) =>
        modifier.id === modifierId
          ? {
              ...modifier,
              options: [
                ...modifier.options,
                {
                  id: `option-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                  label: "",
                  priceAdjustment: 0,
                },
              ],
            }
          : modifier,
      ),
    }));
  }

  function updateModifierOption(
    modifierId: string,
    optionId: string,
    updates: { label?: string; priceAdjustment?: number },
  ) {
    setDraftItem((current) => ({
      ...current,
      modifiers: (current.modifiers || []).map((modifier) =>
        modifier.id === modifierId
          ? {
              ...modifier,
              options: modifier.options.map((option) =>
                option.id === optionId ? { ...option, ...updates } : option,
              ),
            }
          : modifier,
      ),
    }));
  }

  function removeModifierOption(modifierId: string, optionId: string) {
    setDraftItem((current) => ({
      ...current,
      modifiers: (current.modifiers || []).map((modifier) =>
        modifier.id === modifierId
          ? {
              ...modifier,
              options: modifier.options.filter(
                (option) => option.id !== optionId,
              ),
            }
          : modifier,
      ),
    }));
  }

  function resetScheduleDraft() {
    setScheduleDraft(emptyScheduleDraft());
    setEditingScheduleId(null);
  }

  function saveSchedule() {
    if (!snapshot || !scheduleDraft.name.trim() || !scheduleDraft.days.length)
      return;
    const nextSchedule: MenuSchedule = {
      ...scheduleDraft,
      id: editingScheduleId || `schedule-${Date.now()}`,
      name: scheduleDraft.name.trim(),
      categories: scheduleDraft.categories,
    };

    const nextSchedules = editingScheduleId
      ? snapshot.menuSchedules.map((schedule) =>
          schedule.id === editingScheduleId ? nextSchedule : schedule,
        )
      : [nextSchedule, ...snapshot.menuSchedules];

    persistSchedules(nextSchedules);
    toast.success(editingScheduleId ? "Schedule updated" : "Schedule created");
    resetScheduleDraft();
  }

  function editSchedule(schedule: MenuSchedule) {
    setEditingScheduleId(schedule.id);
    setScheduleDraft({
      ...schedule,
      days: [...schedule.days],
      categories: [...schedule.categories],
    });
  }

  function deleteSchedule(id: string) {
    if (!snapshot) return;
    persistSchedules(
      snapshot.menuSchedules.filter((schedule) => schedule.id !== id),
    );
    if (editingScheduleId === id) resetScheduleDraft();
    toast.success("Schedule removed");
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
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-semibold">Menu management</h1>
              {activeSchedule ? (
                <Badge className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-700 hover:bg-emerald-100">
                  Active: {activeSchedule.name}
                </Badge>
              ) : (
                <Badge className="rounded-full bg-slate-100 px-3 py-1 text-slate-700 hover:bg-slate-100">
                  No active schedule
                </Badge>
              )}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Photos, stock status, descriptions, modifiers, and time-based
              menus.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={openAddDialog} className="gap-2">
              <Plus className="h-4 w-4" /> Add item
            </Button>
          </div>
        </div>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as MenuTab)}
        className="space-y-4"
      >
        <TabsList>
          <TabsTrigger value="items">Items</TabsTrigger>
          <TabsTrigger value="schedules">Schedules</TabsTrigger>
        </TabsList>

        <TabsContent value="items" className="space-y-6">
          <div className="rounded-2xl border border-border bg-card p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap gap-2">
                {["All", ...categories].map((item) => (
                  <button
                    key={item}
                    onClick={() => setCategory(item)}
                    className={cn(
                      "rounded-full px-4 py-2 text-sm font-medium",
                      category === item
                        ? "bg-slate-900 text-white"
                        : "bg-slate-100 text-slate-700",
                    )}
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
                  {categories.map((option) => (
                    <option key={option}>{option}</option>
                  ))}
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
            {items.map((item) => {
              const isAvailable = item.available ?? true;
              const detailBody = (
                <button
                  type="button"
                  onClick={() => setDetailItem(item)}
                  className="flex-1 text-left"
                >
                  <div
                    className={cn(
                      "overflow-hidden rounded-2xl border border-dashed border-slate-200 bg-slate-50",
                      viewMode === "grid" ? "mb-4 h-44" : "h-20 w-20 shrink-0",
                    )}
                  >
                    {item.image ? (
                      <img
                        src={item.image}
                        alt={item.name}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-slate-400">
                        <ImageIcon className="h-8 w-8" />
                      </div>
                    )}
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-start gap-2">
                      <div className="flex-1">
                        <h3
                          className={cn(
                            "text-lg font-semibold",
                            !isAvailable && "text-slate-400 line-through",
                          )}
                        >
                          {item.name}
                        </h3>
                        {item.description ? (
                          <p
                            className={cn(
                              "mt-1 text-sm text-muted-foreground",
                              !isAvailable && "text-slate-400",
                            )}
                            style={{
                              display: "-webkit-box",
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: "vertical",
                              overflow: "hidden",
                            }}
                          >
                            {item.description}
                          </p>
                        ) : null}
                      </div>
                      {!isAvailable ? (
                        <span className="rounded-full bg-red-500 px-2.5 py-1 text-[10px] font-semibold text-white">
                          Sold Out
                        </span>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium">
                        {item.category}
                      </span>
                      <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-medium text-blue-700">
                        {item.destination}
                      </span>
                      <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-700">
                        {getModifierSummary(item.modifiers)}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {(item.dietary || []).map((tag) => (
                        <span
                          key={tag}
                          className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-700"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                    <div className="font-mono text-2xl font-semibold">
                      KES {item.price.toLocaleString()}
                    </div>
                  </div>
                </button>
              );

              return (
                <div
                  key={item.id}
                  className={cn(
                    "rounded-2xl border border-border bg-card p-5 transition",
                    !isAvailable && "bg-slate-50 text-slate-400",
                    viewMode === "list" && "flex items-start gap-4",
                  )}
                >
                  <div className="flex w-full flex-col gap-4">
                    <div className="flex items-start justify-between gap-3">
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(item.id)}
                          onChange={() => toggleSelection(item.id)}
                        />
                        Select
                      </label>
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1">
                          <span className="text-xs font-medium text-slate-600">
                            {isAvailable ? "Available" : "Unavailable"}
                          </span>
                          <Switch
                            checked={isAvailable}
                            onCheckedChange={(available) =>
                              toggleAvailability(item.id, available)
                            }
                          />
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => markSoldOut(item.id)}
                          className="text-red-600"
                        >
                          86
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => openEditDialog(item)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    <div
                      className={cn(
                        viewMode === "list"
                          ? "flex items-start gap-4"
                          : "space-y-4",
                      )}
                    >
                      {detailBody}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </TabsContent>

        <TabsContent value="schedules" className="space-y-6">
          <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
            <div className="rounded-2xl border border-border bg-card p-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold">Create schedule</h2>
                  <p className="text-sm text-muted-foreground">
                    Control which categories show on the customer menu.
                  </p>
                </div>
                {editingScheduleId ? (
                  <Button variant="ghost" onClick={resetScheduleDraft}>
                    Cancel edit
                  </Button>
                ) : null}
              </div>

              <div className="mt-5 space-y-5">
                <Input
                  placeholder="Lunch Menu"
                  value={scheduleDraft.name}
                  onChange={(event) =>
                    setScheduleDraft((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                />

                <div className="space-y-2">
                  <p className="text-sm font-medium">Active days</p>
                  <div className="flex flex-wrap gap-2">
                    {weekDays.map((day, index) => {
                      const selected = scheduleDraft.days.includes(index);
                      return (
                        <button
                          key={day}
                          type="button"
                          onClick={() =>
                            setScheduleDraft((current) => ({
                              ...current,
                              days: selected
                                ? current.days.filter(
                                    (entry) => entry !== index,
                                  )
                                : [...current.days, index],
                            }))
                          }
                          className={cn(
                            "rounded-full border px-3 py-2 text-sm font-medium",
                            selected
                              ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                              : "border-border bg-background text-slate-600",
                          )}
                        >
                          {day}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="space-y-2 text-sm font-medium">
                    <span>Start time</span>
                    <Input
                      type="time"
                      value={scheduleDraft.startTime}
                      onChange={(event) =>
                        setScheduleDraft((current) => ({
                          ...current,
                          startTime: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label className="space-y-2 text-sm font-medium">
                    <span>End time</span>
                    <Input
                      type="time"
                      value={scheduleDraft.endTime}
                      onChange={(event) =>
                        setScheduleDraft((current) => ({
                          ...current,
                          endTime: event.target.value,
                        }))
                      }
                    />
                  </label>
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-medium">Visible categories</p>
                  <div className="flex flex-wrap gap-2">
                    {categories.map((option) => {
                      const selected =
                        scheduleDraft.categories.includes(option);
                      return (
                        <button
                          key={option}
                          type="button"
                          onClick={() =>
                            setScheduleDraft((current) => ({
                              ...current,
                              categories: selected
                                ? current.categories.filter(
                                    (entry) => entry !== option,
                                  )
                                : [...current.categories, option],
                            }))
                          }
                          className={cn(
                            "rounded-full border px-3 py-2 text-sm",
                            selected
                              ? "border-blue-500 bg-blue-50 text-blue-700"
                              : "border-border bg-background text-slate-600",
                          )}
                        >
                          {option}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <Button onClick={saveSchedule} className="w-full gap-2">
                  <Clock3 className="h-4 w-4" />
                  {editingScheduleId ? "Update schedule" : "Save schedule"}
                </Button>
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-2xl border border-border bg-card p-6">
                <h2 className="text-lg font-semibold">
                  Active schedule right now
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  {activeSchedule
                    ? `${activeSchedule.name} is currently live for customers.`
                    : "No schedule is active. Customers will see all categories."}
                </p>
                {activeSchedule ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {activeSchedule.categories.map((entry) => (
                      <Badge
                        key={entry}
                        variant="secondary"
                        className="rounded-full px-3 py-1"
                      >
                        {entry}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </div>

              {snapshot.menuSchedules.map((schedule) => {
                const isActive = isMenuScheduleActive(schedule);
                const today = schedule.days.includes(getScheduleDayIndex());
                return (
                  <div
                    key={schedule.id}
                    className={cn(
                      "rounded-2xl border bg-card p-5",
                      isActive
                        ? "border-emerald-300 shadow-sm"
                        : "border-border",
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-lg font-semibold">
                            {schedule.name}
                          </h3>
                          {isActive ? (
                            <span className="rounded-full bg-emerald-500 px-2.5 py-1 text-[10px] font-semibold text-white">
                              Active now
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {formatScheduleDays(schedule.days)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => editSchedule(schedule)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => deleteSchedule(schedule.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          "rounded-full px-3 py-1 text-xs font-medium",
                          today
                            ? "bg-indigo-100 text-indigo-700"
                            : "bg-slate-100 text-slate-600",
                        )}
                      >
                        {schedule.startTime} – {schedule.endTime}
                      </span>
                      {schedule.categories.map((entry) => (
                        <span
                          key={entry}
                          className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700"
                        >
                          {entry}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) resetDraft();
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>
              {editingId ? "Edit menu item" : "Add menu item"}
            </DialogTitle>
            <DialogDescription>
              Manage photos, descriptions, availability, and modifier groups.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-6 py-2 lg:grid-cols-[0.95fr_1.05fr]">
            <div className="space-y-4">
              <label className="block">
                <span className="mb-2 block text-sm font-medium">Photo</span>
                <label className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
                  {draftItem.image ? (
                    <img
                      src={draftItem.image}
                      alt="Preview"
                      className="h-44 w-full rounded-xl object-cover"
                    />
                  ) : (
                    <div className="flex h-40 w-full flex-col items-center justify-center rounded-xl bg-white text-slate-400">
                      <Camera className="h-8 w-8" />
                      <p className="mt-3 text-sm font-medium text-slate-600">
                        Click to upload
                      </p>
                      <p className="text-xs text-muted-foreground">
                        JPG, PNG, or base64-ready preview
                      </p>
                    </div>
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleImageUpload}
                  />
                </label>
              </label>

              {draftItem.image ? (
                <Button
                  variant="outline"
                  onClick={() =>
                    setDraftItem((current) => ({
                      ...current,
                      image: undefined,
                    }))
                  }
                  className="w-full"
                >
                  Remove photo
                </Button>
              ) : null}

              <div className="rounded-2xl border border-border bg-slate-50 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Availability</span>
                  <Switch
                    checked={draftItem.available ?? true}
                    onCheckedChange={(available) =>
                      setDraftItem((current) => ({ ...current, available }))
                    }
                  />
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Turn this off to show the item as sold out across the menu.
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
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
              </div>

              <div className="grid gap-4 md:grid-cols-2">
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
                  {categories.map((option) => (
                    <option key={option}>{option}</option>
                  ))}
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
              </div>

              <textarea
                placeholder="Write a short product description"
                value={draftItem.description || ""}
                onChange={(event) =>
                  setDraftItem((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
                className="min-h-28 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
              />

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

              <div className="rounded-2xl border border-border p-4">
                <button
                  type="button"
                  onClick={() => setModifiersExpanded((current) => !current)}
                  className="flex w-full items-center justify-between text-left"
                >
                  <div>
                    <p className="font-medium">Modifiers</p>
                    <p className="text-sm text-muted-foreground">
                      Add size, extras, and paid options.
                    </p>
                  </div>
                  {modifiersExpanded ? (
                    <ChevronUp className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                </button>

                {modifiersExpanded ? (
                  <div className="mt-4 space-y-4">
                    {(draftItem.modifiers || []).map((modifier) => (
                      <div
                        key={modifier.id}
                        className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
                      >
                        <div className="flex items-center gap-2">
                          <Input
                            placeholder="Modifier group name"
                            value={modifier.name}
                            onChange={(event) =>
                              updateModifierGroup(modifier.id, {
                                name: event.target.value,
                              })
                            }
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => removeModifierGroup(modifier.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>

                        <div className="mt-3 space-y-2">
                          {modifier.options.map((option) => (
                            <div
                              key={option.id}
                              className="grid gap-2 md:grid-cols-[1fr_160px_44px]"
                            >
                              <Input
                                placeholder="Option label"
                                value={option.label}
                                onChange={(event) =>
                                  updateModifierOption(modifier.id, option.id, {
                                    label: event.target.value,
                                  })
                                }
                              />
                              <Input
                                type="number"
                                placeholder="Price adjustment"
                                value={option.priceAdjustment}
                                onChange={(event) =>
                                  updateModifierOption(modifier.id, option.id, {
                                    priceAdjustment: Number(event.target.value),
                                  })
                                }
                              />
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() =>
                                  removeModifierOption(modifier.id, option.id)
                                }
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          ))}
                        </div>

                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => addModifierOption(modifier.id)}
                          className="mt-3"
                        >
                          <Plus className="h-4 w-4" /> Add option
                        </Button>
                      </div>
                    ))}

                    <Button
                      variant="outline"
                      onClick={addModifierGroup}
                      className="gap-2"
                    >
                      <Plus className="h-4 w-4" /> Add modifier group
                    </Button>
                  </div>
                ) : null}
              </div>

              <Button onClick={saveItem} className="w-full">
                Save item
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Sheet
        open={Boolean(detailItem)}
        onOpenChange={(open) => !open && setDetailItem(null)}
      >
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          {detailItem ? (
            <>
              <SheetHeader>
                <SheetTitle>{detailItem.name}</SheetTitle>
                <SheetDescription>
                  Full menu detail for staff and customer presentation.
                </SheetDescription>
              </SheetHeader>

              <div className="mt-6 space-y-5">
                <div className="overflow-hidden rounded-2xl border border-border bg-slate-50">
                  {detailItem.image ? (
                    <img
                      src={detailItem.image}
                      alt={detailItem.name}
                      className="h-64 w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-64 items-center justify-center text-slate-400">
                      <ImageIcon className="h-10 w-10" />
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{detailItem.category}</Badge>
                  <Badge variant="secondary">{detailItem.destination}</Badge>
                  {(detailItem.available ?? true) ? null : (
                    <Badge className="bg-red-500 text-white hover:bg-red-500">
                      Sold Out
                    </Badge>
                  )}
                </div>

                <div>
                  <p className="text-sm leading-6 text-slate-600">
                    {detailItem.description || "No description added yet."}
                  </p>
                </div>

                <div className="rounded-2xl border border-border p-4">
                  <div className="text-sm font-medium">Modifier groups</div>
                  <div className="mt-3 space-y-3">
                    {(detailItem.modifiers || []).length ? (
                      detailItem.modifiers?.map((modifier) => (
                        <div
                          key={modifier.id}
                          className="rounded-xl bg-slate-50 p-3"
                        >
                          <p className="font-medium">{modifier.name}</p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {modifier.options.map((option) => (
                              <span
                                key={option.id}
                                className="rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-700"
                              >
                                {option.label}{" "}
                                {option.priceAdjustment > 0
                                  ? `( +KES ${option.priceAdjustment} )`
                                  : ""}
                              </span>
                            ))}
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        No modifiers configured.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
