// Server-side reads/writes for the dynamic menu (C6.1, C6.5, C6.7-C6.13).
//
// Every statement filters on venue_id. The decisions (what is visible, what to
// upsell, what to translate) live in the pure modules — menu-visibility.ts,
// menu-upsell.ts, menu-translation.ts — so they can be unit-tested; this file
// only fetches and persists.

import type { getSql } from "@/lib/db";
import type { UpsellLink } from "@/lib/menu-upsell";
import type { SchedulableMenu, VisibilityWindow } from "@/lib/menu-visibility";
import type { CachedTranslation } from "@/lib/menu-translation";

type Sql = NonNullable<ReturnType<typeof getSql>>;

export type MenuSettings = {
  dynamicMenuEnabled: boolean;
  defaultLanguage: string;
  languages: string[];
  externalMenu: { name: string; kind: "pdf" | "link"; url: string } | null;
  checkoutUpsellTitle: string | null;
};

export const DEFAULT_MENU_SETTINGS: MenuSettings = {
  dynamicMenuEnabled: false,
  defaultLanguage: "en",
  languages: [],
  externalMenu: null,
  checkoutUpsellTitle: null,
};

export type DynamicMenu = SchedulableMenu & {
  description: string | null;
  headerImageUrl: string | null;
  headerImageAlt: string | null;
  source: "local" | "pos";
  categories: string[];
  revision: number;
};

export async function getMenuSettings(
  sql: Sql,
  venue: string,
): Promise<MenuSettings> {
  const [row] = await sql`
    SELECT dynamic_menu_enabled, default_language, languages,
           external_menu_name, external_menu_kind, external_menu_url,
           checkout_upsell_title
    FROM venue_menu_settings
    WHERE venue_id = ${venue}`;
  if (!row) return DEFAULT_MENU_SETTINGS;
  const kind = row.external_menu_kind as "pdf" | "link" | null;
  const url = (row.external_menu_url as string | null) ?? null;
  return {
    dynamicMenuEnabled: Boolean(row.dynamic_menu_enabled),
    defaultLanguage: String(row.default_language ?? "en"),
    languages: (row.languages as string[]) ?? [],
    externalMenu:
      kind && url
        ? { name: String(row.external_menu_name ?? "Menu"), kind, url }
        : null,
    checkoutUpsellTitle: (row.checkout_upsell_title as string | null) ?? null,
  };
}

export async function saveMenuSettings(
  sql: Sql,
  venue: string,
  settings: MenuSettings,
): Promise<void> {
  await sql`
    INSERT INTO venue_menu_settings
      (venue_id, dynamic_menu_enabled, default_language, languages,
       external_menu_name, external_menu_kind, external_menu_url,
       checkout_upsell_title, updated_at)
    VALUES (${venue}, ${settings.dynamicMenuEnabled}, ${settings.defaultLanguage},
            ${settings.languages}, ${settings.externalMenu?.name ?? null},
            ${settings.externalMenu?.kind ?? null}, ${settings.externalMenu?.url ?? null},
            ${settings.checkoutUpsellTitle}, now())
    ON CONFLICT (venue_id) DO UPDATE SET
      dynamic_menu_enabled  = EXCLUDED.dynamic_menu_enabled,
      default_language      = EXCLUDED.default_language,
      languages             = EXCLUDED.languages,
      external_menu_name    = EXCLUDED.external_menu_name,
      external_menu_kind    = EXCLUDED.external_menu_kind,
      external_menu_url     = EXCLUDED.external_menu_url,
      checkout_upsell_title = EXCLUDED.checkout_upsell_title,
      updated_at            = now()`;
}

export async function listMenus(sql: Sql, venue: string): Promise<DynamicMenu[]> {
  const rows = await sql`
    SELECT id, name, description, header_image_url, header_image_alt,
           is_active, visible_on_pay_at_table, display_order, source, revision
    FROM menus
    WHERE venue_id = ${venue}
    ORDER BY display_order, created_at`;
  if (rows.length === 0) return [];
  const ids = rows.map((row) => String(row.id));
  const [windows, categories] = await Promise.all([
    sql`SELECT menu_id, day_of_week, start_minutes, end_minutes
        FROM menu_visibility_windows
        WHERE venue_id = ${venue} AND menu_id = ANY(${ids}::uuid[])
        ORDER BY day_of_week, start_minutes`,
    sql`SELECT menu_id, name
        FROM menu_categories
        WHERE venue_id = ${venue} AND menu_id = ANY(${ids}::uuid[])
        ORDER BY display_order, name`,
  ]);
  const windowsByMenu = new Map<string, VisibilityWindow[]>();
  for (const row of windows) {
    const list = windowsByMenu.get(String(row.menu_id)) ?? [];
    list.push({
      day: Number(row.day_of_week),
      startMinutes: Number(row.start_minutes),
      endMinutes: Number(row.end_minutes),
    });
    windowsByMenu.set(String(row.menu_id), list);
  }
  const categoriesByMenu = new Map<string, string[]>();
  for (const row of categories) {
    const list = categoriesByMenu.get(String(row.menu_id)) ?? [];
    list.push(String(row.name));
    categoriesByMenu.set(String(row.menu_id), list);
  }
  return rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    description: (row.description as string | null) ?? null,
    headerImageUrl: (row.header_image_url as string | null) ?? null,
    headerImageAlt: (row.header_image_alt as string | null) ?? null,
    isActive: Boolean(row.is_active),
    visibleOnPayAtTable: Boolean(row.visible_on_pay_at_table),
    displayOrder: Number(row.display_order),
    source: (row.source as "local" | "pos") ?? "local",
    categories: categoriesByMenu.get(String(row.id)) ?? [],
    windows: windowsByMenu.get(String(row.id)) ?? [],
    revision: Number(row.revision),
  }));
}

