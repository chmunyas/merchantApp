import { getAdapter } from "@/lib/channels";
import { isSuppressed } from "@/lib/consent";
import { getSql } from "@/lib/db";

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
    VALUES (${sequenceId}, ${venue}, ${handle}, ${channel}, ${name})`;
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

  const due = await sql`
    SELECT e.id, e.sequence_id, e.handle, e.channel, e.name, e.step_index,
           s.steps
    FROM sequence_enrollments e
    JOIN sequences s ON s.id = e.sequence_id
    WHERE e.venue_id = ${venue} AND e.status = 'active'
      AND e.next_step_at <= now() AND s.active
    ORDER BY e.next_step_at LIMIT 100`;

  let processed = 0;
  let sent = 0;
  let completed = 0;

  for (const enrollment of due) {
    processed += 1;
    const steps = (enrollment.steps as Step[]) ?? [];
    const index = enrollment.step_index as number;
    if (index >= steps.length) {
      await sql`UPDATE sequence_enrollments SET status = 'done' WHERE id = ${enrollment.id}`;
      completed += 1;
      continue;
    }
    const text = personalize(
      steps[index]?.message ?? "",
      enrollment.name ?? null,
      venueName,
    );
    // Compliance: a STOP opt-out halts the drip (never send another step).
    if (
      await isSuppressed(
        sql,
        venue,
        String(enrollment.channel),
        String(enrollment.handle),
      )
    ) {
      await sql`UPDATE sequence_enrollments SET status = 'stopped' WHERE id = ${enrollment.id}`;
      continue;
    }
    try {
      await getAdapter(enrollment.channel).send(enrollment.handle, text, env);
      sent += 1;
      const [conversation] = await sql`
        INSERT INTO conversations (venue_id, wa_id, name, role, channel)
        VALUES (${venue}, ${enrollment.handle}, ${enrollment.name}, 'customer', ${enrollment.channel})
        ON CONFLICT (venue_id, wa_id) DO UPDATE SET last_message_at = now()
        RETURNING id`;
      await sql`
        INSERT INTO messages (conversation_id, direction, body, ai, channel)
        VALUES (${conversation.id}, 'outbound', ${text}, false, ${enrollment.channel})`;
    } catch {
      /* leave the step due for the next sweep */
      continue;
    }

    const nextIndex = index + 1;
    if (nextIndex >= steps.length) {
      await sql`UPDATE sequence_enrollments SET status = 'done', step_index = ${nextIndex} WHERE id = ${enrollment.id}`;
      completed += 1;
    } else {
      const delayHours = Number(steps[nextIndex]?.delayHours ?? 24);
      await sql`
        UPDATE sequence_enrollments
        SET step_index = ${nextIndex},
            next_step_at = now() + (${delayHours} || ' hours')::interval
        WHERE id = ${enrollment.id}`;
    }
  }

  return { processed, sent, completed };
}
