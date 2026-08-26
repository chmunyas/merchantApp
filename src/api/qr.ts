import { requireAuth } from "@/api/auth";
import { presentItem } from "@/api/menu";
import { getSql } from "@/lib/db";
import { getMenu } from "@/lib/menu";
import {
  getMenuSettings,
  listCheckoutUpsellIds,
  listMenus,
} from "@/lib/dynamic-menu";
import { resolveMenuMode, visibleMenus } from "@/lib/menu-visibility";
import { mediaAltText } from "@/lib/menu-media";
import { applyPromo } from "@/lib/promo";
import { lookupPromo } from "@/api/promo";
import { venueFromPayload } from "@/lib/tenancy";
import { roleAtLeast } from "@/lib/rbac";
import { tokenHasScope } from "@/lib/api-tokens";
import { createPaymentIntent } from "@/lib/payment-intents";
import { normalizeFulfillment, parseScheduledAt } from "@/lib/fulfillment";
import { computeGuestServiceFee } from "@/lib/fees";
import { apportionBill, type BillLine } from "@/lib/split-apportion";
import {
  claimOrderItems,
  listItemClaims,
  releaseOrderItemClaims,
} from "@/lib/split-lock";
import {
  billTopic,
  publishToTopic,
  subscribeToTopic,
  topicEventsSince,
} from "@/lib/realtime-bus";

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

const PAY_TOKEN_RE = /^[0-9a-f]+$/i;

// A claim key is the guest's own opaque handle for their reservation. It is
// never a credential for anything else, so it only has to be well-formed and
// bounded: it is echoed back in SQL and in a payment's metadata.
function normalizeClaimKey(value: unknown): string | null {
  const key = String(value ?? "").trim();
  return /^[A-Za-z0-9_-]{8,64}$/.test(key) ? key : null;
}

type Sql = NonNullable<ReturnType<typeof getSql>>;

type PayOrder = {
  id: string;
  venueId: string;
  totalMinor: number;
  paidMinor: number;
  remainingMinor: number;
  paid: boolean;
  expired: boolean;
};

// Resolve an opaque pay token to its order + authoritative balance. Shared by
// the bill read, the item claim and the live bus so all four agree on one number.
async function loadPayOrder(sql: Sql, token: string): Promise<PayOrder | null> {
  if (!PAY_TOKEN_RE.test(token)) return null;
  const [order] = await sql`
    SELECT o.id, o.venue_id, o.total::bigint AS total, o.paid_at, o.pay_expires_at,
           order_paid_minor(o.venue_id, o.id) AS paid
    FROM orders o
    WHERE o.pay_token = ${token}
    LIMIT 1`;
  if (!order) return null;
  const totalMinor = Number(order.total) || 0;
  const paidMinor = Number(order.paid) || 0;
  const remainingMinor = Math.max(0, totalMinor - paidMinor);
  return {
    id: String(order.id),
    venueId: String(order.venue_id),
    totalMinor,
    paidMinor,
    remainingMinor,
    paid: remainingMinor <= 0,
    expired: Boolean(
      order.pay_expires_at &&
        new Date(order.pay_expires_at as string).getTime() < Date.now(),
    ),
  };
}

