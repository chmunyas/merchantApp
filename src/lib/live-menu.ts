// The single guest-facing projection of a venue's menu (C6.1, C6.5, C6.7-C6.13
// / A6.2, A6.4, A6.6).
//
// This exists because the resolution was previously written twice — once in
// `GET /api/menu/live` and once in `GET /api/qr/:code` — with two different
// shapes for the same data (`categories[].items` vs `categories[].itemIds`) and
// two different price units. A guest page that reads both would have shown a
// different menu depending on which endpoint answered. There is now one
// resolver and one shape.
//
// Prices: `price` is whole currency units (the database's unit) and
// `priceMinor` is minor units (the unit the QR/pay/ledger chain works in). Both
// are always present and always agree, so a caller never has to guess or
// multiply.

import type { getSql } from "@/lib/db";
import { getMenu, guestName, type MenuItem } from "@/lib/menu";
import {
  getMenuSettings,
  listCheckoutUpsellIds,
  listMenus,
  readTranslations,
} from "@/lib/dynamic-menu";
import { mediaAltText } from "@/lib/menu-media";
import {
  applyTranslations,
  planTranslation,
} from "@/lib/menu-translation";
import { selectCheckoutUpsells, type UpsellItem } from "@/lib/menu-upsell";
import {
  resolveMenuMode,
  visibleMenus,
  type ExternalMenu,
  type MenuSurface,
} from "@/lib/menu-visibility";

type Sql = NonNullable<ReturnType<typeof getSql>>;

export const DEFAULT_CHECKOUT_UPSELL_TITLE = "Before you go…";

export type LiveMenuItem = {
  id: string;
  /** What the guest reads: the merchant's override, or the operational name. */
  name: string;
  /** The name the kitchen and the agent use. Never shown to a guest. */
  operationalName: string;
  category: string;
  price: number;
  priceMinor: number;
  currency: string;
  description: string | null;
  dietary: string[];
  allergens: string[];
  tags: string[];
  available: boolean;
  imageUrl: string | null;
  imageAlt: string | null;
  videoUrl: string | null;
  videoDescription: string | null;
};

export type LiveMenuSection = { name: string; items: LiveMenuItem[] };

export type LiveMenu = {
  id: string;
  name: string;
  description: string | null;
  headerImageUrl: string | null;
  headerImageAlt: string | null;
  displayOrder: number;
  categories: LiveMenuSection[];
};

export type LiveMenuPayload = {
  mode: "dynamic" | "external" | "none";
  external: ExternalMenu | null;
  languages: string[];
  defaultLanguage: string;
  lang: string | null;
  translated: boolean;
  timezone: string;
  menus: LiveMenu[];
  items: LiveMenuItem[];
  checkoutUpsell: { title: string; items: LiveMenuItem[] } | null;
};

/**
 * The guest-facing projection of a menu item: the merchant's override name,
 * media with authored alt text, and allergens/tags as WORDS. Nothing here is
 * conveyed by colour or icon alone — the client renders these strings.
 */
export function presentItem(item: MenuItem): LiveMenuItem {
  const name = guestName(item);
  return {
    id: item.id,
    name,
    operationalName: item.name,
    category: item.category,
    price: item.price,
    priceMinor: Math.round(item.price * 100),
    currency: item.currency,
    description: item.description,
    dietary: item.dietary,
    allergens: item.allergens,
    tags: item.tags,
    available: item.available,
    imageUrl: item.imageUrl,
    imageAlt: item.imageUrl ? mediaAltText(item.imageAlt, name) : null,
    videoUrl: item.videoUrl,
    videoDescription: item.videoUrl
      ? mediaAltText(item.videoDescription, `Video of ${name}`)
      : null,
  };
}

export function toUpsellItems(items: MenuItem[]): UpsellItem[] {
  return items.map((item) => ({
    id: item.id,
    name: guestName(item),
    category: item.category,
    price: item.price,
    available: item.available,
    description: item.description,
    imageUrl: item.imageUrl,
    imageAlt: item.imageAlt,
  }));
}

/**
 * Translate a menu for `lang` using ONLY the cache. A guest page view must never
 * cost a model call, and a cache miss must never blank the menu — untranslated
 * items keep their original text.
 */
