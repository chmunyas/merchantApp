// Staff-facing side of the Sunday-parity notifications (roadmap B2.13 / B2.14).
//
// A server opens this at the start of a shift, taps the tables they are serving,
// and (optionally) turns individual alert types off. Everything here is scoped to
// the CALLING staff member: a server can only ever read or change their own
// follows, prefs and alert feed. Managers do not set these on someone's behalf —
// Sunday's model is that the person working the floor picks their own tables.
//
// Deliberately human-only: an API token has no shift and no tables, so letting a
// PAT mutate a person's alert routing would be a privilege leak, not a feature.

import { getSql } from "@/lib/db";
import { requireHumanAuth } from "@/api/auth";
import { venueFromPayload } from "@/lib/tenancy";
import {
  STAFF_NOTIFICATION_TYPES,
  STAFF_NOTIFICATION_TYPE_LIST,
  isStaffNotificationType,
  typeEnabled,
  type StaffNotificationType,
} from "@/lib/staff-notifications";

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

const MAX_FOLLOWED_TABLES = 60;

export async function handleStaffAlertsRoute(
  request: Request,
  env: unknown,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/staff-alerts")) return null;
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const payload = await requireHumanAuth(request, env);
  if (!payload) return json({ error: "unauthorized" }, 401);
  const venue = venueFromPayload(payload, url);
  const sql = getSql(env);
  if (!sql) return json({ error: "database not configured" }, 503);

  // Alert routing belongs to a staff row. A merchant/manager session that is not
  // itself a staff member has nothing to configure here.
  const staffId = typeof payload.staff_id === "string" ? payload.staff_id : null;
  if (!staffId) {
    return json(
      { error: "This session is not linked to a staff member." },
      403,
    );
  }

  // Confirm the staff row belongs to THIS venue before touching anything, so a
  // stale token cannot steer alerts in a venue the person no longer works at.
  const [staffRow] = await sql`
    SELECT id FROM staff
    WHERE id = ${staffId} AND venue_id = ${venue} AND active = true
    LIMIT 1`;
  if (!staffRow) return json({ error: "forbidden" }, 403);

  // --- Shift-start screen: every table, what I follow, and my alert types ---
  if (url.pathname === "/api/staff-alerts/settings" && request.method === "GET") {
    const [tables, follows, prefs] = await Promise.all([
      sql`SELECT id::text AS id, label, section FROM dining_tables
          WHERE venue_id = ${venue} AND active = true
          ORDER BY label`,
      sql`SELECT table_key, table_label FROM staff_table_subscriptions
          WHERE venue_id = ${venue} AND staff_id = ${staffId}`,
      sql`SELECT type, enabled FROM staff_notification_prefs
          WHERE venue_id = ${venue} AND staff_id = ${staffId}`,
    ]);

    const stored: Record<string, boolean> = {};
    for (const row of prefs) {
      stored[String(row.type)] = Boolean(row.enabled);
    }

    return json({
      tables: tables.map((row) => ({
        key: String(row.id),
        label: String(row.label),
        section: row.section ?? null,
      })),
      following: follows.map((row) => String(row.table_key)),
      types: STAFF_NOTIFICATION_TYPE_LIST.map((type) => ({
        type,
        label: STAFF_NOTIFICATION_TYPES[type].label,
        description: STAFF_NOTIFICATION_TYPES[type].description,
        tableScoped: STAFF_NOTIFICATION_TYPES[type].tableScoped,
        enabled: typeEnabled(type, stored),
      })),
    });
  }

  // --- Save the shift-start choices (one round trip) ---
  if (url.pathname === "/api/staff-alerts/settings" && request.method === "PUT") {
    const body = (await request.json().catch(() => ({}))) as {
      following?: unknown;
      types?: unknown;
    };

    if (Array.isArray(body.following)) {
      const keys = Array.from(
        new Set(
          body.following
            .map((value) => String(value ?? "").trim())
            .filter(Boolean),
        ),
      ).slice(0, MAX_FOLLOWED_TABLES);

      // Only tables that exist in THIS venue may be followed — a raw key from the
      // client must never become a subscription for another tenant's floor.
      const valid = keys.length
        ? await sql`
            SELECT id::text AS id, label FROM dining_tables
            WHERE venue_id = ${venue} AND active = true
              AND id::text = ANY(${keys}::text[])`
        : [];

      await sql`
        DELETE FROM staff_table_subscriptions
        WHERE venue_id = ${venue} AND staff_id = ${staffId}`;
      for (const row of valid) {
        await sql`
          INSERT INTO staff_table_subscriptions
            (venue_id, staff_id, table_key, table_label)
          VALUES (${venue}, ${staffId}, ${String(row.id)}, ${String(row.label)})
          ON CONFLICT (venue_id, staff_id, table_key) DO NOTHING`;
      }
    }

    if (body.types && typeof body.types === "object") {
      const entries = Object.entries(body.types as Record<string, unknown>);
      for (const [type, enabled] of entries) {
        if (!isStaffNotificationType(type)) continue;
        await sql`
          INSERT INTO staff_notification_prefs
            (venue_id, staff_id, type, enabled, updated_at)
          VALUES (${venue}, ${staffId}, ${type satisfies StaffNotificationType},
                  ${Boolean(enabled)}, now())
          ON CONFLICT (venue_id, staff_id, type)
          DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now()`;
      }
    }

    return json({ ok: true });
  }

  // --- My alert feed (what the bell icon shows) ---
  if (url.pathname === "/api/staff-alerts" && request.method === "GET") {
    const rows = await sql`
      SELECT id::text AS id, type, title, body, table_label,
             amount_minor, remaining_minor, currency, url, read_at, created_at
      FROM staff_notifications
      WHERE venue_id = ${venue} AND staff_id = ${staffId}
      ORDER BY created_at DESC
      LIMIT 50`;
    const unread = rows.filter((row) => !row.read_at).length;
    return json({ notifications: rows, unread });
  }

  // --- Mark read ---
  if (url.pathname === "/api/staff-alerts/read" && request.method === "POST") {
    const body = (await request.json().catch(() => ({}))) as { ids?: unknown };
    const ids = Array.isArray(body.ids)
      ? body.ids.map((value) => String(value ?? "").trim()).filter(Boolean)
      : [];
    if (ids.length === 0) {
      await sql`
        UPDATE staff_notifications SET read_at = now()
        WHERE venue_id = ${venue} AND staff_id = ${staffId} AND read_at IS NULL`;
    } else {
      await sql`
        UPDATE staff_notifications SET read_at = now()
        WHERE venue_id = ${venue} AND staff_id = ${staffId}
          AND read_at IS NULL AND id::text = ANY(${ids}::text[])`;
    }
    return json({ ok: true });
  }

  return null;
}
