import { requireAuth } from "@/api/auth";
import { getSql } from "@/lib/db";
import { getMenu } from "@/lib/menu";
import { applyPromo } from "@/lib/promo";
import { lookupPromo } from "@/api/promo";
import { venueFromPayload } from "@/lib/tenancy";
import { normalizeFulfillment, parseScheduledAt } from "@/lib/fulfillment";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders },
  });
}

type OrderItemInput = {
  name?: string;
  price?: number | string;
  qty?: number | string;
};

function wholeNumber(value: unknown, fallback: number): number {
  const next = Number(value);
  return Number.isFinite(next) ? Math.floor(next) : fallback;
}

// Opaque, unguessable, single-use pay token (256-bit) so the amount is bound to
// the server order and can never be tampered with in the URL.
function payToken(): string {
  return `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");
}

function poweredBy(orgName: string | null, orgBranding: unknown): string | null {
  const org = (orgBranding ?? {}) as Record<string, unknown>;
  return orgName ? ((org.poweredBy as string) ?? `Powered by ${orgName}`) : null;
}

export async function handleQrRoute(
  request: Request,
  env: unknown,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/qr")) return null;
  if (request.method === "OPTIONS") return json({ ok: true });

  const sql = getSql(env);
  if (!sql) return json({ error: "database not configured" }, 503);

  if (url.pathname === "/api/qr" && request.method === "GET") {
    const payload = await requireAuth(request, env);
    if (!payload) return json({ error: "unauthorized" }, 401);
    const venue = venueFromPayload(payload, url);
    const codes = await sql`
      SELECT q.id, q.venue_id, q.label, q.table_id, q.kind, q.created_at,
             t.label AS table_label
      FROM qr_codes q
      LEFT JOIN dining_tables t ON t.id = q.table_id AND t.venue_id = q.venue_id
      WHERE q.venue_id = ${venue}
      ORDER BY q.created_at DESC`;
    return json({ codes });
  }

  if (url.pathname === "/api/qr" && request.method === "POST") {
    const payload = await requireAuth(request, env);
    if (!payload) return json({ error: "unauthorized" }, 401);
    const venue = venueFromPayload(payload, url);
    const body = (await request.json().catch(() => ({}))) as {
      label?: string;
      kind?: string;
      table_id?: string | null;
      tableId?: string | null;
    };
    const label = String(body.label ?? "").trim() || null;
    const kind = String(body.kind ?? "venue").trim() || "venue";
    const tableId = body.table_id ?? body.tableId ?? null;
    const normalizedTableId =
      tableId == null || String(tableId).trim() === ""
        ? null
        : String(tableId).trim();
    if (normalizedTableId) {
      const [table] = await sql`
        SELECT id FROM dining_tables
        WHERE id = ${normalizedTableId} AND venue_id = ${venue}
        LIMIT 1`;
      if (!table) return json({ error: "table not found" }, 400);
    }
    const [code] = await sql`
      INSERT INTO qr_codes (venue_id, label, kind, table_id)
      VALUES (${venue}, ${label}, ${kind}, ${normalizedTableId})
      RETURNING id, venue_id, label, table_id, kind, created_at`;
    return json({ code }, 201);
  }

  const orderMatch = url.pathname.match(/^\/api\/qr\/([0-9a-fA-F-]+)\/order$/);
  if (orderMatch && request.method === "POST") {
    const codeId = orderMatch[1];
    const [code] = await sql`
      SELECT q.id, q.venue_id, q.table_id,
             COALESCE(vb.business_name, v.name, 'PesaSwap') AS merchant,
             vb.logo_url, o.name AS org_name, o.branding AS org_branding
      FROM qr_codes q
      JOIN venues v ON v.id = q.venue_id
      LEFT JOIN venue_branding vb ON vb.venue_id = q.venue_id
      LEFT JOIN organizations o ON o.id = v.org_id
      WHERE q.id = ${codeId}
      LIMIT 1`;
    if (!code) return json({ error: "not found" }, 404);

    const body = (await request.json().catch(() => ({}))) as {
      items?: OrderItemInput[];
      phone?: string;
      promoCode?: string;
      fulfillmentType?: string;
      scheduledAt?: string;
    };
    const items = (body.items ?? [])
      .map((item) => ({
        name: String(item.name ?? "").trim(),
        qty: Math.max(1, wholeNumber(item.qty ?? 1, 1)),
        price: Math.max(0, wholeNumber(item.price ?? 0, 0)),
      }))
      .filter((item) => item.name && item.price > 0);
    if (items.length === 0) return json({ error: "items required" }, 400);

    // A table QR defaults to dine-in; a counter/venue QR lets the guest choose
    // collection or eat-in, and optionally pre-order for a future time.
    const fulfillment = normalizeFulfillment(
      body.fulfillmentType ?? (code.table_id ? "dine_in" : "collection"),
    );
    const scheduledAt = parseScheduledAt(body.scheduledAt);

    const subtotal = items.reduce((sum, item) => sum + item.qty * item.price, 0);
    const phone = body.phone ? String(body.phone).trim() : null;

    // Apply a promo code (server-authoritative): re-validate + compute the discount
    // with the same logic the public preview uses; never trust a client discount.
    let discount = 0;
    let appliedCode: string | null = null;
    let promoId: string | null = null;
    if (typeof body.promoCode === "string" && body.promoCode.trim()) {
      const promo = await lookupPromo(sql, code.venue_id, body.promoCode);
      const result = applyPromo(promo, subtotal);
      if (result.valid && promo) {
        discount = result.discount;
        appliedCode = promo.code;
        promoId = promo.id;
      }
    }
    const amount = Math.max(0, subtotal - discount);
    const token = payToken();
    const [created] = await sql.begin(async (tx) => {
      const [order] = await tx`
        INSERT INTO orders
          (venue_id, table_id, total, discount, promo_code, pay_token, pay_expires_at, customer_phone, fulfillment_type, scheduled_at)
        VALUES (${code.venue_id}, ${code.table_id ?? null}, ${amount}, ${discount},
                ${appliedCode}, ${token}, now() + interval '15 minutes', ${phone},
                ${fulfillment}, ${scheduledAt})
        RETURNING id`;
      for (const item of items) {
        await tx`
          INSERT INTO order_items (order_id, name, qty, price)
          VALUES (${order.id}, ${item.name}, ${item.qty}, ${item.price})`;
      }
      await tx`
        INSERT INTO qr_scans (code_id, venue_id, user_agent, amount)
        VALUES (${code.id}, ${code.venue_id}, ${request.headers.get("user-agent")}, ${amount})`;
      if (promoId) {
        await tx`UPDATE promo_codes SET used_count = used_count + 1 WHERE id = ${promoId}`;
      }
      return tx`SELECT id FROM orders WHERE id = ${order.id} LIMIT 1`;
    });

    // Server-bound pay link: the amount is NEVER trusted from the URL. The pay
    // page resolves this opaque, single-use, 15-minute token to the authoritative
    // order total via GET /api/qr/pay/:token.
    const payUrl = `${url.origin}/pay?o=${token}`;
    return json(
      {
        orderId: created.id,
        amount,
        subtotal,
        discount,
        promoCode: appliedCode,
        fulfillmentType: fulfillment,
        scheduledAt,
        payUrl,
      },
      201,
    );
  }

  const payMatch = url.pathname.match(/^\/api\/qr\/pay\/([0-9a-f]+)$/i);
  if (payMatch && request.method === "GET") {
    const token = payMatch[1];
    const [order] = await sql`
      SELECT o.id, o.venue_id, o.total, o.discount, o.promo_code, o.paid_at, o.pay_expires_at, o.customer_phone,
             COALESCE((SELECT sum(p.amount - COALESCE(p.tip_amount, 0)) FROM payments p
                       WHERE p.metadata->>'order_id' = o.id::text
                         AND p.status IN ('succeeded','paid','captured')
                         AND p.kind <> 'refund'), 0)::bigint AS paid,
             COALESCE(vb.business_name, v.name, 'PesaSwap') AS merchant,
             vb.logo_url, org.name AS org_name, org.branding AS org_branding
      FROM orders o
      JOIN venues v ON v.id = o.venue_id
      LEFT JOIN venue_branding vb ON vb.venue_id = o.venue_id
      LEFT JOIN organizations org ON org.id = v.org_id
      WHERE o.pay_token = ${token}
      LIMIT 1`;
    if (!order) return json({ error: "not found" }, 404);
    const totalMinor = Number(order.total) || 0;
    const paidMinor = Number(order.paid) || 0;
    const remainingMinor = Math.max(0, totalMinor - paidMinor);
    // One-time-use: a fully-paid order returns a paid status (the page shows success).
    if (order.paid_at || remainingMinor <= 0) {
      return json({ orderId: order.id, status: "paid" });
    }
    // Expiry: a stale token cannot be paid — the customer re-scans for a fresh one.
    if (
      order.pay_expires_at &&
      new Date(order.pay_expires_at as string).getTime() < Date.now()
    ) {
      return json({ error: "expired" }, 410);
    }
    const orderItems = await sql`
      SELECT name, qty, price FROM order_items WHERE order_id = ${order.id} ORDER BY id`;
    // Tippable staff for the venue, so the guest can attribute a gratuity to their server.
    const staff = await sql`
      SELECT id, name, role FROM staff
      WHERE venue_id = ${order.venue_id} AND active = true
      ORDER BY name`;
    return json({
      till: String(order.id),
      orderId: String(order.id),
      venue: order.venue_id,
      // amount defaults to the outstanding balance so "pay in full" pays what's left.
      amount: remainingMinor / 100,
      total: totalMinor / 100,
      paid: paidMinor / 100,
      remaining: remainingMinor / 100,
      discount: (Number(order.discount) || 0) / 100,
      promoCode: (order.promo_code as string) ?? null,
      items: orderItems.map((i) => ({
        name: String(i.name),
        qty: Number(i.qty),
        price: Number(i.price) / 100,
      })),
      staff: staff.map((s) => ({
        id: String(s.id),
        name: String(s.name),
        role: String(s.role),
      })),
      merchant: order.merchant,
      logoUrl: order.logo_url ?? null,
      poweredBy: poweredBy(order.org_name ?? null, order.org_branding),
      phone: order.customer_phone ?? null,
      status: "pending",
    });
  }

  const codeMatch = url.pathname.match(/^\/api\/qr\/([0-9a-fA-F-]+)$/);
  if (codeMatch && request.method === "GET") {
    const codeId = codeMatch[1];
    const [code] = await sql`
      SELECT q.id, q.venue_id, q.label, q.kind, q.table_id,
             v.name AS venue_name,
             vb.business_name, vb.logo_url, vb.primary_color,
             o.name AS org_name, o.branding AS org_branding,
             t.label AS table_label, t.seats, t.section
      FROM qr_codes q
      JOIN venues v ON v.id = q.venue_id
      LEFT JOIN venue_branding vb ON vb.venue_id = q.venue_id
      LEFT JOIN organizations o ON o.id = v.org_id
      LEFT JOIN dining_tables t ON t.id = q.table_id AND t.venue_id = q.venue_id
      WHERE q.id = ${codeId}
      LIMIT 1`;
    if (!code) return json({ error: "not found" }, 404);
    await sql`
      INSERT INTO qr_scans (code_id, venue_id, user_agent)
      VALUES (${code.id}, ${code.venue_id}, ${request.headers.get("user-agent")})`;
    // Menu prices are whole KES in the DB, but the entire QR/pay/ledger chain works
    // in MINOR units (formatKes + the pay resolver divide by 100). Convert here so a
    // guest is charged the real amount, not 1/100 of it.
    const menu = await getMenu(sql, code.venue_id);
    const items = menu.map((m) => ({ ...m, price: m.price * 100 }));
    return json({
      venue: {
        id: code.venue_id,
        name: code.venue_name,
      },
      branding: {
        businessName: code.business_name ?? code.venue_name ?? "PesaSwap",
        logoUrl: code.logo_url ?? null,
        primaryColor: code.primary_color ?? null,
        reseller: code.org_name
          ? {
              name: code.org_name,
              poweredBy: poweredBy(code.org_name, code.org_branding),
              logoUrl:
                ((code.org_branding ?? {}) as Record<string, unknown>)
                  .logoUrl ?? null,
            }
          : null,
      },
      table: code.table_id
        ? {
            id: code.table_id,
            label: code.table_label,
            seats: code.seats,
            section: code.section,
          }
        : null,
      items,
    });
  }

  return null;
}
