import { requireAuth } from "@/api/auth";
import { getSql } from "@/lib/db";
import { envVar } from "@/lib/env";
import { decryptAccountNumber } from "@/lib/payout-details";
import { buildPayoutRequest, mapProviderStatus } from "@/lib/payout-provider";
import { canTransition, decideApproval, salaryPeriodLabel } from "@/lib/payout-runs";
import { planSalaryRun, validateSalary, type SalaryStaff } from "@/lib/payroll";
import { PESALINK_BANKS } from "@/lib/pesaswap-banks";
import { roleAtLeast } from "@/lib/rbac";
import { venueFromPayload } from "@/lib/tenancy";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders },
  });
}

function validUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

type RunRow = Record<string, unknown>;

function runView(row: RunRow) {
  return {
    id: String(row.id),
    kind: String(row.kind),
    period: String(row.period_label),
    status: String(row.status),
    totalAmount: Number(row.total_amount ?? 0),
    staffCount: Number(row.staff_count ?? 0),
    note: row.note ? String(row.note) : null,
    createdBy: String(row.created_by),
    createdAt: new Date(String(row.created_at)).toISOString(),
    approvedBy: row.approved_by ? String(row.approved_by) : null,
    approvedAt: row.approved_at ? new Date(String(row.approved_at)).toISOString() : null,
    selfApproved: Boolean(row.self_approved),
    rejectedBy: row.rejected_by ? String(row.rejected_by) : null,
    rejectionReason: row.rejection_reason ? String(row.rejection_reason) : null,
    submittedAt: row.submitted_at ? new Date(String(row.submitted_at)).toISOString() : null,
  };
}

/**
 * Submits every payable line of an approved run to PesaSwap.
 *
 * Shared by tips and salaries so there is one place that talks to the payout
 * rail, one place that maps a destination onto a channel, and one place that
 * interprets the provider's answer.
 */
async function submitRun(
  env: unknown,
  venue: string,
  runId: string,
  kind: string,
): Promise<{ submitted: number; held: number; skipped: string | null }> {
  const sql = getSql(env);
  if (!sql) return { submitted: 0, held: 0, skipped: "database-unavailable" };
  const apiKey = envVar(env, "PESASWAP_API_KEY");
  const baseUrl = envVar(env, "PESASWAP_URL") || "https://api.pesaswap.io";
  const profileId = envVar(env, "PESASWAP_PROFILE_ID");
  const secret = envVar(env, "STAFF_PAYOUT_KEY");
  const table = kind === "salary" ? "salary_payouts" : "tip_payouts";

  const pending =
    table === "salary_payouts"
      ? await sql`
          SELECT p.id, p.staff_id, p.amount, p.idempotency_key,
                 d.method AS payout_method, d.account_cipher, d.bank_code
          FROM salary_payouts p
          LEFT JOIN staff_payout_details d
            ON d.venue_id = p.venue_id AND d.staff_id = p.staff_id
          WHERE p.venue_id = ${venue} AND p.run_id = ${runId} AND p.status = 'pending'
          ORDER BY p.created_at`
      : await sql`
          SELECT p.id, p.staff_id, p.amount, p.idempotency_key,
                 d.method AS payout_method, d.account_cipher, d.bank_code
          FROM tip_payouts p
          LEFT JOIN staff_payout_details d
            ON d.venue_id = p.venue_id AND d.staff_id = p.staff_id
          WHERE p.venue_id = ${venue} AND p.run_id = ${runId} AND p.status = 'pending'
          ORDER BY p.created_at`;

  let submitted = 0;
  let held = 0;
  for (const row of pending) {
    const method = row.payout_method ? String(row.payout_method) : null;
    let accountNumber: string | null = null;
    if ((method === "mpesa" || method === "bank") && secret && row.account_cipher) {
      try {
        accountNumber = await decryptAccountNumber(secret, String(row.account_cipher));
      } catch {
        accountNumber = null;
      }
    }
    const request =
      accountNumber && (method === "mpesa" || method === "bank")
        ? buildPayoutRequest({
            destination:
              method === "mpesa"
                ? { method: "mpesa", accountNumber }
                : {
                    method: "bank",
                    accountNumber,
                    bankCode: row.bank_code ? String(row.bank_code) : null,
                  },
            amountMinor: Number(row.amount),
            profileId: profileId ?? "",
            metadata: {
              payout_kind: kind,
              payout_id: String(row.id),
              run_id: runId,
              venue_id: venue,
              staff_id: String(row.staff_id),
            },
          })
        : ({ ok: false, heldReason: "no_payout_details" } as const);

    if (!request.ok) {
      if (table === "salary_payouts") {
        await sql`UPDATE salary_payouts SET status = 'held', held_reason = ${request.heldReason}
                  WHERE id = ${row.id} AND status = 'pending'`;
      } else {
        await sql`UPDATE tip_payouts SET status = 'held', held_reason = ${request.heldReason}
                  WHERE id = ${row.id} AND status = 'pending'`;
      }
      held += 1;
      continue;
    }
    if (!apiKey || !profileId) continue;
    try {
      const provider = await fetch(`${baseUrl}/payouts/create`, {
        method: "POST",
        headers: {
          "api-key": apiKey,
          "Content-Type": "application/json",
          "Idempotency-Key": String(row.idempotency_key),
        },
        body: JSON.stringify(request.body),
      });
      const body = (await provider.json().catch(() => ({}))) as Record<string, unknown>;
      const status = mapProviderStatus(String(body.status ?? "unknown"));
      const providerRef = String(body.payout_id ?? "") || null;
      if (table === "salary_payouts") {
        await sql`UPDATE salary_payouts SET status = ${status}, provider_ref = ${providerRef}
                  WHERE id = ${row.id}`;
      } else {
        await sql`UPDATE tip_payouts SET status = ${status}, provider_ref = ${providerRef}
                  WHERE id = ${row.id}`;
      }
      submitted += 1;
    } catch {
      if (table === "salary_payouts") {
        await sql`UPDATE salary_payouts SET status = 'unknown' WHERE id = ${row.id}`;
      } else {
        await sql`UPDATE tip_payouts SET status = 'unknown' WHERE id = ${row.id}`;
      }
    }
  }

  if (submitted > 0) {
    await sql`
      UPDATE staff_payout_runs
      SET status = 'submitted', submitted_at = COALESCE(submitted_at, now()), updated_at = now()
      WHERE id = ${runId} AND status = 'approved'`;
  }
  return { submitted, held, skipped: apiKey && profileId ? null : "credentials-unavailable" };
}

