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
//
// The store is an opaque JSONB blob, so it is hardened at the edge: only the two
// namespaces the client actually mirrors are accepted, and a generous per-value
// size cap keeps a single key from ballooning the shared row / DB. Any other authed
// caller can therefore neither pollute the store with arbitrary keys nor push an
// abusive payload into it.
const STATE_KEY_PREFIXES = ["fxengine.", "pesaswap.services."] as const;
const MAX_STATE_VALUE_BYTES = 4 * 1024 * 1024; // 4 MB — far above any real mirror.

export function isAllowedStateKey(key: unknown): key is string {
  return (
    typeof key === "string" &&
    key.length > 0 &&
    key.length <= 200 &&
    STATE_KEY_PREFIXES.some((p) => key.startsWith(p))
  );
}

export async function handleStateRoute(
  request: Request,
  env: unknown,
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (path !== "/api/state") return null;

  if (request.method === "GET") {
    const payload = await requireAuth(request, env);
    if (!payload) {
      return json({ error: "unauthorized" }, 401);
    }
    const sql = getSql(env);
    if (!sql) return json({ state: {} });
    const venue = venueFromPayload(payload, url);
    const rows = await sql`
      SELECT skey, value FROM merchant_state WHERE venue_id = ${venue}`;
    const state: Record<string, unknown> = {};
    for (const row of rows) state[row.skey] = row.value;
    return json({ state });
  }

  if (request.method === "POST") {
    const payload = await requireAuth(request, env);
    if (!payload) {
      return json({ error: "unauthorized" }, 401);
    }
    const sql = getSql(env);
    if (!sql) return json({ state: {} });
    const venue = venueFromPayload(payload, url);
    const body = (await request.json()) as { key?: string; value?: unknown };
    if (!body.key) return json({ error: "key required" }, 400);
    // Reject keys outside the mirrored namespaces so the shared store can't be
    // used as an arbitrary key/value dumping ground.
    if (!isAllowedStateKey(body.key)) {
      return json({ error: "unsupported state key" }, 400);
    }
    const serialized = JSON.stringify(body.value ?? null);
    if (serialized.length > MAX_STATE_VALUE_BYTES) {
      return json({ error: "state value too large" }, 413);
    }
    await sql`
      INSERT INTO merchant_state (venue_id, skey, value, updated_at)
      VALUES (${venue}, ${body.key}, ${sql.json(JSON.parse(serialized))}, now())
      ON CONFLICT (venue_id, skey)
      DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
    return json({ ok: true });
  }

  return null;
}
