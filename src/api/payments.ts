/**
 * PesaSwap Server API Routes
 * Handles payment creation, status checks, refunds, and webhooks.
 * Designed for Cloudflare Workers (fetch-based, no Node.js dependencies).
 */

// --- Environment Config ---

import { getSql } from "@/lib/db";
import { partnerIdForVenue } from "@/lib/commission";
import { requireAuth } from "@/api/auth";
import { roleAtLeast } from "@/lib/rbac";
import { venueFromPayload } from "@/lib/tenancy";
import { isDisputeEvent, mapDisputeStatus } from "@/lib/disputes";
import { computeFee, methodFromMetadata } from "@/lib/fees";
import { captureException } from "@/lib/observability";
import { resolveInitiator } from "@/lib/tx-initiator";
import { holdOrderShare, releaseOrderItemClaims, releaseOrderShare } from "@/lib/split-lock";
import {
  billTopic,
  publishToTopic,
  type BillEvent,
} from "@/lib/realtime-bus";
import { tokenHasScope } from "@/lib/api-tokens";
import {
  createPaymentIntent,
  hashPaymentIntentToken,
} from "@/lib/payment-intents";
import {
  DEFAULT_CURRENCY,
  normalizeCurrency,
} from "@/lib/currency";
import { isProductionRuntime } from "@/lib/runtime-security";
import {
  PAYMENT_CONSUMERS,
  REFUND_CONSUMERS,
  enqueueFinancialEvent,
} from "@/lib/financial-events";
import { processFinancialOutbox } from "@/lib/financial-consumers";
import { envVar } from "@/lib/env";
import { verifyToken } from "@/lib/webhook-verify";
import { sha256Hex } from "@/lib/hash";
import { processInvoiceCommunications } from "@/lib/invoicing";
import { reconcileTipPayouts } from "@/api/tips";
import {
  deliverStaffNotifications,
  type StaffNotifyInput,
} from "@/lib/staff-notify";
import { classifyPaymentFailure } from "@/lib/staff-notifications";
import {
  canonicalKenyanPhone,
  mapPesaSwapStatus,
  normalizeKenyanPhone,
  settledAmount,
} from "@/lib/payment-status";
export { settledAmount } from "@/lib/payment-status";
import {
  rememberPaymentIdempotency as rememberIdempotent,
  reservePaymentIdempotency as idempotentGuard,
} from "@/lib/payment-idempotency";

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
  payment_intent_token?: string;
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

// --- In-memory stores ---

// WebSocket connections for real-time notifications
const merchantConnections = new Map<string, Set<WebSocket>>();

/**
 * The durable record of a payment, read from Postgres.
 *
 * This replaces a module-level `Map` that used to cache payments in memory. On
 * Workers that Map is PER-ISOLATE, so it only ever held payments this particular
 * isolate had created. Any other isolate saw a miss — and a provider webhook or
 * a status poll almost never lands on the isolate that created the payment. The
 * symptoms only appear under load, which is the worst way to find them: a status
 * check 404ing on a payment that exists, and a webhook falling back to amount 0.
 */
