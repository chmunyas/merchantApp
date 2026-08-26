// A5.2 / A5.3 / A5.4 / A5.6 — guest self-service.
//
// Sunday's help centre, "On the customer side" (collection 8398280), gives the
// guest four doors. This module is three of them plus the merchant's side of the
// resulting work queue.
//
//   A5.2 "I forgot to download my receipt" (article 7669632). Sunday identifies
//        the guest by the DETAILS OF THE PAYMENT — restaurant, date, total, last
//        4, email — and a human sends the receipt. That is a PII disclosure, so
//        the automated version below is verified, not merely asked politely:
//        the guest proves control of the contact on the payment with a one-time
//        code, and only then is a portal link minted.
//
//   A5.3 "How to log into my sunday account" (article 9013955). Sunday's login
//        lands the guest on their points and their previous receipts. Verifying
//        A5.2 issues exactly that — an existing `portal_tokens` bearer for
//        /me/:token — rather than inventing a second session type.
//
//   A5.4 "I paid with sunday and I need a refund" (article 7669635). Handled on
//        the guest side in portal.ts; this module is the merchant's queue. Note
//        what is NOT here: no refund is executed, approved-into-money or
//        reserved. `POST /api/refunds` remains the only path that moves money
//        and it remains manager-gated and untouched.
//
//   A5.6 "I would like to delete or modify my sunday account" (article 7669638).
//        Recorded, timestamped, audited, and — when a venue OWNER completes an
//        erasure — executed as a REDACTION. Ledger rows are never deleted.
//
// ── Anti-enumeration, stated once ────────────────────────────────────────────
// `POST /api/guest/receipt-lookup` is an unauthenticated surface that takes a
// phone number or an email address. It must not become an oracle for "does this
// person eat here". So:
//
//   * The OTP challenge row is created for EVERY well-formed request, matched or
//     not, so a `challengeId` always comes back and the verify step behaves
//     identically either way.
//   * The message is DISPATCHED only when the contact actually appears on a
//     payment at that venue — which also stops the endpoint being used as an
//     SMS cannon at arbitrary numbers.
//   * Dispatch failures are swallowed. A 503 that only ever fires for real
//     guests would re-introduce the oracle through the back door.
//   * The response body is byte-identical in both cases apart from the random
//     `challengeId`.

import { getOtpPepper, requireHumanAuth } from "@/api/auth";
import { getSql } from "@/lib/db";
import {
  ERASABLE_CATEGORIES,
  RETAINED_CATEGORIES,
  containsIdentifier,
  isDataRequestStatus,
  redactContactFields,
  redactPaymentMetadata,
} from "@/lib/guest-privacy";
import {
  generateOtpCode,
  hashOtp,
  normalizeDestination,
  timingSafeEqualHex,
} from "@/lib/otp";
import { hasVerifiedChannelAccount, queueOutbound } from "@/lib/outbound-jobs";
import {
  issuePortalToken,
  receiptLookupOtpPurpose,
} from "@/lib/portal-token";
import { rateLimit } from "@/lib/rate-limit";
import { roleAtLeast } from "@/lib/rbac";
import { otpDebugAllowed } from "@/lib/runtime-security";
import { venueFromPayload } from "@/lib/tenancy";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      ...corsHeaders,
    },
  });
}

const SETTLED = ["succeeded", "paid", "captured"];
const OTP_TTL_SECONDS = 600;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const REFUND_REQUEST_STATUSES = new Set([
  "acknowledged",
  "approved",
  "refunded",
  "declined",
]);

type LookupChannel = "sms" | "whatsapp" | "email";

