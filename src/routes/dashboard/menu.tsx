import { createFileRoute } from "@tanstack/react-router";
import { Bot } from "lucide-react";
import { toast } from "sonner";
import { useEffect, useMemo, useState } from "react";
import { CustomerMenuList } from "@/components/merchant/features/customer-menu-list";
import {
  DynamicMenusTab,
  type ServerMenu,
} from "@/components/merchant/features/DynamicMenusTab";
import { MenuSettingsTab } from "@/components/merchant/features/MenuSettingsTab";
import type {
  CatalogueItem,
  ItemModifier,
  Menu,
  ModifierOption,
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
import { Textarea } from "@/components/ui/textarea";
import {
  ensureMerchantDemoData,
  getCurrentVenueId,
  getMenuCategoriesByIds,
  getOrderedMerchantCategories,
  getZoneForTable,
  saveMerchantCatalogue,
  saveMerchantCategoryOrder,
  saveMerchantMenuSchedules,
  saveMerchantMenus,
  saveMerchantZones,
} from "@/lib/merchant-dashboard";
import { authFetch } from "@/lib/auth";
import { hydrateMenuFromServer } from "@/lib/server-sync";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/menu")({
  component: DashboardMenuPage,
});

type TabKey = "items" | "menus" | "zones" | "settings" | "engineering";

type ApiMenuItem = {
  id: string;
  name: string;
  category: string;
  price: number | string;
  dietary?: string[] | null;
  available?: boolean;
  revision?: number;
  displayName?: string | null;
  description?: string | null;
  allergens?: string[] | null;
  tags?: string[] | null;
  imageUrl?: string | null;
  imageAlt?: string | null;
  videoUrl?: string | null;
  videoDescription?: string | null;
};

type EngItem = {
  name: string;
  category: string;
  price: number;
  cost: number;
  hasCost: boolean;
  unitsSold: number;
  margin: number;
  marginPct: number;
  menuMixPct: number;
  quadrant: "star" | "plowhorse" | "puzzle" | "dog";
  recommendation: string;
};

type MenuEngineeringResp = {
  currency: string;
  totalUnits: number;
  totalRevenue: number;
  totalContribution: number;
  avgMarginPerUnit: number;
  counts: Record<"star" | "plowhorse" | "puzzle" | "dog", number>;
  headline: string;
  advice: string;
  aiAdvice: boolean;
  from: string;
  to: string;
  items: EngItem[];
};

const QUAD_LABEL = {
  star: "Star",
  plowhorse: "Plowhorse",
  puzzle: "Puzzle",
  dog: "Dog",
} as const;

const QUAD_STYLE = {
  star: "bg-emerald-100 text-emerald-700",
  plowhorse: "bg-amber-100 text-amber-700",
  puzzle: "bg-sky-100 text-sky-700",
  dog: "bg-rose-100 text-rose-700",
} as const;

const TAB_OPTIONS: Array<{ key: TabKey; label: string }> = [
  { key: "items", label: "Items" },
  { key: "menus", label: "Menus" },
  { key: "zones", label: "Zones" },
  { key: "settings", label: "Settings" },
  { key: "engineering", label: "Engineering" },
];

// Matches MAX_PRODUCT_UPSELLS in src/lib/menu-upsell.ts.
const MAX_PAIRINGS = 5;

const DIETARY_OPTIONS = [
  "vegan",
  "vegetarian",
  "gluten-free",
  "halal",
  "contains-nuts",
  "dairy-free",
];

const ZONE_BORDER_CLASSES = [
  "border-l-cyan-500",
  "border-l-emerald-500",
  "border-l-fuchsia-500",
  "border-l-amber-500",
  "border-l-violet-500",
];

function createId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function createEmptyModifierOption(): ModifierOption {
  return { id: createId("option"), label: "", priceAdjustment: 0 };
}

function createEmptyModifier(): ItemModifier {
  return {
    id: createId("modifier"),
    name: "",
    options: [createEmptyModifierOption()],
  };
}

function createEmptyItem(): CatalogueItem {
  return {
    id: createId("item"),
    name: "",
    price: 0,
    category: "",
    dietary: [],
    destination: "kitchen",
    image: "",
    available: true,
    description: "",
    modifiers: [],
    linkedProductIds: [],
  };
}

