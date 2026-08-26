import { requireHumanAuth } from "@/api/auth";
import {
  API_SCOPES,
  capTokenRole,
  generateApiToken,
  isValidScope,
} from "@/lib/api-tokens";
import { getSql } from "@/lib/db";
import { roleAtLeast } from "@/lib/rbac";
import { principalVenue, venueRoleAtLeast } from "@/lib/tenancy";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders },
  });
}

function serialize(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    prefix: row.token_prefix,
    scopes: (row.scopes as string[]) ?? [],
    role: row.role,
    createdBy: row.created_by ?? null,
    lastUsedAt: row.last_used_at ?? null,
    expiresAt: row.expires_at ?? null,
    revokedAt: row.revoked_at ?? null,
    createdAt: row.created_at,
  };
}

export async function handleTokensRoute(
  request: Request,
  env: unknown,
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith("/api/tokens")) return null;
  if (request.method === "OPTIONS") return json({ ok: true });

  const payload = await requireHumanAuth(request, env);
  if (!payload) return json({ error: "unauthorized" }, 401);
  if (!roleAtLeast(payload, "manager")) {
    return json({ error: "forbidden" }, 403);
  }
  const sql = getSql(env);
  if (!sql) return json({ error: "database not configured" }, 503);
  const venue = principalVenue(payload);
  if (!venue) return json({ error: "venue claim required" }, 403);

  if (path === "/api/tokens" && request.method === "GET") {
    const rows = await sql`
      SELECT id, name, token_prefix, scopes, role, created_by, last_used_at,
             expires_at, revoked_at, created_at
      FROM api_tokens WHERE venue_id = ${venue}
      ORDER BY created_at DESC LIMIT 100`;
    return json({ tokens: rows.map(serialize), scopes: API_SCOPES });
  }

  if (path === "/api/tokens" && request.method === "POST") {
    const body = (await request.json().catch(() => ({}))) as {
      name?: string;
      scopes?: string[];
      role?: string;
      expiresInDays?: number;
    };
    const name = String(body.name ?? "").trim();
    if (!name) return json({ error: "A name is required." }, 400);
    const scopes = (Array.isArray(body.scopes) ? body.scopes : []).filter(isValidScope);
    if (scopes.length === 0) {
      return json({ error: "Select at least one scope." }, 400);
    }
    const role = capTokenRole(body.role);
    if (!venueRoleAtLeast(payload.role, role)) {
      return json({ error: "Token role cannot exceed your venue role." }, 403);
    }
    const days = Number(body.expiresInDays);
    const expiresAt =
      Number.isFinite(days) && days > 0
        ? new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
        : null;
    const { token, prefix, hash } = await generateApiToken();
    const id = `tok_${crypto.randomUUID().replace(/-/g, "")}`;
    const [creator] = await sql`
      SELECT u.id
      FROM app_users u
      JOIN user_venues uv ON uv.user_id = u.id
      WHERE lower(u.email) = lower(${payload.sub})
        AND uv.venue_id = ${venue}
      LIMIT 1`;
    if (!creator) {
      return json({ error: "Current venue membership is required." }, 403);
    }
    await sql`
      INSERT INTO api_tokens
        (id, venue_id, org_id, name, token_prefix, token_hash, scopes, role,
         created_by, created_by_user_id, expires_at)
      VALUES (${id}, ${venue}, ${(payload as { org?: string }).org ?? null}, ${name},
              ${prefix}, ${hash}, ${scopes}, ${role},
              ${String(payload.sub ?? "")},
              ${creator.id}, ${expiresAt})`;
    // The plaintext token is returned ONCE — it is never stored or shown again.
    return json({ token, id, prefix, scopes, role }, 201);
  }

  const idMatch = path.match(/^\/api\/tokens\/([^/]+)$/);
  if (idMatch && request.method === "DELETE") {
    const [row] = await sql`
      UPDATE api_tokens SET revoked_at = now()
      WHERE id = ${idMatch[1]} AND venue_id = ${venue} AND revoked_at IS NULL
      RETURNING id`;
    if (!row) return json({ error: "not found" }, 404);
    return json({ revoked: true });
  }

  return null;
}
