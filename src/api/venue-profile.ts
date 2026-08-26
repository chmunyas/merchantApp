// The venue's commercial identity: its vertical, its plan tier, and the
// capabilities those two facts resolve to.
//
// Read is staff-level because the dashboard renders its navigation from it — a
// server who cannot read the profile gets an empty sidebar. Write is owner-only
// and deliberately cannot set `tier`: a merchant must not be able to grant
// themselves a plan they have not bought. Tier is changed by platform admin.

import { requireAuth } from "@/api/auth";
import { getSql } from "@/lib/db";
import { roleAtLeast } from "@/lib/rbac";
import { venueFromPayload } from "@/lib/tenancy";
import {
  CAPABILITIES,
  isMerchantVertical,
  normalizeTier,
  normalizeVertical,
  offerableCapabilities,
  resolveCapabilities,
  upgradeLockedCapabilities,
  type VenueProfile,
} from "@/lib/verticals";

type Sql = NonNullable<ReturnType<typeof getSql>>;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function loadVenueProfile(
  sql: Sql,
  venue: string,
): Promise<VenueProfile | null> {
  const [row] = await sql`
    SELECT vertical, tier FROM venues WHERE id = ${venue} LIMIT 1`;
  if (!row) return null;
  const rows = await sql`
    SELECT capability, enabled FROM venue_capability_overrides
    WHERE venue_id = ${venue}`;
  const overrides: Record<string, boolean> = {};
  for (const override of rows) {
    overrides[String(override.capability)] = Boolean(override.enabled);
  }
  return {
    vertical: normalizeVertical(row.vertical),
    tier: normalizeTier(row.tier),
    overrides,
  };
}

/** Server-side gate for a capability-scoped route. */
export async function venueHasCapability(
  sql: Sql,
  venue: string,
  capability: string,
): Promise<boolean> {
  const profile = await loadVenueProfile(sql, venue);
  if (!profile) return false;
  return resolveCapabilities(profile).has(capability);
}

function describe(profile: VenueProfile) {
  const enabled = resolveCapabilities(profile);
  return {
    vertical: profile.vertical,
    tier: profile.tier,
    capabilities: [...enabled].sort(),
    overrides: profile.overrides ?? {},
    catalogue: offerableCapabilities(profile).map((c) => ({
      key: c.key,
      label: c.label,
      group: c.group,
      path: c.path ?? null,
      enabled: enabled.has(c.key),
      byDefault: c.verticals === "all" || c.verticals.includes(profile.vertical),
    })),
    upgrades: upgradeLockedCapabilities(profile).map((c) => ({
      key: c.key,
      label: c.label,
      requiresTier: c.minTier,
    })),
  };
}

export async function handleVenueProfileRoute(
  request: Request,
  env: unknown,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/venue-profile") return null;

  const payload = await requireAuth(request, env);
  if (!payload) return json({ error: "unauthorized" }, 401);

  const sql = getSql(env);
  if (!sql) return json({ error: "database not configured" }, 503);
  const venue = venueFromPayload(payload, url);

  if (request.method === "GET") {
    if (!roleAtLeast(payload, "staff")) return json({ error: "forbidden" }, 403);
    const profile = await loadVenueProfile(sql, venue);
    if (!profile) return json({ error: "not found" }, 404);
    return json(describe(profile));
  }

  if (request.method === "PUT") {
    if (!roleAtLeast(payload, "merchant")) {
      return json({ error: "forbidden" }, 403);
    }
    const current = await loadVenueProfile(sql, venue);
    if (!current) return json({ error: "not found" }, 404);

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    if (body.vertical !== undefined) {
      if (!isMerchantVertical(body.vertical)) {
        return json({ error: "unknown vertical" }, 400);
      }
      await sql`
        UPDATE venues SET vertical = ${body.vertical} WHERE id = ${venue}`;
      current.vertical = body.vertical;
    }

    if (body.overrides !== undefined) {
      if (
        typeof body.overrides !== "object" ||
        body.overrides === null ||
        Array.isArray(body.overrides)
      ) {
        return json({ error: "overrides must be an object" }, 400);
      }
      const entries = Object.entries(body.overrides as Record<string, unknown>);
      const offerable = new Set(
        offerableCapabilities(current).map((c) => c.key),
      );
      const known = new Set(CAPABILITIES.map((c) => c.key));
      const actor = String(payload.sub ?? payload.email ?? "unknown");

      for (const [capability, value] of entries) {
        if (!known.has(capability)) {
          return json({ error: `unknown capability: ${capability}` }, 400);
        }
        if (typeof value !== "boolean" && value !== null) {
          return json({ error: `override must be boolean or null: ${capability}` }, 400);
        }
        // Refuse loudly rather than silently storing an override the plan can
        // never honour — a stored lie is worse than a rejected request.
        if (value === true && !offerable.has(capability)) {
          return json(
            { error: `capability requires a higher plan: ${capability}` },
            402,
          );
        }
        if (value === null) {
          await sql`
            DELETE FROM venue_capability_overrides
            WHERE venue_id = ${venue} AND capability = ${capability}`;
          continue;
        }
        await sql`
          INSERT INTO venue_capability_overrides
            (venue_id, capability, enabled, updated_by, updated_at)
          VALUES (${venue}, ${capability}, ${value}, ${actor}, now())
          ON CONFLICT (venue_id, capability) DO UPDATE
            SET enabled = EXCLUDED.enabled,
                updated_by = EXCLUDED.updated_by,
                updated_at = now()`;
      }
    }

    const updated = await loadVenueProfile(sql, venue);
    return updated ? json(describe(updated)) : json({ error: "not found" }, 404);
  }

  return null;
}
