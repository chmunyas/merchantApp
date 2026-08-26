import { getSql } from "@/lib/db";
import { decideRoute } from "@/lib/route-policy";
import { bucketFor, shardFor } from "@/lib/rate-limit-shard";

// Best client IP: Cloudflare's CF-Connecting-IP, else the first X-Forwarded-For
// hop, else a stable "unknown" bucket.
export function clientIp(request: Request): string {
  const cf = request.headers.get("cf-connecting-ip");
  if (cf) return cf;
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

export type RateLimitResult = {
  limited: boolean;
  remaining: number;
  retryAfter: number;
  unavailable?: boolean;
};

type LimiterBinding = {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(request: Request): Promise<Response> };
};

/**
 * Sharded Durable Object counter — the primary path. Keeps the hottest check in
 * the system off the primary database entirely. Returns null when the binding is
 * absent (Node dev, tests) or the call fails, so the caller can fall back.
 */
async function rateLimitViaDurableObject(
  env: unknown,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult | null> {
  const binding = (env as { RATE_LIMITER?: LimiterBinding } | undefined)
    ?.RATE_LIMITER;
  if (!binding) return null;
  try {
    const shard = binding.get(binding.idFromName(shardFor(key)));
    const response = await shard.fetch(
      new Request("https://limiter/incr", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          key: bucketFor(key, windowSeconds, Date.now()),
          limit,
          windowSeconds,
        }),
      }),
    );
    if (!response.ok) return null;
    const body = (await response.json()) as {
      limited: boolean;
      remaining: number;
      retryAfter: number;
    };
    return {
      limited: Boolean(body.limited),
      remaining: Math.max(0, Number(body.remaining) || 0),
      retryAfter: Math.max(0, Number(body.retryAfter) || 0),
    };
  } catch {
    return null;
  }
}

// Fixed-window counter. Prefers the sharded Durable Object; falls back to the
// Postgres table where no binding exists (Node dev, tests, older deploys).
// Fails open (never blocks) if neither backend is available.
export async function rateLimit(
  env: unknown,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const viaDo = await rateLimitViaDurableObject(env, key, limit, windowSeconds);
  if (viaDo) return viaDo;

  const sql = getSql(env);
  if (!sql) {
    return {
      limited: false,
      remaining: limit,
      retryAfter: 0,
      unavailable: true,
    };
  }
  const windowId = Math.floor(Date.now() / (windowSeconds * 1000));
  const bucket = `${key}:${windowId}`;
  const expiresAt = new Date((windowId + 1) * windowSeconds * 1000);
  try {
    const [row] = await sql`
      INSERT INTO rate_limits (bucket, count, expires_at)
      VALUES (${bucket}, 1, ${expiresAt})
      ON CONFLICT (bucket)
      DO UPDATE SET count = rate_limits.count + 1
      RETURNING count`;
    const count = Number(row?.count ?? 1);
    // Opportunistic cleanup of expired buckets (~2% of calls).
    if (Math.random() < 0.02) {
      await sql`DELETE FROM rate_limits WHERE expires_at < now()`;
    }
    if (count > limit) {
      const nextWindow = (windowId + 1) * windowSeconds * 1000;
      return {
        limited: true,
        remaining: 0,
        retryAfter: Math.max(1, Math.ceil((nextWindow - Date.now()) / 1000)),
      };
    }
    return { limited: false, remaining: limit - count, retryAfter: 0 };
  } catch {
    return {
      limited: false,
      remaining: limit,
      retryAfter: 0,
      unavailable: true,
    };
  }
}

export type Rule = {
  id: string;
  method: string;
  path: string;
  limit: number;
  window: number;
  failClosed: boolean;
};