function lookupChannel(value: unknown): LookupChannel | null {
  if (value === "sms" || value === "whatsapp" || value === "email") return value;
  return null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Masks the guest's own input back to them — never a value we looked up. */
function maskDestination(channel: LookupChannel, destination: string): string {
  if (channel === "email") {
    const [user, domain] = destination.split("@");
    const head = user.slice(0, 1);
    return `${head}${"•".repeat(Math.max(3, user.length - 1))}@${domain}`;
  }
  return `${destination.slice(0, 4)}••••${destination.slice(-2)}`;
}

type Sql = NonNullable<ReturnType<typeof getSql>>;

/**
 * Resolves the contact the guest typed to the phone number the payment ledger
 * actually indexes. Returns null when there is no settled payment for them at
 * this venue — the caller must treat that as "do not send", never as an error
 * the guest can observe.
 *
 * Email is supported as an IDENTITY (via the venue's contact record) but the
 * ledger is keyed on phone, so an email-only contact with no phone cannot be
 * resolved to receipts and is treated as no match.
 */
async function resolveSubjectPhone(
  sql: Sql,
  venue: string,
  channel: LookupChannel,
  destination: string,
): Promise<string | null> {
  let phone: string | null = null;
  if (channel === "email") {
    const [contact] = (await sql`
      SELECT phone FROM contacts
      WHERE venue_id = ${venue}
        AND lower(email) = ${destination}
        AND redacted_at IS NULL
        AND phone IS NOT NULL
      ORDER BY created_at DESC
      LIMIT 1
    `) as unknown as Array<{ phone: string }>;
    phone = contact?.phone ? String(contact.phone) : null;
  } else {
    phone = destination;
  }
  if (!phone) return null;
  const [payment] = await sql`
    SELECT 1 FROM payments
    WHERE venue_id = ${venue}
      AND metadata->>'customer_phone' = ${phone}
      AND kind <> 'refund'
      AND status = ANY(${SETTLED})
    LIMIT 1`;
  return payment ? phone : null;
}

export async function handleGuestRoute(
  request: Request,
  env: unknown,
): Promise<Response | null> {
  const url = new URL(request.url);
  const isGuest = url.pathname.startsWith("/api/guest/");
  const isRefundRequests = url.pathname.startsWith("/api/refund-requests");
  const isDataRequests = url.pathname.startsWith("/api/data-requests");
  if (!isGuest && !isRefundRequests && !isDataRequests) return null;
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const sql = getSql(env);
  if (!sql) return json({ error: "database not configured" }, 503);

  // ── A5.2 public surfaces ───────────────────────────────────────────────────

  // Resolve one venue by the short code printed on the QR / receipt. A single
  // lookup, never a directory: the guest already holds the code.
  if (url.pathname === "/api/guest/venue" && request.method === "GET") {
    const code = String(url.searchParams.get("code") ?? "").trim();
    if (!code) return json({ error: "code required" }, 400);
    const [venue] = (await sql`
      SELECT id, name FROM venues
      WHERE active = true AND lower(code) = ${code.toLowerCase()}
      LIMIT 1`) as unknown as Array<{ id: string; name: string }>;
    if (!venue) return json({ error: "not found" }, 404);
    return json({ venue: { id: String(venue.id), name: String(venue.name) } });
  }

  if (url.pathname === "/api/guest/receipt-lookup" && request.method === "POST") {
    const body = (await request.json().catch(() => ({}))) as {
      venue?: string;
      channel?: string;
      contact?: string;
    };
    const venue = String(body.venue ?? "").trim();
    const channel = lookupChannel(body.channel);
    if (!venue || !channel) {
      return json({ error: "venue and channel are required" }, 400);
    }
    const destination = normalizeDestination(
      channel === "email" ? "email" : "sms",
      String(body.contact ?? ""),
    );
    const wellFormed =
      channel === "email"
        ? EMAIL.test(destination)
        : /^\+[1-9]\d{8,14}$/.test(destination);
    if (!wellFormed) {
      return json({ error: "enter a valid phone number or email" }, 400);
    }

    // Per-destination limiter on top of the central per-IP rule, and it fails
    // CLOSED: if we cannot count attempts we do not hand out codes.
    const destinationLimit = await rateLimit(
      env,
      `receipt-lookup:${await hashKey(`${venue}\0${destination}`)}`,
      3,
      3600,
    );
    if (destinationLimit.unavailable) {
      return json({ error: "verification unavailable" }, 503);
    }
    if (destinationLimit.limited) {
      return json({ error: "Too many codes requested. Try again later." }, 429);
    }

    const pepper = await getOtpPepper(env);
    if (!pepper) return json({ error: "verification unavailable" }, 503);

    const purpose = await receiptLookupOtpPurpose(venue, destination);
    await sql`
      UPDATE auth_otps SET consumed_at = now()
      WHERE purpose = ${purpose} AND channel = ${channel}
        AND destination = ${destination} AND consumed_at IS NULL`;
    const code = generateOtpCode();
    const codeHash = await hashOtp(code, destination, pepper);
    const challengeId = `otp_${crypto.randomUUID().replace(/-/g, "")}`;
    await sql`
      INSERT INTO auth_otps
        (id, channel, destination, code_hash, purpose, expires_at)
      VALUES
        (${challengeId}, ${channel}, ${destination}, ${codeHash}, ${purpose},
         now() + interval '10 minutes')`;

    // Dispatch only on a real match, and never let the outcome of dispatch
    // change the response.
    try {
      const matched = await resolveSubjectPhone(sql, venue, channel, destination);
      if (matched && (await hasVerifiedChannelAccount(env, venue, channel))) {
        await queueOutbound(env, {
          deliveryKey: `receipt-lookup:${challengeId}`,
          venue,
          sourceType: "receipt_lookup",
          sourceId: challengeId,
          channel,
          handle: destination,
          purpose: "authentication",
          body:
            `Your receipt code is ${code}. It expires in 10 minutes. ` +
            `If you did not request it, ignore this message.`,
        });
      }
    } catch {
      // Intentionally silent — see the anti-enumeration note at the top.
    }

    return json(
      {
        sent: true,
        challengeId,
        channel,
        maskedDestination: maskDestination(channel, destination),
        expiresIn: OTP_TTL_SECONDS,
        // Development-only affordance, returned unconditionally so the response
        // shape cannot differ between a matched and an unmatched contact.
        ...(otpDebugAllowed(env) ? { devCode: code } : {}),
      },
      202,
    );
  }

  if (
    url.pathname === "/api/guest/receipt-lookup/verify" &&
    request.method === "POST"
  ) {
    const body = (await request.json().catch(() => ({}))) as {
      challengeId?: string;
      venue?: string;
      channel?: string;
      contact?: string;
      code?: string;
    };
    const challengeId = String(body.challengeId ?? "").trim();
    const venue = String(body.venue ?? "").trim();
    const channel = lookupChannel(body.channel);
    const code = String(body.code ?? "").trim();
    if (!challengeId || !venue || !channel || !/^\d{6}$/.test(code)) {
      return json({ error: "invalid verification" }, 400);
    }
    const destination = normalizeDestination(
      channel === "email" ? "email" : "sms",
      String(body.contact ?? ""),
    );
    if (!destination) return json({ error: "invalid verification" }, 400);

    const attemptLimit = await rateLimit(
      env,
      `receipt-verify:${challengeId}`,
      6,
      900,
    );
    if (attemptLimit.unavailable) {
      return json({ error: "verification unavailable" }, 503);
    }
    if (attemptLimit.limited) {
      return json({ error: "too many attempts" }, 429);
    }

    const pepper = await getOtpPepper(env);
    if (!pepper) return json({ error: "verification unavailable" }, 503);
    const purpose = await receiptLookupOtpPurpose(venue, destination);

    const verified = await sql.begin(async (tx) => {
      const [otp] = await tx`
        SELECT id, code_hash, attempts FROM auth_otps
        WHERE id = ${challengeId}
          AND channel = ${channel}
          AND destination = ${destination}
          AND purpose = ${purpose}
          AND consumed_at IS NULL
          AND expires_at > now()
        FOR UPDATE`;
      if (!otp || Number(otp.attempts) >= 5) return false;
      const expected = await hashOtp(code, destination, pepper);
      if (!timingSafeEqualHex(expected, String(otp.code_hash))) {
        await tx`
          UPDATE auth_otps
          SET attempts = attempts + 1,
              consumed_at = CASE
                WHEN attempts + 1 >= 5 THEN now() ELSE consumed_at END
          WHERE id = ${otp.id}`;
        return false;
      }
      await tx`UPDATE auth_otps SET consumed_at = now() WHERE id = ${otp.id}`;
      return true;
    });
    if (!verified) return json({ error: "invalid verification" }, 401);

    // The guest has now proved control of the contact, so telling them we hold
    // nothing for them is a disclosure to themselves, not to an attacker.
    const phone = await resolveSubjectPhone(sql, venue, channel, destination);
    if (!phone) {
      return json({
        url: null,
        message:
          "We could not find a payment at this venue for those details. " +
          "Ask the venue's team — they can resend your receipt.",
      });
    }
    const issued = await sql.begin((tx) => issuePortalToken(tx, venue, phone));
    return json(
      { url: `/me/${issued.token}`, expiresAt: issued.expiresAt.toISOString() },
      201,
    );
  }

  // ── Merchant-side queues (human-only, manager+) ────────────────────────────

  const payload = await requireHumanAuth(request, env);
  if (!payload) return json({ error: "unauthorized" }, 401);
  if (!roleAtLeast(payload, "manager")) return json({ error: "forbidden" }, 403);
  const venue = venueFromPayload(payload, url);
  const actor = {
    id: payload.staff_id ?? payload.sub ?? null,
    name: payload.name ?? null,
    role: payload.role ?? null,
  };

  // A5.4 — the queue. Reading it is a financial + PII read, hence manager+.
  if (url.pathname === "/api/refund-requests" && request.method === "GET") {
    const rows = await sql`
      SELECT id, payment_id, order_id, requester_phone, amount_minor, currency,
             reason, detail, status, decided_by_name, decision_note, decided_at,
             refund_payment_id, created_at, updated_at
      FROM guest_refund_requests
      WHERE venue_id = ${venue}
      ORDER BY created_at DESC
      LIMIT 200`;
    return json({
      requests: rows.map((row) => ({
        id: String(row.id),
        paymentId: String(row.payment_id),
        orderId: row.order_id ? String(row.order_id) : null,
        requesterPhone: row.requester_phone ? String(row.requester_phone) : null,
        amountMinor: Number(row.amount_minor ?? 0),
        currency: String(row.currency ?? "KES"),
        reason: String(row.reason ?? ""),
        detail: row.detail ? String(row.detail) : null,
        status: String(row.status),
        decidedByName: row.decided_by_name ? String(row.decided_by_name) : null,
        decisionNote: row.decision_note ? String(row.decision_note) : null,
        decidedAt: row.decided_at ? String(row.decided_at) : null,
        refundPaymentId: row.refund_payment_id
          ? String(row.refund_payment_id)
          : null,
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
      })),
    });
  }

  const refundMatch = url.pathname.match(/^\/api\/refund-requests\/([^/]+)$/);
  if (refundMatch && request.method === "PATCH") {
    if (!UUID.test(refundMatch[1])) return json({ error: "not found" }, 404);
    const body = (await request.json().catch(() => ({}))) as {
      status?: string;
      note?: string;
      refundPaymentId?: string;
    };
    const status = String(body.status ?? "");
    if (!REFUND_REQUEST_STATUSES.has(status)) {
      return json({ error: "unsupported status" }, 400);
    }
    const note = String(body.note ?? "").trim().slice(0, 1000) || null;

    // `refunded` is a claim about money that has already moved. It is only
    // accepted against a refund payment that exists, belongs to this venue and
    // points at the same parent payment — so the queue can never assert a refund
    // the ledger does not have.
    let refundPaymentId: string | null = null;
    if (status === "refunded") {
      const candidate = String(body.refundPaymentId ?? "").trim();
      if (!candidate) {
        return json(
          { error: "refundPaymentId is required to mark this refunded" },
          400,
        );
      }
      const [refund] = await sql`
        SELECT r.id FROM payments r
        JOIN guest_refund_requests g
          ON g.id = ${refundMatch[1]} AND g.venue_id = ${venue}
        WHERE r.id = ${candidate}
          AND r.venue_id = ${venue}
          AND r.kind = 'refund'
          AND r.metadata->>'parent_payment_id' = g.payment_id
        LIMIT 1`;
      if (!refund) {
        return json({ error: "no matching refund on this payment" }, 400);
      }
      refundPaymentId = candidate;
    }

    const [updated] = await sql`
      UPDATE guest_refund_requests
      SET status = ${status},
          decision_note = COALESCE(${note}, decision_note),
          decided_by = ${actor.id},
          decided_by_name = ${actor.name},
          decided_at = now(),
          refund_payment_id = COALESCE(${refundPaymentId}, refund_payment_id),
          updated_at = now()
      WHERE id = ${refundMatch[1]} AND venue_id = ${venue}
      RETURNING id, status, refund_payment_id, decided_at`;
    if (!updated) return json({ error: "not found" }, 404);
    return json({
      id: String(updated.id),
      status: String(updated.status),
      refundPaymentId: updated.refund_payment_id
        ? String(updated.refund_payment_id)
        : null,
      decidedAt: updated.decided_at ? String(updated.decided_at) : null,
      // Approving is a decision, not a disbursement. Say so to the caller.
      requiresManualRefund: String(updated.status) === "approved",
    });
  }

  // A5.6 — data-subject queue.
  if (url.pathname === "/api/data-requests" && request.method === "GET") {
    const rows = await sql`
      SELECT id, kind, subject_phone, subject_email, contact_id,
             requested_changes, note, status, handled_by_name, resolution_note,
             acknowledged_at, completed_at, created_at, updated_at
      FROM guest_data_requests
      WHERE venue_id = ${venue}
      ORDER BY created_at DESC
      LIMIT 200`;
    return json({
      erasable: ERASABLE_CATEGORIES,
      retained: RETAINED_CATEGORIES,
      requests: rows.map((row) => ({
        id: String(row.id),
        kind: String(row.kind),
        subjectPhone: row.subject_phone ? String(row.subject_phone) : null,
        subjectEmail: row.subject_email ? String(row.subject_email) : null,
        contactId: row.contact_id ? String(row.contact_id) : null,
        requestedChanges: (row.requested_changes ?? {}) as Record<string, unknown>,
        note: row.note ? String(row.note) : null,
        status: String(row.status),
        handledByName: row.handled_by_name ? String(row.handled_by_name) : null,
        resolutionNote: row.resolution_note ? String(row.resolution_note) : null,
        acknowledgedAt: row.acknowledged_at ? String(row.acknowledged_at) : null,
        completedAt: row.completed_at ? String(row.completed_at) : null,
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
      })),
    });
  }

  const dataMatch = url.pathname.match(/^\/api\/data-requests\/([^/]+)$/);
  if (dataMatch && request.method === "PATCH") {
    if (!UUID.test(dataMatch[1])) return json({ error: "not found" }, 404);
    const body = (await request.json().catch(() => ({}))) as {
      status?: string;
      note?: string;
    };
    if (!isDataRequestStatus(body.status) || body.status === "received") {
      return json({ error: "unsupported status" }, 400);
    }
    const status = body.status;
    const note = String(body.note ?? "").trim().slice(0, 1000) || null;

    const [existing] = (await sql`
      SELECT id, kind, status, subject_phone, contact_id
      FROM guest_data_requests
      WHERE id = ${dataMatch[1]} AND venue_id = ${venue}
      LIMIT 1`) as unknown as Array<{
      id: string;
      kind: string;
      status: string;
      subject_phone: string | null;
      contact_id: string | null;
    }>;
    if (!existing) return json({ error: "not found" }, 404);
    if (existing.status === "completed") {
      return json({ error: "already completed" }, 409);
    }

    // Executing an erasure destroys a customer relationship and is irreversible.
    // Triage is manager+; pulling the trigger is the venue owner.
    const erasing = status === "completed" && existing.kind === "erasure";
    if (erasing && !roleAtLeast(payload, "merchant")) {
      return json(
        { error: "only the account owner can complete an erasure" },
        403,
      );
    }

    const redacted = erasing
      ? await redactSubject(sql, venue, existing.subject_phone, existing.contact_id)
      : null;

    const [updated] = await sql`
      UPDATE guest_data_requests
      SET status = ${status},
          resolution_note = COALESCE(${note}, resolution_note),
          handled_by = ${actor.id},
          handled_by_name = ${actor.name},
          acknowledged_at = COALESCE(acknowledged_at, now()),
          completed_at = ${status === "completed" ? new Date() : null},
          updated_at = now()
      WHERE id = ${existing.id} AND venue_id = ${venue}
      RETURNING id, status, completed_at`;

    await sql`
      INSERT INTO guest_data_request_events
        (venue_id, request_id, action, actor_id, actor_name, actor_role, detail)
      VALUES
        (${venue}, ${existing.id}, ${status}, ${actor.id}, ${actor.name},
         ${actor.role}, ${JSON.stringify({
           kind: existing.kind,
           redacted: redacted ?? undefined,
         })}::jsonb)`;

    return json({
      id: String(updated.id),
      status: String(updated.status),
      completedAt: updated.completed_at ? String(updated.completed_at) : null,
      redacted,
    });
  }

  return null;
}

/**
 * A5.6 execution. Redacts the guest's identifiers from the contact record and
 * from payment metadata, and marks the contact redacted. Financial rows are
 * updated in place, never deleted: amounts, statuses, provider references and
 * the ledger are all left exactly as they were, so the trial balance is
 * unchanged by a privacy request.
 */
async function redactSubject(
  sql: Sql,
  venue: string,
  phone: string | null,
  contactId: string | null,
): Promise<{ contacts: number; payments: number }> {
  if (!phone && !contactId) return { contacts: 0, payments: 0 };
  const redactedAt = new Date().toISOString();
  const fields = redactContactFields({});

  return await sql.begin(async (tx) => {
    const contactRows = contactId
      ? await tx`
          UPDATE contacts
          SET name = ${fields.name}, phone = ${fields.phone},
              email = ${fields.email}, notes = ${fields.notes},
              tags = ${fields.tags as string[]}, redacted_at = now()
          WHERE id = ${contactId} AND venue_id = ${venue}
          RETURNING id`
      : await tx`
          UPDATE contacts
          SET name = ${fields.name}, phone = ${fields.phone},
              email = ${fields.email}, notes = ${fields.notes},
              tags = ${fields.tags as string[]}, redacted_at = now()
          WHERE venue_id = ${venue} AND phone = ${phone}
          RETURNING id`;

    let payments = 0;
    if (phone) {
      const rows = (await tx`
        SELECT id, metadata FROM payments
        WHERE venue_id = ${venue} AND metadata->>'customer_phone' = ${phone}
        FOR UPDATE`) as unknown as Array<{
        id: string;
        metadata: Record<string, unknown> | null;
      }>;
      for (const row of rows) {
        const next = redactPaymentMetadata(row.metadata, redactedAt);
        // Belt and braces: never write back something still carrying the phone.
        if (containsIdentifier(next, phone)) continue;
        await tx`
          UPDATE payments SET metadata = ${JSON.stringify(next)}::jsonb,
                              updated_at = now()
          WHERE id = ${row.id} AND venue_id = ${venue}`;
        payments += 1;
      }
    }
    return { contacts: contactRows.length, payments };
  });
}

const encoder = new TextEncoder();

async function hashKey(value: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", encoder.encode(value)),
  );
  return Array.from(digest)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