async function loadPayment(
  env: unknown,
  paymentId: string,
  venue?: string | null,
): Promise<{
  id: string;
  amount: number;
  currency: string;
  status: string;
  metadata: Record<string, unknown>;
  created_at: string;
} | null> {
  const sql = getSql(env);
  if (!sql) return null;
  try {
    const [row] = venue
      ? await sql`
          SELECT id, amount, currency, status, metadata, created_at
          FROM payments WHERE id = ${paymentId} AND venue_id = ${venue} LIMIT 1`
      : await sql`
          SELECT id, amount, currency, status, metadata, created_at
          FROM payments WHERE id = ${paymentId} LIMIT 1`;
    if (!row) return null;
    return {
      id: String(row.id),
      amount: Number(row.amount) || 0,
      currency: String(row.currency ?? "KES"),
      status: String(row.status ?? ""),
      metadata: (row.metadata ?? {}) as Record<string, unknown>,
      created_at: new Date(row.created_at as string).toISOString(),
    };
  } catch {
    return null;
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

  const SUCCEEDED = ["succeeded", "paid", "captured"];
  const succeededNow =
    SUCCEEDED.includes(rec.status) && rec.kind !== "refund" && Boolean(rec.venue);

  // Processing fee for the transparency cockpit: computed on a settled payment
  // from its billing method (never on a failed attempt), so the merchant sees the
  // real blended effective rate they pay. NULL until the payment settles.
  const feeAmount =
    SUCCEEDED.includes(rec.status) && rec.kind !== "refund"
      ? computeFee(
          Math.round(Number(rec.amount) || 0),
          methodFromMetadata(meta),
          { instantPayout: Boolean(meta.instant_payout) },
        ).fee
      : null;

  let enqueued = false;
  // Sunday-parity staff alerts (roadmap B2.1–B2.5, B2.10, B2.12). Collected
  // inside the ledger transaction — the only place that knows whether THIS
  // payment was the first success, and what balance is left on the bill — then
  // delivered after commit so a push failure can never roll back a payment.
  let notifications: StaffNotifyInput[] = [];
  // A2.4 — the same numbers, pushed to every OTHER phone paying this check.
  // Collected inside the transaction, published after commit for the same reason.
  let billUpdate: BillEvent | null = null;
  try {
    enqueued = await sql.begin(async (tx) => {
      notifications = [];
      billUpdate = null;
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${rec.id}, 0))`;
      const [previous] = await tx`
        SELECT venue_id, kind, amount, currency, status, provider_ref, reference,
               metadata, tip_amount, staff_id, initiator, fee_amount
        FROM payments WHERE id = ${rec.id} FOR UPDATE`;
      if (previous?.venue_id && rec.venue && String(previous.venue_id) !== rec.venue) {
        throw new Error(`payment ${rec.id} venue mismatch`);
      }
      if (previous?.currency && String(previous.currency) !== rec.currency) {
        throw new Error(`payment ${rec.id} currency mismatch`);
      }
      const wasSucceeded = previous
        ? SUCCEEDED.includes(String(previous.status ?? ""))
          || ["partially_refunded", "refunded"].includes(String(previous.status ?? ""))
        : false;
      const canonicalVenue = previous?.venue_id
        ? String(previous.venue_id)
        : rec.venue ?? null;
      const canonicalStatus = wasSucceeded
        ? String(previous.status)
        : rec.status;
      const [persisted] = await tx`
        INSERT INTO payments
          (id, venue_id, kind, amount, currency, status, provider_ref, reference,
           metadata, tip_amount, staff_id, initiator, fee_amount)
        VALUES (${rec.id}, ${canonicalVenue}, ${rec.kind ?? "payment"},
          ${rec.amount}, ${rec.currency}, ${canonicalStatus},
                ${rec.providerRef ?? null}, ${rec.reference ?? null},
                ${tx.json(JSON.parse(JSON.stringify(rec.metadata ?? {})))},
                ${tipAmount}, ${staffId}, ${initiator}, ${feeAmount})
        ON CONFLICT (id) DO UPDATE SET
          status = CASE
            WHEN payments.status IN ('succeeded','paid','captured','partially_refunded','refunded')
              THEN payments.status
            ELSE EXCLUDED.status
          END,
          tip_amount = CASE
            WHEN payments.status IN ('succeeded','paid','captured','partially_refunded','refunded')
              THEN payments.tip_amount ELSE EXCLUDED.tip_amount END,
          staff_id = COALESCE(EXCLUDED.staff_id, payments.staff_id),
          provider_ref = COALESCE(EXCLUDED.provider_ref, payments.provider_ref),
          fee_amount = CASE
            WHEN payments.status IN ('succeeded','paid','captured','partially_refunded','refunded')
              THEN payments.fee_amount ELSE COALESCE(EXCLUDED.fee_amount, payments.fee_amount) END,
          amount = CASE
            WHEN payments.status IN ('succeeded','paid','captured','partially_refunded','refunded')
              THEN payments.amount
            WHEN EXCLUDED.status IN ('succeeded', 'paid', 'captured') THEN EXCLUDED.amount
            ELSE payments.amount END,
          metadata = CASE
            WHEN payments.status IN ('succeeded','paid','captured','partially_refunded','refunded')
              THEN payments.metadata ELSE EXCLUDED.metadata END,
          updated_at = now()
        RETURNING venue_id, kind, amount, currency, status, provider_ref,
                  reference, metadata, tip_amount, fee_amount, settlement_id`;
      // DO UPDATE always fires, so RETURNING always yields the row — re-reading
      // it would be a third round-trip inside the FOR UPDATE window.
      const payment = persisted ?? {
        venue_id: canonicalVenue,
        kind: rec.kind ?? "payment",
        amount: rec.amount,
        currency: rec.currency,
        status: canonicalStatus,
        provider_ref: rec.providerRef ?? null,
        reference: rec.reference ?? null,
        metadata: meta,
        tip_amount: tipAmount,
        fee_amount: feeAmount,
        settlement_id: null,
      };
      const firstSuccess = succeededNow && !wasSucceeded && Boolean(canonicalVenue);
      const isRefund = rec.kind === "refund" && rec.status === "refunded";
      const eventVenue = String(payment.venue_id ?? canonicalVenue ?? "");
      const persistedMeta = (payment.metadata ?? meta) as Record<string, unknown>;
      if (((succeededNow && eventVenue) || isRefund) && eventVenue) {
        let eventMetadata = persistedMeta;
        if (firstSuccess) {
          const sourceType = String(persistedMeta.flow_type ?? persistedMeta.source_type ?? "payment");
          const sourceId = String(
            persistedMeta.order_id ?? persistedMeta.invoice_number ?? persistedMeta.pay_link_id ?? rec.id,
          );
          let taxAmount = Math.max(0, Math.round(Number(persistedMeta.tax_amount ?? 0)) || 0);
          let cogsAmount = 0;
          const invoiceNumber = String(persistedMeta.invoice_number ?? "");
          if (invoiceNumber) {
            const [invoice] = await tx`
              SELECT amount, tax_amount FROM invoices
              WHERE venue_id = ${eventVenue} AND number = ${invoiceNumber}
              LIMIT 1`;
            if (invoice) {
              const invoiceGrossMinor = Math.round(Number(invoice.amount) * 100);
              const invoiceTaxMinor = Math.round(Number(invoice.tax_amount ?? 0) * 100);
              taxAmount = invoiceGrossMinor > 0
                ? Math.floor(invoiceTaxMinor * Math.max(0, Number(rec.amount) - tipAmount) / invoiceGrossMinor)
                : 0;
            }
          }
          const orderId = String(persistedMeta.order_id ?? "");
          if (/^[0-9a-f-]{36}$/i.test(orderId)) {
            const [cogs] = await tx`
              SELECT COALESCE(sum(oi.qty * inv.cost), 0)::bigint AS amount
              FROM order_items oi
              JOIN inventory_items inv
                ON inv.venue_id = ${eventVenue} AND inv.menu_item_id = oi.menu_item_id
              WHERE oi.order_id = ${orderId}`;
            cogsAmount = Number(cogs?.amount ?? 0);
          }
          const [org] = await tx`
            SELECT o.commission_bps FROM venues v
            JOIN organizations o ON o.id = v.org_id
            WHERE v.id = ${eventVenue} LIMIT 1`;
          const commission = Math.round(
            Number(rec.amount) * Number(org?.commission_bps ?? 0) / 10000,
          );
          const principal = Math.max(0, Number(rec.amount) - tipAmount);
          const loyaltyPoints = Math.max(0, Math.floor(principal / 1000));

          // --- Staff alerts: full vs partial vs "table fully paid" -----------
          // The outstanding balance is read the same way `split-lock.ts` grants
          // a share (order total minus settled non-tip principal), so the number
          // a server sees is the number the next payer is allowed to charge.
          {
            const notifyOrderId = /^[0-9a-f-]{36}$/i.test(orderId) ? orderId : null;
            let tableHint: unknown =
              persistedMeta.table_id ?? persistedMeta.table_number ?? null;
            let outcome: StaffNotifyInput | null = null;
            if (notifyOrderId) {
              const [bill] = await tx`
                SELECT o.table_id,
                       o.total::bigint AS total,
                    order_paid_minor(${eventVenue}, ${notifyOrderId}::uuid) AS paid
                FROM orders o
                WHERE o.id = ${notifyOrderId} AND o.venue_id = ${eventVenue}
                LIMIT 1`;
              if (bill) {
                tableHint = bill.table_id ?? tableHint;
                const remaining = Math.max(
                  0,
                  Number(bill.total) - Number(bill.paid),
                );
                // A2.4 — every other guest's phone learns the new balance from
                // this exact number, so what they are allowed to charge and what
                // they are shown can never drift apart.
                billUpdate = {
                  type: "bill.updated",
                  data: {
                    order_id: notifyOrderId,
                    total: Number(bill.total) / 100,
                    paid: Number(bill.paid) / 100,
                    remaining: remaining / 100,
                    timestamp: new Date().toISOString(),
                  },
                };
                // `paid` already includes this payment (upserted above).
                const paidBefore = Math.max(0, Number(bill.paid) - principal);
                const base = {
                  venue: eventVenue,
                  table: tableHint,
                  currency: String(payment.currency),
                  amountMinor: principal,
                  url: "/dashboard/orders",
                  data: { payment_id: rec.id, order_id: notifyOrderId },
                } as const;
                outcome =
                  remaining > 0
                    ? {
                        ...base,
                        type: "payment.partial",
                        remainingMinor: remaining,
                        dedupeKey: `payment.partial:${rec.id}`,
                      }
                    : paidBefore > 0
                      ? {
                          ...base,
                          type: "table.paid",
                          remainingMinor: 0,
                          dedupeKey: `table.paid:${notifyOrderId}`,
                        }
                      : {
                          ...base,
                          type: "payment.full",
                          remainingMinor: 0,
                          dedupeKey: `payment.full:${rec.id}`,
                        };
              }
            }
            if (tableHint) {
              notifications.push({
                venue: eventVenue,
                type: "payment.received",
                table: tableHint,
                currency: String(payment.currency),
                amountMinor: Number(payment.amount),
                dedupeKey: `payment.received:${rec.id}`,
                url: "/dashboard/payments",
                data: { payment_id: rec.id },
              });
            }
            if (outcome) notifications.push(outcome);
            if (tipAmount > 0) {
              notifications.push({
                venue: eventVenue,
                type: "tip.new",
                table: tableHint,
                targetStaffId: staffId,
                currency: String(payment.currency),
                amountMinor: tipAmount,
                dedupeKey: `tip.new:${rec.id}`,
                url: "/staff-console",
                data: { payment_id: rec.id },
              });
            }
          }
          await tx`
            INSERT INTO financial_payment_snapshots
              (payment_id, venue_id, currency, gross_amount, principal_amount,
               tax_amount, tip_amount, loyalty_points, commission_amount,
               cogs_amount, source_type, source_id, metadata)
            VALUES
              (${rec.id}, ${eventVenue}, ${String(payment.currency)}, ${Number(payment.amount)}, ${principal},
               ${taxAmount}, ${tipAmount}, ${loyaltyPoints}, ${commission},
               ${cogsAmount}, ${sourceType}, ${sourceId},
               ${tx.json(JSON.parse(JSON.stringify(persistedMeta)))})
            ON CONFLICT (payment_id) DO NOTHING`;
          eventMetadata = {
            ...persistedMeta,
            financial_snapshot: {
              gross_amount: Number(payment.amount),
              principal_amount: principal,
              tax_amount: taxAmount,
              tip_amount: tipAmount,
              loyalty_points: loyaltyPoints,
              commission_amount: commission,
              cogs_amount: cogsAmount,
            },
          };
        }
        if (isRefund) {
          const parentId = String(meta.refund_of ?? "");
          const [parent] = await tx`
            SELECT amount, currency, metadata, tip_amount, fee_amount,
                   settlement_id
            FROM payments
            WHERE id = ${parentId} AND venue_id = ${eventVenue}
            LIMIT 1`;
          if (parent) {
            const ratioBps = Math.min(
              10000,
              Math.max(0, Math.round(Number(rec.amount) * 10000 / Number(parent.amount))),
            );
            eventMetadata = {
              ...((parent.metadata ?? {}) as Record<string, unknown>),
              ...meta,
              refund_of: parentId,
              refund_ratio_bps: ratioBps,
              original_amount: Number(parent.amount),
              original_tip_amount: Number(parent.tip_amount ?? 0),
              original_fee_amount: Number(parent.fee_amount ?? 0),
              original_settlement_id: parent.settlement_id ?? null,
            };
            await tx`
              INSERT INTO financial_reversals
                (venue_id, refund_id, payment_id, amount, currency, ratio_bps,
                 payload, source_settlement_id, reservation_id)
              VALUES
                (${eventVenue}, ${rec.id}, ${parentId}, ${rec.amount}, ${rec.currency},
                 ${ratioBps}, ${tx.json(JSON.parse(JSON.stringify(eventMetadata)))},
                 ${parent.settlement_id ?? null}, ${String(meta.refund_reservation_id ?? "") || null})
              ON CONFLICT (refund_id) DO NOTHING`;
          }
        }
        const eventType = isRefund ? "refund.succeeded" : "payment.succeeded";
        const eventId = await enqueueFinancialEvent(tx, {
          eventKey: `${eventType}:${rec.id}`,
          venue: eventVenue,
          aggregateId: rec.id,
          eventType,
          payload: {
            paymentId: rec.id,
            venue: eventVenue,
            amount: Number(payment.amount),
            currency: String(payment.currency),
            status: String(payment.status),
            kind: String(payment.kind ?? rec.kind ?? "payment"),
            providerRef: (payment.provider_ref as string | null) ?? null,
            reference: (payment.reference as string | null) ?? null,
            metadata: eventMetadata,
          },
          consumers: isRefund ? REFUND_CONSUMERS : PAYMENT_CONSUMERS,
        });
        return Boolean(eventId);
      }

      // Declined attempt (B2.3 / B2.4 / B2.5). A server needs to know before the
      // guest walks, so the alert fires on the FIRST terminal failure only — a
      // redelivered webhook is absorbed by the per-recipient dedupe key.
      const failedNow =
        !wasSucceeded &&
        rec.kind !== "refund" &&
        Boolean(eventVenue) &&
        ["failed", "cancelled"].includes(String(payment.status));
      if (failedNow) {
        const tableHint =
          persistedMeta.table_id ?? persistedMeta.table_number ?? null;
        if (tableHint) {
          const failureType = classifyPaymentFailure({
            errorCode: persistedMeta.error_code,
            errorMessage: persistedMeta.error_message,
            errorReason: persistedMeta.error_reason,
            fraudDecision:
              persistedMeta.merchant_decision ?? persistedMeta.frm_decision,
            status: payment.status,
          });
          notifications.push({
            venue: eventVenue,
            type: failureType,
            table: tableHint,
            currency: String(payment.currency),
            amountMinor: Number(payment.amount),
            reason:
              typeof persistedMeta.error_message === "string"
                ? persistedMeta.error_message.slice(0, 120)
                : null,
            dedupeKey: `${failureType}:${rec.id}`,
            url: "/dashboard/payments",
            data: { payment_id: rec.id },
          });
        }
      }
      return false;
    });
  } catch (err) {
    // The ledger write is best-effort so it never blocks a payment, but a failure
    // means a real transaction may be missing from the ledger — surface it (with
    // context) instead of swallowing it silently.
    console.error("[recordLedger] insert failed", rec.id, err);
    void captureException(env, err, {
      where: "recordLedger.insert",
      paymentId: rec.id,
      venue: rec.venue ?? null,
    });
    throw err;
  }

  if (enqueued) {
    // Fast-path the durable outbox. Any failed consumer remains visible and due
    // for retry; the source payment is already committed and never re-enqueued.
    await processFinancialOutbox(sql, 25);
  }

  // Post-commit: wake only the servers following this table (B2.13). Never
  // inside the transaction — a slow push endpoint must not hold a payment lock.
  if (notifications.length > 0) {
    await deliverStaffNotifications(env, notifications);
  }

  // Post-commit: A2.4 live remaining balance for the other guests on this check.
  if (billUpdate) {
    const update = billUpdate as BillEvent;
    await publishToTopic(env, billTopic(update.data.order_id), update);
  }
}

async function recordRefundLedger(
  env: unknown,
  rec: {
    id: string;
    paymentId: string;
    amount: number;
    currency: string;
    venue: string;
    reference?: string | null;
    providerRef?: string | null;
    reason?: string | null;
    reservationId?: string | null;
  },
): Promise<boolean> {
  const sql = getSql(env);
  if (!sql) return false;
  const amount = Math.round(Number(rec.amount));
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error("refund amount must be a positive safe integer");
  }
  let inserted = false;
  let eventEnqueued = false;
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${rec.paymentId}, 0))`;
    const [parent] = await tx`
      SELECT id, venue_id, amount, currency, reference, metadata, tip_amount,
             fee_amount, settlement_id
      FROM payments
      WHERE id = ${rec.paymentId} AND venue_id = ${rec.venue}
        AND kind <> 'refund'
        AND status IN ('succeeded','paid','captured','partially_refunded','refunded')
      FOR UPDATE`;
    if (!parent) throw new Error("refund parent payment not found");
    if (String(parent.currency) !== rec.currency) {
      throw new Error("refund currency does not match parent payment");
    }
    const [existing] = await tx`
      SELECT id, venue_id, amount, currency, metadata FROM payments
      WHERE id = ${rec.id} FOR UPDATE`;
    if (existing) {
      const existingMeta = (existing.metadata ?? {}) as Record<string, unknown>;
      if (
        String(existing.venue_id) !== rec.venue ||
        Number(existing.amount) !== amount ||
        String(existing.currency) !== rec.currency ||
        String(existingMeta.refund_of ?? "") !== rec.paymentId
      ) {
        throw new Error(`refund ${rec.id} conflicts with its immutable ledger row`);
      }
    } else {
      const [totals] = await tx`
        SELECT COALESCE(sum(amount), 0)::bigint AS refunded
        FROM payments
        WHERE venue_id = ${rec.venue} AND kind = 'refund' AND status = 'refunded'
          AND metadata->>'refund_of' = ${rec.paymentId}`;
      if (Number(totals?.refunded ?? 0) + amount > Number(parent.amount)) {
        throw new Error("cumulative settled refunds exceed parent payment");
      }
      const parentMeta = (parent.metadata ?? {}) as Record<string, unknown>;
      const metadata = {
        ...parentMeta,
        refund_of: rec.paymentId,
        refund_reason: rec.reason ?? null,
        refund_reservation_id: rec.reservationId ?? null,
      };
      await tx`
        INSERT INTO payments
          (id, venue_id, kind, amount, currency, status, provider_ref, reference,
           metadata, tip_amount, initiator)
        VALUES
          (${rec.id}, ${rec.venue}, 'refund', ${amount}, ${rec.currency}, 'refunded',
           ${rec.providerRef ?? null}, ${rec.reference ?? parent.reference ?? null},
           ${tx.json(JSON.parse(JSON.stringify(metadata)))}, 0, 'human')`;
      const ratioBps = Math.min(10000, Math.round(amount * 10000 / Number(parent.amount)));
      const eventMetadata = {
        ...metadata,
        refund_ratio_bps: ratioBps,
        original_amount: Number(parent.amount),
        original_tip_amount: Number(parent.tip_amount ?? 0),
        original_fee_amount: Number(parent.fee_amount ?? 0),
        original_settlement_id: parent.settlement_id ?? null,
      };
      const [reversal] = await tx`
        INSERT INTO financial_reversals
          (venue_id, refund_id, payment_id, amount, currency, ratio_bps, payload,
           source_settlement_id, reservation_id)
        VALUES
          (${rec.venue}, ${rec.id}, ${rec.paymentId}, ${amount}, ${rec.currency},
           ${ratioBps}, ${tx.json(JSON.parse(JSON.stringify(eventMetadata)))},
           ${parent.settlement_id ?? null}, ${rec.reservationId ?? null})
        ON CONFLICT (refund_id) DO NOTHING
        RETURNING id`;
      const eventId = await enqueueFinancialEvent(tx, {
        eventKey: `refund.succeeded:${rec.id}`,
        venue: rec.venue,
        aggregateId: rec.id,
        eventType: "refund.succeeded",
        payload: {
          paymentId: rec.id,
          venue: rec.venue,
          amount,
          currency: rec.currency,
          status: "refunded",
          kind: "refund",
          providerRef: rec.providerRef ?? null,
          reference: rec.reference ?? (parent.reference as string | null) ?? null,
          metadata: eventMetadata,
        },
        consumers: REFUND_CONSUMERS,
      });
      inserted = Boolean(reversal);
      eventEnqueued = Boolean(eventId);
    }
    const [refunded] = await tx`
      SELECT COALESCE(sum(amount), 0)::bigint AS amount FROM payments
      WHERE venue_id = ${rec.venue} AND kind = 'refund' AND status = 'refunded'
        AND metadata->>'refund_of' = ${rec.paymentId}`;
    const parentStatus = Number(refunded?.amount ?? 0) >= Number(parent.amount)
      ? "refunded"
      : "partially_refunded";
    await tx`
      UPDATE payments SET status = ${parentStatus}, updated_at = now()
      WHERE id = ${rec.paymentId} AND venue_id = ${rec.venue}`;
    if (rec.reservationId) {
      await tx`
        UPDATE refund_reservations
        SET status = 'booked', provider_refund_id = ${rec.id},
            provider_status = 'succeeded', updated_at = now()
        WHERE id = ${rec.reservationId} AND venue_id = ${rec.venue}
          AND payment_id = ${rec.paymentId}`;
    } else {
      await tx`
        UPDATE refund_reservations
        SET status = 'booked', provider_refund_id = ${rec.id},
            provider_status = 'succeeded', updated_at = now()
        WHERE venue_id = ${rec.venue} AND payment_id = ${rec.paymentId}
          AND provider_refund_id = ${rec.id}`;
    }
  });
  if (eventEnqueued) await processFinancialOutbox(sql, 25);
  return inserted;
}

