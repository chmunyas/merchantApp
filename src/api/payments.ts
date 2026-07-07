/**
 * PesaSwap Server API Routes
 * Handles payment creation, status checks, refunds, and webhooks.
 * Designed for Cloudflare Workers (fetch-based, no Node.js dependencies).
 */

// --- Environment Config ---

import { getSql } from "@/lib/db";
import { requireAuth } from "@/api/auth";
import { roleAtLeast } from "@/lib/rbac";
import { venueFromPayload } from "@/lib/tenancy";
import {
  postCogsEntry,
  postPaymentEntry,
  postRefundEntry,
} from "@/lib/accounting";
import { recordPayment as recordInvoicePayment } from "@/lib/invoicing";
import { loyaltyPointsFor } from "@/lib/loyalty";
import { resolveInitiator } from "@/lib/tx-initiator";

type Env = {
  PESASWAP_API_KEY: string;
  PESASWAP_WEBHOOK_SECRET: string;
  PESASWAP_URL: string; // https://sandbox.Pesaswap.io or https://api.Pesaswap.io
  PESASWAP_PROFILE_ID: string; // business profile id (required by /payments)
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
    PESASWAP_PROFILE_ID: pick("PESASWAP_PROFILE_ID"),
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
  // Saved-method lifecycle (PesaSwap/Hyperswitch). Tokenise the card/wallet used in
  // this payment for future reuse; the SDK sends `customer_acceptance` in confirm.
  setup_future_usage?: "on_session" | "off_session";
  // Charge a previously saved token off-session (MIT); pair with recurring_details.
  off_session?: boolean;
  recurring_details?: { type: string; data: string };
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
        provider_ref = COALESCE(EXCLUDED.provider_ref, payments.provider_ref),
        amount = CASE
          WHEN EXCLUDED.status IN ('succeeded', 'paid', 'captured')
          THEN EXCLUDED.amount ELSE payments.amount END,
        metadata = EXCLUDED.metadata,
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
    const points = loyaltyPointsFor(Number(rec.amount));
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
    // Remember the M-Pesa number as a saved method (DB-backed, phone-keyed) so a
    // returning guest can retrieve their method by phone. Best-effort.
    try {
      const last4 = loyaltyPhone.slice(-4);
      await sql`
        INSERT INTO customer_payment_methods (venue_id, phone, kind, label)
        VALUES (${rec.venue ?? null}, ${loyaltyPhone}, 'mpesa', ${"M-Pesa •••" + last4})
        ON CONFLICT (phone, COALESCE(provider_ref, kind))
        DO UPDATE SET last_used_at = now(), venue_id = EXCLUDED.venue_id`;
    } catch {
      /* best-effort saved method */
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
      // Settle only once cumulative succeeded payments cover the order total, so a
      // partial (split) payment never prematurely closes a shared bill.
      const [row] = await sql`
        SELECT o.total::bigint AS total,
               COALESCE((SELECT sum(p.amount - COALESCE(p.tip_amount, 0)) FROM payments p
                         WHERE p.metadata->>'order_id' = ${paidOrderId}
                           AND p.status IN ('succeeded', 'paid', 'captured')
                           AND p.kind <> 'refund'), 0)::bigint AS paid
        FROM orders o WHERE o.id = ${paidOrderId} LIMIT 1`;
      if (row && Number(row.paid) >= Number(row.total)) {
        await sql`UPDATE orders SET paid_at = COALESCE(paid_at, now()) WHERE id = ${paidOrderId}`;
      }
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

  // DB-backed payments ledger (gated manager+): every real transaction attempt,
  // any status, so the merchant dashboard shows live sales — not just localStorage.
  if (path === "/api/payments/list" && request.method === "GET") {
    return withCors(await handleListPayments(request, env), corsHeaders);
  }

  // Capture a previously authorised (manual-capture / pre-auth hold) payment.
  if (
    path.match(/^\/api\/payments\/[^/]+\/capture$/) &&
    request.method === "POST"
  ) {
    const paymentId = path.split("/")[3];
    return withCors(await handleCapture(paymentId, request, env), corsHeaders);
  }

  // Re-request payment: re-fire a fresh STK for a prior (failed/processing) payment
  // using its stored phone + amount. Lets a merchant re-send the M-Pesa prompt.
  if (
    path.match(/^\/api\/payments\/[^/]+\/retry$/) &&
    request.method === "POST"
  ) {
    const paymentId = path.split("/")[3];
    return withCors(await handleRetryPayment(paymentId, request, env), corsHeaders);
  }

  if (path.match(/^\/api\/payments\/[^/]+\/status$/) && request.method === "GET") {
    const paymentId = path.split("/")[3];
    return withCors(await handleGetPaymentStatus(paymentId, env), corsHeaders);
  }

  // --- Refund Routes ---
  if (path === "/api/refunds" && request.method === "POST") {
    return withCors(await handleRefund(request, env), corsHeaders);
  }

  // --- Customer Payment Methods ---
  if (path === "/api/customers/payment-methods" && request.method === "GET") {
    const phone = url.searchParams.get("phone") || "";
    return withCors(await handleGetCustomerMethods(phone, env), corsHeaders);
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

  // Single-venue default: attribute a payment to "main" when the pay source didn't
  // carry a venue (e.g. a Tap&Go QR / link), so it is visible in the merchant
  // dashboard, which filters by venue. QR-order and invoice flows already set their
  // own venue and are left untouched. Mirrors venueFromPayload's "main" default.
  {
    const bmeta = (body.metadata ?? {}) as Record<string, unknown>;
    if (typeof bmeta.venue !== "string" || !bmeta.venue) {
      bmeta.venue = "main";
    }
    if (typeof bmeta.merchant_id !== "string" || !bmeta.merchant_id) {
      bmeta.merchant_id = bmeta.venue;
    }
    body.metadata = bmeta;
  }

  const env = getEnv(workerEnv);

  // Split-pay guard: when charging against a shared order, never let a guest pay
  // more than the outstanding balance (server-authoritative). Clamp the share to the
  // remaining balance and reject if the bill is already settled.
  const guardMeta = (body.metadata ?? {}) as Record<string, unknown>;
  const guardOrderId =
    typeof guardMeta.order_id === "string" &&
    /^[0-9a-f-]{36}$/i.test(guardMeta.order_id)
      ? guardMeta.order_id
      : null;
  if (guardOrderId) {
    const guardSql = getSql(workerEnv);
    if (guardSql) {
      try {
        const [row] = await guardSql`
          SELECT o.total::bigint AS total,
                 COALESCE((SELECT sum(p.amount - COALESCE(p.tip_amount, 0)) FROM payments p
                           WHERE p.metadata->>'order_id' = ${guardOrderId}
                             AND p.status IN ('succeeded', 'paid', 'captured')
                             AND p.kind <> 'refund'), 0)::bigint AS paid
          FROM orders o WHERE o.id = ${guardOrderId} LIMIT 1`;
        if (row) {
          const remainingMinor = Math.max(
            0,
            Number(row.total) - Number(row.paid),
          );
          // A tip rides ON TOP of the bill: clamp only the ORDER portion to the
          // remaining balance, then re-add the tip. A guest can never overpay the
          // bill, but can still leave a tip (even on an already-settled bill).
          const tipMinor = Math.max(
            0,
            Math.round(Number(guardMeta.tip_amount) || 0),
          );
          const orderPortion = Math.max(0, body.amount - tipMinor);
          body.amount = Math.min(orderPortion, remainingMinor) + tipMinor;
          if (body.amount <= 0) {
            return jsonResponse(
              { error: { message: "This bill is already paid." } },
              409,
            );
          }
        }
      } catch {
        /* best-effort — fall through to a normal charge */
      }
    }
  }

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

  // --- Live server-side M-Pesa STK (Daraja / m_pesa_express) ---
  // Unlike cards, M-Pesa is confirmed entirely server-side: create + confirm =>
  // an STK push lands on the customer's handset. This needs only the api-key — no
  // publishable key / HyperLoader. The client then polls /status until the customer
  // approves on their phone. Verified shape: payment_method=wallet, type=
  // m_pesa_express, payment_method_data.wallet.m_pesa_express={}, customer+billing
  // phone required, amount in minor units.
  const liveMeta = (body.metadata ?? {}) as Record<string, unknown>;
  const mpesaPhone = normalizeKenyanPhone((liveMeta.customer_phone as string) || "");
  const wantsMpesa =
    (body.currency || "KES").toUpperCase() === "KES" &&
    !!mpesaPhone &&
    (!body.payment_method ||
      ["mpesa", "mobile_payment", "wallet", "m_pesa_express"].includes(
        body.payment_method,
      ));
  if (env.PESASWAP_PROFILE_ID && env.PESASWAP_API_KEY && mpesaPhone && wantsMpesa) {
    try {
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
          confirm: true,
          capture_method: "automatic",
          profile_id: env.PESASWAP_PROFILE_ID,
          payment_method: "wallet",
          payment_method_type: "m_pesa_express",
          payment_method_data: { wallet: { m_pesa_express: {} } },
          customer: {
            id: `cus_kp${mpesaPhone.number}`,
            phone: mpesaPhone.number,
            phone_country_code: mpesaPhone.country_code,
            name: (liveMeta.customer_name as string) || undefined,
          },
          billing: {
            phone: {
              number: mpesaPhone.number,
              country_code: mpesaPhone.country_code,
            },
            address: { country: "KE" },
          },
          description: body.description,
          metadata: body.metadata,
        }),
      });
      const intent = (await apiResponse.json()) as Record<string, any>;
      if (!apiResponse.ok || intent.error) {
        console.error("[PesaSwap] M-Pesa STK error:", JSON.stringify(intent.error));
        return jsonResponse(
          { error: intent.error || { message: "M-Pesa STK failed" } },
          apiResponse.status || 502,
        );
      }
      const paymentId = intent.payment_id || intent.id;
      const status = mapPesaSwapStatus(intent.status);
      payments.set(paymentId, {
        id: paymentId,
        amount: body.amount,
        currency: body.currency || "KES",
        status,
        metadata: liveMeta,
        created_at: new Date().toISOString(),
        refunds: [],
      });
      // Record the attempt in the durable ledger immediately (usually status=
      // "processing" while the customer approves the STK on their handset), so EVERY
      // attempt is visible to the merchant. The client poll / webhook later updates
      // it to succeeded/failed. recordLedger only fires loyalty + settlement on the
      // first transition to succeeded, so a processing/failed row is financially inert.
      try {
        await recordLedger(workerEnv, {
          id: paymentId,
          amount: body.amount,
          currency: body.currency || "KES",
          status,
          venue: (liveMeta.venue as string) || null,
          reference: (liveMeta.till as string) || null,
          providerRef: intent.connector_transaction_id ?? null,
          metadata: liveMeta,
        });
      } catch {
        /* best-effort ledger */
      }
      const responseBody = {
        payment_id: paymentId,
        client_secret: intent.client_secret ?? null,
        status,
        amount: body.amount,
        currency: body.currency || "KES",
        stk: true,
      };
      if (idempotencyKey) {
        idempotencyCache.set(idempotencyKey, {
          response: responseBody,
          expires: Date.now() + 3_600_000,
        });
      }
      return jsonResponse(responseBody, 201);
    } catch (err) {
      console.error("[PesaSwap] M-Pesa STK exception:", err);
      return jsonResponse({ error: { message: "M-Pesa STK failed" } }, 502);
    }
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
        // Save the card/wallet for future reuse when requested. Only meaningful with
        // a customer_id; the SDK collects consent (customer_acceptance) on confirm.
        ...(body.setup_future_usage
          ? { setup_future_usage: body.setup_future_usage }
          : {}),
        // Reuse a previously saved token off-session (MIT / one-tap).
        ...(body.off_session ? { off_session: true } : {}),
        ...(body.recurring_details
          ? { recurring_details: body.recurring_details }
          : {}),
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

