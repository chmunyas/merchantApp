import type { ApiScope } from "@/lib/api-tokens";
import type { VenueRole } from "@/lib/tenancy";

export type HttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "OPTIONS";

export type RouteAccess =
  | "public"
  | "human-or-api-token"
  | "human-only"
  | "customer-token"
  | "service"
  | "webhook"
  | "cron-or-human"
  | "development";

export type TenantPolicy =
  | "global"
  | "principalVenue"
  | "publicSelector"
  | "publicOrPrincipalVenue"
  | "resourceToken"
  | "membershipTarget"
  | "organizationClaim"
  | "providerAccount"
  | "cronScope"
  | "adminTarget";

export type RouteSensitivity =
  | "public"
  | "operational"
  | "pii"
  | "financial"
  | "credential"
  | "platform";

export type RoutePolicy = {
  id: string;
  handler: string;
  methods: readonly Exclude<HttpMethod, "OPTIONS">[];
  path: string;
  access: RouteAccess;
  tenant: TenantPolicy;
  sensitivity: RouteSensitivity;
  minimumVenueRole?: VenueRole;
  scopes?: readonly ApiScope[];
  cors?: boolean;
};

export type MatchedRoute = {
  policy: RoutePolicy;
  params: Readonly<Record<string, string>>;
};

type CompiledRoute = {
  policy: RoutePolicy;
  regex: RegExp;
  params: readonly string[];
  order: number;
};

export const DYNAMIC_SEGMENTS: Readonly<Record<string, string>> = {
  uuid: "[0-9a-fA-F-]+",
  id: "(?!(?:summary|run|stats|payinfo|publish)$)[^/]+",
  token: "[A-Za-z0-9]+",
  hex: "[0-9a-fA-F]+",
  slug: "[^/]+",
  code: "[^/]+",
  channel: "(?:telegram|instagram|sms|email)",
  ingress: "(?:webhook|inbound)",
  action: "(?:paid|pay|remind|resend|void)",
};

function route(
  id: string,
  handler: string,
  methods: RoutePolicy["methods"],
  path: string,
  access: RouteAccess,
  tenant: TenantPolicy,
  sensitivity: RouteSensitivity,
  options: Pick<
    RoutePolicy,
    "minimumVenueRole" | "scopes" | "cors"
  > = {},
): RoutePolicy {
  return {
    id,
    handler,
    methods,
    path,
    access,
    tenant,
    sensitivity,
    cors: options.cors ?? false,
    ...options,
  };
}

const GET: RoutePolicy["methods"] = ["GET"];
const POST: RoutePolicy["methods"] = ["POST"];
const READ_WRITE: RoutePolicy["methods"] = ["GET", "POST"];

