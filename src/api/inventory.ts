import { getSql } from "@/lib/db";
import { requireAuth } from "@/api/auth";
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

function numeric(value: unknown, fallback: number): number {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function wholeNumber(value: unknown, fallback: number): number {
  const next = Number(value);
  return Number.isFinite(next) ? Math.floor(next) : fallback;
}

function cleanText(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function uuidOrNull(value: unknown): string | null {
  const id = String(value ?? "");
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
    id,
  )
    ? id
    : null;
}

export async function handleInventoryRoute(
  request: Request,
  env: unknown,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/inventory")) return null;

  const payload = await requireAuth(request, env);
  if (!payload) return json({ error: "unauthorized" }, 401);
  const venue = venueFromPayload(payload, url);
  const sql = getSql(env);
  if (!sql) return json({ error: "database not configured" }, 503);

  if (url.pathname === "/api/inventory" && request.method === "GET") {
    const items = await sql`
      SELECT id, name, sku, unit, stock, reorder_level, cost, supplier,
             menu_item_id, active, created_at, updated_at
      FROM inventory_items
      WHERE venue_id = ${venue} AND active = true
      ORDER BY name`;
    return json({ items });
  }

  if (url.pathname === "/api/inventory/low" && request.method === "GET") {
    const items = await sql`
      SELECT id, name, sku, unit, stock, reorder_level, cost, supplier,
             menu_item_id, active, created_at, updated_at
      FROM inventory_items
      WHERE venue_id = ${venue} AND active = true AND stock <= reorder_level
      ORDER BY stock ASC, name`;
    return json({ items });
  }

  if (url.pathname === "/api/inventory" && request.method === "POST") {
    const body = (await request.json().catch(() => ({}))) as {
      name?: string;
      sku?: string;
      unit?: string;
      stock?: number | string;
      reorder_level?: number | string;
      cost?: number | string;
      supplier?: string;
      menu_item_id?: string;
    };
    const name = String(body.name ?? "").trim();
    if (!name) return json({ error: "name required" }, 400);
    const unit = cleanText(body.unit) ?? "unit";
    const stock = numeric(body.stock ?? 0, 0);
    const reorderLevel = numeric(body.reorder_level ?? 0, 0);
    const cost = Math.max(0, wholeNumber(body.cost ?? 0, 0));
    const [item] = await sql`
      INSERT INTO inventory_items (
        venue_id, name, sku, unit, stock, reorder_level, cost, supplier, menu_item_id
      )
      VALUES (
        ${venue}, ${name}, ${cleanText(body.sku)}, ${unit}, ${stock},
        ${reorderLevel}, ${cost}, ${cleanText(body.supplier)}, ${uuidOrNull(body.menu_item_id)}
      )
      RETURNING id, name, sku, unit, stock, reorder_level, cost, supplier,
                menu_item_id, active, created_at, updated_at`;
    return json({ item }, 201);
  }

  const adjustMatch = url.pathname.match(
    /^\/api\/inventory\/([0-9a-fA-F-]+)\/adjust$/,
  );
  if (adjustMatch && request.method === "POST") {
    const id = adjustMatch[1];
    const body = (await request.json().catch(() => ({}))) as {
      delta?: number | string;
      reason?: string;
    };
    const delta = numeric(body.delta, Number.NaN);
    if (!Number.isFinite(delta) || delta === 0) {
      return json({ error: "delta required" }, 400);
    }
    const reason = cleanText(body.reason);
    const [item] = await sql`
      UPDATE inventory_items SET
        stock = stock + ${delta},
        updated_at = now()
      WHERE id = ${id} AND venue_id = ${venue} AND active = true
      RETURNING id, name, sku, unit, stock, reorder_level, cost, supplier,
                menu_item_id, active, created_at, updated_at`;
    if (!item) return json({ error: "item not found" }, 404);
    await sql`
      INSERT INTO inventory_movements (venue_id, item_id, delta, reason)
      VALUES (${venue}, ${id}, ${delta}, ${reason})`;
    return json({ item });
  }

  const match = url.pathname.match(/^\/api\/inventory\/([0-9a-fA-F-]+)$/);
  if (match) {
    const id = match[1];
    if (request.method === "DELETE") {
      await sql`DELETE FROM inventory_items WHERE id = ${id} AND venue_id = ${venue}`;
      return json({ ok: true });
    }
    if (request.method === "PATCH") {
      const body = (await request.json().catch(() => ({}))) as {
        name?: string;
        sku?: string | null;
        unit?: string;
        stock?: number | string;
        reorder_level?: number | string;
        cost?: number | string;
        supplier?: string | null;
        menu_item_id?: string | null;
        active?: boolean;
      };
      const name = body.name == null ? null : String(body.name).trim();
      if (name === "") return json({ error: "name required" }, 400);
      const unit = body.unit == null ? null : String(body.unit).trim();
      if (unit === "") return json({ error: "unit required" }, 400);
      const stock =
        body.stock == null ? null : numeric(body.stock, Number.NaN);
      if (stock != null && !Number.isFinite(stock)) {
        return json({ error: "stock must be numeric" }, 400);
      }
      const reorderLevel =
        body.reorder_level == null
          ? null
          : numeric(body.reorder_level, Number.NaN);
      if (reorderLevel != null && !Number.isFinite(reorderLevel)) {
        return json({ error: "reorder_level must be numeric" }, 400);
      }
      const cost =
        body.cost == null ? null : Math.max(0, wholeNumber(body.cost, 0));
      const sku =
        body.sku === undefined ? null : cleanText(body.sku);
      const supplier =
        body.supplier === undefined ? null : cleanText(body.supplier);
      const menuItemId =
        body.menu_item_id === undefined ? null : uuidOrNull(body.menu_item_id);
      const [item] = await sql`
        UPDATE inventory_items SET
          name          = COALESCE(${name}, name),
          sku           = CASE WHEN ${body.sku === undefined} THEN sku ELSE ${sku} END,
          unit          = COALESCE(${unit}, unit),
          stock         = COALESCE(${stock}, stock),
          reorder_level = COALESCE(${reorderLevel}, reorder_level),
          cost          = COALESCE(${cost}, cost),
          supplier      = CASE WHEN ${body.supplier === undefined} THEN supplier ELSE ${supplier} END,
          menu_item_id  = CASE WHEN ${body.menu_item_id === undefined} THEN menu_item_id ELSE ${menuItemId} END,
          active        = COALESCE(${body.active ?? null}, active),
          updated_at    = now()
        WHERE id = ${id} AND venue_id = ${venue}
        RETURNING id, name, sku, unit, stock, reorder_level, cost, supplier,
                  menu_item_id, active, created_at, updated_at`;
      if (!item) return json({ error: "item not found" }, 404);
      return json({ item });
    }
  }

  return null;
}
