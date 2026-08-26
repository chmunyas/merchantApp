// The retail counter, server-side.
//
// A sale writes four things that must all land or none of them: the sale, its
// lines, the stock decrement, and the movement that explains the decrement. They
// run in one transaction, because a till that records takings without moving
// stock (or the reverse) produces a shop that cannot be counted.
//
// Reads are staff-level — a cashier needs the price lookup and their own day's
// takings. Cost and margin are manager+: a cashier must not see purchase cost.

import { requireAuth } from "@/api/auth";
import { getSql } from "@/lib/db";
import { tokenHasScope } from "@/lib/api-tokens";
import { roleAtLeast } from "@/lib/rbac";
import { venueFromPayload } from "@/lib/tenancy";
import { venueHasCapability } from "@/api/venue-profile";
import {
  computeSaleTotals,
  validateSale,
  type SaleLineDraft,
} from "@/lib/retail-sales";

type Sql = NonNullable<ReturnType<typeof getSql>>;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const REJECTION_MESSAGE: Record<string, string> = {
  empty: "A sale needs at least one line.",
  method: "Unsupported payment method.",
  no_priced_line: "Every line is zero-priced — scan or price the items first.",
};

async function readSale(
  sql: Sql,
  venue: string,
  saleId: string,
  withCost: boolean,
): Promise<Record<string, unknown> | null> {
  const [sale] = await sql`
    SELECT id, staff_id, customer_name, customer_phone, subtotal_minor,
           discount_minor, total_minor, cost_minor, currency, payment_method,
           payment_id, status, created_at
    FROM retail_sales
    WHERE venue_id = ${venue} AND id = ${saleId}
    LIMIT 1`;
  if (!sale) return null;
  const lines = await sql`
    SELECT name, qty, unit_price_minor, unit_cost_minor, total_minor, item_id
    FROM retail_sale_lines
    WHERE venue_id = ${venue} AND sale_id = ${saleId}
    ORDER BY display_order`;
  const totalMinor = Number(sale.total_minor) || 0;
  const costMinor = Number(sale.cost_minor) || 0;
  return {
    id: String(sale.id),
    staffId: sale.staff_id ? String(sale.staff_id) : null,
    customerName: sale.customer_name ?? null,
    customerPhone: sale.customer_phone ?? null,
    subtotalMinor: Number(sale.subtotal_minor) || 0,
    discountMinor: Number(sale.discount_minor) || 0,
    totalMinor,
    currency: String(sale.currency ?? "KES"),
    paymentMethod: String(sale.payment_method),
    paymentId: sale.payment_id ?? null,
    status: String(sale.status),
    createdAt: new Date(sale.created_at as string).toISOString(),
    ...(withCost ? { costMinor, marginMinor: totalMinor - costMinor } : {}),
    lines: lines.map((line) => ({
      itemId: line.item_id ? String(line.item_id) : null,
      name: String(line.name),
      qty: Number(line.qty),
      unitPriceMinor: Number(line.unit_price_minor) || 0,
      totalMinor: Number(line.total_minor) || 0,
      ...(withCost ? { unitCostMinor: Number(line.unit_cost_minor) || 0 } : {}),
    })),
  };
}

