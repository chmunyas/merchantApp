import { handlePaymentRoute } from "@/api/payments";
import { createPaymentIntent } from "@/lib/payment-intents";
import { requireHumanAuth } from "@/api/auth";
import {
  BILLING_PLANS,
  downgradeToFree,
  findPlan,
  isPaidPlan,
  planPriceMinor,
} from "@/lib/billing";
import { getSql } from "@/lib/db";
import { envVar } from "@/lib/env";
import { roleAtLeast } from "@/lib/rbac";
import { PLAN_LIMITS, planOf, venueFromPayload } from "@/lib/tenancy";

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

// Kenya phone → E.164 (+254…) for the M-Pesa STK push.
function normalizePhone(raw: string): string {
  const digits = String(raw ?? "").replace(/[^\d+]/g, "");
  if (!digits) return "";
  if (digits.startsWith("+")) return digits;
  if (digits.startsWith("0")) return `+254${digits.slice(1)}`;
  if (digits.startsWith("254")) return `+${digits}`;
  if (digits.length === 9) return `+254${digits}`;
  return `+${digits}`;
}

function serializeSubscription(row: Record<string, unknown> | undefined) {
  if (!row) return null;
  return {
    plan: String(row.plan ?? "free"),
    status: String(row.status ?? "active"),
    currentPeriodEnd: row.current_period_end ?? null,
    amount: Number(row.amount ?? 0),
    lastPaymentId: row.last_payment_id ?? null,
  };
}