// Canonical inventory for every currently supported API and discovery route.
// Handler-local checks remain defense in depth while Phase 1 migrates action by
// action; this table is already authoritative for method/path dispatch.
export const ROUTE_POLICIES: readonly RoutePolicy[] = [
  route("a2a.card", "a2a", GET, "/.well-known/agent-card.json", "public", "global", "public", { cors: false }),
  route("a2a.card-alias", "a2a", GET, "/.well-known/agent.json", "public", "global", "public", { cors: false }),
  route("a2a.invoke", "a2a", POST, "/api/a2a", "human-or-api-token", "publicOrPrincipalVenue", "operational", { scopes: ["agent:invoke"], cors: true }),

  route("accounting.chart", "accounting", GET, "/api/accounting/chart", "human-or-api-token", "principalVenue", "financial", { minimumVenueRole: "manager", scopes: ["accounting:read"] }),
  route("accounting.trial-balance", "accounting", GET, "/api/accounting/trial-balance", "human-or-api-token", "principalVenue", "financial", { minimumVenueRole: "manager", scopes: ["accounting:read"] }),
  route("accounting.income-statement", "accounting", GET, "/api/accounting/income-statement", "human-or-api-token", "principalVenue", "financial", { minimumVenueRole: "manager", scopes: ["accounting:read"] }),
  route("accounting.balance-sheet", "accounting", GET, "/api/accounting/balance-sheet", "human-or-api-token", "principalVenue", "financial", { minimumVenueRole: "manager", scopes: ["accounting:read"] }),
  route("accounting.journal.read", "accounting", GET, "/api/accounting/journal", "human-or-api-token", "principalVenue", "financial", { minimumVenueRole: "manager", scopes: ["accounting:read"] }),
  route("accounting.journal.write", "accounting", POST, "/api/accounting/journal", "human-only", "principalVenue", "financial", { minimumVenueRole: "merchant" }),
  route("accounting.audit", "accounting", GET, "/api/accounting/audit", "human-only", "principalVenue", "financial", { minimumVenueRole: "merchant" }),
    route("accounting.checkpoints", "accounting", GET, "/api/accounting/checkpoints", "human-only", "principalVenue", "financial", { minimumVenueRole: "manager" }),
  route("accounting.ledger", "accounting", GET, "/api/accounting/ledger/:code", "human-or-api-token", "principalVenue", "financial", { minimumVenueRole: "manager", scopes: ["accounting:read"] }),
  route("accounting.ar-aging", "accounting", GET, "/api/accounting/ar-aging", "human-or-api-token", "principalVenue", "financial", { minimumVenueRole: "manager", scopes: ["accounting:read"] }),
  route("accounting.lost-basket", "accounting", GET, "/api/accounting/lost-basket", "human-or-api-token", "principalVenue", "financial", { minimumVenueRole: "manager", scopes: ["accounting:read"] }),
  route("accounting.summary", "accounting", GET, "/api/accounting/summary", "human-or-api-token", "principalVenue", "financial", { minimumVenueRole: "manager", scopes: ["accounting:read"] }),
  route("accounting.periods", "accounting", GET, "/api/accounting/periods", "human-or-api-token", "principalVenue", "financial", { minimumVenueRole: "manager", scopes: ["accounting:read"] }),
  route("accounting.period.close", "accounting", POST, "/api/accounting/period/close", "human-only", "principalVenue", "financial", { minimumVenueRole: "merchant" }),
  route("accounting.period.reopen", "accounting", POST, "/api/accounting/period/reopen", "human-only", "principalVenue", "financial", { minimumVenueRole: "merchant" }),

  route("admin.session", "admin", GET, "/api/admin/session", "human-only", "global", "platform"),
  route("admin.merchants", "admin", GET, "/api/admin/merchants", "human-only", "global", "platform"),

  route("agent.catalog", "agentcommerce", GET, "/api/agent/catalog", "public", "publicSelector", "public"),
  route("agent.checkout", "agentcommerce", POST, "/api/agent/checkout", "human-or-api-token", "principalVenue", "financial", { minimumVenueRole: "staff", scopes: ["agent:invoke", "payments:write", "menu:read"] }),
  route("agent.booking", "agentcommerce", POST, "/api/agent/booking", "human-or-api-token", "principalVenue", "pii", { minimumVenueRole: "staff", scopes: ["agent:invoke", "bookings:write"] }),
  route("agent.intent", "agentcommerce", POST, "/api/agent/intent", "human-or-api-token", "principalVenue", "financial", { minimumVenueRole: "staff", scopes: ["agent:invoke", "payments:write"] }),
  route("agent.intent.verify", "agentcommerce", POST, "/api/agent/intent/verify", "public", "global", "public"),

  route("ai.provider", "ai", GET, "/api/ai/provider", "human-only", "principalVenue", "operational", { minimumVenueRole: "merchant" }),
  route("ai.transcribe", "ai", POST, "/api/ai/transcribe", "human-or-api-token", "principalVenue", "pii", { minimumVenueRole: "staff", scopes: ["agent:invoke"] }),
  route("analytics.agent", "analytics", GET, "/api/analytics/agent", "human-or-api-token", "principalVenue", "pii", { minimumVenueRole: "manager", scopes: ["analytics:read"] }),

  ...[
    "login",
    "signup",
    "google",
    "otp/request",
    "otp/verify",
    "staff-login",
  ].map((suffix) => route(`auth.${suffix.replace("/", ".")}`, "auth", POST, `/api/auth/${suffix}`, "public", "global", "credential")),
  route("auth.google.config", "auth", GET, "/api/auth/google/config", "public", "global", "public"),
  route("auth.turnstile.config", "auth", GET, "/api/auth/turnstile/config", "public", "global", "public"),
  route("auth.session", "auth", POST, "/api/auth/session", "development", "global", "credential"),
  route("auth.sandbox-session", "auth", POST, "/api/auth/sandbox-session", "development", "global", "credential"),
  route("auth.refresh", "auth", POST, "/api/auth/refresh", "human-only", "principalVenue", "credential"),
  route("auth.switch-venue", "auth", POST, "/api/auth/switch-venue", "human-only", "membershipTarget", "credential"),
  route("auth.staff-switch-venue", "auth", POST, "/api/auth/staff-switch-venue", "human-only", "membershipTarget", "credential"),
  route("auth.me", "auth", GET, "/api/auth/me", "human-only", "principalVenue", "pii"),
  route("auth.totp.setup", "auth", POST, "/api/auth/totp/setup", "human-only", "principalVenue", "credential"),
  route("auth.totp.enable", "auth", POST, "/api/auth/totp/enable", "human-only", "principalVenue", "credential"),
  route("auth.totp.disable", "auth", POST, "/api/auth/totp/disable", "human-only", "principalVenue", "credential"),
  route("auth.password.set", "auth", POST, "/api/auth/password/set", "human-only", "principalVenue", "credential"),
  route("auth.password.admin", "auth", POST, "/api/auth/password", "human-only", "global", "credential"),

  route("sso.config", "sso", READ_WRITE, "/api/org/sso", "human-only", "organizationClaim", "credential"),
  route("sso.start", "sso", GET, "/api/auth/sso/:slug/start", "public", "global", "credential"),
  route("sso.callback", "sso", GET, "/api/auth/sso/callback", "public", "global", "credential"),

  route("health", "backend", GET, "/api/health", "public", "global", "public"),
  route("contacts.read", "backend", GET, "/api/contacts", "human-or-api-token", "principalVenue", "pii", { minimumVenueRole: "staff", scopes: ["contacts:read"] }),
  route("contacts.write", "backend", POST, "/api/contacts", "human-or-api-token", "principalVenue", "pii", { minimumVenueRole: "staff", scopes: ["contacts:write"] }),
  route("ai.command", "backend", POST, "/api/ai/command", "human-or-api-token", "principalVenue", "pii", { minimumVenueRole: "manager", scopes: ["agent:invoke"] }),
  route("enquiries.read", "backend", GET, "/api/enquiries", "human-or-api-token", "principalVenue", "pii", { minimumVenueRole: "staff", scopes: ["bookings:read"] }),
  route("enquiries.create", "backend", POST, "/api/enquiries", "public", "publicSelector", "pii"),
  route("memory.read", "backend", GET, "/api/memory", "human-or-api-token", "principalVenue", "pii", { minimumVenueRole: "manager", scopes: ["knowledge:read"] }),
  route("memory.write", "backend", POST, "/api/memory", "human-or-api-token", "principalVenue", "pii", { minimumVenueRole: "manager", scopes: ["knowledge:write"] }),

  route("billing.read", "billing", GET, "/api/billing", "human-only", "principalVenue", "financial", { minimumVenueRole: "merchant" }),
  route("billing.subscribe", "billing", POST, "/api/billing/subscribe", "human-only", "principalVenue", "financial", { minimumVenueRole: "merchant" }),
  route("billing.cancel", "billing", POST, "/api/billing/cancel", "human-only", "principalVenue", "financial", { minimumVenueRole: "merchant" }),
  route("billing.run", "billing", POST, "/api/billing/run", "cron-or-human", "cronScope", "financial"),

  route("branding.read", "branding", GET, "/api/branding", "public", "publicOrPrincipalVenue", "public"),
  route("branding.write", "branding", ["POST", "PUT"], "/api/branding", "human-only", "principalVenue", "operational", { minimumVenueRole: "merchant" }),
  route("manifest", "manifest", GET, "/api/manifest", "public", "publicSelector", "public", { cors: true }),

  route("broadcast.send", "broadcast", POST, "/api/broadcast", "human-or-api-token", "principalVenue", "pii", { minimumVenueRole: "manager", scopes: ["campaigns:write"] }),
  route("broadcast.history", "broadcast", GET, "/api/broadcast/history", "human-or-api-token", "principalVenue", "pii", { minimumVenueRole: "manager", scopes: ["campaigns:read"] }),

  route("channels.simulate", "channels", POST, "/api/channels/simulate", "development", "principalVenue", "pii", { minimumVenueRole: "manager" }),
  route("channels.run", "channelRecovery", POST, "/api/channels/run", "cron-or-human", "cronScope", "operational", { minimumVenueRole: "manager" }),
  route("channels.webhook.verify", "channels", GET, "/api/:channel/:ingress", "webhook", "providerAccount", "public"),
  route("channels.webhook.receive", "channels", POST, "/api/:channel/:ingress", "webhook", "providerAccount", "pii"),
  route("channels.account-webhook.verify", "channels", GET, "/api/channel-webhooks/:channel/:account", "webhook", "providerAccount", "public"),
  route("channels.account-webhook.receive", "channels", POST, "/api/channel-webhooks/:channel/:account", "webhook", "providerAccount", "pii"),

  route("copilot.invoke", "copilot", POST, "/api/copilot", "human-only", "principalVenue", "pii", { minimumVenueRole: "staff" }),
  route("payment-events.list", "disputes", GET, "/api/payment-events", "human-or-api-token", "principalVenue", "financial", { minimumVenueRole: "manager", scopes: ["payments:read"] }),
  route("disputes.list", "disputes", GET, "/api/disputes", "human-or-api-token", "principalVenue", "financial", { minimumVenueRole: "manager", scopes: ["payments:read"] }),
  route("disputes.get", "disputes", GET, "/api/disputes/:id", "human-or-api-token", "principalVenue", "financial", { minimumVenueRole: "manager", scopes: ["payments:read"] }),
  route("disputes.evidence", "disputes", POST, "/api/disputes/:id/evidence", "human-or-api-token", "principalVenue", "financial", { minimumVenueRole: "manager", scopes: ["payments:write"] }),
  route("disputes.accept", "disputes", POST, "/api/disputes/:id/accept", "human-or-api-token", "principalVenue", "financial", { minimumVenueRole: "manager", scopes: ["payments:write"] }),

  route("dlq.read", "dlq", GET, "/api/dlq", "human-or-api-token", "principalVenue", "pii", { minimumVenueRole: "manager", scopes: ["messaging:read"] }),
  route("dlq.retry", "dlq", POST, "/api/dlq/retry", "human-or-api-token", "principalVenue", "pii", { minimumVenueRole: "manager", scopes: ["messaging:write"] }),
  route("fees.config", "fees", GET, "/api/fees/config", "public", "global", "public"),
  route("fees.summary", "fees", GET, "/api/fees/summary", "human-or-api-token", "principalVenue", "financial", { minimumVenueRole: "manager", scopes: ["payments:read"] }),
  route("forecast", "forecast", GET, "/api/forecast", "human-or-api-token", "principalVenue", "financial", { minimumVenueRole: "manager", scopes: ["analytics:read"] }),

  // A5.2 / A5.3 — public guest self-service. Unauthenticated identity surfaces,
  // so every one of them is rate limited in RULES and answers uniformly whether
  // or not the contact is known to the venue.
  route("guest.venue", "guest", GET, "/api/guest/venue", "public", "publicSelector", "public"),
  route("guest.receipt-lookup", "guest", POST, "/api/guest/receipt-lookup", "public", "publicSelector", "pii"),
  route("guest.receipt-lookup.verify", "guest", POST, "/api/guest/receipt-lookup/verify", "public", "publicSelector", "credential"),
  // A5.4 — the merchant's refund-request queue. Reading and deciding are
  // manager+ and human-only; NEITHER moves money. `/api/refunds` is unchanged.
  route("guest.refund-requests.list", "guest", GET, "/api/refund-requests", "human-only", "principalVenue", "financial", { minimumVenueRole: "manager" }),
  route("guest.refund-requests.decide", "guest", ["PATCH"], "/api/refund-requests/:uuid", "human-only", "principalVenue", "financial", { minimumVenueRole: "manager" }),
  // A5.6 — data-subject requests. Manager+ to triage; the handler additionally
  // requires the venue owner before an erasure is executed.
  route("guest.data-requests.list", "guest", GET, "/api/data-requests", "human-only", "principalVenue", "pii", { minimumVenueRole: "manager" }),
  route("guest.data-requests.decide", "guest", ["PATCH"], "/api/data-requests/:uuid", "human-only", "principalVenue", "pii", { minimumVenueRole: "manager" }),

  route("inventory.list", "inventory", GET, "/api/inventory", "human-or-api-token", "principalVenue", "financial", { minimumVenueRole: "manager", scopes: ["inventory:read"] }),
  route("inventory.low", "inventory", GET, "/api/inventory/low", "human-or-api-token", "principalVenue", "financial", { minimumVenueRole: "manager", scopes: ["inventory:read"] }),
  route("inventory.reorder", "inventory", GET, "/api/inventory/reorder", "human-or-api-token", "principalVenue", "financial", { minimumVenueRole: "manager", scopes: ["inventory:read", "analytics:read"] }),
  route("inventory.create", "inventory", POST, "/api/inventory", "human-or-api-token", "principalVenue", "financial", { minimumVenueRole: "manager", scopes: ["inventory:write"] }),
  route("inventory.adjust", "inventory", POST, "/api/inventory/:uuid/adjust", "human-or-api-token", "principalVenue", "financial", { minimumVenueRole: "manager", scopes: ["inventory:write"] }),
  route("inventory.mutate", "inventory", ["PATCH", "DELETE"], "/api/inventory/:uuid", "human-or-api-token", "principalVenue", "financial", { minimumVenueRole: "manager", scopes: ["inventory:write"] }),
  route("retail.lookup", "retail", GET, "/api/retail/lookup", "human-or-api-token", "principalVenue", "operational", { minimumVenueRole: "staff", scopes: ["retail:read"] }),
  route("retail.sales.list", "retail", GET, "/api/retail/sales", "human-or-api-token", "principalVenue", "financial", { minimumVenueRole: "staff", scopes: ["retail:read"] }),
  route("retail.sales.create", "retail", POST, "/api/retail/sales", "human-or-api-token", "principalVenue", "financial", { minimumVenueRole: "staff", scopes: ["retail:write"] }),

  route("invoices.payinfo", "invoices", GET, "/api/invoices/payinfo", "public", "publicSelector", "financial"),
  route("invoices.list", "invoices", GET, "/api/invoices", "human-or-api-token", "principalVenue", "pii", { minimumVenueRole: "staff", scopes: ["invoices:read"] }),
  route("invoices.stats", "invoices", GET, "/api/invoices/stats", "human-or-api-token", "principalVenue", "financial", { minimumVenueRole: "manager", scopes: ["analytics:read"] }),
  route("invoices.create", "invoices", POST, "/api/invoices", "human-or-api-token", "principalVenue", "financial", { minimumVenueRole: "staff", scopes: ["invoices:write"] }),
  route("invoices.publish", "invoices", POST, "/api/invoices/publish", "human-or-api-token", "principalVenue", "financial", { minimumVenueRole: "manager", scopes: ["invoices:write"] }),
  route("invoices.activity", "invoices", GET, "/api/invoices/:id/activity", "human-or-api-token", "principalVenue", "pii", { minimumVenueRole: "staff", scopes: ["invoices:read"] }),
  route("invoices.action", "invoices", POST, "/api/invoices/:id/:action", "human-or-api-token", "principalVenue", "financial", { minimumVenueRole: "staff", scopes: ["invoices:write"] }),

  route("kb.list", "kb", GET, "/api/kb", "human-or-api-token", "principalVenue", "pii", { minimumVenueRole: "manager", scopes: ["knowledge:read"] }),
  route("kb.create", "kb", POST, "/api/kb", "human-or-api-token", "principalVenue", "pii", { minimumVenueRole: "manager", scopes: ["knowledge:write"] }),
  route("kb.search", "kb", POST, "/api/kb/search", "human-or-api-token", "principalVenue", "pii", { minimumVenueRole: "manager", scopes: ["knowledge:read"] }),
  route("kb.delete", "kb", ["DELETE"], "/api/kb/:id", "human-or-api-token", "principalVenue", "pii", { minimumVenueRole: "manager", scopes: ["knowledge:write"] }),
  route("keqr.read", "keqr", GET, "/api/ke-qr-config", "public", "global", "public"),
  route("keqr.write", "keqr", ["PUT"], "/api/ke-qr-config", "human-only", "global", "platform"),

  route("menu.read", "menu", GET, "/api/menu", "public", "publicOrPrincipalVenue", "public"),
  route("menu.live", "menu", GET, "/api/menu/live", "public", "publicOrPrincipalVenue", "public"),
  route("menu.recommend", "menu", POST, "/api/menu/recommend", "public", "publicSelector", "public"),
  route("menu.translate", "menu", POST, "/api/menu/translate", "public", "publicSelector", "public"),
  route("menu.settings.read", "menu", GET, "/api/menu/settings", "human-or-api-token", "principalVenue", "operational", { minimumVenueRole: "manager", scopes: ["menu:read"] }),
  route("menu.settings.write", "menu", ["PUT"], "/api/menu/settings", "human-or-api-token", "principalVenue", "operational", { minimumVenueRole: "manager", scopes: ["menu:write"] }),
  route("menu.menus.read", "menu", GET, "/api/menu/menus", "human-or-api-token", "principalVenue", "operational", { minimumVenueRole: "manager", scopes: ["menu:read"] }),
  route("menu.menus.create", "menu", POST, "/api/menu/menus", "human-or-api-token", "principalVenue", "operational", { minimumVenueRole: "manager", scopes: ["menu:write"] }),
  route("menu.menus.reorder", "menu", POST, "/api/menu/menus/reorder", "human-or-api-token", "principalVenue", "operational", { minimumVenueRole: "manager", scopes: ["menu:write"] }),
  route("menu.menus.mutate", "menu", ["PATCH", "DELETE"], "/api/menu/menus/:uuid", "human-or-api-token", "principalVenue", "operational", { minimumVenueRole: "manager", scopes: ["menu:write"] }),
  route("menu.engineering", "menu", GET, "/api/menu/engineering", "human-or-api-token", "principalVenue", "financial", { minimumVenueRole: "manager", scopes: ["menu:read", "analytics:read"] }),
  route("menu.item.create", "menu", POST, "/api/menu/item", "human-or-api-token", "principalVenue", "operational", { minimumVenueRole: "manager", scopes: ["menu:write"] }),
  route("menu.sync", "menu", POST, "/api/menu/sync", "human-or-api-token", "principalVenue", "operational", { minimumVenueRole: "manager", scopes: ["menu:write"] }),
  route("menu.item.mutate", "menu", ["PATCH", "DELETE"], "/api/menu/item/:uuid", "human-or-api-token", "principalVenue", "operational", { minimumVenueRole: "manager", scopes: ["menu:write"] }),
  route("menu.item.upsells.read", "menu", GET, "/api/menu/item/:uuid/upsells", "human-or-api-token", "principalVenue", "operational", { minimumVenueRole: "manager", scopes: ["menu:read"] }),
  route("menu.item.upsells.write", "menu", ["PUT"], "/api/menu/item/:uuid/upsells", "human-or-api-token", "principalVenue", "operational", { minimumVenueRole: "manager", scopes: ["menu:write"] }),
  route("menu.upsells.read", "menu", GET, "/api/menu/upsells", "human-or-api-token", "principalVenue", "operational", { minimumVenueRole: "manager", scopes: ["menu:read"] }),

  // C5.1 — POS connector framework. Connecting a POS decides where a venue's
  // money is recorded, so the write actions are owner-only AND human-only: a
  // personal access token has no business repointing a restaurant's till.
  route("pos.providers", "pos", GET, "/api/pos/providers", "human-or-api-token", "principalVenue", "operational", { minimumVenueRole: "manager", scopes: ["menu:read"] }),
  route("pos.connection.read", "pos", GET, "/api/pos/connection", "human-or-api-token", "principalVenue", "operational", { minimumVenueRole: "manager", scopes: ["menu:read"] }),
  route("pos.connection.write", "pos", ["PUT"], "/api/pos/connection", "human-only", "principalVenue", "operational", { minimumVenueRole: "merchant" }),
  route("pos.connection.disable", "pos", ["DELETE"], "/api/pos/connection", "human-only", "principalVenue", "operational", { minimumVenueRole: "merchant" }),
  route("pos.connection.verify", "pos", POST, "/api/pos/connection/verify", "human-only", "principalVenue", "operational", { minimumVenueRole: "merchant" }),
  route("pos.checks.read", "pos", GET, "/api/pos/checks", "human-or-api-token", "principalVenue", "operational", { minimumVenueRole: "staff", scopes: ["orders:read"] }),
  route("pos.checks.sync", "pos", POST, "/api/pos/checks/sync", "cron-or-human", "principalVenue", "operational", { minimumVenueRole: "manager", scopes: ["orders:write"] }),

  // C5.6 / C5.7 / C5.11 / B2.9. Mapping a POS tender decides which payment
  // method a venue's money is recorded under, so it is owner-only. The unsynced
  // list is staff-readable because the server is the one who has to act on it.
  route("pos.tenders.read", "pos", GET, "/api/pos/tenders", "human-or-api-token", "principalVenue", "operational", { minimumVenueRole: "manager", scopes: ["payments:read"] }),
  route("pos.tenders.write", "pos", ["PUT"], "/api/pos/tenders", "human-only", "principalVenue", "operational", { minimumVenueRole: "merchant" }),
  route("pos.pushes.read", "pos", GET, "/api/pos/pushes", "human-or-api-token", "principalVenue", "financial", { minimumVenueRole: "staff", scopes: ["payments:read"] }),
  route("pos.pushes.run", "pos", POST, "/api/pos/pushes/run", "cron-or-human", "principalVenue", "financial", { minimumVenueRole: "manager", scopes: ["payments:write"] }),
  route("pos.pushes.record", "pos", POST, "/api/pos/pushes/:uuid/record", "human-only", "principalVenue", "financial", { minimumVenueRole: "manager" }),
  route("pos.pushes.retry", "pos", POST, "/api/pos/pushes/:uuid/retry", "human-only", "principalVenue", "financial", { minimumVenueRole: "manager" }),

  route("venues.members", "multistore", ["GET", "POST", "DELETE"], "/api/venues/members", "human-only", "membershipTarget", "pii", { minimumVenueRole: "manager" }),
  route("venues.rollup", "multistore", GET, "/api/venues/rollup", "human-only", "membershipTarget", "financial", { minimumVenueRole: "manager" }),
  route("venues.list", "venues", GET, "/api/venues", "human-only", "membershipTarget", "pii"),
  route("venues.create", "venues", POST, "/api/venues", "human-only", "membershipTarget", "operational", { minimumVenueRole: "merchant" }),
  route("venue-service-settings.read", "venue-service-settings", GET, "/api/venue-service-settings", "human-only", "principalVenue", "operational", { minimumVenueRole: "merchant" }),
  route("venue-service-settings.write", "venue-service-settings", ["PUT"], "/api/venue-service-settings", "human-only", "principalVenue", "operational", { minimumVenueRole: "merchant" }),
  route("venue-profile.read", "venue-profile", GET, "/api/venue-profile", "human-only", "principalVenue", "operational", { minimumVenueRole: "staff" }),
  route("venue-profile.write", "venue-profile", ["PUT"], "/api/venue-profile", "human-only", "principalVenue", "operational", { minimumVenueRole: "merchant" }),

  // C9 walkout protection. Human-only end to end: a walkout is a financial-loss
  // record, and a PAT has no floor and no accountability. Reporting is staff+
  // (Sunday's flow runs from the staff app); the register and every resolution
  // are manager+; the detection threshold is owner configuration.
  route("walkouts.settings.read", "walkouts", GET, "/api/walkouts/settings", "human-only", "principalVenue", "operational", { minimumVenueRole: "merchant" }),
  route("walkouts.settings.write", "walkouts", ["PUT"], "/api/walkouts/settings", "human-only", "principalVenue", "operational", { minimumVenueRole: "merchant" }),
  route("walkouts.candidates", "walkouts", GET, "/api/walkouts/candidates", "human-only", "principalVenue", "financial", { minimumVenueRole: "staff" }),
  route("walkouts.list", "walkouts", GET, "/api/walkouts", "human-only", "principalVenue", "financial", { minimumVenueRole: "manager" }),
  route("walkouts.report", "walkouts", POST, "/api/walkouts", "human-only", "principalVenue", "financial", { minimumVenueRole: "staff" }),
  route("walkouts.resolve", "walkouts", ["PATCH"], "/api/walkouts/:uuid", "human-only", "principalVenue", "financial", { minimumVenueRole: "manager" }),

  route("chat.send", "omni", POST, "/api/chat", "public", "publicSelector", "pii"),
  route("chat.messages", "omni", GET, "/api/chat/messages", "customer-token", "resourceToken", "pii"),
  route("timeline", "omni", GET, "/api/timeline", "human-or-api-token", "principalVenue", "pii", { minimumVenueRole: "staff", scopes: ["messaging:read", "contacts:read"] }),

  route("openapi", "openapi", GET, "/api/openapi.json", "public", "global", "public", { cors: true }),
  route("docs", "openapi", GET, "/api/docs", "public", "global", "public"),

  // Platform operations. Cross-venue by nature — queue depth is a property of the
  // deployment, not of a tenant — so it is admin-only and `global`. A merchant
  // must never see another venue's backlog.
  route("ops.health", "ops", GET, "/api/ops/health", "human-only", "global", "platform"),

  route("orders.list", "orders", GET, "/api/orders", "human-or-api-token", "principalVenue", "operational", { minimumVenueRole: "staff", scopes: ["orders:read"] }),
  route("orders.create", "orders", POST, "/api/orders", "human-or-api-token", "principalVenue", "operational", { minimumVenueRole: "staff", scopes: ["orders:write"] }),
  route("orders.update", "orders", ["PATCH"], "/api/orders/:uuid", "human-or-api-token", "principalVenue", "operational", { minimumVenueRole: "staff", scopes: ["orders:write"] }),
  route("orders.pay-link", "orders", POST, "/api/orders/:uuid/pay-link", "human-or-api-token", "principalVenue", "financial", { minimumVenueRole: "staff", scopes: ["orders:write", "payments:write"] }),
  // B3.5 — resend the bill / receipt to the guest from the floor. The text and
  // the amount are composed server-side from the order; the caller only says
  // where to send it. Sending guest-addressed money copy is a staff action.
  route("orders.receipt", "orders", POST, "/api/orders/:uuid/receipt", "human-or-api-token", "principalVenue", "pii", { minimumVenueRole: "staff", scopes: ["orders:write"] }),

  route("org.public", "org", GET, "/api/org", "public", "global", "public"),
  route("org.create", "org", POST, "/api/org", "human-only", "global", "platform"),
  route("org.update", "org", ["PUT"], "/api/org", "human-only", "organizationClaim", "platform"),
  route("org.me", "org", GET, "/api/org/me", "human-only", "organizationClaim", "platform"),
  route("org.merchants", "org", READ_WRITE, "/api/org/merchants", "human-only", "organizationClaim", "platform"),
  route("org.analytics", "org", GET, "/api/org/analytics", "human-only", "organizationClaim", "financial"),
  route("org.ledger", "org", GET, "/api/org/ledger", "human-only", "organizationClaim", "financial"),
  route("org.invites", "org", READ_WRITE, "/api/org/invites", "human-only", "organizationClaim", "credential"),

  route("pay-links.resolve", "pay-links", GET, "/api/pay-links/:token", "customer-token", "resourceToken", "financial"),
  route("pay-links.list", "pay-links", GET, "/api/pay-links", "human-or-api-token", "principalVenue", "pii", { minimumVenueRole: "staff", scopes: ["payments:read"] }),
  route("pay-links.create", "pay-links", POST, "/api/pay-links", "human-or-api-token", "principalVenue", "financial", { minimumVenueRole: "staff", scopes: ["payments:write"] }),
  route("payment-methods.admin", "payment-methods-admin", GET, "/api/payment-methods", "human-or-api-token", "principalVenue", "pii", { minimumVenueRole: "manager", scopes: ["contacts:read", "payments:read"] }),

  route("payments.config", "payments", GET, "/api/payments/config", "public", "global", "public"),
  route("payments.intent", "payments", POST, "/api/payments/intent", "human-or-api-token", "principalVenue", "financial", { minimumVenueRole: "staff", scopes: ["payments:write"] }),
  route("financial-events.run", "payments", POST, "/api/financial-events/run", "cron-or-human", "cronScope", "financial"),
  route("financial-events.list", "payments", GET, "/api/financial-events", "human-only", "principalVenue", "financial", { minimumVenueRole: "manager" }),
  route("financial-events.retry", "payments", POST, "/api/financial-events/:uuid/retry", "human-only", "principalVenue", "financial", { minimumVenueRole: "manager" }),
  route("payments.create", "payments", POST, "/api/payments/create", "public", "publicSelector", "financial"),
  route("payments.list", "payments", GET, "/api/payments/list", "human-or-api-token", "principalVenue", "financial", { minimumVenueRole: "manager", scopes: ["payments:read"] }),
  route("payments.sync", "payments", POST, "/api/payments/sync", "human-or-api-token", "principalVenue", "financial", { minimumVenueRole: "manager", scopes: ["payments:write"] }),
  route("payments.capture", "payments", POST, "/api/payments/:id/capture", "human-or-api-token", "principalVenue", "financial", { minimumVenueRole: "manager", scopes: ["payments:write"] }),
  route("payments.retry", "payments", POST, "/api/payments/:id/retry", "human-or-api-token", "principalVenue", "financial", { minimumVenueRole: "manager", scopes: ["payments:write"] }),
  route("payments.status", "payments", GET, "/api/payments/:id/status", "customer-token", "resourceToken", "financial"),
  route("payments.refund", "payments", POST, "/api/refunds", "human-or-api-token", "principalVenue", "financial", { minimumVenueRole: "manager", scopes: ["payments:write"] }),
  route("payments.customer-methods", "payments", GET, "/api/customers/payment-methods", "customer-token", "resourceToken", "pii"),
  route("payments.webhook", "payments", POST, "/api/webhooks/pesaswap", "webhook", "providerAccount", "financial"),
  route("payments.notifications", "payments", GET, "/api/notifications", "human-only", "principalVenue", "financial", { minimumVenueRole: "staff" }),
  route("payments.realtime", "payments", GET, "/api/realtime", "human-only", "principalVenue", "financial", { minimumVenueRole: "staff" }),

  route("loyalty.status", "portal", GET, "/api/loyalty/status", "public", "publicSelector", "public"),
  route("portal.token", "portal", POST, "/api/portal/token", "public", "publicSelector", "credential"),
  route("portal.token.verify", "portal", POST, "/api/portal/token/verify", "public", "publicSelector", "credential"),
  route("portal.read", "portal", GET, "/api/portal/:token", "customer-token", "resourceToken", "financial"),
  route("portal.redeem", "portal", POST, "/api/portal/:token/redeem", "customer-token", "resourceToken", "financial"),
  // A5.4 / A5.6 — the guest ASKS. Neither route moves money nor deletes a row.
  route("portal.refund-request", "portal", POST, "/api/portal/:token/refund-request", "customer-token", "resourceToken", "financial"),
  route("portal.data-request", "portal", POST, "/api/portal/:token/data-request", "customer-token", "resourceToken", "pii"),
  route("portal.revoke", "portal", POST, "/api/portal/:token/revoke", "customer-token", "resourceToken", "credential"),
  route("rewards.list", "portal", GET, "/api/rewards", "human-or-api-token", "principalVenue", "operational", { minimumVenueRole: "manager", scopes: ["loyalty:read"] }),
  route("rewards.create", "portal", POST, "/api/rewards", "human-or-api-token", "principalVenue", "operational", { minimumVenueRole: "manager", scopes: ["loyalty:write"] }),
  route("rewards.mutate", "portal", ["PATCH", "DELETE"], "/api/rewards/:id", "human-or-api-token", "principalVenue", "operational", { minimumVenueRole: "manager", scopes: ["loyalty:write"] }),

  route("pricing", "pricing", GET, "/api/pricing", "human-or-api-token", "principalVenue", "financial", { minimumVenueRole: "manager", scopes: ["analytics:read", "menu:read"] }),
  route("promo.validate", "promo", GET, "/api/promo/validate", "public", "publicSelector", "public"),
  route("promo.list", "promo", GET, "/api/promo", "human-or-api-token", "principalVenue", "operational", { minimumVenueRole: "manager", scopes: ["campaigns:read"] }),
  route("promo.create", "promo", POST, "/api/promo", "human-or-api-token", "principalVenue", "operational", { minimumVenueRole: "manager", scopes: ["campaigns:write"] }),
  route("promo.mutate", "promo", ["PATCH", "DELETE"], "/api/promo/:uuid", "human-or-api-token", "principalVenue", "operational", { minimumVenueRole: "manager", scopes: ["campaigns:write"] }),

  route("push.vapid", "push", GET, "/api/push/vapid", "public", "global", "public"),
  route("push.subscribe", "push", POST, "/api/push/subscribe", "human-only", "principalVenue", "credential", { minimumVenueRole: "staff" }),
  route("push.latest", "push", GET, "/api/push/latest", "customer-token", "resourceToken", "pii"),
  route("push.test", "push", POST, "/api/push/test", "human-only", "principalVenue", "operational", { minimumVenueRole: "manager" }),

  route("qr.list", "qr", GET, "/api/qr", "human-or-api-token", "principalVenue", "operational", { minimumVenueRole: "manager", scopes: ["qr:read"] }),
  route("qr.create", "qr", POST, "/api/qr", "human-or-api-token", "principalVenue", "operational", { minimumVenueRole: "manager", scopes: ["qr:write"] }),
  route("qr.order", "qr", POST, "/api/qr/:uuid/order", "customer-token", "resourceToken", "financial"),
  route("qr.pay", "qr", GET, "/api/qr/pay/:hex", "customer-token", "resourceToken", "financial"),
  // A2.2/A2.4 — the guest's split-by-item surface. Authorised by possession of
  // the order's opaque single-use pay token, exactly like qr.pay: the token
  // resolves the venue and the bill, so nothing is trusted from the body.
  route("qr.pay.bill", "qr", GET, "/api/qr/pay/:hex/bill", "customer-token", "resourceToken", "financial"),
  route("qr.pay.claim", "qr", POST, "/api/qr/pay/:hex/claim", "customer-token", "resourceToken", "financial"),
  route("qr.pay.release", "qr", POST, "/api/qr/pay/:hex/release", "customer-token", "resourceToken", "financial"),
  route("qr.pay.live", "qr", GET, "/api/qr/pay/:hex/live", "customer-token", "resourceToken", "financial"),
  route("qr.resolve", "qr", GET, "/api/qr/:uuid", "customer-token", "resourceToken", "public"),

  route("invoicing.run", "recurring", POST, "/api/invoicing/run", "cron-or-human", "cronScope", "financial"),
  route("recurring.list", "recurring", GET, "/api/recurring", "human-or-api-token", "principalVenue", "financial", { minimumVenueRole: "manager", scopes: ["invoices:read"] }),
  route("recurring.create", "recurring", POST, "/api/recurring", "human-or-api-token", "principalVenue", "financial", { minimumVenueRole: "manager", scopes: ["invoices:write"] }),
  route("recurring.toggle", "recurring", POST, "/api/recurring/:id/toggle", "human-or-api-token", "principalVenue", "financial", { minimumVenueRole: "manager", scopes: ["invoices:write"] }),
  route("recurring.delete", "recurring", ["DELETE"], "/api/recurring/:id", "human-or-api-token", "principalVenue", "financial", { minimumVenueRole: "manager", scopes: ["invoices:write"] }),

  route("reports.summary", "reports", GET, "/api/reports/summary", "human-or-api-token", "principalVenue", "financial", { minimumVenueRole: "manager", scopes: ["analytics:read"] }),
  route("reviews.create", "reviews", POST, "/api/reviews", "public", "resourceToken", "pii"),
  route("reviews.prompt", "reviews", GET, "/api/reviews/prompt", "public", "publicSelector", "public"),
  route("reviews.list", "reviews", GET, "/api/reviews", "human-or-api-token", "principalVenue", "pii", { minimumVenueRole: "manager", scopes: ["reviews:read"] }),
  route("reviews.settings.read", "reviews", GET, "/api/reviews/settings", "human-or-api-token", "principalVenue", "operational", { minimumVenueRole: "manager", scopes: ["reviews:read"] }),
  route("reviews.settings.write", "reviews", ["PUT"], "/api/reviews/settings", "human-or-api-token", "principalVenue", "operational", { minimumVenueRole: "manager", scopes: ["reviews:write"] }),
  route("reviews.analytics", "reviews", GET, "/api/reviews/analytics", "human-or-api-token", "principalVenue", "pii", { minimumVenueRole: "manager", scopes: ["reviews:read"] }),
  route("reviews.templates.list", "reviews", GET, "/api/reviews/templates", "human-or-api-token", "principalVenue", "operational", { minimumVenueRole: "manager", scopes: ["reviews:read"] }),
  route("reviews.templates.create", "reviews", POST, "/api/reviews/templates", "human-or-api-token", "principalVenue", "operational", { minimumVenueRole: "manager", scopes: ["reviews:write"] }),
  route("reviews.templates.mutate", "reviews", ["PATCH", "DELETE"], "/api/reviews/templates/:uuid", "human-or-api-token", "principalVenue", "operational", { minimumVenueRole: "manager", scopes: ["reviews:write"] }),
  // Connecting a Google Business Profile mints an OAuth credential, so it is
  // owner-only and human-only: an API token must never start the dance.
  route("reviews.google.connect", "reviews", POST, "/api/reviews/google/connect", "human-only", "principalVenue", "credential", { minimumVenueRole: "merchant" }),
  route("reviews.google.callback", "reviews", GET, "/api/reviews/google/callback", "public", "resourceToken", "credential"),
  route("reviews.google.locations", "reviews", GET, "/api/reviews/google/locations", "human-only", "principalVenue", "credential", { minimumVenueRole: "merchant" }),
  route("reviews.google.sync", "reviews", POST, "/api/reviews/google/sync", "human-or-api-token", "principalVenue", "pii", { minimumVenueRole: "manager", scopes: ["reviews:write"] }),
  route("reviews.reply", "reviews", POST, "/api/reviews/:uuid/reply", "human-or-api-token", "principalVenue", "pii", { minimumVenueRole: "manager", scopes: ["reviews:write"] }),
  route("rfm", "rfm", GET, "/api/customers/rfm", "human-or-api-token", "principalVenue", "pii", { minimumVenueRole: "manager", scopes: ["analytics:read", "contacts:read"] }),

  route("sequences.list", "sequences", GET, "/api/sequences", "human-or-api-token", "principalVenue", "pii", { minimumVenueRole: "manager", scopes: ["campaigns:read"] }),
  route("sequences.create", "sequences", POST, "/api/sequences", "human-or-api-token", "principalVenue", "pii", { minimumVenueRole: "manager", scopes: ["campaigns:write"] }),
  route("sequences.enroll", "sequences", POST, "/api/sequences/enroll", "human-or-api-token", "principalVenue", "pii", { minimumVenueRole: "manager", scopes: ["campaigns:write"] }),
  route("sequences.run", "sequences", POST, "/api/sequences/run", "cron-or-human", "cronScope", "pii"),

  route("settlement.summary", "settlement", GET, "/api/settlement/summary", "human-or-api-token", "principalVenue", "financial", { minimumVenueRole: "manager", scopes: ["settlement:read"] }),
  route("settlement.list", "settlement", GET, "/api/settlement", "human-or-api-token", "principalVenue", "financial", { minimumVenueRole: "manager", scopes: ["settlement:read"] }),
  route("settlement.get", "settlement", GET, "/api/settlement/:id", "human-or-api-token", "principalVenue", "financial", { minimumVenueRole: "manager", scopes: ["settlement:read"] }),
  route("settlement.run", "settlement", POST, "/api/settlement/run", "human-or-api-token", "principalVenue", "financial", { minimumVenueRole: "manager", scopes: ["settlement:write"] }),
  route("settlement.evidence-import", "settlement", POST, "/api/settlement/evidence/import", "human-or-api-token", "principalVenue", "financial", { minimumVenueRole: "manager", scopes: ["settlement:write"] }),
  route("settlement.reconcile", "settlement", POST, "/api/settlement/reconcile", "human-or-api-token", "principalVenue", "financial", { minimumVenueRole: "manager", scopes: ["settlement:write"] }),
  route("share.send", "share", POST, "/api/share", "human-or-api-token", "principalVenue", "pii", { minimumVenueRole: "staff", scopes: ["messaging:write"] }),

  route("shifts.open", "shifts", POST, "/api/shifts/open", "human-or-api-token", "principalVenue", "financial", { minimumVenueRole: "staff", scopes: ["shifts:write"] }),
    route("shifts.current", "shifts", GET, "/api/shifts/current", "human-or-api-token", "principalVenue", "financial", { minimumVenueRole: "staff", scopes: ["shifts:read"] }),
    route("shifts.close", "shifts", POST, "/api/shifts/close", "human-or-api-token", "principalVenue", "financial", { minimumVenueRole: "staff", scopes: ["shifts:write"] }),
  route("shifts.list", "shifts", GET, "/api/shifts", "human-or-api-token", "principalVenue", "financial", { minimumVenueRole: "manager", scopes: ["shifts:read"] }),

  route("staff.my-venues", "staff", GET, "/api/staff/my-venues", "human-only", "membershipTarget", "pii"),
  route("staff.list", "staff", GET, "/api/staff", "human-only", "principalVenue", "pii", { minimumVenueRole: "manager" }),
  route("staff.create", "staff", POST, "/api/staff", "human-only", "principalVenue", "pii", { minimumVenueRole: "manager" }),
  route("staff.pin.reset", "staff", POST, "/api/staff/:uuid/pin/reset", "human-only", "principalVenue", "credential", { minimumVenueRole: "manager" }),
  route("staff.mutate", "staff", ["PATCH", "DELETE"], "/api/staff/:uuid", "human-only", "principalVenue", "pii", { minimumVenueRole: "manager" }),

  // B2.13/B2.14 — a server manages their OWN alert routing. Human-only: an API
  // token has no shift and no tables, so it must never steer a person's alerts.
  route("staff.alerts.settings", "staffAlerts", ["GET", "PUT"], "/api/staff-alerts/settings", "human-only", "principalVenue", "operational", { minimumVenueRole: "staff" }),
  route("staff.alerts.feed", "staffAlerts", GET, "/api/staff-alerts", "human-only", "principalVenue", "operational", { minimumVenueRole: "staff" }),
  route("staff.alerts.read", "staffAlerts", POST, "/api/staff-alerts/read", "human-only", "principalVenue", "operational", { minimumVenueRole: "staff" }),
  route("state.read", "state", GET, "/api/state", "human-only", "principalVenue", "pii", { minimumVenueRole: "merchant" }),
  route("state.write", "state", POST, "/api/state", "human-only", "principalVenue", "pii", { minimumVenueRole: "merchant" }),

  route("tables.list", "tables", GET, "/api/tables", "human-or-api-token", "principalVenue", "operational", { minimumVenueRole: "staff", scopes: ["tables:read"] }),
  // B3.1 — one table's recent payments, for a server standing at that table.
  // Payment data, so it carries `payments:read`, not `tables:read`. Staff-level
  // like the live payment feed they already receive; the response is redacted
  // (masked guest number, no provider references) and refunding stays manager+.
  route("tables.payments", "tables", GET, "/api/tables/:uuid/payments", "human-or-api-token", "principalVenue", "financial", { minimumVenueRole: "staff", scopes: ["payments:read"] }),
  route("tables.create", "tables", POST, "/api/tables", "human-or-api-token", "principalVenue", "operational", { minimumVenueRole: "manager", scopes: ["tables:write"] }),
  route("tables.mutate", "tables", ["PATCH", "DELETE"], "/api/tables/:uuid", "human-or-api-token", "principalVenue", "operational", { minimumVenueRole: "manager", scopes: ["tables:write"] }),

  route("telegram.config.read", "telegram", GET, "/api/telegram/config", "human-only", "principalVenue", "credential", { minimumVenueRole: "merchant" }),
  route("telegram.config.write", "telegram", POST, "/api/telegram/config", "human-only", "principalVenue", "credential", { minimumVenueRole: "merchant" }),
  route("telegram.status", "telegram", GET, "/api/telegram/status", "human-only", "principalVenue", "credential", { minimumVenueRole: "merchant" }),
  route("telegram.webhook.set", "telegram", POST, "/api/telegram/webhook/set", "human-only", "principalVenue", "credential", { minimumVenueRole: "merchant" }),
  route("telegram.webhook.delete", "telegram", POST, "/api/telegram/webhook/delete", "human-only", "principalVenue", "credential", { minimumVenueRole: "merchant" }),

  route("tips.read", "tips", GET, "/api/tips", "human-or-api-token", "principalVenue", "financial", { minimumVenueRole: "staff", scopes: ["tips:read"] }),
  route("tips.pool", "tips", POST, "/api/tips/pool/run", "human-or-api-token", "principalVenue", "financial", { minimumVenueRole: "manager", scopes: ["tips:write"] }),
  route("tips.report", "tips", GET, "/api/tips/report", "human-or-api-token", "principalVenue", "financial", { minimumVenueRole: "manager", scopes: ["tips:read"] }),
  route("tips.payout", "tips", POST, "/api/tips/payout", "human-only", "principalVenue", "financial", { minimumVenueRole: "manager" }),

  // D5.1/D5.2/D5.9 — the Tips tab. Reading who earned what is financial data, so
  // manager+ only; distributing the jar moves money, so manager+ with no exceptions.
  route("tips.collection", "tips", GET, "/api/tips/collection", "human-or-api-token", "principalVenue", "financial", { minimumVenueRole: "manager", scopes: ["tips:read"] }),
  route("tips.jar", "tips", GET, "/api/tips/jar", "human-or-api-token", "principalVenue", "financial", { minimumVenueRole: "manager", scopes: ["tips:read"] }),
  route("tips.jar.distribute", "tips", POST, "/api/tips/jar/distribute", "human-or-api-token", "principalVenue", "financial", { minimumVenueRole: "manager", scopes: ["tips:write"] }),
  route("tips.rules.read", "tips", GET, "/api/tips/rules", "human-or-api-token", "principalVenue", "financial", { minimumVenueRole: "manager", scopes: ["tips:read"] }),
  route("tips.rules.write", "tips", ["PUT"], "/api/tips/rules", "human-or-api-token", "principalVenue", "financial", { minimumVenueRole: "manager", scopes: ["tips:write"] }),
  // B4.1–B4.4 — a staff member's own earnings and their own payout destination.
  // Human-only: a PAT has no person behind it, so it must never read or rewrite
  // someone's bank details. The destination itself is credential-class.
  route("tips.me", "tips", GET, "/api/tips/me", "human-only", "principalVenue", "financial", { minimumVenueRole: "staff" }),
  // Step-up before a destination may be written: a code to the phone on the
  // staff record. Credential-class because issuing it reveals that a staff
  // member exists and targets their contact number.
  route("tips.me.payout-details.challenge", "tips", POST, "/api/tips/me/payout-details/challenge", "human-only", "principalVenue", "credential", { minimumVenueRole: "staff" }),
  route("tips.me.payout-details", "tips", ["PUT"], "/api/tips/me/payout-details", "human-only", "principalVenue", "credential", { minimumVenueRole: "staff" }),
  // D5.8 — the weekly cadence sweep, run by the scheduler or a manager.
  route("tips.weekly.run", "tips", POST, "/api/tips/weekly/run", "cron-or-human", "cronScope", "financial"),

  // Payout runs — the approval gate in front of every payment to a staff member,
  // for both tips and salaries. Human-only throughout: a personal access token
  // has no person behind it, and authorising a payment is exactly the act that
  // needs one. Every mutation is manager+ because each one moves money.
  route("payouts.runs.list", "payouts", GET, "/api/payouts/runs", "human-only", "principalVenue", "financial", { minimumVenueRole: "manager" }),
  route("payouts.runs.get", "payouts", GET, "/api/payouts/runs/:uuid", "human-only", "principalVenue", "financial", { minimumVenueRole: "manager" }),
  route("payouts.runs.approve", "payouts", POST, "/api/payouts/runs/:uuid/approve", "human-only", "principalVenue", "financial", { minimumVenueRole: "manager" }),
  route("payouts.runs.reject", "payouts", POST, "/api/payouts/runs/:uuid/reject", "human-only", "principalVenue", "financial", { minimumVenueRole: "manager" }),
  route("payouts.banks", "payouts", GET, "/api/payouts/banks", "human-only", "principalVenue", "operational", { minimumVenueRole: "staff" }),
  // Payroll — fixed salary per staff member, and the runs that pay it.
  route("payroll.staff.list", "payouts", GET, "/api/payroll/staff", "human-only", "principalVenue", "financial", { minimumVenueRole: "manager" }),
  route("payroll.staff.salary", "payouts", ["PUT"], "/api/payroll/staff/:uuid/salary", "human-only", "principalVenue", "financial", { minimumVenueRole: "manager" }),
  route("payroll.runs.preview", "payouts", GET, "/api/payroll/preview", "human-only", "principalVenue", "financial", { minimumVenueRole: "manager" }),
  route("payroll.runs.create", "payouts", POST, "/api/payroll/runs", "human-only", "principalVenue", "financial", { minimumVenueRole: "manager" }),

  route("tokens.list", "tokens", GET, "/api/tokens", "human-only", "principalVenue", "credential", { minimumVenueRole: "manager" }),
  route("tokens.create", "tokens", POST, "/api/tokens", "human-only", "principalVenue", "credential", { minimumVenueRole: "manager" }),
  route("tokens.revoke", "tokens", ["DELETE"], "/api/tokens/:id", "human-only", "principalVenue", "credential", { minimumVenueRole: "manager" }),

  route("whatsapp.bridge.inbound", "whatsapp", POST, "/api/whatsapp/bridge/inbound", "service", "providerAccount", "pii"),
  route("whatsapp.bridge.status", "whatsapp", GET, "/api/whatsapp/bridge/status", "human-only", "principalVenue", "credential", { minimumVenueRole: "merchant" }),
  route("whatsapp.bridge.qr", "whatsapp", GET, "/api/whatsapp/bridge/qr", "human-only", "principalVenue", "credential", { minimumVenueRole: "merchant" }),
  route("whatsapp.bridge.logout", "whatsapp", POST, "/api/whatsapp/bridge/logout", "human-only", "principalVenue", "credential", { minimumVenueRole: "merchant" }),
  route("whatsapp.config", "whatsapp", READ_WRITE, "/api/whatsapp/config", "human-only", "principalVenue", "credential", { minimumVenueRole: "merchant" }),
  route("whatsapp.test", "whatsapp", POST, "/api/whatsapp/test", "human-only", "principalVenue", "credential", { minimumVenueRole: "merchant" }),
  route("whatsapp.webhook.verify", "whatsapp", GET, "/api/whatsapp/webhook", "webhook", "providerAccount", "public"),
  route("whatsapp.webhook.receive", "whatsapp", POST, "/api/whatsapp/webhook", "webhook", "providerAccount", "pii"),
  route("whatsapp.simulate", "whatsapp", POST, "/api/whatsapp/simulate", "development", "principalVenue", "pii", { minimumVenueRole: "manager" }),
  route("whatsapp.conversations", "whatsapp", GET, "/api/whatsapp/conversations", "human-or-api-token", "principalVenue", "pii", { minimumVenueRole: "staff", scopes: ["messaging:read"] }),
  route("whatsapp.messages", "whatsapp", GET, "/api/whatsapp/messages", "human-or-api-token", "principalVenue", "pii", { minimumVenueRole: "staff", scopes: ["messaging:read"] }),
  route("whatsapp.reply", "whatsapp", POST, "/api/whatsapp/reply", "human-or-api-token", "principalVenue", "pii", { minimumVenueRole: "staff", scopes: ["messaging:write"] }),
] as const;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compile(policy: RoutePolicy, order: number): CompiledRoute {
  const params: string[] = [];
  const segments = policy.path.split("/").map((segment) => {
    if (!segment.startsWith(":")) return escapeRegex(segment);
    const name = segment.slice(1);
    params.push(name);
    return `(${DYNAMIC_SEGMENTS[name] ?? "[^/]+"})`;
  });
  return {
    policy,
    params,
    order,
    regex: new RegExp(`^${segments.join("/")}$`),
  };
}

