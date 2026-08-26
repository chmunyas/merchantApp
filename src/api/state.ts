import { getSql } from "@/lib/db";
import { requireHumanAuth } from "@/api/auth";
import { roleAtLeast } from "@/lib/rbac";
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

export function containsPlaintextPin(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsPlaintextPin);
  const record = value as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(record, "pin")) return true;
  return Object.values(record).some(containsPlaintextPin);
}

export async function handleStateRoute(
  request: Request,
  env: unknown,
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (path !== "/api/state") return null;

  if (request.method === "GET") {
    const payload = await requireHumanAuth(request, env);
    if (!payload) {
      return json({ error: "unauthorized" }, 401);
    }
    if (!roleAtLeast(payload, "merchant")) return json({ error: "forbidden" }, 403);
    const sql = getSql(env);
    if (!sql) return json({ state: {} });
    const venue = venueFromPayload(payload, url);
    const rows = await sql`
      SELECT skey, value, revision, updated_at
      FROM merchant_state WHERE venue_id = ${venue}`;
    const state: Record<
      string,
      { value: unknown; revision: number; updatedAt: string }
    > = {};
    for (const row of rows) {
      state[String(row.skey)] = {
        value: row.value,
        revision: Number(row.revision),
        updatedAt: new Date(row.updated_at).toISOString(),
      };
    }
    return json({ state });
  }

  if (request.method === "POST") {
    const payload = await requireHumanAuth(request, env);
    if (!payload) {
      return json({ error: "unauthorized" }, 401);
    }
    if (!roleAtLeast(payload, "merchant")) return json({ error: "forbidden" }, 403);
    const sql = getSql(env);
    if (!sql) return json({ state: {} });
    const venue = venueFromPayload(payload, url);
    const body = (await request.json()) as {
      key?: string;
      value?: unknown;
      revision?: number;
    };
    if (!body.key) return json({ error: "key required" }, 400);
    // Reject keys outside the mirrored namespaces so the shared store can't be
    // used as an arbitrary key/value dumping ground.
    if (!isAllowedStateKey(body.key)) {
      return json({ error: "unsupported state key" }, 400);
    }
    if (containsPlaintextPin(body.value)) {
      return json({ error: "plaintext PIN fields are forbidden" }, 400);
    }
    const serialized = JSON.stringify(body.value ?? null);
    if (serialized.length > MAX_STATE_VALUE_BYTES) {
      return json({ error: "state value too large" }, 413);
    }
    if (!Number.isInteger(body.revision) || Number(body.revision) < 0) {
      return json({ error: "revision required" }, 428);
    }
    const expected = Number(body.revision);
    const rows = expected === 0
      ? await sql`
          INSERT INTO merchant_state
            (venue_id, skey, value, revision, updated_at)
          VALUES (${venue}, ${body.key}, ${sql.json(JSON.parse(serialized))}, 1, now())
          ON CONFLICT (venue_id, skey) DO NOTHING
          RETURNING revision, updated_at`
      : await sql`
          UPDATE merchant_state
          SET value = ${sql.json(JSON.parse(serialized))},
              revision = revision + 1, updated_at = now()
          WHERE venue_id = ${venue} AND skey = ${body.key}
            AND revision = ${expected}
          RETURNING revision, updated_at`;
    if (rows.length === 0) {
      const [current] = await sql`
        SELECT value, revision, updated_at FROM merchant_state
        WHERE venue_id = ${venue} AND skey = ${body.key}`;
      return json(
        {
          error: "state conflict",
          key: body.key,
          current: current
            ? {
                value: current.value,
                revision: Number(current.revision),
                updatedAt: new Date(current.updated_at).toISOString(),
              }
            : null,
        },
        409,
      );
    }
    return json({
      ok: true,
      revision: Number(rows[0].revision),
      updatedAt: new Date(rows[0].updated_at).toISOString(),
    });
  }

  return null;
}
