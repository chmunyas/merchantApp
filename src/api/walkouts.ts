// C9 walkout protection — report, register, resolve.
//
// Sunday help centre article 13718868 "How to Report a Walkout" is the spec:
// leave the check open, report from the dashboard OR the staff app, submit the
// table number and the amount remaining on the bill.
//
// Authorisation boundary, stated explicitly because it is easy to get wrong:
//
//   * REPORTING a walkout is staff+. It is an incident report, not a claim: it
//     moves no money, closes no check and creates no credit. Sunday's own flow
//     is explicitly available in the staff app, and a server who cannot report
//     the table they are standing at is a server who reports nothing.
//   * RESOLVING a walkout — writing the loss off, sending it for review,
//     dismissing it — is manager+, because that is where the financial decision
//     is taken and where an audit trail has to bite.
//   * The REGISTER and its loss totals (C9.6) are manager+ financial reads.
//   * DETECTION SETTINGS are owner-only, alongside the venue's other operational
//     configuration.
//
// Human-only throughout. A PAT has no shift, no floor and no accountability, so
// it must not be able to open or close a financial-loss record.

import { requireHumanAuth } from "@/api/auth";
import { getSql } from "@/lib/db";
import { roleAtLeast } from "@/lib/rbac";
import { venueFromPayload } from "@/lib/tenancy";
import {
  MAX_IDLE_MINUTES,
  MIN_IDLE_MINUTES,
  isWalkoutStatus,
  loadWalkoutCandidates,
  loadWalkoutSettings,
  normalizeWalkoutSettings,
  recordWalkoutEvent,
  saveWalkoutSettings,
  type WalkoutActor,
  type WalkoutStatus,
} from "@/lib/walkouts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Idempotency-Key",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders },
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_NOTE = 500;
const MAX_TABLE_LABEL = 60;
/** A single walkout above this is a data-entry error, not a bill. */
const MAX_OUTSTANDING_MINOR = 100_000_000;

/** Statuses a manager may move a live walkout to. `recovered` is payment-only. */
const MANAGER_STATUSES: readonly WalkoutStatus[] = [
  "under_review",
  "written_off",
  "dismissed",
];

type WalkoutRow = Record<string, unknown>;

