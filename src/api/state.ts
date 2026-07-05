import { getSql } from "@/lib/db";
import { requireAuth } from "@/api/auth";
import { venueFromPayload } from "@/lib/tenancy";

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

// Shared merchant state (localStorage mirror). GET pulls all keys for a venue;
// POST upserts one key. This is what makes the PWA and back office sync.
export async function handleStateRoute(
  request: Request,
  env: unknown,
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (path !== "/api/state") return null;

  if (request.method === "GET") {
    if (!(await requireAuth(request, env))) {
      return json({ error: "unauthorized" }, 401);
    }
    const sql = getSql(env);
    if (!sql) return json({ state: {} });
    const venue = venueFromPayload(await requireAuth(request, env), url);
    const rows = await sql`
      SELECT skey, value FROM merchant_state WHERE venue_id = ${venue}`;
    const state: Record<string, unknown> = {};
    for (const row of rows) state[row.skey] = row.value;
    return json({ state });
  }

  if (request.method === "POST") {
    if (!(await requireAuth(request, env))) {
      return json({ error: "unauthorized" }, 401);
    }
    const sql = getSql(env);
    if (!sql) return json({ state: {} });
    const venue = venueFromPayload(await requireAuth(request, env), url);
    const body = (await request.json()) as { key?: string; value?: unknown };
    if (!body.key) return json({ error: "key required" }, 400);
    await sql`
      INSERT INTO merchant_state (venue_id, skey, value, updated_at)
      VALUES (${venue}, ${body.key}, ${sql.json(JSON.parse(JSON.stringify(body.value ?? null)))}, now())
      ON CONFLICT (venue_id, skey)
      DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
    return json({ ok: true });
  }

  return null;
}
