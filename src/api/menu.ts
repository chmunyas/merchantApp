import { getSql } from "@/lib/db";
import { getMenu, guestName, type MenuItem } from "@/lib/menu";
import { aiChat } from "@/lib/ai-providers";
import {
  buildTranslatePrompt,
  parseTranslation,
  type MenuItemLite,
} from "@/lib/menu-ai";
import {
  MAX_CHECKOUT_UPSELLS,
  selectCartUpsells,
  selectCheckoutUpsells,
  type UpsellItem,
} from "@/lib/menu-upsell";
import {
  applyTranslations,
  normalizeLanguageList,
  normalizeLanguageTag,
  planTranslation,
  translationSourceHash,
} from "@/lib/menu-translation";
import {
  isBlank,
  mediaAltText,
  safeMediaUrl,
} from "@/lib/menu-media";
import {
  resolveMenuMode,
  visibleMenus,
  type MenuSurface,
  type VisibilityWindow,
} from "@/lib/menu-visibility";
import {
  getMenuSettings,
  listCheckoutUpsellIds,
  listMenus,
  listUpsellLinks,
  replaceCheckoutUpsells,
  replaceItemUpsells,
  replaceMenuCategories,
  replaceMenuWindows,
  saveMenuSettings,
  type MenuSettings,
} from "@/lib/dynamic-menu";
import {
  buildAdvicePrompt,
  classifyMenu,
  type MenuStat,
} from "@/lib/menu-engineering";
import { roleAtLeast } from "@/lib/rbac";
import { menuProfitStats } from "@/lib/venue-stats";
import { requireAuth, resolveVenue } from "@/api/auth";
import { planLimit, planLimitMessage, planOf, venueFromPayload } from "@/lib/tenancy";
import { tokenHasScope } from "@/lib/api-tokens";
import { simulatorsAllowed } from "@/lib/runtime-security";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders },
  });
}

function wholeNumber(value: unknown, fallback: number): number {
  const next = Number(value);
  return Number.isFinite(next) ? Math.floor(next) : fallback;
}

function cleanTextArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((entry) => String(entry).trim()).filter(Boolean)
    : [];
}

function uuidOrNull(value: unknown): string | null {
  const id = String(value ?? "");
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
    id,
  )
    ? id
    : null;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseDate(value: string | null | undefined, fallback: string): string {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback;
}

// ---------------------------------------------------------------------------
// Dynamic-menu helpers (C6.5, C6.7, C6.10, C6.13 / A6.2, A6.4, A6.6)
// ---------------------------------------------------------------------------

async function venueTimeZone(
  sql: NonNullable<ReturnType<typeof getSql>>,
  venue: string,
): Promise<string> {
  const [row] = await sql`SELECT timezone FROM venues WHERE id = ${venue} LIMIT 1`;
  return String(row?.timezone ?? "Africa/Nairobi");
}

/**
 * The guest-facing projection of a menu item: the merchant's override name,
 * media with authored alt text, and allergens/tags as WORDS. Nothing here is
 * conveyed by colour or icon alone — the client renders these strings.
 */
