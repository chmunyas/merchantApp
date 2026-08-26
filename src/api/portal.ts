import { getOtpPepper, requireAuth } from "@/api/auth";
import { getSql } from "@/lib/db";
import { venueFromPayload } from "@/lib/tenancy";
import { roleAtLeast } from "@/lib/rbac";
import { tokenHasScope } from "@/lib/api-tokens";
import { tierProgress, tierBenefits, pointsExpiry } from "@/lib/loyalty";
import { hasVerifiedChannelAccount, queueOutbound } from "@/lib/outbound-jobs";
import {
  generateOtpCode,
  hashOtp,
  normalizeDestination,
  timingSafeEqualHex,
} from "@/lib/otp";
import {
  hashPortalToken,
  issuePortalToken,
  portalOtpPurpose,
} from "@/lib/portal-token";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { verifyTurnstile } from "@/lib/turnstile";
import { otpDebugAllowed } from "@/lib/runtime-security";
import {
  ERASABLE_CATEGORIES,
  RETAINED_CATEGORIES,
  isDataRequestKind,
} from "@/lib/guest-privacy";
import {
  toCustomerPaymentView,
  type CustomerPaymentSourceRow,
} from "@/lib/customer-payment-view";

// Guest-initiated request actions. Tightly rate limited per token: a guest has
// one refund complaint and one privacy request, not thirty.
const GUEST_REQUEST_ACTIONS = new Set(["refund-request", "data-request"]);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
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

type TokenRow = { venue_id: string; phone: string };
type RewardRow = {
  id: string;
  venue_id: string;
  name: string;
  description: string | null;
  points_cost: number;
  active: boolean;
  created_at: string;
};
type ContactRow = {
  id: string;
  name: string | null;
  points: number | string | null;
  tier: string | null;
  last_visit: string | null;
};
type BrandingRow = {
  business_name: string | null;
  logo_url: string | null;
  primary_color: string | null;
  venue_name: string | null;
  org_name: string | null;
  org_branding: Record<string, unknown> | null;
};

function redemptionCode(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase();
}

async function resolveToken(sql: ReturnType<typeof getSql>, token: string) {
  if (!sql || !/^[a-f0-9]{64}$/i.test(token)) return null;
  const tokenHash = await hashPortalToken(token);
  const [row] = (await sql`
    SELECT venue_id, phone FROM portal_tokens
    WHERE token_hash = ${tokenHash}
      AND verified_at IS NOT NULL
      AND revoked_at IS NULL
      AND expires_at > now()
    LIMIT 1
  `) as unknown as TokenRow[];
  return row ?? null;
}

async function loadBranding(sql: NonNullable<ReturnType<typeof getSql>>, venue: string) {
  const [b] = (await sql`
    SELECT vb.business_name, vb.logo_url, vb.primary_color,
           v.name AS venue_name, o.name AS org_name, o.branding AS org_branding
    FROM venues v
    LEFT JOIN venue_branding vb ON vb.venue_id = v.id
    LEFT JOIN organizations o ON o.id = v.org_id
    WHERE v.id = ${venue}
    LIMIT 1
  `) as unknown as BrandingRow[];
  const org = (b?.org_branding ?? {}) as Record<string, unknown>;
  return {
    businessName: b?.business_name ?? b?.venue_name ?? "PesaSwap",
    logoUrl: b?.logo_url ?? null,
    primaryColor: b?.primary_color ?? null,
    reseller: b?.org_name
      ? {
          name: b.org_name,
          poweredBy: (org.poweredBy as string) ?? null,
          logoUrl: (org.logoUrl as string) ?? null,
        }
      : null,
  };
}

function rewardPayload(row: RewardRow) {
  return {
    id: row.id,
    venueId: row.venue_id,
    name: row.name,
    description: row.description,
    pointsCost: Number(row.points_cost),
    active: row.active,
    createdAt: row.created_at,
  };
}

