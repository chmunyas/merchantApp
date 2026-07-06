import { getSql } from "@/lib/db";
import { postTipPayoutEntry } from "@/lib/accounting";
import { requireAuth } from "@/api/auth";
import { venueFromPayload } from "@/lib/tenancy";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders },
  });
}

type TipRule = "equal" | "by_hours" | "fixed";

function money(value: unknown): number {
  return Number(value ?? 0);
}

function validUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function staffIdFrom(payload: Record<string, unknown>, url: URL): string | null {
  const fromPayload = payload.staff_id;
  if (typeof fromPayload === "string" && validUuid(fromPayload)) {
    return fromPayload;
  }
  const fromQuery = url.searchParams.get("staff");
  if (fromQuery && validUuid(fromQuery)) return fromQuery;
  return null;
}

export async function handleTipsRoute(
  request: Request,
  env: unknown,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/tips")) return null;

  const payload = await requireAuth(request, env);
  if (!payload) return json({ error: "unauthorized" }, 401);
  const venue = venueFromPayload(payload, url);
  const sql = getSql(env);
  if (!sql) return json({ error: "database not configured" }, 503);

  if (url.pathname === "/api/tips" && request.method === "GET") {
    const period = url.searchParams.get("period") ?? "";
    const scope = url.searchParams.get("scope") === "me" ? "me" : "team";
    const staffId = staffIdFrom(payload, url);

    if (scope === "me" && staffId) {
      const [row] = await sql`
        SELECT coalesce(sum(tip_amount), 0)::bigint AS tips,
               count(*)::int AS payments
        FROM payments
        WHERE venue_id = ${venue}
          AND staff_id = ${staffId}
          AND tip_amount > 0
          AND (${period} <> 'today' OR created_at::date = CURRENT_DATE)`;
      const tips = money(row?.tips);
      return json({
        tips: [{ staff_id: staffId, tips, payments: Number(row?.payments ?? 0) }],
        total: tips,
      });
    }

    const tips = await sql`
      SELECT p.staff_id, s.name, sum(p.tip_amount)::bigint AS tips,
             count(*)::int AS payments
      FROM payments p
      LEFT JOIN staff s ON s.id = p.staff_id
      WHERE p.venue_id = ${venue}
        AND p.tip_amount > 0
        AND (${period} <> 'today' OR p.created_at::date = CURRENT_DATE)
      GROUP BY p.staff_id, s.name
      ORDER BY tips DESC`;
    const rows = tips.map((row) => ({
      ...row,
      tips: money(row.tips),
      payments: Number(row.payments ?? 0),
    }));
    return json({
      tips: rows,
      total: rows.reduce((sum, row) => sum + row.tips, 0),
    });
  }

  if (url.pathname === "/api/tips/pool/run" && request.method === "POST") {
    const body = (await request.json().catch(() => ({}))) as {
      rule?: string;
      period?: string;
      staffIds?: unknown;
    };
    const rule: TipRule = ["equal", "by_hours", "fixed"].includes(body.rule ?? "")
      ? (body.rule as TipRule)
      : "equal";
    const period = String(body.period ?? "today").trim() || "today";
    if (
      Array.isArray(body.staffIds) &&
      body.staffIds.some((id) => typeof id !== "string" || !validUuid(id))
    ) {
      return json({ error: "invalid staffIds" }, 400);
    }
    const requestedIds = Array.isArray(body.staffIds)
      ? body.staffIds.filter(
          (id): id is string => typeof id === "string" && validUuid(id),
        )
      : [];

    const staff = requestedIds.length
      ? await sql`
          SELECT id, name FROM staff
          WHERE venue_id = ${venue}
            AND active = true
            AND id IN (SELECT unnest(${requestedIds}::uuid[]))
          ORDER BY created_at`
      : await sql`
          SELECT id, name FROM staff
          WHERE venue_id = ${venue} AND active = true
          ORDER BY created_at`;
    if (staff.length === 0) return json({ error: "no active staff" }, 400);

    const [{ total_tips }] = await sql`
      SELECT coalesce(sum(tip_amount), 0)::bigint AS total_tips
      FROM payments
      WHERE venue_id = ${venue}
        AND tip_amount > 0
        AND (${period} <> 'today' OR created_at::date = CURRENT_DATE)`;
    const [{ allocated }] = await sql`
      SELECT coalesce(sum(amount), 0)::bigint AS allocated
      FROM tip_allocations
      WHERE venue_id = ${venue} AND period = ${period}`;
    const total = Math.max(0, money(total_tips) - money(allocated));
    if (total <= 0) return json({ error: "no unallocated tips", total: 0 }, 400);

    const base = Math.floor(total / staff.length);
    const remainder = total % staff.length;
    const result = await sql.begin(async (tx) => {
      const [pool] = await tx`
        INSERT INTO tip_pools (venue_id, rule, period)
        VALUES (${venue}, ${rule}, ${period})
        RETURNING id, venue_id, rule, period, created_at`;
      const allocations = [];
      for (let i = 0; i < staff.length; i += 1) {
        const amount = base + (i < remainder ? 1 : 0);
        const [allocation] = await tx`
          INSERT INTO tip_allocations (pool_id, venue_id, staff_id, amount, period)
          VALUES (${pool.id}, ${venue}, ${staff[i].id}, ${amount}, ${period})
          RETURNING id, pool_id, venue_id, staff_id, amount, period, paid_at, created_at`;
        allocations.push({ ...allocation, amount: money(allocation.amount) });
      }
      return { pool, allocations };
    });

    return json(result);
  }

  if (url.pathname === "/api/tips/report" && request.method === "GET") {
    const period = url.searchParams.get("period");
    const pools = await sql`
      SELECT id, venue_id, rule, period, created_at
      FROM tip_pools
      WHERE venue_id = ${venue}
        AND (${period}::text IS NULL OR period = ${period})
      ORDER BY created_at DESC`;
    const allocations = await sql`
      SELECT a.id, a.pool_id, a.venue_id, a.staff_id, s.name, a.amount,
             a.period, a.paid_at, a.created_at
      FROM tip_allocations a
      LEFT JOIN staff s ON s.id = a.staff_id
      WHERE a.venue_id = ${venue}
        AND (${period}::text IS NULL OR a.period = ${period})
      ORDER BY a.created_at DESC`;
    return json({
      pools,
      allocations: allocations.map((row) => ({
        ...row,
        amount: money(row.amount),
      })),
    });
  }

  // Pay out pooled tips to staff: clears the Tips Payable liability and posts
  // the double-entry payout (Dr Tips Payable, Cr Bank). Manager/owner only.
  if (url.pathname === "/api/tips/payout" && request.method === "POST") {
    const role = typeof payload.role === "string" ? payload.role : "";
    if (!["manager", "merchant", "admin"].includes(role)) {
      return json({ error: "forbidden" }, 403);
    }
    const body = (await request.json().catch(() => ({}))) as { period?: string };
    const period = typeof body.period === "string" ? body.period.trim() : "";
    const paid = await sql`
      UPDATE tip_allocations
      SET paid_at = now()
      WHERE venue_id = ${venue} AND paid_at IS NULL
        AND (${period} = '' OR period = ${period})
      RETURNING amount`;
    const total = paid.reduce((sum, row) => sum + money(row.amount), 0);
    if (total > 0) {
      try {
        await postTipPayoutEntry(sql, {
          venue,
          id: crypto.randomUUID(),
          amount: total,
        });
      } catch {
        /* best-effort accounting */
      }
    }
    return json({ ok: true, paidCount: paid.length, total });
  }

  return null;
}