// --- Re-request payment (retry) ---

// Re-fires a fresh M-Pesa STK for a prior payment (typically failed/cancelled) using
// its stored phone + amount + metadata, so a merchant can re-prompt the customer.
// Gated manager+. For a split (order_id in metadata) the create path re-clamps to
// the remaining balance, so a re-request can never overcharge a settled bill.
async function handleRetryPayment(
  paymentId: string,
  request: Request,
  workerEnv: unknown,
): Promise<Response> {
  const url = new URL(request.url);
  const payload = await requireAuth(request, workerEnv);
  if (!payload) return jsonResponse({ error: { message: "unauthorized" } }, 401);
  if (!roleAtLeast(payload, "manager")) {
    return jsonResponse({ error: { message: "forbidden" } }, 403);
  }
  const venue = venueFromPayload(payload, url);
  const sql = getSql(workerEnv);
  if (!sql) return jsonResponse({ error: { message: "database not configured" } }, 503);

  const [row] = await sql`
    SELECT amount, currency, status, metadata
    FROM payments
    WHERE id = ${paymentId} AND venue_id = ${venue}
    LIMIT 1`;
  if (!row) return jsonResponse({ error: { message: "payment not found" } }, 404);
  if (["succeeded", "paid", "captured"].includes(String(row.status))) {
    return jsonResponse(
      { error: { message: "payment already succeeded" } },
      409,
    );
  }
  const meta = (row.metadata ?? {}) as Record<string, unknown>;
  // Optional overrides from the merchant re-request modal: a new amount and/or a
  // corrected phone. Amount is in MINOR units (cents), matching the ledger.
  const overrides = (await request.json().catch(() => ({}))) as {
    amount?: number;
    phone?: string;
  };
  if (typeof overrides.phone === "string" && overrides.phone.trim()) {
    meta.customer_phone = overrides.phone.trim();
  }
  if (!meta.customer_phone) {
    return jsonResponse(
      { error: { message: "no customer phone on file to re-request" } },
      400,
    );
  }
  const amount =
    typeof overrides.amount === "number" && overrides.amount > 0
      ? Math.round(overrides.amount)
      : Number(row.amount) || 0;
  if (amount <= 0) {
    return jsonResponse({ error: { message: "amount must be positive" } }, 400);
  }

  // Reuse the full create path (venue default + STK + ledger recording) by replaying
  // the original parameters (with any overrides) as a fresh create request.
  const replay = new Request("https://internal/api/payments/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      amount,
      currency: String(row.currency ?? "KES"),
      description: `Re-request of ${paymentId}`,
      metadata: meta,
    }),
  });
  return handleCreatePayment(replay, workerEnv);
}

