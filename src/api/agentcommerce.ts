import { getSql } from "@/lib/db";
import { envVar } from "@/lib/env";
import { signIntent, verifyIntent, type IntentPayload } from "@/lib/agent-intent";
import { createInvoice, type LineItem } from "@/lib/invoices";
import { getMenu } from "@/lib/menu";
import { createPayLink } from "@/lib/pay-links";
import { splitShares } from "@/lib/split-bill";
import { requireAuth } from "@/api/auth";
import { tokenHasScope } from "@/lib/api-tokens";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-api-key",
};

const UNTRUSTED_AMOUNT_CAP = 100_000;

// Default seats available per slot for the agentic booking capacity check
// (mirrors the conversational agent's VENUE_CAPACITY).
const VENUE_CAPACITY = 60;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders },
  });
}

function wholeNumber(value: unknown): number {
  const next = Number(value);
  return Number.isFinite(next) ? Math.max(0, Math.round(next)) : 0;
}

async function requireAgentToken(
  request: Request,
  env: unknown,
  scopes: Array<"payments:write" | "menu:read" | "bookings:write">,
): Promise<Record<string, unknown> | null> {
  const principal = await requireAuth(request, env);
  if (!principal || principal.isApiToken !== true) return null;
  if (!tokenHasScope(principal, "agent:invoke")) return null;
  return scopes.every((scope) => tokenHasScope(principal, scope))
    ? principal
    : null;
}

// Secret for signing verifiable agent intents (falls back to JWT_SECRET, then a
// dev default). Set AGENT_INTENT_SECRET as a Worker secret in production.
function intentSecret(env: unknown): string {
  return (
    envVar(env, "AGENT_INTENT_SECRET") ??
    envVar(env, "JWT_SECRET") ??
    "pesaswap-dev-intent"
  );
}

type CheckoutItemInput = {
  id?: string;
  qty?: number | string;
};

