import { requireHumanAuth } from "@/api/auth";
import { getSql } from "@/lib/db";
import { hashPassword } from "@/lib/jwt";
import {
  ROLE_RANK,
  canGrantRole,
  canRemoveMember,
  planLimit,
  planLimitMessage,
  planOf,
} from "@/lib/tenancy";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders },
  });
}

function parseDate(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : fallback;
}

// Owner/manager-per-store + chain rollup. Builds on the `user_venues` membership
// table (db/42): a member's role is per-STORE (uv.role), independent of the
// token's current-venue claim, so a chain owner can manage each store's team and
// see a cross-store revenue rollup from one login.
//   GET    /api/venues/members?venue=  — list a store's team (manager+ there)
//   POST   /api/venues/members         — add/invite a member or change their role
//   DELETE /api/venues/members?venue=&email= — remove a member from a store
//   GET    /api/venues/rollup?from=&to= — revenue across every store you manage
export async function handleMultiStoreRoute(
  request: Request,
  env: unknown,
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (path !== "/api/venues/members" && path !== "/api/venues/rollup") {
    return null;
  }
  if (request.method === "OPTIONS") return json({ ok: true });

  const payload = await requireHumanAuth(request, env);
  if (!payload) return json({ error: "unauthorized" }, 401);
  const sql = getSql(env);
  if (!sql) return json({ error: "database not configured" }, 503);
  const email =
    typeof payload.sub === "string" ? payload.sub.toLowerCase() : "";
  if (!email.includes("@")) return json({ error: "forbidden" }, 403);

  // --- Chain rollup: net revenue across every store this login MANAGES ---
  if (path === "/api/venues/rollup") {
    if (request.method !== "GET") return null;
    const now = Date.now();
    const from = parseDate(url.searchParams.get("from"), now - 30 * 86_400_000);
    const to = parseDate(url.searchParams.get("to"), now + 86_400_000);
    const rows = await sql`
      SELECT v.id, v.name,
        COALESCE(sum(CASE WHEN p.status IN ('succeeded','paid','captured','partially_refunded','refunded')
          AND COALESCE(p.kind,'') <> 'refund' THEN p.amount ELSE 0 END),0)::bigint AS gross,
        COALESCE(sum(CASE WHEN p.status IN ('succeeded','paid','captured','partially_refunded','refunded')
          AND COALESCE(p.kind,'') <> 'refund' THEN COALESCE(p.tip_amount,0) - COALESCE((
            SELECT sum(fa.amount) FROM financial_adjustments fa
            WHERE fa.payment_id = p.id AND fa.component='tip'
          ),0) ELSE 0 END),0)::bigint AS tips,
        COALESCE(sum(CASE WHEN p.kind = 'refund' AND p.status = 'refunded'
          THEN p.amount ELSE 0 END),0)::bigint AS refunds,
        count(*) FILTER (WHERE p.status IN ('succeeded','paid','captured','partially_refunded','refunded')
          AND COALESCE(p.kind,'') <> 'refund') AS txns
      FROM user_venues uv
      JOIN app_users u ON u.id = uv.user_id
      JOIN venues v ON v.id = uv.venue_id
      LEFT JOIN payments p ON p.venue_id = v.id
        AND p.currency = 'KES'
        AND p.created_at >= ${new Date(from).toISOString()}
        AND p.created_at < ${new Date(to).toISOString()}
      WHERE lower(u.email) = ${email}
        AND uv.role IN ('manager','merchant','admin','reseller_admin')
      GROUP BY v.id, v.name
      ORDER BY gross DESC`;
    const stores = rows.map((r) => {
      const gross = Number(r.gross) || 0;
      const refunds = Number(r.refunds) || 0;
      return {
        id: String(r.id),
        name: String(r.name),
        gross,
        tips: Number(r.tips) || 0,
        refunds,
        net: gross - refunds,
        txns: Number(r.txns) || 0,
      };
    });
    const total = stores.reduce(
      (acc, s) => ({
        gross: acc.gross + s.gross,
        tips: acc.tips + s.tips,
        refunds: acc.refunds + s.refunds,
        net: acc.net + s.net,
        txns: acc.txns + s.txns,
      }),
      { gross: 0, tips: 0, refunds: 0, net: 0, txns: 0 },
    );
    return json({
      currency: "KES",
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
      stores,
      total,
    });
  }

  // --- Team management: caller must be manager+ AT the target store ---
  const venue = (
    url.searchParams.get("venue") ||
    (typeof payload.venue === "string" ? payload.venue : "") ||
    ""
  ).trim();
  if (!venue) return json({ error: "venue required" }, 400);

  // The caller's authoritative role at THIS store (from membership, not the
  // token's current-venue claim) — so a chain owner can manage any store's team.
  const [callerRow] = await sql`
    SELECT uv.role FROM user_venues uv
    JOIN app_users u ON u.id = uv.user_id
    WHERE lower(u.email) = ${email} AND uv.venue_id = ${venue}
    LIMIT 1`;
  const callerRole = callerRow ? String(callerRow.role) : "";
  if (!callerRole || (ROLE_RANK[callerRole] ?? 0) < ROLE_RANK.manager) {
    return json({ error: "forbidden" }, 403);
  }

  if (request.method === "GET") {
    const rows = await sql`
            SELECT u.email, u.name, uv.role, uv.membership_version,
              uv.created_at, uv.updated_at
      FROM user_venues uv JOIN app_users u ON u.id = uv.user_id
      WHERE uv.venue_id = ${venue}
      ORDER BY uv.created_at ASC`;
    const members = rows.map((r) => ({
      email: String(r.email),
      name: (r.name as string) ?? null,
      role: String(r.role),
      membershipVersion: Number(r.membership_version),
      you: String(r.email).toLowerCase() === email,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
    return json({ venue, callerRole, members });
  }

  if (request.method === "POST") {
    const body = (await request.json().catch(() => ({}))) as {
      email?: string;
      role?: string;
      name?: string;
    };
    const targetEmail = String(body.email ?? "").trim().toLowerCase();
    const role = String(body.role ?? "").trim();
    const name = String(body.name ?? "").trim() || null;
    if (!targetEmail.includes("@")) {
      return json({ error: "A valid email is required." }, 400);
    }
    if (!canGrantRole(callerRole, role)) {
      return json({ error: "You cannot grant that role." }, 403);
    }

    const [existing] = await sql`
      SELECT id FROM app_users WHERE lower(email) = ${targetEmail} LIMIT 1`;

    // Plan cap on team size (per store) — only when this creates a NEW seat.
    let seatCount = 0;
    if (existing) {
      const [{ n }] = await sql`
        SELECT count(*)::int AS n FROM user_venues
        WHERE venue_id = ${venue} AND user_id = ${existing.id}`;
      seatCount = Number(n);
    }
    if (seatCount === 0) {
      const [{ total }] = await sql`
        SELECT count(*)::int AS total FROM user_venues WHERE venue_id = ${venue}`;
      const plan = planOf(payload);
      if (Number(total) >= planLimit(plan, "staff")) {
        return json({ error: planLimitMessage(plan, "staff") }, 402);
      }
    }

    let userId: string;
    let invited = false;
    if (existing) {
      userId = String(existing.id);
      if (name) {
        await sql`UPDATE app_users SET name = COALESCE(name, ${name}) WHERE id = ${userId}`;
      }
    } else {
      invited = true;
      const orgId = typeof payload.org === "string" ? payload.org : null;
      // Unusable password — the invitee gains access via Google sign-in on the
      // same email or a password reset; no shared secret is ever issued here.
      const pw = await hashPassword(`invite:${crypto.randomUUID()}`);
      const [created] = await sql`
        INSERT INTO app_users (email, password_hash, name, venue_id, role, plan, org_id)
        VALUES (${targetEmail}, ${pw}, ${name}, ${venue}, ${role}, 'free', ${orgId})
        RETURNING id`;
      userId = String(created.id);
    }

    const mutation = await sql.begin(async (transaction) => {
      const [priorMembership] = await transaction`
        SELECT role, membership_version
        FROM user_venues
        WHERE user_id = ${userId} AND venue_id = ${venue}
        LIMIT 1
        FOR UPDATE`;
      if (
        targetEmail === email &&
        priorMembership &&
        String(priorMembership.role) !== role
      ) {
        return { error: "You cannot change your own role." } as const;
      }

      const [membership] = await transaction`
        INSERT INTO user_venues (user_id, venue_id, role, updated_by)
        VALUES (${userId}, ${venue}, ${role}, ${email})
        ON CONFLICT (user_id, venue_id) DO UPDATE
          SET role = EXCLUDED.role, updated_by = EXCLUDED.updated_by
        RETURNING role, membership_version`;
      const changed =
        !priorMembership ||
        String(priorMembership.role) !== String(membership.role);
      if (changed) {
        const action = priorMembership ? "role_changed" : "member_added";
        await transaction`
          INSERT INTO venue_membership_events
            (venue_id, user_id, subject_email, actor_sub, actor_role, action,
             prior_role, next_role, prior_version, next_version, correlation_id)
          VALUES
            (${venue}, ${userId}, ${targetEmail}, ${email}, ${callerRole}, ${action},
             ${priorMembership?.role ?? null}, ${membership.role},
             ${priorMembership?.membership_version ?? null},
             ${membership.membership_version}, ${crypto.randomUUID()})`;
      }
      return { membership } as const;
    });
    if ("error" in mutation) {
      return json({ error: "You cannot change your own role." }, 400);
    }
    const { membership } = mutation;
    return json(
      {
        member: {
          email: targetEmail,
          name,
          role: membership.role,
          membershipVersion: Number(membership.membership_version),
          invited,
        },
      },
      201,
    );
  }

  if (request.method === "DELETE") {
    const targetEmail = (url.searchParams.get("email") || "")
      .trim()
      .toLowerCase();
    if (!targetEmail.includes("@")) return json({ error: "email required" }, 400);
    if (targetEmail === email) {
      return json({ error: "You cannot remove yourself." }, 400);
    }
    const removal = await sql.begin(async (transaction) => {
      const [target] = await transaction`
        SELECT u.id, uv.role, uv.membership_version FROM user_venues uv
        JOIN app_users u ON u.id = uv.user_id
        WHERE uv.venue_id = ${venue} AND lower(u.email) = ${targetEmail}
        LIMIT 1
        FOR UPDATE OF uv`;
      if (!target) {
        return { status: 404, error: "Not a member of that store." } as const;
      }
      if (!canRemoveMember(callerRole, String(target.role))) {
        return {
          status: 403,
          error: "You cannot remove a higher-ranked member.",
        } as const;
      }
      // Never orphan a store: keep at least one owner.
      if (String(target.role) === "merchant") {
        const [{ owners }] = await transaction`
          SELECT count(*)::int AS owners FROM user_venues
          WHERE venue_id = ${venue} AND role = 'merchant'`;
        if (Number(owners) <= 1) {
          return {
            status: 409,
            error: "A store must keep at least one owner.",
          } as const;
        }
      }
      await transaction`
        DELETE FROM user_venues
        WHERE user_id = ${target.id} AND venue_id = ${venue}`;
      await transaction`
        INSERT INTO venue_membership_events
          (venue_id, user_id, subject_email, actor_sub, actor_role, action,
           prior_role, next_role, prior_version, next_version, correlation_id)
        VALUES
          (${venue}, ${target.id}, ${targetEmail}, ${email}, ${callerRole},
           'member_removed', ${target.role}, NULL,
           ${target.membership_version}, NULL, ${crypto.randomUUID()})`;
      return { status: 200 } as const;
    });
    if ("error" in removal) {
      return json({ error: removal.error }, removal.status);
    }
    return json({ ok: true });
  }

  return null;
}