function createEmptyZone(): Zone {
  return {
    id: createId("zone"),
    name: "",
    menuIds: [],
    tableRange: [1, 10],
  };
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

function toggleValue(values: string[], value: string) {
  return values.includes(value)
    ? values.filter((entry) => entry !== value)
    : [...values, value];
}

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function sortItems(items: CatalogueItem[], categoryOrder: string[]) {
  const orderIndex = new Map(
    categoryOrder.map((category, index) => [category, index]),
  );
  return [...items].sort((a, b) => {
    const categoryDelta =
      (orderIndex.get(a.category) ?? 999) - (orderIndex.get(b.category) ?? 999);
    if (categoryDelta !== 0) return categoryDelta;
    return a.name.localeCompare(b.name);
  });
}

function apiMenuItemToCatalogueItem(item: ApiMenuItem): CatalogueItem {
  return {
    id: item.id,
    name: item.name,
    price: Number(item.price) || 0,
    category: item.category,
    dietary: item.dietary ?? [],
    destination:
      item.category === "Drinks" || item.category === "Cocktails"
        ? "bar"
        : "kitchen",
    image: item.imageUrl ?? "",
    available: item.available ?? true,
    description: item.description ?? "",
    modifiers: [],
    linkedProductIds: [],
    revision: item.revision,
    displayName: item.displayName ?? "",
    allergens: item.allergens ?? [],
    tags: item.tags ?? [],
    imageAlt: item.imageAlt ?? "",
    videoUrl: item.videoUrl ?? "",
    videoDescription: item.videoDescription ?? "",
  };
}

function menuItemApiPayload(item: CatalogueItem) {
  return {
    name: item.name,
    category: item.category,
    price: Math.max(0, Math.floor(Number(item.price) || 0)),
    dietary: item.dietary ?? [],
    available: item.available ?? true,
    displayName: item.displayName ?? "",
    description: item.description ?? "",
    allergens: item.allergens ?? [],
    tags: item.tags ?? [],
    imageUrl: item.image ?? "",
    imageAlt: item.imageAlt ?? "",
    videoUrl: item.videoUrl ?? "",
    videoDescription: item.videoDescription ?? "",
  };
}

function DashboardMenuPage() {
  const [hydrated, setHydrated] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>("items");
  const [catalogue, setCatalogue] = useState<CatalogueItem[]>([]);
  const [apiMenuEnabled, setApiMenuEnabled] = useState(false);
  const [syncingMenu, setSyncingMenu] = useState(false);

  async function syncMenuToAgent() {
    setSyncingMenu(true);
    try {
      const venue = getCurrentVenueId();
      const items = catalogue.map((item) => ({
        id: item.id,
        name: item.name,
        category: item.category,
        price: item.price,
        dietary: item.dietary ?? [],
        available: item.available ?? true,
      }));
      const res = await authFetch(
        `/api/menu/sync?venue=${encodeURIComponent(venue)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ venue, items }),
        },
      );
      if (!res.ok) throw new Error("failed");
      const data = (await res.json()) as { count?: number };
      toast.success(
        `Synced ${data.count ?? items.length} items to the AI agent.`,
      );
    } catch {
      toast.error("Could not sync to the agent (cloud backend offline).");
    } finally {
      setSyncingMenu(false);
    }
  }
  // Menus are server-authoritative (DynamicMenusTab owns the writes). The page
  // keeps a read-only projection so the zone editor and the customer preview
  // still work off exactly what a guest would be served.
  const [serverMenus, setServerMenus] = useState<ServerMenu[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [categoryOrder, setCategoryOrder] = useState<string[]>([]);
  const [itemDraft, setItemDraft] = useState<CatalogueItem | null>(null);
  const [zoneDraft, setZoneDraft] = useState<Zone | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>("All");
  const [draggedCategory, setDraggedCategory] = useState<string | null>(null);
  const [linkedProductSearch, setLinkedProductSearch] = useState("");
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [previewTableNumber, setPreviewTableNumber] = useState(12);
  const [engineering, setEngineering] = useState<MenuEngineeringResp | null>(
    null,
  );
  const [engLoading, setEngLoading] = useState(false);

  async function loadEngineering() {
    setEngLoading(true);
    try {
      const res = await authFetch("/api/menu/engineering");
      if (res.ok) {
        setEngineering((await res.json()) as MenuEngineeringResp);
      } else {
        toast.error("Couldn't load menu engineering");
      }
    } catch {
      toast.error("Couldn't load menu engineering");
    } finally {
      setEngLoading(false);
    }
  }

  useEffect(() => {
    if (activeTab === "engineering" && !engineering && !engLoading) {
      void loadEngineering();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  useEffect(() => {
    let cancelled = false;
    const snapshot = ensureMerchantDemoData();
    if (!cancelled) {
      setCatalogue(snapshot.catalogue);
      setZones(snapshot.zones);
      setCategoryOrder(snapshot.categoryOrder);
      setHydrated(true);
    }
    const venue = getCurrentVenueId();
    authFetch(`/api/menu?venue=${encodeURIComponent(venue)}`)
      .then(async (res) => {
        if (!res.ok) return null;
        const data = (await res.json()) as { items?: ApiMenuItem[] };
        return data.items ?? [];
      })
      .then((items) => {
        if (cancelled || items == null) return;
        setCatalogue(items.map(apiMenuItemToCatalogueItem));
        setApiMenuEnabled(true);
        return authFetch("/api/menu/upsells")
          .then(async (res) =>
            res.ok
              ? ((await res.json()) as {
                  links?: Array<{ itemId: string; suggestedItemId: string }>;
                })
              : null,
          )
          .then((data) => {
            if (cancelled || !data?.links) return;
            const byItem = new Map<string, string[]>();
            for (const link of data.links) {
              byItem.set(link.itemId, [
                ...(byItem.get(link.itemId) ?? []),
                link.suggestedItemId,
              ]);
            }
            setCatalogue((current) =>
              current.map((item) => ({
                ...item,
                linkedProductIds: byItem.get(item.id) ?? [],
              })),
            );
          })
          .catch(() => undefined);
      })
      .catch(() => {
        if (!cancelled) setApiMenuEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydrated || apiMenuEnabled) return;
    saveMerchantCatalogue(catalogue);
  }, [apiMenuEnabled, catalogue, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    saveMerchantZones(zones);
  }, [hydrated, zones]);

  useEffect(() => {
    if (!hydrated) return;
    saveMerchantCategoryOrder(categoryOrder);
  }, [categoryOrder, hydrated]);

  // Read-only projection of the server menus into the shape the zone editor and
  // the preview already speak.
  const menus = useMemo<Menu[]>(
    () =>
      serverMenus.map((menu) => ({
        id: menu.id,
        name: menu.name,
        description: menu.description ?? "",
        categories: menu.categories,
        isActive: menu.isActive,
        createdAt: "",
      })),
    [serverMenus],
  );

  // The legacy /table pages still read menus from the local snapshot. Mirror the
  // server's list into it (one-way) so they cannot drift, and clear the retired
  // schedule list — visibility now lives on the menu itself, and a stale
  // schedule would filter the new menu ids out of those pages entirely.
  useEffect(() => {
    if (!hydrated || serverMenus.length === 0) return;
    saveMerchantMenus(menus);
    saveMerchantMenuSchedules([]);
  }, [hydrated, menus, serverMenus.length]);

  const allCategories = useMemo(
    () =>
      Array.from(
        new Set(
          [
            ...catalogue.map((item) => item.category),
            ...menus.flatMap((menu) => menu.categories),
          ].filter(Boolean),
        ),
      ),
    [catalogue, menus],
  );

  const orderedCategories = useMemo(
    () => getOrderedMerchantCategories(allCategories, categoryOrder),
    [allCategories, categoryOrder],
  );

  useEffect(() => {
    if (!hydrated) return;
    const normalisedOrder = getOrderedMerchantCategories(
      allCategories,
      categoryOrder,
    );
    if (normalisedOrder.join("|") !== categoryOrder.join("|")) {
      setCategoryOrder(normalisedOrder);
    }
  }, [allCategories, categoryOrder, hydrated]);

  useEffect(() => {
    if (selectedCategory === "All") return;
    if (!orderedCategories.includes(selectedCategory)) {
      setSelectedCategory("All");
    }
  }, [orderedCategories, selectedCategory]);

  const activeMenuIds = useMemo(
    () => serverMenus.filter((menu) => menu.isActive).map((menu) => menu.id),
    [serverMenus],
  );

  const previewZone = useMemo(
    () => getZoneForTable(zones, previewTableNumber),
    [previewTableNumber, zones],
  );

  const previewVisibleMenuIds = useMemo(() => {
    const zoneMenuIds = previewZone?.menuIds ?? [];
    if (zoneMenuIds.length) {
      const intersected = activeMenuIds.length
        ? zoneMenuIds.filter((menuId) => activeMenuIds.includes(menuId))
        : zoneMenuIds;
      return intersected.length ? intersected : zoneMenuIds;
    }
    return activeMenuIds;
  }, [activeMenuIds, previewZone]);

  const previewCategories = useMemo(() => {
    if (!previewVisibleMenuIds.length) return orderedCategories;
    return getOrderedMerchantCategories(
      getMenuCategoriesByIds(menus, previewVisibleMenuIds),
      categoryOrder,
    );
  }, [categoryOrder, menus, orderedCategories, previewVisibleMenuIds]);

  const previewItems = useMemo(() => {
    const visibleSet = new Set(previewCategories);
    return sortItems(
      catalogue.filter((item) => visibleSet.has(item.category)),
      categoryOrder,
    );
  }, [catalogue, categoryOrder, previewCategories]);

  const filteredItems = useMemo(() => {
    const items = sortItems(catalogue, categoryOrder);
    if (selectedCategory === "All") return items;
    return items.filter((item) => item.category === selectedCategory);
  }, [catalogue, categoryOrder, selectedCategory]);

  const linkedProductChoices = useMemo(() => {
    const search = linkedProductSearch.trim().toLowerCase();
    const currentId = itemDraft?.id;
    return sortItems(
      catalogue.filter((item) => {
        if (item.id === currentId) return false;
        if (!search) return true;
        return `${item.name} ${item.category}`.toLowerCase().includes(search);
      }),
      categoryOrder,
    );
  }, [catalogue, categoryOrder, itemDraft?.id, linkedProductSearch]);

  const menuLookup = useMemo(
    () => new Map(menus.map((menu) => [menu.id, menu])),
    [menus],
  );

  const itemCountByCategory = useMemo(() => {
    return catalogue.reduce<Record<string, number>>((acc, item) => {
      acc[item.category] = (acc[item.category] ?? 0) + 1;
      return acc;
    }, {});
  }, [catalogue]);

  function handleCategoryDrop(targetCategory: string) {
    if (!draggedCategory || draggedCategory === targetCategory) return;
    const nextOrder = orderedCategories.filter(
      (category) => category !== draggedCategory,
    );
    const targetIndex = nextOrder.indexOf(targetCategory);
    nextOrder.splice(targetIndex, 0, draggedCategory);
    setCategoryOrder(nextOrder);
    setDraggedCategory(null);
  }

  // C6.7 — per-product pairings live on the server, not in the local draft, so
  // the same suggestion follows a product into every menu it appears on.
  async function handleSaveItem() {
    if (!itemDraft) return;
    const cleanedItem: CatalogueItem = {
      ...itemDraft,
      name: itemDraft.name.trim(),
      category: itemDraft.category.trim(),
      description: itemDraft.description?.trim() ?? "",
      image: itemDraft.image?.trim() ?? "",
      modifiers:
        itemDraft.modifiers
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
          .filter((modifier) => modifier.name && modifier.options.length) ?? [],
      linkedProductIds: itemDraft.linkedProductIds?.slice(0, MAX_PAIRINGS) ?? [],
      price: Number(itemDraft.price) || 0,
    };

    if (!cleanedItem.name || !cleanedItem.category) return;

    const previous = catalogue;
    const existing = catalogue.some((item) => item.id === cleanedItem.id);
    setCatalogue((current) => upsertById(current, cleanedItem));
    if (apiMenuEnabled) {
      try {
        const res = await authFetch(
          existing ? `/api/menu/item/${cleanedItem.id}` : "/api/menu/item",
          {
            method: existing ? "PATCH" : "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              ...menuItemApiPayload(cleanedItem),
              ...(existing ? { revision: cleanedItem.revision } : {}),
            }),
          },
        );
        if (!res.ok) throw new Error("menu item save failed");
        const data = (await res.json()) as { item?: ApiMenuItem };
        const savedId = !existing && data.item ? data.item.id : cleanedItem.id;
        if (!existing && data.item) {
          const createdItem = apiMenuItemToCatalogueItem(data.item);
          setCatalogue((current) =>
            current.map((item) =>
              item.id === cleanedItem.id
                ? { ...cleanedItem, id: createdItem.id }
                : item,
            ),
          );
        }
        // C6.7 — pairings are a separate resource, saved against the real id so a
        // brand-new item's suggestions are not written to its temporary one.
        await authFetch(
          `/api/menu/item/${encodeURIComponent(savedId)}/upsells`,
          {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              suggestedItemIds: cleanedItem.linkedProductIds ?? [],
            }),
          },
        ).catch(() => {
          toast.error("Item saved, but its suggested pairings did not.");
        });
        // Mirror the server truth into localStorage so legacy views update.
        void hydrateMenuFromServer();
      } catch {
        setCatalogue(previous);
        toast.error("Could not save item. Refresh to resolve a possible conflict.");
        return;
      }
    }
    setCategoryOrder((current) =>
      getOrderedMerchantCategories(
        [...allCategories, cleanedItem.category],
        current,
      ),
    );
    setItemDraft(null);
    setLinkedProductSearch("");
  }

  async function handleDeleteItem(itemId: string) {
    const previous = catalogue;
    setCatalogue((current) =>
      current
        .filter((item) => item.id !== itemId)
        .map((item) => ({
          ...item,
          linkedProductIds:
            item.linkedProductIds?.filter((linkedId) => linkedId !== itemId) ??
            [],
        })),
    );
    if (apiMenuEnabled) {
      try {
        const item = previous.find((entry) => entry.id === itemId);
        const res = await authFetch(
          `/api/menu/item/${itemId}?revision=${encodeURIComponent(String(item?.revision ?? ""))}`,
          {
          method: "DELETE",
          },
        );
        if (!res.ok) throw new Error("menu item delete failed");
        void hydrateMenuFromServer();
      } catch {
        setCatalogue(previous);
        toast.error("Could not delete item. Refresh to resolve a possible conflict.");
        return;
      }
    }
    if (itemDraft?.id === itemId) setItemDraft(null);
  }

  function handleSaveZone() {
    if (!zoneDraft) return;
    const start = Math.min(...zoneDraft.tableRange);
    const end = Math.max(...zoneDraft.tableRange);
    const cleanedZone: Zone = {
      ...zoneDraft,
      name: zoneDraft.name.trim(),
      menuIds: Array.from(new Set(zoneDraft.menuIds)),
      tableRange: [start, end],
    };
    if (!cleanedZone.name || !cleanedZone.menuIds.length) return;
    setZones((current) => upsertById(current, cleanedZone));
    setZoneDraft(null);
  }

  return (
    <div className="relative mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 md:px-6 lg:px-8">
      <div className="flex flex-col gap-4 rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <p className="text-sm font-medium text-purple-600">
              Merchant menu controls
            </p>
            <div>
              <h1 className="text-3xl font-semibold text-slate-950">
                Menu Phase 2
              </h1>
              <p className="text-sm text-slate-500">
                Manage catalogue items, customer-facing menus, table zones, and
                what a guest sees when they scan.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge className="bg-slate-100 text-slate-700 hover:bg-slate-100">
                {menus.filter((menu) => menu.isActive).length} active menu(s)
              </Badge>
              <Badge
                variant="outline"
                className="border-slate-200 text-slate-600"
              >
                {zones.length} zone{zones.length === 1 ? "" : "s"}
              </Badge>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={syncMenuToAgent}
              disabled={syncingMenu}
            >
              <Bot className="mr-1 h-3.5 w-3.5" />
              {syncingMenu ? "Syncing…" : "Sync to AI agent"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setItemDraft(createEmptyItem())}
            >
              New item
            </Button>
            <Button type="button" onClick={() => setIsPreviewOpen(true)}>
              Preview
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 rounded-2xl bg-slate-100 p-1">
          {TAB_OPTIONS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                "rounded-2xl px-4 py-2 text-sm font-medium transition",
                activeTab === tab.key
                  ? "bg-white text-slate-950 shadow-sm"
                  : "text-slate-500 hover:text-slate-800",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {activeTab === "items" ? (
        <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
          <div className="space-y-6">
            <Card className="border-slate-200 bg-white/90 shadow-sm">
              <CardHeader>
                <CardTitle>Category order</CardTitle>
                <CardDescription>
                  Drag category pills into the order customers should see on the
                  dashboard and QR menu.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => setSelectedCategory("All")}
                    className={cn(
                      "rounded-full border px-4 py-2 text-sm font-medium transition",
                      selectedCategory === "All"
                        ? "border-purple-500 bg-purple-600 text-white"
                        : "border-slate-200 bg-white text-slate-600",
                    )}
                  >
                    All items
                  </button>
                  {orderedCategories.map((category) => (
                    <button
                      key={category}
                      type="button"
                      draggable
                      onDragStart={() => setDraggedCategory(category)}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={() => handleCategoryDrop(category)}
                      onClick={() => setSelectedCategory(category)}
                      className={cn(
                        "flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition",
                        selectedCategory === category
                          ? "border-purple-500 bg-purple-600 text-white"
                          : "border-slate-200 bg-white text-slate-700",
                      )}
                    >
                      <span className="text-base leading-none">⠿</span>
                      <span>{category}</span>
                      <span className="text-xs opacity-75">
                        {itemCountByCategory[category] ?? 0}
                      </span>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>

            <div className="grid gap-4 md:grid-cols-2">
              {filteredItems.map((item) => (
                <Card
                  key={item.id}
                  className="border-slate-200 bg-white/90 shadow-sm"
                >
                  <CardContent className="flex h-full flex-col gap-4 p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-lg font-semibold text-slate-950">
                            {item.name}
                          </h3>
                          <Badge
                            variant="secondary"
                            className="bg-slate-100 text-slate-700"
                          >
                            {item.category}
                          </Badge>
                          {item.available === false ? (
                            <Badge className="bg-rose-100 text-rose-700 hover:bg-rose-100">
                              Sold out
                            </Badge>
                          ) : null}
                        </div>
                        <p className="mt-2 text-sm text-slate-500">
                          {item.description || "No description added yet."}
                        </p>
                      </div>
                      <div className="text-right text-sm text-slate-500">
                        <p className="text-lg font-semibold text-slate-950">
                          KES {item.price.toFixed(0)}
                        </p>
                        <p>{item.destination === "bar" ? "Bar" : "Kitchen"}</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {item.dietary?.map((tag) => (
                        <Badge
                          key={`${item.id}-${tag}`}
                          variant="outline"
                          className="border-emerald-200 bg-emerald-50 text-emerald-700"
                        >
                          {tag}
                        </Badge>
                      ))}
                    </div>
                    <div className="mt-auto flex items-center justify-between gap-3 text-sm text-slate-500">
                      <span>
                        {item.linkedProductIds?.length ?? 0} suggested
                        pairing(s)
                      </span>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setItemDraft({
                              ...item,
                              dietary: item.dietary ?? [],
                              modifiers: item.modifiers ?? [],
                              linkedProductIds: item.linkedProductIds ?? [],
                            });
                            setLinkedProductSearch("");
                          }}
                        >
                          Edit
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="border-rose-200 text-rose-600 hover:bg-rose-50"
                          onClick={() => handleDeleteItem(item.id)}
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          <Card className="border-slate-200 bg-white/90 shadow-sm">
            <CardHeader>
              <CardTitle>{itemDraft ? "Edit item" : "Create item"}</CardTitle>
              <CardDescription>
                Keep your QR menu rich with pricing, dietary labels, modifiers,
                and suggested pairings.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {itemDraft ? (
                <div className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field label="Item name">
                      <Input
                        value={itemDraft.name}
                        onChange={(event) =>
                          setItemDraft({
                            ...itemDraft,
                            name: event.target.value,
                          })
                        }
                        placeholder="Nyama Choma Platter"
                      />
                    </Field>
                    <Field label="Name guests see (optional)">
                      <Input
                        value={itemDraft.displayName ?? ""}
                        onChange={(event) =>
                          setItemDraft({
                            ...itemDraft,
                            displayName: event.target.value,
                          })
                        }
                        placeholder={itemDraft.name || "Grilled beef platter"}
                      />
                    </Field>
                    <Field label="Category">
                      <Input
                        value={itemDraft.category}
                        onChange={(event) =>
                          setItemDraft({
                            ...itemDraft,
                            category: event.target.value,
                          })
                        }
                        placeholder="Mains"
                      />
                    </Field>
                    <Field label="Price (KES)">
                      <Input
                        type="number"
                        min="0"
                        value={itemDraft.price}
                        onChange={(event) =>
                          setItemDraft({
                            ...itemDraft,
                            price: Number(event.target.value),
                          })
                        }
                      />
                    </Field>
                    <Field label="Destination">
                      <select
                        value={itemDraft.destination ?? "kitchen"}
                        onChange={(event) =>
                          setItemDraft({
                            ...itemDraft,
                            destination: event.target
                              .value as CatalogueItem["destination"],
                          })
                        }
                        className="flex h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900"
                      >
                        <option value="kitchen">Kitchen</option>
                        <option value="bar">Bar</option>
                      </select>
                    </Field>
                    <Field label="Image URL">
                      <Input
                        value={itemDraft.image ?? ""}
                        onChange={(event) =>
                          setItemDraft({
                            ...itemDraft,
                            image: event.target.value,
                          })
                        }
                        placeholder="https://..."
                      />
                    </Field>
                    {itemDraft.image?.trim() ? (
                      <Field label="Image description (read to screen-reader guests)">
                        <Input
                          value={itemDraft.imageAlt ?? ""}
                          onChange={(event) =>
                            setItemDraft({
                              ...itemDraft,
                              imageAlt: event.target.value,
                            })
                          }
                          placeholder="Sliced beef on a wooden board"
                        />
                      </Field>
                    ) : null}
                    <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700">
                      <input
                        type="checkbox"
                        checked={itemDraft.available !== false}
                        onChange={(event) =>
                          setItemDraft({
                            ...itemDraft,
                            available: event.target.checked,
                          })
                        }
                        className="h-4 w-4 rounded border-slate-300 text-purple-600"
                      />
                      Available for ordering
                    </label>
                  </div>

                  <Field label="Description">
                    <Textarea
                      value={itemDraft.description ?? ""}
                      onChange={(event) =>
                        setItemDraft({
                          ...itemDraft,
                          description: event.target.value,
                        })
                      }
                      placeholder="Describe the dish or drink for customers"
                      rows={3}
                    />
                  </Field>

                  <Field label="Allergens">
                    <Input
                      value={(itemDraft.allergens ?? []).join(", ")}
                      onChange={(event) =>
                        setItemDraft({
                          ...itemDraft,
                          allergens: splitList(event.target.value),
                        })
                      }
                      placeholder="peanuts, sesame, shellfish"
                    />
                  </Field>
                  <p className="-mt-2 text-xs text-slate-500">
                    Comma separated, and shown to the guest as words — never as a
                    colour or an icon on its own.
                  </p>

                  <Field label="Tags">
                    <Input
                      value={(itemDraft.tags ?? []).join(", ")}
                      onChange={(event) =>
                        setItemDraft({
                          ...itemDraft,
                          tags: splitList(event.target.value),
                        })
                      }
                      placeholder="chef's pick, spicy, new"
                    />
                  </Field>

                  {itemDraft.image?.trim() ? (
                    <div className="grid gap-4 md:grid-cols-2">
                      <Field label="Video URL (optional)">
                        <Input
                          value={itemDraft.videoUrl ?? ""}
                          onChange={(event) =>
                            setItemDraft({
                              ...itemDraft,
                              videoUrl: event.target.value,
                            })
                          }
                          placeholder="https://…/dish.mp4"
                        />
                      </Field>
                      <Field label="Video description">
                        <Input
                          value={itemDraft.videoDescription ?? ""}
                          onChange={(event) =>
                            setItemDraft({
                              ...itemDraft,
                              videoDescription: event.target.value,
                            })
                          }
                          placeholder="The platter being carved at the table"
                        />
                      </Field>
                    </div>
                  ) : null}

                  <div className="space-y-3">
                    <p className="text-sm font-medium text-slate-700">
                      Dietary badges
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {DIETARY_OPTIONS.map((option) => (
                        <button
                          key={option}
                          type="button"
                          onClick={() =>
                            setItemDraft({
                              ...itemDraft,
                              dietary: toggleValue(
                                itemDraft.dietary ?? [],
                                option,
                              ),
                            })
                          }
                          className={cn(
                            "rounded-full border px-3 py-2 text-sm transition",
                            itemDraft.dietary?.includes(option)
                              ? "border-emerald-500 bg-emerald-500 text-white"
                              : "border-slate-200 bg-white text-slate-600",
                          )}
                        >
                          {option}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-4 rounded-3xl border border-slate-200 bg-slate-50/70 p-4">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">
                          Suggested pairings
                        </p>
                        <p className="text-sm text-slate-500">
                          Products to suggest whenever this item is in a guest's
                          order, on every menu it appears on. A product without a
                          photo is never offered — the card would be empty.
                        </p>
                      </div>
                      <Badge
                        variant="outline"
                        className="border-purple-200 text-purple-600"
                      >
                        {(itemDraft.linkedProductIds ?? []).length}/{MAX_PAIRINGS}{" "}
                        selected
                      </Badge>
                    </div>
                    <Input
                      value={linkedProductSearch}
                      onChange={(event) =>
                        setLinkedProductSearch(event.target.value)
                      }
                      placeholder="Search menu items to link"
                    />
                    <div className="max-h-52 space-y-2 overflow-y-auto pr-1">
                      {linkedProductChoices.map((item) => {
                        const isSelected =
                          itemDraft.linkedProductIds?.includes(item.id) ??
                          false;
                        const canSelect =
                          isSelected ||
                          (itemDraft.linkedProductIds?.length ?? 0) < MAX_PAIRINGS;
                        return (
                          <label
                            key={item.id}
                            className={cn(
                              "flex items-center justify-between gap-3 rounded-2xl border px-3 py-3 text-sm",
                              isSelected
                                ? "border-purple-300 bg-purple-50"
                                : "border-slate-200 bg-white",
                              !canSelect && "opacity-60",
                            )}
                          >
                            <div>
                              <p className="font-medium text-slate-900">
                                {item.name}
                              </p>
                              <p className="text-xs text-slate-500">
                                {item.category} • KES {item.price.toFixed(0)}
                              </p>
                            </div>
                            <input
                              type="checkbox"
                              checked={isSelected}
                              disabled={!canSelect}
                              onChange={() =>
                                setItemDraft({
                                  ...itemDraft,
                                  linkedProductIds: isSelected
                                    ? (itemDraft.linkedProductIds ?? []).filter(
                                        (linkedId) => linkedId !== item.id,
                                      )
                                    : [
                                        ...(itemDraft.linkedProductIds ?? []),
                                        item.id,
                                      ].slice(0, MAX_PAIRINGS),
                                })
                              }
                              className="h-4 w-4 rounded border-slate-300 text-purple-600"
                            />
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  <div className="space-y-4 rounded-3xl border border-slate-200 bg-slate-50/70 p-4">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">
                          Modifiers
                        </p>
                        <p className="text-sm text-slate-500">
                          Define option groups such as size, sides, or cooking
                          preference.
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setItemDraft({
                            ...itemDraft,
                            modifiers: [
                              ...(itemDraft.modifiers ?? []),
                              createEmptyModifier(),
                            ],
                          })
                        }
                      >
                        Add modifier
                      </Button>
                    </div>
                    <div className="space-y-4">
                      {(itemDraft.modifiers ?? []).map(
                        (modifier, modifierIndex) => (
                          <div
                            key={modifier.id}
                            className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4"
                          >
                            <div className="flex items-center gap-3">
                              <Input
                                value={modifier.name}
                                onChange={(event) =>
                                  setItemDraft({
                                    ...itemDraft,
                                    modifiers: (itemDraft.modifiers ?? []).map(
                                      (entry, index) =>
                                        index === modifierIndex
                                          ? {
                                              ...entry,
                                              name: event.target.value,
                                            }
                                          : entry,
                                    ),
                                  })
                                }
                                placeholder="Modifier name"
                              />
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="border-rose-200 text-rose-600 hover:bg-rose-50"
                                onClick={() =>
                                  setItemDraft({
                                    ...itemDraft,
                                    modifiers: (
                                      itemDraft.modifiers ?? []
                                    ).filter(
                                      (_, index) => index !== modifierIndex,
                                    ),
                                  })
                                }
                              >
                                Remove
                              </Button>
                            </div>
                            <div className="space-y-3">
                              {modifier.options.map((option, optionIndex) => (
                                <div
                                  key={option.id}
                                  className="grid gap-3 md:grid-cols-[1fr_140px_auto]"
                                >
                                  <Input
                                    value={option.label}
                                    onChange={(event) =>
                                      setItemDraft({
                                        ...itemDraft,
                                        modifiers: (
                                          itemDraft.modifiers ?? []
                                        ).map((entry, entryIndex) =>
                                          entryIndex === modifierIndex
                                            ? {
                                                ...entry,
                                                options: entry.options.map(
                                                  (
                                                    currentOption,
                                                    currentIndex,
                                                  ) =>
                                                    currentIndex === optionIndex
                                                      ? {
                                                          ...currentOption,
                                                          label:
                                                            event.target.value,
                                                        }
                                                      : currentOption,
                                                ),
                                              }
                                            : entry,
                                        ),
                                      })
                                    }
                                    placeholder="Option label"
                                  />
                                  <Input
                                    type="number"
                                    value={option.priceAdjustment}
                                    onChange={(event) =>
                                      setItemDraft({
                                        ...itemDraft,
                                        modifiers: (
                                          itemDraft.modifiers ?? []
                                        ).map((entry, entryIndex) =>
                                          entryIndex === modifierIndex
                                            ? {
                                                ...entry,
                                                options: entry.options.map(
                                                  (
                                                    currentOption,
                                                    currentIndex,
                                                  ) =>
                                                    currentIndex === optionIndex
                                                      ? {
                                                          ...currentOption,
                                                          priceAdjustment:
                                                            Number(
                                                              event.target
                                                                .value,
                                                            ),
                                                        }
                                                      : currentOption,
                                                ),
                                              }
                                            : entry,
                                        ),
                                      })
                                    }
                                    placeholder="0"
                                  />
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="border-rose-200 text-rose-600 hover:bg-rose-50"
                                    onClick={() =>
                                      setItemDraft({
                                        ...itemDraft,
                                        modifiers: (
                                          itemDraft.modifiers ?? []
                                        ).map((entry, entryIndex) =>
                                          entryIndex === modifierIndex
                                            ? {
                                                ...entry,
                                                options: entry.options.filter(
                                                  (_, currentIndex) =>
                                                    currentIndex !==
                                                    optionIndex,
                                                ),
                                              }
                                            : entry,
                                        ),
                                      })
                                    }
                                  >
                                    Delete
                                  </Button>
                                </div>
                              ))}
                            </div>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                setItemDraft({
                                  ...itemDraft,
                                  modifiers: (itemDraft.modifiers ?? []).map(
                                    (entry, entryIndex) =>
                                      entryIndex === modifierIndex
                                        ? {
                                            ...entry,
                                            options: [
                                              ...entry.options,
                                              createEmptyModifierOption(),
                                            ],
                                          }
                                        : entry,
                                  ),
                                })
                              }
                            >
                              Add option
                            </Button>
                          </div>
                        ),
                      )}
                    </div>
                  </div>

                  <div className="flex justify-end gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setItemDraft(null);
                        setLinkedProductSearch("");
                      }}
                    >
                      Cancel
                    </Button>
                    <Button type="button" onClick={handleSaveItem}>
                      Save item
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-4 py-12 text-center text-sm text-slate-500">
                  Select an item to edit or create a new dish, drink, or combo.
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {activeTab === "menus" ? (
        <DynamicMenusTab
          categories={orderedCategories}
          onMenusChange={setServerMenus}
        />
      ) : null}

      {activeTab === "zones" ? (
        <div className="grid gap-6 xl:grid-cols-[0.85fr_1.15fr]">
          <Card className="border-slate-200 bg-white/90 shadow-sm">
            <CardHeader>
              <CardTitle>{zoneDraft ? "Edit zone" : "Create zone"}</CardTitle>
              <CardDescription>
                Assign one or more menus to a range of table numbers.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <Field label="Zone name">
                  <Input
                    value={zoneDraft?.name ?? ""}
                    onChange={(event) =>
                      setZoneDraft((current) => ({
                        ...(current ?? createEmptyZone()),
                        name: event.target.value,
                      }))
                    }
                    placeholder="Terrace"
                  />
                </Field>
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Table start">
                    <Input
                      type="number"
                      min="1"
                      value={zoneDraft?.tableRange[0] ?? 1}
                      onChange={(event) =>
                        setZoneDraft((current) => ({
                          ...(current ?? createEmptyZone()),
                          tableRange: [
                            Number(event.target.value) || 1,
                            current?.tableRange[1] ?? 10,
                          ],
                        }))
                      }
                    />
                  </Field>
                  <Field label="Table end">
                    <Input
                      type="number"
                      min="1"
                      value={zoneDraft?.tableRange[1] ?? 10}
                      onChange={(event) =>
                        setZoneDraft((current) => ({
                          ...(current ?? createEmptyZone()),
                          tableRange: [
                            current?.tableRange[0] ?? 1,
                            Number(event.target.value) || 10,
                          ],
                        }))
                      }
                    />
                  </Field>
                </div>
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-4">
                    <p className="text-sm font-medium text-slate-700">
                      Assigned menus
                    </p>
                    <Badge
                      variant="outline"
                      className="border-slate-200 text-slate-600"
                    >
                      {(zoneDraft?.menuIds ?? []).length} selected
                    </Badge>
                  </div>
                  <div className="space-y-2">
                    {menus.map((menu) => (
                      <label
                        key={menu.id}
                        className={cn(
                          "flex items-center justify-between rounded-2xl border px-3 py-3 text-sm",
                          zoneDraft?.menuIds.includes(menu.id)
                            ? "border-sky-300 bg-sky-50"
                            : "border-slate-200 bg-white",
                        )}
                      >
                        <div>
                          <p className="font-medium text-slate-900">
                            {menu.name}
                          </p>
                          <p className="text-xs text-slate-500">
                            {menu.categories.length} categories
                          </p>
                        </div>
                        <input
                          type="checkbox"
                          checked={
                            zoneDraft?.menuIds.includes(menu.id) ?? false
                          }
                          onChange={() =>
                            setZoneDraft((current) => ({
                              ...(current ?? createEmptyZone()),
                              menuIds: toggleValue(
                                current?.menuIds ?? [],
                                menu.id,
                              ),
                            }))
                          }
                          className="h-4 w-4 rounded border-slate-300 text-purple-600"
                        />
                      </label>
                    ))}
                  </div>
                </div>
                <div className="flex justify-end gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setZoneDraft(createEmptyZone())}
                  >
                    Reset
                  </Button>
                  <Button type="button" onClick={handleSaveZone}>
                    Save zone
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            {zones.map((zone, index) => (
              <Card
                key={zone.id}
                className={cn(
                  "border-l-4 border-slate-200 bg-white/90 shadow-sm",
                  ZONE_BORDER_CLASSES[index % ZONE_BORDER_CLASSES.length],
                )}
              >
                <CardContent className="space-y-4 p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="text-lg font-semibold text-slate-950">
                        {zone.name}
                      </h3>
                      <p className="mt-1 text-sm text-slate-500">
                        Assigned to {zone.menuIds.length} menu(s)
                      </p>
                    </div>
                    <Badge className="bg-slate-100 text-slate-700 hover:bg-slate-100">
                      Tables {zone.tableRange[0]}–{zone.tableRange[1]}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {zone.menuIds.map((menuId) => (
                      <Badge
                        key={`${zone.id}-${menuId}`}
                        variant="outline"
                        className="border-slate-200 text-slate-600"
                      >
                        {menuLookup.get(menuId)?.name ?? "Unknown menu"}
                      </Badge>
                    ))}
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setZoneDraft(zone)}
                    >
                      Edit
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="border-rose-200 text-rose-600 hover:bg-rose-50"
                      onClick={() =>
                        setZones((current) => removeById(current, zone.id))
                      }
                    >
                      Delete
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ) : null}

      {activeTab === "settings" ? (
        <MenuSettingsTab
          items={catalogue.map((item) => ({
            id: item.id,
            name: item.name,
            category: item.category,
          }))}
        />
      ) : null}

      {activeTab === "engineering" ? (
        <div className="space-y-6">
          <Card className="border-slate-200 bg-white/90 shadow-sm">
            <CardHeader>
              <CardTitle>Menu engineering</CardTitle>
              <CardDescription>
                Every item plotted by popularity × profit (Kasavana-Smith), from
                the last 30 days of sales. Costs come from linked inventory.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {engLoading ? (
                <p className="text-sm text-slate-500">Analysing your menu…</p>
              ) : !engineering ? (
                <Button type="button" onClick={() => void loadEngineering()}>
                  Analyse menu
                </Button>
              ) : (
                <>
                  <div className="grid gap-3 sm:grid-cols-4">
                    {(["star", "plowhorse", "puzzle", "dog"] as const).map(
                      (q) => (
                        <div
                          key={q}
                          className="rounded-2xl border border-slate-200 p-3 text-center"
                        >
                          <p className="text-2xl font-semibold text-slate-900">
                            {engineering.counts[q] ?? 0}
                          </p>
                          <p className="text-xs uppercase tracking-wide text-slate-500">
                            {QUAD_LABEL[q]}s
                          </p>
                        </div>
                      ),
                    )}
                  </div>
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <p className="text-sm font-medium text-slate-800">
                      {engineering.headline}
                    </p>
                    <p className="mt-2 whitespace-pre-line text-sm text-slate-600">
                      {engineering.advice}
                    </p>
                    {engineering.aiAdvice ? (
                      <Badge
                        variant="outline"
                        className="mt-2 border-purple-200 text-purple-600"
                      >
                        <Bot className="mr-1 h-3 w-3" /> AI advice
                      </Badge>
                    ) : null}
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs uppercase text-slate-500">
                          <th className="py-2 pr-2">Item</th>
                          <th className="pr-2">Class</th>
                          <th className="pr-2 text-right">Price</th>
                          <th className="pr-2 text-right">Margin</th>
                          <th className="pr-2 text-right">Sold</th>
                          <th>Recommendation</th>
                        </tr>
                      </thead>
                      <tbody>
                        {engineering.items.map((it) => (
                          <tr
                            key={it.name}
                            className="border-t border-slate-100 align-top"
                          >
                            <td className="py-2 pr-2 font-medium text-slate-800">
                              {it.name}
                              {!it.hasCost ? (
                                <span className="ml-1 text-xs text-amber-600">
                                  (no cost)
                                </span>
                              ) : null}
                            </td>
                            <td className="pr-2">
                              <Badge className={QUAD_STYLE[it.quadrant]}>
                                {QUAD_LABEL[it.quadrant]}
                              </Badge>
                            </td>
                            <td className="pr-2 text-right tabular-nums">
                              {engineering.currency}{" "}
                              {it.price.toLocaleString()}
                            </td>
                            <td className="pr-2 text-right tabular-nums">
                              {engineering.currency}{" "}
                              {it.margin.toLocaleString()}
                            </td>
                            <td className="pr-2 text-right tabular-nums">
                              {it.unitsSold}
                            </td>
                            <td className="max-w-xs text-slate-600">
                              {it.recommendation}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}

      <Button
        type="button"
        onClick={() => setIsPreviewOpen(true)}
        className="fixed bottom-6 right-6 z-20 rounded-full px-5 shadow-lg"
      >
        Preview customer view
      </Button>

      {isPreviewOpen ? (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-950/70 p-4">
          <div className="relative w-full max-w-2xl rounded-[2.5rem] bg-white p-4 shadow-2xl">
            <button
              type="button"
              onClick={() => setIsPreviewOpen(false)}
              className="absolute right-5 top-5 rounded-full border border-slate-200 bg-white px-3 py-1 text-sm text-slate-600"
            >
              Close
            </button>
            <div className="mb-4 flex flex-wrap items-end justify-between gap-4 px-2 pt-8">
              <div>
                <p className="text-sm font-medium text-purple-600">
                  Customer preview
                </p>
                <h2 className="text-xl font-semibold text-slate-950">
                  Live menu preview
                </h2>
              </div>
              <Field label="Preview table">
                <Input
                  type="number"
                  min="1"
                  value={previewTableNumber}
                  onChange={(event) =>
                    setPreviewTableNumber(Number(event.target.value) || 1)
                  }
                  className="w-32"
                />
              </Field>
            </div>
            <div className="mx-auto max-w-[390px] rounded-[2.5rem] border-[10px] border-slate-950 bg-slate-50 shadow-inner">
              <div className="h-[78vh] overflow-y-auto rounded-[2rem] p-4">
                <CustomerMenuList
                  readOnly
                  items={previewItems}
                  categoryOrder={categoryOrder}
                  headerSlot={
                    <div className="space-y-3 rounded-3xl bg-white p-4 shadow-sm">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-purple-600">
                          Previewing /table
                        </p>
                        <h3 className="text-lg font-semibold text-slate-950">
                          Table {previewTableNumber}
                        </h3>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {previewZone ? (
                          <Badge className="bg-sky-100 text-sky-700 hover:bg-sky-100">
                            {previewZone.name}
                          </Badge>
                        ) : null}
                        {serverMenus.filter((menu) => menu.isActive).length ? (
                          serverMenus
                            .filter((menu) => menu.isActive)
                            .map((menu) => (
                              <Badge
                                key={menu.id}
                                className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100"
                              >
                                {menu.name}
                              </Badge>
                            ))
                        ) : (
                          <Badge
                            variant="outline"
                            className="border-slate-200 text-slate-600"
                          >
                            Whole catalogue
                          </Badge>
                        )}
                      </div>
                    </div>
                  }
                />
              </div>
            </div>
          </div>
        </div>
      ) : null}
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