export async function handleAgentCommerceRoute(
  request: Request,
  env: unknown,
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith("/api/agent")) return null;
  if (request.method === "OPTIONS") return json({ ok: true });

  if (path === "/api/agent/catalog" && request.method === "GET") {
    const venue = url.searchParams.get("venue") || "main";
    const sql = getSql(env);
    if (!sql) return json({ error: "database not configured" }, 503);
    try {
      const items = await getMenu(sql, venue);
      return json({
        venue,
        currency: "KES",
        items: items.map((item) => ({
          id: item.id,
          name: item.name,
          category: item.category,
          price: item.price,
        })),
        checkout: { endpoint: "/api/agent/checkout", method: "POST" },
      });
    } catch {
      return json({
        venue,
        currency: "KES",
        items: [],
        checkout: { endpoint: "/api/agent/checkout", method: "POST" },
      });
    }
  }

  if (path === "/api/agent/checkout" && request.method === "POST") {
    try {
      const principal = await requireAgentToken(request, env, [
        "payments:write",
        "menu:read",
      ]);
      if (!principal) return json({ error: "trusted scoped agent required" }, 401);
      const body = (await request.json().catch(() => ({}))) as {
        items?: CheckoutItemInput[];
        customerRef?: string;
        phone?: string;
        split?: { parties?: number; amounts?: number[] };
      };
      const venue = String(principal.venue ?? "").trim();
      if (!venue) return json({ error: "agent venue required" }, 403);
      const requested = (body.items ?? [])
        .map((item) => ({
          id: String(item.id ?? "").trim(),
          qty: Math.max(1, wholeNumber(item.qty ?? 1)),
        }))
        .filter((item) => /^[0-9a-f-]{36}$/i.test(item.id));
      if (requested.length === 0) return json({ error: "catalogue item ids required" }, 400);
      const sql = getSql(env);
      if (!sql) return json({ error: "database not configured" }, 503);
      const ids = [...new Set(requested.map((item) => item.id))];
      const catalogue = await sql`
        SELECT id, name, price, currency
        FROM menu_items
        WHERE venue_id = ${venue}
          AND id IN (SELECT unnest(${ids}::uuid[]))
          AND available = true`;
      if (catalogue.length !== ids.length) return json({ error: "item unavailable" }, 409);
      const byId = new Map(catalogue.map((item) => [String(item.id), item]));
      const items = requested.map((entry) => {
        const item = byId.get(entry.id)!;
        return {
          description: String(item.name),
          qty: entry.qty,
          price: wholeNumber(item.price),
        };
      });
      const computed = items.reduce(
        (sum, item) => sum + item.qty * item.price,
        0,
      );
      const amount = computed;
      const lineItems = items as LineItem[];

      if (amount <= 0) return json({ error: "amount required" }, 400);

      // Split checkout: mint one server-bound pay link per share (kind=split) that
      // together sum EXACTLY to the total, so an agent can collect a shared bill.
      if (body.split && (body.split.parties || body.split.amounts)) {
        const { shares, error } = splitShares(amount, {
          parties: body.split.parties ?? null,
          amounts: body.split.amounts ?? null,
        });
        if (error) return json({ error }, 400);
        const links: { index: number; amount: number; payUrl: string }[] = [];
        for (let i = 0; i < shares.length; i++) {
          const link = await createPayLink(env, venue, {
            amount: shares[i] * 100, // whole KES → minor units
            currency: "KES",
            kind: "split",
            description: `Split ${i + 1}/${shares.length}${
              body.customerRef ? ` · ${body.customerRef}` : ""
            }`,
            reference: body.customerRef ?? null,
            phone: body.phone ?? null,
            createdBy: "a2a",
          });
          if ("error" in link) return json({ error: link.error }, 400);
          links.push({ index: i + 1, amount: shares[i], payUrl: link.url });
        }
        const splitIntent: IntentPayload = {
          agentRef:
            request.headers.get("x-agent-id") ||
            `token:${String(principal.tokenId ?? "agent")}`,
          userRef: body.customerRef ?? "",
          merchant: venue,
          amount: amount * 100,
          currency: "KES",
          timestamp: Date.now(),
          context: "Agentic split checkout",
        };
        const splitSig = await signIntent(splitIntent, intentSecret(env));
        return json({
          amount,
          currency: "KES",
          status: "created",
          split: { parties: shares.length, shares: links },
          intent: { ...splitIntent, signature: splitSig },
        });
      }

      const result = await createInvoice(env, {
        venue,
        amount,
        currency: "KES",
        customerName: body.customerRef ?? "Agent checkout",
        phone: body.phone ?? null,
        description: "Agentic checkout",
        lineItems,
        notes: body.customerRef ? `Customer reference: ${body.customerRef}` : null,
      });

      if ("error" in result) return json({ error: result.error }, 400);

      // Verifiable Intent: sign this checkout so the merchant (and any relying
      // party) can cryptographically confirm what the agent authorised.
      const intentPayload: IntentPayload = {
        agentRef:
          request.headers.get("x-agent-id") ||
          `token:${String(principal.tokenId ?? "agent")}`,
        userRef: body.customerRef ?? "",
        merchant: venue,
        amount: result.amount * 100,
        currency: "KES",
        timestamp: Date.now(),
        context: "Agentic checkout",
      };
      const signature = await signIntent(intentPayload, intentSecret(env));
      try {
        await sql`
          INSERT INTO agent_intents
            (venue_id, agent_ref, user_ref, merchant, amount, currency, context, signature, status)
            VALUES (${venue}, ${intentPayload.agentRef}, ${intentPayload.userRef ?? null},
                    ${venue}, ${intentPayload.amount}, 'KES', ${intentPayload.context ?? null},
                  ${signature}, 'checkout')`;
      } catch {
        /* audit insert is best-effort; the invoice already exists */
      }

      return json({
        intentId: result.number,
        amount: result.amount,
        currency: "KES",
        payUrl: result.payLink,
        status: "created",
        intent: { ...intentPayload, signature },
      });
    } catch {
      return json({ error: "could not create checkout" }, 500);
    }
  }

  // Confirmed booking: an external agent reserves a table. Capacity-checked
  // against existing reservations, then inserts a CONFIRMED reservation (not a
  // pending enquiry) and returns the booking id.
  if (path === "/api/agent/booking" && request.method === "POST") {
    const principal = await requireAgentToken(request, env, ["bookings:write"]);
    if (!principal) return json({ error: "trusted scoped agent required" }, 401);
    const sql = getSql(env);
    if (!sql) return json({ error: "database not configured" }, 503);
    const body = (await request.json().catch(() => ({}))) as {
      venue?: string;
      name?: string;
      phone?: string;
      covers?: number | string;
      date?: string;
      time?: string;
      notes?: string;
    };
    const venue = String(principal.venue ?? "").trim();
    const covers = wholeNumber(body.covers);
    const name = String(body.name ?? "").trim();
    const date = String(body.date ?? "").trim();
    const time = String(body.time ?? "").trim();
    if (!name) return json({ error: "name required" }, 400);
    if (covers <= 0) return json({ error: "covers required" }, 400);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return json({ error: "date (YYYY-MM-DD) required" }, 400);
    }
    if (!/^\d{1,2}:\d{2}$/.test(time)) {
      return json({ error: "time (HH:MM) required" }, 400);
    }
    try {
      const [{ booked }] = await sql`
        SELECT coalesce(sum(covers),0)::int AS booked FROM reservations
        WHERE venue_id = ${venue} AND date = ${date} AND time = ${time}
          AND status <> 'cancelled'`;
      const available = VENUE_CAPACITY - Number(booked);
      if (available < covers) {
        return json(
          { error: "no availability for that slot", available: Math.max(0, available) },
          409,
        );
      }
      const [row] = await sql`
        INSERT INTO reservations
          (venue_id, customer_name, phone, covers, date, time, status)
        VALUES (${venue}, ${name}, ${body.phone?.trim() || null}, ${covers},
                ${date}, ${time}, 'confirmed')
        RETURNING id, status`;
      return json(
        { bookingId: row.id, status: row.status, covers, date, time, venue },
        201,
      );
    } catch {
      return json({ error: "could not create booking" }, 500);
    }
  }

  // Create + sign a standalone agent intent (Agent Pay Gateway handshake).
  if (path === "/api/agent/intent" && request.method === "POST") {
    const principal = await requireAgentToken(request, env, ["payments:write"]);
    if (!principal) return json({ error: "trusted scoped agent required" }, 401);
    const body = (await request.json().catch(() => ({}))) as {
      agentRef?: string;
      userRef?: string;
      sourceType?: string;
      sourceId?: string;
      context?: string;
    };
    const venue = String(principal.venue ?? "").trim();
    const sql = getSql(env);
    if (!sql) return json({ error: "database not configured" }, 503);
    const sourceType = body.sourceType === "invoice" ? "invoice" : "order";
    const sourceId = String(body.sourceId ?? "").trim();
    if (!sourceId) return json({ error: "sourceId required" }, 400);
    let amount = 0;
    let currency = "KES";
    if (sourceType === "order") {
      const [order] = await sql`
        SELECT total::bigint AS amount, currency FROM orders
        WHERE id = ${sourceId} AND venue_id = ${venue} LIMIT 1`;
      if (!order) return json({ error: "order not found" }, 404);
      amount = Number(order.amount);
      currency = String(order.currency ?? "KES");
    } else {
      const [invoice] = await sql`
        SELECT ((amount - amount_paid) * 100)::bigint AS amount, currency
        FROM invoices
        WHERE (id::text = ${sourceId} OR number = ${sourceId})
          AND venue_id = ${venue}
        LIMIT 1`;
      if (!invoice) return json({ error: "invoice not found" }, 404);
      amount = Number(invoice.amount);
      currency = String(invoice.currency ?? "KES");
    }
    if (amount <= 0) return json({ error: "source is already settled" }, 409);
    if (amount > UNTRUSTED_AMOUNT_CAP * 100) return json({ error: "amount exceeds agent cap" }, 400);
    const payload: IntentPayload = {
      agentRef: String(
        body.agentRef || request.headers.get("x-agent-id") || "public-agent",
      ),
      userRef: String(body.userRef || ""),
      merchant: venue,
      amount,
      currency,
      timestamp: Date.now(),
      context: String(body.context || ""),
    };
    const signature = await signIntent(payload, intentSecret(env));
    let id: string | undefined;
    if (sql) {
      try {
        const [row] = await sql`
          INSERT INTO agent_intents
            (venue_id, agent_ref, user_ref, merchant, amount, currency, context, signature, status)
          VALUES (${venue}, ${payload.agentRef}, ${payload.userRef ?? null}, ${payload.merchant},
                  ${amount}, ${payload.currency}, ${payload.context ?? null}, ${signature}, 'signed')
          RETURNING id`;
        id = (row as { id?: string } | undefined)?.id;
      } catch {
        /* best-effort persistence */
      }
    }
    return json({ id, payload, signature }, 201);
  }

  // Verify a previously signed intent (constant-time HMAC check).
  if (path === "/api/agent/intent/verify" && request.method === "POST") {
    const body = (await request.json().catch(() => ({}))) as {
      payload?: IntentPayload;
      signature?: string;
    };
    if (!body.payload || !body.signature) {
      return json({ error: "payload and signature required" }, 400);
    }
    const valid = await verifyIntent(
      body.payload,
      body.signature,
      intentSecret(env),
    );
    return json({ valid });
  }

  return null;
}
