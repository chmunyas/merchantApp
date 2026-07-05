import { getSql } from "@/lib/db";
import { requireAuth, requireRole } from "@/api/auth";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders },
  });
}

// Reseller organizations (e.g. a bank that resells the app to its merchants).
// - GET  /api/org?slug=…      public: reseller public brand (co-branded signup)
// - POST /api/org             platform-admin: create a reseller
// - GET  /api/org/merchants   reseller admin: list merchants under my org
export async function handleOrgRoute(
  request: Request,
  env: unknown,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/org")) return null;

  const sql = getSql(env);
  if (!sql) return json({ error: "database not configured" }, 503);

  if (url.pathname === "/api/org" && request.method === "GET") {
    const slug = url.searchParams.get("slug");
    if (!slug) return json({ error: "slug required" }, 400);
    const [org] = await sql`
      SELECT name, slug, branding FROM organizations
      WHERE slug = ${slug.toLowerCase()} AND active = true LIMIT 1`;
    if (!org) return json({ org: null });
    const b = (org.branding ?? {}) as Record<string, unknown>;
    return json({
      org: {
        name: org.name,
        slug: org.slug,
        logoUrl: (b.logoUrl as string) ?? null,
        primaryColor: (b.primaryColor as string) ?? null,
        poweredBy: (b.poweredBy as string) ?? `Powered by ${org.name}`,
      },
    });
  }

  if (url.pathname === "/api/org" && request.method === "POST") {
    if (!(await requireRole(request, env, ["admin"]))) {
      return json({ error: "forbidden" }, 403);
    }
    const body = (await request.json().catch(() => ({}))) as {
      name?: string;
      slug?: string;
      logoUrl?: string;
      primaryColor?: string;
      poweredBy?: string;
      pesaswapPartnerId?: string;
    };
    const name = String(body.name ?? "").trim();
    const slug = String(body.slug ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/^-+|-+$/g, "");
    if (!name || !slug) return json({ error: "name and slug required" }, 400);
    const id = `org_${crypto.randomUUID().slice(0, 8)}`;
    const branding = {
      logoUrl: body.logoUrl ?? null,
      primaryColor: body.primaryColor ?? null,
      poweredBy: body.poweredBy ?? `Powered by ${name}`,
    };
    try {
      await sql`
        INSERT INTO organizations (id, name, slug, branding, pesaswap_partner_id)
        VALUES (${id}, ${name}, ${slug}, ${sql.json(branding)},
                ${body.pesaswapPartnerId ?? null})`;
    } catch {
      return json({ error: "that slug is already taken" }, 409);
    }
    return json({ org: { id, name, slug } }, 201);
  }

  if (url.pathname === "/api/org/merchants" && request.method === "GET") {
    const payload = await requireAuth(request, env);
    if (!payload) return json({ error: "unauthorized" }, 401);
    const orgId = typeof payload.org === "string" ? payload.org : null;
    if (!orgId) return json({ error: "not a reseller account" }, 403);
    const merchants = await sql`
      SELECT v.id, v.name, v.code, v.active, v.created_at,
             (SELECT count(*)::int FROM app_users u WHERE u.venue_id = v.id) AS users
      FROM venues v WHERE v.org_id = ${orgId}
      ORDER BY v.created_at DESC`;
    return json({ merchants });
  }

  return null;
}