// Set a parent payment's status to `refunded` (fully) or `partially_refunded`
// (in part) from the sum of its settled refund rows. Never downgrades an already
// fully-refunded payment. Best-effort — a bookkeeping status must never throw.
async function updateParentRefundStatus(
  runtimeEnv: unknown,
  paymentId: string,
): Promise<void> {
  const sql = getSql(runtimeEnv);
  if (!sql) return;
  try {
    const [row] = await sql`
      SELECT p.amount::bigint AS amount,
             COALESCE((SELECT sum(r.amount) FROM payments r
                       WHERE r.kind = 'refund'
                         AND r.status = 'refunded'
                         AND r.metadata->>'refund_of' = ${paymentId}), 0)::bigint AS refunded
      FROM payments p WHERE p.id = ${paymentId} LIMIT 1`;
    if (!row) return;
    const amount = Number((row as { amount?: unknown }).amount) || 0;
    const refunded = Number((row as { refunded?: unknown }).refunded) || 0;
    if (refunded <= 0) return;
    const status = amount > 0 && refunded >= amount ? "refunded" : "partially_refunded";
    await sql`
      UPDATE payments SET status = ${status}, updated_at = now()
      WHERE id = ${paymentId} AND status <> 'refunded'`;
  } catch {
    /* best-effort */
  }
}

// Record a single PesaSwap refund into the durable ledger and reflect it on the
// parent payment. Idempotent on the refund id, so learning about the same refund
// twice (webhook AND the pull-based reconcile) never double-posts money. Returns
// true only when a NEW refund row was written. Shared by the webhook + reconcile
// so refunds sync no matter how we hear about them.
async function recordRefundRow(
  runtimeEnv: unknown,
  refund: Record<string, unknown>,
): Promise<boolean> {
  const sql = getSql(runtimeEnv);
  if (!sql) return false;
  const refundId = String(refund.refund_id || refund.id || "");
  const paymentId = String(refund.payment_id || refund.refund_of || "");
  if (!refundId || !paymentId) return false;
  // Only a SETTLED refund moves money — ignore pending / failed refunds.
  if (String(refund.status ?? "").toLowerCase() !== "succeeded") return false;

  // Idempotency guard: if we already have this refund row, just make sure the
  // parent status reflects it (self-heal) and stop — never re-post.
  try {
    const [existing] = await sql`SELECT id FROM payments WHERE id = ${refundId}`;
    if (existing) {
      await updateParentRefundStatus(runtimeEnv, paymentId);
      return false;
    }
  } catch {
    /* fall through and attempt the insert */
  }

  // Attribute the refund to the parent payment's venue + metadata (for accounting
  // + customer). If the parent never hit our ledger we can't attribute a venue, so
  // skip — a refund for a payment we never recorded is not ours to book.
  let parent:
    | { venue_id?: string | null; reference?: string | null; metadata?: Record<string, unknown> }
    | undefined;
  try {
    const [row] = await sql`
      SELECT venue_id, reference, metadata FROM payments
      WHERE id = ${paymentId} LIMIT 1`;
    parent = row as typeof parent;
  } catch {
    /* ignore */
  }
  if (!parent || !parent.venue_id) return false;

  const amount = Math.round(Number(refund.amount));
  return recordRefundLedger(runtimeEnv, {
    id: refundId,
    paymentId,
    amount,
    currency: String(refund.currency || "KES"),
    venue: parent.venue_id,
    reference: parent.reference ?? null,
    providerRef:
      (refund.connector_refund_id as string) ||
      (refund.refund_arn as string) ||
      null,
    reason: (refund.reason as string) ?? null,
    reservationId: (refund.refund_reservation_id as string) ?? null,
  });
}

// Persist an incoming TRUSTED webhook to the audit trail. Idempotent on the
// provider event id (a retried delivery is a no-op). Returns true when the row is
// newly inserted (i.e. this event has not been seen before).
async function recordPaymentEvent(
  runtimeEnv: unknown,
  event: {
    eventId?: string | null;
    venue?: string | null;
    paymentId?: string | null;
    eventType?: string | null;
    status?: string | null;
    amount?: number | null;
    currency?: string | null;
    raw: unknown;
  },
): Promise<boolean> {
  const sql = getSql(runtimeEnv);
  if (!sql) return false;
  const id =
    String(event.eventId || "") ||
    `${event.paymentId || "evt"}:${event.eventType || ""}:${Date.now()}`;
  try {
    const [row] = await sql`
      INSERT INTO payment_events
        (id, venue_id, payment_id, event_type, status, amount, currency, raw)
      VALUES (${id}, ${event.venue ?? null}, ${event.paymentId ?? null},
              ${event.eventType ?? ""}, ${event.status ?? null},
              ${event.amount ?? null}, ${event.currency ?? "KES"},
              ${sql.json(JSON.parse(JSON.stringify(event.raw ?? {})))})
      ON CONFLICT (id) DO NOTHING
      RETURNING id`;
    return Boolean(row);
  } catch {
    return false;
  }
}

// Upsert a dispute / chargeback, attributing it to the parent payment's venue (a
// dispute for a payment we never recorded is not ours to book). Idempotent on the
// dispute id — a status change (opened → won/lost) updates in place.
async function recordDispute(
  runtimeEnv: unknown,
  dispute: Record<string, unknown>,
): Promise<boolean> {
  const sql = getSql(runtimeEnv);
  if (!sql) return false;
  const disputeId = String(dispute.dispute_id || dispute.id || "");
  const paymentId = String(dispute.payment_id || "");
  if (!disputeId || !paymentId) return false;

  let parent: { venue_id?: string | null } | undefined;
  try {
    const [row] = await sql`
      SELECT venue_id FROM payments WHERE id = ${paymentId} LIMIT 1`;
    parent = row as typeof parent;
  } catch {
    /* ignore */
  }
  if (!parent || !parent.venue_id) return false;

  const amount = Math.max(0, Math.round(Number(dispute.amount) || 0));
  const status = mapDisputeStatus(dispute.status as string);
  const reason = (dispute.reason as string) ?? null;
  const connectorId =
    (dispute.connector_dispute_id as string) ||
    (dispute.dispute_arn as string) ||
    null;
  const rawDue = dispute.evidence_due_by || dispute.challenge_required_by || null;
  let dueBy: string | null = null;
  if (rawDue) {
    const parsed = new Date(String(rawDue));
    if (!Number.isNaN(parsed.getTime())) dueBy = parsed.toISOString();
  }
  try {
    await sql`
      INSERT INTO disputes
        (id, venue_id, payment_id, amount, currency, status, reason,
         connector_dispute_id, evidence_due_by)
      VALUES (${disputeId}, ${parent.venue_id}, ${paymentId}, ${amount},
              ${String(dispute.currency || "KES")}, ${status}, ${reason},
              ${connectorId}, ${dueBy})
      ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status,
        reason = COALESCE(EXCLUDED.reason, disputes.reason),
        amount = EXCLUDED.amount,
        connector_dispute_id =
          COALESCE(EXCLUDED.connector_dispute_id, disputes.connector_dispute_id),
        evidence_due_by =
          COALESCE(EXCLUDED.evidence_due_by, disputes.evidence_due_by),
        updated_at = now()`;
    return true;
  } catch {
    return false;
  }
}