const COMPILED = ROUTE_POLICIES.map((policy, order) => compile(policy, order));

// Every API request used to run all ~310 route regexes. Bucketing on the first
// segment after the prefix cuts that to a handful; routes whose segment is
// dynamic can match anything, so they stay in a list tested on every request.
function bucketKey(path: string): string | null {
  const segment = path.split("/")[2];
  if (!segment || segment.startsWith(":")) return null;
  return segment;
}

const ROUTE_BUCKETS = new Map<string, CompiledRoute[]>();
const UNBUCKETED: CompiledRoute[] = [];
for (const entry of COMPILED) {
  const key = bucketKey(entry.policy.path);
  if (key === null) {
    UNBUCKETED.push(entry);
    continue;
  }
  const existing = ROUTE_BUCKETS.get(key);
  if (existing) existing.push(entry);
  else ROUTE_BUCKETS.set(key, [entry]);
}

// Callers use `.find()` on the result, so declaration order has to survive.
function candidatesFor(pathname: string): readonly CompiledRoute[] {
  const key = bucketKey(pathname);
  const bucket = key === null ? undefined : ROUTE_BUCKETS.get(key);
  if (!bucket) return UNBUCKETED;
  if (UNBUCKETED.length === 0) return bucket;
  const merged: CompiledRoute[] = [];
  let i = 0;
  let j = 0;
  while (i < bucket.length && j < UNBUCKETED.length) {
    if (bucket[i].order < UNBUCKETED[j].order) merged.push(bucket[i++]);
    else merged.push(UNBUCKETED[j++]);
  }
  while (i < bucket.length) merged.push(bucket[i++]);
  while (j < UNBUCKETED.length) merged.push(UNBUCKETED[j++]);
  return merged;
}

