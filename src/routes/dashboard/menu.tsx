import { createFileRoute } from "@tanstack/react-router";
import {
  Camera,
  Clock3,
  Eye,
  ImageIcon,
  MapPinned,
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
  Menu,
  MenuSchedule,
  Zone,
} from "@/components/merchant/features/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ensureMerchantDemoData,
  getActiveMenuSchedule,
  getActiveMenus,
  getOrderedCategories,
  getScheduleDayIndex,
  getTableZone,
  getVisibleCatalogueForTable,
  isMenuScheduleActive,
  loadMerchantSnapshot,
  saveMerchantCatalogue,
  saveMerchantCategoryOrder,
  saveMerchantMenus,
  saveMerchantMenuSchedules,
  saveMerchantZones,
  type MerchantSnapshot,
} from "@/lib/merchant-dashboard";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/menu")({
  component: DashboardMenuPage,
});

type MenuTab = "items" | "menus" | "zones" | "schedules";
type ScheduleDraft = MenuSchedule;
type MenuDraft = Omit<Menu, "id" | "createdAt">;
type ZoneDraft = {
  id?: string;
  name: string;
  menuIds: string[];
  tableStart: number;
  tableEnd: number;
};

type ItemSwitchProps = {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
};

const dietaryOptions = ["vegan", "vegetarian", "gluten-free", "halal"];
const defaultCategories = ["Mains", "Sides", "Drinks", "Cocktails", "Desserts"];
const weekDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

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
    linkedProductIds: [],
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

function emptyMenuDraft(): MenuDraft {
  return {
    name: "",
    description: "",
    categories: [],
    isActive: true,
  };
}

