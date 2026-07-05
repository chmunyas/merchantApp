import { getSql } from "@/lib/db";

type Sql = NonNullable<ReturnType<typeof getSql>>;

// Detect a standard opt-out / opt-in / help keyword in an inbound message.
export function consentKeyword(
  text: string,
): "stop" | "start" | "help" | null {
  const t = text.trim().toLowerCase();
  if (["stop", "unsubscribe", "cancel", "end", "quit", "optout", "opt out"].includes(t))
    return "stop";
  if (["start", "unstop", "subscribe", "optin", "opt in"].includes(t))
    return "start";
  if (["help", "info"].includes(t)) return "help";
  return null;
}

// Whether a handle has opted out of outbound on this channel. Best-effort: a DB
// error must never block message handling (fail-open on read).
export async function isSuppressed(
  sql: Sql,
  venue: string,
  channel: string,
  handle: string,
): Promise<boolean> {
  try {
    const [row] = await sql`
      SELECT 1 FROM suppressions
      WHERE venue_id = ${venue} AND channel = ${channel} AND handle = ${handle}
      LIMIT 1`;
    return Boolean(row);
  } catch {
    return false;
  }
}

// Add/remove a handle from the suppression list (opt-out / opt-in).
export async function setSuppressed(
  sql: Sql,
  venue: string,
  channel: string,
  handle: string,
  suppressed: boolean,
  reason = "user_request",
): Promise<void> {
  try {
    if (suppressed) {
      await sql`
        INSERT INTO suppressions (venue_id, channel, handle, reason)
        VALUES (${venue}, ${channel}, ${handle}, ${reason})
        ON CONFLICT (venue_id, channel, handle) DO NOTHING`;
    } else {
      await sql`
        DELETE FROM suppressions
        WHERE venue_id = ${venue} AND channel = ${channel} AND handle = ${handle}`;
    }
  } catch {
    /* best-effort */
  }
}
