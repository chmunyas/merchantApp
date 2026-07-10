import { getSql } from "@/lib/db";

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
};

// Fixed-window counter backed by Postgres so it works across the worker pool.
// Fails open (never blocks) if the database is unavailable.
export async function rateLimit(
  env: unknown,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const sql = getSql(env);
  if (!sql) return { limited: false, remaining: limit, retryAfter: 0 };
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
    return { limited: false, remaining: limit, retryAfter: 0 };
  }
}

type Rule = { method: string; path: string; limit: number; window: number };

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
const RULES: Rule[] = [
  { method: "POST", path: "/api/auth/signup", limit: 5, window: 60 },
  { method: "POST", path: "/api/auth/login", limit: 10, window: 60 },
  { method: "POST", path: "/api/auth/session", limit: 30, window: 60 },
  { method: "POST", path: "/api/auth/google", limit: 10, window: 60 },
  { method: "POST", path: "/api/auth/password", limit: 5, window: 60 },
  { method: "POST", path: "/api/enquiries", limit: 10, window: 60 },
  { method: "POST", path: "/api/chat", limit: 20, window: 60 },
  { method: "POST", path: "/api/payments/create", limit: 10, window: 60 },
  { method: "POST", path: "/api/refunds", limit: 10, window: 60 },
  { method: "POST", path: "/api/a2a", limit: 30, window: 60 },
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
  const rule = RULES.find(
    (r) => r.method === request.method && r.path === url.pathname,
  );
  if (!rule) return null;
  const ip = clientIp(request);
  const result = await rateLimit(
    env,
    `${rule.method}:${rule.path}:${ip}`,
    rule.limit,
    rule.window,
  );
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