export function presentItem(item: MenuItem) {
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

function toUpsellItems(items: MenuItem[]): UpsellItem[] {
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
  sql: NonNullable<ReturnType<typeof getSql>>,
  venue: string,
  lang: string | null,
  items: MenuItem[],
): Promise<{ items: MenuItem[]; translated: boolean }> {
  if (!lang) return { items, translated: false };
  const { readTranslations } = await import("@/lib/dynamic-menu");
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

/**
 * C6.5 + A6.4 — normalize and validate the guest-facing product overrides.
 *
 * Media is accepted as a URL, not an upload: this Worker has no object-storage
 * binding, so building a file service was outside these rows. Every URL must be
 * absolute https (these values land in `<img src>` / `<video src>`), and a
 * video without a still image is rejected — both because Sunday blocks it and
 * because a slow connection must still show the dish.
 */
function parseItemMedia(body: Record<string, unknown>): {
  error?: string;
  displayName: string | null;
  description: string | null;
  allergens: string[];
  tags: string[];
  imageUrl: string | null;
  imageAlt: string | null;
  videoUrl: string | null;
  videoDescription: string | null;
} {
  const text = (value: unknown, max: number) =>
    String(value ?? "").trim().slice(0, max) || null;
  const imageUrl = isBlank(body.imageUrl)
    ? null
    : safeMediaUrl(body.imageUrl, "image");
  const videoUrl = isBlank(body.videoUrl)
    ? null
    : safeMediaUrl(body.videoUrl, "video");
  const result = {
    displayName: text(body.displayName, 120),
    description: text(body.description, 1000),
    allergens: cleanTextArray(body.allergens).slice(0, 20),
    tags: cleanTextArray(body.tags).slice(0, 20),
    imageUrl,
    imageAlt: text(body.imageAlt, 250),
    videoUrl,
    videoDescription: text(body.videoDescription, 250),
  };
  if (!isBlank(body.imageUrl) && !imageUrl) {
    return { ...result, error: "imageUrl must be an absolute https image URL" };
  }
  if (!isBlank(body.videoUrl) && !videoUrl) {
    return { ...result, error: "videoUrl must be an absolute https MP4/WebM URL" };
  }
  if (videoUrl && !imageUrl) {
    return {
      ...result,
      error: "add a product image before adding a video",
    };
  }
  return result;
}

function parseWindows(value: unknown): VisibilityWindow[] | null {
  if (value === undefined) return null;
  if (!Array.isArray(value)) return [];
  const windows: VisibilityWindow[] = [];
  for (const entry of value) {
    const raw = (entry ?? {}) as Record<string, unknown>;
    const day = Number(raw.day);
    const start = Number(raw.startMinutes);
    const end = Number(raw.endMinutes);
    if (
      !Number.isInteger(day) || day < 0 || day > 6 ||
      !Number.isInteger(start) || start < 0 || start > 1439 ||
      !Number.isInteger(end) || end < 0 || end > 1439
    ) {
      continue;
    }
    windows.push({ day, startMinutes: start, endMinutes: end });
  }
  return windows;
}

function parseSettings(body: Record<string, unknown>, current: MenuSettings): MenuSettings {
  const externalUrl = safeMediaUrlForMenu(body.externalMenuUrl);
  const externalKind =
    body.externalMenuKind === "pdf" || body.externalMenuKind === "link"
      ? body.externalMenuKind
      : externalUrl
        ? "link"
        : null;
  return {
    dynamicMenuEnabled:
      body.dynamicMenuEnabled === undefined
        ? current.dynamicMenuEnabled
        : Boolean(body.dynamicMenuEnabled),
    defaultLanguage:
      normalizeLanguageTag(body.defaultLanguage) ?? current.defaultLanguage,
    languages:
      body.languages === undefined
        ? current.languages
        : normalizeLanguageList(body.languages),
    externalMenu:
      body.externalMenuUrl === undefined
        ? current.externalMenu
        : externalUrl && externalKind
          ? {
              name: String(body.externalMenuName ?? "Menu").trim().slice(0, 120) || "Menu",
              kind: externalKind,
              url: externalUrl,
            }
          : null,
    checkoutUpsellTitle:
      body.checkoutUpsellTitle === undefined
        ? current.checkoutUpsellTitle
        : String(body.checkoutUpsellTitle ?? "").trim().slice(0, 120) || null,
  };
}

/**
 * External menus are a PDF or a link, so the media validator's extension rules
 * do not apply; the https-only rule still does, because the URL is handed to a
 * guest's browser.
 */
function safeMediaUrlForMenu(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw || raw.length > 2048) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return null;
    if (!url.hostname || url.hostname === "localhost") return null;
    return url.toString();
  } catch {
    return null;
  }
}

