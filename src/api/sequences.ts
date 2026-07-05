import { getSql } from "@/lib/db";
import { enroll, runDueSteps } from "@/lib/sequences";
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

export async function handleSequenceRoute(
  request: Request,
  env: unknown,
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith("/api/sequences")) return null;

  const sql = getSql(env);
  if (!sql) return json({ error: "database not configured" }, 503);
  const venue = await resolveVenue(request, env, url);

  if (path === "/api/sequences" && request.method === "GET") {
    const sequences = await sql`
      SELECT s.id, s.name, s.channel, s.steps, s.active,
             (SELECT count(*) FROM sequence_enrollments e
              WHERE e.sequence_id = s.id AND e.status = 'active')::int AS active_enrollments
      FROM sequences s WHERE s.venue_id = ${venue}
      ORDER BY s.created_at DESC`;
    return json({ sequences });
  }

  if (path === "/api/sequences" && request.method === "POST") {
    if (!(await requireAuth(request, env))) {
      return json({ error: "unauthorized" }, 401);
    }
    const body = (await request.json()) as {
      venue?: string;
      name?: string;
      channel?: string;
      steps?: unknown[];
    };
    if (!body.name?.trim()) return json({ error: "name required" }, 400);
    const steps = JSON.parse(JSON.stringify(body.steps ?? []));
    const [sequence] = await sql`
      INSERT INTO sequences (venue_id, name, channel, steps)
      VALUES (${venue}, ${body.name}, ${body.channel ?? "whatsapp"},
              ${sql.json(steps)})
      RETURNING id`;
    return json({ id: sequence.id }, 201);
  }

  if (path === "/api/sequences/enroll" && request.method === "POST") {
    if (!(await requireAuth(request, env))) {
      return json({ error: "unauthorized" }, 401);
    }
    const body = (await request.json()) as {
      venue?: string;
      sequenceId?: string;
      handle?: string;
      channel?: string;
      name?: string;
    };
    if (!body.sequenceId || !body.handle) {
      return json({ error: "sequenceId and handle required" }, 400);
    }
    await enroll(
      sql,
      venue,
      body.sequenceId,
      body.handle,
      body.channel ?? "whatsapp",
      body.name ?? null,
    );
    return json({ ok: true }, 201);
  }

  if (path === "/api/sequences/run" && request.method === "POST") {
    const result = await runDueSteps(env, venue);
    return json(result);
  }

  return null;
}