export async function handlePortalRoute(
  request: Request,
  env: unknown,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (
    !url.pathname.startsWith("/api/portal") &&
    !url.pathname.startsWith("/api/rewards") &&
    !url.pathname.startsWith("/api/loyalty")
  ) {
    return null;
  }
  if (request.method === "OPTIONS") return json({ ok: true });

  const sql = getSql(env);
  if (!sql) return json({ error: "database not configured" }, 503);

  // Compatibility endpoint: phone knowledge is never proof of customer identity.
  // Return a uniform response without querying contacts.
  if (url.pathname === "/api/loyalty/status" && request.method === "GET") {
    return json({ enrolled: false, verificationRequired: true });
  }

  if (url.pathname === "/api/portal/token" && request.method === "POST") {
    const body = (await request.json().catch(() => ({}))) as {
      venue?: string;
      phone?: string;
      channel?: string;
      turnstileToken?: string;
    };
    const venue = String(body.venue ?? "").trim();
    const channel = body.channel === "whatsapp" ? "whatsapp" : "sms";
    const phone = normalizeDestination(channel, String(body.phone ?? ""));
    if (!venue || !/^\+[1-9]\d{8,14}$/.test(phone)) {
      return json({ error: "valid venue and phone required" }, 400);
    }
    if (!(await verifyTurnstile(env, body.turnstileToken, clientIp(request)))) {
      return json({ error: "Captcha verification failed." }, 403);
    }
    const [activeVenue] = await sql`
      SELECT id FROM venues WHERE id = ${venue} AND active = true LIMIT 1`;
    if (!activeVenue) return json({ error: "venue not found" }, 404);
    const destinationHash = await hashPortalToken(`${venue}\0${phone}`);
    const destinationLimit = await rateLimit(
      env,
      `portal-otp:${destinationHash}`,
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
    const purpose = await portalOtpPurpose(venue, phone);
    await sql`
      UPDATE auth_otps SET consumed_at = now()
      WHERE purpose = ${purpose} AND channel = ${channel}
        AND destination = ${phone} AND consumed_at IS NULL`;
    const code = generateOtpCode();
    const codeHash = await hashOtp(code, phone, pepper);
    const challengeId = `otp_${crypto.randomUUID().replace(/-/g, "")}`;
    await sql`
      INSERT INTO auth_otps
        (id, channel, destination, code_hash, purpose, expires_at)
      VALUES
        (${challengeId}, ${channel}, ${phone}, ${codeHash}, ${purpose},
         now() + interval '10 minutes')`;
    try {
      if (!(await hasVerifiedChannelAccount(env, venue, channel as "whatsapp" | "sms"))) {
        throw new Error("channel account unavailable");
      }
      await queueOutbound(env, {
        deliveryKey: `portal-otp:${challengeId}`,
        venue,
        sourceType: "portal_authentication",
        sourceId: challengeId,
        channel: channel as "whatsapp" | "sms",
        handle: phone,
        purpose: "authentication",
        body: `Your PesaSwap portal code is ${code}. It expires in 10 minutes.`,
      });
    } catch {
      await sql`UPDATE auth_otps SET consumed_at = now() WHERE id = ${challengeId}`;
      return json({ error: "Could not send verification code." }, 503);
    }
    const debug = otpDebugAllowed(env);
    return json(
      {
        sent: true,
        challengeId,
        channel,
        maskedDestination: `${phone.slice(0, 4)}••••${phone.slice(-2)}`,
        expiresIn: 600,
        ...(debug ? { devCode: code } : {}),
      },
      202,
    );
  }

  if (url.pathname === "/api/portal/token/verify" && request.method === "POST") {
    const body = (await request.json().catch(() => ({}))) as {
      challengeId?: string;
      venue?: string;
      phone?: string;
      channel?: string;
      code?: string;
    };
    const challengeId = String(body.challengeId ?? "").trim();
    const venue = String(body.venue ?? "").trim();
    const channel = body.channel === "whatsapp" ? "whatsapp" : "sms";
    const phone = normalizeDestination(channel, String(body.phone ?? ""));
    const code = String(body.code ?? "").trim();
    if (!challengeId || !venue || !/^\d{6}$/.test(code) || !phone) {
      return json({ error: "invalid verification" }, 400);
    }
    const pepper = await getOtpPepper(env);
    if (!pepper) return json({ error: "verification unavailable" }, 503);
    const purpose = await portalOtpPurpose(venue, phone);
    const issued = await sql.begin(async (tx) => {
      const [otp] = await tx`
        SELECT id, code_hash, attempts FROM auth_otps
        WHERE id = ${challengeId}
          AND channel = ${channel}
          AND destination = ${phone}
          AND purpose = ${purpose}
          AND consumed_at IS NULL
          AND expires_at > now()
        FOR UPDATE`;
      if (!otp || Number(otp.attempts) >= 5) return null;
      const expected = await hashOtp(code, phone, pepper);
      if (!timingSafeEqualHex(expected, String(otp.code_hash))) {
        await tx`
          UPDATE auth_otps
          SET attempts = attempts + 1,
              consumed_at = CASE
                WHEN attempts + 1 >= 5 THEN now()
                ELSE consumed_at
              END
          WHERE id = ${otp.id}`;
        return null;
      }
      await tx`UPDATE auth_otps SET consumed_at = now() WHERE id = ${otp.id}`;
      return issuePortalToken(tx, venue, phone);
    });
    if (!issued) return json({ error: "invalid verification" }, 401);
    return json(
      { url: `/me/${issued.token}`, expiresAt: issued.expiresAt.toISOString() },
      201,
    );
  }

  const portalMatch = url.pathname.match(
    /^\/api\/portal\/([^/]+)(?:\/(redeem|revoke|refund-request|data-request))?$/,
  );
  if (portalMatch) {
    const [, token, action] = portalMatch;
    const tokenRateHash = await hashPortalToken(token);
    const tokenLimit = await rateLimit(
      env,
      `portal-token:${action ?? "read"}:${tokenRateHash}`,
      GUEST_REQUEST_ACTIONS.has(action ?? "") || action === "redeem" ? 3 : 120,
      3600,
    );
    if (tokenLimit.unavailable) return json({ error: "portal unavailable" }, 503);
    if (tokenLimit.limited) return json({ error: "too many requests" }, 429);
    const resolved = await resolveToken(sql, token);
    if (!resolved) return json({ error: "not found" }, 404);
    if (action === "revoke" && request.method === "POST") {
      const tokenHash = await hashPortalToken(token);
      await sql`
        UPDATE portal_tokens SET revoked_at = now()
        WHERE token_hash = ${tokenHash} AND revoked_at IS NULL`;
      return json({ ok: true });
    }

    const { venue_id: venue, phone } = resolved;

    // A5.4 — the guest asks the VENUE for a refund. Sunday's answer to "I paid
    // with sunday and I need a refund" (article 7669635) is "reach out to the
    // restaurant directly … sunday is not able to process any refunds on behalf
    // of the restaurant without their explicit permission". So this endpoint
    // creates a request and nothing else: it does not touch `payments`, does not
    // reserve, authorise or move money, and cannot be escalated into a refund.
    // The refund itself still happens only via the manager-gated POST /api/refunds.
    if (action === "refund-request" && request.method === "POST") {
      const body = (await request.json().catch(() => ({}))) as {
        paymentId?: string;
        reason?: string;
        detail?: string;
      };
      const paymentId = String(body.paymentId ?? "").trim();
      const reason = String(body.reason ?? "").trim().slice(0, 200);
      const detail = String(body.detail ?? "").trim().slice(0, 1000) || null;
      if (!paymentId || !reason) {
        return json({ error: "paymentId and reason are required" }, 400);
      }
      // The payment must be this venue's AND this guest's. A portal token is
      // proof of one phone number, not a licence to name any payment id.
      const [payment] = (await sql`
        SELECT id, amount::bigint AS amount, currency, metadata
        FROM payments
        WHERE id = ${paymentId}
          AND venue_id = ${venue}
          AND kind <> 'refund'
          AND metadata->>'customer_phone' = ${phone}
        LIMIT 1
      `) as unknown as Array<{
        id: string;
        amount: number | string;
        currency: string;
        metadata: Record<string, unknown> | null;
      }>;
      if (!payment) return json({ error: "payment not found" }, 404);
      const orderId = payment.metadata?.order_id
        ? String(payment.metadata.order_id)
        : null;
      const [created] = (await sql`
        INSERT INTO guest_refund_requests
          (venue_id, payment_id, order_id, requester_phone, amount_minor,
           currency, reason, detail)
        VALUES
          (${venue}, ${payment.id}, ${orderId}, ${phone},
           ${Number(payment.amount) || 0}, ${String(payment.currency ?? "KES")},
           ${reason}, ${detail})
        ON CONFLICT DO NOTHING
        RETURNING id, status, created_at
      `) as unknown as Array<{ id: string; status: string; created_at: string }>;
      if (!created) {
        // The partial unique index already holds a live request for this
        // payment. Say so plainly rather than queueing a duplicate.
        return json({ duplicate: true, status: "received" }, 200);
      }
      return json(
        {
          id: created.id,
          status: created.status,
          createdAt: created.created_at,
          // Set the guest's expectation to match reality.
          message:
            "Your request has been sent to the venue. Only the venue can " +
            "approve a refund, and they will contact you on this number.",
        },
        201,
      );
    }

    // A5.6 — a data-subject request. Recorded with a timestamp and picked up by
    // a human; nothing is deleted here, and the guest is told exactly what
    // survives an erasure.
    if (action === "data-request" && request.method === "POST") {
      const body = (await request.json().catch(() => ({}))) as {
        kind?: string;
        note?: string;
        changes?: Record<string, unknown>;
      };
      if (!isDataRequestKind(body.kind)) {
        return json({ error: "kind must be erasure or rectification" }, 400);
      }
      const note = String(body.note ?? "").trim().slice(0, 1000) || null;
      const changes =
        body.changes && typeof body.changes === "object" && !Array.isArray(body.changes)
          ? Object.fromEntries(
              Object.entries(body.changes)
                .slice(0, 20)
                .map(([key, value]) => [
                  key.slice(0, 60),
                  String(value ?? "").slice(0, 300),
                ]),
            )
          : {};
      const [contact] = (await sql`
        SELECT id FROM contacts
        WHERE venue_id = ${venue} AND phone = ${phone}
        ORDER BY created_at DESC LIMIT 1
      `) as unknown as Array<{ id: string }>;
      const [created] = (await sql`
        INSERT INTO guest_data_requests
          (venue_id, kind, subject_phone, contact_id, requested_changes, note)
        VALUES
          (${venue}, ${body.kind}, ${phone}, ${contact?.id ?? null},
           ${JSON.stringify(changes)}::jsonb, ${note})
        ON CONFLICT DO NOTHING
        RETURNING id, kind, status, created_at
      `) as unknown as Array<{
        id: string;
        kind: string;
        status: string;
        created_at: string;
      }>;
      if (!created) {
        return json({ duplicate: true, status: "received" }, 200);
      }
      await sql`
        INSERT INTO guest_data_request_events
          (venue_id, request_id, action, actor_role, detail)
        VALUES
          (${venue}, ${created.id}, 'submitted', 'guest',
           ${JSON.stringify({ kind: created.kind })}::jsonb)`;
      return json(
        {
          id: created.id,
          kind: created.kind,
          status: created.status,
          createdAt: created.created_at,
          erasable: ERASABLE_CATEGORIES,
          retained: RETAINED_CATEGORIES,
        },
        201,
      );
    }

    if (!action && request.method === "GET") {
      const [contact] = (await sql`
        SELECT id, name, points, tier, last_visit
        FROM contacts
        WHERE venue_id = ${venue} AND phone = ${phone}
        ORDER BY created_at DESC
        LIMIT 1
      `) as unknown as ContactRow[];
      const invoices = await sql`
        SELECT id, number, customer_name, amount, currency, description, status,
           created_at, paid_at, pay_link, due_date,
           ROUND((amount - amount_paid) * 100)::bigint AS balance_minor
        FROM invoices
        WHERE venue_id = ${venue} AND phone = ${phone}
        ORDER BY created_at DESC
        LIMIT 10
      `;
      const paymentRows = (await sql`
        WITH refunds AS (
          SELECT metadata->>'refund_of' AS parent,
                 sum(amount)::bigint AS refunded
          FROM payments
          WHERE venue_id = ${venue}
            AND kind = 'refund'
            AND status = 'refunded'
            AND metadata->>'refund_of' IS NOT NULL
          GROUP BY metadata->>'refund_of'
        )
        SELECT p.id, p.amount, p.currency, p.status, p.kind, p.reference,
               p.provider_ref, p.tip_amount, p.metadata, p.created_at,
               COALESCE(r.refunded, 0)::bigint AS refunded_amount
        FROM payments p
        LEFT JOIN refunds r ON r.parent = p.id
        WHERE p.venue_id = ${venue}
          AND p.metadata->>'customer_phone' = ${phone}
        ORDER BY p.created_at DESC
        LIMIT 10
      `) as unknown as CustomerPaymentSourceRow[];
      const rewards = (await sql`
        SELECT id, venue_id, name, description, points_cost, active, created_at
        FROM loyalty_rewards
        WHERE venue_id = ${venue} AND active = true
        ORDER BY points_cost ASC, created_at DESC
      `) as unknown as RewardRow[];
      const redemptions = await sql`
        SELECT rr.id, rr.reward_id, lr.name AS reward_name, rr.points_spent,
               rr.code, rr.status, rr.created_at
        FROM reward_redemptions rr
        LEFT JOIN loyalty_rewards lr ON lr.id = rr.reward_id
        WHERE rr.venue_id = ${venue} AND rr.phone = ${phone}
        ORDER BY rr.created_at DESC
        LIMIT 10
      `;
      const points = Number(contact?.points ?? 0);
      return json({
        venue,
        branding: await loadBranding(sql, venue),
        contact: {
          name: contact?.name ?? "Guest",
          points,
          tier: contact?.tier ?? "Bronze",
        },
        progress: tierProgress(points),
        benefits: tierBenefits(points),
        expiry: pointsExpiry(contact?.last_visit ?? null, points),
        invoices,
        payments: paymentRows.map(toCustomerPaymentView),
        rewards: rewards.map(rewardPayload),
        redemptions,
      });
    }

    if (action === "redeem" && request.method === "POST") {
      const body = (await request.json().catch(() => ({}))) as { rewardId?: string };
      const rewardId = String(body.rewardId ?? "");
      const [reward] = (await sql`
        SELECT id, venue_id, name, description, points_cost, active, created_at
        FROM loyalty_rewards
        WHERE id = ${rewardId} AND venue_id = ${venue} AND active = true
        LIMIT 1
      `) as unknown as RewardRow[];
      if (!reward) return json({ error: "reward not found" }, 404);

      try {
        const result = await sql.begin(async (tx) => {
          const tokenHash = await hashPortalToken(token);
          const [activeToken] = await tx`
            SELECT token FROM portal_tokens
            WHERE token_hash = ${tokenHash}
              AND verified_at IS NOT NULL
              AND revoked_at IS NULL
              AND expires_at > now()
            FOR UPDATE`;
          if (!activeToken) return null;
          const [updated] = (await tx`
            UPDATE contacts
            SET points = points - ${Number(reward.points_cost)}
            WHERE id = (
              SELECT id FROM contacts
              WHERE venue_id = ${venue} AND phone = ${phone}
              ORDER BY created_at DESC
              LIMIT 1
            )
            AND points >= ${Number(reward.points_cost)}
            RETURNING id, points
          `) as unknown as Array<{ id: string; points: number | string }>;
          if (!updated) return null;
          const code = redemptionCode();
          await tx`
            INSERT INTO reward_redemptions
              (venue_id, phone, contact_id, reward_id, points_spent, code)
            VALUES
              (${venue}, ${phone}, ${updated.id}, ${reward.id},
               ${Number(reward.points_cost)}, ${code})
          `;
          return { code, remainingPoints: Number(updated.points) };
        });
        if (!result) return json({ error: "insufficient points" }, 400);
        return json(result, 201);
      } catch {
        return json({ error: "could not redeem reward" }, 500);
      }
    }
  }

  if (url.pathname.startsWith("/api/rewards")) {
    const payload = await requireAuth(request, env);
    if (!payload) return json({ error: "unauthorized" }, 401);
    const write = request.method !== "GET";
    if (
      !roleAtLeast(payload, "manager") ||
      !tokenHasScope(payload, write ? "loyalty:write" : "loyalty:read")
    ) {
      return json({ error: "forbidden" }, 403);
    }
    const venue = venueFromPayload(payload, url);

    if (url.pathname === "/api/rewards" && request.method === "GET") {
      const rewards = (await sql`
        SELECT id, venue_id, name, description, points_cost, active, created_at
        FROM loyalty_rewards
        WHERE venue_id = ${venue}
        ORDER BY active DESC, points_cost ASC, created_at DESC
      `) as unknown as RewardRow[];
      return json({ rewards: rewards.map(rewardPayload) });
    }

    if (url.pathname === "/api/rewards" && request.method === "POST") {
      const body = (await request.json().catch(() => ({}))) as {
        name?: string;
        description?: string;
        points_cost?: number;
        pointsCost?: number;
      };
      const name = String(body.name ?? "").trim();
      const pointsCost = Number(body.points_cost ?? body.pointsCost ?? 0);
      if (!name) return json({ error: "name required" }, 400);
      if (!Number.isInteger(pointsCost) || pointsCost <= 0) {
        return json({ error: "points_cost must be a positive integer" }, 400);
      }
      const [reward] = (await sql`
        INSERT INTO loyalty_rewards (venue_id, name, description, points_cost)
        VALUES (${venue}, ${name}, ${body.description ?? null}, ${pointsCost})
        RETURNING id, venue_id, name, description, points_cost, active, created_at
      `) as unknown as RewardRow[];
      return json({ reward: rewardPayload(reward) }, 201);
    }

    const rewardMatch = url.pathname.match(/^\/api\/rewards\/([^/]+)$/);
    if (rewardMatch && request.method === "PATCH") {
      const body = (await request.json().catch(() => ({}))) as {
        name?: string;
        description?: string | null;
        points_cost?: number;
        pointsCost?: number;
        active?: boolean;
      };
      const points =
        body.points_cost !== undefined || body.pointsCost !== undefined
          ? Number(body.points_cost ?? body.pointsCost)
          : null;
      if (points !== null && (!Number.isInteger(points) || points <= 0)) {
        return json({ error: "points_cost must be a positive integer" }, 400);
      }
      const [reward] = (await sql`
        UPDATE loyalty_rewards
        SET name = COALESCE(${body.name?.trim() || null}, name),
            description = COALESCE(${body.description ?? null}, description),
            points_cost = COALESCE(${points}, points_cost),
            active = COALESCE(${body.active ?? null}, active)
        WHERE id = ${rewardMatch[1]} AND venue_id = ${venue}
        RETURNING id, venue_id, name, description, points_cost, active, created_at
      `) as unknown as RewardRow[];
      if (!reward) return json({ error: "reward not found" }, 404);
      return json({ reward: rewardPayload(reward) });
    }

    if (rewardMatch && request.method === "DELETE") {
      await sql`
        DELETE FROM loyalty_rewards
        WHERE id = ${rewardMatch[1]} AND venue_id = ${venue}
      `;
      return json({ ok: true });
    }
  }

  return null;
}
