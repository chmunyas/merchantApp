import { requireAuth } from "@/api/auth";
import { getSql } from "@/lib/db";
import { venueFromPayload } from "@/lib/tenancy";
import { tierProgress } from "@/lib/loyalty";

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

type TokenRow = { venue_id: string; phone: string };
type RewardRow = {
  id: string;
  venue_id: string;
  name: string;
  description: string | null;
  points_cost: number;
  active: boolean;
  created_at: string;
};
type ContactRow = {
  id: string;
  name: string | null;
  points: number | string | null;
  tier: string | null;
};
type BrandingRow = {
  business_name: string | null;
  logo_url: string | null;
  primary_color: string | null;
  venue_name: string | null;
  org_name: string | null;
  org_branding: Record<string, unknown> | null;
};

function cleanPhone(phone: unknown): string {
  return String(phone ?? "")
    .replace(/[^0-9+]/g, "")
    .slice(0, 20);
}

function opaqueToken(): string {
  return `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");
}

function redemptionCode(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase();
}

async function resolveToken(sql: ReturnType<typeof getSql>, token: string) {
  if (!sql || !/^[a-f0-9]{32,128}$/i.test(token)) return null;
  const [row] = (await sql`
    SELECT venue_id, phone FROM portal_tokens WHERE token = ${token} LIMIT 1
  `) as unknown as TokenRow[];
  return row ?? null;
}

async function loadBranding(sql: NonNullable<ReturnType<typeof getSql>>, venue: string) {
  const [b] = (await sql`
    SELECT vb.business_name, vb.logo_url, vb.primary_color,
           v.name AS venue_name, o.name AS org_name, o.branding AS org_branding
    FROM venues v
    LEFT JOIN venue_branding vb ON vb.venue_id = v.id
    LEFT JOIN organizations o ON o.id = v.org_id
    WHERE v.id = ${venue}
    LIMIT 1
  `) as unknown as BrandingRow[];
  const org = (b?.org_branding ?? {}) as Record<string, unknown>;
  return {
    businessName: b?.business_name ?? b?.venue_name ?? "PesaSwap",
    logoUrl: b?.logo_url ?? null,
    primaryColor: b?.primary_color ?? null,
    reseller: b?.org_name
      ? {
          name: b.org_name,
          poweredBy: (org.poweredBy as string) ?? null,
          logoUrl: (org.logoUrl as string) ?? null,
        }
      : null,
  };
}

function rewardPayload(row: RewardRow) {
  return {
    id: row.id,
    venueId: row.venue_id,
    name: row.name,
    description: row.description,
    pointsCost: Number(row.points_cost),
    active: row.active,
    createdAt: row.created_at,
  };
}

export async function handlePortalRoute(
  request: Request,
  env: unknown,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (
    !url.pathname.startsWith("/api/portal") &&
    !url.pathname.startsWith("/api/rewards")
  ) {
    return null;
  }
  if (request.method === "OPTIONS") return json({ ok: true });

  const sql = getSql(env);
  if (!sql) return json({ error: "database not configured" }, 503);

  if (url.pathname === "/api/portal/token" && request.method === "POST") {
    const body = (await request.json().catch(() => ({}))) as {
      venue?: string;
      phone?: string;
    };
    const venue = String(body.venue ?? "main").trim() || "main";
    const phone = cleanPhone(body.phone);
    if (!phone) return json({ error: "phone required" }, 400);
    const token = opaqueToken();
    // Pilot only: production should OTP-verify this phone before issuing a token.
    await sql`
      INSERT INTO portal_tokens (token, venue_id, phone)
      VALUES (${token}, ${venue}, ${phone})
    `;
    return json({ token, url: `/me/${token}` }, 201);
  }

  const portalMatch = url.pathname.match(/^\/api\/portal\/([^/]+)(?:\/(redeem))?$/);
  if (portalMatch) {
    const [, token, action] = portalMatch;
    const resolved = await resolveToken(sql, token);
    if (!resolved) return json({ error: "not found" }, 404);
    const { venue_id: venue, phone } = resolved;

    if (!action && request.method === "GET") {
      const [contact] = (await sql`
        SELECT id, name, points, tier
        FROM contacts
        WHERE venue_id = ${venue} AND phone = ${phone}
        ORDER BY created_at DESC
        LIMIT 1
      `) as unknown as ContactRow[];
      const invoices = await sql`
        SELECT id, number, customer_name, amount, currency, description, status,
               pay_link, created_at, paid_at
        FROM invoices
        WHERE venue_id = ${venue} AND phone = ${phone}
        ORDER BY created_at DESC
        LIMIT 10
      `;
      const payments = await sql`
        SELECT id, amount, currency, status, provider, provider_ref, reference,
               created_at, metadata
        FROM payments
        WHERE venue_id = ${venue} AND metadata->>'customer_phone' = ${phone}
        ORDER BY created_at DESC
        LIMIT 10
      `;
      const rewards = (await sql`
        SELECT id, venue_id, name, description, points_cost, active, created_at
        FROM loyalty_rewards
        WHERE venue_id = ${venue} AND active = true
        ORDER BY points_cost ASC, created_at DESC
      `) as unknown as RewardRow[];
      const redemptions = await sql`
        SELECT rr.id, rr.reward_id, lr.name AS reward_name, rr.points_spent,
               rr.code, rr.status, rr.created_at
        FROM reward_redemptions rr
        LEFT JOIN loyalty_rewards lr ON lr.id = rr.reward_id
        WHERE rr.venue_id = ${venue} AND rr.phone = ${phone}
        ORDER BY rr.created_at DESC
        LIMIT 10
      `;
      const points = Number(contact?.points ?? 0);
      return json({
        venue,
        branding: await loadBranding(sql, venue),
        contact: {
          name: contact?.name ?? "Guest",
          points,
          tier: contact?.tier ?? "Bronze",
        },
        progress: tierProgress(points),
        invoices,
        payments,
        rewards: rewards.map(rewardPayload),
        redemptions,
      });
    }

    if (action === "redeem" && request.method === "POST") {
      const body = (await request.json().catch(() => ({}))) as { rewardId?: string };
      const rewardId = String(body.rewardId ?? "");
      const [reward] = (await sql`
        SELECT id, venue_id, name, description, points_cost, active, created_at
        FROM loyalty_rewards
        WHERE id = ${rewardId} AND venue_id = ${venue} AND active = true
        LIMIT 1
      `) as unknown as RewardRow[];
      if (!reward) return json({ error: "reward not found" }, 404);

      try {
        const result = await sql.begin(async (tx) => {
          const [updated] = (await tx`
            UPDATE contacts
            SET points = points - ${Number(reward.points_cost)}
            WHERE id = (
              SELECT id FROM contacts
              WHERE venue_id = ${venue} AND phone = ${phone}
              ORDER BY created_at DESC
              LIMIT 1
            )
            AND points >= ${Number(reward.points_cost)}
            RETURNING id, points
          `) as unknown as Array<{ id: string; points: number | string }>;
          if (!updated) return null;
          const code = redemptionCode();
          await tx`
            INSERT INTO reward_redemptions
              (venue_id, phone, contact_id, reward_id, points_spent, code)
            VALUES
              (${venue}, ${phone}, ${updated.id}, ${reward.id},
               ${Number(reward.points_cost)}, ${code})
          `;
          return { code, remainingPoints: Number(updated.points) };
        });
        if (!result) return json({ error: "insufficient points" }, 400);
        return json(result, 201);
      } catch {
        return json({ error: "could not redeem reward" }, 500);
      }
    }
  }

  if (url.pathname.startsWith("/api/rewards")) {
    const payload = await requireAuth(request, env);
    if (!payload) return json({ error: "unauthorized" }, 401);
    const venue = venueFromPayload(payload, url);

    if (url.pathname === "/api/rewards" && request.method === "GET") {
      const rewards = (await sql`
        SELECT id, venue_id, name, description, points_cost, active, created_at
        FROM loyalty_rewards
        WHERE venue_id = ${venue}
        ORDER BY active DESC, points_cost ASC, created_at DESC
      `) as unknown as RewardRow[];
      return json({ rewards: rewards.map(rewardPayload) });
    }

    if (url.pathname === "/api/rewards" && request.method === "POST") {
      const body = (await request.json().catch(() => ({}))) as {
        name?: string;
        description?: string;
        points_cost?: number;
        pointsCost?: number;
      };
      const name = String(body.name ?? "").trim();
      const pointsCost = Number(body.points_cost ?? body.pointsCost ?? 0);
      if (!name) return json({ error: "name required" }, 400);
      if (!Number.isInteger(pointsCost) || pointsCost <= 0) {
        return json({ error: "points_cost must be a positive integer" }, 400);
      }
      const [reward] = (await sql`
        INSERT INTO loyalty_rewards (venue_id, name, description, points_cost)
        VALUES (${venue}, ${name}, ${body.description ?? null}, ${pointsCost})
        RETURNING id, venue_id, name, description, points_cost, active, created_at
      `) as unknown as RewardRow[];
      return json({ reward: rewardPayload(reward) }, 201);
    }

    const rewardMatch = url.pathname.match(/^\/api\/rewards\/([^/]+)$/);
    if (rewardMatch && request.method === "PATCH") {
      const body = (await request.json().catch(() => ({}))) as {
        name?: string;
        description?: string | null;
        points_cost?: number;
        pointsCost?: number;
        active?: boolean;
      };
      const points =
        body.points_cost !== undefined || body.pointsCost !== undefined
          ? Number(body.points_cost ?? body.pointsCost)
          : null;
      if (points !== null && (!Number.isInteger(points) || points <= 0)) {
        return json({ error: "points_cost must be a positive integer" }, 400);
      }
      const [reward] = (await sql`
        UPDATE loyalty_rewards
        SET name = COALESCE(${body.name?.trim() || null}, name),
            description = COALESCE(${body.description ?? null}, description),
            points_cost = COALESCE(${points}, points_cost),
            active = COALESCE(${body.active ?? null}, active)
        WHERE id = ${rewardMatch[1]} AND venue_id = ${venue}
        RETURNING id, venue_id, name, description, points_cost, active, created_at
      `) as unknown as RewardRow[];
      if (!reward) return json({ error: "reward not found" }, 404);
      return json({ reward: rewardPayload(reward) });
    }

    if (rewardMatch && request.method === "DELETE") {
      await sql`
        DELETE FROM loyalty_rewards
        WHERE id = ${rewardMatch[1]} AND venue_id = ${venue}
      `;
      return json({ ok: true });
    }
  }

  return null;
}
