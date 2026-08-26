import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { handlePaymentRoute, runFinancialRecovery } from "./api/payments";
import { handleAuthRoute } from "./api/auth";
import { handleSsoRoute } from "./api/sso";
import { withRequestSql } from "./lib/db";
import {
  mapWithConcurrency,
  nextVenueSlice,
  saveVenueCursor,
} from "./lib/cron-fanout";

// Per-invocation venue budget. Sized so a slice finishes well inside a scheduled
// invocation; the cursor carries the rest to the next run.
const VENUE_SLICE = 100;
// Bounded by the Postgres client's connection cap — more parallelism would only
// queue inside the driver while multiplying peak memory.
const VENUE_CONCURRENCY = 4;
import { enforceRateLimit } from "./lib/rate-limit";
import { resolveCorsOrigin } from "./lib/cors";
import { captureException } from "./lib/observability";
import { handleBackendRoute } from "./api/backend";
import { handleStateRoute } from "./api/state";
import { handleBrandingRoute } from "./api/branding";
import { handleManifestRoute } from "./api/manifest";
import { handleBillingRoute } from "./api/billing";
import { handleTokensRoute } from "./api/tokens";
import { handleOrgRoute } from "./api/org";
import { handleStaffRoute } from "./api/staff";
import { handleStaffAlertsRoute } from "./api/staff-alerts";
import { handleTipsRoute } from "./api/tips";
import { handleOrdersRoute } from "./api/orders";
import { handleReportsRoute } from "./api/reports";
import { handleTablesRoute } from "./api/tables";
import { handleVenuesRoute } from "./api/venues";
import { handleVenueServiceSettingsRoute } from "./api/venue-service-settings";
import { handleVenueProfileRoute } from "./api/venue-profile";
import { handleRetailRoute } from "./api/retail";
import { handleWalkoutsRoute } from "./api/walkouts";
import { handleMultiStoreRoute } from "./api/multistore";
import { handleQrRoute } from "./api/qr";
import { handleKeQrConfigRoute } from "./api/keqr";
import { handleCopilotRoute } from "./api/copilot";
import { handleAgentCommerceRoute } from "./api/agentcommerce";
import { handleShareRoute } from "./api/share";
import { handleInventoryRoute } from "./api/inventory";
import { handleSettlementRoute } from "./api/settlement";
import { handleDisputeRoute } from "./api/disputes";
import { handleAccountingRoute } from "./api/accounting";
import { handleReviewsRoute } from "./api/reviews";
import { handleShiftsRoute } from "./api/shifts";
import { handleOpsRoute } from "./api/ops";
import { handlePayoutsRoute } from "./api/payouts";
import { handlePortalRoute } from "./api/portal";
import { handlePosRoute } from "./api/pos";
import { handleWhatsappRoute } from "./api/whatsapp";
import { handleTelegramRoute } from "./api/telegram";
import { handleChannelRoute } from "./api/channels";
import { handleChannelRecoveryRoute } from "./api/channel-recovery";
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
import { handleForecastRoute } from "./api/forecast";
import { handleGuestRoute } from "./api/guest";
import { handlePricingRoute } from "./api/pricing";
import { handleRfmRoute } from "./api/rfm";
import { handlePromoRoute } from "./api/promo";
import { handlePaymentMethodsAdminRoute } from "./api/payment-methods-admin";
import { handlePayLinkRoute } from "./api/pay-links";
import { handleFeesRoute } from "./api/fees";
import { handleOpenApiRoute } from "./api/openapi";
import { handleAdminRoute } from "./api/admin";
import { runtimeSecurityResponse } from "./lib/runtime-security";
import {
  matchedRouteForRequest,
  routePolicyResponse,
} from "./lib/route-policy";
import { authorizeRouteRequest } from "./lib/route-authorization";
import { getSql } from "./lib/db";
import { runIngressWorker } from "./lib/channel-ingress";
import { runOutboundWorker } from "./lib/outbound-jobs";
import { runDueSteps } from "./lib/sequences";
import { runTipCadence } from "./api/tips";
import { runWalkoutDetection } from "./lib/walkout-detect";
import { runPosRecovery } from "./lib/pos-recovery";

// The real-time hub Durable Object must be exported from the worker entry so the
// Cloudflare runtime can instantiate it for the REALTIME binding (see wrangler.toml).
export { RealtimeHub } from "./realtime-do";
export { RateLimiterShard } from "./rate-limit-do";

type ServerEntry = {
  fetch: (
    request: Request,
    env: unknown,
    ctx: unknown,
  ) => Promise<Response> | Response;
};

type ApiHandler = (
  request: Request,
  env: unknown,
  ctx?: unknown,
) => Promise<Response | null> | Response | null;