// Pull recent refunds from PesaSwap and sync any we don't yet have. This is the
// DURABLE refund path: PesaSwap's outgoing webhook can fail (CallToMerchantFailed)
// and a refund raised from the PesaSwap dashboard never reaches us as an event —
// so we PULL. **Batched** so the steady state (nothing new) costs ONE network call
// + TWO SELECTs — never a query per refund. Idempotent, best-effort. Returns the
// count of newly-synced refunds.
async function reconcileRefunds(
  runtimeEnv: unknown,
  opts?: { limit?: number },
): Promise<number> {
  const env = getEnv(runtimeEnv);
  if (!env.PESASWAP_API_KEY) return 0;
  const sql = getSql(runtimeEnv);
  if (!sql) return 0;
  const limit = Math.min(100, Math.max(1, opts?.limit ?? 50));

  // 1) Pull recent refunds (ONE network call).
  let list: Array<Record<string, unknown>> = [];
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 6000);
    const resp = await fetch(`${env.PESASWAP_URL}/refunds/list`, {
      method: "POST",
      headers: {
        "api-key": env.PESASWAP_API_KEY,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ limit }),
      signal: ac.signal,
    });
    clearTimeout(timer);
    if (!resp.ok) return 0;
    const data = (await resp.json()) as { data?: Array<Record<string, unknown>> };
    list = Array.isArray(data.data) ? data.data : [];
  } catch {
    return 0;
  }

  // Keep only settled refunds that carry both ids.
  const settled = list.filter(
    (r) =>
      String(r.status ?? "").toLowerCase() === "succeeded" &&
      (r.refund_id || r.id) &&
      r.payment_id,
  );
  if (!settled.length) return 0;
  const refundIds = settled.map((r) => String(r.refund_id || r.id));
  const parentIds = [...new Set(settled.map((r) => String(r.payment_id)))];

  // 2) ONE query: which of these refunds do we already have?
  let have = new Set<string>();
  try {
    const existing = await sql`SELECT id FROM payments WHERE id = ANY(${refundIds})`;
    have = new Set(existing.map((e) => String((e as { id: unknown }).id)));
  } catch {
    /* proceed — recordLedger's ON CONFLICT still guards against a double-insert */
  }

  // 3) ONE query: the parent payments (venue + metadata) for attribution.
  const parentMap = new Map<
    string,
    { venue_id?: string | null; reference?: string | null; metadata?: Record<string, unknown> }
  >();
  try {
    const parents = await sql`
      SELECT id, venue_id, reference, metadata FROM payments
      WHERE id = ANY(${parentIds})`;
    for (const p of parents) {
      parentMap.set(String((p as { id: unknown }).id), p as never);
    }
  } catch {
    /* ignore — nothing to attribute to */
  }

  // 4) Insert ONLY the new refunds whose parent we actually hold.
  const toInsert = settled.filter((r) => {
    const rid = String(r.refund_id || r.id);
    const parent = parentMap.get(String(r.payment_id));
    return !have.has(rid) && parent?.venue_id;
  });
  for (const r of toInsert) {
    const parentId = String(r.payment_id);
    const parent = parentMap.get(parentId)!;
    try {
      const refundId = String(r.refund_id || r.id);
      const parentVenue = String(parent.venue_id);
      const [reservation] = await sql`
        SELECT id FROM refund_reservations
        WHERE venue_id = ${parentVenue} AND payment_id = ${parentId}
          AND (provider_refund_id = ${refundId} OR provider_key = ${String(r.idempotency_key ?? "")})
        ORDER BY created_at DESC LIMIT 1`;
      await recordRefundLedger(runtimeEnv, {
        id: refundId,
        paymentId: parentId,
        amount: Math.round(Number(r.amount)),
        currency: String(r.currency || "KES"),
        venue: parentVenue,
        reference: parent.reference ?? null,
        providerRef:
          (r.connector_refund_id as string) || (r.refund_arn as string) || null,
        reason: (r.reason as string) ?? null,
        reservationId: reservation?.id ? String(reservation.id) : null,
      });
    } catch {
      /* best-effort per refund */
    }
  }

  // 5) Update parent status ONLY for parents that received a new refund.
  const affected = [...new Set(toInsert.map((r) => String(r.payment_id)))];
  for (const pid of affected) {
    await updateParentRefundStatus(runtimeEnv, pid);
  }
  return toInsert.length;
}

export async function runFinancialRecovery(
  runtimeEnv: unknown,
): Promise<{
  completed: number;
  failed: number;
  refundsSynced: number;
  invoiceCommunications: { accepted: number; failed: number };
  tipPayouts: { confirmed: number; failed: number };
}> {
  const sql = getSql(runtimeEnv);
  if (!sql) {
    return {
      completed: 0,
      failed: 0,
      refundsSynced: 0,
      invoiceCommunications: { accepted: 0, failed: 0 },
      tipPayouts: { confirmed: 0, failed: 0 },
    };
  }
  const refundsSynced = await reconcileRefunds(runtimeEnv, { limit: 100 });
  const outbox = await processFinancialOutbox(sql, 100);
  const invoiceCommunications = await processInvoiceCommunications(runtimeEnv, 100);
  const tipPayouts = await reconcileTipPayouts(runtimeEnv);
  return { ...outbox, refundsSynced, invoiceCommunications, tipPayouts };
}

// --- Route Handler ---