export function routePolicyConflicts(): readonly string[] {
  const conflicts: string[] = [];
  for (let i = 0; i < COMPILED.length; i += 1) {
    for (let j = i + 1; j < COMPILED.length; j += 1) {
      const left = COMPILED[i].policy;
      const right = COMPILED[j].policy;
      const sharedMethods = left.methods.filter((method) =>
        right.methods.includes(method),
      );
      if (sharedMethods.length === 0) continue;
      const leftSample = left.path.replace(/:([A-Za-z]+)/g, (_all, name) => {
        if (name === "uuid") return "123e4567-e89b-12d3-a456-426614174000";
        if (name === "hex") return "abcdef012345";
        if (name === "channel") return "telegram";
        if (name === "ingress") return "webhook";
        if (name === "action") return "paid";
        return "sample";
      });
      const rightSample = right.path.replace(/:([A-Za-z]+)/g, (_all, name) => {
        if (name === "uuid") return "123e4567-e89b-12d3-a456-426614174000";
        if (name === "hex") return "abcdef012345";
        if (name === "channel") return "telegram";
        if (name === "ingress") return "webhook";
        if (name === "action") return "paid";
        return "sample";
      });
      if (
        COMPILED[i].regex.test(rightSample) ||
        COMPILED[j].regex.test(leftSample)
      ) {
        conflicts.push(
          `${sharedMethods.join("/")} ${left.id} overlaps ${right.id}`,
        );
      }
    }
  }
  return conflicts;
}