export const API_HANDLERS: Readonly<Record<string, ApiHandler>> = {
  a2a: handleA2aRoute,
  accounting: handleAccountingRoute,
  admin: handleAdminRoute,
  agentcommerce: handleAgentCommerceRoute,
  ai: handleAiRoute,
  analytics: handleAnalyticsRoute,
  auth: handleAuthRoute,
  backend: handleBackendRoute,
  billing: handleBillingRoute,
  branding: handleBrandingRoute,
  broadcast: handleBroadcastRoute,
  channels: handleChannelRoute,
  channelRecovery: handleChannelRecoveryRoute,
  copilot: handleCopilotRoute,
  disputes: handleDisputeRoute,
  dlq: handleDlqRoute,
  fees: handleFeesRoute,
  forecast: handleForecastRoute,
  guest: handleGuestRoute,
  inventory: handleInventoryRoute,
  invoices: handleInvoiceRoute,
  kb: handleKbRoute,
  keqr: handleKeQrConfigRoute,
  manifest: handleManifestRoute,
  menu: handleMenuRoute,
  multistore: handleMultiStoreRoute,
  omni: handleOmniRoute,
  openapi: (request) => handleOpenApiRoute(request),
  orders: handleOrdersRoute,
  org: handleOrgRoute,
  "pay-links": handlePayLinkRoute,
  "payment-methods-admin": handlePaymentMethodsAdminRoute,
  payments: (request, env) => handlePaymentRoute(request, env),
  ops: handleOpsRoute,
  payouts: handlePayoutsRoute,
  portal: handlePortalRoute,
  pos: handlePosRoute,
  pricing: handlePricingRoute,
  promo: handlePromoRoute,
  push: handlePushRoute,
  qr: handleQrRoute,
  recurring: handleRecurringRoute,
  reports: handleReportsRoute,
  reviews: handleReviewsRoute,
  rfm: handleRfmRoute,
  sequences: handleSequenceRoute,
  settlement: handleSettlementRoute,
  share: handleShareRoute,
  shifts: handleShiftsRoute,
  sso: handleSsoRoute,
  staff: handleStaffRoute,
  staffAlerts: handleStaffAlertsRoute,
  state: handleStateRoute,
  tables: handleTablesRoute,
  telegram: handleTelegramRoute,
  tips: handleTipsRoute,
  tokens: handleTokensRoute,
  venues: handleVenuesRoute,
  "venue-service-settings": handleVenueServiceSettingsRoute,
  "venue-profile": handleVenueProfileRoute,
  retail: handleRetailRoute,
  walkouts: handleWalkoutsRoute,
  whatsapp: handleWhatsappRoute,
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

/**
 * An API caller must never be handed an HTML error page: every client here does
 * `res.json()`, which then throws "Unexpected token '<'" and buries the real
 * failure. The request id is returned so a user can quote it and the log line be
 * found, rather than the error being unresolvable after the fact.
 */
function unhandledErrorResponse(request: Request, requestId: string): Response {
  if (!new URL(request.url).pathname.startsWith("/api/")) {
    return brandedErrorResponse();
  }
  return new Response(
    JSON.stringify({
      error: "Something went wrong on our side. Please try again.",
      requestId,
    }),
    { status: 500, headers: { "content-type": "application/json" } },
  );
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
export function withSecurityHeaders(
  response: Response,
  request: Request,
  env: unknown,
  requestId: string,
): Response {
  if (
    response.status === 101 ||
    (response as { webSocket?: unknown }).webSocket
  ) {
    return response;
  }
  const headers = new Headers(response.headers);
  const url = new URL(request.url);
  const sensitiveDocument =
    url.pathname === "/pay" || url.pathname.startsWith("/me/");
  // Correlation id: lets support tie a merchant-reported error to server logs.
  headers.set("X-Request-Id", requestId);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", sensitiveDocument ? "no-referrer" : "strict-origin-when-cross-origin");
  headers.set(
    "Strict-Transport-Security",
    "max-age=31536000; includeSubDomains",
  );
  headers.set("Permissions-Policy", "geolocation=(), microphone=(), camera=(self)");
  headers.set("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  headers.set("Cross-Origin-Resource-Policy", "same-origin");
  headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "script-src 'self' 'unsafe-inline' https://accounts.google.com https://challenges.cloudflare.com",
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self' data:",
      "img-src 'self' data: blob: https:",
      "connect-src 'self' https://api.pesaswap.io https://api.sandbox.pesaswap.io https://accounts.google.com https://challenges.cloudflare.com wss:",
      "frame-src https://accounts.google.com https://challenges.cloudflare.com",
      "worker-src 'self' blob:",
      "manifest-src 'self'",
      "upgrade-insecure-requests",
    ].join("; "),
  );
  if (sensitiveDocument) headers.set("Cache-Control", "no-store");
  // Lock cross-origin access to the app's own domain(s) when configured. Only
  // rewrites responses that already advertise CORS (an API "*"); leaves the
  // default open behavior untouched when CORS_ALLOWED_ORIGIN is unset.
  if (headers.has("Access-Control-Allow-Origin")) {
    const allowed = resolveCorsOrigin(request, env);
    if (allowed) {
      headers.set("Access-Control-Allow-Origin", allowed);
      if (allowed !== "*") headers.append("Vary", "Origin");
    } else {
      headers.delete("Access-Control-Allow-Origin");
      headers.delete("Access-Control-Allow-Credentials");
    }
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// /api/v1/* is a stable, versioned alias for /api/*, so third-party integrations
// can pin a version. Rewritten once, up front, so every handler serves both.
function rewriteApiVersion(request: Request): Request {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/v1/")) {
    url.pathname = "/api/" + url.pathname.slice("/api/v1/".length);
    return new Request(url.toString(), request);
  }
  return request;
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    // A correlation id threaded through logs, error reports and the response
    // header, so a single request can be traced end-to-end.
    const requestId = crypto.randomUUID();
    request = rewriteApiVersion(request);
    const requestUrl = new URL(request.url);
    const forwardedProto = request.headers.get("x-forwarded-proto");
    if (
      requestUrl.protocol === "http:" &&
      (forwardedProto === "http" || (env as { HYPERDRIVE?: unknown } | null)?.HYPERDRIVE)
    ) {
      requestUrl.protocol = "https:";
      return Response.redirect(requestUrl.toString(), 308);
    }
    const unsafeConfig = runtimeSecurityResponse(env);
    if (unsafeConfig) {
      return withSecurityHeaders(unsafeConfig, request, env, requestId);
    }
    const response = await withRequestSql(
      env,
      ctx as { waitUntil?: (promise: Promise<unknown>) => void },
      async () => {
        try {
          // Default-deny API inventory: reject unknown paths and wrong methods
          // before rate limiting, auth, handlers, or the SSR fallback. CORS
          // preflight is generated only for a declared browser route.
          const routeResponse = routePolicyResponse(
            request,
            resolveCorsOrigin(request, env),
          );
          if (routeResponse) return routeResponse;
          const matchedRoute = matchedRouteForRequest(request);
          if (matchedRoute) {
            const denied = await authorizeRouteRequest(
              request,
              env,
              matchedRoute.policy,
              matchedRoute.params,
              requestId,
            );
            if (denied) return denied;
          }

          // Abuse protection: rate-limit sensitive public endpoints first.
          const limited = await enforceRateLimit(request, env);
          if (limited) return limited;

          if (matchedRoute) {
            const apiHandler = API_HANDLERS[matchedRoute.policy.handler];
            if (!apiHandler) {
              throw new Error(
                `No API handler registered for ${matchedRoute.policy.handler}`,
              );
            }
            const apiResponse = await apiHandler(request, env, ctx);
            if (!apiResponse) {
              throw new Error(
                `Route ${matchedRoute.policy.id} was not handled by ${matchedRoute.policy.handler}`,
              );
            }
            return apiResponse;
          }

          // Fall through to TanStack Start SSR
          const handler = await getServerEntry();
          const response = await handler.fetch(request, env, ctx);
          return await normalizeCatastrophicSsrResponse(response);
        } catch (error) {
          console.error(`[req ${requestId}]`, error);
          void captureException(env, error, {
            requestId,
            url: new URL(request.url).pathname,
            method: request.method,
          });
          return unhandledErrorResponse(request, requestId);
        }
      },
    );
    return withSecurityHeaders(response, request, env, requestId);
  },
  async scheduled(
    _controller: unknown,
    env: unknown,
    ctx: { waitUntil?: (promise: Promise<unknown>) => void },
  ) {
    const work = withRequestSql(env, ctx, async () => {
      const sql = getSql(env);
      if (!sql) return;
        const safely = async (name: string, task: () => Promise<unknown>) => {
          try {
            await task();
          } catch (error) {
            console.error(`[scheduled:${name}]`, error);
          }
        };
        await safely("financial", () => runFinancialRecovery(env));
        await safely("channel-ingress", () => runIngressWorker(env));

        // Bounded slice + bounded concurrency. A serial loop over every venue is
        // O(venues) against a fixed invocation budget: it truncates silently,
        // always at the same end of the list. The cursor round-robins instead,
        // so every venue is serviced even when one pass cannot cover them all.
        const slice = await nextVenueSlice(sql, "venue-tasks", VENUE_SLICE);
        await mapWithConcurrency(slice.venueIds, VENUE_CONCURRENCY, async (venue) => {
          await safely(`sequences:${venue}`, () => runDueSteps(env, venue));
          // D5.8 — close the collection week, pay the direct stream, release
          // anything held for a staff member who has since added their details.
          await safely(`tips:${venue}`, () => runTipCadence(env, venue, "cron"));
          // C9.1 -> B2.8 — page the floor about an open check that has gone
          // quiet with money still on it, before the guests are out the door.
          await safely(`walkouts:${venue}`, () => runWalkoutDetection(env, venue));
        });
        await safely("cursor", () => saveVenueCursor(sql, "venue-tasks", slice));

        // C5.5 / C5.11 — keep the vendor-neutral check cache fresh and deliver
        // queued PesaSwap settlements through the mapped POS tender. Each tender
        // claim is leased, so cron and a manager's manual run may overlap safely.
        await safely("pos", () => runPosRecovery(sql, env));
        await safely("channel-outbound", () => runOutboundWorker(env));
    });
    if (ctx.waitUntil) ctx.waitUntil(work);
    else await work;
  },
};