// --- DB-backed payments ledger (merchant view) ---
// Lists real payment attempts from the durable ledger (any status) so the merchant
// dashboard reflects live sales, refunds and failed/cancelled attempts — matching
// the PesaSwap dashboard. Gated manager+ (exposes customer PII + revenue).
async function handleListPayments(
  request: Request,
  workerEnv: unknown,
): Promise<Response> {
  const url = new URL(request.url);
  const payload = await requireAuth(request, workerEnv);
  if (!payload) return jsonResponse({ error: { message: "unauthorized" } }, 401);
  if (!roleAtLeast(payload, "manager")) {
    return jsonResponse({ error: { message: "forbidden" } }, 403);
  }
  const venue = venueFromPayload(payload, url);
  const sql = getSql(workerEnv);
  if (!sql) return jsonResponse({ error: { message: "database not configured" } }, 503);

  const limit = Math.min(
    200,
    Math.max(1, Number(url.searchParams.get("limit")) || 50),
  );
  const statusFilter = (url.searchParams.get("status") || "").trim();

  try {
    const rows = statusFilter
      ? await sql`
          SELECT id, amount, currency, status, kind, reference, provider_ref,
                 tip_amount, staff_id, initiator, metadata, created_at
          FROM payments
          WHERE venue_id = ${venue} AND status = ${statusFilter}
          ORDER BY created_at DESC
          LIMIT ${limit}`
      : await sql`
          SELECT id, amount, currency, status, kind, reference, provider_ref,
                 tip_amount, staff_id, initiator, metadata, created_at
          FROM payments
          WHERE venue_id = ${venue}
          ORDER BY created_at DESC
          LIMIT ${limit}`;

    // Capture all: reconcile any still-"processing" live payments against PesaSwap
    // so the ledger reflects the terminal state even if the customer closed the tab
    // before the client finished polling. Bounded (only pay_ ids older than 45s,
    // capped) so the list stays fast; recordLedger is idempotent.
    const env = getEnv(workerEnv);
    if (env.PESASWAP_API_KEY) {
      const stale = rows
        .filter(
          (r) =>
            String(r.status) === "processing" &&
            String(r.id).startsWith("pay_") &&
            Date.now() - new Date(r.created_at as string).getTime() > 45_000,
        )
        .slice(0, 10);
      if (stale.length) {
        await Promise.all(
          stale.map(async (r) => {
            try {
              const resp = await fetch(`${env.PESASWAP_URL}/payments/${r.id}`, {
                headers: {
                  "api-key": env.PESASWAP_API_KEY,
                  Accept: "application/json",
                },
              });
              if (!resp.ok) return;
              const p = (await resp.json()) as Record<string, any>;
              const mapped = mapPesaSwapStatus(p.status);
              if (mapped === "processing") return;
              const meta = (p.metadata ?? {}) as Record<string, unknown>;
              const settled = settledAmount(p, mapped) || Number(r.amount) || 0;
              await recordLedger(workerEnv, {
                id: String(r.id),
                amount: settled,
                currency: (p.currency as string) || String(r.currency ?? "KES"),
                status: mapped === "cancelled" ? "failed" : mapped,
                venue:
                  (meta.venue as string) || (meta.merchant_id as string) || venue,
                reference: (meta.till as string) || null,
                providerRef: (p.connector_transaction_id as string) || null,
                metadata:
                  mapped === "succeeded"
                    ? meta
                    : {
                        ...meta,
                        error_code: p.error_code ?? undefined,
                        error_message: p.error_message ?? undefined,
                      },
              });
              // Reflect the reconciled state in this response without a re-query.
              (r as Record<string, unknown>).status =
                mapped === "cancelled" ? "failed" : mapped;
              (r as Record<string, unknown>).amount = settled;
              if (p.connector_transaction_id) {
                (r as Record<string, unknown>).provider_ref =
                  p.connector_transaction_id;
              }
            } catch {
              /* best-effort reconcile */
            }
          }),
        );
      }
    }

    return jsonResponse({
      payments: rows.map((r) => {
        const meta = (r.metadata ?? {}) as Record<string, unknown>;
        return {
          id: String(r.id),
          amount: Number(r.amount) || 0, // minor units
          currency: String(r.currency ?? "KES"),
          status: String(r.status),
          kind: String(r.kind ?? "payment"),
          reference: r.reference ? String(r.reference) : null,
          providerRef: r.provider_ref ? String(r.provider_ref) : null,
          tipAmount: Number(r.tip_amount) || 0,
          initiator: r.initiator ? String(r.initiator) : "human",
          customerPhone: (meta.customer_phone as string) || null,
          customerName: (meta.customer_name as string) || null,
          flowType: (meta.flow_type as string) || null,
          errorMessage: (meta.error_message as string) || null,
          createdAt: r.created_at,
        };
      }),
      total: rows.length,
    });
  } catch (err) {
    console.error("[PesaSwap] List payments error:", err);
    return jsonResponse({ error: { message: "Failed to list payments" } }, 500);
  }
}

