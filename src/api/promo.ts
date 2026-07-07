import { requireAuth } from "@/api/auth";
import { getSql } from "@/lib/db";
import { applyPromo, normalizeCode, type PromoCode } from "@/lib/promo";
import { roleAtLeast } from "@/lib/rbac";
import { venueFromPayload } from "@/lib/tenancy";

type Sql = NonNullable<ReturnType<typeof getSql>>;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders },
  });
}

function toIso(value: unknown): string | null {
  return value ? new Date(value as string).toISOString() : null;
}

function rowToPromo(r: Record<string, unknown>): PromoCode {
  return {
    code: String(r.code),
    kind: r.kind === "fixed" ? "fixed" : "percent",
    value: Number(r.value) || 0,
    minOrder: Number(r.min_order) || 0,
    maxDiscount: Number(r.max_discount) || 0,
    active: Boolean(r.active),
    startsAt: toIso(r.starts_at),
    expiresAt: toIso(r.expires_at),
    usageLimit: Number(r.usage_limit) || 0,
    usedCount: Number(r.used_count) || 0,
  };
}

// Shared lookup so the order handler validates + applies with the same logic the
// public preview uses.
export async function lookupPromo(
  sql: Sql,
  venue: string,
  code: string,
): Promise<(PromoCode & { id: string }) | null> {
  const norm = normalizeCode(code);
  if (!norm) return null;
  const [row] = await sql`
    SELECT id, code, kind, value, min_order, max_discount, active,
           starts_at, expires_at, usage_limit, used_count
    FROM promo_codes
    WHERE venue_id = ${venue} AND lower(code) = lower(${norm})
    LIMIT 1`;
  if (!row) return null;
  return { id: String(row.id), ...rowToPromo(row) };
}

export async function handlePromoRoute(
  request: Request,
  env: unknown,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/promo")) return null;
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  const sql = getSql(env);
  if (!sql) return json({ error: "database not configured" }, 503);

  // Public preview: validate a code against a subtotal (minor units) before ordering.
  if (url.pathname === "/api/promo/validate" && request.method === "GET") {
    const venue =
      String(url.searchParams.get("venue") ?? "main").trim() || "main";
    const code = url.searchParams.get("code") ?? "";
    const subtotal = Math.max(
      0,
      Math.round(Number(url.searchParams.get("subtotal")) || 0),
    );
    const promo = await lookupPromo(sql, venue, code);
    const result = applyPromo(promo, subtotal);
    return json({ code: normalizeCode(code), kind: promo?.kind ?? null, ...result });
  }

  // Everything else is manager+ (create/list/deactivate).
  const payload = await requireAuth(request, env);
  if (!payload) return json({ error: "unauthorized" }, 401);
  if (!roleAtLeast(payload, "manager")) {
    return json({ error: "forbidden" }, 403);
  }
  const venue = venueFromPayload(payload, url);

  if (url.pathname === "/api/promo" && request.method === "GET") {
    const codes = await sql`
      SELECT id, code, kind, value, min_order, max_discount, active,
             starts_at, expires_at, usage_limit, used_count, created_at
      FROM promo_codes
      WHERE venue_id = ${venue}
      ORDER BY created_at DESC`;
    return json({ codes });
  }

  if (url.pathname === "/api/promo" && request.method === "POST") {
    const body = (await request.json().catch(() => ({}))) as {
      code?: string;
      kind?: string;
      value?: number | string;
      min_order?: number | string;
      max_discount?: number | string;
      usage_limit?: number | string;
      expires_at?: string;
    };
    const code = normalizeCode(String(body.code ?? ""));
    if (!code) return json({ error: "code required" }, 400);
    const kind = body.kind === "fixed" ? "fixed" : "percent";
    const value = Math.max(0, Math.round(Number(body.value) || 0));
    if (value <= 0) return json({ error: "value must be positive" }, 400);
    const minOrder = Math.max(0, Math.round(Number(body.min_order) || 0));
    const maxDiscount = Math.max(0, Math.round(Number(body.max_discount) || 0));
    const usageLimit = Math.max(0, Math.round(Number(body.usage_limit) || 0));
    const expiresAt =
      body.expires_at && /^\d{4}-\d{2}-\d{2}/.test(body.expires_at)
        ? new Date(body.expires_at).toISOString()
        : null;
    try {
      const [row] = await sql`
        INSERT INTO promo_codes
          (venue_id, code, kind, value, min_order, max_discount, usage_limit, expires_at)
        VALUES (${venue}, ${code}, ${kind}, ${value}, ${minOrder},
                ${maxDiscount}, ${usageLimit}, ${expiresAt})
        RETURNING id, code, kind, value, min_order, max_discount, active,
                  starts_at, expires_at, usage_limit, used_count, created_at`;
      return json({ code: row }, 201);
    } catch {
      return json({ error: "a code with that name already exists" }, 409);
    }
  }

  const idMatch = url.pathname.match(/^\/api\/promo\/([0-9a-fA-F-]+)$/);
  if (idMatch) {
    const id = idMatch[1];
    if (request.method === "DELETE") {
      await sql`UPDATE promo_codes SET active = false WHERE id = ${id} AND venue_id = ${venue}`;
      return json({ ok: true });
    }
    if (request.method === "PATCH") {
      const body = (await request.json().catch(() => ({}))) as {
        active?: boolean;
      };
      const [row] = await sql`
        UPDATE promo_codes SET active = ${Boolean(body.active)}
        WHERE id = ${id} AND venue_id = ${venue}
        RETURNING id, code, active`;
      if (!row) return json({ error: "not found" }, 404);
      return json({ code: row });
    }
  }

  return null;
}