function emptyZoneDraft(): ZoneDraft {
  return {
    name: "",
    menuIds: [],
    tableStart: 1,
    tableEnd: 4,
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

function DashboardMenuPage() {
  const [snapshot, setSnapshot] = useState<MerchantSnapshot | null>(null);
  const [activeTab, setActiveTab] = useState<MenuTab>("items");
  const [category, setCategory] = useState("All");
  const [search, setSearch] = useState("");
  const [reorderMode, setReorderMode] = useState(false);
  const [draggedCategory, setDraggedCategory] = useState<string | null>(null);
  const [itemDialogOpen, setItemDialogOpen] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [draftItem, setDraftItem] = useState<CatalogueItem>(emptyDraftItem());
  const [menuDialogOpen, setMenuDialogOpen] = useState(false);
  const [editingMenuId, setEditingMenuId] = useState<string | null>(null);
  const [menuDraft, setMenuDraft] = useState<MenuDraft>(emptyMenuDraft());
  const [zoneDialogOpen, setZoneDialogOpen] = useState(false);
  const [editingZoneId, setEditingZoneId] = useState<string | null>(null);
  const [zoneDraft, setZoneDraft] = useState<ZoneDraft>(emptyZoneDraft());
  const [scheduleDraft, setScheduleDraft] =
    useState<ScheduleDraft>(emptyScheduleDraft());
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(
    null,
  );
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewTableNumber, setPreviewTableNumber] = useState(7);
  const [previewCategory, setPreviewCategory] = useState("All");
  const [pairingsSearch, setPairingsSearch] = useState("");

  useEffect(() => {
    ensureMerchantDemoData();
    setSnapshot(loadMerchantSnapshot());
  }, []);

  const allCategories = useMemo(() => {
    if (!snapshot) return defaultCategories;
    return getOrderedCategories(
      [
        ...defaultCategories,
        ...snapshot.catalogue.map((item) => item.category),
        ...snapshot.menus.flatMap((menu) => menu.categories),
        ...snapshot.menuSchedules.flatMap((schedule) => schedule.categories),
      ],
      snapshot.categoryOrder,
    );
  }, [snapshot]);

  const activeSchedule = useMemo(
    () => (snapshot ? getActiveMenuSchedule(snapshot.menuSchedules) : null),
    [snapshot],
  );

  const activeMenus = useMemo(
    () => (snapshot ? getActiveMenus(snapshot.menus) : []),
    [snapshot],
  );

  const filteredItems = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.catalogue.filter((item) => {
      const matchesCategory = category === "All" || item.category === category;
      const haystack = `${item.name} ${item.description || ""}`.toLowerCase();
      return (
        matchesCategory && (!search || haystack.includes(search.toLowerCase()))
      );
    });
  }, [snapshot, category, search]);

  const previewItems = useMemo(() => {
    if (!snapshot) return [];
    return getVisibleCatalogueForTable({
      catalogue: snapshot.catalogue,
      menus: snapshot.menus,
      zones: snapshot.zones,
      tableNumber: previewTableNumber,
      activeSchedule,
    });
  }, [snapshot, previewTableNumber, activeSchedule]);

  const previewCategories = useMemo(() => {
    if (!snapshot) return [];
    return getOrderedCategories(
      previewItems.map((item) => item.category),
      snapshot.categoryOrder,
    );
  }, [previewItems, snapshot]);

  const previewVisibleItems = useMemo(
    () =>
      previewCategory === "All"
        ? previewItems
        : previewItems.filter((item) => item.category === previewCategory),
    [previewCategory, previewItems],
  );

  const previewZone = useMemo(
    () => (snapshot ? getTableZone(snapshot.zones, previewTableNumber) : null),
    [snapshot, previewTableNumber],
  );

  useEffect(() => {
    if (
      previewCategory !== "All" &&
      !previewCategories.includes(previewCategory)
    ) {
      setPreviewCategory("All");
    }
  }, [previewCategory, previewCategories]);

  function refreshSnapshot(next: MerchantSnapshot) {
    setSnapshot(next);
  }

  function persistCatalogue(nextCatalogue: CatalogueItem[]) {
    if (!snapshot) return;
    saveMerchantCatalogue(nextCatalogue);
    refreshSnapshot({ ...snapshot, catalogue: nextCatalogue });
  }

  function persistMenus(nextMenus: Menu[]) {
    if (!snapshot) return;
    saveMerchantMenus(nextMenus);
    refreshSnapshot({ ...snapshot, menus: nextMenus });
  }

  function persistZones(nextZones: Zone[]) {
    if (!snapshot) return;
    saveMerchantZones(nextZones);
    refreshSnapshot({ ...snapshot, zones: nextZones });
  }

  function persistSchedules(nextSchedules: MenuSchedule[]) {
    if (!snapshot) return;
    saveMerchantMenuSchedules(nextSchedules);
    refreshSnapshot({ ...snapshot, menuSchedules: nextSchedules });
  }

  function persistCategoryOrder(nextOrder: string[]) {
    if (!snapshot) return;
    saveMerchantCategoryOrder(nextOrder);
    refreshSnapshot({ ...snapshot, categoryOrder: nextOrder });
  }

  function openNewItemDialog() {
    setEditingItemId(null);
    setDraftItem(emptyDraftItem());
    setPairingsSearch("");
    setItemDialogOpen(true);
  }

  function openEditItemDialog(item: CatalogueItem) {
    setEditingItemId(item.id);
    setDraftItem({
      ...emptyDraftItem(),
      ...item,
      dietary: [...(item.dietary || [])],
      modifiers: cloneModifiers(item.modifiers),
      linkedProductIds: [...(item.linkedProductIds || [])],
    });
    setPairingsSearch("");
    setItemDialogOpen(true);
  }

  function saveItem() {
    if (!snapshot || !draftItem.name.trim() || draftItem.price <= 0) return;
    const id = editingItemId || `item-${Date.now()}`;
    const nextItem: CatalogueItem = {
      ...draftItem,
      id,
      name: draftItem.name.trim(),
      category: draftItem.category || allCategories[0] || "Mains",
      image: draftItem.image || undefined,
      description: draftItem.description?.trim() || undefined,
      dietary: [...new Set((draftItem.dietary || []).filter(Boolean))],
      linkedProductIds: [
        ...new Set(
          (draftItem.linkedProductIds || []).filter(
            (entry) => entry && entry !== id,
          ),
        ),
      ],
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

    const nextCatalogue = editingItemId
      ? snapshot.catalogue.map((item) =>
          item.id === editingItemId ? nextItem : item,
        )
      : [nextItem, ...snapshot.catalogue];

    persistCatalogue(nextCatalogue);
    setItemDialogOpen(false);
    setEditingItemId(null);
    setDraftItem(emptyDraftItem());
    toast.success(editingItemId ? "Menu item updated" : "Menu item created");
  }

  function deleteItem(id: string) {
    if (!snapshot) return;
    persistCatalogue(
      snapshot.catalogue
        .filter((item) => item.id !== id)
        .map((item) => ({
          ...item,
          linkedProductIds: item.linkedProductIds?.filter(
            (linkedId) => linkedId !== id,
          ),
        })),
    );
    toast.success("Menu item removed");
  }

  function toggleAvailability(id: string, available: boolean) {
    if (!snapshot) return;
    persistCatalogue(
      snapshot.catalogue.map((item) =>
        item.id === id ? { ...item, available } : item,
      ),
    );
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

  function toggleLinkedProduct(id: string) {
    setDraftItem((current) => ({
      ...current,
      linkedProductIds: current.linkedProductIds?.includes(id)
        ? current.linkedProductIds.filter((entry) => entry !== id)
        : [...(current.linkedProductIds || []), id],
    }));
  }

  function openNewMenuDialog() {
    setEditingMenuId(null);
    setMenuDraft(emptyMenuDraft());
    setMenuDialogOpen(true);
  }

  function openEditMenuDialog(menu: Menu) {
    setEditingMenuId(menu.id);
    setMenuDraft({
      name: menu.name,
      description: menu.description || "",
      categories: [...menu.categories],
      isActive: menu.isActive,
    });
    setMenuDialogOpen(true);
  }

  function saveMenu() {
    if (!snapshot || !menuDraft.name.trim() || !menuDraft.categories.length)
      return;
    const nextMenu: Menu = {
      id: editingMenuId || `menu-${Date.now()}`,
      name: menuDraft.name.trim(),
      description: menuDraft.description?.trim() || undefined,
      categories: [...new Set(menuDraft.categories)],
      isActive: menuDraft.isActive,
      createdAt:
        snapshot.menus.find((menu) => menu.id === editingMenuId)?.createdAt ||
        new Date().toISOString(),
    };

    const nextMenus = editingMenuId
      ? snapshot.menus.map((menu) =>
          menu.id === editingMenuId ? nextMenu : menu,
        )
      : [nextMenu, ...snapshot.menus];

    persistMenus(nextMenus);
    setMenuDialogOpen(false);
    toast.success(editingMenuId ? "Menu updated" : "Menu created");
  }

  function deleteMenu(id: string) {
    if (!snapshot) return;
    const nextMenus = snapshot.menus.filter((menu) => menu.id !== id);
    const nextZones = snapshot.zones.map((zone) => ({
      ...zone,
      menuIds: zone.menuIds.filter((menuId) => menuId !== id),
    }));
    saveMerchantMenus(nextMenus);
    saveMerchantZones(nextZones);
    refreshSnapshot({ ...snapshot, menus: nextMenus, zones: nextZones });
    toast.success("Menu removed");
  }

  function toggleMenuActive(id: string, isActive: boolean) {
    if (!snapshot) return;
    persistMenus(
      snapshot.menus.map((menu) =>
        menu.id === id ? { ...menu, isActive } : menu,
      ),
    );
  }

  function openNewZoneDialog() {
    setEditingZoneId(null);
    setZoneDraft(emptyZoneDraft());
    setZoneDialogOpen(true);
  }

  function openEditZoneDialog(zone: Zone) {
    setEditingZoneId(zone.id);
    setZoneDraft({
      id: zone.id,
      name: zone.name,
      menuIds: [...zone.menuIds],
      tableStart: zone.tableRange[0],
      tableEnd: zone.tableRange[1],
    });
    setZoneDialogOpen(true);
  }

  function saveZone() {
    if (!snapshot || !zoneDraft.name.trim() || !zoneDraft.menuIds.length)
      return;
    const tableStart = Math.min(zoneDraft.tableStart, zoneDraft.tableEnd);
    const tableEnd = Math.max(zoneDraft.tableStart, zoneDraft.tableEnd);
    const nextZone: Zone = {
      id: editingZoneId || `zone-${Date.now()}`,
      name: zoneDraft.name.trim(),
      menuIds: [...new Set(zoneDraft.menuIds)],
      tableRange: [tableStart, tableEnd],
    };

    const nextZones = editingZoneId
      ? snapshot.zones.map((zone) =>
          zone.id === editingZoneId ? nextZone : zone,
        )
      : [nextZone, ...snapshot.zones];

    persistZones(nextZones);
    setZoneDialogOpen(false);
    toast.success(editingZoneId ? "Zone updated" : "Zone created");
  }

  function deleteZone(id: string) {
    if (!snapshot) return;
    persistZones(snapshot.zones.filter((zone) => zone.id !== id));
    toast.success("Zone removed");
  }

  function resetScheduleDraft() {
    setEditingScheduleId(null);
    setScheduleDraft(emptyScheduleDraft());
  }

  function saveSchedule() {
    if (!snapshot || !scheduleDraft.name.trim() || !scheduleDraft.days.length)
      return;
    const nextSchedule: MenuSchedule = {
      ...scheduleDraft,
      id: editingScheduleId || `schedule-${Date.now()}`,
      name: scheduleDraft.name.trim(),
      categories: [...new Set(scheduleDraft.categories)],
    };

    const nextSchedules = editingScheduleId
      ? snapshot.menuSchedules.map((schedule) =>
          schedule.id === editingScheduleId ? nextSchedule : schedule,
        )
      : [nextSchedule, ...snapshot.menuSchedules];

    persistSchedules(nextSchedules);
    resetScheduleDraft();
    toast.success(editingScheduleId ? "Schedule updated" : "Schedule created");
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

  function moveCategory(targetCategory: string) {
    if (!draggedCategory || !snapshot || draggedCategory === targetCategory)
      return;
    const nextOrder = [...allCategories];
    const fromIndex = nextOrder.indexOf(draggedCategory);
    const toIndex = nextOrder.indexOf(targetCategory);
    if (fromIndex === -1 || toIndex === -1) return;
    nextOrder.splice(fromIndex, 1);
    nextOrder.splice(toIndex, 0, draggedCategory);
    persistCategoryOrder(nextOrder);
    setDraggedCategory(null);
    toast.success("Category order updated");
  }

  if (!snapshot) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6">
        Loading menu…
      </div>
    );
  }

  const linkedProductOptions = snapshot.catalogue.filter(
    (item) => item.id !== editingItemId && item.id !== draftItem.id,
  );
  const filteredPairingOptions = linkedProductOptions.filter((item) => {
    const haystack = `${item.name} ${item.category}`.toLowerCase();
    return !pairingsSearch || haystack.includes(pairingsSearch.toLowerCase());
  });

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border bg-card p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold">Menu management</h1>
              {activeSchedule ? (
                <Badge className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-700 hover:bg-emerald-100">
                  Active schedule: {activeSchedule.name}
                </Badge>
              ) : (
                <Badge className="rounded-full bg-slate-100 px-3 py-1 text-slate-700 hover:bg-slate-100">
                  No active schedule
                </Badge>
              )}
              <Badge className="rounded-full bg-blue-100 px-3 py-1 text-blue-700 hover:bg-blue-100">
                {activeMenus.length} active menu
                {activeMenus.length === 1 ? "" : "s"}
              </Badge>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Manage menu items, menu groups, table zones, category order, and
              customer preview.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => setPreviewOpen(true)}
              className="gap-2"
            >
              <Eye className="h-4 w-4" /> Preview
            </Button>
            <Button onClick={openNewItemDialog} className="gap-2">
              <Plus className="h-4 w-4" /> Add item
            </Button>
          </div>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-border p-4">
            <p className="text-xs text-muted-foreground">Items</p>
            <p className="mt-2 text-2xl font-semibold">
              {snapshot.catalogue.length}
            </p>
          </div>
          <div className="rounded-2xl border border-border p-4">
            <p className="text-xs text-muted-foreground">Menus</p>
            <p className="mt-2 text-2xl font-semibold">
              {snapshot.menus.length}
            </p>
          </div>
          <div className="rounded-2xl border border-border p-4">
            <p className="text-xs text-muted-foreground">Zones</p>
            <p className="mt-2 text-2xl font-semibold">
              {snapshot.zones.length}
            </p>
          </div>
          <div className="rounded-2xl border border-border p-4">
            <p className="text-xs text-muted-foreground">Schedules</p>
            <p className="mt-2 text-2xl font-semibold">
              {snapshot.menuSchedules.length}
            </p>
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
          <TabsTrigger value="menus">Menus</TabsTrigger>
          <TabsTrigger value="zones">Zones</TabsTrigger>
          <TabsTrigger value="schedules">Schedules</TabsTrigger>
        </TabsList>

        <TabsContent value="items" className="space-y-4">
          <div className="rounded-2xl border border-border bg-card p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setCategory("All")}
                  className={cn(
                    "rounded-full px-4 py-2 text-sm font-medium",
                    category === "All"
                      ? "bg-slate-900 text-white"
                      : "bg-slate-100 text-slate-700",
                  )}
                >
                  All
                </button>
                {allCategories.map((item) => (
                  <button
                    key={item}
                    type="button"
                    draggable={reorderMode}
                    onDragStart={() => setDraggedCategory(item)}
                    onDragOver={(event) => {
                      if (reorderMode) event.preventDefault();
                    }}
                    onDrop={() => moveCategory(item)}
                    onClick={() => !reorderMode && setCategory(item)}
                    className={cn(
                      "inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium",
                      category === item && !reorderMode
                        ? "bg-slate-900 text-white"
                        : "bg-slate-100 text-slate-700",
                      reorderMode && "border border-dashed border-slate-300",
                    )}
                  >
                    {reorderMode ? (
                      <span className="text-base leading-none">⠿</span>
                    ) : null}
                    {item}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <div className="relative min-w-72">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search menu items"
                    className="pl-9"
                  />
                </div>
                <Button
                  variant="outline"
                  onClick={() => setReorderMode((current) => !current)}
                >
                  {reorderMode ? "Done reordering" : "Reorder categories"}
                </Button>
              </div>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filteredItems.map((item) => {
              const isAvailable = item.available ?? true;
              return (
                <div
                  key={item.id}
                  className="rounded-2xl border border-border bg-card p-5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <h3
                          className={cn(
                            "text-lg font-semibold",
                            !isAvailable && "line-through text-slate-400",
                          )}
                        >
                          {item.name}
                        </h3>
                        {!isAvailable ? (
                          <span className="rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-semibold text-white">
                            Sold out
                          </span>
                        ) : null}
                      </div>
                      <p className="font-mono text-xl font-semibold">
                        KES {item.price.toLocaleString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => openEditItemDialog(item)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => deleteItem(item.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  <div className="mt-4 overflow-hidden rounded-2xl border border-dashed border-slate-200 bg-slate-50">
                    {item.image ? (
                      <img
                        src={item.image}
                        alt={item.name}
                        className="h-44 w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-44 items-center justify-center text-slate-400">
                        <ImageIcon className="h-8 w-8" />
                      </div>
                    )}
                  </div>

                  {item.description ? (
                    <p className="mt-4 text-sm text-muted-foreground">
                      {item.description}
                    </p>
                  ) : null}

                  <div className="mt-4 flex flex-wrap gap-2">
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium">
                      {item.category}
                    </span>
                    <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-medium text-blue-700">
                      {item.destination}
                    </span>
                    <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-700">
                      {getModifierSummary(item.modifiers)}
                    </span>
                    {item.linkedProductIds?.length ? (
                      <span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-medium text-violet-700">
                        {item.linkedProductIds.length} pairing
                        {item.linkedProductIds.length === 1 ? "" : "s"}
                      </span>
                    ) : null}
                  </div>

                  {(item.dietary || []).length ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {(item.dietary || []).map((tag) => (
                        <span
                          key={tag}
                          className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-700"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  ) : null}

                  <div className="mt-4 flex items-center justify-between rounded-2xl bg-slate-50 p-3">
                    <div>
                      <p className="text-sm font-medium">Availability</p>
                      <p className="text-xs text-muted-foreground">
                        Shown to customers instantly
                      </p>
                    </div>
                    <Switch
                      checked={isAvailable}
                      onCheckedChange={(available) =>
                        toggleAvailability(item.id, available)
                      }
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </TabsContent>

        <TabsContent value="menus" className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={openNewMenuDialog} className="gap-2">
              <Plus className="h-4 w-4" /> Add menu
            </Button>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {snapshot.menus.map((menu) => (
              <div
                key={menu.id}
                className="rounded-2xl border border-border bg-card p-5"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg font-semibold">{menu.name}</h3>
                      {menu.isActive ? (
                        <Badge className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-700 hover:bg-emerald-100">
                          Active
                        </Badge>
                      ) : null}
                    </div>
                    {menu.description ? (
                      <p className="mt-2 text-sm text-muted-foreground">
                        {menu.description}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => openEditMenuDialog(menu)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => deleteMenu(menu.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between rounded-2xl bg-slate-50 p-4">
                  <div>
                    <p className="text-sm font-medium">
                      {menu.categories.length} categories
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Created {new Date(menu.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <Switch
                    checked={menu.isActive}
                    onCheckedChange={(checked) =>
                      toggleMenuActive(menu.id, checked)
                    }
                  />
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {getOrderedCategories(
                    menu.categories,
                    snapshot.categoryOrder,
                  ).map((entry) => (
                    <span
                      key={entry}
                      className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700"
                    >
                      {entry}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="zones" className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={openNewZoneDialog} className="gap-2">
              <Plus className="h-4 w-4" /> Add zone
            </Button>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {snapshot.zones.map((zone) => {
              const assignedMenus = snapshot.menus.filter((menu) =>
                zone.menuIds.includes(menu.id),
              );
              return (
                <div
                  key={zone.id}
                  className="rounded-2xl border border-border bg-card p-5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <MapPinned className="h-4 w-4 text-muted-foreground" />
                        <h3 className="text-lg font-semibold">{zone.name}</h3>
                      </div>
                      <div className="mt-2 inline-flex rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-700">
                        Tables {zone.tableRange[0]}–{zone.tableRange[1]}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => openEditZoneDialog(zone)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => deleteZone(zone.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  <div className="mt-4 space-y-2">
                    <p className="text-sm font-medium">Assigned menus</p>
                    <div className="flex flex-wrap gap-2">
                      {assignedMenus.map((menu) => (
                        <span
                          key={menu.id}
                          className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700"
                        >
                          {menu.name}
                        </span>
                      ))}
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
                    {allCategories.map((option) => {
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
                    : "No schedule is active. Customers will see all menu categories allowed by active menus."}
                </p>
                {activeSchedule ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {getOrderedCategories(
                      activeSchedule.categories,
                      snapshot.categoryOrder,
                    ).map((entry) => (
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
                      {getOrderedCategories(
                        schedule.categories,
                        snapshot.categoryOrder,
                      ).map((entry) => (
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

      <Dialog open={itemDialogOpen} onOpenChange={setItemDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>
              {editingItemId ? "Edit menu item" : "Add menu item"}
            </DialogTitle>
            <DialogDescription>
              Manage photos, availability, modifiers, and suggested pairings.
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
                  {allCategories.map((option) => (
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
                      onChange={() =>
                        setDraftItem((current) => ({
                          ...current,
                          dietary: (current.dietary || []).includes(tag)
                            ? (current.dietary || []).filter(
                                (entry) => entry !== tag,
                              )
                            : [...(current.dietary || []), tag],
                        }))
                      }
                    />
                    {tag}
                  </label>
                ))}
              </div>

              <div className="rounded-2xl border border-border p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold">
                      Suggested Pairings
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      Recommend up to a few complementary products.
                    </p>
                  </div>
                </div>
                <div className="mt-3 space-y-3">
                  <Input
                    value={pairingsSearch}
                    onChange={(event) => setPairingsSearch(event.target.value)}
                    placeholder="Search other items"
                  />
                  <div className="max-h-44 space-y-2 overflow-y-auto">
                    {filteredPairingOptions.map((item) => {
                      const selected = (
                        draftItem.linkedProductIds || []
                      ).includes(item.id);
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => toggleLinkedProduct(item.id)}
                          className={cn(
                            "flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-sm",
                            selected
                              ? "border-violet-500 bg-violet-50 text-violet-700"
                              : "border-border",
                          )}
                        >
                          <div>
                            <p className="font-medium">{item.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {item.category} · KES{" "}
                              {item.price.toLocaleString()}
                            </p>
                          </div>
                          <span>{selected ? "Selected" : "Select"}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-border p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold">Modifiers</h3>
                    <p className="text-xs text-muted-foreground">
                      Add groups like size, extras, or style.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addModifierGroup}
                  >
                    Add group
                  </Button>
                </div>
                <div className="mt-4 space-y-4">
                  {(draftItem.modifiers || []).map((modifier) => (
                    <div
                      key={modifier.id}
                      className="rounded-2xl border border-border p-4"
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
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeModifierGroup(modifier.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      <div className="mt-3 space-y-3">
                        {modifier.options.map((option) => (
                          <div
                            key={option.id}
                            className="grid gap-2 sm:grid-cols-[1fr_140px_auto]"
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
                              placeholder="Price adj."
                              value={option.priceAdjustment}
                              onChange={(event) =>
                                updateModifierOption(modifier.id, option.id, {
                                  priceAdjustment: Number(event.target.value),
                                })
                              }
                            />
                            <Button
                              type="button"
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
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => addModifierOption(modifier.id)}
                        className="mt-3"
                      >
                        Add option
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setItemDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveItem}>
              {editingItemId ? "Update item" : "Save item"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={menuDialogOpen} onOpenChange={setMenuDialogOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editingMenuId ? "Edit menu" : "Create menu"}
            </DialogTitle>
            <DialogDescription>
              Choose the categories this menu should expose to customers.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <Input
              value={menuDraft.name}
              onChange={(event) =>
                setMenuDraft((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
              placeholder="Menu name"
            />
            <textarea
              value={menuDraft.description || ""}
              onChange={(event) =>
                setMenuDraft((current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
              placeholder="Optional description"
              className="min-h-24 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
            />
            <div className="rounded-2xl border border-border p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Active menu</span>
                <Switch
                  checked={menuDraft.isActive}
                  onCheckedChange={(isActive) =>
                    setMenuDraft((current) => ({ ...current, isActive }))
                  }
                />
              </div>
            </div>
            <div>
              <p className="mb-3 text-sm font-medium">Categories</p>
              <div className="flex flex-wrap gap-2">
                {allCategories.map((option) => {
                  const selected = menuDraft.categories.includes(option);
                  return (
                    <button
                      key={option}
                      type="button"
                      onClick={() =>
                        setMenuDraft((current) => ({
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
                          ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                          : "border-border bg-background",
                      )}
                    >
                      {option}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMenuDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveMenu}>
              {editingMenuId ? "Update menu" : "Create menu"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={zoneDialogOpen} onOpenChange={setZoneDialogOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editingZoneId ? "Edit zone" : "Create zone"}
            </DialogTitle>
            <DialogDescription>
              Assign menus to a table range.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <Input
              value={zoneDraft.name}
              onChange={(event) =>
                setZoneDraft((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
              placeholder="Zone name"
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-2 text-sm font-medium">
                <span>Table start</span>
                <Input
                  type="number"
                  min={1}
                  value={zoneDraft.tableStart}
                  onChange={(event) =>
                    setZoneDraft((current) => ({
                      ...current,
                      tableStart: Number(event.target.value) || 1,
                    }))
                  }
                />
              </label>
              <label className="space-y-2 text-sm font-medium">
                <span>Table end</span>
                <Input
                  type="number"
                  min={1}
                  value={zoneDraft.tableEnd}
                  onChange={(event) =>
                    setZoneDraft((current) => ({
                      ...current,
                      tableEnd: Number(event.target.value) || 1,
                    }))
                  }
                />
              </label>
            </div>
            <div>
              <p className="mb-3 text-sm font-medium">Menus</p>
              <div className="space-y-2">
                {snapshot.menus.map((menu) => {
                  const selected = zoneDraft.menuIds.includes(menu.id);
                  return (
                    <button
                      key={menu.id}
                      type="button"
                      onClick={() =>
                        setZoneDraft((current) => ({
                          ...current,
                          menuIds: selected
                            ? current.menuIds.filter(
                                (entry) => entry !== menu.id,
                              )
                            : [...current.menuIds, menu.id],
                        }))
                      }
                      className={cn(
                        "flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left",
                        selected
                          ? "border-blue-500 bg-blue-50 text-blue-700"
                          : "border-border",
                      )}
                    >
                      <div>
                        <p className="font-medium">{menu.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {menu.categories.length} categories
                        </p>
                      </div>
                      <span>{selected ? "Selected" : "Select"}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setZoneDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveZone}>
              {editingZoneId ? "Update zone" : "Create zone"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Menu preview</DialogTitle>
            <DialogDescription>
              Read-only customer view using active menus, schedules, and zone
              rules.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <label className="space-y-2 text-sm font-medium">
                <span>Preview table number</span>
                <Input
                  type="number"
                  min={1}
                  value={previewTableNumber}
                  onChange={(event) =>
                    setPreviewTableNumber(Number(event.target.value) || 1)
                  }
                />
              </label>
              {previewZone ? (
                <div className="rounded-full bg-blue-100 px-3 py-2 text-sm font-medium text-blue-700">
                  Zone: {previewZone.name}
                </div>
              ) : (
                <div className="rounded-full bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700">
                  No zone match
                </div>
              )}
            </div>

            <div className="mx-auto w-full max-w-[390px] rounded-3xl border-[10px] border-slate-900 bg-background p-4 shadow-2xl">
              <div className="rounded-[28px] bg-slate-50 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                      Customer preview
                    </p>
                    <h3 className="text-xl font-semibold">
                      Table {previewTableNumber}
                    </h3>
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    <p>{activeMenus.length} active menus</p>
                    <p>
                      {activeSchedule
                        ? activeSchedule.name
                        : "No schedule limit"}
                    </p>
                  </div>
                </div>

                <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
                  <button
                    type="button"
                    onClick={() => setPreviewCategory("All")}
                    className={cn(
                      "rounded-full px-3 py-1.5 text-xs font-semibold whitespace-nowrap",
                      previewCategory === "All"
                        ? "bg-slate-900 text-white"
                        : "bg-white text-slate-700",
                    )}
                  >
                    All
                  </button>
                  {previewCategories.map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => setPreviewCategory(item)}
                      className={cn(
                        "rounded-full px-3 py-1.5 text-xs font-semibold whitespace-nowrap",
                        previewCategory === item
                          ? "bg-slate-900 text-white"
                          : "bg-white text-slate-700",
                      )}
                    >
                      {item}
                    </button>
                  ))}
                </div>

                <div className="mt-4 space-y-3">
                  {previewVisibleItems.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-border bg-white px-4 py-8 text-center text-sm text-muted-foreground">
                      No items visible for this table right now.
                    </div>
                  ) : null}
                  {previewVisibleItems.map((item) => (
                    <div
                      key={item.id}
                      className="overflow-hidden rounded-3xl border border-border bg-white shadow-sm"
                    >
                      <div className="h-36 bg-slate-100">
                        {item.image ? (
                          <img
                            src={item.image}
                            alt={item.name}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center text-slate-400">
                            <ImageIcon className="h-8 w-8" />
                          </div>
                        )}
                      </div>
                      <div className="space-y-3 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <h4
                              className={cn(
                                "font-semibold",
                                (item.available ?? true) === false &&
                                  "text-slate-400 line-through",
                              )}
                            >
                              {item.name}
                            </h4>
                            {item.description ? (
                              <p className="mt-1 text-sm text-muted-foreground">
                                {item.description}
                              </p>
                            ) : null}
                          </div>
                          {(item.available ?? true) === false ? (
                            <span className="rounded-full bg-red-500 px-2 py-1 text-[10px] font-semibold text-white">
                              Sold out
                            </span>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium">
                            {item.category}
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
                        <div className="font-mono text-lg font-semibold">
                          KES {item.price.toLocaleString()}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