export async function handleRetailRoute(
  request: Request,
  env: unknown,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/retail")) return null;

  const payload = await requireAuth(request, env);
  if (!payload) return json({ error: "unauthorized" }, 401);
  const write = request.method !== "GET";
  if (
    !roleAtLeast(payload, "staff") ||
    !tokenHasScope(payload, write ? "retail:write" : "retail:read")
  ) {
    return json({ error: "forbidden" }, 403);
  }

  const sql = getSql(env);
  if (!sql) return json({ error: "database not configured" }, 503);
  const venue = venueFromPayload(payload, url);

  // The counter is a paid, vertical-specific capability, so the server refuses
  // it rather than relying on the sidebar having hidden the page.
  if (!(await venueHasCapability(sql, venue, "retail.counter"))) {
    return json(
      { error: "retail counter is not enabled for this venue" },
      403,
    );
  }

  const seesCost = roleAtLeast(payload, "manager");

  // Barcode/SKU lookup — what the scanner calls on every beep.
  if (url.pathname === "/api/retail/lookup" && request.method === "GET") {
    const barcode = (url.searchParams.get("barcode") ?? "").trim();
    const sku = (url.searchParams.get("sku") ?? "").trim();
    if (!barcode && !sku) return json({ error: "barcode or sku required" }, 400);
    const [item] = barcode
      ? await sql`
          SELECT id, name, sku, barcode, unit, price, cost, stock, category
          FROM inventory_items
          WHERE venue_id = ${venue} AND barcode = ${barcode} AND active
          LIMIT 1`
      : await sql`
          SELECT id, name, sku, barcode, unit, price, cost, stock, category
          FROM inventory_items
          WHERE venue_id = ${venue} AND sku = ${sku} AND active
          LIMIT 1`;
    if (!item) return json({ error: "not found" }, 404);
    return json({
      item: {
        id: String(item.id),
        name: String(item.name),
        sku: item.sku ?? null,
        barcode: item.barcode ?? null,
        unit: String(item.unit ?? "unit"),
        category: item.category ?? null,
        priceMinor: Number(item.price) || 0,
        stock: Number(item.stock) || 0,
        ...(seesCost ? { costMinor: Number(item.cost) || 0 } : {}),
      },
    });
  }

  if (url.pathname === "/api/retail/sales" && request.method === "GET") {
    const limit = Math.min(
      200,
      Math.max(1, Number(url.searchParams.get("limit")) || 50),
    );
    const rows = await sql`
      SELECT id FROM retail_sales
      WHERE venue_id = ${venue}
      ORDER BY created_at DESC
      LIMIT ${limit}`;
    const sales = [];
    for (const row of rows) {
      const sale = await readSale(sql, venue, String(row.id), seesCost);
      if (sale) sales.push(sale);
    }
    return json({ sales });
  }

  if (url.pathname === "/api/retail/sales" && request.method === "POST") {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const drafts = Array.isArray(body.lines)
      ? (body.lines as SaleLineDraft[])
      : [];
    const totals = computeSaleTotals(drafts, Number(body.discountMinor) || 0);
    const rejection = validateSale(totals, body.paymentMethod ?? "cash");
    if (rejection) {
      return json({ error: REJECTION_MESSAGE[rejection], code: rejection }, 400);
    }

    const idempotencyKey =
      request.headers.get("Idempotency-Key")?.trim().slice(0, 200) || null;
    const staffId =
      typeof payload.staff_id === "string" &&
      /^[0-9a-f-]{36}$/i.test(payload.staff_id)
        ? payload.staff_id
        : null;

    const saleId = (await sql.begin(async (tx) => {
      const [created] = await tx`
        INSERT INTO retail_sales
          (venue_id, staff_id, customer_name, customer_phone, subtotal_minor,
           discount_minor, total_minor, cost_minor, payment_method, payment_id,
           idempotency_key)
        VALUES (
          ${venue}, ${staffId},
          ${String(body.customerName ?? "").trim().slice(0, 200) || null},
          ${String(body.customerPhone ?? "").trim().slice(0, 40) || null},
          ${totals.subtotalMinor}, ${totals.discountMinor}, ${totals.totalMinor},
          ${totals.costMinor}, ${String(body.paymentMethod ?? "cash")},
          ${String(body.paymentId ?? "").trim().slice(0, 200) || null},
          ${idempotencyKey})
        ON CONFLICT (venue_id, idempotency_key)
          WHERE idempotency_key IS NOT NULL
          DO NOTHING
        RETURNING id`;

      if (!created) return null;
      const id = String(created.id);

      let order = 0;
      for (const line of totals.lines) {
        // A till sends what it scanned; resolve that to the catalogue row so a
        // sale still moves stock when the client has no server id to hand.
        let itemId = line.itemId;
        if (!itemId) {
          const draft = drafts.find((d) => d.name === line.name) as
            | (SaleLineDraft & { sku?: string; barcode?: string })
            | undefined;
          const barcode = draft?.barcode?.trim();
          const sku = draft?.sku?.trim();
          if (barcode || sku) {
            const [match] = barcode
              ? await tx`
                  SELECT id FROM inventory_items
                  WHERE venue_id = ${venue} AND barcode = ${barcode} LIMIT 1`
              : await tx`
                  SELECT id FROM inventory_items
                  WHERE venue_id = ${venue} AND sku = ${sku!} LIMIT 1`;
            if (match) itemId = String(match.id);
          }
        }

        await tx`
          INSERT INTO retail_sale_lines
            (venue_id, sale_id, item_id, name, qty, unit_price_minor,
             unit_cost_minor, total_minor, display_order)
          VALUES (${venue}, ${id}, ${itemId}, ${line.name}, ${line.qty},
                  ${line.unitPriceMinor}, ${line.unitCostMinor},
                  ${line.totalMinor}, ${order})`;
        order += 1;

        if (!itemId) continue;
        // Stock is allowed to go negative: refusing a sale because the count is
        // stale loses real money, and the movement row makes the drift visible.
        await tx`
          UPDATE inventory_items
          SET stock = stock - ${line.qty}, updated_at = now()
          WHERE venue_id = ${venue} AND id = ${itemId}`;
        await tx`
          INSERT INTO inventory_movements (venue_id, item_id, delta, reason)
          VALUES (${venue}, ${itemId}, ${-line.qty}, ${`sale:${id}`})`;
      }
      return id;
    })) as string | null;

    if (!saleId) {
      // The key was already used: return the original sale, never a second one.
      const [existing] = await sql`
        SELECT id FROM retail_sales
        WHERE venue_id = ${venue} AND idempotency_key = ${idempotencyKey}
        LIMIT 1`;
      if (!existing) return json({ error: "sale could not be recorded" }, 409);
      const replay = await readSale(sql, venue, String(existing.id), seesCost);
      return json({ sale: replay, replayed: true }, 200);
    }

    const sale = await readSale(sql, venue, saleId, seesCost);
    return json({ sale }, 201);
  }

  return null;
}