async function translateFromCache(
  sql: Sql,
  venue: string,
  lang: string | null,
  items: MenuItem[],
): Promise<{ items: MenuItem[]; translated: boolean }> {
  if (!lang) return { items, translated: false };
  const cached = await readTranslations(sql, venue, lang, "item");
  const translatable = items.map((item) => ({
    id: item.id,
    name: guestName(item),
    description: item.description,
  }));
  const plan = planTranslation(translatable, cached);
  if (plan.fresh.size === 0) return { items, translated: false };
  const merged = applyTranslations(translatable, plan.fresh);
  const byId = new Map(merged.map((entry) => [entry.id, entry]));
  return {
    items: items.map((item) => {
      const hit = byId.get(item.id);
      if (!hit) return item;
      return { ...item, displayName: hit.name, description: hit.description ?? null };
    }),
    translated: true,
  };
}

function groupByCategory(items: LiveMenuItem[]): Map<string, LiveMenuItem[]> {
  const byCategory = new Map<string, LiveMenuItem[]>();
  for (const item of items) {
    const list = byCategory.get(item.category) ?? [];
    list.push(item);
    byCategory.set(item.category, list);
  }
  return byCategory;
}

export type LiveMenuOptions = {
  surface?: MenuSurface;
  /** A language tag the caller has already normalized, or null for the original. */
  lang?: string | null;
  /** Pass the venue timezone when the caller already has it, to save a query. */
  timezone?: string;
  now?: Date;
};

/**
 * Resolve what a guest should be shown right now: the dynamic-vs-external
 * toggle, the venue-local visibility schedule, the cached translation, and the
 * checkout upsell block — in one read.
 */
export async function buildLiveMenu(
  sql: Sql,
  venue: string,
  options: LiveMenuOptions = {},
): Promise<LiveMenuPayload> {
  const surface: MenuSurface = options.surface ?? "qr";
  const now = options.now ?? new Date();
  const settings = await getMenuSettings(sql, venue);
  const timezone = options.timezone ?? (await venueTimeZone(sql, venue));
  const mode = resolveMenuMode({
    dynamicMenuEnabled: settings.dynamicMenuEnabled,
    externalMenu: settings.externalMenu,
  });

  // A language the merchant has not enabled is not a translation the guest can
  // have: fall through to the original rather than erroring the whole menu.
  const lang =
    options.lang && settings.languages.includes(options.lang) ? options.lang : null;

  if (mode.mode === "external") {
    return {
      mode: "external",
      external: mode.external,
      languages: settings.languages,
      defaultLanguage: settings.defaultLanguage,
      lang: null,
      translated: false,
      timezone,
      menus: [],
      items: [],
      checkoutUpsell: null,
    };
  }

  const raw = await getMenu(sql, venue);
  const { items: localized, translated } = await translateFromCache(
    sql,
    venue,
    lang,
    raw,
  );
  const items = localized.map(presentItem);
  const byCategory = groupByCategory(items);

  // C6.1: with the dynamic menu off and no external menu we keep serving the
  // flat list, so switching the toggle is genuinely reversible and no venue
  // loses its menu by not opting in.
  const menus: LiveMenu[] =
    mode.mode === "dynamic"
      ? visibleMenus(await listMenus(sql, venue), now, timezone, surface).map(
          (menu) => ({
            id: menu.id,
            name: menu.name,
            description: menu.description,
            headerImageUrl: menu.headerImageUrl,
            headerImageAlt: menu.headerImageUrl
              ? mediaAltText(menu.headerImageAlt, menu.name)
              : null,
            displayOrder: menu.displayOrder,
            categories: (menu.categories.length > 0
              ? menu.categories
              : Array.from(byCategory.keys())
            ).map((category) => ({
              name: category,
              items: byCategory.get(category) ?? [],
            })),
          }),
        )
      : [];

  const checkoutIds = await listCheckoutUpsellIds(sql, venue);
  const byId = new Map(items.map((item) => [item.id, item]));
  const checkoutItems = selectCheckoutUpsells(checkoutIds, toUpsellItems(localized), [])
    .map((entry) => byId.get(entry.item.id))
    .filter((item): item is LiveMenuItem => Boolean(item));

  return {
    mode: mode.mode,
    external: null,
    languages: settings.languages,
    defaultLanguage: settings.defaultLanguage,
    lang,
    translated,
    timezone,
    menus,
    items,
    checkoutUpsell:
      checkoutItems.length > 0
        ? {
            title: settings.checkoutUpsellTitle ?? DEFAULT_CHECKOUT_UPSELL_TITLE,
            items: checkoutItems,
          }
        : null,
  };
}

export async function venueTimeZone(sql: Sql, venue: string): Promise<string> {
  const [row] = await sql`SELECT timezone FROM venues WHERE id = ${venue} LIMIT 1`;
  return String(row?.timezone ?? "Africa/Nairobi");
}
