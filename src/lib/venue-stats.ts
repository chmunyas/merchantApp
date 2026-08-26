import { getSql } from "@/lib/db";
import type { HourSlot } from "@/lib/forecast";
import type { MenuStat } from "@/lib/menu-engineering";

type Sql = NonNullable<ReturnType<typeof getSql>>;

// The app's market is Kenya (KES): bucket demand by Nairobi-local wall-clock so a
// "busy at 19:00" peak means 7pm locally. Keep the timezone a SQL literal —
// parameterising `AT TIME ZONE $1` breaks Postgres type inference.
const HOURLY_WINDOW_DAYS = 56;

// Average orders/units per (weekday, hour), Nairobi-local, over the last 8 weeks.
// Shared by the forecast + pricing (happy-hour) surfaces.
export async function demandSlots(
  sql: Sql,
  venue: string,
  timeZone = "Africa/Nairobi",
): Promise<HourSlot[]> {
  const rows = await sql`
    SELECT extract(dow from (o.created_at AT TIME ZONE ${timeZone}))::int AS dow,
           extract(hour from (o.created_at AT TIME ZONE ${timeZone}))::int AS hour,
           count(distinct o.id)::float8 AS orders,
           count(distinct (o.created_at AT TIME ZONE ${timeZone})::date)::float8 AS days,
           coalesce(sum(oi.qty), 0)::float8 AS units
    FROM orders o
    LEFT JOIN order_items oi ON oi.order_id = o.id
    WHERE o.venue_id = ${venue}
      AND o.status NOT IN ('cancelled', 'void')
      AND o.created_at >= now() - interval '56 days'
    GROUP BY 1, 2`;
  return rows.map((r) => {
    const d = Number(r.days) || 0;
    return {
      dow: Number(r.dow),
      hour: Number(r.hour),
      avgOrders: d > 0 ? Number(r.orders) / d : 0,
      avgUnits: d > 0 ? Number(r.units) / d : 0,
    };
  });
}

export const HOURLY_STATS_WINDOW_DAYS = HOURLY_WINDOW_DAYS;

// Per menu item: selling price (whole KES), unit cost from linked inventory
// (minor units → ÷100), and units sold in the window. Shared by menu engineering
// + pricing. Cost is matched by inventory_items.menu_item_id first, else by name.
export async function menuProfitStats(
  sql: Sql,
  venue: string,
  from: string,
  to: string,
): Promise<MenuStat[]> {
  const rows = await sql`
    SELECT m.name, m.category, m.price::float8 AS price,
           COALESCE(inv.cost, 0)::float8 AS cost_minor,
           (inv.cost IS NOT NULL) AS has_cost,
           COALESCE(s.units, 0)::int AS units_sold
    FROM menu_items m
    LEFT JOIN LATERAL (
      SELECT i.cost FROM inventory_items i
      WHERE i.venue_id = m.venue_id
        AND (i.menu_item_id = m.id OR lower(i.name) = lower(m.name))
      ORDER BY (i.menu_item_id = m.id) DESC NULLS LAST
      LIMIT 1
    ) inv ON true
    LEFT JOIN LATERAL (
      SELECT SUM(oi.qty)::int AS units
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE o.venue_id = m.venue_id
        AND lower(oi.name) = lower(m.name)
        AND o.status NOT IN ('cancelled', 'void')
        AND o.created_at::date BETWEEN ${from} AND ${to}
    ) s ON true
    WHERE m.venue_id = ${venue} AND m.available = true
    ORDER BY m.name`;
  return rows.map((r) => ({
    name: String(r.name),
    category: String(r.category),
    price: Number(r.price),
    cost: Math.round(Number(r.cost_minor)) / 100,
    hasCost: Boolean(r.has_cost),
    unitsSold: Number(r.units_sold),
  }));
}
