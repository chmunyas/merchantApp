import type { Sql } from "@/lib/db";
import { generatePaymentIntentToken, hashPaymentIntentToken } from "@/lib/payment-intents";
import {
  collectionMethodsFor,
  normalizeCurrency,
  toMinorUnits,
  type SupportedCurrency,
} from "@/lib/currency";

export async function createInvoicePaymentHold(
  sql: Sql,
  input: {
    invoiceId: string;
    venue: string;
    expiresInMinutes?: number;
  },
): Promise<
  | { token: string; amountMinor: number; currency: SupportedCurrency; expiresAt: string }
  | { error: string; status: number }
> {
  const token = generatePaymentIntentToken();
  const tokenHash = await hashPaymentIntentToken(token);
  const expiresAt = new Date(
    Date.now() + Math.max(1, Math.min(30, input.expiresInMinutes ?? 15)) * 60_000,
  ).toISOString();
  const result = await sql.begin(async (tx) => {
    const [invoice] = await tx`
      SELECT id, number, amount, amount_paid, currency, status, staff_id
      FROM invoices
      WHERE id = ${input.invoiceId} AND venue_id = ${input.venue}
      FOR UPDATE`;
    if (!invoice) return { error: "invoice not found", status: 404 } as const;
    if (["paid", "void"].includes(String(invoice.status))) {
      return { error: `invoice is ${invoice.status}`, status: 409 } as const;
    }
    // An invoice may be RAISED in any supported currency, but it can only be
    // PAID where a collection rail exists — M-Pesa STK is KES-only.
    const currency = normalizeCurrency(invoice.currency);
    if (currency === null) {
      return { error: "unsupported invoice currency", status: 409 } as const;
    }
    const [method] = collectionMethodsFor(currency);
    if (!method) {
      return {
        error: `no payment rail is available for ${currency} yet`,
        status: 409,
      } as const;
    }
    await tx`
      UPDATE invoice_payment_holds SET status = 'expired'
      WHERE invoice_id = ${invoice.id} AND status = 'active' AND expires_at <= now()`;
    const [existing] = await tx`
      SELECT pi.id
      FROM invoice_payment_holds h
      JOIN payment_intents pi ON pi.id = h.payment_intent_id
      WHERE h.invoice_id = ${invoice.id} AND h.status = 'active'
        AND h.expires_at > now() AND pi.consumed_at IS NULL
      ORDER BY h.created_at DESC LIMIT 1`;
    if (existing) {
      // Raw bearer tokens are never stored, so an existing hold cannot be
      // re-disclosed. Release the stale browser-only hold and replace it under
      // the same invoice lock; provider-bound holds remain active below.
      await tx`
        UPDATE payment_intents SET expires_at = now()
        WHERE id = ${existing.id} AND consumed_at IS NULL`;
      await tx`
        UPDATE invoice_payment_holds SET status = 'released'
        WHERE invoice_id = ${invoice.id} AND status = 'active'
          AND payment_intent_id = ${existing.id}`;
    }
    const [holds] = await tx`
      SELECT COALESCE(sum(amount), 0)::bigint AS amount
      FROM invoice_payment_holds
      WHERE invoice_id = ${invoice.id} AND status = 'active' AND expires_at > now()`;
    const balanceMajor = Number(invoice.amount) - Number(invoice.amount_paid);
    const availableMinor = toMinorUnits(balanceMajor, currency) - Number(holds?.amount ?? 0);
    if (availableMinor <= 0) {
      return { error: "invoice balance is already paid or reserved", status: 409 } as const;
    }
    const [intent] = await tx`
      INSERT INTO payment_intents
        (token_hash, venue_id, amount, currency, source_type, source_id,
         allowed_method, max_tip_amount, metadata, expires_at)
      VALUES
        (${tokenHash}, ${input.venue}, ${availableMinor}, ${currency}, 'invoice',
         ${invoice.number}, ${method}, 0,
         ${tx.json({
           invoice_number: String(invoice.number),
           staff_id: invoice.staff_id ?? null,
           till: String(invoice.number),
         })}, ${expiresAt})
      RETURNING id`;
    await tx`
      INSERT INTO invoice_payment_holds
        (invoice_id, venue_id, payment_intent_id, amount, expires_at)
      VALUES
        (${invoice.id}, ${input.venue}, ${intent.id}, ${availableMinor}, ${expiresAt})`;
    return { token, amountMinor: availableMinor, currency, expiresAt } as const;
  });
  return result;
}

export async function consumeInvoicePaymentHold(
  sql: Sql,
  intentId: string,
): Promise<void> {
  await sql`
    UPDATE invoice_payment_holds SET status = 'consumed'
    WHERE payment_intent_id = ${intentId} AND status = 'active'`;
}

export async function releaseInvoicePaymentHold(
  sql: Sql,
  intentId: string,
): Promise<void> {
  await sql`
    UPDATE invoice_payment_holds SET status = 'released'
    WHERE payment_intent_id = ${intentId} AND status = 'active'`;
}