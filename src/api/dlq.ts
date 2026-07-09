import { getAdapter } from "@/lib/channels";
import { isSuppressed } from "@/lib/consent";
import { getSql } from "@/lib/db";
import { requireAuth, resolveVenue } from "@/api/auth";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders },
  });
}

// Dead-letter queue: failed outbound deliveries (events.status = 'failed') with
// a retry that re-sends via the channel adapter and clears recovered rows.
export async function handleDlqRoute(
  request: Request,
  env: unknown,
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith("/api/dlq")) return null;

  if (path === "/api/dlq" && request.method === "GET") {
    if (!(await requireAuth(request, env))) {
      return json({ error: "unauthorized" }, 401);
    }
    const sql = getSql(env);
    if (!sql) return json({ error: "database not configured" }, 503);
    const venue = await resolveVenue(request, env, url);
    const failed = await sql`
      SELECT id, channel, conversation_id, payload, created_at
      FROM events
      WHERE venue_id = ${venue} AND status = 'failed'
      ORDER BY created_at DESC LIMIT 50`;
    return json({ failed, count: failed.length });
  }

  if (path === "/api/dlq/retry" && request.method === "POST") {
    if (!(await requireAuth(request, env))) {
      return json({ error: "unauthorized" }, 401);
    }
    const sql = getSql(env);
    if (!sql) return json({ error: "database not configured" }, 503);
    const venue = await resolveVenue(request, env, url);
    const failed = await sql`
      SELECT id, channel, payload FROM events
      WHERE venue_id = ${venue} AND status = 'failed'
      ORDER BY created_at DESC LIMIT 100`;
    let retried = 0;
    let recovered = 0;
    let suppressed = 0;
    for (const event of failed) {
      const handle = event.payload?.handle as string | undefined;
      const text = event.payload?.text as string | undefined;
      if (!handle || !text) continue;
      // Compliance: don't retry a send to a handle that has since opted out.
      if (await isSuppressed(sql, venue, String(event.channel), handle)) {
        suppressed += 1;
        await sql`UPDATE events SET status = 'suppressed' WHERE id = ${event.id}`;
        continue;
      }
      retried += 1;
      try {
        const out = await getAdapter(event.channel).send(handle, text, env, venue);
        await sql`
          UPDATE events SET status = ${out.delivery === "sent" ? "sent" : "retried"}
          WHERE id = ${event.id}`;
        recovered += 1;
      } catch {
        /* stays in the DLQ */
      }
    }
    return json({ retried, recovered });
  }

  return null;
}
