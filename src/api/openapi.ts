// API-first: a curated OpenAPI 3.1 contract for the core, integration-facing
// endpoints, plus the outbound webhook catalogue and a Swagger UI docs page. All
// paths are served under the stable /api/v1 alias (rewritten to /api by the
// worker), so third parties can pin a version.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const spec = {
  openapi: "3.1.0",
  info: {
    title: "PesaSwap Merchant API",
    version: "1.0.0",
    description:
      "Omnichannel merchant commerce API: payments, invoices, fees and webhooks. " +
      "Authenticate with a Bearer JWT (login) or a `pat_` API token. All endpoints " +
      "are also available unversioned under /api, but integrations should pin /api/v1.",
  },
  servers: [{ url: "/api/v1", description: "Versioned API" }],
  security: [{ bearerAuth: [] }],
  tags: [
    { name: "Payments" },
    { name: "Invoices" },
    { name: "Fees" },
    { name: "Webhooks" },
  ],
  paths: {
    "/payments/create": {
      post: {
        tags: ["Payments"],
        summary: "Create a payment",
        description:
          "Initiates a payment. Send an `Idempotency-Key` header — a replay returns " +
          "the same result and never double-charges.",
        parameters: [
          {
            name: "Idempotency-Key",
            in: "header",
            schema: { type: "string" },
            description: "Stable key for safe, de-duplicated retries.",
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/PaymentCreate" },
            },
          },
        },
        responses: {
          "201": {
            description: "Created",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Payment" },
              },
            },
          },
          "200": { description: "Idempotent replay of a prior create" },
          "400": { description: "Invalid request" },
        },
      },
    },
    "/payments/{id}/status": {
      get: {
        tags: ["Payments"],
        summary: "Get payment status",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": {
            description: "OK",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Payment" },
              },
            },
          },
          "404": { description: "Not found" },
        },
      },
    },
    "/payments/config": {
      get: {
        tags: ["Payments"],
        summary: "Payment mode",
        description: "Whether this deployment simulates payments (sandbox) or is live.",
        security: [],
        responses: {
          "200": {
            description: "OK",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { testMode: { type: "boolean" } },
                },
              },
            },
          },
        },
      },
    },
    "/invoices": {
      get: {
        tags: ["Invoices"],
        summary: "List invoices",
        responses: { "200": { description: "OK" }, "401": { description: "Unauthorized" } },
      },
      post: {
        tags: ["Invoices"],
        summary: "Create an invoice",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/InvoiceCreate" },
            },
          },
        },
        responses: { "200": { description: "Created" }, "401": { description: "Unauthorized" } },
      },
    },
    "/invoices/payinfo": {
      get: {
        tags: ["Invoices"],
        summary: "Public pay info for an invoice",
        security: [],
        parameters: [
          { name: "number", in: "query", required: true, schema: { type: "string" } },
        ],
        responses: { "200": { description: "OK" }, "404": { description: "Not found" } },
      },
    },
    "/fees/summary": {
      get: {
        tags: ["Fees"],
        summary: "Blended effective rate + per-method breakdown",
        parameters: [
          { name: "days", in: "query", schema: { type: "integer", default: 30 } },
        ],
        responses: { "200": { description: "OK" }, "401": { description: "Unauthorized" } },
      },
    },
    "/fees/config": {
      get: {
        tags: ["Fees"],
        summary: "Published fee schedule",
        security: [],
        responses: { "200": { description: "OK" } },
      },
    },
  },
  webhooks: {
    "payment.succeeded": {
      post: {
        tags: ["Webhooks"],
        summary: "A payment settled",
        description:
          "Delivered to your endpoint with an HMAC signature header. Also emitted: " +
          "payment.failed, payment.refunded, invoice.paid, inventory.low_stock.",
        requestBody: {
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Payment" },
            },
          },
        },
        responses: { "200": { description: "Acknowledged" } },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description: "A login JWT or a `pat_` API token.",
      },
    },
    schemas: {
      PaymentCreate: {
        type: "object",
        required: ["amount", "currency", "description"],
        properties: {
          amount: { type: "integer", description: "Minor units (cents)" },
          currency: { type: "string", example: "KES" },
          description: { type: "string" },
          metadata: {
            type: "object",
            properties: {
              venue: { type: "string" },
              flow_type: {
                type: "string",
                enum: ["tapgo", "invoice", "table", "quick_charge"],
              },
              invoice_number: { type: "string" },
              customer_phone: { type: "string" },
            },
          },
        },
      },
      Payment: {
        type: "object",
        properties: {
          payment_id: { type: "string" },
          status: {
            type: "string",
            enum: ["succeeded", "processing", "failed"],
          },
          amount: { type: "integer" },
          currency: { type: "string" },
          provider_ref: { type: "string", description: "M-Pesa receipt (REF)" },
        },
      },
      InvoiceCreate: {
        type: "object",
        required: ["amount"],
        properties: {
          customerName: { type: "string" },
          phone: { type: "string" },
          amount: { type: "number", description: "Whole currency units" },
          description: { type: "string" },
        },
      },
    },
  },
} as const;

const DOCS_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>PesaSwap Merchant API — Docs</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  </head>
  <body>
    <div id="swagger"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script>
      window.ui = SwaggerUIBundle({
        url: "/api/openapi.json",
        dom_id: "#swagger",
      });
    </script>
  </body>
</html>`;

export function handleOpenApiRoute(request: Request): Response | null {
  const url = new URL(request.url);
  const path = url.pathname;
  if (path !== "/api/openapi.json" && path !== "/api/docs") return null;
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (path === "/api/openapi.json") {
    return new Response(JSON.stringify(spec), {
      headers: { "content-type": "application/json", ...corsHeaders },
    });
  }
  return new Response(DOCS_HTML, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
