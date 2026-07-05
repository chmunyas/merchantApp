import { runAgent, type AgentRole } from "@/lib/agent";
import { envVar } from "@/lib/env";

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
      version: "1.0.0",
      protocol: "a2a-simple",
      endpoints: {
        message: "/api/a2a",
        catalog: "/api/agent/catalog",
        checkout: "/api/agent/checkout",
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
      ],
      skills: [
        { id: "book", description: "Book a table (guests, date, time)" },
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
    const authorized = Boolean(apiKey) && provided === apiKey;
    const role: AgentRole = authorized ? (body.role ?? "staff") : "customer";
    const result = await runAgent(
      message,
      {
        venue: body.venue ?? "main",
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
    });
  }

  return null;
}
