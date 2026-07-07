import { requireAuth } from "@/api/auth";
import { classifyMenu } from "@/lib/menu-engineering";
import {
  happyHourWindows,
  suggestPrices,
  type PricingInput,
} from "@/lib/pricing";
import { getSql } from "@/lib/db";
import { roleAtLeast } from "@/lib/rbac";
import { venueFromPayload } from "@/lib/tenancy";
import { demandSlots, menuProfitStats } from "@/lib/venue-stats";

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

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseDate(value: string | null | undefined, fallback: string): string {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback;
}

export async function handlePricingRoute(
  request: Request,
  env: unknown,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/pricing") return null;
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (request.method !== "GET") return null;

  const payload = await requireAuth(request, env);
  if (!payload) return json({ error: "unauthorized" }, 401);
  if (!roleAtLeast(payload, "manager")) {
    return json({ error: "forbidden" }, 403);
  }
  const venue = venueFromPayload(payload, url);
  const sql = getSql(env);
  if (!sql) return json({ error: "database not configured" }, 503);

  const to = parseDate(url.searchParams.get("to"), isoDate(new Date()));
  const from = parseDate(
    url.searchParams.get("from"),
    isoDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)),
  );
  const windowDays = Math.max(
    1,
    Math.round(
      (new Date(`${to}T00:00:00Z`).getTime() -
        new Date(`${from}T00:00:00Z`).getTime()) /
        (24 * 60 * 60 * 1000),
    ) + 1,
  );

  const [stats, slots] = await Promise.all([
    menuProfitStats(sql, venue, from, to),
    demandSlots(sql, venue),
  ]);

  const engineering = classifyMenu(stats, "KES");
  const inputs: PricingInput[] = engineering.items.map((i) => ({
    name: i.name,
    category: i.category,
    price: i.price,
    margin: i.margin,
    unitsSold: i.unitsSold,
    quadrant: i.quadrant,
    hasCost: i.hasCost,
  }));

  const pricing = suggestPrices(inputs, windowDays);
  const happyHours = happyHourWindows(
    slots.map((s) => ({ dow: s.dow, hour: s.hour, avgOrders: s.avgOrders })),
  );

  return json({
    from,
    to,
    windowDays,
    currency: "KES",
    pricing,
    happyHours,
  });
}