// A2.2 — the bill as the guest sees it: every line, what that line costs once
// the order's tax/service/discount is apportioned onto it, and whether anyone
// else has already taken it.
async function billView(
  sql: Sql,
  order: PayOrder,
  claimKey: string | null,
): Promise<{
  orderId: string;
  total: number;
  paid: number;
  remaining: number;
  status: "pending" | "paid";
  yourItemsTotal: number;
  items: Array<{
    id: string;
    name: string;
    qty: number;
    price: number;
    amount: number;
    state: "open" | "yours" | "taken" | "paid";
  }>;
}> {
  const rows = await sql`
    SELECT id, name, qty, price::bigint AS price
    FROM order_items WHERE order_id = ${order.id} ORDER BY id`;
  const lines: BillLine[] = rows.map((row) => ({
    id: String(row.id),
    qty: Number(row.qty) || 0,
    price: Number(row.price) || 0,
  }));
  const apportioned = apportionBill(lines, order.totalMinor);
  const claims = await listItemClaims(sql, order.id);
  const byItem = new Map(claims.map((c) => [c.orderItemId, c]));

  let yours = 0;
  const items = rows.map((row) => {
    const id = String(row.id);
    const amount = apportioned.get(id) ?? 0;
    const claim = byItem.get(id);
    const mine = Boolean(claimKey) && claim?.claimKey === claimKey;
    if (mine && claim?.status === "held") yours += amount;
    const state: "open" | "yours" | "taken" | "paid" = !claim
      ? "open"
      : claim.status === "paid"
        ? "paid"
        : mine
          ? "yours"
          : "taken";
    return {
      id,
      name: String(row.name),
      qty: Number(row.qty) || 0,
      price: (Number(row.price) || 0) / 100,
      amount: amount / 100,
      state,
    };
  });

  return {
    orderId: order.id,
    total: order.totalMinor / 100,
    paid: order.paidMinor / 100,
    remaining: order.remainingMinor / 100,
    status: order.paid ? "paid" : "pending",
    yourItemsTotal: yours / 100,
    items,
  };
}

