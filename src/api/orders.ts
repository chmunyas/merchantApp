import { requireAuth } from "@/api/auth";
import { getSql } from "@/lib/db";
import { getAdapter } from "@/lib/channels";
import { orderReadyMessage } from "@/lib/order-notify";
import { venueFromPayload } from "@/lib/tenancy";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders },
  });
}

const STATUSES = new Set([
  "new",
  "accepted",
  "preparing",
  "ready",
  "served",
  "cancelled",
]);

type OrderItemInput = {
  name?: string;
  qty?: number | string;
  price?: number | string;
  notes?: string;
};

function wholeNumber(value: unknown, fallback: number): number {
  const next = Number(value);
  return Number.isFinite(next) ? Math.floor(next) : fallback;
}

// Server-authoritative orders, venue-scoped + authed.
export async function handleOrdersRoute(
  request: Request,
  env: unknown,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/orders")) return null;

  const payload = await requireAuth(request, env);
  if (!payload) return json({ error: "unauthorized" }, 401);
  const venue = venueFromPayload(payload, url);
  const sql = getSql(env);
  if (!sql) return json({ error: "database not configured" }, 503);

  if (url.pathname === "/api/orders" && request.method === "GET") {
    const status = url.searchParams.get("status");
    if (status && !STATUSES.has(status)) {
      return json({ error: "invalid status" }, 400);
    }

    const orders = status
      ? await sql`
          SELECT o.id, o.venue_id, o.table_id, o.staff_id, o.status, o.total,
                 o.currency, o.created_at, o.updated_at,
                 COALESCE(
                   (
                     SELECT json_agg(
                       json_build_object(
                         'id', oi.id,
                         'name', oi.name,
                         'qty', oi.qty,
                         'price', oi.price,
                         'notes', oi.notes
                       )
                       ORDER BY oi.id
                     )
                     FROM order_items oi
                     WHERE oi.order_id = o.id
                   ),
                   '[]'::json
                 ) AS items
          FROM orders o
          WHERE o.venue_id = ${venue} AND o.status = ${status}
          ORDER BY o.created_at DESC`
      : await sql`
          SELECT o.id, o.venue_id, o.table_id, o.staff_id, o.status, o.total,
                 o.currency, o.created_at, o.updated_at,
                 COALESCE(
                   (
                     SELECT json_agg(
                       json_build_object(
                         'id', oi.id,
                         'name', oi.name,
                         'qty', oi.qty,
                         'price', oi.price,
                         'notes', oi.notes
                       )
                       ORDER BY oi.id
                     )
                     FROM order_items oi
                     WHERE oi.order_id = o.id
                   ),
                   '[]'::json
                 ) AS items
          FROM orders o
          WHERE o.venue_id = ${venue}
          ORDER BY o.created_at DESC`;
    return json({ orders });
  }

  if (url.pathname === "/api/orders" && request.method === "POST") {
    const body = (await request.json().catch(() => ({}))) as {
      tableId?: string;
      items?: OrderItemInput[];
      total?: number | string;
    };
    const items = (body.items ?? [])
      .map((item) => ({
        name: String(item.name ?? "").trim(),
        qty: Math.max(1, wholeNumber(item.qty ?? 1, 1)),
        price: Math.max(0, wholeNumber(item.price ?? 0, 0)),
        notes:
          item.notes == null || String(item.notes).trim() === ""
            ? null
            : String(item.notes).trim(),
      }))
      .filter((item) => item.name);
    if (items.length === 0) return json({ error: "items required" }, 400);

    const computedTotal = items.reduce(
      (sum, item) => sum + item.qty * item.price,
      0,
    );
    const total =
      body.total == null
        ? computedTotal
        : Math.max(0, wholeNumber(body.total, computedTotal));
    const tableId =
      body.tableId == null || String(body.tableId).trim() === ""
        ? null
        : String(body.tableId).trim();

    const [created] = await sql.begin(async (tx) => {
      const [order] = await tx`
        INSERT INTO orders (venue_id, table_id, total)
        VALUES (${venue}, ${tableId}, ${total})
        RETURNING id`;
      for (const item of items) {
        await tx`
          INSERT INTO order_items (order_id, name, qty, price, notes)
          VALUES (${order.id}, ${item.name}, ${item.qty}, ${item.price}, ${item.notes})`;
      }
      return tx`
        SELECT o.id, o.venue_id, o.table_id, o.staff_id, o.status, o.total,
               o.currency, o.created_at, o.updated_at,
               COALESCE(
                 (
                   SELECT json_agg(
                     json_build_object(
                       'id', oi.id,
                       'name', oi.name,
                       'qty', oi.qty,
                       'price', oi.price,
                       'notes', oi.notes
                     )
                     ORDER BY oi.id
                   )
                   FROM order_items oi
                   WHERE oi.order_id = o.id
                 ),
                 '[]'::json
               ) AS items
        FROM orders o
        WHERE o.id = ${order.id} AND o.venue_id = ${venue}
        LIMIT 1`;
    });
    return json({ order: created }, 201);
  }

  const match = url.pathname.match(/^\/api\/orders\/([0-9a-fA-F-]+)$/);
  if (match && request.method === "PATCH") {
    const id = match[1];
    const body = (await request.json().catch(() => ({}))) as {
      status?: string;
      pickupAt?: string;
      fulfilment?: string;
    };
    if (body.status && !STATUSES.has(body.status)) {
      return json({ error: "invalid status" }, 400);
    }
    const pickupAt =
      typeof body.pickupAt === "string" && !Number.isNaN(Date.parse(body.pickupAt))
        ? new Date(body.pickupAt)
        : null;
    const fulfilment =
      body.fulfilment &&
      ["dine_in", "takeaway", "collection"].includes(body.fulfilment)
        ? body.fulfilment
        : null;
    const [updated] = await sql`
      UPDATE orders SET
        status = COALESCE(${body.status ?? null}, status),
        pickup_at = COALESCE(${pickupAt}, pickup_at),
        fulfilment = COALESCE(${fulfilment}, fulfilment),
        updated_at = now()
      WHERE id = ${id} AND venue_id = ${venue}
      RETURNING id, status, customer_phone, pickup_at, ready_notified_at`;
    if (!updated) return json({ error: "not found" }, 404);

    // One-shot "order ready" notification to the customer (best-effort).
    let notified = false;
    if (
      updated.status === "ready" &&
      updated.customer_phone &&
      !updated.ready_notified_at
    ) {
      try {
        const [v] = await sql`SELECT name FROM venues WHERE id = ${venue} LIMIT 1`;
        const msg = orderReadyMessage(
          (v?.name as string) || "your order",
          updated.pickup_at as string | null,
        );
        const out = await getAdapter("whatsapp").send(
          String(updated.customer_phone),
          msg,
          env,
        );
        await sql`UPDATE orders SET ready_notified_at = now() WHERE id = ${id}`;
        notified = out.delivery === "sent";
      } catch {
        /* best-effort — never block the status change on a notification */
      }
    }
    return json({ ok: true, notified });
  }

  return null;
}
