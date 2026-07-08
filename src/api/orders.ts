import { requireAuth } from "@/api/auth";
import { getSql } from "@/lib/db";
import { getAdapter } from "@/lib/channels";
import { getBaseUrl } from "@/lib/links";
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
                 o.fulfillment_type, o.scheduled_at,
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
                 o.fulfillment_type, o.scheduled_at,
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
               o.fulfillment_type, o.scheduled_at,
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

  // Take payment against ANY order (kitchen/dashboard-created, not just QR scans):
  // ensure the order carries a fresh, server-bound pay token and return the
  // split-aware /pay?o= link. The amount is always the order's outstanding balance
  // (never trusted from the URL); recordLedger settles the order when covered.
  const payLinkMatch = url.pathname.match(
    /^\/api\/orders\/([0-9a-fA-F-]+)\/pay-link$/,
  );
  if (payLinkMatch && request.method === "POST") {
    const id = payLinkMatch[1];
    const [order] = await sql`
      SELECT o.id, o.total::bigint AS total, o.pay_token, o.paid_at,
             COALESCE((SELECT sum(p.amount - COALESCE(p.tip_amount, 0)) FROM payments p
                       WHERE p.metadata->>'order_id' = o.id::text
                         AND p.status IN ('succeeded', 'paid', 'captured')
                         AND p.kind <> 'refund'), 0)::bigint AS paid
      FROM orders o WHERE o.id = ${id} AND o.venue_id = ${venue} LIMIT 1`;
    if (!order) return json({ error: "not found" }, 404);
    const remaining = Math.max(0, Number(order.total) - Number(order.paid));
    if (order.paid_at || remaining <= 0) {
      return json({ error: "order already paid", status: "paid" }, 409);
    }
    // Reuse the existing token if present, else mint a 256-bit one. Refresh the
    // 15-minute expiry so the link is immediately valid.
    const token =
      (order.pay_token as string | null) ||
      `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");
    await sql`
      UPDATE orders
      SET pay_token = ${token}, pay_expires_at = now() + interval '15 minutes'
      WHERE id = ${id} AND venue_id = ${venue}`;
    const base = await getBaseUrl(env);
    return json({
      payUrl: `${base}/pay?o=${token}`,
      orderId: id,
      remaining: remaining / 100,
      total: Number(order.total) / 100,
    });
  }

  return null;
}
