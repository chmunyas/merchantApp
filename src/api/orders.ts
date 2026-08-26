import { requireAuth } from "@/api/auth";
import { getSql } from "@/lib/db";
import { queueOutbound } from "@/lib/outbound-jobs";
import { normalizeFulfillment, type FulfillmentType } from "@/lib/fulfillment";
import { getBaseUrl } from "@/lib/links";
import { orderStatusMessage } from "@/lib/order-notify";
import { buildPrintableReceipt } from "@/lib/receipt-print";
import { deliverStaffNotification } from "@/lib/staff-notify";
import { venueFromPayload } from "@/lib/tenancy";
import { roleAtLeast } from "@/lib/rbac";
import { tokenHasScope } from "@/lib/api-tokens";

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

// Normalise a customer phone into an E.164 handle (a bare leading 0 is treated
// as Kenya, the primary M-Pesa market) for channel delivery.
function toHandle(phone: string): string | null {
  const digits = String(phone ?? "").replace(/[^\d+]/g, "");
  if (!digits) return null;
  if (digits.startsWith("+")) return digits;
  if (digits.startsWith("0")) return `+254${digits.slice(1)}`;
  if (digits.startsWith("254")) return `+${digits}`;
  return `+${digits}`;
}

// Queue the lifecycle notification after the order mutation. The channel worker
// performs compliance checks and records provider acceptance/receipts.
async function notifyOrderCustomer(
  sql: NonNullable<ReturnType<typeof getSql>>,
  env: unknown,
  o: {
    venue: string;
    status: string;
    phone: string;
    fulfillment: FulfillmentType;
    scheduledAt: string | null;
  },
): Promise<boolean> {
  const handle = toHandle(o.phone);
  if (!handle) return false;
  const channel = "whatsapp";
  try {
    const [v] = await sql`SELECT name FROM venues WHERE id = ${o.venue} LIMIT 1`;
    const body = orderStatusMessage(o.status, {
      venueName: (v?.name as string) ?? null,
      fulfillment: o.fulfillment,
      scheduledAt: o.scheduledAt,
    });
    if (!body) return false;
    const result = await queueOutbound(env, {
      deliveryKey: `order:${o.venue}:${o.phone}:${o.status}:${o.scheduledAt ?? "now"}`,
      venue: o.venue,
      sourceType: "order_update",
      sourceId: o.phone,
      channel,
      handle,
      purpose: "transactional",
      body,
    });
    return result.queued;
  } catch {
    return false;
  }
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
  const read = request.method === "GET";
  if (
    !roleAtLeast(payload, "staff") ||
    !tokenHasScope(payload, read ? "orders:read" : "orders:write")
  ) {
    return json({ error: "forbidden" }, 403);
  }
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
               o.fulfillment_type, o.scheduled_at, o.paid_at,
               order_paid_minor(o.venue_id, o.id) AS paid,
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
               o.fulfillment_type, o.scheduled_at, o.paid_at,
               order_paid_minor(o.venue_id, o.id) AS paid,
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
    // B2.6 — only the servers following this table are woken.
    await deliverStaffNotification(env, {
      venue,
      type: "order.new",
      table: tableId,
      amountMinor: total,
      itemCount: items.reduce((sum, item) => sum + item.qty, 0),
      dedupeKey: `order.new:${created?.id ?? ""}`,
      url: "/dashboard/orders",
      data: { order_id: created?.id ?? null },
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
    // Prior state — for change detection (idempotent notifications) + the
    // canonical fulfillment_type / scheduled_at columns the customer order carries.
    const [prev] = await sql`
      SELECT status, customer_phone, fulfillment_type, scheduled_at, table_id, total
      FROM orders WHERE id = ${id} AND venue_id = ${venue} LIMIT 1`;
    if (!prev) return json({ error: "not found" }, 404);

    const [updated] = await sql`
      UPDATE orders SET
        status = COALESCE(${body.status ?? null}, status),
        pickup_at = COALESCE(${pickupAt}, pickup_at),
        fulfilment = COALESCE(${fulfilment}, fulfilment),
        updated_at = now()
      WHERE id = ${id} AND venue_id = ${venue}
      RETURNING id, status, customer_phone, pickup_at, ready_notified_at`;
    if (!updated) return json({ error: "not found" }, 404);

    // Notify the customer on a REAL status change (acknowledged → preparing →
    // ready), fulfillment-aware, best-effort + timeline-logged. Change detection
    // makes it idempotent, so a repeated PATCH to the same status never re-sends.
    let notified = false;
    const changed = Boolean(body.status) && body.status !== prev.status;
    if (changed && updated.customer_phone) {
      notified = await notifyOrderCustomer(sql, env, {
        venue,
        status: String(updated.status),
        phone: String(updated.customer_phone),
        fulfillment: normalizeFulfillment(prev.fulfillment_type),
        scheduledAt:
          (prev.scheduled_at as string | null) ??
          (updated.pickup_at as string | null),
      });
      if (String(updated.status) === "ready" && !updated.ready_notified_at) {
        await sql`UPDATE orders SET ready_notified_at = now() WHERE id = ${id}`;
      }
    }
    // B2.7 — "Order Failed on Table X". Without the POS connector (C5) a
    // cancellation is the only real failure signal we own; a POS push failure
    // will raise the same alert once C5 lands.
    if (changed && String(updated.status) === "cancelled") {
      await deliverStaffNotification(env, {
        venue,
        type: "order.failed",
        table: prev.table_id,
        amountMinor: Number(prev.total ?? 0),
        reason: "The order was cancelled.",
        dedupeKey: `order.failed:${id}`,
        url: "/dashboard/orders",
        data: { order_id: id },
      });
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
             order_paid_minor(o.venue_id, o.id) AS paid
      FROM orders o WHERE o.id = ${id} AND o.venue_id = ${venue} LIMIT 1`;
    if (!order) return json({ error: "not found" }, 404);
    const remaining = Math.max(0, Number(order.total) - Number(order.paid));
    if (remaining <= 0) {
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

  // B3.5 — resend the bill (or the receipt, once it is settled) to the guest,
  // from the floor. The server does not retype anything and does not choose the
  // amount: the text is composed here from the authoritative order.
  //
  // A1.4 — the same endpoint, with `channel: "print"`, returns the printable
  // document instead of queueing a message. Sunday's Digital Bill article
  // (10722442) promises "if you absolutely require a printed receipt, our team
  // will be happy to provide one upon request", so the paper fallback is a
  // STAFF action on the check they already have open — not a second endpoint,
  // a second permission or a second copy of the totals.
  const receiptMatch = url.pathname.match(
    /^\/api\/orders\/([0-9a-fA-F-]+)\/receipt$/,
  );
  if (receiptMatch && request.method === "POST") {
    const id = receiptMatch[1];
    const body = (await request.json().catch(() => ({}))) as {
      phone?: string;
      channel?: string;
    };
    const [order] = await sql`
      SELECT o.id, o.total::bigint AS total, o.currency, o.pay_token, o.paid_at,
             o.customer_phone, o.table_id, o.discount::bigint AS discount,
             o.service_charge::bigint AS service_charge, v.name AS venue_name,
              order_paid_minor(o.venue_id, o.id) AS paid
      FROM orders o
      JOIN venues v ON v.id = o.venue_id
      WHERE o.id = ${id} AND o.venue_id = ${venue} LIMIT 1`;
    if (!order) return json({ error: "not found" }, 404);

    if (body.channel === "print") {
      const items = await sql`
        SELECT name, qty, price, notes FROM order_items
        WHERE order_id = ${id}
        ORDER BY id`;
      const paymentRows = await sql`
        SELECT id, amount::bigint AS amount,
               COALESCE(tip_amount, 0)::bigint AS tip_amount,
               provider, reference, created_at
        FROM payments
        WHERE venue_id = ${venue}
          AND metadata->>'order_id' = ${id}
          AND status IN ('succeeded', 'paid', 'captured')
          AND kind <> 'refund'
        ORDER BY created_at`;
      const receipt = buildPrintableReceipt({
        venueName: String(order.venue_name ?? "us"),
        orderId: String(order.id),
        tableLabel: order.table_id ? String(order.table_id) : null,
        currency: String(order.currency ?? "KES"),
        totalMinor: order.total,
        discountMinor: order.discount,
        serviceChargeMinor: order.service_charge,
        paidAt: order.paid_at ? String(order.paid_at) : null,
        issuedAt: new Date().toISOString(),
        items: items as Array<Record<string, unknown>>,
        payments: paymentRows as Array<Record<string, unknown>>,
      });
      return json({ kind: "print", receipt });
    }

    const handle = toHandle(String(body.phone ?? order.customer_phone ?? ""));
    if (!handle) return json({ error: "no guest number on this order" }, 400);
    const channel = body.channel === "sms" ? "sms" : "whatsapp";

    const totalMinor = Number(order.total) || 0;
    const paidMinor = Number(order.paid) || 0;
    const remaining = Math.max(0, totalMinor - paidMinor);
    const settled = remaining <= 0;
    const currency = String(order.currency ?? "KES");
    const venueName = String(order.venue_name ?? "us");

    let message: string;
    if (settled) {
      message =
        `Thanks for visiting ${venueName}. Your bill of ` +
        `${currency} ${(totalMinor / 100).toLocaleString()} is paid in full. ` +
        `Keep this message as your receipt.`;
    } else {
      // Refresh the server-bound pay token so the link is live for 15 minutes.
      const token =
        (order.pay_token as string | null) ||
        `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");
      await sql`
        UPDATE orders
        SET pay_token = ${token}, pay_expires_at = now() + interval '15 minutes'
        WHERE id = ${id} AND venue_id = ${venue}`;
      const base = await getBaseUrl(env);
      message =
        `Your bill at ${venueName}: ${currency} ` +
        `${(remaining / 100).toLocaleString()} outstanding.\n\n` +
        `Tap to pay, split it or pay for just your dishes 👇\n${base}/pay?o=${token}`;
    }

    // Deduped per minute so a double-tap on a busy floor sends once, while a
    // genuine resend a minute later still goes out. The outbound worker applies
    // the channel's compliance rules and records provider acceptance.
    const minuteBucket = Math.floor(Date.now() / 60_000);
    const queued = await queueOutbound(env, {
      deliveryKey: `order:${id}:receipt:${handle}:${minuteBucket}`,
      venue,
      sourceType: settled ? "order_receipt" : "order_bill",
      sourceId: id,
      channel,
      handle,
      purpose: "transactional",
      body: message,
    });
    return json({
      queued: queued.queued,
      kind: settled ? "receipt" : "bill",
      channel,
      remaining: remaining / 100,
    });
  }

  return null;
}