export async function replaceMenuWindows(
  sql: Sql,
  venue: string,
  menuId: string,
  windows: readonly VisibilityWindow[],
): Promise<void> {
  await sql`
    DELETE FROM menu_visibility_windows
    WHERE venue_id = ${venue} AND menu_id = ${menuId}`;
  for (const window of windows) {
    await sql`
      INSERT INTO menu_visibility_windows
        (venue_id, menu_id, day_of_week, start_minutes, end_minutes)
      VALUES (${venue}, ${menuId}, ${window.day}, ${window.startMinutes},
              ${window.endMinutes})`;
  }
}

export async function replaceMenuCategories(
  sql: Sql,
  venue: string,
  menuId: string,
  categories: readonly string[],
): Promise<void> {
  await sql`
    DELETE FROM menu_categories
    WHERE venue_id = ${venue} AND menu_id = ${menuId}`;
  let order = 0;
  for (const name of categories) {
    await sql`
      INSERT INTO menu_categories (venue_id, menu_id, name, display_order)
      VALUES (${venue}, ${menuId}, ${name}, ${order})
      ON CONFLICT DO NOTHING`;
    order += 1;
  }
}

export async function listUpsellLinks(
  sql: Sql,
  venue: string,
): Promise<UpsellLink[]> {
  const rows = await sql`
    SELECT item_id, suggested_item_id, display_order
    FROM menu_item_upsells
    WHERE venue_id = ${venue}
    ORDER BY item_id, display_order`;
  return rows.map((row) => ({
    itemId: String(row.item_id),
    suggestedItemId: String(row.suggested_item_id),
    displayOrder: Number(row.display_order),
  }));
}

export async function replaceItemUpsells(
  sql: Sql,
  venue: string,
  itemId: string,
  suggestedIds: readonly string[],
): Promise<void> {
  await sql`
    DELETE FROM menu_item_upsells
    WHERE venue_id = ${venue} AND item_id = ${itemId}`;
  let order = 0;
  for (const suggestedId of suggestedIds) {
    if (suggestedId === itemId) continue;
    await sql`
      INSERT INTO menu_item_upsells
        (venue_id, item_id, suggested_item_id, display_order)
      SELECT ${venue}, ${itemId}, ${suggestedId}, ${order}
      WHERE EXISTS (
        SELECT 1 FROM menu_items
        WHERE id = ${suggestedId} AND venue_id = ${venue})
      ON CONFLICT DO NOTHING`;
    order += 1;
  }
}

export async function listCheckoutUpsellIds(
  sql: Sql,
  venue: string,
): Promise<string[]> {
  const rows = await sql`
    SELECT item_id FROM menu_checkout_upsells
    WHERE venue_id = ${venue}
    ORDER BY display_order`;
  return rows.map((row) => String(row.item_id));
}

export async function replaceCheckoutUpsells(
  sql: Sql,
  venue: string,
  itemIds: readonly string[],
): Promise<void> {
  await sql`DELETE FROM menu_checkout_upsells WHERE venue_id = ${venue}`;
  let order = 0;
  for (const itemId of itemIds) {
    await sql`
      INSERT INTO menu_checkout_upsells (venue_id, item_id, display_order)
      SELECT ${venue}, ${itemId}, ${order}
      WHERE EXISTS (
        SELECT 1 FROM menu_items WHERE id = ${itemId} AND venue_id = ${venue})
      ON CONFLICT DO NOTHING`;
    order += 1;
  }
}

export async function readTranslations(
  sql: Sql,
  venue: string,
  lang: string,
  entityType: "item" | "menu" | "category",
): Promise<CachedTranslation[]> {
  const rows = await sql`
    SELECT entity_id, source_hash, name, description
    FROM menu_translations
    WHERE venue_id = ${venue} AND lang = ${lang} AND entity_type = ${entityType}`;
  return rows.map((row) => ({
    entityId: String(row.entity_id),
    sourceHash: String(row.source_hash),
    name: (row.name as string | null) ?? null,
    description: (row.description as string | null) ?? null,
  }));
}

export async function writeTranslations(
  sql: Sql,
  venue: string,
  lang: string,
  entityType: "item" | "menu" | "category",
  rows: readonly {
    entityId: string;
    sourceHash: string;
    name: string;
    description: string | null;
  }[],
): Promise<void> {
  for (const row of rows) {
    await sql`
      INSERT INTO menu_translations
        (venue_id, lang, entity_type, entity_id, source_hash, name, description, updated_at)
      VALUES (${venue}, ${lang}, ${entityType}, ${row.entityId}, ${row.sourceHash},
              ${row.name}, ${row.description}, now())
      ON CONFLICT (venue_id, lang, entity_type, entity_id) DO UPDATE SET
        source_hash = EXCLUDED.source_hash,
        name        = EXCLUDED.name,
        description = EXCLUDED.description,
        updated_at  = now()`;
  }
}