export function normalizeApiPath(pathname: string): string {
  return pathname.startsWith("/api/v1/")
    ? `/api/${pathname.slice("/api/v1/".length)}`
    : pathname;
}

export function matchRoutePath(pathname: string): readonly MatchedRoute[] {
  const normalized = normalizeApiPath(pathname);
  const matches: MatchedRoute[] = [];
  for (const entry of candidatesFor(normalized)) {
    const match = entry.regex.exec(normalized);
    if (!match) continue;
    const params: Record<string, string> = {};
    for (let i = 0; i < entry.params.length; i += 1) {
      params[entry.params[i]] = decodeURIComponent(match[i + 1]);
    }
    matches.push({ policy: entry.policy, params });
  }
  return matches;
}

export type RouteDecision =
  | { kind: "match"; route: MatchedRoute }
  | { kind: "method-not-allowed"; allow: readonly string[] }
  | { kind: "not-found" }
  | { kind: "not-api" };

export function decideRoute(method: string, pathname: string): RouteDecision {
  const normalized = normalizeApiPath(pathname);
  const isApi = normalized.startsWith("/api/");
  const isDiscovery = normalized.startsWith("/.well-known/");
  if (!isApi && !isDiscovery) return { kind: "not-api" };

  const matches = matchRoutePath(normalized);
  if (matches.length === 0) return { kind: "not-found" };

  if (method === "OPTIONS") {
    const browserRoute = matches.find((entry) => entry.policy.cors !== false);
    if (browserRoute) return { kind: "match", route: browserRoute };
  } else {
    const matched = matches.find((entry) => entry.policy.methods.includes(method as never));
    if (matched) return { kind: "match", route: matched };
  }

  const allow: string[] = Array.from(
    new Set(matches.flatMap((entry) => entry.policy.methods)),
  ).sort();
  if (matches.some((entry) => entry.policy.cors !== false)) allow.push("OPTIONS");
  return { kind: "method-not-allowed", allow };
}