// Tell every other phone on this check that the balance (or the set of
// selectable dishes) moved. Best-effort: real-time never blocks a payment.
async function publishBill(env: unknown, sql: Sql, orderId: string): Promise<void> {
  try {
    const [row] = await sql`
      SELECT o.total::bigint AS total,
             order_paid_minor(o.venue_id, o.id) AS paid
      FROM orders o WHERE o.id = ${orderId} LIMIT 1`;
    if (!row) return;
    const total = Number(row.total) || 0;
    const paid = Number(row.paid) || 0;
    const claims = await listItemClaims(sql, orderId);
    await publishToTopic(env, billTopic(orderId), {
      type: "bill.updated",
      data: {
        order_id: orderId,
        total: total / 100,
        paid: paid / 100,
        remaining: Math.max(0, total - paid) / 100,
        taken_item_ids: claims.map((c) => c.orderItemId),
        timestamp: new Date().toISOString(),
      },
    });
  } catch {
    /* best-effort */
  }
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
    if (!roleAtLeast(payload, "manager") || !tokenHasScope(payload, "qr:read")) {
      return json({ error: "forbidden" }, 403);
    }
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
    if (!roleAtLeast(payload, "manager") || !tokenHasScope(payload, "qr:write")) {
      return json({ error: "forbidden" }, 403);
    }
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
      SELECT q.id, q.venue_id, q.table_id, v.timezone,
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
      items?: Array<{ id?: string; qty?: number | string }>;
      phone?: string;
      promoCode?: string;
      fulfillmentType?: string;
      scheduledAt?: string;
    };
    const requestedItems = (body.items ?? [])
      .map((item) => ({
        id: String(item.id ?? "").trim(),
        qty: Math.max(1, wholeNumber(item.qty ?? 1, 1)),
      }))
      .filter((item) => /^[0-9a-f-]{36}$/i.test(item.id));
    if (requestedItems.length === 0) return json({ error: "catalogue item ids required" }, 400);
    const requestedIds = [...new Set(requestedItems.map((item) => item.id))];
    const catalogue = await sql`
      SELECT id, name, price, currency
      FROM menu_items
      WHERE venue_id = ${code.venue_id}
        AND id IN (SELECT unnest(${requestedIds}::uuid[]))
        AND available = true`;
    if (catalogue.length !== requestedIds.length) {
      return json({ error: "one or more items are unavailable" }, 409);
    }
    if (catalogue.some((item) => String(item.currency ?? "KES") !== "KES")) {
      return json({ error: "mixed or unsupported currency" }, 400);
    }
    const byId = new Map(catalogue.map((item) => [String(item.id), item]));
    const items = requestedItems.map((requested) => {
      const item = byId.get(requested.id)!;
      return {
        id: requested.id,
        name: String(item.name),
        qty: requested.qty,
        price: Math.max(0, wholeNumber(item.price, 0)) * 100,
      };
    });

    // A table QR defaults to dine-in; a counter/venue QR lets the guest choose
    // collection or eat-in, and optionally pre-order for a future time.
    const fulfillment = normalizeFulfillment(
      body.fulfillmentType ?? (code.table_id ? "dine_in" : "collection"),
    );
    const scheduledAt = parseScheduledAt(
      body.scheduledAt,
      new Date(),
      String(code.timezone ?? "Africa/Nairobi"),
    );

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
          INSERT INTO order_items (order_id, menu_item_id, name, qty, price)
          VALUES (${order.id}, ${item.id}, ${item.name}, ${item.qty}, ${item.price})`;
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
            SELECT o.id, o.venue_id, o.staff_id, o.total, o.discount, o.promo_code,
              o.paid_at, o.pay_expires_at, o.customer_phone,
              COALESCE(o.service_charge, 0)::bigint AS service_charge,
             order_paid_minor(o.venue_id, o.id) AS paid,
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
    if (remainingMinor <= 0) {
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
      SELECT id, name, qty, price FROM order_items WHERE order_id = ${order.id} ORDER BY id`;
    // A2.2 — each line's share of the AUTHORITATIVE total (so a by-item payer
    // carries their proportional slice of tax, service charge and discount).
    const lineShares = apportionBill(
      orderItems.map((i) => ({
        id: String(i.id),
        qty: Number(i.qty) || 0,
        price: Number(i.price) || 0,
      })),
      totalMinor,
    );
    const liveClaims = await listItemClaims(sql, String(order.id));
    const takenItems = new Set(liveClaims.map((c) => c.orderItemId));
    const tippableStaff = order.staff_id
      ? await sql`
          SELECT id, name, role FROM staff
          WHERE id = ${order.staff_id}
            AND venue_id = ${order.venue_id}
            AND active = true
          LIMIT 1`
      : [];
    const intent = await createPaymentIntent(env, {
      venue: String(order.venue_id),
      amount: remainingMinor,
      currency: "KES",
      sourceType: "order",
      sourceId: String(order.id),
      allowedMethod: "m_pesa_express",
      maxTipAmount: Math.max(0, Math.round(remainingMinor * 0.5)),
      metadata: {
        order_id: String(order.id),
        customer_phone: order.customer_phone ?? null,
        staff_id: order.staff_id ?? null,
        till: String(order.id),
      },
    });
    if ("error" in intent) return json({ error: intent.error }, 503);
    // A5.5: the guest-side fee is quoted by the SERVER from the published policy
    // so the pay page renders a number it never invented. Today that policy is
    // zero-rated (PesaSwap's fee is borne by the venue), and the explainer says
    // so; if a guest fee is ever introduced the same quote carries it.
    // A3.2: the bill's service charge / auto-gratuity travels with it so the tip
    // tiers can adapt to what the POS already added.
    const serviceChargeMinor = Math.min(
      Math.max(0, Number(order.service_charge) || 0),
      totalMinor,
    );
    const guestFee = computeGuestServiceFee(remainingMinor);
    return json({
      till: String(order.id),
      orderId: String(order.id),
      venue: order.venue_id,
      // amount defaults to the outstanding balance so "pay in full" pays what's left.
      amount: remainingMinor / 100,
      total: totalMinor / 100,
      paid: paidMinor / 100,
      remaining: remainingMinor / 100,
      // Auto-gratuity already on the bill (set in the POS, never here).
      serviceCharge: serviceChargeMinor / 100,
      guestFee: {
        enabled: guestFee.enabled,
        amount: guestFee.fee / 100,
        percent: guestFee.percent,
        fixed: guestFee.fixed / 100,
        benefits: guestFee.benefits,
        optOut: guestFee.optOut,
      },
      discount: (Number(order.discount) || 0) / 100,
      promoCode: (order.promo_code as string) ?? null,
      items: orderItems.map((i) => ({
        id: String(i.id),
        name: String(i.name),
        qty: Number(i.qty),
        price: Number(i.price) / 100,
        amount: (lineShares.get(String(i.id)) ?? 0) / 100,
        state: takenItems.has(String(i.id)) ? "taken" : "open",
      })),
      staff: tippableStaff.map((s) => ({
        id: String(s.id),
        name: String(s.name),
        role: String(s.role),
      })),
      merchant: order.merchant,
      logoUrl: order.logo_url ?? null,
      poweredBy: poweredBy(order.org_name ?? null, order.org_branding),
      phone: order.customer_phone ?? null,
      paymentIntentToken: intent.token,
      status: "pending",
    });
  }

  // --- A2.2 / A2.4: split by item, live -------------------------------------
  // All four are authorised by possession of the order's opaque pay token: the
  // same customer-token contract as GET /api/qr/pay/:token. The token resolves
  // the venue and the order, so nothing is ever read from the request body.

  const billMatch = url.pathname.match(/^\/api\/qr\/pay\/([0-9a-f]+)\/bill$/i);
  if (billMatch && request.method === "GET") {
    const order = await loadPayOrder(sql, billMatch[1]);
    if (!order) return json({ error: "not found" }, 404);
    if (order.expired && !order.paid) return json({ error: "expired" }, 410);
    const claimKey = normalizeClaimKey(url.searchParams.get("claimKey"));
    return json(await billView(sql, order, claimKey));
  }

  const claimMatch = url.pathname.match(/^\/api\/qr\/pay\/([0-9a-f]+)\/claim$/i);
  if (claimMatch && request.method === "POST") {
    const order = await loadPayOrder(sql, claimMatch[1]);
    if (!order) return json({ error: "not found" }, 404);
    if (order.paid) return json({ error: "already paid", status: "paid" }, 409);
    if (order.expired) return json({ error: "expired" }, 410);

    const body = (await request.json().catch(() => ({}))) as {
      claimKey?: string;
      itemIds?: unknown;
    };
    const claimKey = normalizeClaimKey(body.claimKey);
    if (!claimKey) return json({ error: "claimKey required" }, 400);
    const itemIds = Array.isArray(body.itemIds)
      ? [
          ...new Set(
            body.itemIds
              .map((id) => String(id ?? "").trim())
              .filter((id) => /^[0-9a-f-]{36}$/i.test(id)),
          ),
        ]
      : [];
    if (itemIds.length === 0) return json({ error: "itemIds required" }, 400);

    const claim = await claimOrderItems(sql, {
      orderId: order.id,
      venue: order.venueId,
      claimKey,
      itemIds,
    });
    if (!claim) return json({ error: "not found" }, 404);
    await publishBill(env, sql, order.id);

    if (claim.grantedMinor <= 0) {
      return json(
        {
          claimed: [],
          conflicts: claim.conflictItemIds,
          amount: 0,
          remaining: claim.remainingMinor / 100,
          error:
            claim.conflictItemIds.length > 0
              ? "those dishes have already been taken"
              : "this bill is already covered",
        },
        409,
      );
    }

    // The intent is bound to the GRANTED amount, and carries the claim key so
    // the charge re-competes for its own reservation instead of stacking a
    // second one on top (see the split-pay guard in api/payments.ts).
    const intent = await createPaymentIntent(env, {
      venue: order.venueId,
      amount: claim.grantedMinor,
      currency: "KES",
      sourceType: "order",
      sourceId: order.id,
      allowedMethod: "m_pesa_express",
      maxTipAmount: Math.max(0, Math.round(claim.grantedMinor * 0.5)),
      metadata: {
        order_id: order.id,
        item_claim_key: claimKey,
        till: order.id,
      },
    });
    if ("error" in intent) return json({ error: intent.error }, 503);

    return json({
      claimed: claim.claimedItemIds,
      conflicts: claim.conflictItemIds,
      amount: claim.grantedMinor / 100,
      itemsTotal: claim.itemsMinor / 100,
      // Lower than itemsTotal when someone paid an unallocated amount that
      // already covered part of these dishes — the guest must be told.
      clamped: claim.grantedMinor < claim.itemsMinor,
      remaining: claim.remainingMinor / 100,
      paymentIntentToken: intent.token,
    });
  }

  const releaseMatch = url.pathname.match(
    /^\/api\/qr\/pay\/([0-9a-f]+)\/release$/i,
  );
  if (releaseMatch && request.method === "POST") {
    const order = await loadPayOrder(sql, releaseMatch[1]);
    if (!order) return json({ error: "not found" }, 404);
    const body = (await request.json().catch(() => ({}))) as {
      claimKey?: string;
    };
    const claimKey = normalizeClaimKey(body.claimKey);
    if (!claimKey) return json({ error: "claimKey required" }, 400);
    await releaseOrderItemClaims(sql, order.id, claimKey);
    await publishBill(env, sql, order.id);
    return json({ ok: true });
  }

  const liveMatch = url.pathname.match(/^\/api\/qr\/pay\/([0-9a-f]+)\/live$/i);
  if (liveMatch && request.method === "GET") {
    const order = await loadPayOrder(sql, liveMatch[1]);
    if (!order) return json({ error: "not found" }, 404);
    const topic = billTopic(order.id);
    if ((request.headers.get("Upgrade") || "").toLowerCase() === "websocket") {
      return await subscribeToTopic(request, env, topic);
    }
    // Polling fallback for a client that could not open a socket.
    const since = url.searchParams.get("since") || "";
    return json({ events: await topicEventsSince(env, topic, since) });
  }

  const codeMatch = url.pathname.match(/^\/api\/qr\/([0-9a-fA-F-]+)$/);
  if (codeMatch && request.method === "GET") {    const codeId = codeMatch[1];
    const [code] = await sql`
      SELECT q.id, q.venue_id, q.label, q.kind, q.table_id,
             v.name AS venue_name, v.timezone,
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
    const timezone = String(code.timezone ?? "Africa/Nairobi");
    const menu = await getMenu(sql, code.venue_id);
    const items = menu.map((m) => ({ ...presentItem(m), price: m.price * 100 }));
    // C6.1/C6.9-C6.12 — which menus this scan should show, resolved server side
    // in the venue's own timezone. `mode: "none"` keeps today's flat list, so a
    // venue that has not enabled the dynamic menu is unaffected.
    const settings = await getMenuSettings(sql, code.venue_id);
    const mode = resolveMenuMode({
      dynamicMenuEnabled: settings.dynamicMenuEnabled,
      externalMenu: settings.externalMenu,
    });
    const byCategory = new Map<string, typeof items>();
    for (const item of items) {
      const list = byCategory.get(item.category) ?? [];
      list.push(item);
      byCategory.set(item.category, list);
    }
    const menus =
      mode.mode === "dynamic"
        ? visibleMenus(
            await listMenus(sql, code.venue_id),
            new Date(),
            timezone,
            "qr",
          ).map((entry) => ({
            id: entry.id,
            name: entry.name,
            description: entry.description,
            headerImageUrl: entry.headerImageUrl,
            headerImageAlt: entry.headerImageUrl
              ? mediaAltText(entry.headerImageAlt, entry.name)
              : null,
            categories: (entry.categories.length > 0
              ? entry.categories
              : Array.from(byCategory.keys())
            ).map((category) => ({
              name: category,
              itemIds: (byCategory.get(category) ?? []).map((item) => item.id),
            })),
          }))
        : [];
    return json({
      venue: {
        id: code.venue_id,
        name: code.venue_name,
        timezone,
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
      menu: {
        mode: mode.mode,
        external: mode.external,
        languages: settings.languages,
        defaultLanguage: settings.defaultLanguage,
        menus,
        checkoutUpsell: {
          title: settings.checkoutUpsellTitle ?? "Before you go\u2026",
          itemIds: await listCheckoutUpsellIds(sql, code.venue_id),
        },
      },
      items,
    });
  }

  return null;
}
