import { getSql } from "@/lib/db";
import { envVar } from "@/lib/env";
import { createInvoice, type LineItem } from "@/lib/invoices";
import { getMenu } from "@/lib/menu";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-api-key",
};

const UNTRUSTED_AMOUNT_CAP = 100_000;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders },
  });
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function wholeNumber(value: unknown): number {
  const next = Number(value);
  return Number.isFinite(next) ? Math.max(0, Math.round(next)) : 0;
}

function isTrusted(request: Request, env: unknown): boolean {
  const key = envVar(env, "A2A_API_KEY") ?? envVar(env, "OMNI_API_KEY");
  return Boolean(key) && request.headers.get("x-api-key") === key;
}

type CheckoutItemInput = {
  name?: string;
  price?: number | string;
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
          id: slug(`${item.category}-${item.name}`),
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
      const body = (await request.json().catch(() => ({}))) as {
        venue?: string;
        items?: CheckoutItemInput[];
        amount?: number | string;
        customerRef?: string;
        phone?: string;
      };
      const venue = String(body.venue || "main").trim() || "main";
      const items = (body.items ?? [])
        .map((item) => ({
          description: String(item.name ?? "").trim(),
          qty: Math.max(1, wholeNumber(item.qty ?? 1)),
          price: wholeNumber(item.price ?? 0),
        }))
        .filter((item) => item.description && item.price > 0);
      const computed = items.reduce(
        (sum, item) => sum + item.qty * item.price,
        0,
      );
      const providedAmount = wholeNumber(body.amount);
      const amount = providedAmount > 0 ? providedAmount : computed;
      const lineItems =
        items.length > 0 && (providedAmount <= 0 || providedAmount === computed)
          ? (items as LineItem[])
          : undefined;

      if (amount <= 0) return json({ error: "amount required" }, 400);
      if (!isTrusted(request, env) && amount > UNTRUSTED_AMOUNT_CAP) {
        return json({ error: "amount exceeds public checkout cap" }, 400);
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

      return json({
        intentId: result.number,
        amount: result.amount,
        currency: "KES",
        payUrl: result.payLink,
        status: "created",
      });
    } catch {
      return json({ error: "could not create checkout" }, 500);
    }
  }

  return null;
}
