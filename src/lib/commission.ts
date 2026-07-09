import type { Sql } from "@/lib/db";

// The reseller's commission on a gross amount, in minor units. Pure + testable.
export function commissionAmount(gross: number, bps: number): number {
  if (gross <= 0 || bps <= 0) return 0;
  return Math.round((gross * bps) / 10000);
}

// Post a reseller commission for a SUCCEEDED payment when the venue belongs to an
// org (bank). Idempotent — the unique index on payment_id means re-recording the
// same payment never double-posts. Best-effort: commission posting must NEVER
// block or fail a payment.
export async function postCommission(
  sql: Sql,
  opts: { venue: string; paymentId: string; gross: number },
): Promise<void> {
  if (!opts.venue || opts.gross <= 0) return;
  try {
    const [org] = await sql`
      SELECT o.id, o.commission_bps
      FROM venues v JOIN organizations o ON o.id = v.org_id
      WHERE v.id = ${opts.venue} LIMIT 1`;
    const orgId = org?.id ? String(org.id) : null;
    const bps = Number(org?.commission_bps ?? 0);
    if (!orgId || bps <= 0) return;
    const commission = commissionAmount(opts.gross, bps);
    await sql`
      INSERT INTO commission_ledger
        (id, org_id, venue_id, payment_id, gross_amount, commission_bps, commission_amount)
      VALUES (${`cl_${crypto.randomUUID().slice(0, 12)}`}, ${orgId}, ${opts.venue},
              ${opts.paymentId}, ${opts.gross}, ${bps}, ${commission})
      ON CONFLICT (payment_id) WHERE payment_id IS NOT NULL DO NOTHING`;
  } catch {
    /* best-effort — never block a payment on the commission ledger */
  }
}

// The partner (bank) settlement account a venue's payments should route to, i.e.
// the org's PesaSwap partner id. Null for a direct (non-reseller) merchant.
export async function partnerIdForVenue(
  sql: Sql,
  venue: string,
): Promise<string | null> {
  try {
    const [row] = await sql`
      SELECT o.pesaswap_partner_id AS pid
      FROM venues v JOIN organizations o ON o.id = v.org_id
      WHERE v.id = ${venue} LIMIT 1`;
    return row?.pid ? String(row.pid) : null;
  } catch {
    return null;
  }
}
