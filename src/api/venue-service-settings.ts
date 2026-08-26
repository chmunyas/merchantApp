import { requireHumanAuth } from "@/api/auth";
import {
  DEFAULT_VENUE_SERVICE_SETTINGS,
  isVenueServiceSettings,
  type VenueServiceSettings,
} from "@/lib/business-day";
import { getSql } from "@/lib/db";
import { roleAtLeast } from "@/lib/rbac";
import { venueFromPayload } from "@/lib/tenancy";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders },
  });
}

function serialize(row?: Record<string, unknown>): VenueServiceSettings {
  if (!row) return DEFAULT_VENUE_SERVICE_SETTINGS;
  const value = {
    businessDayStartMinutes: Number(row.business_day_start_minutes),
    serviceHours: row.service_hours,
  };
  return isVenueServiceSettings(value) ? value : DEFAULT_VENUE_SERVICE_SETTINGS;
}

// Owner-managed operational settings. The timezone remains the canonical venue
// timezone from `venues`; all boundary calculations use that timezone locally.
export async function handleVenueServiceSettingsRoute(
  request: Request,
  env: unknown,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/venue-service-settings") return null;
  if (request.method === "OPTIONS") return json({ ok: true });

  const payload = await requireHumanAuth(request, env);
  if (!payload) return json({ error: "unauthorized" }, 401);
  if (!roleAtLeast(payload, "merchant")) return json({ error: "forbidden" }, 403);
  const sql = getSql(env);
  if (!sql) return json({ error: "database not configured" }, 503);
  const venue = venueFromPayload(payload, url);

  if (request.method === "GET") {
    const [row] = await sql`
      SELECT business_day_start_minutes, service_hours
      FROM venue_service_settings
      WHERE venue_id = ${venue}`;
    return json({ settings: serialize(row) });
  }

  if (request.method === "PUT") {
    const body = await request.json().catch(() => null);
    if (!isVenueServiceSettings(body)) {
      return json({ error: "invalid service settings" }, 400);
    }
    await sql`
      INSERT INTO venue_service_settings
        (venue_id, business_day_start_minutes, service_hours, updated_at)
      VALUES (${venue}, ${body.businessDayStartMinutes}, ${sql.json(body.serviceHours)}, now())
      ON CONFLICT (venue_id) DO UPDATE SET
        business_day_start_minutes = EXCLUDED.business_day_start_minutes,
        service_hours = EXCLUDED.service_hours,
        updated_at = now()`;
    return json({ settings: body });
  }

  return null;
}