export async function handleBillingRoute(
  request: Request,
  env: unknown,
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith("/api/billing")) return null;
  if (request.method === "OPTIONS") return json({ ok: true });

  // --- Dunning / renewal sweep (cron). Gated by a shared CRON_SECRET so it can
  // run headless. Moves lapsed subscriptions active → past_due, then (after a
  // 3-day grace) past_due → Free. M-Pesa has no card-on-file auto-charge, so
  // renewal is push-based: the merchant re-pays from the billing page.
  if (path === "/api/billing/run" && request.method === "POST") {
    const secret = envVar(env, "CRON_SECRET");
    const provided = request.headers.get("x-cron-secret") ?? "";
    const admin = await requireHumanAuth(request, env);
    const isAdmin = admin ? roleAtLeast(admin, "admin") : false;
    if (!isAdmin && !(secret && provided === secret)) {
      return json({ error: "unauthorized" }, 401);
    }
    const sql = getSql(env);
    if (!sql) return json({ error: "database not configured" }, 503);
    const graceCutoff = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    // active + lapsed → past_due
    const pastDue = await sql`
      UPDATE subscriptions SET status = 'past_due', updated_at = now()
      WHERE status = 'active' AND plan <> 'free'
        AND current_period_end IS NOT NULL AND current_period_end < now()
      RETURNING venue_id`;
    // past_due beyond grace → Free
    const lapsed = await sql`
      SELECT venue_id FROM subscriptions
      WHERE status = 'past_due' AND current_period_end IS NOT NULL
        AND current_period_end < ${graceCutoff}`;
    for (const row of lapsed) {
      await downgradeToFree(sql, String(row.venue_id));
    }
    return json({ pastDue: pastDue.length, downgraded: lapsed.length });
  }

  // Everything below is per-merchant + authed.
  const payload = await requireHumanAuth(request, env);
  if (!payload) return json({ error: "unauthorized" }, 401);
  if (!roleAtLeast(payload, "merchant")) {
    return json({ error: "Only the account owner can manage billing." }, 403);
  }
  const venue = venueFromPayload(payload, url);
  const sql = getSql(env);
  if (!sql) return json({ error: "database not configured" }, 503);

  // Current plan + subscription + the catalogue + this venue's usage-vs-limits.
  if (path === "/api/billing" && request.method === "GET") {
    const [sub] = await sql`
      SELECT plan, status, current_period_end, amount, last_payment_id
      FROM subscriptions WHERE venue_id = ${venue} LIMIT 1`;
    const tokenPlan = planOf(payload);
    const plan = (sub?.plan as string) ?? tokenPlan ?? "free";
    const limits = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;
    // Live usage for the paywall meters (best-effort, one round-trip each).
    const [usage] = await sql`
      SELECT
        (SELECT count(*) FROM menu_items WHERE venue_id = ${venue})::int AS menu_items,
        (SELECT count(*) FROM app_users WHERE venue_id = ${venue})::int AS staff,
        (SELECT count(*) FROM contacts WHERE venue_id = ${venue})::int AS contacts`;
    return json({
      plan,
      tokenPlan,
      subscription: serializeSubscription(sub),
      plans: BILLING_PLANS,
      limits,
      usage: {
        menu_items: Number(usage?.menu_items ?? 0),
        staff: Number(usage?.staff ?? 0),
        contacts: Number(usage?.contacts ?? 0),
      },
    });
  }

  // Subscribe / change plan. Owner-only (money action). A paid plan fires an
  // M-Pesa STK push via the existing payments integration; the plan activates on
  // payment success (recordLedger → activateSubscription). Downgrading to Free is
  // immediate + free.
  if (path === "/api/billing/subscribe" && request.method === "POST") {
    if (!roleAtLeast(payload, "merchant")) {
      return json({ error: "Only the account owner can change the plan." }, 403);
    }
    const body = (await request.json().catch(() => ({}))) as {
      plan?: string;
      phone?: string;
    };
    const plan = findPlan(body.plan);
    if (!plan) return json({ error: "unknown plan" }, 400);

    if (!isPaidPlan(plan.id)) {
      await downgradeToFree(sql, venue);
      return json({ activated: true, plan: plan.id, message: "Switched to Free." });
    }

    const phone = normalizePhone(body.phone ?? "");
    if (!phone) {
      return json({ error: "An M-Pesa phone number is required to subscribe." }, 400);
    }
    const amount = planPriceMinor(plan.id);
    const intent = await createPaymentIntent(env, {
      venue,
      amount,
      currency: "KES",
      sourceType: "subscription",
      sourceId: plan.id,
      allowedMethod: "m_pesa_express",
      maxTipAmount: 0,
      metadata: {
        subscription_plan: plan.id,
        billing: "1",
        customer_phone: phone,
        customer_name: "Subscription",
        till: `SUB-${plan.id.toUpperCase()}`,
      },
    });
    if ("error" in intent) return json({ error: intent.error }, 503);
    // Reuse the exact payments integration (test-mode sim, live M-Pesa STK, ledger
    // + webhook reconcile) by driving its own create endpoint.
    const payReq = new Request(new URL("/api/payments/create", url.origin), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": `subscription:${venue}:${plan.id}:${intent.token.slice(0, 32)}`,
      },
      body: JSON.stringify({
        amount,
        currency: "KES",
        payment_method: "m_pesa_express",
        payment_intent_token: intent.token,
        metadata: {
          venue,
          subscription_plan: plan.id,
          billing: "1",
          customer_phone: phone,
          customer_name: "Subscription",
          till: `SUB-${plan.id.toUpperCase()}`,
        },
      }),
    });
    const payRes = await handlePaymentRoute(payReq, env);
    const pay = payRes ? ((await payRes.json()) as Record<string, unknown>) : {};
    return json({
      payment_id: pay.payment_id ?? null,
      status: pay.status ?? "pending",
      amount,
      plan: plan.id,
      test_mode: Boolean(pay.test_mode),
      message:
        pay.status === "succeeded"
          ? `You're on ${plan.name}. Refresh to unlock it.`
          : "Check your phone for the M-Pesa prompt to complete payment.",
    });
  }

  // Cancel: keep the paid plan until the period ends, then it lapses to Free via
  // the dunning sweep. With no active period, downgrade immediately.
  if (path === "/api/billing/cancel" && request.method === "POST") {
    if (!roleAtLeast(payload, "merchant")) {
      return json({ error: "Only the account owner can cancel." }, 403);
    }
    const [sub] = await sql`
      SELECT current_period_end FROM subscriptions WHERE venue_id = ${venue} LIMIT 1`;
    const stillActive =
      sub?.current_period_end && new Date(String(sub.current_period_end)) > new Date();
    if (stillActive) {
      await sql`
        UPDATE subscriptions SET status = 'canceled', updated_at = now()
        WHERE venue_id = ${venue}`;
      return json({
        ok: true,
        message: "Cancelled. Your plan stays active until the period ends.",
      });
    }
    await downgradeToFree(sql, venue);
    return json({ ok: true, message: "Cancelled. You're now on Free." });
  }

  return null;
}