export async function handlePayoutsRoute(request: Request, env: unknown): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  const payload = await requireAuth(request, env);
  if (!payload) return json({ error: "unauthorized" }, 401);
  // Authorising a payment is an act by a person. A token has nobody behind it.
  if (payload.isApiToken === true) return json({ error: "human session required" }, 403);
  const venue = venueFromPayload(payload, url);
  const sql = getSql(env);
  if (!sql) return json({ error: "database not configured" }, 503);

  const actor = typeof payload.sub === "string" ? payload.sub : "unknown";
  const actorStaffId =
    typeof payload.staff_id === "string" && validUuid(payload.staff_id) ? payload.staff_id : null;

  // The bank list a staff member picks from. Read-only reference data, but
  // staff-visible because they choose their own destination.
  if (url.pathname === "/api/payouts/banks" && request.method === "GET") {
    return json({ banks: PESALINK_BANKS });
  }

  if (!roleAtLeast(payload, "manager")) return json({ error: "forbidden" }, 403);

  if (url.pathname === "/api/payouts/runs" && request.method === "GET") {
    const kind = url.searchParams.get("kind");
    const rows = await sql`
      SELECT * FROM staff_payout_runs
      WHERE venue_id = ${venue}
        AND (${kind ?? null}::text IS NULL OR kind = ${kind ?? null})
      ORDER BY created_at DESC
      LIMIT 100`;
    return json({ runs: rows.map(runView) });
  }

  const runMatch = url.pathname.match(
    /^\/api\/payouts\/runs\/([0-9a-fA-F-]{36})(?:\/(approve|reject))?$/,
  );
  if (runMatch) {
    const runId = runMatch[1];
    const action = runMatch[2];
    if (!validUuid(runId)) return json({ error: "not found" }, 404);
    const [run] = await sql`
      SELECT * FROM staff_payout_runs WHERE id = ${runId} AND venue_id = ${venue} LIMIT 1`;
    if (!run) return json({ error: "not found" }, 404);

    if (!action && request.method === "GET") {
      const lines =
        String(run.kind) === "salary"
          ? await sql`
              SELECT p.id, p.staff_id, s.name, p.amount, p.status, p.held_reason
              FROM salary_payouts p LEFT JOIN staff s ON s.id = p.staff_id
              WHERE p.venue_id = ${venue} AND p.run_id = ${runId} ORDER BY s.name`
          : await sql`
              SELECT p.id, p.staff_id, s.name, p.amount, p.status, p.held_reason
              FROM tip_payouts p LEFT JOIN staff s ON s.id = p.staff_id
              WHERE p.venue_id = ${venue} AND p.run_id = ${runId} ORDER BY s.name`;
      return json({
        run: runView(run),
        lines: lines.map((line) => ({
          id: String(line.id),
          staffId: String(line.staff_id),
          name: line.name ? String(line.name) : "Unknown",
          amount: Number(line.amount),
          status: String(line.status),
          heldReason: line.held_reason ? String(line.held_reason) : null,
        })),
      });
    }

    if (action === "approve" && request.method === "POST") {
      const payees = await (String(run.kind) === "salary"
        ? sql`SELECT DISTINCT staff_id FROM salary_payouts
              WHERE venue_id = ${venue} AND run_id = ${runId} AND status = 'pending'`
        : sql`SELECT DISTINCT staff_id FROM tip_payouts
              WHERE venue_id = ${venue} AND run_id = ${runId} AND status = 'pending'`);
      const payeeIds = payees.map((p) => String(p.staff_id));
      const decision = decideApproval({
        status: String(run.status),
        staffCount: Number(run.staff_count ?? 0),
        totalAmount: Number(run.total_amount ?? 0),
        approverStaffId: actorStaffId,
        payeeStaffIds: payeeIds,
      });
      if (!decision.ok) {
        return json(
          {
            error:
              decision.reason === "empty-run"
                ? "There is nothing payable in this run."
                : `A run in '${String(run.status)}' cannot be approved.`,
            code: decision.reason,
          },
          409,
        );
      }
      // Conditional on status so two managers pressing approve cannot both win.
      const [updated] = await sql`
        UPDATE staff_payout_runs
        SET status = 'approved', approved_by = ${actor}, approved_at = now(),
            self_approved = ${decision.selfApproved}, updated_at = now()
        WHERE id = ${runId} AND venue_id = ${venue} AND status = 'pending_approval'
        RETURNING *`;
      if (!updated) return json({ error: "That run was already decided." }, 409);
      const result = await submitRun(env, venue, runId, String(run.kind));
      const [after] = await sql`SELECT * FROM staff_payout_runs WHERE id = ${runId}`;
      return json({ run: runView(after ?? updated), ...result });
    }

    if (action === "reject" && request.method === "POST") {
      const body = (await request.json().catch(() => ({}))) as { reason?: string };
      const reason = String(body.reason ?? "").trim();
      if (reason.length < 3) {
        return json({ error: "A reason is required to reject a payout run." }, 400);
      }
      if (!canTransition(String(run.status), "rejected")) {
        return json({ error: `A run in '${String(run.status)}' cannot be rejected.` }, 409);
      }
      const [updated] = await sql`
        UPDATE staff_payout_runs
        SET status = 'rejected', rejected_by = ${actor}, rejected_at = now(),
            rejection_reason = ${reason}, updated_at = now()
        WHERE id = ${runId} AND venue_id = ${venue} AND status = 'pending_approval'
        RETURNING *`;
      if (!updated) return json({ error: "That run was already decided." }, 409);
      // The money is not lost — the lines go back to held so a corrected run can
      // pick them up rather than them being silently written off.
      if (String(run.kind) === "salary") {
        await sql`UPDATE salary_payouts SET status = 'held', held_reason = 'run_rejected'
                  WHERE venue_id = ${venue} AND run_id = ${runId} AND status = 'pending'`;
      } else {
        await sql`UPDATE tip_payouts SET status = 'held', held_reason = 'run_rejected'
                  WHERE venue_id = ${venue} AND run_id = ${runId} AND status = 'pending'`;
      }
      return json({ run: runView(updated) });
    }
    return json({ error: "method not allowed" }, 405);
  }

  // ---- Payroll -----------------------------------------------------------
  if (url.pathname === "/api/payroll/staff" && request.method === "GET") {
    const rows = await sql`
      SELECT s.id, s.name, s.role, s.active, s.salary_amount, s.salary_period,
             s.salary_updated_at, s.salary_updated_by,
             (d.staff_id IS NOT NULL) AS has_destination, d.method AS destination_method
      FROM staff s
      LEFT JOIN staff_payout_details d ON d.venue_id = s.venue_id AND d.staff_id = s.id
      WHERE s.venue_id = ${venue}
      ORDER BY s.active DESC, s.name`;
    return json({
      staff: rows.map((row) => ({
        staffId: String(row.id),
        name: String(row.name),
        role: String(row.role),
        active: Boolean(row.active),
        salaryAmount: row.salary_amount === null ? null : Number(row.salary_amount),
        salaryPeriod: row.salary_period ? String(row.salary_period) : null,
        salaryUpdatedAt: row.salary_updated_at
          ? new Date(String(row.salary_updated_at)).toISOString()
          : null,
        salaryUpdatedBy: row.salary_updated_by ? String(row.salary_updated_by) : null,
        // A salary with nowhere to send it will be held, so surface it early.
        hasDestination: Boolean(row.has_destination),
        destinationMethod: row.destination_method ? String(row.destination_method) : null,
      })),
    });
  }

  const salaryMatch = url.pathname.match(/^\/api\/payroll\/staff\/([0-9a-fA-F-]{36})\/salary$/);
  if (salaryMatch && request.method === "PUT") {
    const staffId = salaryMatch[1];
    if (!validUuid(staffId)) return json({ error: "not found" }, 404);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const known = new Set(["amountMinor", "period"]);
    if (Object.keys(body).some((key) => !known.has(key))) {
      return json({ error: "unknown field" }, 400);
    }
    // Clearing a salary is legitimate — someone moves to tips-only.
    if (body.amountMinor === null) {
      const [cleared] = await sql`
        UPDATE staff SET salary_amount = NULL, salary_period = NULL,
               salary_updated_at = now(), salary_updated_by = ${actor}
        WHERE id = ${staffId} AND venue_id = ${venue} RETURNING id`;
      if (!cleared) return json({ error: "not found" }, 404);
      return json({ ok: true, salaryAmount: null, salaryPeriod: null });
    }
    const validated = validateSalary({ amountMinor: body.amountMinor, period: body.period });
    if (!validated.ok) return json({ error: validated.error }, 400);
    const [updated] = await sql`
      UPDATE staff SET salary_amount = ${validated.amount}, salary_period = ${validated.period},
             salary_updated_at = now(), salary_updated_by = ${actor}
      WHERE id = ${staffId} AND venue_id = ${venue}
      RETURNING id, salary_amount, salary_period`;
    if (!updated) return json({ error: "not found" }, 404);
    return json({
      ok: true,
      salaryAmount: Number(updated.salary_amount),
      salaryPeriod: String(updated.salary_period),
    });
  }

  const loadSalaryStaff = async (): Promise<SalaryStaff[]> => {
    const rows = await sql`
      SELECT id, name, active, salary_amount, salary_period
      FROM staff WHERE venue_id = ${venue}`;
    return rows.map((row): SalaryStaff => ({
      staffId: String(row.id),
      name: String(row.name),
      active: Boolean(row.active),
      salaryAmount: row.salary_amount === null ? null : Number(row.salary_amount),
      salaryPeriod: (row.salary_period ? String(row.salary_period) : null) as
        | "weekly"
        | "biweekly"
        | "monthly"
        | null,
    }));
  };

  if (url.pathname === "/api/payroll/preview" && request.method === "GET") {
    const period = url.searchParams.get("period") ?? "monthly";
    if (!["weekly", "biweekly", "monthly"].includes(period)) {
      return json({ error: "Unsupported pay period." }, 400);
    }
    const plan = planSalaryRun(
      await loadSalaryStaff(),
      period as "weekly" | "biweekly" | "monthly",
    );
    return json({ period, ...plan, periodLabel: salaryPeriodLabel(new Date()) });
  }

  if (url.pathname === "/api/payroll/runs" && request.method === "POST") {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const known = new Set(["period", "periodLabel", "note"]);
    if (Object.keys(body).some((key) => !known.has(key))) {
      return json({ error: "unknown field" }, 400);
    }
    const period = String(body.period ?? "monthly");
    if (!["weekly", "biweekly", "monthly"].includes(period)) {
      return json({ error: "Unsupported pay period." }, 400);
    }
    const periodLabel = String(body.periodLabel ?? salaryPeriodLabel(new Date()));
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodLabel)) {
      return json({ error: "Period label must look like 2026-08." }, 400);
    }
    const plan = planSalaryRun(
      await loadSalaryStaff(),
      period as "weekly" | "biweekly" | "monthly",
    );
    if (plan.lines.length === 0) {
      return json(
        { error: "Nobody has a salary set for that pay period.", excluded: plan.excluded },
        409,
      );
    }

    const created = await sql.begin(async (tx) => {
      const [run] = await tx`
        INSERT INTO staff_payout_runs
          (venue_id, kind, period_label, status, total_amount, staff_count, note, created_by)
        VALUES (${venue}, 'salary', ${periodLabel}, 'pending_approval',
                ${plan.total}, ${plan.lines.length},
                ${body.note ? String(body.note) : null}, ${actor})
        ON CONFLICT DO NOTHING
        RETURNING *`;
      if (!run) return null;
      for (const line of plan.lines) {
        await tx`
          INSERT INTO salary_payouts
            (venue_id, run_id, staff_id, amount, status, idempotency_key)
          VALUES (${venue}, ${run.id}, ${line.staffId}, ${line.amount}, 'pending',
                  ${`salary:${periodLabel}:${line.staffId}`})
          ON CONFLICT (venue_id, idempotency_key) DO NOTHING`;
      }
      return run;
    });
    if (!created) {
      return json({ error: `A payroll run for ${periodLabel} is already open.` }, 409);
    }
    return json({ run: runView(created), excluded: plan.excluded }, 201);
  }

  return json({ error: "not found" }, 404);
}