function serialize(row: WalkoutRow) {
  return {
    id: String(row.id),
    orderId: row.order_id ? String(row.order_id) : null,
    tableKey: row.table_key ? String(row.table_key) : null,
    tableLabel: String(row.table_label ?? ""),
    outstandingMinor: Number(row.outstanding_minor ?? 0),
    observedOutstandingMinor:
      row.observed_outstanding_minor == null
        ? null
        : Number(row.observed_outstanding_minor),
    recoveredMinor: Number(row.recovered_minor ?? 0),
    currency: String(row.currency ?? "KES"),
    status: String(row.status ?? "open"),
    reviewOutcome: row.review_outcome ? String(row.review_outcome) : null,
    source: String(row.source ?? "dashboard"),
    note: row.note ? String(row.note) : null,
    idleMinutesAtReport:
      row.idle_minutes_at_report == null
        ? null
        : Number(row.idle_minutes_at_report),
    qrScannedAt: row.qr_scanned_at ? String(row.qr_scanned_at) : null,
    reportedByName: row.reported_by_name ? String(row.reported_by_name) : null,
    reportedByRole: row.reported_by_role ? String(row.reported_by_role) : null,
    recoveredPaymentId: row.recovered_payment_id
      ? String(row.recovered_payment_id)
      : null,
    resolvedAt: row.resolved_at ? String(row.resolved_at) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function money(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const minor = Math.round(n);
  if (minor < 0 || minor > MAX_OUTSTANDING_MINOR) return null;
  return minor;
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

export async function handleWalkoutsRoute(
  request: Request,
  env: unknown,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/walkouts")) return null;
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const payload = await requireHumanAuth(request, env);
  if (!payload) return json({ error: "unauthorized" }, 401);
  if (!roleAtLeast(payload, "staff")) return json({ error: "forbidden" }, 403);

  const venue = venueFromPayload(payload, url);
  const sql = getSql(env);
  if (!sql) return json({ error: "database not configured" }, 503);

  const isManager = roleAtLeast(payload, "manager");
  const actor: WalkoutActor = {
    id: payload.staff_id ?? payload.sub ?? null,
    name: payload.name ?? null,
    role: payload.role ?? null,
  };

  // --- C9.1 detection settings (owner-only) ---------------------------
  if (url.pathname === "/api/walkouts/settings") {
    if (!roleAtLeast(payload, "merchant")) {
      return json({ error: "forbidden" }, 403);
    }
    if (request.method === "GET") {
      return json({ settings: await loadWalkoutSettings(sql, venue) });
    }
    if (request.method === "PUT") {
      const body = (await request.json().catch(() => null)) as unknown;
      if (!body || typeof body !== "object") {
        return json({ error: "invalid settings" }, 400);
      }
      const raw = (body as Record<string, unknown>).idleMinutes;
      if (
        raw != null &&
        (!Number.isFinite(Number(raw)) ||
          Number(raw) < MIN_IDLE_MINUTES ||
          Number(raw) > MAX_IDLE_MINUTES)
      ) {
        return json(
          {
            error: `idleMinutes must be between ${MIN_IDLE_MINUTES} and ${MAX_IDLE_MINUTES}`,
          },
          400,
        );
      }
      const settings = normalizeWalkoutSettings(body);
      await saveWalkoutSettings(sql, venue, settings);
      return json({ settings });
    }
    return null;
  }

  // --- C9.1 candidate feed: what the floor should look at now ---------
  if (url.pathname === "/api/walkouts/candidates" && request.method === "GET") {
    const settings = await loadWalkoutSettings(sql, venue);
    const rows = await loadWalkoutCandidates(sql, venue, settings);
    return json({
      settings,
      candidates: rows.map((row) => ({
        orderId: row.orderId,
        tableKey: row.tableKey,
        tableLabel: row.tableLabel,
        currency: row.currency,
        totalMinor: row.totalMinor,
        paidMinor: row.paidMinor,
        outstandingMinor: row.verdict.outstandingMinor,
        idleMinutes: row.verdict.idleMinutes,
        qrScanned: row.qrScannedAt != null,
        alreadyReported: row.alreadyReported,
        candidate: row.verdict.candidate,
        reason: row.verdict.reason,
        openedAt: row.createdAt,
      })),
    });
  }

  // --- C9.6 register + loss reporting (manager+) -----------------------
  if (url.pathname === "/api/walkouts" && request.method === "GET") {
    if (!isManager) {
      return json(
        { error: "The walkout register is available to managers." },
        403,
      );
    }
    const status = url.searchParams.get("status");
    if (status && !isWalkoutStatus(status)) {
      return json({ error: "invalid status" }, 400);
    }
    const rows = status
      ? await sql`
          SELECT * FROM walkouts
          WHERE venue_id = ${venue} AND status = ${status}
          ORDER BY created_at DESC LIMIT 500`
      : await sql`
          SELECT * FROM walkouts
          WHERE venue_id = ${venue}
          ORDER BY created_at DESC LIMIT 500`;

    // Loss reporting. `net_loss` counts only what the venue is actually out of
    // pocket for: money still owed on live or written-off walkouts, minus
    // anything a returning guest paid. Nothing here models reimbursement.
    const [totals] = await sql`
      SELECT
        count(*)::int AS total,
        count(*) FILTER (WHERE status IN ('open','under_review'))::int AS live,
        count(*) FILTER (WHERE status = 'recovered')::int AS recovered,
        count(*) FILTER (WHERE status = 'written_off')::int AS written_off,
        COALESCE(sum(outstanding_minor), 0)::bigint AS reported_minor,
        COALESCE(sum(recovered_minor) FILTER (WHERE status = 'recovered'), 0)::bigint
          AS recovered_minor,
        COALESCE(sum(GREATEST(outstanding_minor - recovered_minor, 0))
          FILTER (WHERE status IN ('open','under_review','written_off')), 0)::bigint
          AS net_loss_minor
      FROM walkouts
      WHERE venue_id = ${venue}`;

    return json({
      walkouts: rows.map(serialize),
      summary: {
        total: Number(totals?.total ?? 0),
        live: Number(totals?.live ?? 0),
        recovered: Number(totals?.recovered ?? 0),
        writtenOff: Number(totals?.written_off ?? 0),
        reportedMinor: Number(totals?.reported_minor ?? 0),
        recoveredMinor: Number(totals?.recovered_minor ?? 0),
        netLossMinor: Number(totals?.net_loss_minor ?? 0),
      },
    });
  }

  // --- C9.2 + C9.3 report a walkout -----------------------------------
  if (url.pathname === "/api/walkouts" && request.method === "POST") {
    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;

    // Financial route: reject anything we do not understand rather than
    // silently dropping it, so a client that thinks it sent a coverage claim
    // finds out that it did not.
    const allowed = new Set([
      "orderId",
      "tableLabel",
      "outstandingMinor",
      "note",
      "source",
    ]);
    const unknownFields = Object.keys(body).filter((key) => !allowed.has(key));
    if (unknownFields.length > 0) {
      return json(
        { error: `unknown field(s): ${unknownFields.join(", ")}` },
        400,
      );
    }

    const tableLabel = text(body.tableLabel, MAX_TABLE_LABEL);
    if (!tableLabel) return json({ error: "tableLabel is required" }, 400);

    const outstandingMinor = money(body.outstandingMinor);
    if (outstandingMinor == null) {
      return json({ error: "outstandingMinor must be a valid amount" }, 400);
    }
    if (outstandingMinor === 0) {
      return json(
        { error: "There is nothing outstanding on this bill." },
        400,
      );
    }

    const source =
      body.source === "staff_app" || body.source === "dashboard"
        ? body.source
        : payload.staff_id
          ? "staff_app"
          : "dashboard";
    const note = text(body.note, MAX_NOTE);

    const orderId =
      typeof body.orderId === "string" && UUID.test(body.orderId)
        ? body.orderId
        : null;
    if (body.orderId != null && !orderId) {
      return json({ error: "orderId must be a uuid" }, 400);
    }

    // Everything the report needs about the check, resolved server-side. The
    // amount the guest still owes is NEVER taken from the client alone — the
    // reporter's figure is recorded next to ours so a review can see divergence.
    let observed: {
      tableKey: string | null;
      tableLabel: string | null;
      currency: string;
      outstandingMinor: number;
      idleMinutes: number;
      qrScannedAt: string | null;
    } | null = null;

    if (orderId) {
      const settings = await loadWalkoutSettings(sql, venue);
      const rows = await loadWalkoutCandidates(sql, venue, settings);
      const match = rows.find((row) => row.orderId === orderId);
      if (!match) {
        return json(
          {
            error:
              "That check is not open in this venue. Leave the check open and try again.",
          },
          404,
        );
      }
      observed = {
        tableKey: match.tableKey,
        tableLabel: match.tableLabel,
        currency: match.currency,
        outstandingMinor: match.verdict.outstandingMinor,
        idleMinutes: match.verdict.idleMinutes,
        qrScannedAt: match.qrScannedAt ? String(match.qrScannedAt) : null,
      };
    }

    // Idempotent by construction: `walkouts_live_per_order` allows exactly one
    // live walkout per check, so a double-tap on the floor — or the same table
    // reported from the dashboard and the staff app at once — converges on the
    // row that already exists instead of doubling the recorded loss.
    const [inserted] = await sql`
      INSERT INTO walkouts
        (venue_id, order_id, table_key, table_label, outstanding_minor,
         observed_outstanding_minor, currency, status, source, note,
         qr_scanned_at, idle_minutes_at_report,
         reported_by, reported_by_name, reported_by_role)
      VALUES
        (${venue}, ${orderId}, ${observed?.tableKey ?? null},
         ${observed?.tableLabel ?? tableLabel}, ${outstandingMinor},
         ${observed?.outstandingMinor ?? null}, ${observed?.currency ?? "KES"},
         'open', ${source}, ${note},
         ${observed?.qrScannedAt ?? null}, ${observed?.idleMinutes ?? null},
         ${actor.id}, ${actor.name}, ${actor.role})
      ON CONFLICT (venue_id, order_id)
        WHERE order_id IS NOT NULL AND status IN ('open','under_review')
      DO NOTHING
      RETURNING *`;

    if (!inserted) {
      const [existing] = await sql`
        SELECT * FROM walkouts
        WHERE venue_id = ${venue} AND order_id = ${orderId}
          AND status IN ('open','under_review')
        ORDER BY created_at DESC LIMIT 1`;
      if (existing) {
        return json({ walkout: serialize(existing), duplicate: true }, 200);
      }
      return json({ error: "could not record this walkout" }, 500);
    }

    await recordWalkoutEvent(sql, {
      venue,
      walkoutId: String(inserted.id),
      event: "reported",
      toStatus: "open",
      actor,
      detail: {
        source,
        order_id: orderId,
        reported_outstanding_minor: outstandingMinor,
        observed_outstanding_minor: observed?.outstandingMinor ?? null,
        idle_minutes: observed?.idleMinutes ?? null,
      },
    });

    return json({ walkout: serialize(inserted), duplicate: false }, 201);
  }

  // --- Resolve a walkout (manager+) ------------------------------------
  const detail = url.pathname.match(/^\/api\/walkouts\/([^/]+)$/);
  if (detail && request.method === "PATCH") {
    if (!isManager) {
      return json(
        { error: "Only a manager can resolve a walkout." },
        403,
      );
    }
    const id = detail[1];
    if (!UUID.test(id)) return json({ error: "not found" }, 404);
    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const next = body.status;
    if (!isWalkoutStatus(next) || !MANAGER_STATUSES.includes(next)) {
      return json(
        {
          error: `status must be one of: ${MANAGER_STATUSES.join(", ")}`,
        },
        400,
      );
    }

    const [current] = await sql`
      SELECT * FROM walkouts WHERE id = ${id} AND venue_id = ${venue} LIMIT 1`;
    if (!current) return json({ error: "not found" }, 404);
    if (current.status === "recovered") {
      return json(
        { error: "The guest paid this bill. It cannot be reopened." },
        409,
      );
    }

    // `review_outcome` is free text a human writes. It is a record of a business
    // decision — it never triggers a payment, a credit or a tip top-up here.
    const outcome = text(body.reviewOutcome, MAX_NOTE);

    const [updated] = await sql`
      UPDATE walkouts
      SET status = ${next},
          review_outcome = COALESCE(${outcome}, review_outcome),
          resolved_at = CASE WHEN ${next} = 'under_review' THEN NULL ELSE now() END,
          updated_at = now()
      WHERE id = ${id} AND venue_id = ${venue}
      RETURNING *`;

    await recordWalkoutEvent(sql, {
      venue,
      walkoutId: id,
      event: "status_changed",
      fromStatus: String(current.status),
      toStatus: next,
      actor,
      detail: { review_outcome: outcome },
    });

    return json({ walkout: serialize(updated) });
  }

  return null;
}