// True only when DISABLE_RATE_LIMIT is explicitly set (on the Workers env binding
// or, in Node dev, process.env). Used exclusively by the E2E job — production
// leaves it unset, so the limits below always apply there.
function rateLimitDisabled(env: unknown): boolean {
  const e = (env ?? {}) as Record<string, unknown>;
  const raw =
    (typeof e.DISABLE_RATE_LIMIT === "string"
      ? (e.DISABLE_RATE_LIMIT as string)
      : undefined) ??
    (typeof process !== "undefined"
      ? process.env?.DISABLE_RATE_LIMIT
      : undefined);
  return (
    raw != null &&
    raw !== "" &&
    raw !== "0" &&
    String(raw).toLowerCase() !== "false"
  );
}

// Public/unauthenticated endpoints that mutate or cost money/compute. Tight
// limits blunt credential-stuffing, signup spam and AI/payment abuse.
export const RULES: readonly Rule[] = [
  { id: "auth.signup", method: "POST", path: "/api/auth/signup", limit: 5, window: 60, failClosed: true },
  { id: "auth.login", method: "POST", path: "/api/auth/login", limit: 10, window: 60, failClosed: true },
  { id: "auth.session", method: "POST", path: "/api/auth/session", limit: 30, window: 60, failClosed: true },
  { id: "auth.google", method: "POST", path: "/api/auth/google", limit: 10, window: 60, failClosed: true },
  { id: "auth.otp.request", method: "POST", path: "/api/auth/otp/request", limit: 10, window: 60, failClosed: true },
  { id: "auth.otp.verify", method: "POST", path: "/api/auth/otp/verify", limit: 20, window: 60, failClosed: true },
  { id: "auth.staff-login", method: "POST", path: "/api/auth/staff-login", limit: 10, window: 60, failClosed: true },
  { id: "auth.password.admin", method: "POST", path: "/api/auth/password", limit: 5, window: 60, failClosed: true },
  { id: "enquiries.create", method: "POST", path: "/api/enquiries", limit: 10, window: 60, failClosed: true },
  { id: "chat.send", method: "POST", path: "/api/chat", limit: 20, window: 60, failClosed: true },
  { id: "payments.create", method: "POST", path: "/api/payments/create", limit: 10, window: 60, failClosed: true },
  { id: "payments.status", method: "GET", path: "/api/payments/:id/status", limit: 60, window: 60, failClosed: true },
  { id: "payments.refund", method: "POST", path: "/api/refunds", limit: 10, window: 60, failClosed: true },
  { id: "portal.token", method: "POST", path: "/api/portal/token", limit: 5, window: 900, failClosed: true },
  { id: "portal.token.verify", method: "POST", path: "/api/portal/token/verify", limit: 15, window: 900, failClosed: true },
  { id: "portal.redeem", method: "POST", path: "/api/portal/:token/redeem", limit: 5, window: 600, failClosed: true },
  { id: "portal.refund-request", method: "POST", path: "/api/portal/:token/refund-request", limit: 5, window: 3600, failClosed: true },
  { id: "portal.data-request", method: "POST", path: "/api/portal/:token/data-request", limit: 5, window: 3600, failClosed: true },
  { id: "guest.venue", method: "GET", path: "/api/guest/venue", limit: 20, window: 300, failClosed: true },
  { id: "guest.receipt-lookup", method: "POST", path: "/api/guest/receipt-lookup", limit: 5, window: 900, failClosed: true },
  { id: "guest.receipt-lookup.verify", method: "POST", path: "/api/guest/receipt-lookup/verify", limit: 15, window: 900, failClosed: true },
  { id: "portal.revoke", method: "POST", path: "/api/portal/:token/revoke", limit: 5, window: 600, failClosed: true },
  { id: "qr.order", method: "POST", path: "/api/qr/:uuid/order", limit: 15, window: 60, failClosed: true },
  { id: "reviews.create", method: "POST", path: "/api/reviews", limit: 10, window: 60, failClosed: true },
  { id: "reviews.google.callback", method: "GET", path: "/api/reviews/google/callback", limit: 20, window: 300, failClosed: true },
  { id: "agent.checkout", method: "POST", path: "/api/agent/checkout", limit: 10, window: 60, failClosed: true },
  { id: "agent.booking", method: "POST", path: "/api/agent/booking", limit: 10, window: 60, failClosed: true },
  { id: "agent.intent", method: "POST", path: "/api/agent/intent", limit: 20, window: 60, failClosed: true },
  { id: "ai.transcribe", method: "POST", path: "/api/ai/transcribe", limit: 10, window: 60, failClosed: true },
  { id: "menu.translate", method: "POST", path: "/api/menu/translate", limit: 10, window: 60, failClosed: true },
  { id: "a2a.invoke", method: "POST", path: "/api/a2a", limit: 30, window: 60, failClosed: true },
];

