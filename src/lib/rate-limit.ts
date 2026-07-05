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
