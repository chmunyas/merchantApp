import { getSql } from "@/lib/db";
import { normalizeCurrency } from "@/lib/currency";

const encoder = new TextEncoder();

export type PaymentIntentSource =
  | "order"
  | "invoice"
  | "pay-link"
  | "subscription"
  | "agent-checkout"
  | "tapgo";

export type PaymentIntentInput = {
  venue: string;
  amount: number;
  currency?: string;
  sourceType: PaymentIntentSource;
  sourceId?: string | null;
  allowedMethod?: string | null;
  maxTipAmount?: number;
  metadata?: Record<string, unknown>;
  expiresInMinutes?: number;
};

export type PaymentIntentResult = {
  id: string;
  token: string;
  amount: number;
  currency: string;
  expiresAt: string;
};

export function generatePaymentIntentToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function hashPaymentIntentToken(token: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", encoder.encode(token)),
  );
  return Array.from(digest)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function createPaymentIntent(
  env: unknown,
  input: PaymentIntentInput,
): Promise<PaymentIntentResult | { error: string }> {
  const sql = getSql(env);
  if (!sql) return { error: "database not configured" };
  const amount = Math.round(Number(input.amount) || 0);
  if (amount <= 0 || !input.venue) return { error: "invalid payment intent" };
  const token = generatePaymentIntentToken();
  const tokenHash = await hashPaymentIntentToken(token);
  const currency = normalizeCurrency(input.currency);
  if (!currency) return { error: "unsupported currency" };
  const expiresAt = new Date(
    Date.now() + Math.max(1, Math.min(24 * 60, input.expiresInMinutes ?? 15)) * 60_000,
  ).toISOString();
  const [intent] = await sql`
    INSERT INTO payment_intents
      (token_hash, venue_id, amount, currency, source_type, source_id,
       allowed_method, max_tip_amount, metadata, expires_at)
    VALUES
      (${tokenHash}, ${input.venue}, ${amount}, ${currency}, ${input.sourceType},
       ${input.sourceId ?? null}, ${input.allowedMethod ?? null},
       ${Math.max(0, Math.round(input.maxTipAmount ?? 0))},
      ${sql.json(JSON.parse(JSON.stringify(input.metadata ?? {})))}, ${expiresAt})
    RETURNING id`;
  return { id: String(intent.id), token, amount, currency, expiresAt };
}