export async function handleMenuRoute(
  request: Request,
  env: unknown,
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith("/api/menu")) return null;

  const sql = getSql(env);
  if (!sql) return json({ error: "database not configured" }, 503);

  if (path === "/api/menu" && request.method === "GET") {
    const venue = await resolveVenue(request, env, url);
    return json({ items: await getMenu(sql, venue, true) });
  }

  // A6.1/A6.2/A6.4/A6.6 + C6.1/C6.9-C6.12 — what a guest should see right now.
  // Resolves the dynamic-vs-external toggle, the venue-local visibility
  // schedule and the cached translation in one public read, so the QR page
  // never has to re-derive the rules client side.
  if (path === "/api/menu/live" && request.method === "GET") {
    const venue = await resolveVenue(request, env, url);
    const surface: MenuSurface =
      url.searchParams.get("surface") === "pay-at-table" ? "pay-at-table" : "qr";
    const [settings, timezone] = await Promise.all([
      getMenuSettings(sql, venue),
      venueTimeZone(sql, venue),
    ]);
    const mode = resolveMenuMode({
      dynamicMenuEnabled: settings.dynamicMenuEnabled,
      externalMenu: settings.externalMenu,
    });
    const requested = normalizeLanguageTag(url.searchParams.get("lang"));
    const lang =
      requested && settings.languages.includes(requested) ? requested : null;

    if (mode.mode === "external") {
      return json({
        mode: "external",
        external: mode.external,
        languages: settings.languages,
        defaultLanguage: settings.defaultLanguage,
        lang: null,
        translated: false,
        menus: [],
        items: [],
        checkoutUpsell: null,
      });
    }

    const raw = await getMenu(sql, venue);
    const { items: localized, translated } = await translateFromCache(
      sql,
      venue,
      lang,
      raw,
    );
    const presented = localized.map(presentItem);
    const byCategory = new Map<string, typeof presented>();
    for (const item of presented) {
      const list = byCategory.get(item.category) ?? [];
      list.push(item);
      byCategory.set(item.category, list);
    }

    // C6.1: with the dynamic menu off and no external menu we keep serving the
    // flat list, so switching the toggle is genuinely reversible and no venue
    // loses its menu by not opting in.
    const menus =
      mode.mode === "dynamic"
        ? visibleMenus(await listMenus(sql, venue), new Date(), timezone, surface).map(
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
    const checkoutItems = selectCheckoutUpsells(
      checkoutIds,
      toUpsellItems(localized),
      [],
    );
    return json({
      mode: mode.mode,
      external: null,
      languages: settings.languages,
      defaultLanguage: settings.defaultLanguage,
      lang,
      translated,
      timezone,
      menus,
      items: presented,
      checkoutUpsell:
        checkoutItems.length > 0
          ? {
              title: settings.checkoutUpsellTitle ?? "Before you go…",
              items: checkoutItems.map((entry) =>
                presented.find((item) => item.id === entry.item.id),
              ).filter(Boolean),
            }
          : null,
    });
  }

  // C6.7/A6.6 — upsell recommendations for the current cart. The merchant's
  // MANUAL product pairings come first; the deterministic complement engine
  // only tops the list up. Public: used by the order/pay flow AND by the
  // omnichannel agent's "a drink with that?".
  if (path === "/api/menu/recommend" && request.method === "POST") {
    const venue = await resolveVenue(request, env, url);
    const body = (await request.json().catch(() => ({}))) as {
      cart?: { id?: string; name?: string; category?: string }[];
      max?: number;
      requirePhoto?: boolean;
    };
    const items = await getMenu(sql, venue, true);
    const links = await listUpsellLinks(sql, venue);
    const recs = selectCartUpsells(links, toUpsellItems(items), body.cart ?? [], {
      max: Math.min(5, Math.max(1, Number(body.max) || 3)),
      // The agent renders text, so it can suggest a photo-less product; the
      // visual card surface cannot (Sunday hides those).
      requirePhoto: body.requirePhoto !== false,
    });
    return json({
      recommendations: recs.map((entry) => ({
        item: entry.item,
        reason: entry.reason,
        configured: entry.configured,
        triggeredBy: entry.triggeredBy,
      })),
    });
  }

  // C6.13/A6.2 — AI menu translation, CACHED. Only languages the merchant has
  // configured in Settings are translatable, which bounds model spend and stops
  // an anonymous caller driving arbitrary work. A cache hit costs no model call;
  // a provider failure degrades to the original language rather than an empty
  // menu.
  if (path === "/api/menu/translate" && request.method === "POST") {
    const venue = await resolveVenue(request, env, url);
    const body = (await request.json().catch(() => ({}))) as { lang?: string };
    const lang = normalizeLanguageTag(body.lang);
    if (!lang) return json({ error: "lang required" }, 400);
    const settings = await getMenuSettings(sql, venue);
    if (!settings.languages.includes(lang)) {
      return json({ error: "language not enabled for this venue" }, 400);
    }
    const items = await getMenu(sql, venue, true);
    const { readTranslations, writeTranslations } = await import("@/lib/dynamic-menu");
    const translatable = items.map((item) => ({
      id: item.id,
      name: guestName(item),
      description: item.description,
    }));
    const plan = planTranslation(translatable, await readTranslations(sql, venue, lang, "item"));

    if (plan.stale.length > 0) {
      const out = await aiChat(
        buildTranslatePrompt(
          lang,
          plan.stale.map((entry) => ({
            name: entry.name,
            description: entry.description ?? "",
          })),
        ),
        env,
      );
      const parsed = parseTranslation(out, plan.stale.length);
      if (parsed) {
        const rows = plan.stale.map((entry, index) => ({
          entityId: entry.id,
          sourceHash: translationSourceHash(entry),
          name: parsed[index].name || entry.name,
          description: parsed[index].description || entry.description || null,
        }));
        await writeTranslations(sql, venue, lang, "item", rows);
        for (const row of rows) {
          plan.fresh.set(row.entityId, { name: row.name, description: row.description });
        }
      }
    }

    const merged = applyTranslations(translatable, plan.fresh);
    const byId = new Map(merged.map((entry) => [entry.id, entry]));
    return json({
      lang,
      // False when nothing could be translated — the caller then knows the
      // guest is reading the original language, not a broken translation.
      translated: plan.fresh.size > 0,
      items: items.map((item) => {
        const hit = byId.get(item.id);
        return presentItem(
          hit ? { ...item, displayName: hit.name, description: hit.description } : item,
        );
      }),
    });
  }

  // C6.1/C6.12/C6.13 — venue-level dynamic-menu settings.
  if (path === "/api/menu/settings") {
    const payload = await requireAuth(request, env);
    if (!payload) return json({ error: "unauthorized" }, 401);
    const venue = venueFromPayload(payload, url);
    if (request.method === "GET") {
      if (!roleAtLeast(payload, "manager") || !tokenHasScope(payload, "menu:read")) {
        return json({ error: "forbidden" }, 403);
      }
      const settings = await getMenuSettings(sql, venue);
      return json({
        settings,
        checkoutUpsellItemIds: await listCheckoutUpsellIds(sql, venue),
      });
    }
    if (request.method === "PUT") {
      if (!roleAtLeast(payload, "manager") || !tokenHasScope(payload, "menu:write")) {
        return json({ error: "forbidden" }, 403);
      }
      const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      const current = await getMenuSettings(sql, venue);
      const next = parseSettings(body, current);
      await saveMenuSettings(sql, venue, next);
      if (Array.isArray(body.checkoutUpsellItemIds)) {
        const ids = body.checkoutUpsellItemIds
          .map((id) => uuidOrNull(id))
          .filter((id): id is string => Boolean(id))
          .slice(0, MAX_CHECKOUT_UPSELLS);
        await replaceCheckoutUpsells(sql, venue, ids);
      }
      return json({
        settings: next,
        checkoutUpsellItemIds: await listCheckoutUpsellIds(sql, venue),
      });
    }
  }

  // C6.8-C6.11 — menus.
  if (path === "/api/menu/menus") {
    const payload = await requireAuth(request, env);
    if (!payload) return json({ error: "unauthorized" }, 401);
    const venue = venueFromPayload(payload, url);
    if (request.method === "GET") {
      if (!roleAtLeast(payload, "manager") || !tokenHasScope(payload, "menu:read")) {
        return json({ error: "forbidden" }, 403);
      }
      return json({ menus: await listMenus(sql, venue) });
    }
    if (request.method === "POST") {
      if (!roleAtLeast(payload, "manager") || !tokenHasScope(payload, "menu:write")) {
        return json({ error: "forbidden" }, 403);
      }
      const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      const name = String(body.name ?? "").trim().slice(0, 120);
      if (!name) return json({ error: "name required" }, 400);
      const [{ n }] = await sql`
        SELECT count(*)::int AS n FROM menus WHERE venue_id = ${venue}`;
      const [created] = await sql`
        INSERT INTO menus (venue_id, name, description, display_order)
        VALUES (${venue}, ${name},
                ${String(body.description ?? "").trim() || null}, ${Number(n)})
        ON CONFLICT DO NOTHING
        RETURNING id`;
      // Sunday creates menus INACTIVE: making one must never publish it.
      if (!created) return json({ error: "a menu with that name already exists" }, 409);
      return json({ menus: await listMenus(sql, venue) }, 201);
    }
  }

  // C6.11 — display order. Declared before the :uuid route; "reorder" cannot
  // match the uuid segment class, so the two never collide.
  if (path === "/api/menu/menus/reorder" && request.method === "POST") {
    const payload = await requireAuth(request, env);
    if (!payload) return json({ error: "unauthorized" }, 401);
    if (!roleAtLeast(payload, "manager") || !tokenHasScope(payload, "menu:write")) {
      return json({ error: "forbidden" }, 403);
    }
    const venue = venueFromPayload(payload, url);
    const body = (await request.json().catch(() => ({}))) as { menuIds?: unknown };
    const ids = Array.isArray(body.menuIds)
      ? body.menuIds.map((id) => uuidOrNull(id)).filter((id): id is string => Boolean(id))
      : [];
    if (ids.length === 0) return json({ error: "menuIds required" }, 400);
    let order = 0;
    for (const id of ids) {
      await sql`
        UPDATE menus SET display_order = ${order}, updated_at = now()
        WHERE id = ${id} AND venue_id = ${venue}`;
      order += 1;
    }
    return json({ menus: await listMenus(sql, venue) });
  }

  const menuMatch = path.match(/^\/api\/menu\/menus\/([0-9a-fA-F-]+)$/);
  if (menuMatch) {
    const payload = await requireAuth(request, env);
    if (!payload) return json({ error: "unauthorized" }, 401);
    if (!roleAtLeast(payload, "manager") || !tokenHasScope(payload, "menu:write")) {
      return json({ error: "forbidden" }, 403);
    }
    const venue = venueFromPayload(payload, url);
    const menuId = menuMatch[1];
    if (request.method === "DELETE") {
      const deleted = await sql`
        DELETE FROM menus WHERE id = ${menuId} AND venue_id = ${venue} RETURNING id`;
      if (deleted.length === 0) return json({ error: "not found" }, 404);
      return json({ ok: true });
    }
    if (request.method === "PATCH") {
      const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      const name =
        body.name === undefined ? null : String(body.name).trim().slice(0, 120);
      if (name === "") return json({ error: "name required" }, 400);
      const headerImage =
        body.headerImageUrl === undefined
          ? undefined
          : isBlank(body.headerImageUrl)
            ? null
            : safeMediaUrl(body.headerImageUrl, "image");
      if (headerImage === null && !isBlank(body.headerImageUrl)) {
        return json({ error: "headerImageUrl must be an https image URL" }, 400);
      }
      const [updated] = await sql`
        UPDATE menus SET
          name                    = COALESCE(${name}, name),
          description             = COALESCE(${
            body.description === undefined ? null : String(body.description).trim() || null
          }, description),
          header_image_url        = ${
            headerImage === undefined ? sql`header_image_url` : headerImage
          },
          header_image_alt        = ${
            body.headerImageAlt === undefined
              ? sql`header_image_alt`
              : String(body.headerImageAlt ?? "").trim().slice(0, 250) || null
          },
          is_active               = COALESCE(${
            body.isActive === undefined ? null : Boolean(body.isActive)
          }, is_active),
          visible_on_pay_at_table = COALESCE(${
            body.visibleOnPayAtTable === undefined
              ? null
              : Boolean(body.visibleOnPayAtTable)
          }, visible_on_pay_at_table),
          revision                = revision + 1,
          updated_at              = now()
        WHERE id = ${menuId} AND venue_id = ${venue}
        RETURNING id`;
      if (!updated) return json({ error: "not found" }, 404);
      const windows = parseWindows(body.windows);
      if (windows) await replaceMenuWindows(sql, venue, menuId, windows);
      if (Array.isArray(body.categories)) {
        await replaceMenuCategories(
          sql,
          venue,
          menuId,
          body.categories.map((c) => String(c).trim()).filter(Boolean).slice(0, 40),
        );
      }
      return json({ menus: await listMenus(sql, venue) });
    }
  }

  // C6.7 — related products, configured manually, at product level.
  const upsellMatch = path.match(/^\/api\/menu\/item\/([0-9a-fA-F-]+)\/upsells$/);
  if (upsellMatch) {
    const payload = await requireAuth(request, env);
    if (!payload) return json({ error: "unauthorized" }, 401);
    const venue = venueFromPayload(payload, url);
    const itemId = upsellMatch[1];
    if (request.method === "GET") {
      if (!roleAtLeast(payload, "manager") || !tokenHasScope(payload, "menu:read")) {
        return json({ error: "forbidden" }, 403);
      }
      const links = await listUpsellLinks(sql, venue);
      return json({
        itemId,
        suggestedItemIds: links
          .filter((link) => link.itemId === itemId)
          .map((link) => link.suggestedItemId),
      });
    }
    if (request.method === "PUT") {
      if (!roleAtLeast(payload, "manager") || !tokenHasScope(payload, "menu:write")) {
        return json({ error: "forbidden" }, 403);
      }
      const [owned] = await sql`
        SELECT id FROM menu_items WHERE id = ${itemId} AND venue_id = ${venue}`;
      if (!owned) return json({ error: "not found" }, 404);
      const body = (await request.json().catch(() => ({}))) as { suggestedItemIds?: unknown };
      const ids = Array.isArray(body.suggestedItemIds)
        ? body.suggestedItemIds
            .map((id) => uuidOrNull(id))
            .filter((id): id is string => Boolean(id))
            .slice(0, 5)
        : [];
      await replaceItemUpsells(sql, venue, itemId, ids);
      const links = await listUpsellLinks(sql, venue);
      return json({
        itemId,
        suggestedItemIds: links
          .filter((link) => link.itemId === itemId)
          .map((link) => link.suggestedItemId),
      });
    }
  }

  // Menu engineering (Kasavana-Smith): star / plowhorse / puzzle / dog + a
  // pricing recommendation per item. Gated (owner/manager — it exposes costs +
  // margins). Powers the revenue-optimisation agent.
  if (path === "/api/menu/engineering" && request.method === "GET") {
    const payload = await requireAuth(request, env);
    if (!payload) return json({ error: "unauthorized" }, 401);
    if (!roleAtLeast(payload, "manager")) {
      return json({ error: "forbidden" }, 403);
    }
    if (!tokenHasScope(payload, "menu:read") || !tokenHasScope(payload, "analytics:read")) {
      return json({ error: "forbidden" }, 403);
    }
    const venue = venueFromPayload(payload, url);
    const to = parseDate(url.searchParams.get("to"), isoDate(new Date()));
    const from = parseDate(
      url.searchParams.get("from"),
      isoDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)),
    );
    const stats: MenuStat[] = await menuProfitStats(sql, venue, from, to);
    const engineering = classifyMenu(stats, "KES");
    // Best-effort AI narrative from the revenue-optimisation advisor; degrade to
    // the deterministic headline when no AI provider is configured.
    const advice =
      stats.length > 0
        ? await aiChat(buildAdvicePrompt(engineering), env)
        : null;
    return json({
      from,
      to,
      ...engineering,
      advice: advice ?? engineering.headline,
      aiAdvice: Boolean(advice),
    });
  }

  if (path === "/api/menu/item" && request.method === "POST") {
    const payload = await requireAuth(request, env);
    if (!payload) return json({ error: "unauthorized" }, 401);
    if (!roleAtLeast(payload, "manager") || !tokenHasScope(payload, "menu:write")) {
      return json({ error: "forbidden" }, 403);
    }
    const venue = venueFromPayload(payload, url);
    const body = (await request.json().catch(() => ({}))) as {
      name?: string;
      category?: string;
      price?: number | string;
      dietary?: string[];
      available?: boolean;
      displayName?: string;
      description?: string;
      allergens?: string[];
      tags?: string[];
      imageUrl?: string;
      imageAlt?: string;
      videoUrl?: string;
      videoDescription?: string;
    };
    const name = String(body.name ?? "").trim();
    if (!name) return json({ error: "name required" }, 400);
    const plan = planOf(payload);
    const [{ n }] = await sql`
      SELECT count(*)::int AS n FROM menu_items WHERE venue_id = ${venue}`;
    if (Number(n) >= planLimit(plan, "menu_items")) {
      return json({ error: planLimitMessage(plan, "menu_items") }, 402);
    }
    const category = String(body.category ?? "Mains").trim() || "Mains";
    const price = Math.max(0, wholeNumber(body.price ?? 0, 0));
    const dietary = cleanTextArray(body.dietary);
    const media = parseItemMedia(body);
    if (media.error) return json({ error: media.error }, 400);
    const [item] = await sql`
      INSERT INTO menu_items (venue_id, name, category, price, dietary, available,
                             display_name, description, allergens, tags,
                             image_url, image_alt, video_url, video_description)
      VALUES (${venue}, ${name}, ${category}, ${price}, ${dietary}, ${body.available ?? true},
              ${media.displayName}, ${media.description}, ${media.allergens}, ${media.tags},
              ${media.imageUrl}, ${media.imageAlt}, ${media.videoUrl}, ${media.videoDescription})
      RETURNING id, name, category, price, currency, dietary, available,
            display_name, description, allergens, tags,
            image_url, image_alt, video_url, video_description,
            revision, created_at, updated_at`;
    return json({ item }, 201);
  }

  // Sync the AI agent's menu from the dashboard (replace-all for the venue).
  if (path === "/api/menu/sync" && request.method === "POST") {
    if (!simulatorsAllowed(env)) {
      return json({ error: "replace-all menu sync is disabled" }, 409);
    }
    const payload = await requireAuth(request, env);
    if (!payload) {
      return json({ error: "unauthorized" }, 401);
    }
    if (!roleAtLeast(payload, "manager") || !tokenHasScope(payload, "menu:write")) {
      return json({ error: "forbidden" }, 403);
    }
    const venue = venueFromPayload(payload, url);
    const body = (await request.json()) as {
      venue?: string;
      items?: Array<{
        id?: string;
        name?: string;
        category?: string;
        price?: number;
        dietary?: string[];
        available?: boolean;
      }>;
    };
    const target = venue;
    const items = (body.items ?? []).filter((i) => i.name && i.price != null);
    await sql`DELETE FROM menu_items WHERE venue_id = ${target}`;
    for (const item of items) {
      const itemId = uuidOrNull(item.id);
      if (itemId) {
        await sql`
          INSERT INTO menu_items (id, venue_id, name, category, price, dietary, available)
          VALUES (${itemId}, ${target}, ${item.name ?? ""}, ${item.category ?? "Mains"},
                  ${item.price ?? 0}, ${item.dietary ?? []}, ${item.available ?? true})`;
      } else {
        await sql`
          INSERT INTO menu_items (venue_id, name, category, price, dietary, available)
          VALUES (${target}, ${item.name ?? ""}, ${item.category ?? "Mains"},
                  ${item.price ?? 0}, ${item.dietary ?? []}, ${item.available ?? true})`;
      }
    }
    return json({ ok: true, count: items.length });
  }

  const match = path.match(/^\/api\/menu\/item\/([0-9a-fA-F-]+)$/);
  if (match) {
    const payload = await requireAuth(request, env);
    if (!payload) return json({ error: "unauthorized" }, 401);
    if (!roleAtLeast(payload, "manager") || !tokenHasScope(payload, "menu:write")) {
      return json({ error: "forbidden" }, 403);
    }
    const venue = venueFromPayload(payload, url);
    const id = match[1];
    if (request.method === "DELETE") {
      const revision = Number(url.searchParams.get("revision"));
      if (!Number.isInteger(revision) || revision < 1) {
        return json({ error: "revision required" }, 428);
      }
      const deleted = await sql`
        DELETE FROM menu_items
        WHERE id = ${id} AND venue_id = ${venue} AND revision = ${revision}
        RETURNING id`;
      if (deleted.length === 0) return json({ error: "menu item conflict" }, 409);
      return json({ ok: true });
    }
    if (request.method === "PATCH") {
      const body = (await request.json().catch(() => ({}))) as {
        name?: string;
        category?: string;
        price?: number | string;
        dietary?: string[];
        available?: boolean;
        revision?: number;
        displayName?: string;
        description?: string;
        allergens?: string[];
        tags?: string[];
        imageUrl?: string;
        imageAlt?: string;
        videoUrl?: string;
        videoDescription?: string;
      };
      if (!Number.isInteger(body.revision) || Number(body.revision) < 1) {
        return json({ error: "revision required" }, 428);
      }
      const name = body.name == null ? null : String(body.name).trim();
      if (name === "") return json({ error: "name required" }, 400);
      const category =
        body.category == null ? null : String(body.category).trim();
      if (category === "") return json({ error: "category required" }, 400);
      const price =
        body.price == null ? null : Math.max(0, wholeNumber(body.price, 0));
      const dietary =
        body.dietary === undefined ? null : cleanTextArray(body.dietary);
      const media = parseItemMedia(body);
      if (media.error) return json({ error: media.error }, 400);
      const [item] = await sql`
        UPDATE menu_items SET
          name      = COALESCE(${name}, name),
          category  = COALESCE(${category}, category),
          price     = COALESCE(${price}, price),
          dietary   = COALESCE(${dietary}, dietary),
          available = COALESCE(${body.available ?? null}, available),
          display_name = ${
            body.displayName === undefined ? sql`display_name` : media.displayName
          },
          description  = ${
            body.description === undefined ? sql`description` : media.description
          },
          allergens    = ${
            body.allergens === undefined ? sql`allergens` : media.allergens
          },
          tags         = ${body.tags === undefined ? sql`tags` : media.tags},
          image_url    = ${
            body.imageUrl === undefined ? sql`image_url` : media.imageUrl
          },
          image_alt    = ${
            body.imageAlt === undefined ? sql`image_alt` : media.imageAlt
          },
          -- Removing the still image removes the video with it: the database
          -- constraint forbids a video without a poster frame.
          video_url    = ${
            body.videoUrl === undefined
              ? body.imageUrl !== undefined && media.imageUrl === null
                ? null
                : sql`video_url`
              : media.videoUrl
          },
          video_description = ${
            body.videoDescription === undefined
              ? sql`video_description`
              : media.videoDescription
          },
          revision = revision + 1, updated_at = now()
        WHERE id = ${id} AND venue_id = ${venue}
          AND revision = ${Number(body.revision)}
        RETURNING id, name, category, price, currency, dietary, available,
                  display_name, description, allergens, tags,
                  image_url, image_alt, video_url, video_description,
                  revision, created_at, updated_at`;
      if (!item) return json({ error: "menu item conflict" }, 409);
      return json({ item });
    }
  }

  return null;
}
