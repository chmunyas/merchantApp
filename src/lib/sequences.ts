import { getSql } from "@/lib/db";
import { queueOutbound } from "@/lib/outbound-jobs";
import type { ChannelId } from "@/lib/channels/types";

type Sql = NonNullable<ReturnType<typeof getSql>>;

type Step = { delayHours?: number; message?: string };

function personalize(template: string, name: string | null, venue: string): string {
  return template
    .replace(/\{\{\s*name\s*\}\}/g, name ?? "there")
    .replace(/\{\{\s*venue\s*\}\}/g, venue);
}

// Enrol a recipient into a drip sequence (first step becomes due immediately).
export async function enroll(
  sql: Sql,
  venue: string,
  sequenceId: string,
  handle: string,
  channel: string,
  name: string | null,
): Promise<void> {
  await sql`
    INSERT INTO sequence_enrollments (sequence_id, venue_id, handle, channel, name)
    VALUES (${sequenceId}, ${venue}, ${handle}, ${channel}, ${name})
    ON CONFLICT (sequence_id, venue_id, handle) WHERE status = 'active'
    DO NOTHING`;
}

// Process every due sequence step for a venue (call from a cron/sweep). Sends
// the step via the channel adapter, reflects it in the thread, and schedules or
// completes the enrolment.
export async function runDueSteps(
  env: unknown,
  venue: string,
): Promise<{ processed: number; sent: number; completed: number }> {
  const sql = getSql(env);
  if (!sql) return { processed: 0, sent: 0, completed: 0 };

  const [venueRow] = await sql`SELECT name FROM venues WHERE id = ${venue}`;
  const venueName = venueRow?.name ?? venue;

  const claimToken = crypto.randomUUID();
  const due = await sql`
    WITH candidates AS (
      SELECT e.id FROM sequence_enrollments e
      JOIN sequences s ON s.id = e.sequence_id
      WHERE e.venue_id = ${venue} AND e.status = 'active' AND s.active
        AND ((e.next_step_at <= now() AND e.claim_token IS NULL)
          OR e.lease_expires_at < now())
      ORDER BY e.next_step_at FOR UPDATE OF e SKIP LOCKED LIMIT 100
    )
    UPDATE sequence_enrollments e
    SET claim_token = ${claimToken}, lease_expires_at = now() + interval '2 minutes'
    FROM candidates c
    WHERE e.id = c.id
    RETURNING e.id, e.sequence_id, e.handle, e.channel, e.name, e.step_index,
      (SELECT s.steps FROM sequences s WHERE s.id = e.sequence_id) AS steps,
      e.claim_token`;

  let processed = 0;
  let sent = 0;
  let completed = 0;

  for (const enrollment of due) {
    processed += 1;
    const steps = (enrollment.steps as Step[]) ?? [];
    const index = enrollment.step_index as number;
    if (index >= steps.length) {
      await sql`
        UPDATE sequence_enrollments
        SET status = 'done', claim_token = NULL, lease_expires_at = NULL
        WHERE id = ${enrollment.id} AND claim_token = ${enrollment.claim_token}`;
      completed += 1;
      continue;
    }
    const text = personalize(
      steps[index]?.message ?? "",
      enrollment.name ?? null,
      venueName,
    );
    const deliveryKey = `sequence:${enrollment.id}:${index}`;
    const [existingDelivery] = await sql`
      SELECT status FROM outbound_deliveries WHERE delivery_key = ${deliveryKey}`;
    const status = existingDelivery?.status ? String(existingDelivery.status) : null;
    if (["queued", "processing", "deferred", "failed"].includes(status ?? "")) {
      await sql`
        UPDATE sequence_enrollments
        SET claim_token = NULL, lease_expires_at = NULL,
            next_step_at = now() + interval '2 minutes'
        WHERE id = ${enrollment.id} AND claim_token = ${enrollment.claim_token}`;
      continue;
    }
    if (status === "suppressed") {
      await sql`
        UPDATE sequence_enrollments
        SET status = 'stopped', claim_token = NULL, lease_expires_at = NULL
        WHERE id = ${enrollment.id} AND claim_token = ${enrollment.claim_token}`;
      continue;
    }
    if (status === "unknown") {
      await sql`
        UPDATE sequence_enrollments
        SET status = 'stopped', claim_token = NULL, lease_expires_at = NULL
        WHERE id = ${enrollment.id} AND claim_token = ${enrollment.claim_token}`;
      continue;
    }
    if (!status) {
      try {
        const result = await queueOutbound(env, {
          deliveryKey,
          venue,
          sourceType: "sequence",
          sourceId: `${enrollment.id}:${index}`,
          channel: String(enrollment.channel) as ChannelId,
          handle: String(enrollment.handle),
          recipientName: enrollment.name ?? null,
          purpose: "marketing",
          body: text,
        });
        if (result.queued) sent += 1;
      } catch {
        await sql`
          UPDATE sequence_enrollments
          SET claim_token = NULL, lease_expires_at = NULL
          WHERE id = ${enrollment.id} AND claim_token = ${enrollment.claim_token}`;
        continue;
      }
      await sql`
        UPDATE sequence_enrollments
        SET claim_token = NULL, lease_expires_at = NULL,
            next_step_at = now() + interval '2 minutes'
        WHERE id = ${enrollment.id} AND claim_token = ${enrollment.claim_token}`;
      continue;
    }

    if (status !== "accepted" && status !== "delivered" && status !== "read" && status !== "pull") {
      await sql`
        UPDATE sequence_enrollments
        SET status = 'stopped', claim_token = NULL, lease_expires_at = NULL
        WHERE id = ${enrollment.id} AND claim_token = ${enrollment.claim_token}`;
      continue;
    }

    const nextIndex = index + 1;
    if (nextIndex >= steps.length) {
      await sql`
        UPDATE sequence_enrollments
        SET status = 'done', step_index = ${nextIndex}, claim_token = NULL,
            lease_expires_at = NULL
        WHERE id = ${enrollment.id} AND claim_token = ${enrollment.claim_token}`;
      completed += 1;
    } else {
      const delayHours = Number(steps[nextIndex]?.delayHours ?? 24);
      await sql`
        UPDATE sequence_enrollments
        SET step_index = ${nextIndex},
          next_step_at = now() + (${delayHours} || ' hours')::interval,
          claim_token = NULL, lease_expires_at = NULL
        WHERE id = ${enrollment.id} AND claim_token = ${enrollment.claim_token}`;
    }
  }

  return { processed, sent, completed };
}
