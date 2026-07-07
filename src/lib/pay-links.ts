import { getSql } from "@/lib/db";
import { getBaseUrl, payRequestLink } from "@/lib/links";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

// Opaque, unguessable pay-request token (256-bit) so the amount is bound to the
// server record and can never be tampered with in the URL.
function payToken(): string {
  return `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");
}

export type PayLinkKind =
  | "request"
  | "tapgo"
  | "deposit"
  | "split"
  | "booking"
  | "service";

export type CreatePayLinkInput = {
  amount: number; // MINOR units (cents)
  currency?: string;
  description?: string | null;
  kind?: PayLinkKind;
  reference?: string | null;
  phone?: string | null;
  name?: string | null;
  createdBy?: string | null;
  expiresInMinutes?: number | null; // omit = no expiry
};

export type PayLinkResult = {
  token: string;
  url: string;
  amount: number; // minor units
  currency: string;
  description: string | null;
  kind: PayLinkKind;
};

// Mint a server-bound payment request and return its shareable link. The amount is
// stored server-side (minor units); the /pay page reads it back via resolvePayLink.
export async function createPayLink(
  env: unknown,
  venue: string,
  input: CreatePayLinkInput,
): Promise<PayLinkResult | { error: string }> {
  const sql = getSql(env);
  if (!sql) return { error: "database not configured" };
  const amount = Math.round(Number(input.amount) || 0);
  if (amount <= 0) return { error: "amount must be positive" };

  const token = payToken();
  const currency = input.currency ?? "KES";
  const kind = input.kind ?? "request";
  const expiresAt =
    input.expiresInMinutes && input.expiresInMinutes > 0
      ? new Date(Date.now() + input.expiresInMinutes * 60_000).toISOString()
      : null;

  try {
    await sql`
      INSERT INTO pay_links
        (token, venue_id, amount, currency, description, kind, reference,
         customer_phone, customer_name, created_by, expires_at)
      VALUES (${token}, ${venue}, ${amount}, ${currency},
              ${input.description ?? null}, ${kind}, ${input.reference ?? null},
              ${input.phone ?? null}, ${input.name ?? null},
              ${input.createdBy ?? null}, ${expiresAt})`;
  } catch {
    return { error: "could not create pay link" };
  }

  const base = await getBaseUrl(env);
  return {
    token,
    url: payRequestLink(base, token),
    amount,
    currency,
    description: input.description ?? null,
    kind,
  };
}

// Resolve a pay-request token to its authoritative amount + merchant, for the /pay
// page. Amounts are returned in KES base units (÷100) to match the pay page (which
// re-multiplies ×100 when charging). Mirrors the QR order resolver.
export async function resolvePayLink(
  env: unknown,
  token: string,
): Promise<Row | { error: string; status?: number }> {
  const sql = getSql(env);
  if (!sql) return { error: "database not configured", status: 503 };
  const [row] = await sql`
    SELECT pl.id, pl.venue_id, pl.amount, pl.currency, pl.description, pl.kind,
           pl.reference, pl.customer_phone, pl.customer_name, pl.status,
           pl.expires_at, pl.paid_at,
           COALESCE(vb.business_name, v.name, 'PesaSwap') AS merchant,
           vb.logo_url, org.name AS org_name, org.branding AS org_branding
    FROM pay_links pl
    JOIN venues v ON v.id = pl.venue_id
    LEFT JOIN venue_branding vb ON vb.venue_id = pl.venue_id
    LEFT JOIN organizations org ON org.id = v.org_id
    WHERE pl.token = ${token}
    LIMIT 1`;
  if (!row) return { error: "not found", status: 404 };
  if (row.status === "paid" || row.paid_at) {
    return { status: "paid", paid: true, merchant: row.merchant };
  }
  if (
    row.expires_at &&
    new Date(row.expires_at as string).getTime() < Date.now()
  ) {
    return { error: "expired", status: 410 };
  }
  const org = (row.org_branding ?? {}) as Record<string, unknown>;
  const poweredBy = row.org_name
    ? ((org.poweredBy as string) ?? `Powered by ${row.org_name}`)
    : null;
  const amountMinor = Number(row.amount) || 0;
  return {
    payLinkId: String(row.id),
    till: String(row.reference ?? row.id),
    venue: row.venue_id,
    amount: amountMinor / 100,
    currency: row.currency ?? "KES",
    description: row.description ?? null,
    kind: row.kind ?? "request",
    merchant: row.merchant,
    logoUrl: row.logo_url ?? null,
    poweredBy,
    phone: row.customer_phone ?? null,
    customerName: row.customer_name ?? null,
    status: "pending",
  };
}

// Mark a pay link paid once its settling payment succeeds. Idempotent + best-effort
// so bookkeeping never blocks a payment. Called from recordLedger via metadata.
export async function markPayLinkPaid(
  sql: NonNullable<ReturnType<typeof getSql>>,
  payLinkId: string,
  paymentId: string,
): Promise<void> {
  try {
    await sql`
      UPDATE pay_links
      SET status = 'paid', paid_at = now(), payment_id = ${paymentId}
      WHERE id = ${payLinkId} AND status <> 'paid'`;
  } catch {
    /* best-effort */
  }
}
