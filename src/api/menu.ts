import { getSql } from "@/lib/db";
import { getMenu } from "@/lib/menu";
import { aiChat } from "@/lib/ai-providers";
import {
  buildTranslatePrompt,
  parseTranslation,
  recommendUpsells,
  type MenuItemLite,
} from "@/lib/menu-ai";
import {
  buildAdvicePrompt,
  classifyMenu,
  type MenuStat,
} from "@/lib/menu-engineering";
import { roleAtLeast } from "@/lib/rbac";
import { menuProfitStats } from "@/lib/venue-stats";
import { requireAuth, resolveVenue } from "@/api/auth";
import { venueFromPayload } from "@/lib/tenancy";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
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

  // Upsell recommendations for the current cart (public — used by the order/pay
  // flow AND the omnichannel agent's "a drink with that?"). Deterministic.
  if (path === "/api/menu/recommend" && request.method === "POST") {
    const venue = await resolveVenue(request, env, url);
    const body = (await request.json().catch(() => ({}))) as {
      cart?: { id?: string; name?: string; category?: string }[];
      max?: number;
    };
    const raw = (await getMenu(sql, venue, true)) as unknown as MenuItemLite[];
    const items = raw.map((i) => ({ ...i, price: Number(i.price) }));
    const recs = recommendUpsells(
      items,
      body.cart ?? [],
      Math.min(5, Math.max(1, Number(body.max) || 3)),
    );
    return json({ recommendations: recs });
  }

  // AI menu translation (public, best-effort — falls back to the original menu
  // if no AI provider is configured or the response can't be parsed).
  if (path === "/api/menu/translate" && request.method === "POST") {
    const venue = await resolveVenue(request, env, url);
    const body = (await request.json().catch(() => ({}))) as { lang?: string };
    const lang = String(body.lang ?? "").trim();
    if (!lang) return json({ error: "lang required" }, 400);
    const items = (await getMenu(sql, venue, true)) as unknown as MenuItemLite[];
    const out = await aiChat(
      buildTranslatePrompt(
        lang,
        items.map((i) => ({ name: i.name, description: i.description ?? "" })),
      ),
      env,
    );
    const parsed = parseTranslation(out, items.length);
    if (!parsed) return json({ lang, translated: false, items });
    const merged = items.map((it, i) => ({
      ...it,
      name: parsed[i].name || it.name,
      description: parsed[i].description || it.description,
    }));
    return json({ lang, translated: true, items: merged });
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
    const venue = venueFromPayload(payload, url);
    const body = (await request.json().catch(() => ({}))) as {
      name?: string;
      category?: string;
      price?: number | string;
      dietary?: string[];
      available?: boolean;
    };
    const name = String(body.name ?? "").trim();
    if (!name) return json({ error: "name required" }, 400);
    const category = String(body.category ?? "Mains").trim() || "Mains";
    const price = Math.max(0, wholeNumber(body.price ?? 0, 0));
    const dietary = cleanTextArray(body.dietary);
    const [item] = await sql`
      INSERT INTO menu_items (venue_id, name, category, price, dietary, available)
      VALUES (${venue}, ${name}, ${category}, ${price}, ${dietary}, ${body.available ?? true})
      RETURNING id, name, category, price, currency, dietary, available, created_at`;
    return json({ item }, 201);
  }

  // Sync the AI agent's menu from the dashboard (replace-all for the venue).
  if (path === "/api/menu/sync" && request.method === "POST") {
    const payload = await requireAuth(request, env);
    if (!payload) {
      return json({ error: "unauthorized" }, 401);
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
    const venue = venueFromPayload(payload, url);
    const id = match[1];
    if (request.method === "DELETE") {
      await sql`DELETE FROM menu_items WHERE id = ${id} AND venue_id = ${venue}`;
      return json({ ok: true });
    }
    if (request.method === "PATCH") {
      const body = (await request.json().catch(() => ({}))) as {
        name?: string;
        category?: string;
        price?: number | string;
        dietary?: string[];
        available?: boolean;
      };
      const name = body.name == null ? null : String(body.name).trim();
      if (name === "") return json({ error: "name required" }, 400);
      const category =
        body.category == null ? null : String(body.category).trim();
      if (category === "") return json({ error: "category required" }, 400);
      const price =
        body.price == null ? null : Math.max(0, wholeNumber(body.price, 0));
      const dietary =
        body.dietary === undefined ? null : cleanTextArray(body.dietary);
      const [item] = await sql`
        UPDATE menu_items SET
          name      = COALESCE(${name}, name),
          category  = COALESCE(${category}, category),
          price     = COALESCE(${price}, price),
          dietary   = COALESCE(${dietary}, dietary),
          available = COALESCE(${body.available ?? null}, available)
        WHERE id = ${id} AND venue_id = ${venue}
        RETURNING id, name, category, price, currency, dietary, available, created_at`;
      return json({ item });
    }
  }

  return null;
}
