import { getSql } from "@/lib/db";
import { recordConsentEvent } from "@/lib/outbound-policy";

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

// Whether a handle has opted out. Compliance-store errors propagate so callers
// deny outbound rather than silently sending.
export async function isSuppressed(
  sql: Sql,
  venue: string,
  channel: string,
  handle: string,
): Promise<boolean> {
  const [row] = await sql`
    SELECT 1 FROM suppressions
    WHERE venue_id = ${venue} AND channel = ${channel} AND handle = ${handle}
    LIMIT 1`;
  return Boolean(row);
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
  await sql.begin(async (tx) => {
    if (suppressed) {
      await tx`
        INSERT INTO suppressions (venue_id, channel, handle, reason)
        VALUES (${venue}, ${channel}, ${handle}, ${reason})
        ON CONFLICT (venue_id, channel, handle) DO NOTHING`;
      await tx`
        UPDATE sequence_enrollments
        SET status = 'stopped', claim_token = NULL, lease_expires_at = NULL
        WHERE venue_id = ${venue} AND channel = ${channel} AND handle = ${handle}
          AND status = 'active'`;
    } else {
      await tx`
        DELETE FROM suppressions
        WHERE venue_id = ${venue} AND channel = ${channel} AND handle = ${handle}`;
    }
    for (const purpose of ["marketing", "utility", "transactional"] as const) {
      await recordConsentEvent(tx, {
        venue,
        channel,
        handle,
        purpose,
        state: suppressed ? "withdrawn" : "granted",
        source: suppressed ? "inbound_stop" : "inbound_start",
        evidence: { keyword: suppressed ? "STOP" : "START" },
      });
    }
  });
}
