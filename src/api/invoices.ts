import { getSql } from "@/lib/db";
import {
  createInvoice,
  listInvoices,
  type LineItem,
} from "@/lib/invoices";
import {
  invoiceStats,
  recordPayment,
  sendReminder,
} from "@/lib/invoicing";
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

export async function handleInvoiceRoute(
  request: Request,
  env: unknown,
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith("/api/invoices")) return null;

  const sql = getSql(env);
  if (!sql) return json({ error: "database not configured" }, 503);
  const venue = await resolveVenue(request, env, url);

  // Public: resolve a short pay link (/pay?i=INV-XXX) to its amount + merchant.
  if (path === "/api/invoices/payinfo" && request.method === "GET") {
    const number = url.searchParams.get("number");
    if (!number) return json({ error: "number required" }, 400);
    const [inv] = await sql`
      SELECT i.number, i.amount, i.amount_paid, i.currency, i.status, i.staff_id,
             v.name AS merchant, vb.logo_url, vb.primary_color,
             o.name AS org_name, o.branding AS org_branding
      FROM invoices i
      LEFT JOIN venues v ON v.id = i.venue_id
      LEFT JOIN venue_branding vb ON vb.venue_id = i.venue_id
      LEFT JOIN organizations o ON o.id = v.org_id
      WHERE i.number = ${number} LIMIT 1`;
    if (!inv) return json({ error: "not found" }, 404);
    const balance = Number(inv.amount) - Number(inv.amount_paid);
    const org = (inv.org_branding ?? {}) as Record<string, unknown>;
    return json({
      till: inv.number,
      amount: balance > 0 ? balance : Number(inv.amount),
      merchant: inv.merchant ?? "PesaSwap",
      currency: inv.currency,
      status: inv.status,
      logoUrl: inv.logo_url ?? null,
      primaryColor: inv.primary_color ?? null,
      poweredBy: inv.org_name
        ? ((org.poweredBy as string) ?? `Powered by ${inv.org_name}`)
        : null,
      staffId: inv.staff_id ?? null,
    });
  }

  if (path === "/api/invoices" && request.method === "GET") {
    if (!(await requireAuth(request, env))) {
      return json({ error: "unauthorized" }, 401);
    }
    return json({ invoices: await listInvoices(sql, venue) });
  }

  if (path === "/api/invoices/stats" && request.method === "GET") {
    if (!(await requireAuth(request, env))) {
      return json({ error: "unauthorized" }, 401);
    }
    return json(await invoiceStats(sql, venue));
  }

  if (path === "/api/invoices" && request.method === "POST") {
    const payload = await requireAuth(request, env);
    if (!payload) {
      return json({ error: "unauthorized" }, 401);
    }
    const body = (await request.json()) as {
      venue?: string;
      customerName?: string;
      phone?: string;
      amount?: number;
      description?: string;
      channel?: string;
      lineItems?: LineItem[];
      taxRate?: number;
      dueDate?: string;
      notes?: string;
    };
    const result = await createInvoice(env, {
      venue,
      customerName: body.customerName ?? null,
      phone: body.phone ?? null,
      amount: Number(body.amount ?? 0),
      description: body.description ?? null,
      channel: body.channel,
      lineItems: body.lineItems,
      taxRate: body.taxRate,
      dueDate: body.dueDate ?? null,
      notes: body.notes ?? null,
      staffId: typeof payload.staff_id === "string" ? payload.staff_id : null,
    });
    if ("error" in result) return json(result, 400);
    return json(result, 201);
  }

  const idMatch = path.match(/^\/api\/invoices\/([^/]+)\/([^/]+)$/);
  if (idMatch && request.method === "POST") {
    if (!(await requireAuth(request, env))) {
      return json({ error: "unauthorized" }, 401);
    }
    const [, id, action] = idMatch;

    if (action === "paid") {
      const [inv] = await sql`
        SELECT amount, amount_paid FROM invoices WHERE id = ${id} AND venue_id = ${venue}`;
      if (!inv) return json({ error: "invoice not found" }, 404);
      const balance = Number(inv.amount) - Number(inv.amount_paid);
      return json(await recordPayment(env, venue, id, balance));
    }

    if (action === "pay") {
      const body = (await request.json()) as { amount?: number };
      const amount = Number(body.amount ?? 0);
      if (amount <= 0) return json({ error: "amount required" }, 400);
      return json(await recordPayment(env, venue, id, amount));
    }

    if (action === "remind" || action === "resend") {
      const [inv] = await sql`
        SELECT id, number, customer_name, phone, channel, amount, amount_paid,
               currency, due_date, pay_link, reminder_count
        FROM invoices WHERE id = ${id} AND venue_id = ${venue}`;
      if (!inv) return json({ error: "invoice not found" }, 404);
      if (!inv.phone) return json({ error: "no recipient phone on invoice" }, 400);
      const delivery = await sendReminder(env, venue, inv);
      return json({ ok: true, delivery });
    }

    if (action === "void") {
      await sql`
        UPDATE invoices SET status = 'void' WHERE id = ${id} AND venue_id = ${venue}`;
      await sql`
        INSERT INTO invoice_events (invoice_id, venue_id, type, detail)
        VALUES (${id}, ${venue}, 'void', 'Invoice voided')`;
      return json({ ok: true });
    }
  }

  const activityMatch = path.match(/^\/api\/invoices\/([^/]+)\/activity$/);
  if (activityMatch && request.method === "GET") {
    const events = await sql`
      SELECT type, detail, amount, channel, delivery, created_at
      FROM invoice_events WHERE invoice_id = ${activityMatch[1]}
      ORDER BY created_at`;
    return json({ events });
  }

  return null;
}