export async function handlePaymentRoute(
  request: Request,
  env: unknown,
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;

  // CORS headers for all API routes
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Idempotency-Key, api-key",
  };

  // Public: expose the payment mode so the UI can show a "Sandbox / test
  // payments" badge. Test mode simulates payments (no real money); live mode
  // charges real M-Pesa. No secrets are revealed.
  if (path === "/api/payments/config" && request.method === "GET") {
    const e = getEnv(env);
    const testMode =
      e.PAYMENTS_TEST_MODE !== "" &&
      e.PAYMENTS_TEST_MODE !== "0" &&
      e.PAYMENTS_TEST_MODE.toLowerCase() !== "false";
    return withCors(jsonResponse({ testMode }), corsHeaders);
  }

  if (path === "/api/payments/intent" && request.method === "POST") {
    const payload = await requireAuth(request, env);
    if (!payload || !roleAtLeast(payload, "staff")) {
      return withCors(jsonResponse({ error: { message: "unauthorized" } }, 401), corsHeaders);
    }
    if (!tokenHasScope(payload, "payments:write")) {
      return withCors(jsonResponse({ error: { message: "forbidden" } }, 403), corsHeaders);
    }
    const body = (await request.json().catch(() => ({}))) as {
      amount?: number;
      currency?: string;
      sourceId?: string;
      maxTipAmount?: number;
      metadata?: Record<string, unknown>;
    };
    const currency = normalizeCurrency(body.currency);
    if (!currency) {
      return withCors(
        jsonResponse({ error: { message: "Unsupported currency." } }, 400),
        corsHeaders,
      );
    }
    const created = await createPaymentIntent(env, {
      venue: venueFromPayload(payload, url),
      amount: Math.round(Number(body.amount) || 0),
      currency,
      sourceType: "tapgo",
      sourceId: body.sourceId ?? null,
      allowedMethod: currency === DEFAULT_CURRENCY ? "m_pesa_express" : null,
      maxTipAmount: Math.max(0, Math.round(Number(body.maxTipAmount) || 0)),
      metadata: body.metadata ?? {},
    });
    return withCors(
      "error" in created
        ? jsonResponse({ error: { message: created.error } }, 400)
        : jsonResponse({ paymentIntentToken: created.token, ...created }, 201),
      corsHeaders,
    );
  }

  if (path === "/api/financial-events/run" && request.method === "POST") {
    const cronSecret = envVar(env, "CRON_SECRET");
    const cron = cronSecret
      ? verifyToken(request.headers.get("x-cron-secret"), cronSecret)
      : false;
    const principal = cron ? null : await requireAuth(request, env);
    if (!cron && (!principal || principal.role !== "admin")) {
      return withCors(jsonResponse({ error: { message: "unauthorized" } }, 401), corsHeaders);
    }
    const sql = getSql(env);
    if (!sql) return withCors(jsonResponse({ error: { message: "database not configured" } }, 503), corsHeaders);
    return withCors(jsonResponse(await runFinancialRecovery(env)), corsHeaders);
  }

  if (path === "/api/financial-events" && request.method === "GET") {
    const principal = await requireAuth(request, env);
    if (!principal || !roleAtLeast(principal, "manager")) {
      return withCors(jsonResponse({ error: { message: "unauthorized" } }, 401), corsHeaders);
    }
    const venue = venueFromPayload(principal, url);
    const sql = getSql(env);
    if (!sql) return withCors(jsonResponse({ error: { message: "database not configured" } }, 503), corsHeaders);
    const rows = await sql`
      SELECT o.id, o.event_id, o.consumer, o.status, o.attempts,
             o.next_attempt_at, o.last_error, o.claimed_at, o.lease_expires_at,
             e.event_type, e.aggregate_id, e.occurred_at
      FROM financial_outbox o
      JOIN financial_events e ON e.id = o.event_id
      WHERE e.venue_id = ${venue}
        AND o.status IN ('failed','processing')
      ORDER BY e.occurred_at DESC LIMIT 100`;
    return withCors(jsonResponse({ events: rows }), corsHeaders);
  }

  const financialRetry = path.match(/^\/api\/financial-events\/([^/]+)\/retry$/);
  if (financialRetry && request.method === "POST") {
    const principal = await requireAuth(request, env);
    if (!principal || !roleAtLeast(principal, "manager")) {
      return withCors(jsonResponse({ error: { message: "unauthorized" } }, 401), corsHeaders);
    }
    const venue = venueFromPayload(principal, url);
    const sql = getSql(env);
    if (!sql) return withCors(jsonResponse({ error: { message: "database not configured" } }, 503), corsHeaders);
    const [retried] = await sql`
      UPDATE financial_outbox o
      SET status = 'pending', next_attempt_at = now(), last_error = NULL,
          claim_token = NULL, lease_expires_at = NULL
      FROM financial_events e
      WHERE o.id = ${financialRetry[1]}::uuid AND e.id = o.event_id
        AND e.venue_id = ${venue} AND o.status IN ('failed','processing')
      RETURNING o.id`;
    if (!retried) return withCors(jsonResponse({ error: { message: "event not found" } }, 404), corsHeaders);
    return withCors(jsonResponse({ retried: true, id: retried.id }), corsHeaders);
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

  // Force Sync (gated manager+): pull the authoritative state from PesaSwap now —
  // reconcile stuck payments AND dashboard-initiated refunds — so the merchant can
  // resync on demand without waiting for the (unreliable) outgoing webhook.
  if (path === "/api/payments/sync" && request.method === "POST") {
    return withCors(await handleSyncPayments(request, env), corsHeaders);
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
    return withCors(
      jsonResponse(
        { error: { message: "verified customer session required" } },
        401,
      ),
      corsHeaders,
    );
  }

  // --- Webhook from PesaSwap ---
  if (path === "/api/webhooks/pesaswap" && request.method === "POST") {
    return withCors(await handleWebhook(request, env), corsHeaders);
  }

  // --- Polling notifications fallback ---
  if (path === "/api/notifications" && request.method === "GET") {
    const payload = await requireAuth(request, env);
    if (!payload || !roleAtLeast(payload, "staff")) {
      return withCors(jsonResponse({ error: { message: "unauthorized" } }, 401), corsHeaders);
    }
    const merchantId = venueFromPayload(payload, url);
    return withCors(await handleNotifications(url, env, merchantId), corsHeaders);
  }

  // --- WebSocket upgrade for real-time ---
  if (path === "/api/realtime") {
    const payload = await requireAuth(request, env);
    if (!payload || !roleAtLeast(payload, "staff")) {
      return withCors(jsonResponse({ error: { message: "unauthorized" } }, 401), corsHeaders);
    }
    return await handleRealtimeUpgrade(request, env, venueFromPayload(payload, url));
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
  const intentToken = String(body.payment_intent_token ?? "").trim();
  const intentSql = getSql(workerEnv);
  let reservedIntentId: string | null = null;
  let boundProviderPaymentId: string | null = null;
  // Split-pay hold taken further down; released again on any terminal failure.
  let splitHold: { orderId: string; holdKey: string } | null = null;
  // A2.2: the by-item claim behind that hold, if the guest picked dishes. The
  // dishes must go back on the table the moment the charge is known to be dead.
  let splitClaimKey: string | null = null;

  // Replay before touching the one-time intent. A lost response retry must return
  // the original payment even though that intent is already consumed.
  if (idempotencyKey) {
    const guard = await idempotentGuard(workerEnv, idempotencyKey);
    if ("replay" in guard) return jsonResponse(guard.replay, 200);
  }

  if (!/^[a-f0-9]{64}$/i.test(intentToken) || !intentSql) {
    return jsonResponse(
      { error: { message: "A valid server payment intent is required." } },
      400,
    );
  }
  const paymentIntentSql = intentSql;
  const intentHash = await hashPaymentIntentToken(intentToken);
  const [intent] = await paymentIntentSql`
    UPDATE payment_intents
    SET consumed_at = now()
    WHERE token_hash = ${intentHash}
      AND consumed_at IS NULL
      AND expires_at > now()
    RETURNING id, venue_id, amount, currency, source_type, source_id,
              allowed_method, max_tip_amount, metadata`;
  if (!intent) {
    const [consumed] = await paymentIntentSql`
      SELECT consumed_payment_id FROM payment_intents
      WHERE token_hash = ${intentHash}
      LIMIT 1`;
    if (consumed?.consumed_payment_id) {
      return handleGetPaymentStatus(String(consumed.consumed_payment_id), workerEnv);
    }
    return jsonResponse({ error: { message: "Payment intent is invalid or expired." } }, 409);
  }
  reservedIntentId = String(intent.id);
  const requestedMetadata = (body.metadata ?? {}) as Record<string, unknown>;
  const boundMetadata = (intent.metadata ?? {}) as Record<string, unknown>;
  const customerPhone = canonicalKenyanPhone(
    requestedMetadata.customer_phone ?? boundMetadata.customer_phone,
  );
  const tipAmount = Math.max(0, Math.round(Number(requestedMetadata.tip_amount) || 0));
  if (tipAmount > Number(intent.max_tip_amount ?? 0)) {
    await paymentIntentSql`
      UPDATE payment_intents SET consumed_at = NULL
      WHERE id = ${reservedIntentId} AND consumed_payment_id IS NULL`;
    return jsonResponse({ error: { message: "Tip exceeds the payment intent limit." } }, 400);
  }
  if (
    intent.allowed_method &&
    body.payment_method &&
    String(body.payment_method) !== String(intent.allowed_method)
  ) {
    await paymentIntentSql`
      UPDATE payment_intents SET consumed_at = NULL
      WHERE id = ${reservedIntentId} AND consumed_payment_id IS NULL`;
    return jsonResponse({ error: { message: "Payment method is not allowed." } }, 400);
  }
  body.amount = Number(intent.amount) + tipAmount;
  body.currency = String(intent.currency);
  body.payment_method = String(intent.allowed_method ?? body.payment_method ?? "m_pesa_express");
  body.metadata = {
    ...boundMetadata,
    customer_phone: customerPhone ?? undefined,
    customer_name: requestedMetadata.customer_name,
    staff_id:
      typeof boundMetadata.staff_id === "string" &&
      requestedMetadata.staff_id === boundMetadata.staff_id
        ? boundMetadata.staff_id
        : undefined,
    tip_amount: tipAmount,
    venue: String(intent.venue_id),
    merchant_id: String(intent.venue_id),
    source_type: String(intent.source_type),
    source_id: intent.source_id ?? undefined,
  };

  async function finalizeIntent(paymentId: string | null): Promise<void> {
    if (paymentId === null && splitHold) {
      // Nothing will ever be charged against this attempt — hand the share back
      // to the table immediately instead of waiting for the hold to expire.
      if (splitClaimKey) {
        // Releases the claimed dishes AND the money hold in one step.
        await releaseOrderItemClaims(
          paymentIntentSql,
          splitHold.orderId,
          splitClaimKey,
        );
      } else {
        await releaseOrderShare(
          paymentIntentSql,
          splitHold.orderId,
          splitHold.holdKey,
        );
      }
      splitHold = null;
    }
    if (!reservedIntentId) return;
    if (paymentId) {
      boundProviderPaymentId = paymentId;
      await paymentIntentSql`
        UPDATE payment_intents SET consumed_payment_id = ${paymentId}
        WHERE id = ${reservedIntentId}`;
    } else {
      await paymentIntentSql`
        UPDATE payment_intents SET consumed_at = NULL
        WHERE id = ${reservedIntentId} AND consumed_payment_id IS NULL`;
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

  // Reseller settlement routing: if the venue belongs to an org (bank), tag the
  // payment with the org's PesaSwap partner id so settlement routes to the bank's
  // partner account. Recorded on the payment now (and forwarded to PesaSwap once a
  // real partner id is configured on the org).
  {
    const routeSql = getSql(workerEnv);
    const routeVenue = String(
      (body.metadata as Record<string, unknown>).venue ?? "main",
    );
    if (routeSql && routeVenue !== "main") {
      const partnerId = await partnerIdForVenue(routeSql, routeVenue);
      if (partnerId) {
        (body.metadata as Record<string, unknown>).settlement_partner_id =
          partnerId;
      }
    }
  }

  const env = getEnv(workerEnv);

  // Split-pay guard: when charging against a shared order, never let a guest pay
  // more than the outstanding balance (server-authoritative). The share is
  // RESERVED under a per-order lock, so two guests checking out at the same
  // instant can no longer both be granted the same remainder and overpay the
  // check. The reservation expires on its own (see db/61) and is released
  // explicitly by finalizeIntent(null) on any terminal failure.
  const guardMeta = (body.metadata ?? {}) as Record<string, unknown>;
  const guardOrderId =
    typeof guardMeta.order_id === "string" &&
    /^[0-9a-f-]{36}$/i.test(guardMeta.order_id)
      ? guardMeta.order_id
      : null;
  if (guardOrderId) {
    const guardSql = getSql(workerEnv);
    if (guardSql) {
      // A tip rides ON TOP of the bill: reserve only the ORDER portion, then
      // re-add the tip. A guest can never overpay the bill, but can still leave
      // a tip (even on an already-settled bill).
      const tipMinor = Math.max(
        0,
        Math.round(Number(guardMeta.tip_amount) || 0),
      );
      const orderPortion = Math.max(0, body.amount - tipMinor);
      // A2.2: a split-by-item checkout already reserved its dishes AND the money
      // they are worth under this key. Reuse it as the hold key so the charge
      // re-competes for its own reservation instead of stacking a second hold on
      // top of it and locking the guest out of the bill they just claimed.
      const claimKey =
        typeof guardMeta.item_claim_key === "string" &&
        /^[A-Za-z0-9_-]{8,64}$/.test(guardMeta.item_claim_key)
          ? guardMeta.item_claim_key
          : null;
      const holdKey = claimKey || idempotencyKey || `pay_${crypto.randomUUID()}`;
      if (claimKey) splitClaimKey = claimKey;
      const hold = await holdOrderShare(guardSql, {
        orderId: guardOrderId,
        venue: String(guardMeta.venue ?? "main"),
        holdKey,
        requestedMinor: orderPortion,
      });
      if (hold) {
        if (hold.grantedMinor > 0) {
          splitHold = { orderId: guardOrderId, holdKey };
        }
        body.amount = hold.grantedMinor + tipMinor;
        if (body.amount <= 0) {
          await finalizeIntent(null);
          return jsonResponse(
            { error: { message: "This bill is already paid." } },
            409,
          );
        }
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
    // Test-mode DECLINE path: an explicit `simulate: "failed"` (never set by real
    // flows) lets QA / E2E exercise a declined payment end-to-end. The failed
    // attempt is still written to the durable ledger — with a decline reason — so
    // it shows up in the merchant's payments list (status=failed), exactly like a
    // real decline. This is how we prove "payments even if they fail are recorded".
    const simulate = String(meta.simulate ?? meta.simulate_status ?? "")
      .trim()
      .toLowerCase();
    if (["failed", "fail", "declined", "decline"].includes(simulate)) {
      const failedId = `test_${crypto.randomUUID().replace(/-/g, "")}`;
      const reason = "Simulated decline (test mode)";
      const code = "TEST_DECLINED";
      await recordLedger(workerEnv, {
        id: failedId,
        amount: body.amount,
        currency: body.currency || "KES",
        status: "failed",
        venue: typeof meta.venue === "string" ? meta.venue : null,
        reference: typeof meta.till === "string" ? meta.till : null,
        metadata: { ...meta, error_code: code, error_message: reason },
      });
      const failBody = {
        payment_id: failedId,
        client_secret: null,
        status: "failed",
        amount: body.amount,
        currency: body.currency || "KES",
        test_mode: true,
        error: { code, message: reason },
      };
      if (idempotencyKey) {
        await rememberIdempotent(workerEnv, idempotencyKey, failBody);
      }
      // A declined attempt is never charged: hand the reserved share back now.
      if (splitHold) {
        if (splitClaimKey) {
          await releaseOrderItemClaims(
            paymentIntentSql,
            splitHold.orderId,
            splitClaimKey,
          );
        } else {
          await releaseOrderShare(
            paymentIntentSql,
            splitHold.orderId,
            splitHold.holdKey,
          );
        }
        splitHold = null;
      }
      await finalizeIntent(failedId);
      return jsonResponse(failBody, 200);
    }
    const paymentId = `test_${crypto.randomUUID().replace(/-/g, "")}`;
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
      await rememberIdempotent(workerEnv, idempotencyKey, responseBody);
    }
    await finalizeIntent(paymentId);
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
        await finalizeIntent(null);
        return jsonResponse(
          { error: intent.error || { message: "M-Pesa STK failed" } },
          apiResponse.status || 502,
        );
      }
      const paymentId = intent.payment_id || intent.id;
      const status = mapPesaSwapStatus(intent.status);
      const responseBody = {
        payment_id: paymentId,
        client_secret: intent.client_secret ?? null,
        status,
        amount: body.amount,
        currency: body.currency || "KES",
        stk: true,
      };
      await finalizeIntent(String(paymentId));
      if (idempotencyKey) {
        await rememberIdempotent(workerEnv, idempotencyKey, responseBody);
      }
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
      return jsonResponse(responseBody, 201);
    } catch (err) {
      console.error("[PesaSwap] M-Pesa STK exception:", err);
      await finalizeIntent(null);
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
      await finalizeIntent(null);
      return jsonResponse({ error: paymentIntent.error }, apiResponse.status);
    }

    const paymentRecord = {
      id: paymentIntent.payment_id || paymentIntent.id,
      amount: body.amount,
      currency: body.currency || "KES",
      status: paymentIntent.status || "requires_payment_method",
      metadata: (body.metadata as Record<string, unknown>) || {},
      created_at: new Date().toISOString(),
    };

    const responseBody = {
      payment_id: paymentRecord.id,
      client_secret: paymentIntent.client_secret,
      status: paymentRecord.status,
      amount: body.amount,
      currency: body.currency || "KES",
    };
    await finalizeIntent(String(paymentRecord.id));
    if (idempotencyKey) {
      await rememberIdempotent(workerEnv, idempotencyKey, responseBody);
    }

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

    return jsonResponse(responseBody, 201);
  } catch (err) {
    console.error("[PesaSwap] Payment creation error:", err);
    // finalizeIntent(paymentId) already bound any provider-created payment. Only
    // pre-provider failures release the one-time intent and split reservation.
    if (!boundProviderPaymentId) await finalizeIntent(null);
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
  if (!roleAtLeast(payload, "manager") || !tokenHasScope(payload, "payments:write")) {
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
  // A retry may correct the destination phone, but never the authoritative amount.
  const overrides = (await request.json().catch(() => ({}))) as {
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
  const amount = Number(row.amount) || 0;
  if (amount <= 0) {
    return jsonResponse({ error: { message: "amount must be positive" } }, 400);
  }

  const retryKey = `payment-retry:${venue}:${paymentId}`;
  const retryGuard = await idempotentGuard(workerEnv, retryKey);
  if ("replay" in retryGuard) return jsonResponse(retryGuard.replay, 200);

  const retryIntent = await createPaymentIntent(workerEnv, {
    venue,
    amount,
    currency: String(row.currency ?? "KES"),
    sourceType: "tapgo",
    sourceId: paymentId,
    allowedMethod: "m_pesa_express",
    maxTipAmount: 0,
    metadata: meta,
  });
  if ("error" in retryIntent) {
    return jsonResponse({ error: { message: retryIntent.error } }, 503);
  }
  // Reuse the full create path with a newly bound one-time intent.
  const replay = new Request("https://internal/api/payments/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      amount,
      currency: String(row.currency ?? "KES"),
      payment_intent_token: retryIntent.token,
      description: `Re-request of ${paymentId}`,
      metadata: meta,
    }),
  });
  const response = await handleCreatePayment(replay, workerEnv);
  if (response.ok) {
    await rememberIdempotent(
      workerEnv,
      retryKey,
      await response.clone().json().catch(() => ({ ok: true })),
    );
  }
  return response;
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
  if (!roleAtLeast(payload, "manager") || !tokenHasScope(payload, "payments:read")) {
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
    // PURE DB READ, ONE round-trip — no PesaSwap call on this hot path, so the panel
    // loads at DB speed. Authoritative sync (refunds + stuck payments) runs OFF this
    // path via POST /api/payments/sync (client background sync, Force Sync button,
    // client /status poll). The page of rows + each row's refunded total come back in
    // a single query: a LEFT JOIN onto the per-parent refund totals.
    const rows = statusFilter
      ? await sql`
          WITH refunds AS (
            SELECT metadata->>'refund_of' AS parent, sum(amount)::bigint AS refunded
            FROM payments
            WHERE venue_id = ${venue} AND kind = 'refund' AND status = 'refunded'
              AND metadata->>'refund_of' IS NOT NULL
            GROUP BY metadata->>'refund_of'
          )
          SELECT p.id, p.amount, p.currency, p.status, p.kind, p.reference,
                 p.provider_ref, p.tip_amount, p.staff_id, p.initiator, p.metadata,
                 p.created_at, COALESCE(r.refunded, 0)::bigint AS refunded_amount
          FROM payments p
          LEFT JOIN refunds r ON r.parent = p.id
          WHERE p.venue_id = ${venue} AND p.status = ${statusFilter}
          ORDER BY p.created_at DESC
          LIMIT ${limit}`
      : await sql`
          WITH refunds AS (
            SELECT metadata->>'refund_of' AS parent, sum(amount)::bigint AS refunded
            FROM payments
            WHERE venue_id = ${venue} AND kind = 'refund' AND status = 'refunded'
              AND metadata->>'refund_of' IS NOT NULL
            GROUP BY metadata->>'refund_of'
          )
          SELECT p.id, p.amount, p.currency, p.status, p.kind, p.reference,
                 p.provider_ref, p.tip_amount, p.staff_id, p.initiator, p.metadata,
                 p.created_at, COALESCE(r.refunded, 0)::bigint AS refunded_amount
          FROM payments p
          LEFT JOIN refunds r ON r.parent = p.id
          WHERE p.venue_id = ${venue}
          ORDER BY p.created_at DESC
          LIMIT ${limit}`;

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
          sourceId: (meta.source_id as string) || null,
          invoiceNumber: (meta.invoice_number as string) || null,
          errorMessage: (meta.error_message as string) || null,
          // Refund context: how much has been refunded on this payment (minor
          // units), and — for a refund row — which payment it reverses + why.
          refundedAmount: Number(r.refunded_amount) || 0,
          refundOf: (meta.refund_of as string) || null,
          refundReason: (meta.refund_reason as string) || null,
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

// Force Sync (gated manager+): pull the authoritative state from PesaSwap on demand
// — reconcile refunds AND any still-"processing" payments — so the merchant can
// resync without waiting for the (unreliable) outgoing webhook. Mirrors the
// "Force Sync" action on the PesaSwap dashboard.
async function handleSyncPayments(
  request: Request,
  workerEnv: unknown,
): Promise<Response> {
  const url = new URL(request.url);
  const payload = await requireAuth(request, workerEnv);
  if (!payload) return jsonResponse({ error: { message: "unauthorized" } }, 401);
  if (!roleAtLeast(payload, "manager") || !tokenHasScope(payload, "payments:write")) {
    return jsonResponse({ error: { message: "forbidden" } }, 403);
  }
  const venue = venueFromPayload(payload, url);
  const sql = getSql(workerEnv);
  if (!sql) return jsonResponse({ error: { message: "database not configured" } }, 503);
  const env = getEnv(workerEnv);

  // 1) Refunds: pull recent refunds and sync any we don't have.
  const refundsSynced = await reconcileRefunds(workerEnv, { limit: 100 });

  // 2) Stuck payments: re-poll any still-"processing" live payments for this venue
  // and record their terminal state (idempotent).
  let paymentsSynced = 0;
  if (env.PESASWAP_API_KEY) {
    try {
      const stale = await sql`
        SELECT id, amount, currency FROM payments
        WHERE venue_id = ${venue} AND status = 'processing'
          AND id LIKE 'pay_%'
        ORDER BY created_at DESC LIMIT 25`;
      for (const r of stale) {
        try {
          const resp = await fetch(`${env.PESASWAP_URL}/payments/${String(r.id)}`, {
            headers: { "api-key": env.PESASWAP_API_KEY, Accept: "application/json" },
          });
          if (!resp.ok) continue;
          const p = (await resp.json()) as Record<string, any>;
          const mapped = mapPesaSwapStatus(p.status);
          if (mapped === "processing") continue;
          const meta = (p.metadata ?? {}) as Record<string, unknown>;
          await recordLedger(workerEnv, {
            id: String(r.id),
            amount: settledAmount(p, mapped) || Number(r.amount) || 0,
            currency: (p.currency as string) || String(r.currency ?? "KES"),
            status: mapped === "cancelled" ? "failed" : mapped,
            venue: (meta.venue as string) || (meta.merchant_id as string) || venue,
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
          // A payment that PesaSwap now reports with refunds — capture them too.
          if (Array.isArray(p.refunds)) {
            for (const rf of p.refunds) {
              await recordRefundRow(workerEnv, {
                ...(rf as Record<string, unknown>),
                payment_id: (rf as { payment_id?: string }).payment_id || String(r.id),
              });
            }
          }
          paymentsSynced++;
        } catch {
          /* best-effort per payment */
        }
      }
    } catch {
      /* best-effort */
    }
  }

  return jsonResponse({ synced: true, refundsSynced, paymentsSynced });
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
        // Capture any refunds PesaSwap already has on this payment (a refund raised
        // from the PesaSwap dashboard arrives here even when the webhook fails).
        if (Array.isArray(p.refunds)) {
          for (const rf of p.refunds) {
            try {
              await recordRefundRow(workerEnv, {
                ...(rf as Record<string, unknown>),
                payment_id: (rf as { payment_id?: string }).payment_id || paymentId,
              });
            } catch {
              /* best-effort refund */
            }
          }
        }
        return jsonResponse({
          payment_id: paymentId,
          status,
          amount: p.amount,
          currency: p.currency,
          metadata: meta,
          provider_ref: (p.connector_transaction_id as string) || null,
          error_message: p.error_message ?? undefined,
        });
      }
    } catch {
      /* fall through to the durable ledger */
    }
  }

  // The ledger, not an isolate-local cache. A payment created by another isolate
  // is still a real payment; answering 404 for it was a load-only bug.
  const payment = await loadPayment(workerEnv, paymentId);
  if (!payment) {
    return jsonResponse({ error: { message: "Payment not found" } }, 404);
  }

  return jsonResponse({
    payment_id: payment.id,
    status: payment.status,
    amount: payment.amount,
    currency: payment.currency,
    metadata: payment.metadata,
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
  const payload = await requireAuth(request, workerEnv);
  if (!payload) return jsonResponse({ error: { message: "unauthorized" } }, 401);
  if (!roleAtLeast(payload, "manager") || !tokenHasScope(payload, "payments:write")) {
    return jsonResponse({ error: { message: "forbidden" } }, 403);
  }
  const venue = venueFromPayload(payload, new URL(request.url));
  const sql = getSql(workerEnv);
  if (!sql) return jsonResponse({ error: { message: "database not configured" } }, 503);
  const [stored] = await sql`
    SELECT amount, currency, metadata
    FROM payments
    WHERE id = ${paymentId} AND venue_id = ${venue}
    LIMIT 1`;
  if (!stored) return jsonResponse({ error: { message: "payment not found" } }, 404);
  const env = getEnv(workerEnv);
  const body = (await request.json().catch(() => ({}))) as { amount?: number };
  const amount = Number(stored.amount) || Number(body.amount ?? 0);
  const currency = String(stored.currency ?? "KES");
  const metadata = (stored.metadata ?? {}) as Record<string, unknown>;

  const testMode =
    typeof env.PAYMENTS_TEST_MODE === "string" &&
    env.PAYMENTS_TEST_MODE !== "" &&
    env.PAYMENTS_TEST_MODE !== "0" &&
    env.PAYMENTS_TEST_MODE.toLowerCase() !== "false";

  async function settleCaptured() {
    await recordLedger(workerEnv, {
      id: paymentId,
      amount,
      currency,
      status: "captured",
      venue,
      metadata,
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
  const payload = await requireAuth(request, runtimeEnv);
  if (!payload) {
    return jsonResponse({ error: { message: "unauthorized" } }, 401);
  }
  if (!roleAtLeast(payload, "manager") || !tokenHasScope(payload, "payments:write")) {
    return jsonResponse({ error: { message: "forbidden" } }, 403);
  }
  const url = new URL(request.url);
  const venue = venueFromPayload(payload, url);
  const body = (await request.json().catch(() => ({}))) as RefundRequest;

  if (!body.payment_id) {
    return jsonResponse({ error: { message: "payment_id is required" } }, 400);
  }
  if (
    ![
      "customer_request",
      "item_quality",
      "overcharge",
      "duplicate",
      "other",
    ].includes(body.reason)
  ) {
    return jsonResponse({ error: { message: "invalid refund reason" } }, 400);
  }

  const env = getEnv(runtimeEnv);
  if (!env.PESASWAP_API_KEY && isProductionRuntime(runtimeEnv)) {
    return jsonResponse({ error: { message: "refund service unavailable" } }, 503);
  }
  const sql = getSql(runtimeEnv);
  if (!sql) {
    return jsonResponse({ error: { message: "database not configured" } }, 503);
  }
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim();
  if (!idempotencyKey) {
    return jsonResponse({ error: { message: "Idempotency-Key required" } }, 400);
  }
  const requestedInput = body.amount == null ? null : Math.round(Number(body.amount));
  const requestHash = await sha256Hex(JSON.stringify({
    venue,
    paymentId: body.payment_id,
    amount: requestedInput,
    reason: body.reason,
    items: body.items ?? [],
  }));
  const providerKey = `refund:${venue}:${body.payment_id}:${await sha256Hex(idempotencyKey)}`;
  const reservationId = `rr_${crypto.randomUUID().replace(/-/g, "")}`;
  const reserved = await sql.begin(async (tx) => {
    const [parent] = await tx`
      SELECT p.amount::bigint AS amount, p.currency, p.metadata
      FROM payments p
      WHERE p.id = ${body.payment_id}
        AND p.venue_id = ${venue}
        AND p.kind <> 'refund'
        AND p.status IN ('succeeded','paid','captured','partially_refunded','refunded')
      FOR UPDATE`;
    if (!parent) return { error: "not_found" as const };
    const [existing] = await tx`
      SELECT id, amount, status, request_hash, provider_key,
             provider_refund_id, provider_status, provider_response
      FROM refund_reservations
      WHERE venue_id = ${venue} AND payment_id = ${body.payment_id}
        AND idempotency_key = ${idempotencyKey}
      LIMIT 1
      FOR UPDATE`;
    if (existing) {
      if (String(existing.request_hash) !== requestHash) {
        return { error: "idempotency_conflict" as const };
      }
      return {
        id: String(existing.id),
        amount: Number(existing.amount),
        parent,
        replay: true,
        status: String(existing.status),
        providerKey: String(existing.provider_key),
        providerRefundId: existing.provider_refund_id
          ? String(existing.provider_refund_id)
          : null,
        providerStatus: existing.provider_status
          ? String(existing.provider_status)
          : null,
        providerResponse: existing.provider_response as Record<string, unknown> | null,
      };
    }
    const [totals] = await tx`
      SELECT
        COALESCE((SELECT sum(r.amount) FROM payments r
                  WHERE r.kind = 'refund' AND r.status = 'refunded'
                    AND r.metadata->>'refund_of' = ${body.payment_id}), 0)::bigint AS settled,
        COALESCE((SELECT sum(rr.amount) FROM refund_reservations rr
                  WHERE rr.venue_id = ${venue} AND rr.payment_id = ${body.payment_id}
                    AND rr.status IN ('reserved','submitting','unknown','pending')), 0)::bigint AS reserved`;
    const original = Number(parent.amount) || 0;
    const used = Number(totals?.settled ?? 0) + Number(totals?.reserved ?? 0);
    const requested = body.amount == null ? original - used : Number(body.amount);
    const amount = Number.isFinite(requested) ? Math.round(requested) : 0;
    if (amount <= 0) return { error: "invalid" as const };
    if (used + amount > original) return { error: "exceeds" as const, used };
    await tx`
      INSERT INTO refund_reservations
        (id, venue_id, payment_id, idempotency_key, amount,
         request_hash, provider_key)
      VALUES
        (${reservationId}, ${venue}, ${body.payment_id}, ${idempotencyKey}, ${amount},
         ${requestHash}, ${providerKey})`;
    return {
      id: reservationId,
      amount,
      parent,
      replay: false,
      status: "reserved",
      providerKey,
      providerRefundId: null,
      providerStatus: null,
      providerResponse: null,
    };
  });
  if ("error" in reserved) {
    if (reserved.error === "not_found") return jsonResponse({ error: { message: "payment not found" } }, 404);
    if (reserved.error === "exceeds") return jsonResponse({ error: { message: "Refund would exceed original payment." } }, 409);
    if (reserved.error === "idempotency_conflict") return jsonResponse({ error: { message: "Idempotency-Key was already used for different refund inputs." } }, 409);
    return jsonResponse({ error: { message: "Invalid refund amount" } }, 400);
  }
  const parent = reserved.parent;
  const refundAmount = reserved.amount;

  if (reserved.replay && ["pending", "booked", "failed", "cancelled"].includes(reserved.status)) {
    const response = reserved.providerResponse ?? {};
    const settled = reserved.status === "booked";
    return jsonResponse({
      ...response,
      refund_id: reserved.providerRefundId,
      payment_id: body.payment_id,
      amount: refundAmount,
      status: settled ? "succeeded" : reserved.status,
      replay: true,
    }, settled ? 200 : reserved.status === "pending" ? 202 : 409);
  }

  try {
    await sql`
      UPDATE refund_reservations
      SET status = 'submitting', submitted_at = COALESCE(submitted_at, now()),
          updated_at = now()
      WHERE id = ${reserved.id}
        AND status IN ('reserved','submitting','unknown')`;
    // Call PesaSwap Refund API
    const apiResponse = await fetch(`${env.PESASWAP_URL}/refunds`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "api-key": env.PESASWAP_API_KEY,
        "Idempotency-Key": reserved.providerKey,
      },
      body: JSON.stringify({
        payment_id: body.payment_id,
        amount: refundAmount,
        reason: body.reason,
        metadata: {
          refunded_items: body.items ? JSON.stringify(body.items) : undefined,
          original_payment_metadata: parent.metadata,
          ...body.metadata,
          refunded_by:
            (payload.name as string) ||
            (payload.sub as string) ||
            (payload.tokenId as string) ||
            "manager",
        },
      }),
    });

    const refundResult = (await apiResponse.json().catch(() => null)) as
      | Record<string, unknown>
      | null;

    if (!apiResponse.ok || !refundResult || refundResult.error) {
      const definitive = apiResponse.status >= 400 && apiResponse.status < 500;
      await sql`
        UPDATE refund_reservations
        SET status = ${definitive ? "failed" : "unknown"},
            provider_status = ${String(refundResult?.status ?? apiResponse.status)},
            provider_response = ${refundResult ? sql.json(JSON.parse(JSON.stringify(refundResult))) : null},
            last_error = ${String(refundResult?.message ?? `provider HTTP ${apiResponse.status}`)},
            next_reconcile_at = now() + interval '1 minute', updated_at = now()
        WHERE id = ${reserved.id}`;
      return jsonResponse(
        {
          error:
            refundResult?.error ?? {
              message: String(refundResult?.message ?? "Refund provider outcome is pending reconciliation"),
            },
        },
        definitive ? apiResponse.status : 202,
      );
    }

    const providerStatus = String(refundResult.status ?? "pending").toLowerCase();
    const settled = providerStatus === "succeeded" || providerStatus === "refunded";
    const providerRefundId = refundResult.refund_id || refundResult.id;
    if (typeof providerRefundId !== "string" || !providerRefundId.trim()) {
      await sql`
        UPDATE refund_reservations
        SET status = 'unknown', provider_status = ${providerStatus},
            provider_response = ${sql.json(JSON.parse(JSON.stringify(refundResult)))},
            last_error = 'provider response omitted refund id',
            next_reconcile_at = now() + interval '1 minute', updated_at = now()
        WHERE id = ${reserved.id}`;
      return jsonResponse({ error: { message: "Refund accepted but awaiting provider reconciliation" } }, 202);
    }
    const refundRecord = {
      id: providerRefundId.trim(),
      amount: refundAmount,
      reason: body.reason,
      created_at: new Date().toISOString(),
    };
    await sql`
      UPDATE refund_reservations
        SET status = ${settled ? "pending" : "pending"},
          provider_refund_id = ${refundRecord.id}, provider_status = ${providerStatus},
          provider_response = ${sql.json(JSON.parse(JSON.stringify(refundResult)))},
          last_error = NULL, updated_at = now()
      WHERE id = ${reserved.id}`;

    // A provider acceptance is not a settlement. Only a terminal succeeded
    // refund may change the parent, GL, loyalty, or local UI state. Pending
    // refunds are learned later through the authenticated pull reconcile.
    // The parent's refunded/partially_refunded status is set by
    // `updateParentRefundStatus` against the ledger, not here.

    // Notify merchant via WebSocket
    const parentMeta = (parent.metadata ?? {}) as Record<string, unknown>;
    const merchantId = (parentMeta.merchant_id as string) || venue;
    await broadcastToMerchant(runtimeEnv, merchantId, {
      type: settled ? "payment.refunded" : "payment.refund_pending",
      data: {
        refund_id: refundRecord.id,
        payment_id: body.payment_id,
        amount: refundAmount,
        reason: body.reason,
        refunded_by:
          (payload.name as string) || (payload.sub as string) || "manager",
        timestamp: refundRecord.created_at,
      },
    });

    // Use the shared idempotent refund recorder; it deliberately ignores
    // pending/failed refunds and derives tenant metadata from the parent row.
    if (settled) {
      const booked = await recordRefundRow(runtimeEnv, {
        ...refundResult,
        refund_id: String(refundRecord.id),
        payment_id: body.payment_id,
        amount: refundAmount,
        currency: String(parent.currency || "KES"),
        status: "succeeded",
        reason: body.reason,
        refund_reservation_id: reserved.id,
      });
      await sql`
        UPDATE refund_reservations
        SET status = 'booked', provider_status = 'succeeded', updated_at = now()
        WHERE id = ${reserved.id}
          AND (${booked} OR EXISTS (SELECT 1 FROM payments WHERE id = ${refundRecord.id}))`;
    }

    return jsonResponse(
      {
        refund_id: refundRecord.id,
        payment_id: body.payment_id,
        amount: refundAmount,
        status: settled ? "succeeded" : "pending",
        created_at: refundRecord.created_at,
      },
      settled ? 201 : 202,
    );
  } catch (err) {
    await sql`
      UPDATE refund_reservations
      SET status = 'unknown', last_error = ${err instanceof Error ? err.message.slice(0, 1000) : String(err).slice(0, 1000)},
          next_reconcile_at = now() + interval '1 minute', updated_at = now()
      WHERE id = ${reserved.id} AND status <> 'booked'`.catch(() => {});
    console.error("[PesaSwap] Refund error:", err);
    return jsonResponse({ error: { message: "Failed to process refund" } }, 500);
  }
}

// --- Webhook Handler ---

async function handleWebhook(
  request: Request,
  runtimeEnv: unknown,
): Promise<Response> {
  const env = getEnv(runtimeEnv);
  const rawBody = await request.text();
  const sig512 = request.headers.get("x-webhook-signature-512") || "";
  const sig256 =
    request.headers.get("x-webhook-signature-256") ||
    request.headers.get("x-pesaswap-signature") ||
    "";
  // Always ACK 200 — a non-2xx trips PesaSwap's "CallToMerchantFailed" + 24h of
  // retries. Processing is fast because we NEVER do a synchronous verify-by-callback
  // here: that ~1s round-trip to PesaSwap is what pushed our response past
  // PesaSwap's aggressive delivery timeout. A signature-verified payload is
  // processed inline; anything else is ACKed and reconciled by the pull paths.
  try {
    return await processWebhook(env, runtimeEnv, rawBody, { sig512, sig256 });
  } catch (err) {
    console.error("[PesaSwap] Webhook processing error (acknowledged):", err);
    return jsonResponse({ received: true });
  }
}

async function processWebhook(
  env: Env,
  runtimeEnv: unknown,
  rawBody: string,
  sigs: { sig512: string; sig256: string },
): Promise<Response> {
  // PesaSwap sends the payment object in one of two shapes:
  //  - wrapped envelope: { event_type, event_id, content: { object } }
  //  - the payment object at the TOP LEVEL (payment_id + status at the root) ← live
  // Our own simulator uses { type, data }. Accept ALL of them.
  const body = JSON.parse(rawBody) as Record<string, any>;
  const eventType: string = body.event_type || body.type || "";
  const resource: Record<string, any> =
    body.content?.object ||
    body.content ||
    body.data ||
    (body.payment_id || body.status ? body : {});
  const paymentId: string =
    resource.payment_id || resource.id || body.payment_id || "";

  // --- Establish trust BEFORE acting on the webhook ---
  // A forged `payment_succeeded` must never be recorded as a real sale. Trust is
  // established by a valid HMAC signature ONLY — a fast, LOCAL check with no network.
  // We deliberately do NOT verify-by-callback here: that ~1s round-trip to PesaSwap
  // is what tripped its delivery timeout → CallToMerchantFailed. An unsigned /
  // unverifiable webhook is ACKed (200) and its authoritative state is pulled by the
  // reconcile paths (client status-poll, the refunds/list + processing reconcile on
  // /api/payments/list, and the on-demand Force Sync) — all of which re-fetch with
  // our api-key, so a forged webhook can never be recorded as a real transaction.
  const { sig512, sig256 } = sigs;
  let trusted = false;
  if (env.PESASWAP_WEBHOOK_SECRET && (sig512 || sig256)) {
    trusted = sig512
      ? await verifyWebhookSignature(rawBody, sig512, env.PESASWAP_WEBHOOK_SECRET, "SHA-512")
      : await verifyWebhookSignature(rawBody, sig256, env.PESASWAP_WEBHOOK_SECRET, "SHA-256");
  }

  console.info(
    `[PesaSwap] Webhook: ${eventType || resource.status} ${paymentId}${trusted ? "" : " (unverified — reconciled via pull)"}`,
  );

  if (!trusted) {
    // Fast ACK so PesaSwap never records CallToMerchantFailed. The pull reconcile
    // captures the authoritative state; we never act on unverified data.
    return jsonResponse({ received: true });
  }

  // A refund event carries a refund object (refund_id + the refund's own status),
  // NOT a payment — so it must never be treated as a payment success/failure.
  const isRefundEvent =
    Boolean(resource.refund_id) || /refund/i.test(eventType);
  // A dispute / chargeback likewise is not a payment success/failure.
  const isDispute = isDisputeEvent(eventType, resource);

  // Audit trail: persist EVERY trusted webhook (idempotent on the provider event
  // id) so the merchant has an auditable timeline matching the PesaSwap dashboard.
  {
    const evtMeta = (resource.metadata || {}) as Record<string, unknown>;
    const evtVenue =
      (evtMeta.venue as string) || (evtMeta.merchant_id as string) || null;
    await recordPaymentEvent(runtimeEnv, {
      eventId: (body.event_id as string) || null,
      venue: evtVenue,
      paymentId: paymentId || null,
      eventType: eventType || (resource.status as string) || "",
      status: (resource.status as string) || null,
      amount: Number(resource.amount) || null,
      currency: (resource.currency as string) || "KES",
      raw: body,
    });
  }

  // Effective status: the record's status maps to the real terminal state, else we
  // infer from the event name.
  const mappedStatus = resource.status ? mapPesaSwapStatus(resource.status) : "";
  const isSuccess =
    !isRefundEvent &&
    !isDispute &&
    (mappedStatus === "succeeded" ||
      eventType === "payment_succeeded" ||
      eventType === "payment_captured" ||
      eventType === "payment.succeeded" ||
      eventType === "payment_intent.succeeded");
  const isFailure =
    !isRefundEvent &&
    !isDispute &&
    !isSuccess &&
    (mappedStatus === "failed" ||
      mappedStatus === "cancelled" ||
      eventType === "payment_failed" ||
      eventType === "payment_cancelled" ||
      eventType === "payment.failed" ||
      eventType === "payment_intent.payment_failed");

  if (isSuccess) {
      // A provider webhook is an inbound request: it almost never lands on the
      // isolate that created the payment, so this MUST come from the ledger.
      const payment = await loadPayment(runtimeEnv, paymentId);

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
      await broadcastToMerchant(runtimeEnv, merchantId, {
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
      const payment = await loadPayment(runtimeEnv, paymentId);

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
      await broadcastToMerchant(runtimeEnv, merchantId, {
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

  // Sync refunds carried on this trusted webhook. Two shapes: (a) the payment record
  // carries a refunds[] array; or (b) the event IS a refund (resource is the refund
  // object, with a refund_id). Both are idempotent (recordRefundRow short-circuits on
  // the refund id) so this is safe on every webhook.
  if (Array.isArray(resource.refunds)) {
    for (const rf of resource.refunds) {
      try {
        await recordRefundRow(runtimeEnv, {
          ...(rf as Record<string, unknown>),
          payment_id: (rf as { payment_id?: string }).payment_id || paymentId,
        });
      } catch {
        /* best-effort refund */
      }
    }
  }
  if (isRefundEvent && resource.refund_id) {
    try {
      await recordRefundRow(runtimeEnv, {
        refund_id: resource.refund_id,
        payment_id: resource.payment_id || paymentId,
        amount: resource.amount,
        currency: resource.currency,
        status: resource.status || "succeeded",
        reason: resource.reason,
        connector_refund_id: resource.connector_refund_id,
        refund_arn: resource.refund_arn,
      });
    } catch {
      /* best-effort refund */
    }
  }

  // Sync disputes / chargebacks carried on this trusted webhook. Two shapes (same
  // as refunds): (a) the payment record carries a disputes[] array; or (b) the
  // event IS a dispute (resource has a dispute_id). Both are idempotent.
  if (Array.isArray(resource.disputes)) {
    for (const dp of resource.disputes) {
      try {
        await recordDispute(runtimeEnv, {
          ...(dp as Record<string, unknown>),
          payment_id: (dp as { payment_id?: string }).payment_id || paymentId,
        });
      } catch {
        /* best-effort dispute */
      }
    }
  }
  if (isDispute && resource.dispute_id) {
    try {
      const booked = await recordDispute(runtimeEnv, {
        dispute_id: resource.dispute_id,
        payment_id: resource.payment_id || paymentId,
        amount: resource.amount,
        currency: resource.currency,
        status: resource.status || "open",
        reason: resource.reason,
        connector_dispute_id: resource.connector_dispute_id,
        evidence_due_by: resource.evidence_due_by,
      });
      if (booked) {
        const evtMeta = (resource.metadata || {}) as Record<string, unknown>;
        await broadcastToMerchant(runtimeEnv, (evtMeta.merchant_id as string) || "", {
          type: "payment.disputed",
          data: {
            payment_id: resource.payment_id || paymentId,
            dispute_id: resource.dispute_id,
            amount: Number(resource.amount) || 0,
            status: mapDisputeStatus(resource.status as string),
            timestamp: new Date().toISOString(),
          },
        });
      }
    } catch {
      /* best-effort dispute */
    }
  }

  return jsonResponse({ received: true });
}

// --- WebSocket Real-Time ---

// The merchant's real-time Durable Object stub, or null when there is no DO
// binding. On Workers the DO is the ONLY correct hub (module globals are
// per-isolate); in dev (single-process node SSR) the null path uses the in-memory
// maps below, which are correct there because everything shares one process.
type HubStub = { fetch(req: Request): Promise<Response> };
function realtimeHub(env: unknown, merchantId: string): HubStub | null {
  const binding = (
    env as
      | { REALTIME?: { idFromName(name: string): unknown; get(id: unknown): HubStub } }
      | undefined
  )?.REALTIME;
  if (!binding || !merchantId) return null;
  return binding.get(binding.idFromName(merchantId));
}

async function handleRealtimeUpgrade(
  request: Request,
  env: unknown,
  merchantId: string,
): Promise<Response> {
  // Check for WebSocket upgrade
  const upgradeHeader = request.headers.get("Upgrade") || "";
  if (upgradeHeader.toLowerCase() !== "websocket") {
    return jsonResponse({ error: { message: "Expected WebSocket upgrade" } }, 426);
  }

  // Cloudflare: hand the socket to the merchant's Durable Object so an event
  // emitted from any isolate (e.g. a payment webhook) can reach it.
  const hub = realtimeHub(env, merchantId);
  if (hub) return hub.fetch(request);

  // Dev (node SSR): a single process, so the in-memory registry below works.
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

async function handleNotifications(
  url: URL,
  env: unknown,
  merchantId: string,
): Promise<Response> {
  const since = url.searchParams.get("since") || "";

  // Cloudflare: read the merchant DO's durable buffer (correct across isolates).
  const hub = realtimeHub(env, merchantId);
  if (hub) {
    return hub.fetch(
      new Request(`https://hub/notifications?since=${encodeURIComponent(since)}`),
    );
  }

  // Dev fallback (single-process in-memory buffer).
  const events = recentEvents.get(merchantId) || [];
  const filtered = since ? events.filter((e) => e.timestamp > since) : events;

  return jsonResponse(filtered.map((e) => e.event));
}

// --- Broadcast helper ---

async function broadcastToMerchant(
  env: unknown,
  merchantId: string,
  event: unknown,
): Promise<void> {
  // Cloudflare: post to the merchant's Durable Object, which fans out to its live
  // sockets and appends to the durable polling buffer — reliable across isolates.
  const hub = realtimeHub(env, merchantId);
  if (hub) {
    try {
      await hub.fetch(
        new Request("https://hub/broadcast", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(event),
        }),
      );
    } catch {
      /* best-effort — real-time is never allowed to fail a payment flow */
    }
    return;
  }

  // Dev (single-process node SSR): in-memory fan-out + buffer.
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

