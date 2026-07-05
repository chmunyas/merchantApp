import { requireAuth } from "@/api/auth";
import { runAgent } from "@/lib/agent";
import { getSql } from "@/lib/db";
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
): Promise<GroundingContext> {
  const sql = getSql(env);
  if (!sql) return { today: { gross: 0, tx: 0 }, openOrders: 0 };

  const [totals] = await sql`
    SELECT count(*)::int AS tx,
           coalesce(sum(amount), 0)::bigint AS gross
    FROM payments
    WHERE venue_id = ${venue}
      AND status IN ('succeeded', 'paid', 'captured')
      AND created_at::date = CURRENT_DATE`;

  const [orders] = await sql`
    SELECT count(*)::int AS open
    FROM orders
    WHERE venue_id = ${venue}
      AND status NOT IN ('served', 'cancelled')`;

  return {
    today: {
      gross: Number(totals?.gross ?? 0),
      tx: Number(totals?.tx ?? 0),
    },
    openOrders: Number(orders?.open ?? 0),
  };
}

function shouldPreserveOriginalMessage(message: string): boolean {
  return /\b(invoice|bill|payment link|charge|collect|pay)\b/i.test(message);
}

function withContext(message: string, context: GroundingContext): string {
  return [
    message,
    "",
    "Merchant copilot context for this venue:",
    `- Today's gross: KES ${(context.today.gross / 100).toLocaleString("en-KE", { minimumFractionDigits: 2 })}`,
    `- Today's transactions: ${context.today.tx}`,
    `- Open orders: ${context.openOrders}`,
    "Use this context when answering merchant operations questions.",
  ].join("\n");
}

// Common owner questions ("how were sales today?", "how busy are we?") deserve a
// direct, accurate answer from live data rather than a model round-trip that may
// miss the numbers. Returns a grounded reply for metric questions, else null.
function directOpsAnswer(
  message: string,
  context: GroundingContext,
): string | null {
  const m = message.toLowerCase();
  const asksMetrics =
    /(sales|today|revenue|takings|gross|turnover|earn|made|how much|how are we|how'?s? (business|it going)|performance|busy|orders?)/.test(
      m,
    );
  if (!asksMetrics) return null;
  const gross = `KES ${(context.today.gross / 100).toLocaleString("en-KE", { minimumFractionDigits: 2 })}`;
  const tx = context.today.tx;
  const open = context.openOrders;
  const parts = [
    tx === 0
      ? "No paid sales recorded yet today."
      : `Today so far: ${gross} across ${tx} paid transaction${tx === 1 ? "" : "s"}.`,
    `${open} open order${open === 1 ? "" : "s"} in the kitchen.`,
  ];
  return parts.join(" ");
}

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

    let context: GroundingContext = {
      today: { gross: 0, tx: 0 },
      openOrders: 0,
    };
    try {
      context = await getGroundingContext(env, venue);
    } catch {
      /* Grounding is best-effort; the agent can still act. */
    }

    // Answer live-metric questions directly from data (accurate, no round-trip).
    const direct = directOpsAnswer(message, context);
    if (direct) {
      return json({ reply: direct, data: { context } });
    }

    const agentMessage = shouldPreserveOriginalMessage(message)
      ? message
      : withContext(message, context);
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
