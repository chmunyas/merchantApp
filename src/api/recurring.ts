import { getSql } from "@/lib/db";
import {
  processInvoiceCommunications,
  runRecurring,
  runReminders,
} from "@/lib/invoicing";
import {
  PLAN_LIMITS,
  planOf,
  requireAuth,
  resolveVenue,
} from "@/api/auth";
import { envVar } from "@/lib/env";
import { verifyToken } from "@/lib/webhook-verify";
import { tokenHasScope } from "@/lib/api-tokens";
import { roleAtLeast } from "@/lib/rbac";

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
    const cronSecret = envVar(env, "CRON_SECRET");
    if (cronSecret) {
      if (!verifyToken(request.headers.get("x-cron-secret"), cronSecret)) {
        return json({ error: "unauthorized" }, 401);
      }
    } else {
      const payload = await requireAuth(request, env);
      if (!payload) return json({ error: "unauthorized" }, 401);
      if (!roleAtLeast(payload, "manager")) return json({ error: "forbidden" }, 403);
    }
    const venue = await resolveVenue(request, env, url);
    const reminders = await runReminders(env, venue);
    const recurring = await runRecurring(env, venue);
    const communications = await processInvoiceCommunications(env, 100);
    return json({
      remindersSent: reminders.sent,
      recurringGenerated: recurring.generated,
      communications,
    });
  }

  if (!path.startsWith("/api/recurring")) return null;

  const sql = getSql(env);
  if (!sql) return json({ error: "database not configured" }, 503);
  const venue = await resolveVenue(request, env, url);

  if (path === "/api/recurring" && request.method === "GET") {
    const payload = await requireAuth(request, env);
    if (!payload) {
      return json({ error: "unauthorized" }, 401);
    }
    if (!roleAtLeast(payload, "manager") || !tokenHasScope(payload, "invoices:read")) {
      return json({ error: "forbidden" }, 403);
    }
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
    if (!roleAtLeast(auth, "manager") || !tokenHasScope(auth, "invoices:write")) {
      return json({ error: "forbidden" }, 403);
    }
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
      currency?: string;
      description?: string;
      cadence?: string;
      dueDays?: number;
      autoSend?: boolean;
      startNow?: boolean;
    };
    const amount = Number(body.amount ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) return json({ error: "finite positive amount required" }, 400);
    const currency = String(body.currency ?? "KES").toUpperCase();
    if (currency !== "KES") return json({ error: "Only KES recurring invoices are supported." }, 400);
    if (body.cadence !== "weekly" && body.cadence !== "monthly") {
      return json({ error: "cadence must be weekly or monthly" }, 400);
    }
    const cadence = body.cadence;
    const dueDays = Number(body.dueDays ?? 7);
    if (!Number.isInteger(dueDays) || dueDays < 0 || dueDays > 365) {
      return json({ error: "dueDays must be an integer from 0 to 365" }, 400);
    }
    const interval = cadence === "weekly" ? "7 days" : "1 month";
    const [schedule] = await sql`
      INSERT INTO recurring_invoices
        (venue_id, customer_name, phone, channel, amount, currency, description, cadence,
         due_days, auto_send, next_run_at)
            VALUES (${venue}, ${body.customerName ?? null}, ${body.phone ?? null},
              ${body.channel ?? "whatsapp"}, ${amount}, ${currency}, ${body.description ?? null},
              ${cadence}, ${dueDays}, ${body.autoSend ?? true},
              ${body.startNow ? sql`now()` : sql`now() + (${interval})::interval`})
      RETURNING id`;
    return json({ id: schedule.id }, 201);
  }

  const idMatch = path.match(/^\/api\/recurring\/([^/]+)(?:\/(toggle))?$/);
  if (idMatch) {
    const payload = await requireAuth(request, env);
    if (!payload) {
      return json({ error: "unauthorized" }, 401);
    }
    if (!roleAtLeast(payload, "manager") || !tokenHasScope(payload, "invoices:write")) {
      return json({ error: "forbidden" }, 403);
    }
    const [, id, action] = idMatch;
    if (action === "toggle" && request.method === "POST") {
      await sql`
        UPDATE recurring_invoices SET active = NOT active
        WHERE id = ${id} AND venue_id = ${venue}`;
      return json({ ok: true });
    }
    if (request.method === "DELETE") {
      await sql`
        UPDATE recurring_invoices SET active = false
        WHERE id = ${id} AND venue_id = ${venue}`;
      return json({ ok: true });
    }
  }

  return null;
}
