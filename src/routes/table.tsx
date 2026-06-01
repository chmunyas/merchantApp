import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { CustomerMenuList } from "@/components/merchant/features/customer-menu-list";
import type { CatalogueItem } from "@/components/merchant/features/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ensureMerchantDemoData,
  getActiveMenuSchedules,
  getCurrentActiveMenuIds,
  getMenuCategoriesByIds,
  getOrderedMerchantCategories,
  getZoneForTable,
} from "@/lib/merchant-dashboard";

export const Route = createFileRoute("/table")({
  component: TablePage,
});

type CartSelection = {
  key: string;
  itemId: string;
  itemName: string;
  basePrice: number;
  optionLabels: string[];
  optionPrice: number;
};

function createSelectionKey() {
  return `selection-${Math.random().toString(36).slice(2, 10)}`;
}

function parseTableNumber() {
  if (typeof window === "undefined") return 12;

  const params = new URLSearchParams(window.location.search);
  const plainTable = Number(params.get("table") ?? params.get("tableNumber"));
  if (Number.isFinite(plainTable) && plainTable > 0) return plainTable;

  const encoded = params.get("t");
  if (!encoded) return 12;

  try {
    const decoded = JSON.parse(atob(encoded)) as Record<string, unknown>;
    const parsed = Number(
      decoded.tableNumber ??
        decoded.table ??
        decoded.number ??
        decoded.table_id,
    );
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 12;
  } catch {
    return 12;
  }
}

function sortItems(items: CatalogueItem[], categoryOrder: string[]) {
  const orderIndex = new Map(
    categoryOrder.map((category, index) => [category, index]),
  );
  return [...items].sort((a, b) => {
    const delta =
      (orderIndex.get(a.category) ?? 999) - (orderIndex.get(b.category) ?? 999);
    if (delta !== 0) return delta;
    return a.name.localeCompare(b.name);
  });
}

