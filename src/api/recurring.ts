import { getSql } from "@/lib/db";
import { runRecurring, runReminders } from "@/lib/invoicing";
import {
  PLAN_LIMITS,
  planOf,
  requireAuth,
  resolveVenue,
} from "@/api/auth";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders },
  });
}

export async function handleRecurringRoute(
  request: Request,
  env: unknown,
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;

  // Run reminders + generate due recurring invoices (called by the bridge sweep).
  if (path === "/api/invoicing/run" && request.method === "POST") {
    const venue = await resolveVenue(request, env, url);
    const reminders = await runReminders(env, venue);
    const recurring = await runRecurring(env, venue);
    return json({
      remindersSent: reminders.sent,
      recurringGenerated: recurring.generated,
    });
  }

  if (!path.startsWith("/api/recurring")) return null;

  const sql = getSql(env);
  if (!sql) return json({ error: "database not configured" }, 503);
  const venue = await resolveVenue(request, env, url);

  if (path === "/api/recurring" && request.method === "GET") {
    const schedules = await sql`
      SELECT id, customer_name, phone, channel, amount, currency, description,
             cadence, due_days, next_run_at, active, auto_send, reminders,
             last_run_at, created_at
      FROM recurring_invoices WHERE venue_id = ${venue}
      ORDER BY created_at DESC`;
    return json({ schedules });
  }

  if (path === "/api/recurring" && request.method === "POST") {
    const auth = await requireAuth(request, env);
    if (!auth) return json({ error: "unauthorized" }, 401);
    // Per-tenant plan limit (free tier caps recurring schedules).
    const plan = planOf(auth);
    const cap = PLAN_LIMITS[plan]?.recurring ?? PLAN_LIMITS.pro.recurring;
    const [{ n }] = await sql`
      SELECT count(*)::int AS n FROM recurring_invoices WHERE venue_id = ${venue}`;
    if (Number(n) >= cap) {
      return json(
        {
          error: `Your ${plan} plan allows up to ${cap} recurring schedules. Upgrade to add more.`,
        },
        402,
      );
    }
    const body = (await request.json()) as {
      venue?: string;
      customerName?: string;
      phone?: string;
      channel?: string;
      amount?: number;
      description?: string;
      cadence?: string;
      dueDays?: number;
      autoSend?: boolean;
      startNow?: boolean;
    };
    const amount = Number(body.amount ?? 0);
    if (amount <= 0) return json({ error: "amount required" }, 400);
    const cadence = body.cadence === "weekly" ? "weekly" : "monthly";
    const interval = cadence === "weekly" ? "7 days" : "1 month";
    const [schedule] = await sql`
      INSERT INTO recurring_invoices
        (venue_id, customer_name, phone, channel, amount, description, cadence,
         due_days, auto_send, next_run_at)
      VALUES (${venue}, ${body.customerName ?? null}, ${body.phone ?? null},
              ${body.channel ?? "whatsapp"}, ${amount}, ${body.description ?? null},
              ${cadence}, ${body.dueDays ?? 7}, ${body.autoSend ?? true},
              ${body.startNow ? sql`now()` : sql`now() + (${interval})::interval`})
      RETURNING id`;
    return json({ id: schedule.id }, 201);
  }

  const idMatch = path.match(/^\/api\/recurring\/([^/]+)(?:\/(toggle))?$/);
  if (idMatch) {
    if (!(await requireAuth(request, env))) {
      return json({ error: "unauthorized" }, 401);
    }
    const [, id, action] = idMatch;
    if (action === "toggle" && request.method === "POST") {
      await sql`
        UPDATE recurring_invoices SET active = NOT active
        WHERE id = ${id} AND venue_id = ${venue}`;
      return json({ ok: true });
    }
    if (request.method === "DELETE") {
      await sql`DELETE FROM recurring_invoices WHERE id = ${id} AND venue_id = ${venue}`;
      return json({ ok: true });
    }
  }

  return null;
}
