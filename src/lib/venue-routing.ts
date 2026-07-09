import { getSql } from "@/lib/db";

// Resolve which venue owns an inbound channel account, so a customer messaging a
// specific store's number/handle reaches THAT store's agent + menu + orders. When
// nothing is registered (single-venue setups), falls back to the default venue so
// existing behaviour is unchanged. Best-effort — never throws.
export async function resolveVenueForAccount(
  env: unknown,
  channel: string,
  accountId: string | null | undefined,
  fallback = "main",
): Promise<string> {
  const id = accountId == null ? "" : String(accountId).trim();
  if (!id) return fallback;
  const sql = getSql(env);
  if (!sql) return fallback;
  try {
    const [row] = await sql`
      SELECT venue_id FROM channel_accounts
      WHERE channel = ${channel} AND account_id = ${id}
      LIMIT 1`;
    return row?.venue_id ? String(row.venue_id) : fallback;
  } catch {
    return fallback;
  }
}

// Register (or move) a channel account so future inbound to it routes to `venue`.
// Called when a merchant saves that channel's credentials for their store.
export async function registerChannelAccount(
  env: unknown,
  channel: string,
  accountId: string | null | undefined,
  venue: string,
): Promise<void> {
  const id = accountId == null ? "" : String(accountId).trim();
  if (!id || !venue) return;
  const sql = getSql(env);
  if (!sql) return;
  try {
    await sql`
      INSERT INTO channel_accounts (channel, account_id, venue_id)
      VALUES (${channel}, ${id}, ${venue})
      ON CONFLICT (channel, account_id) DO UPDATE SET venue_id = EXCLUDED.venue_id`;
  } catch {
    /* best-effort — routing simply falls back to the default venue */
  }
}
