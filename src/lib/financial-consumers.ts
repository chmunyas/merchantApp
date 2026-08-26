import {
  postCogsEntryInTransaction,
  postEntryInTransaction,
  postPaymentEntryInTransaction,
} from "@/lib/accounting";
import { activateSubscription } from "@/lib/billing";
import { commissionAmount } from "@/lib/commission";
import type { QuerySql, Sql } from "@/lib/db";
import {
  beginFinancialEffect,
  claimFinancialOutbox,
  completeFinancialEffect,
  failFinancialEffect,
} from "@/lib/financial-events";
import { reconcileInvoiceBalance, settleInvoicePayment } from "@/lib/invoicing";
import { loyaltyPointsFor } from "@/lib/loyalty";
import { recordTenderIntent } from "@/lib/pos-tender-jobs";
import { recoverWalkoutsForPaidOrder } from "@/lib/walkouts";

function payloadOf(row: Record<string, unknown>) {
  return row.payload as {
    paymentId: string;
    venue: string;
    amount: number;
    currency: string;
    status: string;
    kind: string;
    providerRef?: string | null;
    reference?: string | null;
    metadata: Record<string, unknown>;
  };
}

type RefundAllocation = {
  gross: number;
  principal: number;
  tip: number;
  tax: number;
  commission: number;
  loyalty: number;
  cogs: number;
};

export function cumulativeAllocation(
  component: number,
  gross: number,
  refunded: number,
): number {
  if (component <= 0 || gross <= 0 || refunded <= 0) return 0;
  if (refunded >= gross) return component;
  return Math.floor(component * refunded / gross);
}

async function refundAllocation(
  sql: QuerySql,
  row: Record<string, unknown>,
  p: ReturnType<typeof payloadOf>,
): Promise<RefundAllocation> {
  const parentId = String(p.metadata?.refund_of ?? "");
  const [snapshot] = await sql`
    SELECT gross_amount, principal_amount, tip_amount, tax_amount,
           commission_amount, loyalty_points, cogs_amount
    FROM financial_payment_snapshots
    WHERE payment_id = ${parentId} AND venue_id = ${String(row.venue_id)}`;
  if (!snapshot) {
    throw new Error(`missing financial snapshot for refund parent ${parentId}`);
  }
  const [reversal] = await sql`
    SELECT cumulative_before, cumulative_after
    FROM financial_reversals
    WHERE venue_id = ${String(row.venue_id)} AND refund_id = ${p.paymentId}
      AND payment_id = ${parentId}`;
  if (!reversal) throw new Error(`missing financial reversal ${p.paymentId}`);
  const before = Number(reversal.cumulative_before);
  const after = Number(reversal.cumulative_after);
  const gross = Number(snapshot.gross_amount);
  const delta = (component: unknown) =>
    cumulativeAllocation(Number(component), gross, after) -
    cumulativeAllocation(Number(component), gross, before);
  return {
    gross: p.amount,
    principal: delta(snapshot.principal_amount),
    tip: delta(snapshot.tip_amount),
    tax: delta(snapshot.tax_amount),
    commission: delta(snapshot.commission_amount),
    loyalty: delta(snapshot.loyalty_points),
    cogs: delta(snapshot.cogs_amount),
  };
}

async function recordAdjustment(
  sql: QuerySql,
  row: Record<string, unknown>,
  p: ReturnType<typeof payloadOf>,
  component: string,
  amount: number,
): Promise<void> {
  if (amount <= 0) return;
  await sql`
    INSERT INTO financial_adjustments
      (event_id, venue_id, payment_id, refund_id, component, amount)
    VALUES
      (${String(row.event_id)}, ${String(row.venue_id)},
       ${String(p.metadata.refund_of ?? "")}, ${p.paymentId}, ${component}, ${amount})
    ON CONFLICT (event_id, component) DO NOTHING`;
}

