import { requireAuth } from "@/api/auth";
import { runAgent } from "@/lib/agent";
import { canSeeSensitive, runCopilotTools } from "@/lib/copilot-tools";
import { getSql } from "@/lib/db";
import { isAccountRateLimited } from "@/lib/rate-limit";
import { venueFromPayload } from "@/lib/tenancy";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders },
  });
}

type GroundingContext = {
  today: { gross: number; tx: number };
  openOrders: number;
};

async function getGroundingContext(
  env: unknown,
  venue: string,
  sensitive: boolean,
): Promise<GroundingContext> {
  const sql = getSql(env);
  if (!sql) return { today: { gross: 0, tx: 0 }, openOrders: 0 };

  // Money figures (gross + tx count) are only ever ground into the prompt for an
  // owner-level session — a staff/manager copilot never receives them.
  let gross = 0;
  let tx = 0;
  if (sensitive) {
    const [totals] = await sql`
      SELECT count(*)::int AS tx,
             coalesce(sum(amount), 0)::bigint AS gross
      FROM payments
      WHERE venue_id = ${venue}
        AND status IN ('succeeded', 'paid', 'captured')
        AND created_at::date = CURRENT_DATE`;
    gross = Number(totals?.gross ?? 0);
    tx = Number(totals?.tx ?? 0);
  }

  const [orders] = await sql`
    SELECT count(*)::int AS open
    FROM orders
    WHERE venue_id = ${venue}
      AND status NOT IN ('served', 'cancelled')`;

  return { today: { gross, tx }, openOrders: Number(orders?.open ?? 0) };
}

// Money + PII topics — blocked up front for non-owner sessions so a staff/manager
// copilot can never coax revenue, payment amounts, settlement figures, customer
// spend or phone numbers out of any downstream tool or the agent.
function isSensitiveTopic(message: string): boolean {
  return /\b(sales|revenue|takings|turnover|gross|earnings?|profit|amount|paid|payment|pay ?link|payout|settle|settlement|unreconciled|reconcile|invoice|bill|charge|phone|number|contact details?|top (customers?|spenders?)|vips?|how much|balance|owe|owes|debt)\b/i.test(
    message,
  );
}

const OWNER_ONLY_REPLY =
  "Sales, payments, settlement and customer contact details are owner-only. Please sign in as the merchant owner (or ask them) to see those. I can still help with orders, the menu, bookings, stock and day-to-day operations.";

function shouldPreserveOriginalMessage(message: string): boolean {
  return /\b(invoice|bill|payment link|charge|collect|pay)\b/i.test(message);
}

function withContext(
  message: string,
  context: GroundingContext,
  sensitive: boolean,
): string {
  const lines = [message, "", "Merchant copilot context for this venue:"];
  if (sensitive) {
    lines.push(
      `- Today's gross: KES ${(context.today.gross / 100).toLocaleString("en-KE", { minimumFractionDigits: 2 })}`,
      `- Today's transactions: ${context.today.tx}`,
    );
  }
  lines.push(`- Open orders: ${context.openOrders}`);
  lines.push(
    sensitive
      ? "Use this context when answering merchant operations questions."
      : "This is a non-owner session: financial + payment figures are hidden — do not state or estimate revenue, amounts or customer phone numbers.",
  );
  return lines.join("\n");
}

// Common owner questions are handled by the ops tool registry (LLM-agnostic).

export async function handleCopilotRoute(
  request: Request,
  env: unknown,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/copilot")) return null;
  if (request.method === "OPTIONS") return json({ ok: true });
  if (url.pathname !== "/api/copilot" || request.method !== "POST") return null;

  try {
    const payload = await requireAuth(request, env);
    if (!payload) {
      return json({
        reply: "Please sign in to use the merchant copilot.",
      });
    }

    const venue = venueFromPayload(payload, url);
    // Per-account guard: the copilot runs the LLM agent on every message, so cap
    // how fast one venue can call it (independent of IP). Replies in-shape so the
    // chat UI shows a friendly nudge rather than an error.
    if (await isAccountRateLimited(env, venue, "copilot", 30, 60)) {
      return json({
        reply: "You're sending messages very fast — give me a moment and try again.",
      });
    }
    const role = String((payload as { role?: string }).role ?? "staff");
    const sensitive = canSeeSensitive(role);
    const body = (await request.json().catch(() => ({}))) as {
      message?: string;
      text?: string;
    };
    const message = String(body.message ?? body.text ?? "").trim();
    if (!message) {
      return json({
        reply: "Ask me about sales, orders, bookings, contacts, or invoices.",
      });
    }

    // Role-based access: a non-owner session (staff / supervisor / manager) can run
    // day-to-day operations but never see money or PII. Block those topics up front
    // so no tool or agent path can leak them.
    if (!sensitive && isSensitiveTopic(message)) {
      return json({ reply: OWNER_ONLY_REPLY, data: { restricted: true } });
    }

    let context: GroundingContext = {
      today: { gross: 0, tx: 0 },
      openOrders: 0,
    };
    try {
      context = await getGroundingContext(env, venue, sensitive);
    } catch {
      /* Grounding is best-effort; the agent can still act. */
    }

    // Runtime ops tools (reprice, restock/86, add item, bill, draft campaign,
    // sales report) — executes actions. Deterministic-first, LLM-agnostic router.
    // Sensitive tools re-check the caller's role internally (defence in depth).
    const toolResult = await runCopilotTools(message, { venue, env, role });
    if (toolResult) {
      return json({
        reply: toolResult.reply,
        data: {
          context,
          tool: toolResult.tool,
          mutated: toolResult.mutated ?? false,
          result: toolResult.data ?? null,
        },
      });
    }

    const agentMessage = shouldPreserveOriginalMessage(message)
      ? message
      : withContext(message, context, sensitive);
    const result = await runAgent(
      agentMessage,
      { venue, role: "staff", from: "copilot", name: "Owner" },
      env,
    );

    return json({
      reply: result.reply,
      data: {
        context,
        tool: result.tool ?? null,
        escalate: result.escalate ?? false,
        result: result.data ?? null,
      },
    });
  } catch {
    return json({
      reply:
        "I hit a temporary issue, but I can still help. Try asking again in a moment.",
    });
  }
}
