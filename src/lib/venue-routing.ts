import { getSql } from "@/lib/db";

// Resolve the verified venue owner of a receiving account. Unknown, inactive or
// unavailable routing data must never fall through into another tenant.
export async function resolveVenueForAccount(
  env: unknown,
  channel: string,
  accountId: string | null | undefined,
): Promise<string | null> {
  const id = accountId == null ? "" : String(accountId).trim();
  if (!id) return null;
  const sql = getSql(env);
  if (!sql) throw new Error("database not configured");
  const [row] = await sql`
    SELECT venue_id FROM channel_accounts
    WHERE channel = ${channel} AND account_id = ${id}
      AND active AND verified_at IS NOT NULL
    LIMIT 1`;
  return row?.venue_id ? String(row.venue_id) : null;
}

// Register an account only after the provider has proved it belongs to the venue.
// An existing account can never be silently moved between tenants.
export async function registerChannelAccount(
  env: unknown,
  channel: string,
  accountId: string | null | undefined,
  venue: string,
  verifiedBy = "provider_verification",
): Promise<void> {
  const id = accountId == null ? "" : String(accountId).trim();
  if (!id || !venue) throw new Error("account id and venue are required");
  const sql = getSql(env);
  if (!sql) throw new Error("database not configured");
  const [existing] = await sql`
    SELECT venue_id FROM channel_accounts
    WHERE channel = ${channel} AND account_id = ${id} FOR UPDATE`;
  if (existing && String(existing.venue_id) !== venue) {
    throw new Error("channel account is already owned by another venue");
  }
  await sql`
    INSERT INTO channel_accounts
      (channel, account_id, venue_id, active, verified_at, verified_by)
    VALUES (${channel}, ${id}, ${venue}, true, now(), ${verifiedBy})
    ON CONFLICT (channel, account_id) DO UPDATE
      SET active = true, verified_at = now(), verified_by = EXCLUDED.verified_by
      WHERE channel_accounts.venue_id = EXCLUDED.venue_id`;
}
