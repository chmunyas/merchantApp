import { requireAuth } from "@/api/auth";
import { getSql } from "@/lib/db";
import { getMenu } from "@/lib/menu";
import { venueFromPayload } from "@/lib/tenancy";

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

type OrderItemInput = {
  name?: string;
  price?: number | string;
  qty?: number | string;
};

function wholeNumber(value: unknown, fallback: number): number {
  const next = Number(value);
  return Number.isFinite(next) ? Math.floor(next) : fallback;
}

function encodePayPayload(payload: Record<string, unknown>): string {
  const text = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function poweredBy(orgName: string | null, orgBranding: unknown): string | null {
  const org = (orgBranding ?? {}) as Record<string, unknown>;
  return orgName ? ((org.poweredBy as string) ?? `Powered by ${orgName}`) : null;
}

export async function handleQrRoute(
  request: Request,
  env: unknown,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/qr")) return null;
  if (request.method === "OPTIONS") return json({ ok: true });

  const sql = getSql(env);
  if (!sql) return json({ error: "database not configured" }, 503);

  if (url.pathname === "/api/qr" && request.method === "GET") {
    const payload = await requireAuth(request, env);
    if (!payload) return json({ error: "unauthorized" }, 401);
    const venue = venueFromPayload(payload, url);
    const codes = await sql`
      SELECT q.id, q.venue_id, q.label, q.table_id, q.kind, q.created_at,
             t.label AS table_label
      FROM qr_codes q
      LEFT JOIN dining_tables t ON t.id = q.table_id AND t.venue_id = q.venue_id
      WHERE q.venue_id = ${venue}
      ORDER BY q.created_at DESC`;
    return json({ codes });
  }

  if (url.pathname === "/api/qr" && request.method === "POST") {
    const payload = await requireAuth(request, env);
    if (!payload) return json({ error: "unauthorized" }, 401);
    const venue = venueFromPayload(payload, url);
    const body = (await request.json().catch(() => ({}))) as {
      label?: string;
      kind?: string;
      table_id?: string | null;
      tableId?: string | null;
    };
    const label = String(body.label ?? "").trim() || null;
    const kind = String(body.kind ?? "venue").trim() || "venue";
    const tableId = body.table_id ?? body.tableId ?? null;
    const normalizedTableId =
      tableId == null || String(tableId).trim() === ""
        ? null
        : String(tableId).trim();
    if (normalizedTableId) {
      const [table] = await sql`
        SELECT id FROM dining_tables
        WHERE id = ${normalizedTableId} AND venue_id = ${venue}
        LIMIT 1`;
      if (!table) return json({ error: "table not found" }, 400);
    }
    const [code] = await sql`
      INSERT INTO qr_codes (venue_id, label, kind, table_id)
      VALUES (${venue}, ${label}, ${kind}, ${normalizedTableId})
      RETURNING id, venue_id, label, table_id, kind, created_at`;
    return json({ code }, 201);
  }

  const orderMatch = url.pathname.match(/^\/api\/qr\/([0-9a-fA-F-]+)\/order$/);
  if (orderMatch && request.method === "POST") {
    const codeId = orderMatch[1];
    const [code] = await sql`
      SELECT q.id, q.venue_id, q.table_id,
             COALESCE(vb.business_name, v.name, 'PesaSwap') AS merchant,
             vb.logo_url, o.name AS org_name, o.branding AS org_branding
      FROM qr_codes q
      JOIN venues v ON v.id = q.venue_id
      LEFT JOIN venue_branding vb ON vb.venue_id = q.venue_id
      LEFT JOIN organizations o ON o.id = v.org_id
      WHERE q.id = ${codeId}
      LIMIT 1`;
    if (!code) return json({ error: "not found" }, 404);

    const body = (await request.json().catch(() => ({}))) as {
      items?: OrderItemInput[];
      phone?: string;
    };
    const items = (body.items ?? [])
      .map((item) => ({
        name: String(item.name ?? "").trim(),
        qty: Math.max(1, wholeNumber(item.qty ?? 1, 1)),
        price: Math.max(0, wholeNumber(item.price ?? 0, 0)),
      }))
      .filter((item) => item.name && item.price > 0);
    if (items.length === 0) return json({ error: "items required" }, 400);

    const amount = items.reduce((sum, item) => sum + item.qty * item.price, 0);
    const [created] = await sql.begin(async (tx) => {
      const [order] = await tx`
        INSERT INTO orders (venue_id, table_id, total)
        VALUES (${code.venue_id}, ${code.table_id ?? null}, ${amount})
        RETURNING id`;
      for (const item of items) {
        await tx`
          INSERT INTO order_items (order_id, name, qty, price)
          VALUES (${order.id}, ${item.name}, ${item.qty}, ${item.price})`;
      }
      await tx`
        INSERT INTO qr_scans (code_id, venue_id, user_agent, amount)
        VALUES (${code.id}, ${code.venue_id}, ${request.headers.get("user-agent")}, ${amount})`;
      return tx`SELECT id FROM orders WHERE id = ${order.id} LIMIT 1`;
    });

    const payPayload = {
      till: String(created.id),
      amount: amount / 100,
      merchant: code.merchant,
      logoUrl: code.logo_url ?? null,
      poweredBy: poweredBy(code.org_name ?? null, code.org_branding),
      venue: code.venue_id,
      orderId: String(created.id),
      phone: body.phone ? String(body.phone) : undefined,
    };
    const payUrl = `${url.origin}/pay?tapgo=${encodeURIComponent(
      encodePayPayload(payPayload),
    )}`;
    return json({ orderId: created.id, amount, payUrl }, 201);
  }

  const codeMatch = url.pathname.match(/^\/api\/qr\/([0-9a-fA-F-]+)$/);
  if (codeMatch && request.method === "GET") {
    const codeId = codeMatch[1];
    const [code] = await sql`
      SELECT q.id, q.venue_id, q.label, q.kind, q.table_id,
             v.name AS venue_name,
             vb.business_name, vb.logo_url, vb.primary_color,
             o.name AS org_name, o.branding AS org_branding,
             t.label AS table_label, t.seats, t.section
      FROM qr_codes q
      JOIN venues v ON v.id = q.venue_id
      LEFT JOIN venue_branding vb ON vb.venue_id = q.venue_id
      LEFT JOIN organizations o ON o.id = v.org_id
      LEFT JOIN dining_tables t ON t.id = q.table_id AND t.venue_id = q.venue_id
      WHERE q.id = ${codeId}
      LIMIT 1`;
    if (!code) return json({ error: "not found" }, 404);
    await sql`
      INSERT INTO qr_scans (code_id, venue_id, user_agent)
      VALUES (${code.id}, ${code.venue_id}, ${request.headers.get("user-agent")})`;
    const items = await getMenu(sql, code.venue_id);
    return json({
      venue: {
        id: code.venue_id,
        name: code.venue_name,
      },
      branding: {
        businessName: code.business_name ?? code.venue_name ?? "PesaSwap",
        logoUrl: code.logo_url ?? null,
        primaryColor: code.primary_color ?? null,
        reseller: code.org_name
          ? {
              name: code.org_name,
              poweredBy: poweredBy(code.org_name, code.org_branding),
              logoUrl:
                ((code.org_branding ?? {}) as Record<string, unknown>)
                  .logoUrl ?? null,
            }
          : null,
      },
      table: code.table_id
        ? {
            id: code.table_id,
            label: code.table_label,
            seats: code.seats,
            section: code.section,
          }
        : null,
      items,
    });
  }

  return null;
}
