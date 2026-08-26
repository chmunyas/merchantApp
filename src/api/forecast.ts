import { requireAuth } from "@/api/auth";
import {
  busiestSlots,
  dailyOutlook,
  peaksByDay,
  prepPlan,
  weekdayName,
  type HourSlot,
  type ItemDowStat,
} from "@/lib/forecast";
import { getSql } from "@/lib/db";
import { roleAtLeast } from "@/lib/rbac";
import { venueFromPayload } from "@/lib/tenancy";
import { demandSlots } from "@/lib/venue-stats";
import { tokenHasScope } from "@/lib/api-tokens";

// The app's market is Kenya (KES): bucket demand by Nairobi-local wall-clock so
// "busy at 19:00" means 7pm locally, not UTC.
const WINDOW_DAYS = 56; // 8 weeks of history for the hourly demand pattern

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders },
  });
}

export async function handleForecastRoute(
  request: Request,
  env: unknown,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/forecast") return null;
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (request.method !== "GET") return null;

  const payload = await requireAuth(request, env);
  if (!payload) return json({ error: "unauthorized" }, 401);
  if (!roleAtLeast(payload, "manager")) {
    return json({ error: "forbidden" }, 403);
  }
  if (!tokenHasScope(payload, "analytics:read")) {
    return json({ error: "forbidden" }, 403);
  }
  const venue = venueFromPayload(payload, url);
  const sql = getSql(env);
  if (!sql) return json({ error: "database not configured" }, 503);

  const days = Math.min(
    14,
    Math.max(1, Number(url.searchParams.get("days")) || 7),
  );
  const dateParam = url.searchParams.get("date");
  const targetDate =
    dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)
      ? new Date(`${dateParam}T00:00:00Z`)
      : new Date(Date.now() + 24 * 60 * 60 * 1000); // default: tomorrow
  const targetDow = targetDate.getUTCDay();

  // 1) Average orders/units per (weekday, hour), Nairobi-local, last 8 weeks.
  const [venueRow] = await sql`
    SELECT timezone FROM venues WHERE id = ${venue} LIMIT 1`;
  const timezone = String(venueRow?.timezone ?? "Africa/Nairobi");
  const slots: HourSlot[] = await demandSlots(sql, venue, timezone);

  // 2) Per-item units for the target weekday, last 12 weeks — the prep basis.
  const itemRows = await sql`
    SELECT name,
           avg(u)::float8 AS avg_units,
           count(*)::int AS observations,
           (array_agg(u ORDER BY d DESC))[1]::float8 AS last_units
    FROM (
      SELECT oi.name AS name,
             (o.created_at AT TIME ZONE 'Africa/Nairobi')::date AS d,
             sum(oi.qty)::float8 AS u
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE o.venue_id = ${venue}
        AND o.status NOT IN ('cancelled', 'void')
        AND extract(dow from (o.created_at AT TIME ZONE 'Africa/Nairobi'))::int = ${targetDow}
        AND o.created_at >= now() - interval '84 days'
      GROUP BY oi.name, (o.created_at AT TIME ZONE 'Africa/Nairobi')::date
    ) daily
    GROUP BY name`;
  const items: ItemDowStat[] = itemRows.map((r) => ({
    name: String(r.name),
    avgUnits: Number(r.avg_units) || 0,
    lastUnits: Number(r.last_units) || 0,
    observations: Number(r.observations) || 0,
  }));

  const round1 = (n: number) => Math.round(n * 10) / 10;

  return json({
    generatedAt: new Date().toISOString(),
    timezone,
    windowDays: WINDOW_DAYS,
    demand: {
      busiest: busiestSlots(slots).map((s) => ({
        dow: s.dow,
        hour: s.hour,
        weekday: weekdayName(s.dow),
        label: `${weekdayName(s.dow)} ${String(s.hour).padStart(2, "0")}:00`,
        avgOrders: round1(s.avgOrders),
        avgUnits: round1(s.avgUnits),
      })),
      peaksByDay: peaksByDay(slots),
      outlook: dailyOutlook(slots, targetDate, days),
    },
    prep: {
      date: targetDate.toISOString().slice(0, 10),
      weekday: weekdayName(targetDow),
      bufferPct: 0.15,
      lines: prepPlan(items),
    },
  });
}
