import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { handlePaymentRoute } from "./api/payments";
import { handleAuthRoute } from "./api/auth";
import { withRequestSql } from "./lib/db";
import { enforceRateLimit } from "./lib/rate-limit";
import { handleBackendRoute } from "./api/backend";
import { handleStateRoute } from "./api/state";
import { handleBrandingRoute } from "./api/branding";
import { handleOrgRoute } from "./api/org";
import { handleStaffRoute } from "./api/staff";
import { handleTipsRoute } from "./api/tips";
import { handleOrdersRoute } from "./api/orders";
import { handleWhatsappRoute } from "./api/whatsapp";
import { handleTelegramRoute } from "./api/telegram";
import { handleChannelRoute } from "./api/channels";
import { handleOmniRoute } from "./api/omni";
import { handlePushRoute } from "./api/push";
import { handleBroadcastRoute } from "./api/broadcast";
import { handleDlqRoute } from "./api/dlq";
import { handleKbRoute } from "./api/kb";
import { handleAnalyticsRoute } from "./api/analytics";
import { handleSequenceRoute } from "./api/sequences";
import { handleAiRoute } from "./api/ai";
import { handleInvoiceRoute } from "./api/invoices";
import { handleRecurringRoute } from "./api/recurring";
import { handleA2aRoute } from "./api/a2a";
import { handleMenuRoute } from "./api/menu";

type ServerEntry = {
  fetch: (
    request: Request,
    env: unknown,
    ctx: unknown,
  ) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) =>
        (m as { default?: ServerEntry }).default ??
        (m as unknown as ServerEntry),
    );
  }
  return serverEntryPromise;
}

function brandedErrorResponse(): Response {
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isCatastrophicSsrErrorBody(
  body: string,
  responseStatus: number,
): boolean {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return false;
  }

  if (!payload || Array.isArray(payload) || typeof payload !== "object") {
    return false;
  }

  const fields = payload as Record<string, unknown>;
  const expectedKeys = new Set(["message", "status", "unhandled"]);
  if (!Object.keys(fields).every((key) => expectedKeys.has(key))) {
    return false;
  }

  return (
    fields.unhandled === true &&
    fields.message === "HTTPError" &&
    (fields.status === undefined || fields.status === responseStatus)
  );
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} â try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(
  response: Response,
): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isCatastrophicSsrErrorBody(body, response.status)) {
    return response;
  }

  console.error(
    consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`),
  );
  return brandedErrorResponse();
}

// Defense-in-depth response headers for every response (skips WebSocket
// upgrades, whose 101 response cannot be reconstructed without losing the
// socket). Tighten CORS to known origins in production if served from a fixed
// domain.
function withSecurityHeaders(response: Response): Response {
  if (
    response.status === 101 ||
    (response as { webSocket?: unknown }).webSocket
  ) {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set(
    "Strict-Transport-Security",
    "max-age=31536000; includeSubDomains",
  );
  headers.set("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    const response = await withRequestSql(
      env,
      ctx as { waitUntil?: (promise: Promise<unknown>) => void },
      async () => {
        try {
          // Abuse protection: rate-limit sensitive public endpoints first.
          const limited = await enforceRateLimit(request, env);
          if (limited) return limited;

          // Handle PesaSwap API routes first
          const apiResponse = await handlePaymentRoute(request, env);
          if (apiResponse) return apiResponse;

          // Authentication (JWT login / verify)
          const authResponse = await handleAuthRoute(request, env);
          if (authResponse) return authResponse;

          // Cloud backend (Postgres via Hyperdrive / Workers AI)
          const backendResponse = await handleBackendRoute(request, env);
          if (backendResponse) return backendResponse;

          // Shared merchant state (localStorage <-> Postgres sync)
          const stateResponse = await handleStateRoute(request, env);
          if (stateResponse) return stateResponse;

          // Per-tenant branding (merchant logo/colors + reseller co-brand)
          const brandingResponse = await handleBrandingRoute(request, env);
          if (brandingResponse) return brandingResponse;

          // Reseller organizations (bank white-label)
          const orgResponse = await handleOrgRoute(request, env);
          if (orgResponse) return orgResponse;

          // Server-authoritative staff (team members)
          const staffResponse = await handleStaffRoute(request, env);
          if (staffResponse) return staffResponse;

          // Tips (attribution + pooling + reporting)
          const tipsResponse = await handleTipsRoute(request, env);
          if (tipsResponse) return tipsResponse;

          // Server-authoritative orders + kitchen tickets
          const ordersResponse = await handleOrdersRoute(request, env);
          if (ordersResponse) return ordersResponse;

          // WhatsApp AI agent (Cloud API webhook + simulator)
          const whatsappResponse = await handleWhatsappRoute(request, env);
          if (whatsappResponse) return whatsappResponse;

          // Telegram connection management (config/status/webhook)
          const telegramResponse = await handleTelegramRoute(request, env);
          if (telegramResponse) return telegramResponse;

          // Telegram / Instagram / SMS webhooks + multi-channel simulator
          const channelResponse = await handleChannelRoute(request, env);
          if (channelResponse) return channelResponse;

          // Web chat widget (same agent pipeline, channel = web)
          const omniResponse = await handleOmniRoute(request, env);
          if (omniResponse) return omniResponse;

          // Web Push (PWA staff notifications)
          const pushResponse = await handlePushRoute(request, env);
          if (pushResponse) return pushResponse;

          // Broadcast / campaigns (segmented bulk send across channels)
          const broadcastResponse = await handleBroadcastRoute(request, env);
          if (broadcastResponse) return broadcastResponse;

          // Dead-letter queue (failed deliveries + retry)
          const dlqResponse = await handleDlqRoute(request, env);
          if (dlqResponse) return dlqResponse;

          // Knowledge base (RAG), analytics, sequences, AI provider/transcribe
          const kbResponse = await handleKbRoute(request, env);
          if (kbResponse) return kbResponse;
          const analyticsResponse = await handleAnalyticsRoute(request, env);
          if (analyticsResponse) return analyticsResponse;
          const sequenceResponse = await handleSequenceRoute(request, env);
          if (sequenceResponse) return sequenceResponse;
          const aiResponse = await handleAiRoute(request, env);
          if (aiResponse) return aiResponse;

          // Invoices (omnichannel billing) + A2A agent endpoint
          const invoiceResponse = await handleInvoiceRoute(request, env);
          if (invoiceResponse) return invoiceResponse;
          // Recurring invoices + reminders run
          const recurringResponse = await handleRecurringRoute(request, env);
          if (recurringResponse) return recurringResponse;
          const a2aResponse = await handleA2aRoute(request, env);
          if (a2aResponse) return a2aResponse;

          // Menu (natural-language menu & prices)
          const menuResponse = await handleMenuRoute(request, env);
          if (menuResponse) return menuResponse;

          // Fall through to TanStack Start SSR
          const handler = await getServerEntry();
          const response = await handler.fetch(request, env, ctx);
          return await normalizeCatastrophicSsrResponse(response);
        } catch (error) {
          console.error(error);
          return brandedErrorResponse();
        }
      },
    );
    return withSecurityHeaders(response);
  },
};
