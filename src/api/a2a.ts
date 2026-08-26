import { runAgent, type AgentRole } from "@/lib/agent";
import { envVar } from "@/lib/env";
import { verifyPeerSignature } from "@/lib/webhook-verify";
import { tokenHasScope } from "@/lib/api-tokens";
import { requireAuth } from "@/api/auth";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders },
  });
}

// Agent-to-Agent (A2A): a natural-language endpoint + discovery card so external
// agents can drive our CRM in plain language (Omni's A2A pattern, simplified).
export async function handleA2aRoute(
  request: Request,
  env: unknown,
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (
    (path === "/.well-known/agent-card.json" ||
      path === "/.well-known/agent.json") &&
    request.method === "GET"
  ) {
    return json({
      name: "PesaSwap Agent",
      description:
        "Restaurant/merchant CRM agent. Books tables, answers FAQs, manages enquiries, contacts and invoices in natural language.",
      version: "1.1.0",
      protocol: "a2a-simple",
      endpoints: {
        message: "/api/a2a",
        catalog: "/api/agent/catalog",
        checkout: "/api/agent/checkout",
        booking: "/api/agent/booking",
      },
      capabilities: [
        "create_enquiry",
        "check_availability",
        "get_todays_bookings",
        "count_enquiries",
        "search_contacts",
        "search_kb",
        "create_invoice",
        "escalate_to_human",
        "get_catalog",
        "checkout",
        "split_checkout",
        "book",
      ],
      skills: [
        { id: "book", description: "Book a table (guests, date, time)" },
        {
          id: "reserve",
          description:
            "Create a CONFIRMED table reservation (capacity-checked) via /api/agent/booking.",
        },
        { id: "faq", description: "Answer venue FAQs from the knowledge base" },
        { id: "crm", description: "Query bookings, covers, contacts (staff)" },
        { id: "invoice", description: "Create and send an invoice (staff)" },
        {
          id: "catalog",
          description:
            "Return a machine-readable venue catalog with KES prices.",
        },
        {
          id: "buy",
          description:
            "Create a secure checkout pay link for selected items or an amount.",
        },
        {
          id: "split",
          description:
            "Split a bill into N server-bound pay links (equal or custom shares) via /api/agent/checkout with a `split` field.",
        },
      ],
    });
  }

  if (path === "/api/a2a" && request.method === "POST") {
    const body = (await request.json()) as {
      message?: string;
      text?: string;
      venue?: string;
      from?: string;
      name?: string;
      role?: AgentRole;
    };
    const message = String(body.message ?? body.text ?? "");
    if (!message.trim()) return json({ error: "message required" }, 400);
    // Privileged (staff) scope — which can create invoices and read contacts —
    // requires a shared A2A key. Without it the agent runs with customer scope,
    // so an anonymous caller cannot self-assign a staff role via the body.
    const apiKey = envVar(env, "A2A_API_KEY") ?? envVar(env, "OMNI_API_KEY");
    const provided = request.headers.get("x-api-key") ?? "";
    // A caller earns trusted (staff) scope two ways: a shared api-key, OR a valid
    // ROTATING SIGNED PEER TOKEN — HMAC(A2A_PEER_SECRET, `${agentId}.${ts}`) in
    // x-agent-signature, bounded to a 5-minute window so it expires + rotates.
    // The secret is optional (unset = api-key only), so this is back-compatible.
    const peerSecret = envVar(env, "A2A_PEER_SECRET");
    const signedPeer = peerSecret
      ? await verifyPeerSignature(
          request.headers.get("x-agent-id"),
          request.headers.get("x-agent-timestamp"),
          request.headers.get("x-agent-signature"),
          peerSecret,
        )
      : false;
    // A personal/agent API token (Bearer pat_…) carrying `agent:invoke` grants
    // staff-scoped access, bound to the token's own venue. This is the primary way
    // an agent acts on a user's behalf — scoped + revocable, separate from a login.
    const principal = await requireAuth(request, env);
    const tokenAgent = Boolean(
      principal &&
        (principal as { isApiToken?: boolean }).isApiToken &&
        tokenHasScope(principal, "agent:invoke"),
    );
    const tokenVenue = tokenAgent
      ? ((principal as { venue?: string }).venue ?? undefined)
      : undefined;
    const tokenScopes = tokenAgent
      ? ((principal as { scopes?: string[] }).scopes ?? [])
      : null;
    const authorized =
      (Boolean(apiKey) && provided === apiKey) || signedPeer || tokenAgent;

    // Peer allowlist (hardening): when A2A_PEER_ALLOWLIST is set (comma-separated
    // agent ids), only a trusted (api-key) caller OR a listed `x-agent-id` peer may
    // call. Unset = open (back-compat). Blocks unknown agents entirely.
    const allowRaw = envVar(env, "A2A_PEER_ALLOWLIST");
    if (allowRaw) {
      const allowed = allowRaw
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      const agentId = (request.headers.get("x-agent-id") ?? "").toLowerCase();
      if (!authorized && !allowed.includes(agentId)) {
        return json({ error: "agent not allowlisted" }, 403);
      }
    }

    // Capability scoping by caller: a trusted key grants staff scope (bounded by
    // the agent's own role gate); everyone else is customer-scoped.
    const role: AgentRole = authorized ? (body.role ?? "staff") : "customer";
    const scopes =
      tokenScopes ??
      (role === "customer"
        ? ["get_menu", "check_availability", "create_enquiry", "checkout", "book"]
        : ["*"]);
    const result = await runAgent(
      message,
      {
        venue: tokenVenue ?? body.venue ?? "main",
        role,
        from: body.from ?? "a2a",
        name: body.name,
      },
      env,
    );
    return json({
      reply: result.reply,
      tool: result.tool ?? null,
      escalate: result.escalate ?? false,
      scope: role,
      capabilities: scopes,
    });
  }

  return null;
}
