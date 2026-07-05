import { getSql } from "@/lib/db";
import { getMenu } from "@/lib/menu";
import { requireAuth, resolveVenue } from "@/api/auth";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders },
  });
}

export async function handleMenuRoute(
  request: Request,
  env: unknown,
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith("/api/menu")) return null;

  const sql = getSql(env);
  if (!sql) return json({ error: "database not configured" }, 503);
  const venue = await resolveVenue(request, env, url);

  if (path === "/api/menu" && request.method === "GET") {
    return json({ items: await getMenu(sql, venue) });
  }

  // Sync the AI agent's menu from the dashboard (replace-all for the venue).
  if (path === "/api/menu/sync" && request.method === "POST") {
    if (!(await requireAuth(request, env))) {
      return json({ error: "unauthorized" }, 401);
    }
    const body = (await request.json()) as {
      venue?: string;
      items?: Array<{
        name?: string;
        category?: string;
        price?: number;
        dietary?: string[];
        available?: boolean;
      }>;
    };
    const target = venue;
    const items = (body.items ?? []).filter((i) => i.name && i.price != null);
    await sql`DELETE FROM menu_items WHERE venue_id = ${target}`;
    for (const item of items) {
      await sql`
        INSERT INTO menu_items (venue_id, name, category, price, dietary, available)
        VALUES (${target}, ${item.name ?? ""}, ${item.category ?? "Mains"},
                ${item.price ?? 0}, ${item.dietary ?? []}, ${item.available ?? true})`;
    }
    return json({ ok: true, count: items.length });
  }

  return null;
}
