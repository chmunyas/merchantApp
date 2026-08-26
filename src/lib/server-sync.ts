import { getToken } from "@/lib/auth";
import {
  loadMerchantSnapshot,
  saveMerchantCatalogue,
  saveMerchantTables,
  type MerchantTable,
} from "@/lib/merchant-dashboard";
import { getCurrentVenueId, isDemoVenue } from "@/lib/tenant-store";
import type { CatalogueItem } from "@/components/merchant/features/types";

// Server → localStorage hydration for the entities that are now server-
// authoritative (menu items + dining tables). The dedicated editors
// (/dashboard/menu, /dashboard/tables) already WRITE via the API; this bridge
// mirrors that Postgres truth back into the shared localStorage snapshot so the
// many read-only consumers (overview, floor plan, bookings, customer table view)
// all reflect ONE source of truth instead of a stale local blob.
//
// Gated to REAL, authed merchants: the demo venue keeps its rich showcase
// catalogue/floor-plan (the server only holds a flat 12-item demo menu and no
// demo tables, so hydrating it would degrade the demo).

const HYDRATED_EVENT = "pesaswap:data-hydrated";

export type ApiMenuItem = {
  id: string;
  name: string;
  category: string;
  price: number | string;
  currency?: string;
  description?: string | null;
  dietary?: string[];
  available?: boolean;
  revision?: number;
};

export type ApiDiningTable = {
  id: string;
  label: string;
  seats: number;
  section?: string | null;
  active?: boolean;
  created_at?: string;
  revision?: number;
};

function shouldHydrate(): boolean {
  return Boolean(getToken()) && !isDemoVenue(getCurrentVenueId());
}

// Map a server menu row → the richer client CatalogueItem, PRESERVING client-only
// decorations (image, modifiers and links) from the existing snapshot
// entry when present.
export function mapApiMenuItem(
  item: ApiMenuItem,
  existing?: CatalogueItem,
): CatalogueItem {
  const isDrink = item.category === "Drinks" || item.category === "Cocktails";
  return {
    id: item.id,
    name: item.name,
    price: Number(item.price) || 0,
    category: item.category,
    dietary: item.dietary ?? [],
    destination: existing?.destination ?? (isDrink ? "bar" : "kitchen"),
    image: existing?.image ?? "",
    available: item.available ?? true,
    description: existing?.description || item.description || "",
    modifiers: existing?.modifiers ?? [],
    linkedProductIds: existing?.linkedProductIds ?? [],
    revision: item.revision ?? existing?.revision,
  };
}

// Map a server dining_tables row → the client MerchantTable, PRESERVING the
// client-only live table-session fields (open orders, status, payments) from the
// existing snapshot entry so hydration never wipes an in-progress table.
export function mapApiTable(
  table: ApiDiningTable,
  index: number,
  existing?: MerchantTable,
): MerchantTable {
  const label = table.label.trim();
  const numberMatch = label.match(/(?:table\s*)?(\d+)/i);
  const tableNumber = numberMatch ? Number(numberMatch[1]) : index + 1;
  const numericLabel = /^\d+$/.test(label) || /^table\s*\d+$/i.test(label);
  return {
    id: table.id,
    tableNumber,
    capacity: table.seats,
    name: numericLabel ? "" : label,
    bookable: table.active !== false,
    server: table.section ?? "",
    items: existing?.items ?? [],
    status: existing?.status ?? "open",
    openedAt: existing?.openedAt ?? table.created_at ?? new Date().toISOString(),
    closedAt: existing?.closedAt,
    paidAmount: existing?.paidAmount ?? 0,
    payments: existing?.payments ?? [],
    revision: table.revision,
  };
}

function indexById<T extends { id: string }>(rows: T[]): Map<string, T> {
  return new Map(rows.map((row) => [row.id, row]));
}

// Fetch the server menu and mirror it into the localStorage catalogue.
export async function hydrateMenuFromServer(): Promise<CatalogueItem[] | null> {
  if (!shouldHydrate()) return null;
  try {
    const res = await fetch("/api/menu", {
      headers: { authorization: `Bearer ${getToken()}` },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { items?: ApiMenuItem[] };
    if (!data.items) return null;
    const existing = indexById(loadMerchantSnapshot().catalogue);
    const catalogue = data.items.map((item) =>
      mapApiMenuItem(item, existing.get(item.id)),
    );
    saveMerchantCatalogue(catalogue);
    dispatchHydrated();
    return catalogue;
  } catch {
    return null;
  }
}

// Fetch the server dining tables and mirror them into the localStorage tables.
export async function hydrateTablesFromServer(): Promise<MerchantTable[] | null> {
  if (!shouldHydrate()) return null;
  try {
    const res = await fetch("/api/tables", {
      headers: { authorization: `Bearer ${getToken()}` },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { tables?: ApiDiningTable[] };
    if (!data.tables) return null;
    const existing = indexById(loadMerchantSnapshot().tables);
    const tables = data.tables.map((table, i) =>
      mapApiTable(table, i, existing.get(table.id)),
    );
    saveMerchantTables(tables);
    dispatchHydrated();
    return tables;
  } catch {
    return null;
  }
}

// Hydrate both entities (used by the dashboard shell on entry).
export async function hydrateServerEntities(): Promise<void> {
  if (!shouldHydrate()) return;
  await Promise.all([hydrateMenuFromServer(), hydrateTablesFromServer()]);
}

function dispatchHydrated(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(HYDRATED_EVENT));
  }
}

export const DATA_HYDRATED_EVENT = HYDRATED_EVENT;
