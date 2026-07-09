import { getSql } from "@/lib/db";
import { requireAuth, requireRole } from "@/api/auth";
import { hashPassword } from "@/lib/jwt";

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

function parseDate(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : fallback;
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
      commissionBps?: number;
      adminEmail?: string;
      adminPassword?: string;
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
      const commissionBps = Math.min(
        2000,
        Math.max(0, Math.round(Number(body.commissionBps ?? 100)) || 0),
      );
      await sql`
        INSERT INTO organizations (id, name, slug, branding, pesaswap_partner_id, commission_bps)
        VALUES (${id}, ${name}, ${slug}, ${sql.json(branding)},
                ${body.pesaswapPartnerId ?? null}, ${commissionBps})`;
    } catch {
      return json({ error: "that slug is already taken" }, 409);
    }
    // Optionally bootstrap the reseller's admin login: an org-scoped user with no
    // venue whose token carries the org claim (see login) + reseller_admin role.
    let adminCreated = false;
    const adminEmail = String(body.adminEmail ?? "")
      .trim()
      .toLowerCase();
    if (
      adminEmail.includes("@") &&
      String(body.adminPassword ?? "").length >= 8
    ) {
      try {
        const hash = await hashPassword(String(body.adminPassword));
        await sql`
          INSERT INTO app_users (email, password_hash, name, role, org_id)
          VALUES (${adminEmail}, ${hash}, ${`${name} Admin`}, 'reseller_admin', ${id})`;
        adminCreated = true;
      } catch {
        /* email already exists — the org is still created */
      }
    }
    return json({ org: { id, name, slug }, adminCreated }, 201);
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

  // Reseller admin: my own org (for the branding editor).
  if (url.pathname === "/api/org/me" && request.method === "GET") {
    const payload = await requireAuth(request, env);
    if (!payload) return json({ error: "unauthorized" }, 401);
    const orgId = typeof payload.org === "string" ? payload.org : null;
    if (!orgId) return json({ error: "not a reseller account" }, 403);
    const [org] = await sql`
      SELECT id, name, slug, branding FROM organizations WHERE id = ${orgId} LIMIT 1`;
    return json({ org: org ?? null });
  }

  // Reseller admin: onboard a merchant (venue + owner login) under my org.
  if (url.pathname === "/api/org/merchants" && request.method === "POST") {
    const payload = await requireAuth(request, env);
    if (!payload) return json({ error: "unauthorized" }, 401);
    const orgId = typeof payload.org === "string" ? payload.org : null;
    if (!orgId) return json({ error: "not a reseller account" }, 403);
    const body = (await request.json().catch(() => ({}))) as {
      businessName?: string;
      email?: string;
      password?: string;
      phone?: string;
    };
    const businessName = String(body.businessName ?? "").trim();
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    if (!businessName || !email.includes("@") || password.length < 8) {
      return json(
        { error: "businessName, a valid email and password (8+) are required" },
        400,
      );
    }
    const [existing] = await sql`
      SELECT id FROM app_users WHERE lower(email) = ${email} LIMIT 1`;
    if (existing) return json({ error: "email already exists" }, 409);
    const venueId = `v_${crypto.randomUUID().slice(0, 8)}`;
    const code =
      businessName.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase() || "VEN";
    await sql`
      INSERT INTO venues (id, name, code, active, org_id)
      VALUES (${venueId}, ${businessName}, ${code}, true, ${orgId})`;
    const hash = await hashPassword(password);
    await sql`
      INSERT INTO app_users (email, password_hash, name, phone, venue_id, role, plan, org_id)
      VALUES (${email}, ${hash}, ${businessName}, ${body.phone?.trim() || null},
              ${venueId}, 'merchant', 'free', ${orgId})`;
    return json({ merchant: { venue: venueId, name: businessName, email } }, 201);
  }

  // Reseller admin: update my org branding (logo / colour / powered-by).
  if (url.pathname === "/api/org" && request.method === "PUT") {
    const payload = await requireAuth(request, env);
    if (!payload) return json({ error: "unauthorized" }, 401);
    const orgId = typeof payload.org === "string" ? payload.org : null;
    if (!orgId) return json({ error: "not a reseller account" }, 403);
    const body = (await request.json().catch(() => ({}))) as {
      logoUrl?: string;
      primaryColor?: string;
      poweredBy?: string;
    };
    if (body.logoUrl && body.logoUrl.length > 512 * 1024) {
      return json({ error: "logo too large (max 512KB)" }, 413);
    }
    const [org] = await sql`
      SELECT branding FROM organizations WHERE id = ${orgId} LIMIT 1`;
    if (!org) return json({ error: "not found" }, 404);
    const branding = {
      ...((org.branding ?? {}) as Record<string, unknown>),
      ...(body.logoUrl !== undefined ? { logoUrl: body.logoUrl } : {}),
      ...(body.primaryColor !== undefined
        ? { primaryColor: body.primaryColor }
        : {}),
      ...(body.poweredBy !== undefined ? { poweredBy: body.poweredBy } : {}),
    };
    await sql`UPDATE organizations SET branding = ${sql.json(branding)} WHERE id = ${orgId}`;
    return json({ ok: true });
  }

  // Reseller admin: aggregate processed volume + revenue-share across my org's
  // merchants (per-merchant + total, with the reseller's commission at
  // organizations.commission_bps).
  if (url.pathname === "/api/org/analytics" && request.method === "GET") {
    const payload = await requireAuth(request, env);
    if (!payload) return json({ error: "unauthorized" }, 401);
    const orgId = typeof payload.org === "string" ? payload.org : null;
    if (!orgId) return json({ error: "not a reseller account" }, 403);
    const now = Date.now();
    const from = parseDate(url.searchParams.get("from"), now - 30 * 86_400_000);
    const to = parseDate(url.searchParams.get("to"), now + 86_400_000);
    const [org] = await sql`
      SELECT commission_bps FROM organizations WHERE id = ${orgId} LIMIT 1`;
    const bps = Number(org?.commission_bps ?? 100);
    const rows = await sql`
      SELECT v.id, v.name,
        COALESCE(sum(CASE WHEN p.status IN ('succeeded','paid','captured')
          AND COALESCE(p.kind,'') <> 'refund' THEN p.amount ELSE 0 END),0)::bigint AS gross,
        count(*) FILTER (WHERE p.status IN ('succeeded','paid','captured')
          AND COALESCE(p.kind,'') <> 'refund') AS tx
      FROM venues v
      LEFT JOIN payments p ON p.venue_id = v.id
        AND p.created_at >= ${new Date(from).toISOString()}
        AND p.created_at < ${new Date(to).toISOString()}
      WHERE v.org_id = ${orgId}
      GROUP BY v.id, v.name
      ORDER BY gross DESC`;
    const merchants = rows.map((r) => {
      const gross = Number(r.gross) || 0;
      return {
        id: String(r.id),
        name: String(r.name),
        gross,
        tx: Number(r.tx) || 0,
        commission: Math.round((gross * bps) / 10000),
      };
    });
    const total = merchants.reduce(
      (a, m) => ({
        gross: a.gross + m.gross,
        tx: a.tx + m.tx,
        commission: a.commission + m.commission,
      }),
      { gross: 0, tx: 0, commission: 0 },
    );
    return json({
      commissionBps: bps,
      currency: "KES",
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
      merchants,
      total,
    });
  }

  return null;
}
