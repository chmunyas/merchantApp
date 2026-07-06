import { getSql } from "@/lib/db";
import { requireAuth } from "@/api/auth";
import { roleAtLeast } from "@/lib/rbac";
import { venueFromPayload } from "@/lib/tenancy";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders },
  });
}

// Logos are stored inline as data: URLs for a zero-infra MVP. Cap the size so a
// merchant cannot bloat the row / responses; move to R2 + a URL for large media.
const MAX_LOGO_BYTES = 512 * 1024;

type BrandingRow = {
  business_name: string | null;
  logo_url: string | null;
  primary_color: string | null;
  venue_name: string | null;
  org_name: string | null;
  org_branding: Record<string, unknown> | null;
};

// Per-tenant branding. GET is public (the shell + public pay/booking pages read
// a venue's logo/name/color, plus its reseller co-brand). PUT/POST is authed and
// pinned to the caller's own venue.
export async function handleBrandingRoute(
  request: Request,
  env: unknown,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/branding") return null;

  const sql = getSql(env);
  if (!sql) return json({ branding: null });

  if (request.method === "GET") {
    // Prefer the caller's own venue when authenticated (so the settings page can
    // load its own branding); otherwise the public ?venue= (pay/booking pages).
    const payload = await requireAuth(request, env);
    const venue = payload
      ? venueFromPayload(payload, url)
      : (url.searchParams.get("venue") ?? "main");
    const [b] = (await sql`
      SELECT vb.business_name, vb.logo_url, vb.primary_color,
             v.name AS venue_name, o.name AS org_name, o.branding AS org_branding
      FROM venues v
      LEFT JOIN venue_branding vb ON vb.venue_id = v.id
      LEFT JOIN organizations o ON o.id = v.org_id
      WHERE v.id = ${venue}
      LIMIT 1`) as unknown as [BrandingRow?];
    if (!b) return json({ branding: null });
    const org = (b.org_branding ?? {}) as Record<string, unknown>;
    return json({
      branding: {
        businessName: b.business_name ?? b.venue_name ?? "PesaSwap",
        logoUrl: b.logo_url ?? null,
        primaryColor: b.primary_color ?? null,
        // Reseller (bank) co-brand shown as "powered by" on merchant surfaces.
        reseller: b.org_name
          ? {
              name: b.org_name,
              poweredBy: (org.poweredBy as string) ?? null,
              logoUrl: (org.logoUrl as string) ?? null,
            }
          : null,
      },
    });
  }

  if (request.method === "PUT" || request.method === "POST") {
    const payload = await requireAuth(request, env);
    if (!payload) return json({ error: "unauthorized" }, 401);
    // Branding is an owner-only setting — staff/supervisor/manager cannot change it.
    if (!roleAtLeast(payload, "merchant")) {
      return json({ error: "forbidden" }, 403);
    }
    const venue = venueFromPayload(payload, url);
    const body = (await request.json().catch(() => ({}))) as {
      businessName?: string;
      logoUrl?: string;
      primaryColor?: string;
    };
    if (body.logoUrl && body.logoUrl.length > MAX_LOGO_BYTES) {
      return json({ error: "logo too large (max 512KB)" }, 413);
    }
    if (body.logoUrl && !/^(data:image\/|https:\/\/)/.test(body.logoUrl)) {
      return json({ error: "invalid logo url" }, 400);
    }
    if (body.primaryColor && !/^#[0-9a-fA-F]{3,8}$/.test(body.primaryColor)) {
      return json({ error: "invalid color" }, 400);
    }
    await sql`
      INSERT INTO venue_branding (venue_id, business_name, logo_url, primary_color, updated_at)
      VALUES (${venue}, ${body.businessName ?? null}, ${body.logoUrl ?? null},
              ${body.primaryColor ?? null}, now())
      ON CONFLICT (venue_id) DO UPDATE SET
        business_name = COALESCE(${body.businessName ?? null}, venue_branding.business_name),
        logo_url      = COALESCE(${body.logoUrl ?? null}, venue_branding.logo_url),
        primary_color = COALESCE(${body.primaryColor ?? null}, venue_branding.primary_color),
        updated_at    = now()`;
    return json({ ok: true });
  }

  return null;
}