async function consumePayment(
  sql: QuerySql,
  row: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const eventType = String(row.event_type);
  const consumer = String(row.consumer);
  const p = payloadOf(row);
  const meta = p.metadata ?? {};
  const tip = Math.max(0, Math.round(Number(meta.tip_amount) || 0));

  if (eventType === "refund.succeeded") {
    const allocation = await refundAllocation(sql, row, p);
    if (consumer === "accounting-reversal") {
      // Internal estimate membership is not bank evidence. Refunds continue to
      // credit clearing until a provider-evidenced payout match exists.
      const cashAccount = "1000";
      const isInvoiceCollection = Boolean(meta.invoice_number);
      const salesReturn = isInvoiceCollection
        ? 0
        : Math.max(0, allocation.principal - allocation.tax);
      const lines = isInvoiceCollection
        ? [
            ...(allocation.principal > 0
              ? [{ account: "1100", debit: allocation.principal }]
              : []),
            ...(allocation.tip > 0
              ? [{ account: "2000", debit: allocation.tip }]
              : []),
            { account: cashAccount, credit: allocation.gross },
          ]
        : [
            ...(salesReturn > 0 ? [{ account: "4900", debit: salesReturn }] : []),
            ...(allocation.tax > 0 ? [{ account: "2100", debit: allocation.tax }] : []),
            ...(allocation.tip > 0 ? [{ account: "2000", debit: allocation.tip }] : []),
            { account: cashAccount, credit: allocation.gross },
          ];
      await postEntryInTransaction(sql, {
        venue: p.venue,
        sourceType: "refund",
        sourceId: p.paymentId,
        currency: p.currency,
        memo: "Payment refunded",
        lines,
      });
      await recordAdjustment(sql, row, p, "principal", salesReturn);
      await recordAdjustment(sql, row, p, isInvoiceCollection ? "ar" : "tax",
        isInvoiceCollection ? allocation.principal : allocation.tax);
    }
    if (consumer === "commission-reversal") {
      const parentId = String(meta.refund_of ?? "");
      const [commission] = await sql`
        SELECT id, org_id FROM commission_ledger
        WHERE payment_id = ${parentId} AND venue_id = ${p.venue} LIMIT 1`;
      if (commission && allocation.commission > 0) {
        await sql`
          INSERT INTO commission_adjustments
            (org_id, venue_id, payment_id, refund_id, amount, event_id)
          VALUES (${commission.org_id}, ${p.venue}, ${parentId}, ${p.paymentId},
                  ${allocation.commission}, ${String(row.event_id)})
          ON CONFLICT (event_id) DO NOTHING`;
        await recordAdjustment(sql, row, p, "commission", allocation.commission);
      }
    }
    if (consumer === "loyalty-reversal") {
      const phone = String(meta.customer_phone ?? "");
      if (phone && allocation.loyalty > 0) {
        await sql`
          INSERT INTO loyalty_adjustments
            (venue_id, phone, payment_id, refund_id, points, event_id)
          VALUES (${p.venue}, ${phone}, ${String(meta.refund_of ?? "")},
                  ${p.paymentId}, ${-allocation.loyalty}, ${String(row.event_id)})
          ON CONFLICT (event_id) DO NOTHING`;
        await sql`
          UPDATE contacts SET points = GREATEST(0, points - ${allocation.loyalty})
          WHERE venue_id = ${p.venue} AND phone = ${phone}`;
        await recordAdjustment(sql, row, p, "loyalty", allocation.loyalty);
      }
    }
    if (consumer === "tip-reversal") {
      await recordAdjustment(sql, row, p, "tip", allocation.tip);
      if (allocation.tip > 0) {
        const [source] = await sql`
          SELECT tps.pool_id, tps.staff_id, tp.period, tp.currency
          FROM tip_pool_sources tps
          JOIN tip_pools tp ON tp.id = tps.pool_id
          WHERE tps.venue_id = ${p.venue}
            AND tps.payment_id = ${String(meta.refund_of ?? "")}`;
        if (source?.staff_id) {
          await sql`
            INSERT INTO tip_allocations
              (pool_id, venue_id, staff_id, amount, period, currency,
               entry_type, correction_of, source_id)
            VALUES (${source.pool_id}, ${p.venue}, ${source.staff_id},
                    ${-allocation.tip}, ${source.period}, ${source.currency},
                    'correction', NULL, ${p.paymentId})
            ON CONFLICT (pool_id, staff_id, source_id)
              WHERE entry_type = 'correction' AND source_id IS NOT NULL
            DO NOTHING`;
        }
      }
    }
    if (consumer === "cogs-reversal") {
      // Refund approval alone is not evidence that goods were returned or can be
      // restocked. Reverse the immutable COGS value only; inventory quantities
      // remain unchanged until an explicit item-return/restock workflow records
      // authoritative quantities.
      if (allocation.cogs > 0) {
        await postEntryInTransaction(sql, {
          venue: p.venue,
          sourceType: "cogs_refund",
          sourceId: p.paymentId,
          currency: p.currency,
          memo: "COGS reversed on refund",
          lines: [
            { account: "1200", debit: allocation.cogs },
            { account: "5000", credit: allocation.cogs },
          ],
        });
        await recordAdjustment(sql, row, p, "cogs", allocation.cogs);
      }
    }
    if (consumer === "invoice-reversal") {
      const invoiceNumber = String(meta.invoice_number ?? "");
      if (invoiceNumber) {
        await reconcileInvoiceBalance(sql, {
          venue: p.venue,
          invoiceNumber,
        });
      }
    }
    if (consumer === "order-reversal") {
      const orderId = String(meta.order_id ?? "");
      if (/^[0-9a-f-]{36}$/i.test(orderId)) {
        await sql`
          UPDATE orders o
          SET paid_at = CASE
            WHEN order_paid_minor(${p.venue}, ${orderId}::uuid) >= o.total
              THEN COALESCE(o.paid_at, now())
            ELSE NULL
          END
          WHERE o.id = ${orderId} AND o.venue_id = ${p.venue}`;
      }
    }
    if (consumer === "pay-link-reversal") {
      const payLinkId = String(meta.pay_link_id ?? "");
      if (/^[0-9a-f-]{36}$/i.test(payLinkId)) {
        await sql`
          UPDATE pay_links pl
          SET status = CASE WHEN (
            SELECT COALESCE(sum(CASE WHEN p2.kind = 'refund' THEN -COALESCE((
              SELECT sum(fa.amount) FROM financial_adjustments fa
              WHERE fa.refund_id = p2.id AND fa.component IN ('principal','ar')
            ), 0) ELSE p2.amount END), 0)
            FROM payments p2
            WHERE p2.venue_id = ${p.venue}
              AND (p2.metadata->>'pay_link_id' = ${payLinkId}
                OR (p2.kind = 'refund' AND p2.metadata->>'refund_of' IN (
                  SELECT id FROM payments WHERE venue_id = ${p.venue}
                    AND metadata->>'pay_link_id' = ${payLinkId}
                )))
              AND p2.status IN ('succeeded','paid','captured','partially_refunded','refunded')
          ) >= pl.amount THEN 'paid' ELSE 'pending' END,
          paid_at = CASE WHEN (
            SELECT COALESCE(sum(CASE WHEN p2.kind = 'refund' THEN -COALESCE((
              SELECT sum(fa.amount) FROM financial_adjustments fa
              WHERE fa.refund_id = p2.id AND fa.component IN ('principal','ar')
            ), 0) ELSE p2.amount END), 0)
            FROM payments p2
            WHERE p2.venue_id = ${p.venue}
              AND (p2.metadata->>'pay_link_id' = ${payLinkId}
                OR (p2.kind = 'refund' AND p2.metadata->>'refund_of' IN (
                  SELECT id FROM payments WHERE venue_id = ${p.venue}
                    AND metadata->>'pay_link_id' = ${payLinkId}
                )))
              AND p2.status IN ('succeeded','paid','captured','partially_refunded','refunded')
          ) >= pl.amount THEN COALESCE(pl.paid_at, now()) ELSE NULL END
          WHERE pl.id = ${payLinkId} AND pl.venue_id = ${p.venue}`;
      }
    }
    if (consumer === "settlement-reversal") {
      // Estimate-batch membership is not provider payout evidence. The immutable
      // reversal remains available for Phase 5 provider evidence matching; no
      // settlement adjustment is created until an actual paid payout is linked.
      return { refund: true, settlementAdjustment: "awaiting-provider-evidence" };
    }
    return { refund: true };
  }

  if (consumer === "accounting") {
    const invoice = String(meta.invoice_number ?? "");
    if (invoice && tip > 0) {
      await postEntryInTransaction(sql, {
        venue: p.venue,
        sourceType: "invoice_tip",
        sourceId: p.paymentId,
        currency: p.currency,
        memo: "Tip received with invoice payment",
        lines: [
          { account: "1000", debit: tip },
          { account: "2000", credit: tip },
        ],
      });
    } else if (!invoice) {
      await postPaymentEntryInTransaction(sql, {
        venue: p.venue,
        id: p.paymentId,
        amount: p.amount,
        tip,
        currency: p.currency,
      });
      const orderId = String(meta.order_id ?? "");
      if (/^[0-9a-f-]{36}$/i.test(orderId)) {
        const [cogs] = await sql`
          SELECT cogs_amount AS amount FROM financial_payment_snapshots
          WHERE payment_id = ${p.paymentId} AND venue_id = ${p.venue}`;
        if (Number(cogs?.amount) > 0) {
          await postCogsEntryInTransaction(sql, {
            venue: p.venue,
            orderId,
            cost: Number(cogs.amount),
          });
        }
      }
    }
  } else if (consumer === "invoice") {
    const invoiceNumber = String(meta.invoice_number ?? "");
    if (invoiceNumber) {
      await settleInvoicePayment(sql, {
        venue: p.venue,
        invoiceNumber,
        paymentId: p.paymentId,
        amountMinor: p.amount - tip,
        providerRef: p.providerRef,
      });
    }
  } else if (consumer === "commission") {
    const [org] = await sql`
      SELECT o.id, o.commission_bps
      FROM venues v JOIN organizations o ON o.id = v.org_id
      WHERE v.id = ${p.venue} LIMIT 1`;
    if (org?.id) {
      const bps = Number(org.commission_bps ?? 0);
      const [snapshot] = await sql`
        SELECT commission_amount FROM financial_payment_snapshots
        WHERE payment_id = ${p.paymentId} AND venue_id = ${p.venue}`;
      const amount = Number(snapshot?.commission_amount ?? commissionAmount(p.amount, bps));
      await sql`
        INSERT INTO commission_ledger
          (id, org_id, venue_id, payment_id, gross_amount,
           commission_bps, commission_amount)
        VALUES
          (${`cl_${crypto.randomUUID().slice(0, 12)}`}, ${org.id}, ${p.venue},
           ${p.paymentId}, ${p.amount}, ${bps}, ${amount})
        ON CONFLICT (payment_id) WHERE payment_id IS NOT NULL DO NOTHING`;
    }
  } else if (consumer === "subscription") {
    if (typeof meta.subscription_plan === "string") {
      await activateSubscription(
        sql,
        p.venue,
        meta.subscription_plan,
        p.paymentId,
        p.amount,
      );
    }
  } else if (consumer === "loyalty") {
    const phone = String(meta.customer_phone ?? "").trim();
    const [snapshot] = await sql`
      SELECT loyalty_points FROM financial_payment_snapshots
      WHERE payment_id = ${p.paymentId} AND venue_id = ${p.venue}`;
    const points = Number(snapshot?.loyalty_points ?? loyaltyPointsFor(p.amount - tip));
    if (phone && points > 0) {
      await sql`
        INSERT INTO contacts (venue_id, name, phone, points, visits, last_visit)
        VALUES (${p.venue}, ${String(meta.customer_name ?? "Guest")}, ${phone},
                ${points}, 1, now())
        ON CONFLICT (venue_id, phone) WHERE phone IS NOT NULL AND phone <> ''
        DO UPDATE SET points = contacts.points + ${points},
                      visits = contacts.visits + 1, last_visit = now()`;
    }
  } else if (consumer === "saved-method") {
    const phone = String(meta.customer_phone ?? "").trim();
    if (phone) {
      await sql`
        INSERT INTO customer_payment_methods (venue_id, phone, kind, label)
        VALUES (${p.venue}, ${phone}, 'mpesa', ${`M-Pesa •••${phone.slice(-4)}`})
        ON CONFLICT (venue_id, phone, COALESCE(provider_ref, kind))
        DO UPDATE SET last_used_at = now()`;
    }
  } else if (consumer === "order") {
    const orderId = String(meta.order_id ?? "");
    if (/^[0-9a-f-]{36}$/i.test(orderId)) {
      const [order] = await sql`
        SELECT o.total::bigint AS total,
               order_paid_minor(${p.venue}, ${orderId}::uuid) AS paid
        FROM orders o WHERE o.id = ${orderId} AND o.venue_id = ${p.venue}
        LIMIT 1`;
      if (order && Number(order.paid) >= Number(order.total)) {
        await sql`
          UPDATE orders SET paid_at = COALESCE(paid_at, now())
          WHERE id = ${orderId} AND venue_id = ${p.venue}`;
        // C9.4 — the guest came back to the bill from their phone and paid.
        // Sunday's contract is that the check then closes automatically; a
        // reported walkout must close with it, in this same transaction, so the
        // register can never claim a loss on a bill that was actually settled.
        await recoverWalkoutsForPaidOrder(sql, {
          venue: p.venue,
          orderId,
          paymentId: p.paymentId,
          paidMinor: Number(order.paid),
        });
      }
    }
  } else if (consumer === "pay-link") {
    const payLinkId = String(meta.pay_link_id ?? "");
    if (/^[0-9a-f-]{36}$/i.test(payLinkId)) {
      await sql`
        UPDATE pay_links SET status = 'paid', paid_at = now(),
               payment_id = ${p.paymentId}
        WHERE id = ${payLinkId} AND venue_id = ${p.venue} AND status <> 'paid'`;
    }
  } else if (consumer === "pos-tender") {
    // C5.6 — DATABASE ONLY. This records the intent to tell the POS; the network
    // call belongs to runTenderPushWorker, outside this transaction's row lock.
    const orderId = String(meta.order_id ?? "");
    return recordTenderIntent(sql, {
      venue: p.venue,
      paymentId: p.paymentId,
      grossMinor: Math.max(0, Math.round(Number(p.amount) || 0)),
      tipMinor: tip,
      guestFeeMinor: Math.max(0, Math.round(Number(meta.guest_fee_amount) || 0)),
      orderId: /^[0-9a-f-]{36}$/i.test(orderId) ? orderId : null,
    });
  }
  return { ok: true };
}

export async function processFinancialOutbox(
  sql: Sql,
  limit = 25,
): Promise<{ completed: number; failed: number }> {
  const rows = await claimFinancialOutbox(sql, limit);
  let completed = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const applied = await sql.begin(async (tx) => {
        if (!(await beginFinancialEffect(tx, row))) return false;
        const detail = await consumePayment(tx, row);
        if (!(await completeFinancialEffect(tx, row, detail))) {
          throw new Error("financial outbox lease lost before completion");
        }
        return true;
      });
      if (applied) completed += 1;
    } catch (error) {
      await failFinancialEffect(sql, row, error);
      failed += 1;
    }
  }
  return { completed, failed };
}
