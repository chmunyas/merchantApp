/**
 * PesaSwap Server API Routes
 * Handles payment creation, status checks, refunds, and webhooks.
 * Designed for Cloudflare Workers (fetch-based, no Node.js dependencies).
 */

// --- Environment Config ---

import { getSql } from "@/lib/db";
import { requireAuth } from "@/api/auth";
import {
  postCogsEntry,
  postPaymentEntry,
  postRefundEntry,
} from "@/lib/accounting";
import { recordPayment as recordInvoicePayment } from "@/lib/invoicing";
import { resolveInitiator } from "@/lib/tx-initiator";

type Env = {
  PESASWAP_API_KEY: string;
  PESASWAP_WEBHOOK_SECRET: string;
  PESASWAP_URL: string; // https://sandbox.Pesaswap.io or https://api.Pesaswap.io
  PAYMENTS_TEST_MODE: string;
};

function getEnv(runtimeEnv?: unknown): Env {
  // On Cloudflare Workers, secrets set via `wrangler secret put` are on the
  // per-request `env` binding — NOT globalThis/process.env. Read the binding
  // first so PESASWAP_API_KEY / PESASWAP_WEBHOOK_SECRET are actually available.
  const e = (runtimeEnv ?? {}) as Record<string, unknown>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any;
  const pick = (k: string): string =>
    (typeof e[k] === "string" ? (e[k] as string) : "") ||
    g[k] ||
    (typeof process !== "undefined" ? process.env?.[k] : undefined) ||
    "";
  return {
    PESASWAP_API_KEY: pick("PESASWAP_API_KEY"),
    PESASWAP_WEBHOOK_SECRET: pick("PESASWAP_WEBHOOK_SECRET"),
    PESASWAP_URL: pick("PESASWAP_URL") || "https://api.sandbox.pesaswap.io",
    PAYMENTS_TEST_MODE: pick("PAYMENTS_TEST_MODE"),
  };
}

// --- Types ---

type PaymentRequest = {
  amount: number; // minor units (cents)
  currency: string;
  description?: string;
  metadata?: Record<string, unknown>;
  customer_id?: string;
  payment_method?: string;
  capture?: boolean;
};

type RefundRequest = {
  payment_id: string;
  amount?: number; // partial refund; omit for full
  reason: string;
  items?: Array<{ id: string; name: string; price: number; qty: number }>;
  refunded_by: string;
  metadata?: Record<string, unknown>;
};

// --- In-memory stores (replace with Durable Objects or KV in production) ---

const payments = new Map<
  string,
  {
    id: string;
    amount: number;
    currency: string;
    status: string;
    metadata: Record<string, unknown>;
    created_at: string;
    refunds: Array<{ id: string; amount: number; reason: string; created_at: string }>;
  }
>();

const customerMethods = new Map<
  string, // phone number
  {
    customer_id: string;
    methods: Array<{ id: string; type: string; last4?: string; label: string }>;
    default_method?: string;
  }
>();

// WebSocket connections for real-time notifications
const merchantConnections = new Map<string, Set<WebSocket>>();

// Idempotency key cache (prevents double charges)
const idempotencyCache = new Map<string, { response: unknown; expires: number }>();

// Post cost-of-goods-sold for a paid order: match its line items to inventory
// by name and expense the cost (Dr COGS, Cr Inventory). Idempotent per order;
// best-effort. Unmatched items simply contribute no cost.
async function postOrderCogs(
  sql: NonNullable<ReturnType<typeof getSql>>,
  venue: string,
  meta: Record<string, unknown>,
): Promise<void> {
  const orderId =
    typeof meta.order_id === "string" && /^[0-9a-f-]{36}$/i.test(meta.order_id)
      ? meta.order_id
      : null;
  if (!orderId) return;
  const [row] = await sql`
    SELECT COALESCE(sum(oi.qty * inv.cost), 0)::bigint AS cogs
    FROM order_items oi
    JOIN inventory_items inv
      ON inv.venue_id = ${venue} AND lower(inv.name) = lower(oi.name)
    WHERE oi.order_id = ${orderId}`;
  const cogs = Number(row?.cogs ?? 0);
  if (cogs > 0) {
    await postCogsEntry(sql, { venue, orderId, cost: cogs });
  }
}