// --- Get Payment Status ---

async function handleGetPaymentStatus(
  paymentId: string,
  workerEnv: unknown,
): Promise<Response> {
  const env = getEnv(workerEnv);
  // Live payments (real provider ids, api-key present): query PesaSwap for the
  // authoritative status. STK payments confirm asynchronously on the handset, so
  // this poll is how the app learns the outcome. On first success we record the
  // ledger here (idempotent) so loyalty + order settlement run even without a
  // webhook. Simulated `test_` payments stay in the in-memory map below.
  if (env.PESASWAP_API_KEY && !paymentId.startsWith("test_")) {
    try {
      const resp = await fetch(`${env.PESASWAP_URL}/payments/${paymentId}`, {
        headers: { "api-key": env.PESASWAP_API_KEY, Accept: "application/json" },
      });
      if (resp.ok) {
        const p = (await resp.json()) as Record<string, any>;
        const status = mapPesaSwapStatus(p.status);
        const meta = (p.metadata ?? {}) as Record<string, unknown>;
        // Record the terminal outcome (succeeded OR failed/cancelled) to the durable
        // ledger so the merchant sees every attempt with its decline reason. On first
        // success recordLedger also fires loyalty + order settlement (idempotent).
        if (status === "succeeded" || status === "failed" || status === "cancelled") {
          try {
            await recordLedger(workerEnv, {
              id: paymentId,
              amount: settledAmount(p, status),
              currency: (p.currency as string) || "KES",
              status: status === "cancelled" ? "failed" : status,
              venue:
                (meta.venue as string) || (meta.merchant_id as string) || null,
              reference: (meta.till as string) || null,
              providerRef: (p.connector_transaction_id as string) || null,
              metadata:
                status === "succeeded"
                  ? meta
                  : {
                      ...meta,
                      error_code: p.error_code ?? undefined,
                      error_message: p.error_message ?? undefined,
                    },
            });
          } catch {
            /* best-effort ledger */
          }
        }
        const cached = payments.get(paymentId);
        if (cached) cached.status = status;
        return jsonResponse({
          payment_id: paymentId,
          status,
          amount: p.amount,
          currency: p.currency,
          metadata: meta,
          error_message: p.error_message ?? undefined,
        });
      }
    } catch {
      /* fall through to the in-memory record */
    }
  }

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

async function handleGetCustomerMethods(
  phone: string,
  env: unknown,
): Promise<Response> {
  const cleaned = phone.trim();
  if (cleaned) {
    const sql = getSql(env);
    if (sql) {
      try {
        const rows = await sql`
          SELECT kind, label, brand, last4 FROM customer_payment_methods
          WHERE phone = ${cleaned}
          ORDER BY is_default DESC, last_used_at DESC
          LIMIT 5`;
        if (rows.length > 0) {
          return jsonResponse({
            // has_saved stays false: M-Pesa STK is not a stored one-tap token, so
            // the pay flow keeps prompting the number. `methods` is for display.
            has_saved: false,
            known: true,
            methods: rows.map((r) => ({
              kind: String(r.kind),
              label: String(r.label ?? ""),
              brand: r.brand ? String(r.brand) : null,
              last4: r.last4 ? String(r.last4) : null,
            })),
            default_method: String(rows[0].kind),
          });
        }
      } catch {
        /* fall through to the in-memory / empty response */
      }
    }
  }
  const customer = customerMethods.get(cleaned);
  if (!customer) {
    return jsonResponse({ has_saved: false, known: false, methods: [] });
  }
  return jsonResponse({
    has_saved: customer.methods.length > 0,
    known: customer.methods.length > 0,
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
  // A malformed body or an internal error must still be ACKNOWLEDGED (200) — a
  // webhook that returns non-2xx triggers PesaSwap's "CallToMerchantFailed" + 24h of
  // retries. We reconcile any missed event via the status-poll + list reconcile, so
  // acknowledging is safe. Only a real bad-signature (secret configured) returns 401.
  try {
    return await processWebhook(request, env, runtimeEnv, rawBody);
  } catch (err) {
    console.error("[PesaSwap] Webhook processing error (acknowledged):", err);
    return jsonResponse({ received: true, error: "processing_error" });
  }
}

async function processWebhook(
  request: Request,
  env: Env,
  runtimeEnv: unknown,
  rawBody: string,
): Promise<Response> {
  // PesaSwap sends the payment object in one of two shapes:
  //  - wrapped envelope: { event_type, event_id, content: { object } }
  //  - the payment object at the TOP LEVEL (payment_id + status at the root) ← live
  // Our own simulator uses { type, data }. Accept ALL of them.
  const body = JSON.parse(rawBody) as Record<string, any>;
  const eventType: string = body.event_type || body.type || "";
  let resource: Record<string, any> =
    body.content?.object ||
    body.content ||
    body.data ||
    (body.payment_id || body.status ? body : {});
  const paymentId: string =
    resource.payment_id || resource.id || body.payment_id || "";

  // --- Establish trust BEFORE acting on the webhook ---
  // A forged `payment_succeeded` must never be recorded as a real sale. We accept a
  // webhook as trusted via EITHER:
  //  (1) a valid HMAC signature (x-webhook-signature-512 / -256) when a shared secret
  //      (PESASWAP_WEBHOOK_SECRET = the profile `payments_response_hash_key`) is set; OR
  //  (2) verify-by-callback: with no shared secret, re-fetch the payment from PesaSwap
  //      with our api-key and act on THAT authoritative record — a forger cannot fake
  //      it. This keeps the webhook working securely without a shared secret.
  // If neither is possible we acknowledge (200) so PesaSwap stops retrying, but never
  // perform any state-changing side effect.
  const sig512 = request.headers.get("x-webhook-signature-512") || "";
  const sig256 =
    request.headers.get("x-webhook-signature-256") ||
    request.headers.get("x-pesaswap-signature") ||
    "";
  let trusted = false;
  if (env.PESASWAP_WEBHOOK_SECRET) {
    const isValid = sig512
      ? await verifyWebhookSignature(rawBody, sig512, env.PESASWAP_WEBHOOK_SECRET, "SHA-512")
      : sig256
        ? await verifyWebhookSignature(rawBody, sig256, env.PESASWAP_WEBHOOK_SECRET, "SHA-256")
        : false;
    if (!isValid) {
      console.warn("[PesaSwap] Invalid or missing webhook signature");
      return jsonResponse({ error: { message: "Invalid signature" } }, 401);
    }
    trusted = true;
  } else if (env.PESASWAP_API_KEY && paymentId && !paymentId.startsWith("test_")) {
    // Re-fetch the authoritative record — but with a hard timeout so a slow provider
    // can never make US slow enough to trip PesaSwap's webhook-delivery timeout.
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 4000);
      const resp = await fetch(`${env.PESASWAP_URL}/payments/${paymentId}`, {
        headers: { "api-key": env.PESASWAP_API_KEY, Accept: "application/json" },
        signal: ac.signal,
      });
      clearTimeout(timer);
      if (resp.ok) {
        resource = (await resp.json()) as Record<string, any>;
        trusted = true;
      }
    } catch {
      /* timeout / network error → acknowledge below, reconcile via polling */
    }
  }

  console.info(
    `[PesaSwap] Webhook: ${eventType || resource.status} ${paymentId}${trusted ? "" : " (unverified)"}`,
  );

  if (!trusted) {
    // Cannot verify — acknowledge so PesaSwap stops retrying (avoids the dashboard
    // "Delivery Failed" / CallToMerchantFailed), but never act on unverified data.
    return jsonResponse({ received: true, verified: false });
  }

  // Effective status: prefer the authoritative record's status (verify-by-callback
  // yields the real terminal state), else infer from the event name.
  const mappedStatus = resource.status ? mapPesaSwapStatus(resource.status) : "";
  const isSuccess =
    mappedStatus === "succeeded" ||
    eventType === "payment_succeeded" ||
    eventType === "payment_captured" ||
    eventType === "payment.succeeded" ||
    eventType === "payment_intent.succeeded";
  const isFailure =
    !isSuccess &&
    (mappedStatus === "failed" ||
      mappedStatus === "cancelled" ||
      eventType === "payment_failed" ||
      eventType === "payment_cancelled" ||
      eventType === "payment.failed" ||
      eventType === "payment_intent.payment_failed");

  if (isSuccess) {
      const payment = payments.get(paymentId);
      if (payment) {
        payment.status = "succeeded";
      }

      // Award loyalty points. Capture what ACTUALLY settled (amount_received) for a
      // succeeded payment — M-Pesa rounds decimals to whole shillings — falling back
      // to the in-memory/requested amount when the webhook payload lacks it.
      const metadata = (payment?.metadata || resource.metadata || {}) as Record<string, unknown>;
      const amount =
        settledAmount(resource, "succeeded") || payment?.amount || 0;
      const venue =
        (metadata.venue as string) || (metadata.merchant_id as string) || null;

      // Live payments confirm via the webhook (not the Create call), so persist to
      // the durable ledger here. recordLedger is idempotent on the payment id and
      // fires loyalty accrual + the M-Pesa saved-method upsert on first success.
      try {
        await recordLedger(runtimeEnv, {
          id: paymentId,
          amount: Number(amount) || 0,
          currency:
            (payment?.currency as string) ||
            (resource.currency as string) ||
            "KES",
          status: "succeeded",
          venue,
          reference: (metadata.till as string) || null,
          providerRef: (resource.connector_transaction_id as string) || null,
          metadata,
        });
      } catch {
        /* best-effort — the broadcast below still fires */
      }

      // Persist a tokenised card / wallet (Apple Pay / Google Pay) as a saved method
      // (SAQ-A: only the token + brand/last4 for display, never a PAN). Handles both
      // our simulator shape and the live Hyperswitch payment-method shape.
      const saved = extractSavedMethod(resource);
      const pmPhone = (metadata.customer_phone as string) || "";
      if (saved && pmPhone) {
        try {
          const sql = getSql(runtimeEnv);
          if (sql) {
            const brand = saved.brand;
            const last4 = saved.last4;
            const kind = saved.kind;
            const label = last4 ? `${brand} •••${last4}` : brand;
            await sql`
              INSERT INTO customer_payment_methods
                (venue_id, phone, kind, label, provider_ref, brand, last4)
              VALUES (${venue}, ${pmPhone}, ${kind}, ${label}, ${saved.id}, ${brand}, ${last4})
              ON CONFLICT (phone, COALESCE(provider_ref, kind))
              DO UPDATE SET last_used_at = now(), label = EXCLUDED.label,
                            brand = EXCLUDED.brand, last4 = EXCLUDED.last4`;
          }
        } catch {
          /* best-effort saved card */
        }
      }

      // Broadcast to merchant
      const merchantId = (metadata.merchant_id as string) || "";
      broadcastToMerchant(merchantId, {
        type: "payment.succeeded",
        data: {
          payment_id: paymentId,
          amount,
          currency: (payment?.currency as string) || (resource.currency as string) || "KES",
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
  } else if (isFailure) {
      const payment = payments.get(paymentId);
      if (payment) {
        payment.status = "failed";
      }

      const metadata = (payment?.metadata || resource.metadata || {}) as Record<string, unknown>;
      const venue =
        (metadata.venue as string) || (metadata.merchant_id as string) || null;
      // Persist the failed attempt to the durable ledger so the merchant sees every
      // transaction (matching the PesaSwap dashboard), with the decline reason.
      try {
        await recordLedger(runtimeEnv, {
          id: paymentId,
          amount: Number(payment?.amount || resource.amount || 0),
          currency:
            (payment?.currency as string) || (resource.currency as string) || "KES",
          status: "failed",
          venue,
          reference: (metadata.till as string) || null,
          providerRef: (resource.connector_transaction_id as string) || null,
          metadata: {
            ...metadata,
            error_code: resource.error_code ?? undefined,
            error_message: resource.error_message ?? undefined,
          },
        });
      } catch {
        /* best-effort */
      }

      const merchantId = (metadata.merchant_id as string) || "";
      broadcastToMerchant(merchantId, {
        type: "payment.failed",
        data: {
          payment_id: paymentId,
          amount: payment?.amount || resource.amount || 0,
          currency: (payment?.currency as string) || (resource.currency as string) || "KES",
          table_number: metadata.table_number as number | undefined,
          customer_phone: (metadata.customer_phone as string) || "",
          timestamp: new Date().toISOString(),
        },
      });
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

async function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string,
  hash: "SHA-256" | "SHA-512" = "SHA-256",
): Promise<boolean> {
  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash }, false, [
      "sign",
    ]);
    const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
    const expected = Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    // Constant-time comparison (case-insensitive hex)
    const provided = signature.toLowerCase();
    if (expected.length !== provided.length) return false;
    let mismatch = 0;
    for (let i = 0; i < expected.length; i++) {
      mismatch |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
    }
    return mismatch === 0;
  } catch {
    return false;
  }
}

// Normalise a saved (tokenised) card/wallet from a webhook resource. Supports both
// our simulator shape ({ payment_method: { id, type, card, wallet } }) and the live
// Hyperswitch shape ({ payment_method: "card", payment_method_id, payment_method_data,
// payment_method_type }). Returns null for M-Pesa/bank or un-tokenised payments —
// only methods the customer chose to save (setup_future_usage) carry a token id.
function extractSavedMethod(resource: Record<string, any>): {
  id: string;
  kind: "card" | "wallet";
  brand: string;
  last4: string | null;
} | null {
  const pm = resource.payment_method;
  if (pm && typeof pm === "object") {
    if (!pm.id || !pm.type || pm.type === "mpesa") return null;
    const kind = pm.type === "card" ? "card" : "wallet";
    const brand = pm.card?.brand ?? pm.wallet?.type ?? pm.type;
    return { id: String(pm.id), kind, brand: String(brand), last4: pm.card?.last4 ?? null };
  }
  if (typeof pm === "string") {
    const id = resource.payment_method_id;
    if (!id) return null;
    const card = resource.payment_method_data?.card;
    if (pm === "card") {
      return {
        id: String(id),
        kind: "card",
        brand: String(card?.card_network ?? card?.brand ?? "card"),
        last4: card?.last4 ?? card?.last_four_digits ?? null,
      };
    }
    if (pm === "wallet") {
      return {
        id: String(id),
        kind: "wallet",
        brand: String(resource.payment_method_type ?? "wallet"),
        last4: null,
      };
    }
  }
  return null;
}

// --- Utilities ---

// Normalise a Kenyan MSISDN to the PesaSwap/Daraja shape: a 9-digit subscriber
// number (no leading 0, no country code) + a "+254" country code. Returns null if
// the input isn't a plausible Kenyan mobile number.
function normalizeKenyanPhone(
  phone: string,
): { number: string; country_code: string } | null {
  const digits = (phone || "").replace(/\D/g, "");
  let local = "";
  if (digits.startsWith("254")) local = digits.slice(3);
  else if (digits.startsWith("0")) local = digits.slice(1);
  else local = digits;
  // Kenyan mobile numbers are 9 digits starting 7 or 1 (e.g. 7XXXXXXXX / 1XXXXXXXX).
  if (!/^[71]\d{8}$/.test(local)) return null;
  return { number: local, country_code: "+254" };
}

// Map a PesaSwap (Hyperswitch) payment status to the app's PaymentStatus vocabulary.
function mapPesaSwapStatus(status: unknown): string {
  switch (String(status)) {
    case "succeeded":
    case "partially_captured":
    case "partially_captured_and_capturable":
      return "succeeded";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "requires_capture":
      return "requires_capture";
    default:
      // requires_customer_action / processing / requires_confirmation / etc.
      return "processing";
  }
}

// The amount to CAPTURE for a succeeded payment = what actually settled
// (`amount_received`), NOT the requested `amount`. M-Pesa/Daraja only moves whole
// shillings, so a decimal request (e.g. KES 1.01 = 101) settles as KES 1.00 (100);
// recording amount_received keeps the ledger, loyalty and settlement exact. For a
// non-succeeded payment there is nothing received, so we keep the requested amount
// (what was attempted) for visibility.
export function settledAmount(p: Record<string, any>, mappedStatus: string): number {
  const requested = Number(p.amount) || 0;
  if (mappedStatus !== "succeeded") return requested;
  const received = Number(p.amount_received);
  return received > 0 ? received : requested;
}

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
