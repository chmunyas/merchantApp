import { getSql } from "@/lib/db";
import { envVar } from "@/lib/env";
import { enroll, runDueSteps } from "@/lib/sequences";
import { verifyToken } from "@/lib/webhook-verify";
import { requireAuth, resolveVenue } from "@/api/auth";
import { tokenHasScope } from "@/lib/api-tokens";
import { roleAtLeast } from "@/lib/rbac";
import { listChannels } from "@/lib/channels";
import type { ChannelId } from "@/lib/channels/types";

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
    const payload = await requireAuth(request, env);
    if (!payload) return json({ error: "unauthorized" }, 401);
    if (!roleAtLeast(payload, "manager") || !tokenHasScope(payload, "campaigns:read")) {
      return json({ error: "forbidden" }, 403);
    }
    const sequences = await sql`
      SELECT s.id, s.name, s.channel, s.steps, s.active,
             (SELECT count(*) FROM sequence_enrollments e
              WHERE e.sequence_id = s.id AND e.status = 'active')::int AS active_enrollments
      FROM sequences s WHERE s.venue_id = ${venue}
      ORDER BY s.created_at DESC`;
    return json({ sequences });
  }

  if (path === "/api/sequences" && request.method === "POST") {
    const payload = await requireAuth(request, env);
    if (!payload) {
      return json({ error: "unauthorized" }, 401);
    }
    if (!roleAtLeast(payload, "manager") || !tokenHasScope(payload, "campaigns:write")) {
      return json({ error: "forbidden" }, 403);
    }
    const body = (await request.json()) as {
      venue?: string;
      name?: string;
      channel?: string;
      steps?: unknown[];
    };
    if (!body.name?.trim()) return json({ error: "name required" }, 400);
    const channel = body.channel ?? "whatsapp";
    if (!listChannels().includes(channel as ChannelId)) {
      return json({ error: "invalid channel" }, 400);
    }
    const steps = JSON.parse(JSON.stringify(body.steps ?? []));
    const [sequence] = await sql`
      INSERT INTO sequences (venue_id, name, channel, steps)
      VALUES (${venue}, ${body.name}, ${channel},
              ${sql.json(steps)})
      RETURNING id`;
    return json({ id: sequence.id }, 201);
  }

  if (path === "/api/sequences/enroll" && request.method === "POST") {
    const payload = await requireAuth(request, env);
    if (!payload) {
      return json({ error: "unauthorized" }, 401);
    }
    if (!roleAtLeast(payload, "manager") || !tokenHasScope(payload, "campaigns:write")) {
      return json({ error: "forbidden" }, 403);
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
    const [sequence] = await sql`
      SELECT channel FROM sequences
      WHERE id = ${body.sequenceId} AND venue_id = ${venue} AND active`;
    if (!sequence) return json({ error: "sequence not found" }, 404);
    await enroll(
      sql,
      venue,
      body.sequenceId,
      body.handle,
      String(sequence.channel),
      body.name ?? null,
    );
    return json({ ok: true }, 201);
  }

  if (path === "/api/sequences/run" && request.method === "POST") {
    // Public sweep called by the bridge — guard it like /api/invoicing/run so it
    // can't be abused to fire outbound drip messages. Bridge presents
    // x-cron-secret; otherwise a signed-in operator may trigger it.
    const cronSecret = envVar(env, "CRON_SECRET");
    if (cronSecret) {
      if (!verifyToken(request.headers.get("x-cron-secret"), cronSecret)) {
        return json({ error: "unauthorized" }, 401);
      }
    } else {
      const payload = await requireAuth(request, env);
      if (!payload) return json({ error: "unauthorized" }, 401);
      if (!roleAtLeast(payload, "manager") || !tokenHasScope(payload, "campaigns:write")) {
        return json({ error: "forbidden" }, 403);
      }
    }
    const result = await runDueSteps(env, venue);
    return json(result);
  }

  return null;
}