// Persist a payment/refund to the Postgres ledger (best-effort — never blocks
// the payment). Foundation for settlement + reconciliation, replacing the
// ephemeral in-memory Map above.
async function recordLedger(
  env: unknown,
  rec: {
    id: string;
    amount: number;
    currency: string;
    status: string;
    kind?: string;
    venue?: string | null;
    reference?: string | null;
    providerRef?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  const sql = getSql(env);
  if (!sql) return;
  // Attribute the tip + serving staff (for the tips feature) from metadata.
  const meta = (rec.metadata ?? {}) as Record<string, unknown>;
  const tipAmount = Math.max(0, Math.round(Number(meta.tip_amount ?? 0)) || 0);
  const staffId =
    typeof meta.staff_id === "string" && /^[0-9a-f-]{36}$/i.test(meta.staff_id)
      ? meta.staff_id
      : null;
  // Agent Pay Gateway: tag human- vs agent-initiated transactions.
  const initiator = resolveInitiator(meta);

  // Loyalty is keyed on the customer phone (the unique loyalty reference). Award
  // points only on the FIRST transition into a succeeded state, so re-recording
  // the same payment id never double-counts.
  const SUCCEEDED = ["succeeded", "paid", "captured"];
  const loyaltyPhone =
    typeof meta.customer_phone === "string" ? meta.customer_phone.trim() : "";
  // Side effects that must fire exactly once (loyalty accrual, invoice
  // settlement) are gated on the FIRST transition of this payment id into a
  // succeeded state, so re-recording the same payment never double-counts.
  const succeededNow =
    SUCCEEDED.includes(rec.status) && rec.kind !== "refund" && Boolean(rec.venue);
  let alreadySucceeded = false;
  if (succeededNow) {
    try {
      const [prev] = await sql`SELECT status FROM payments WHERE id = ${rec.id}`;
      alreadySucceeded = prev
        ? SUCCEEDED.includes(String((prev as { status?: string }).status ?? ""))
        : false;
    } catch {
      /* treat as a new payment */
    }
  }
  const firstSuccess = succeededNow && !alreadySucceeded;

  try {
    await sql`
      INSERT INTO payments
        (id, venue_id, kind, amount, currency, status, provider_ref, reference, metadata, tip_amount, staff_id, initiator)
      VALUES (${rec.id}, ${rec.venue ?? null}, ${rec.kind ?? "payment"}, ${rec.amount},
              ${rec.currency}, ${rec.status}, ${rec.providerRef ?? null}, ${rec.reference ?? null},
              ${sql.json(JSON.parse(JSON.stringify(rec.metadata ?? {})))}, ${tipAmount}, ${staffId}, ${initiator})
      ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status,
        tip_amount = EXCLUDED.tip_amount,
        staff_id = COALESCE(EXCLUDED.staff_id, payments.staff_id),
        updated_at = now()`;
  } catch {
    /* best-effort ledger */
  }

  // Post the double-entry accounting journal (best-effort — an unbalanced or
  // failed post must never block a payment).
  if (rec.venue) {
    try {
      if (rec.kind === "refund") {
        await postRefundEntry(sql, {
          venue: rec.venue,
          id: rec.id,
          amount: Number(rec.amount),
          currency: rec.currency,
        });
      } else if (SUCCEEDED.includes(rec.status)) {
        const invoiceNumber =
          typeof meta.invoice_number === "string"
            ? meta.invoice_number.trim()
            : "";
        if (invoiceNumber) {
          // Invoice payment: settle the receivable + mark the invoice paid via
          // recordPayment (revenue was booked at issue, not here). Once only.
          if (firstSuccess) {
            const [inv] = await sql`
              SELECT id FROM invoices
              WHERE venue_id = ${rec.venue} AND number = ${invoiceNumber}
              LIMIT 1`;
            if (inv?.id) {
              // recordPayment works in the invoice's whole-KES units; the
              // payment amount is in minor units, so scale ÷100.
              await recordInvoicePayment(
                env,
                rec.venue,
                String(inv.id),
                Math.round(Number(rec.amount) / 100),
              );
            } else {
              await postPaymentEntry(sql, {
                venue: rec.venue,
                id: rec.id,
                amount: Number(rec.amount),
                tip: tipAmount,
                currency: rec.currency,
              });
            }
          }
        } else {
          // Direct sale — recognise revenue on receipt (cash basis). Idempotent.
          await postPaymentEntry(sql, {
            venue: rec.venue,
            id: rec.id,
            amount: Number(rec.amount),
            tip: tipAmount,
            currency: rec.currency,
          });
          await postOrderCogs(sql, rec.venue, meta);
        }
      }
    } catch {
      /* best-effort accounting */
    }
  }

  // Accrue loyalty points to the contact identified by phone (upsert on the
  // unique venue+phone key). Best-effort — never block the payment.
  if (firstSuccess && loyaltyPhone) {
    const points = Math.floor(Number(rec.amount) / 1000);
    if (points > 0) {
      try {
        await sql`
          INSERT INTO contacts (venue_id, name, phone, points, visits, last_visit)
          VALUES (${rec.venue ?? null}, ${(meta.customer_name as string) || "Guest"},
                  ${loyaltyPhone}, ${points}, 1, now())
          ON CONFLICT (venue_id, phone) WHERE phone IS NOT NULL AND phone <> ''
          DO UPDATE SET points = contacts.points + ${points},
                        visits = contacts.visits + 1,
                        last_visit = now()`;
      } catch {
        /* best-effort loyalty */
      }
    }
  }

  // Mark a QR order as paid (one-time-use) once its payment succeeds, so its pay
  // token cannot be replayed.
  const paidOrderId =
    typeof meta.order_id === "string" && /^[0-9a-f-]{36}$/i.test(meta.order_id)
      ? meta.order_id
      : null;
  if (SUCCEEDED.includes(rec.status) && paidOrderId) {
    try {
      await sql`UPDATE orders SET paid_at = COALESCE(paid_at, now()) WHERE id = ${paidOrderId}`;
    } catch {
      /* best-effort */
    }
  }
}

// --- Route Handler ---

export async function handlePaymentRoute(
  request: Request,
  env: unknown,
): Promise<Response | null> {
  ensureIdempotencyCleanup();
  const url = new URL(request.url);
  const path = url.pathname;

  // CORS headers for all API routes
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Idempotency-Key, api-key",
  };

  // Handle CORS preflight
  if (request.method === "OPTIONS" && path.startsWith("/api/")) {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // --- Payment Routes ---
  if (path === "/api/payments/create" && request.method === "POST") {
    return withCors(await handleCreatePayment(request, env), corsHeaders);
  }

  // Capture a previously authorised (manual-capture / pre-auth hold) payment.
  if (
    path.match(/^\/api\/payments\/[^/]+\/capture$/) &&
    request.method === "POST"
  ) {
    const paymentId = path.split("/")[3];
    return withCors(await handleCapture(paymentId, request, env), corsHeaders);
  }

  if (path.match(/^\/api\/payments\/[^/]+\/status$/) && request.method === "GET") {
    const paymentId = path.split("/")[3];
    return withCors(handleGetPaymentStatus(paymentId), corsHeaders);
  }

  // --- Refund Routes ---
  if (path === "/api/refunds" && request.method === "POST") {
    return withCors(await handleRefund(request, env), corsHeaders);
  }

  // --- Customer Payment Methods ---
  if (path === "/api/customers/payment-methods" && request.method === "GET") {
    const phone = url.searchParams.get("phone") || "";
    return withCors(handleGetCustomerMethods(phone), corsHeaders);
  }

  // --- Webhook from PesaSwap ---
  if (path === "/api/webhooks/pesaswap" && request.method === "POST") {
    return withCors(await handleWebhook(request, env), corsHeaders);
  }

  // --- Polling notifications fallback ---
  if (path === "/api/notifications" && request.method === "GET") {
    return withCors(handleNotifications(url), corsHeaders);
  }

  // --- WebSocket upgrade for real-time ---
  if (path === "/api/realtime") {
    return handleRealtimeUpgrade(request, url);
  }

  return null; // Not an API route
}

// --- Create Payment ---

async function handleCreatePayment(
  request: Request,
  workerEnv: unknown,
): Promise<Response> {
  const body = (await request.json()) as PaymentRequest;
  const idempotencyKey = request.headers.get("Idempotency-Key");

  // Check idempotency
  if (idempotencyKey) {
    const cached = idempotencyCache.get(idempotencyKey);
    if (cached && cached.expires > Date.now()) {
      return jsonResponse(cached.response, 200);
    }
  }

  // Validate
  if (!body.amount || body.amount <= 0) {
    return jsonResponse({ error: { message: "Amount must be positive" } }, 400);
  }

  const env = getEnv(workerEnv);

  // Test mode: simulate a successful payment WITHOUT calling the provider, so the
  // full journey (QR -> order -> pay -> success -> loyalty -> receipt portal) works
  // end-to-end without live PesaSwap credentials. The ledger is still written, so
  // loyalty accrual + order settlement run. Set PAYMENTS_TEST_MODE=0 and provide a
  // real PESASWAP_API_KEY to take real payments.
  const testMode =
    env.PAYMENTS_TEST_MODE !== "" &&
    env.PAYMENTS_TEST_MODE !== "0" &&
    env.PAYMENTS_TEST_MODE.toLowerCase() !== "false";
  if (testMode) {
    const meta = (body.metadata ?? {}) as Record<string, unknown>;
    const paymentId = `test_${crypto.randomUUID().replace(/-/g, "")}`;
    payments.set(paymentId, {
      id: paymentId,
      amount: body.amount,
      currency: body.currency || "KES",
      status: "succeeded",
      metadata: meta,
      created_at: new Date().toISOString(),
      refunds: [],
    });
    await recordLedger(workerEnv, {
      id: paymentId,
      amount: body.amount,
      currency: body.currency || "KES",
      status: "succeeded",
      venue: typeof meta.venue === "string" ? meta.venue : null,
      reference: typeof meta.till === "string" ? meta.till : null,
      metadata: meta,
    });
    const responseBody = {
      payment_id: paymentId,
      client_secret: null,
      status: "succeeded",
      amount: body.amount,
      currency: body.currency || "KES",
      test_mode: true,
    };
    if (idempotencyKey) {
      idempotencyCache.set(idempotencyKey, {
        response: responseBody,
        expires: Date.now() + 3_600_000,
      });
    }
    return jsonResponse(responseBody, 201);
  }

  try {
    // Call PesaSwap API
    const apiResponse = await fetch(`${env.PESASWAP_URL}/payments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "api-key": env.PESASWAP_API_KEY,
      },
      body: JSON.stringify({
        amount: body.amount,
        currency: body.currency || "KES",
        description: body.description,
        metadata: body.metadata,
        customer_id: body.customer_id,
        capture_method: body.capture === false ? "manual" : "automatic",
        confirm: false, // client will confirm
      }),
    });

    const paymentIntent = await apiResponse.json();

    if (paymentIntent.error) {
      return jsonResponse({ error: paymentIntent.error }, apiResponse.status);
    }

    // Store locally for tracking
    const paymentRecord = {
      id: paymentIntent.payment_id || paymentIntent.id,
      amount: body.amount,
      currency: body.currency || "KES",
      status: paymentIntent.status || "requires_payment_method",
      metadata: (body.metadata as Record<string, unknown>) || {},
      created_at: new Date().toISOString(),
      refunds: [],
    };
    payments.set(paymentRecord.id, paymentRecord);

    // Persist to the durable ledger (survives restarts, shared across workers).
    const meta = (body.metadata ?? {}) as Record<string, unknown>;
    await recordLedger(workerEnv, {
      id: paymentRecord.id,
      amount: body.amount,
      currency: body.currency || "KES",
      status: paymentRecord.status,
      venue: typeof meta.venue === "string" ? meta.venue : null,
      reference: typeof meta.till === "string" ? meta.till : null,
      metadata: meta,
    });

    const responseBody = {
      payment_id: paymentRecord.id,
      client_secret: paymentIntent.client_secret,
      status: paymentRecord.status,
      amount: body.amount,
      currency: body.currency || "KES",
    };

    // Cache idempotent response (1 hour)
    if (idempotencyKey) {
      idempotencyCache.set(idempotencyKey, {
        response: responseBody,
        expires: Date.now() + 3600000,
      });
    }

    return jsonResponse(responseBody, 201);
  } catch (err) {
    console.error("[PesaSwap] Payment creation error:", err);
    return jsonResponse({ error: { message: "Failed to create payment" } }, 500);
  }
}

// --- Get Payment Status ---

function handleGetPaymentStatus(paymentId: string): Response {
  const payment = payments.get(paymentId);
  if (!payment) {
    return jsonResponse({ error: { message: "Payment not found" } }, 404);
  }

  return jsonResponse({
    payment_id: payment.id,
    status: payment.status,
    amount: payment.amount,
    currency: payment.currency,
    metadata: payment.metadata,
    refunds: payment.refunds,
    created_at: payment.created_at,
  });
}

// --- Capture a pre-authorised payment ---

// Completes a payment created with `capture: false` (a manual-capture / card
// pre-auth hold). Gated. Simulated under PAYMENTS_TEST_MODE or without live keys.
async function handleCapture(
  paymentId: string,
  request: Request,
  workerEnv: unknown,
): Promise<Response> {
  if (!(await requireAuth(request, workerEnv))) {
    return jsonResponse({ error: { message: "unauthorized" } }, 401);
  }
  const env = getEnv(workerEnv);
  const body = (await request.json().catch(() => ({}))) as { amount?: number };
  const payment = payments.get(paymentId);
  const amount = payment?.amount ?? Number(body.amount ?? 0);
  const currency = payment?.currency ?? "KES";
  const venue = (payment?.metadata?.venue as string) ?? null;

  const testMode =
    typeof env.PAYMENTS_TEST_MODE === "string" &&
    env.PAYMENTS_TEST_MODE !== "" &&
    env.PAYMENTS_TEST_MODE !== "0" &&
    env.PAYMENTS_TEST_MODE.toLowerCase() !== "false";

  async function settleCaptured() {
    if (payment) payment.status = "captured";
    await recordLedger(workerEnv, {
      id: paymentId,
      amount,
      currency,
      status: "captured",
      venue,
      metadata: payment?.metadata ?? {},
    });
  }

  if (testMode || !env.PESASWAP_API_KEY) {
    await settleCaptured();
    return jsonResponse({ payment_id: paymentId, status: "captured", test_mode: true });
  }

  try {
    const apiResponse = await fetch(
      `${env.PESASWAP_URL}/payments/${paymentId}/capture`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-key": env.PESASWAP_API_KEY,
        },
        body: JSON.stringify(body.amount ? { amount: body.amount } : {}),
      },
    );
    const result = await apiResponse.json();
    if (result.error) {
      return jsonResponse({ error: result.error }, apiResponse.status);
    }
    await settleCaptured();
    return jsonResponse({ payment_id: paymentId, status: "captured" });
  } catch (err) {
    console.error("[PesaSwap] Capture error:", err);
    return jsonResponse({ error: { message: "Failed to capture payment" } }, 500);
  }
}

// --- Process Refund ---

async function handleRefund(
  request: Request,
  runtimeEnv: unknown,
): Promise<Response> {
  const body = (await request.json()) as RefundRequest;

  if (!body.payment_id) {
    return jsonResponse({ error: { message: "payment_id is required" } }, 400);
  }

  const env = getEnv(runtimeEnv);
  const payment = payments.get(body.payment_id);

  // Calculate refund amount
  const refundAmount = body.amount || payment?.amount;
  if (!refundAmount || refundAmount <= 0) {
    return jsonResponse({ error: { message: "Invalid refund amount" } }, 400);
  }

  // Check for over-refund
  if (payment) {
    const totalRefunded = payment.refunds.reduce((sum, r) => sum + r.amount, 0);
    if (totalRefunded + refundAmount > payment.amount) {
      return jsonResponse(
        { error: { message: `Refund would exceed original payment. Already refunded: ${totalRefunded}` } },
        400,
      );
    }
  }

  try {
    // Call PesaSwap Refund API
    const apiResponse = await fetch(`${env.PESASWAP_URL}/refunds`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "api-key": env.PESASWAP_API_KEY,
        "Idempotency-Key": request.headers.get("Idempotency-Key") || `refund-${body.payment_id}-${Date.now()}`,
      },
      body: JSON.stringify({
        payment_id: body.payment_id,
        amount: refundAmount,
        reason: body.reason,
        metadata: {
          refunded_by: body.refunded_by,
          refunded_items: body.items ? JSON.stringify(body.items) : undefined,
          original_payment_metadata: payment?.metadata,
          ...body.metadata,
        },
      }),
    });

    const refundResult = await apiResponse.json();

    if (refundResult.error) {
      return jsonResponse({ error: refundResult.error }, apiResponse.status);
    }

    const refundRecord = {
      id: refundResult.refund_id || refundResult.id || `ref_${Date.now()}`,
      amount: refundAmount,
      reason: body.reason,
      created_at: new Date().toISOString(),
    };

    // Update local payment record
    if (payment) {
      payment.refunds.push(refundRecord);
      const totalRefunded = payment.refunds.reduce((sum, r) => sum + r.amount, 0);
      if (totalRefunded >= payment.amount) {
        payment.status = "refunded";
      } else {
        payment.status = "partially_refunded";
      }
    }

    // Notify merchant via WebSocket
    const merchantId = (payment?.metadata?.merchant_id as string) || "";
    broadcastToMerchant(merchantId, {
      type: "payment.refunded",
      data: {
        refund_id: refundRecord.id,
        payment_id: body.payment_id,
        amount: refundAmount,
        reason: body.reason,
        refunded_by: body.refunded_by,
        timestamp: refundRecord.created_at,
      },
    });

    // Persist the refund to the durable ledger + post its accounting entry
    // (best-effort — never fail the refund on a bookkeeping error).
    try {
      await recordLedger(env, {
        id: refundRecord.id,
        kind: "refund",
        amount: refundAmount,
        currency: (payment?.currency as string) || "KES",
        status: "refunded",
        venue: (payment?.metadata?.venue as string) || null,
        reference: body.payment_id,
        metadata: { ...(payment?.metadata ?? {}), refund_of: body.payment_id },
      });
    } catch {
      /* best-effort */
    }

    // Deduct loyalty points for refunded amount
    if (payment?.metadata?.customer_phone) {
      const pointsToDeduct = Math.floor(refundAmount / 1000); // 1 point per KES 10 in minor units
      console.info(`[Loyalty] Deducting ${pointsToDeduct} points for refund on ${payment.metadata.customer_phone}`);
    }

    return jsonResponse(
      {
        refund_id: refundRecord.id,
        payment_id: body.payment_id,
        amount: refundAmount,
        status: refundResult.status || "succeeded",
        created_at: refundRecord.created_at,
      },
      201,
    );
  } catch (err) {
    console.error("[PesaSwap] Refund error:", err);
    return jsonResponse({ error: { message: "Failed to process refund" } }, 500);
  }
}

// --- Customer Payment Methods ---

function handleGetCustomerMethods(phone: string): Response {
  const customer = customerMethods.get(phone);
  if (!customer) {
    return jsonResponse({ has_saved: false, methods: [] });
  }

  return jsonResponse({
    has_saved: customer.methods.length > 0,
    methods: customer.methods,
    default_method: customer.default_method,
  });
}

// --- Webhook Handler ---

async function handleWebhook(
  request: Request,
  runtimeEnv: unknown,
): Promise<Response> {
  const env = getEnv(runtimeEnv);
  const rawBody = await request.text();
  const signature = request.headers.get("x-pesaswap-signature") || "";

  // Signature verification is MANDATORY (fail closed). Without it, a forged
  // `payment.succeeded` event would be broadcast to the merchant dashboard as a
  // real sale. Reject when the secret is unconfigured or the signature is bad.
  if (!env.PESASWAP_WEBHOOK_SECRET) {
    console.error("[PesaSwap] Webhook secret not configured; rejecting webhook");
    return jsonResponse({ error: { message: "Webhook not configured" } }, 503);
  }
  const isValid = await verifyWebhookSignature(
    rawBody,
    signature,
    env.PESASWAP_WEBHOOK_SECRET,
  );
  if (!isValid) {
    console.warn("[PesaSwap] Invalid webhook signature");
    return jsonResponse({ error: { message: "Invalid signature" } }, 401);
  }

  const event = JSON.parse(rawBody) as {
    type: string;
    data: {
      payment_id?: string;
      id?: string;
      status?: string;
      amount?: number;
      metadata?: Record<string, unknown>;
    };
  };

  console.info(`[PesaSwap] Webhook: ${event.type}`, event.data?.payment_id || event.data?.id);

  switch (event.type) {
    case "payment_intent.succeeded":
    case "payment.succeeded": {
      const paymentId = event.data.payment_id || event.data.id || "";
      const payment = payments.get(paymentId);
      if (payment) {
        payment.status = "succeeded";
      }

      // Award loyalty points
      const metadata = payment?.metadata || event.data.metadata || {};
      const amount = payment?.amount || event.data.amount || 0;
      const pointsEarned = Math.floor(amount / 1000); // 1 point per KES 10 (in minor units)
      console.info(`[Loyalty] Awarding ${pointsEarned} points to ${metadata.customer_phone}`);

      // Save customer payment method for future one-tap
      if (metadata.customer_phone) {
        const phone = metadata.customer_phone as string;
        if (!customerMethods.has(phone)) {
          customerMethods.set(phone, {
            customer_id: `cust_${phone}`,
            methods: [{ id: `pm_mpesa_${phone}`, type: "mpesa", label: `M-Pesa ${phone.slice(-4)}` }],
            default_method: `pm_mpesa_${phone}`,
          });
        }
      }

      // Broadcast to merchant
      const merchantId = (metadata.merchant_id as string) || "";
      broadcastToMerchant(merchantId, {
        type: "payment.succeeded",
        data: {
          payment_id: paymentId,
          amount,
          currency: payment?.currency || "KES",
          table_number: metadata.table_number as number | undefined,
          customer_phone: (metadata.customer_phone as string) || "",
          customer_name: (metadata.customer_name as string) || undefined,
          tip_amount: (metadata.tip_amount as number) || 0,
          server_name: (metadata.server_name as string) || undefined,
          split_info: metadata.split_type
            ? `${metadata.split_type} (${metadata.split_index}/${metadata.split_of})`
            : undefined,
          items: (metadata.items as string) || undefined,
          timestamp: new Date().toISOString(),
        },
      });
      break;
    }

    case "payment_intent.payment_failed":
    case "payment.failed": {
      const paymentId = event.data.payment_id || event.data.id || "";
      const payment = payments.get(paymentId);
      if (payment) {
        payment.status = "failed";
      }

      const metadata = payment?.metadata || {};
      const merchantId = (metadata.merchant_id as string) || "";
      broadcastToMerchant(merchantId, {
        type: "payment.failed",
        data: {
          payment_id: paymentId,
          amount: payment?.amount || 0,
          currency: payment?.currency || "KES",
          table_number: metadata.table_number as number | undefined,
          customer_phone: (metadata.customer_phone as string) || "",
          timestamp: new Date().toISOString(),
        },
      });
      break;
    }
  }

  return jsonResponse({ received: true });
}

// --- WebSocket Real-Time ---

function handleRealtimeUpgrade(request: Request, url: URL): Response {
  const merchantId = url.searchParams.get("merchant") || "";

  // Check for WebSocket upgrade
  const upgradeHeader = request.headers.get("Upgrade") || "";
  if (upgradeHeader.toLowerCase() !== "websocket") {
    return jsonResponse({ error: { message: "Expected WebSocket upgrade" } }, 426);
  }

  // Create WebSocket pair (Cloudflare Workers API)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const WSPair = (globalThis as any).WebSocketPair;
  if (!WSPair) {
    return jsonResponse({ error: { message: "WebSocket not supported in this runtime" } }, 501);
  }
  const pair = new WSPair();
  const [client, server] = [pair[0], pair[1]];

  // Accept the WebSocket
  server.accept();

  // Register connection
  if (!merchantConnections.has(merchantId)) {
    merchantConnections.set(merchantId, new Set());
  }
  merchantConnections.get(merchantId)!.add(server);

  server.addEventListener("close", () => {
    merchantConnections.get(merchantId)?.delete(server);
    if (merchantConnections.get(merchantId)?.size === 0) {
      merchantConnections.delete(merchantId);
    }
  });

  // Send welcome
  server.send(JSON.stringify({ type: "connected", merchant: merchantId }));

  return new Response(null, {
    status: 101,
    webSocket: client,
  } as ResponseInit);
}

// --- Polling Notifications ---

// Store recent events for polling clients
const recentEvents = new Map<string, Array<{ event: unknown; timestamp: string }>>();

function handleNotifications(url: URL): Response {
  const merchantId = url.searchParams.get("merchant") || "";
  const since = url.searchParams.get("since") || "";

  const events = recentEvents.get(merchantId) || [];
  const filtered = since ? events.filter((e) => e.timestamp > since) : events;

  return jsonResponse(filtered.map((e) => e.event));
}

// --- Broadcast helper ---

function broadcastToMerchant(merchantId: string, event: unknown): void {
  const connections = merchantConnections.get(merchantId);
  const serialized = JSON.stringify(event);

  if (connections) {
    connections.forEach((ws) => {
      try {
        ws.send(serialized);
      } catch {
        connections.delete(ws);
      }
    });
  }

  // Also store for polling fallback
  if (!recentEvents.has(merchantId)) {
    recentEvents.set(merchantId, []);
  }
  const events = recentEvents.get(merchantId)!;
  events.push({ event, timestamp: new Date().toISOString() });

  // Keep only last 100 events per merchant
  if (events.length > 100) {
    events.splice(0, events.length - 100);
  }
}

// --- Webhook Signature Verification ---

async function verifyWebhookSignature(payload: string, signature: string, secret: string): Promise<boolean> {
  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
      "sign",
    ]);
    const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
    const expected = Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    // Constant-time comparison
    if (expected.length !== signature.length) return false;
    let mismatch = 0;
    for (let i = 0; i < expected.length; i++) {
      mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
    }
    return mismatch === 0;
  } catch {
    return false;
  }
}

// --- Utilities ---

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function withCors(response: Response, corsHeaders: Record<string, string>): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders)) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// --- Cleanup stale idempotency cache every 10 minutes ---
// Started lazily from within a request handler because Cloudflare Workers
// disallow timers (setInterval/setTimeout) in global (module top-level) scope.

let idempotencyCleanupStarted = false;

function ensureIdempotencyCleanup(): void {
  if (idempotencyCleanupStarted || typeof setInterval === "undefined") return;
  idempotencyCleanupStarted = true;
  setInterval(() => {
    const now = Date.now();
    idempotencyCache.forEach((value, key) => {
      if (value.expires < now) idempotencyCache.delete(key);
    });
  }, 600000);
}