function TablePage() {
  const tableNumber = parseTableNumber();
  const [catalogue, setCatalogue] = useState<CatalogueItem[]>([]);
  const [menus, setMenus] = useState<
    ReturnType<typeof ensureMerchantDemoData>["menus"]
  >([]);
  const [zones, setZones] = useState<
    ReturnType<typeof ensureMerchantDemoData>["zones"]
  >([]);
  const [categoryOrder, setCategoryOrder] = useState<string[]>([]);
  const [menuSchedules, setMenuSchedules] = useState<
    ReturnType<typeof ensureMerchantDemoData>["menuSchedules"]
  >([]);
  const [cartSelections, setCartSelections] = useState<CartSelection[]>([]);
  const [modifierItem, setModifierItem] = useState<CatalogueItem | null>(null);
  const [selectedOptions, setSelectedOptions] = useState<
    Record<string, string>
  >({});

  useEffect(() => {
    const snapshot = ensureMerchantDemoData();
    setCatalogue(snapshot.catalogue);
    setMenus(snapshot.menus);
    setZones(snapshot.zones);
    setCategoryOrder(snapshot.categoryOrder);
    setMenuSchedules(snapshot.menuSchedules);
  }, []);

  const activeSchedules = useMemo(
    () => getActiveMenuSchedules(menuSchedules),
    [menuSchedules],
  );

  const activeMenuIds = useMemo(
    () => getCurrentActiveMenuIds(menus, menuSchedules),
    [menuSchedules, menus],
  );

  const currentZone = useMemo(
    () => getZoneForTable(zones, tableNumber),
    [tableNumber, zones],
  );

  const visibleMenuIds = useMemo(() => {
    const zoneMenuIds = currentZone?.menuIds ?? [];
    if (zoneMenuIds.length) {
      const intersected = activeMenuIds.length
        ? zoneMenuIds.filter((menuId) => activeMenuIds.includes(menuId))
        : zoneMenuIds;
      return intersected.length ? intersected : zoneMenuIds;
    }
    return activeMenuIds;
  }, [activeMenuIds, currentZone]);

  const visibleCategories = useMemo(() => {
    if (!visibleMenuIds.length) {
      return getOrderedMerchantCategories(
        catalogue.map((item) => item.category),
        categoryOrder,
      );
    }

    return getOrderedMerchantCategories(
      getMenuCategoriesByIds(menus, visibleMenuIds),
      categoryOrder,
    );
  }, [catalogue, categoryOrder, menus, visibleMenuIds]);

  const visibleCategorySet = useMemo(
    () => new Set(visibleCategories),
    [visibleCategories],
  );

  const visibleItems = useMemo(() => {
    const filtered = catalogue.filter((item) =>
      visibleCategorySet.has(item.category),
    );
    return sortItems(filtered, categoryOrder);
  }, [catalogue, categoryOrder, visibleCategorySet]);

  const visibleItemLookup = useMemo(
    () => new Map(visibleItems.map((item) => [item.id, item])),
    [visibleItems],
  );

  const quantityByItem = useMemo(() => {
    return cartSelections.reduce<Record<string, number>>((acc, selection) => {
      acc[selection.itemId] = (acc[selection.itemId] ?? 0) + 1;
      return acc;
    }, {});
  }, [cartSelections]);

  const visibleMenuNames = useMemo(() => {
    const menuIdSet = new Set(visibleMenuIds);
    return menus
      .filter((menu) => menuIdSet.has(menu.id))
      .map((menu) => menu.name);
  }, [menus, visibleMenuIds]);

  const total = useMemo(
    () =>
      cartSelections.reduce(
        (sum, selection) => sum + selection.basePrice + selection.optionPrice,
        0,
      ),
    [cartSelections],
  );

  function addSelection(item: CatalogueItem, optionIds: string[] = []) {
    const optionSelections = (item.modifiers ?? [])
      .map((modifier) =>
        modifier.options.find(
          (option) =>
            option.id ===
            optionIds
              .find((entry) => entry.startsWith(`${modifier.id}:`))
              ?.split(":")[1],
        ),
      )
      .filter((option): option is NonNullable<typeof option> =>
        Boolean(option),
      );

    setCartSelections((current) => [
      ...current,
      {
        key: createSelectionKey(),
        itemId: item.id,
        itemName: item.name,
        basePrice: item.price,
        optionLabels: optionSelections.map((option) => option.label),
        optionPrice: optionSelections.reduce(
          (sum, option) => sum + option.priceAdjustment,
          0,
        ),
      },
    ]);
  }

  function handleAddItem(item: CatalogueItem) {
    if (item.available === false) return;
    if (item.modifiers?.length) {
      setModifierItem(item);
      setSelectedOptions(
        Object.fromEntries(
          item.modifiers.map((modifier) => [
            modifier.id,
            modifier.options[0]?.id ?? "",
          ]),
        ),
      );
      return;
    }

    addSelection(item);
  }

  function handleRemoveItem(item: CatalogueItem) {
    setCartSelections((current) => {
      const index = current
        .map((selection) => selection.itemId)
        .lastIndexOf(item.id);
      if (index === -1) return current;
      return current.filter((_, selectionIndex) => selectionIndex !== index);
    });
  }

  function handleConfirmModifiers() {
    if (!modifierItem) return;
    const optionIds = Object.entries(selectedOptions).map(
      ([modifierId, optionId]) => `${modifierId}:${optionId}`,
    );
    addSelection(modifierItem, optionIds);
    setModifierItem(null);
    setSelectedOptions({});
  }

  function getSuggestions(item: CatalogueItem) {
    return (item.linkedProductIds ?? [])
      .map((linkedId) => visibleItemLookup.get(linkedId))
      .filter((linkedItem): linkedItem is CatalogueItem => Boolean(linkedItem))
      .slice(0, 3);
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 md:px-6 lg:px-8">
      <div className="rounded-3xl bg-gradient-to-br from-slate-950 via-slate-900 to-purple-950 p-6 text-white shadow-xl">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <p className="text-sm font-medium text-purple-200">
              PesaSwap table ordering
            </p>
            <h1 className="text-3xl font-semibold">Table {tableNumber}</h1>
            <p className="max-w-2xl text-sm text-slate-300">
              Browse the current menu, add favourites, and explore suggested
              pairings matched to your seating zone.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {currentZone ? (
              <Badge className="bg-white/15 text-white hover:bg-white/15">
                Zone: {currentZone.name}
              </Badge>
            ) : null}
            {activeSchedules.length ? (
              activeSchedules.map((schedule) => (
                <Badge
                  key={schedule.id}
                  className="bg-emerald-400/20 text-emerald-100 hover:bg-emerald-400/20"
                >
                  {schedule.name}
                </Badge>
              ))
            ) : visibleMenuNames.length ? (
              visibleMenuNames.map((menuName) => (
                <Badge
                  key={menuName}
                  className="bg-white/15 text-white hover:bg-white/15"
                >
                  {menuName}
                </Badge>
              ))
            ) : (
              <Badge className="bg-white/15 text-white hover:bg-white/15">
                Full catalogue
              </Badge>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        <CustomerMenuList
          items={visibleItems}
          categoryOrder={categoryOrder}
          itemQuantities={quantityByItem}
          onAddItem={handleAddItem}
          onRemoveItem={handleRemoveItem}
          getSuggestions={getSuggestions}
          onAddSuggestedItem={handleAddItem}
          headerSlot={
            <div className="space-y-3 rounded-3xl border border-slate-200 bg-white/90 p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-purple-600">
                    Now serving
                  </p>
                  <h2 className="text-xl font-semibold text-slate-950">
                    {visibleMenuNames.length
                      ? visibleMenuNames.join(" • ")
                      : "All available items"}
                  </h2>
                </div>
                <Badge
                  variant="outline"
                  className="border-slate-200 text-slate-600"
                >
                  {visibleItems.length} item
                  {visibleItems.length === 1 ? "" : "s"}
                </Badge>
              </div>
              {currentZone ? (
                <p className="text-sm text-slate-500">
                  Showing menus assigned to the {currentZone.name.toLowerCase()}{" "}
                  zone for tables {currentZone.tableRange[0]}–
                  {currentZone.tableRange[1]}.
                </p>
              ) : (
                <p className="text-sm text-slate-500">
                  No zone matched this table, so the active default menu
                  selection is shown.
                </p>
              )}
            </div>
          }
        />

        <div className="lg:sticky lg:top-6 lg:self-start">
          <Card className="border-slate-200 bg-white/95 shadow-sm">
            <CardHeader>
              <CardTitle>Your cart</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {cartSelections.length ? (
                <div className="space-y-3">
                  {cartSelections.map((selection) => (
                    <div
                      key={selection.key}
                      className="rounded-2xl border border-slate-200 bg-slate-50 p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium text-slate-900">
                            {selection.itemName}
                          </p>
                          {selection.optionLabels.length ? (
                            <p className="text-xs text-slate-500">
                              {selection.optionLabels.join(", ")}
                            </p>
                          ) : null}
                        </div>
                        <p className="text-sm font-semibold text-slate-900">
                          KES{" "}
                          {(
                            selection.basePrice + selection.optionPrice
                          ).toFixed(0)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
                  Add a dish to start your order.
                </div>
              )}

              <div className="rounded-3xl bg-slate-950 px-4 py-5 text-white">
                <div className="flex items-center justify-between text-sm text-slate-300">
                  <span>Items</span>
                  <span>{cartSelections.length}</span>
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-sm text-slate-300">Total</span>
                  <span className="text-2xl font-semibold">
                    KES {total.toFixed(0)}
                  </span>
                </div>
                <Button
                  type="button"
                  className="mt-4 w-full bg-white text-slate-950 hover:bg-slate-100"
                  disabled={!cartSelections.length}
                >
                  Continue to checkout
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {modifierItem ? (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-950/70 p-4">
          <div className="w-full max-w-lg rounded-[2rem] bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-purple-600">
                  Customise order
                </p>
                <h2 className="text-2xl font-semibold text-slate-950">
                  {modifierItem.name}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setModifierItem(null)}
                className="rounded-full border border-slate-200 px-3 py-1 text-sm text-slate-600"
              >
                Close
              </button>
            </div>
            <div className="mt-6 space-y-4">
              {modifierItem.modifiers?.map((modifier) => (
                <div
                  key={modifier.id}
                  className="space-y-3 rounded-3xl border border-slate-200 bg-slate-50 p-4"
                >
                  <div>
                    <p className="font-medium text-slate-900">
                      {modifier.name}
                    </p>
                    <p className="text-sm text-slate-500">Choose one option</p>
                  </div>
                  <div className="space-y-2">
                    {modifier.options.map((option) => (
                      <label
                        key={option.id}
                        className={
                          selectedOptions[modifier.id] === option.id
                            ? "flex items-center justify-between rounded-2xl border border-purple-300 bg-purple-50 px-3 py-3"
                            : "flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-3 py-3"
                        }
                      >
                        <div>
                          <p className="font-medium text-slate-900">
                            {option.label}
                          </p>
                          <p className="text-xs text-slate-500">
                            {option.priceAdjustment > 0
                              ? `+KES ${option.priceAdjustment.toFixed(0)}`
                              : "Included"}
                          </p>
                        </div>
                        <input
                          type="radio"
                          name={modifier.id}
                          checked={selectedOptions[modifier.id] === option.id}
                          onChange={() =>
                            setSelectedOptions((current) => ({
                              ...current,
                              [modifier.id]: option.id,
                            }))
                          }
                          className="h-4 w-4 border-slate-300 text-purple-600"
                        />
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => setModifierItem(null)}
              >
                Cancel
              </Button>
              <Button type="button" onClick={handleConfirmModifiers}>
                Add to cart
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