export function routePolicyResponse(
  request: Request,
  corsOrigin: string | null = null,
): Response | null {
  const decision = decideRoute(request.method.toUpperCase(), new URL(request.url).pathname);
  if (decision.kind === "not-api" || decision.kind === "match") {
    if (decision.kind === "match" && request.method.toUpperCase() === "OPTIONS") {
      const allow = Array.from(new Set([...decision.route.policy.methods, "OPTIONS"]));
      if (request.headers.get("origin") && !corsOrigin) {
        return new Response(JSON.stringify({ error: "origin not allowed" }), {
          status: 403,
          headers: { "content-type": "application/json", vary: "Origin" },
        });
      }
      const headers = new Headers({
        allow: allow.join(", "),
        "access-control-allow-methods": allow.join(", "),
        "access-control-allow-headers":
          "Content-Type, Authorization, Idempotency-Key",
      });
      if (corsOrigin) {
        headers.set("access-control-allow-origin", corsOrigin);
        headers.set("vary", "Origin");
      }
      return new Response(null, {
        status: 204,
        headers,
      });
    }
    return null;
  }

  const headers = new Headers({
    "content-type": "application/json",
  });
  if (decision.kind === "method-not-allowed") {
    headers.set("allow", decision.allow.join(", "));
    return new Response(JSON.stringify({ error: "method not allowed" }), {
      status: 405,
      headers,
    });
  }
  return new Response(JSON.stringify({ error: "not found" }), {
    status: 404,
    headers,
  });
}

export function matchedRouteForRequest(request: Request): MatchedRoute | null {
  const decision = decideRoute(
    request.method.toUpperCase(),
    new URL(request.url).pathname,
  );
  return decision.kind === "match" ? decision.route : null;
}