// Central rate-limit gate. Returns a 429 Response when a matching public route
// is over its limit, else null (allow). Call early in the request pipeline.
export async function enforceRateLimit(
  request: Request,
  env: unknown,
): Promise<Response | null> {
  // E2E / load-test escape hatch. The CI e2e job drives every public endpoint
  // (signup, login, payments…) from a SINGLE IP in seconds, so the per-IP limits
  // would spuriously 429 legitimate test traffic. Gated on an explicit env flag
  // that is NEVER set in production, so real abuse protection is untouched.
  if (rateLimitDisabled(env)) return null;
  const url = new URL(request.url);
  const decision = decideRoute(request.method, url.pathname);
  const routeId = decision.kind === "match" ? decision.route.policy.id : null;
  const rule = RULES.find(
    (r) =>
      r.method === request.method &&
      (r.id === routeId || r.path === url.pathname),
  );
  if (!rule) return null;
  const ip = clientIp(request);
  const result = await rateLimit(
    env,
    `${rule.method}:${rule.id}:${ip}`,
    rule.limit,
    rule.window,
  );
  if (result.unavailable && rule.failClosed) {
    return new Response(
      JSON.stringify({ error: "Rate-limit service unavailable." }),
      {
        status: 503,
        headers: {
          "content-type": "application/json",
          "access-control-allow-origin": "*",
          "cache-control": "no-store",
        },
      },
    );
  }
  if (!result.limited) return null;
  return new Response(
    JSON.stringify({ error: "Too many requests. Please slow down." }),
    {
      status: 429,
      headers: {
        "content-type": "application/json",
        "retry-after": String(result.retryAfter),
        "access-control-allow-origin": "*",
      },
    },
  );
}

// Per-account (tenant) limiter for AUTHENTICATED, expensive endpoints (AI calls,
// bulk sends), keyed by the account id (venue/org) rather than the IP — so one
// tenant hammering an endpoint can't exhaust it for everyone, and a shared-office
// IP isn't collectively throttled. Returns a 429 Response when over the limit,
// else null. Honors the same DISABLE_RATE_LIMIT E2E escape hatch. Fails open.
export async function enforceAccountRateLimit(
  env: unknown,
  account: string,
  action: string,
  limit: number,
  windowSeconds: number,
): Promise<Response | null> {
  const limited = await isAccountRateLimited(
    env,
    account,
    action,
    limit,
    windowSeconds,
  );
  if (!limited) return null;
  return new Response(
    JSON.stringify({
      error: "This account is sending too fast. Please slow down.",
    }),
    {
      status: 429,
      headers: {
        "content-type": "application/json",
        "retry-after": "30",
        "access-control-allow-origin": "*",
      },
    },
  );
}

// Boolean form of the per-account limiter, for callers that render their own
// over-limit response (e.g. the copilot chat, which must always reply in its own
// { reply } shape). Fails open and honors the DISABLE_RATE_LIMIT escape hatch.
export async function isAccountRateLimited(
  env: unknown,
  account: string,
  action: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  if (rateLimitDisabled(env)) return false;
  if (!account) return false;
  const result = await rateLimit(
    env,
    `acct:${action}:${account}`,
    limit,
    windowSeconds,
  );
  return result.limited;
}