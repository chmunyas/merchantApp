import type { TransactionSql } from "@/lib/db";

const encoder = new TextEncoder();

export function generatePortalToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function hashPortalToken(token: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", encoder.encode(token)),
  );
  return Array.from(digest)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function portalOtpPurpose(
  venue: string,
  phone: string,
): Promise<string> {
  const subjectHash = await hashPortalToken(`${venue}\0${phone}`);
  return `portal:${subjectHash}`;
}

/**
 * A5.2 — the OTP namespace for "I forgot to download my receipt". Separate from
 * `portal:` so a code minted for the post-payment login flow can never be
 * replayed against the public receipt-lookup surface, or vice versa.
 */
export async function receiptLookupOtpPurpose(
  venue: string,
  subject: string,
): Promise<string> {
  const subjectHash = await hashPortalToken(`${venue}\0${subject}`);
  return `receipt:${subjectHash}`;
}

/** Portal links live for 30 days, matching `portal_tokens.expires_at`'s default. */
export const PORTAL_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The tagged-template surface this helper needs: a live postgres transaction.
 */
export type PortalTokenSql = TransactionSql;

/**
 * Mints a fresh portal bearer for `venue` + `phone`, revoking any token that is
 * still live for that subject first — one active link per guest per venue, which
 * is what `portal_tokens_one_active_subject_key` enforces at the database level.
 *
 * Must be called inside a transaction: the revoke and the insert have to land
 * together or the partial unique index will reject the insert.
 */
export async function issuePortalToken(
  tx: PortalTokenSql,
  venue: string,
  phone: string,
): Promise<{ token: string; expiresAt: Date }> {
  const token = generatePortalToken();
  const tokenHash = await hashPortalToken(token);
  const expiresAt = new Date(Date.now() + PORTAL_TOKEN_TTL_MS);
  await tx`
    UPDATE portal_tokens SET revoked_at = now()
    WHERE venue_id = ${venue} AND phone = ${phone} AND revoked_at IS NULL`;
  await tx`
    INSERT INTO portal_tokens
      (token, token_hash, venue_id, phone, verified_at, expires_at)
    VALUES
      (${`pt_${crypto.randomUUID().replace(/-/g, "")}`}, ${tokenHash},
       ${venue}, ${phone}, now(), ${expiresAt})`;
  return { token, expiresAt };
}
