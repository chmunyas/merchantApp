import { getSql } from "@/lib/db";
import { envVar } from "@/lib/env";
import { hashPassword, signJwt, verifyJwt, verifyPassword } from "@/lib/jwt";
import { venueFromPayload } from "@/lib/tenancy";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders },
  });
}

type AuthConfig = {
  secret: string;
  adminEmail: string;
  adminPasswordHash: string;
};

function randomSecret(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function truthyEnv(value: string | undefined): boolean {
  if (!value) return false;
  return value !== "0" && value.toLowerCase() !== "false";
}

// Auth config: JWT secret + the admin credential. Generated + seeded once into
// app_settings; overridable in production via JWT_SECRET / ADMIN_EMAIL /
// ADMIN_PASSWORD env vars.
async function getAuthConfig(env: unknown): Promise<AuthConfig | null> {
  const sql = getSql(env);
  if (!sql) return null;
  const [row] = await sql`SELECT value FROM app_settings WHERE key = 'auth'`;
  let cfg = row?.value as AuthConfig | undefined;
  if (!cfg?.secret) {
    // No hardcoded default admin password in production: when ADMIN_PASSWORD is
    // unset on a real deploy (detected via the HYPERDRIVE binding) seed an
    // unguessable random secret so a public deploy never ships a known default.
    const isProd = Boolean((env as { HYPERDRIVE?: unknown } | null)?.HYPERDRIVE);
    const seeded: AuthConfig = {
      secret: randomSecret(),
      adminEmail: envVar(env, "ADMIN_EMAIL") ?? "admin@pesaswap.io",
      adminPasswordHash: await hashPassword(
        envVar(env, "ADMIN_PASSWORD") ??
          (isProd ? randomSecret() : "pesaswap-admin"),
      ),
    };
    await sql`
      INSERT INTO app_settings (key, value) VALUES ('auth', ${sql.json(seeded)})
      ON CONFLICT (key) DO NOTHING`;
    const [again] = await sql`SELECT value FROM app_settings WHERE key = 'auth'`;
    cfg = (again?.value as AuthConfig | undefined) ?? seeded;
  }
  const envSecret = envVar(env, "JWT_SECRET");
  if (envSecret) cfg = { ...cfg, secret: envSecret };
  const envAdminEmail = envVar(env, "ADMIN_EMAIL");
  if (envAdminEmail) cfg = { ...cfg, adminEmail: envAdminEmail };
  return cfg;
}

// Verify a Bearer JWT on a request. Returns the payload or null. Reusable by any
// route that needs to be protected.
export async function requireAuth(
  request: Request,
  env: unknown,
): Promise<Record<string, unknown> | null> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return null;
  const cfg = await getAuthConfig(env);
  if (!cfg) return null;
  return verifyJwt(token, cfg.secret);
}

// Tenant isolation + plan-limit helpers live in lib/tenancy (pure, testable);
// re-exported here so route handlers keep importing them from "@/api/auth".
export { PLAN_LIMITS, planOf, venueFromPayload } from "@/lib/tenancy";
// Optional-auth venue resolver for endpoints that aren't gated (reads / public):
// pins to the token's venue when present, otherwise uses the query param.
export async function resolveVenue(
  request: Request,
  env: unknown,
  url: URL,
): Promise<string> {
  const payload = await requireAuth(request, env);
  return venueFromPayload(payload, url);
}

// Role gate: returns the payload only if the token carries one of the allowed
// roles (RBAC). Reusable for platform-admin-only or role-scoped endpoints.
export async function requireRole(
  request: Request,
  env: unknown,
  roles: string[],
): Promise<Record<string, unknown> | null> {
  const payload = await requireAuth(request, env);
  if (!payload) return null;
  const role = typeof payload.role === "string" ? payload.role : null;
  return role && roles.includes(role) ? payload : null;
}

export async function handleAuthRoute(
  request: Request,
  env: unknown,
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith("/api/auth")) return null;

  if (path === "/api/auth/login" && request.method === "POST") {
    const cfg = await getAuthConfig(env);
    if (!cfg) return json({ error: "auth unavailable" }, 503);
    const body = (await request.json()) as { email?: string; password?: string };
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    // Platform admin (seeded in app_settings.auth).
    if (
      email === cfg.adminEmail.toLowerCase() &&
      (await verifyPassword(password, cfg.adminPasswordHash))
    ) {
      const token = await signJwt(
        { sub: email, role: "admin", name: "Admin" },
        cfg.secret,
      );
      return json({ token, user: { email, role: "admin", name: "Admin" } });
    }
    // Self-serve merchant accounts (app_users).
    const sql = getSql(env);
    if (sql) {
      try {
        const [user] = await sql`
          SELECT email, password_hash, name, venue_id, role, plan, org_id
          FROM app_users WHERE lower(email) = ${email} LIMIT 1`;
        if (
          user &&
          (await verifyPassword(password, String(user.password_hash)))
        ) {
          const token = await signJwt(
            {
              sub: String(user.email),
              role: String(user.role),
              name: user.name ?? undefined,
              venue: user.venue_id ?? undefined,
              plan: (user.plan as string) ?? "free",
              org: (user.org_id as string) ?? undefined,
            },
            cfg.secret,
          );
          return json({
            token,
            user: {
              email: user.email,
              role: user.role,
              name: user.name,
              venue: user.venue_id,
              plan: (user.plan as string) ?? "free",
              org: (user.org_id as string) ?? null,
            },
          });
        }
      } catch {
        /* app_users not provisioned — fall through */
      }
    }
    return json({ error: "invalid credentials" }, 401);
  }

  // Self-serve signup: creates a venue + merchant account and returns a JWT.
  if (path === "/api/auth/signup" && request.method === "POST") {
    if (truthyEnv(envVar(env, "AUTH_DISABLE_SIGNUP"))) {
      return json({ error: "signups are disabled" }, 403);
    }
    const cfg = await getAuthConfig(env);
    const sql = getSql(env);
    if (!cfg || !sql) return json({ error: "auth unavailable" }, 503);
    const body = (await request.json()) as {
      businessName?: string;
      email?: string;
      password?: string;
      phone?: string;
      org?: string;
    };
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const businessName = String(body.businessName ?? "").trim();
    if (!email || !email.includes("@")) {
      return json({ error: "A valid email is required." }, 400);
    }
    if (password.length < 8) {
      return json({ error: "Password must be at least 8 characters." }, 400);
    }
    if (!businessName) {
      return json({ error: "Business name is required." }, 400);
    }
    if (email === cfg.adminEmail.toLowerCase()) {
      return json({ error: "That email is reserved." }, 409);
    }
    try {
      const [existing] = await sql`
        SELECT id FROM app_users WHERE lower(email) = ${email} LIMIT 1`;
      if (existing) {
        return json(
          { error: "An account with this email already exists." },
          409,
        );
      }
      // Optional reseller attach: a merchant signing up under a bank's slug is
      // linked to that org (and inherits its co-brand via the branding join).
      let orgId: string | null = null;
      if (body.org) {
        const [org] = await sql`
          SELECT id FROM organizations
          WHERE slug = ${String(body.org).toLowerCase()} AND active = true
          LIMIT 1`;
        orgId = (org?.id as string) ?? null;
      }
      const venueId = `v_${crypto.randomUUID().slice(0, 8)}`;
      const code =
        businessName.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase() ||
        "VEN";
      await sql`
        INSERT INTO venues (id, name, code, active, org_id)
        VALUES (${venueId}, ${businessName}, ${code}, true, ${orgId})`;
      const passwordHash = await hashPassword(password);
      await sql`
        INSERT INTO app_users (email, password_hash, name, phone, venue_id, role, plan, org_id)
        VALUES (${email}, ${passwordHash}, ${businessName},
                ${body.phone?.trim() || null}, ${venueId}, 'merchant', 'free', ${orgId})`;
      const token = await signJwt(
        {
          sub: email,
          role: "merchant",
          name: businessName,
          venue: venueId,
          plan: "free",
          org: orgId ?? undefined,
        },
        cfg.secret,
      );
      return json(
        {
          token,
          user: {
            email,
            role: "merchant",
            name: businessName,
            venue: venueId,
            plan: "free",
            org: orgId,
          },
        },
        201,
      );
    } catch {
      return json({ error: "Could not create your account." }, 500);
    }
  }

  if (path === "/api/auth/me" && request.method === "GET") {
    const payload = await requireAuth(request, env);
    if (!payload) return json({ error: "unauthorized" }, 401);
    return json({ user: payload });
  }

  // Change the platform admin password — admin role only (RBAC).
  if (path === "/api/auth/password" && request.method === "POST") {
    const payload = await requireAuth(request, env);
    if (!payload) return json({ error: "unauthorized" }, 401);
    if (payload.role !== "admin") return json({ error: "forbidden" }, 403);
    const sql = getSql(env);
    const cfg = await getAuthConfig(env);
    if (!sql || !cfg) return json({ error: "unavailable" }, 503);
    const body = (await request.json()) as { newPassword?: string };
    if (!body.newPassword || body.newPassword.length < 6) {
      return json({ error: "password too short" }, 400);
    }
    const next: AuthConfig = {
      ...cfg,
      adminPasswordHash: await hashPassword(body.newPassword),
    };
    await sql`
      INSERT INTO app_settings (key, value) VALUES ('auth', ${sql.json(next)})
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
    return json({ ok: true });
  }

  // Public: the Google client id for the sign-in button (null if unconfigured).
  if (path === "/api/auth/google/config" && request.method === "GET") {
    return json({ clientId: envVar(env, "GOOGLE_CLIENT_ID") ?? null });
  }

  // Exchange a verified Google ID token for our JWT.
  if (path === "/api/auth/google" && request.method === "POST") {
    const cfg = await getAuthConfig(env);
    if (!cfg) return json({ error: "auth unavailable" }, 503);
    const body = (await request.json()) as { idToken?: string };
    const idToken = String(body.idToken ?? "");
    if (!idToken) return json({ error: "idToken required" }, 400);
    try {
      const res = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
      );
      if (!res.ok) return json({ error: "invalid google token" }, 401);
      const info = (await res.json()) as {
        email?: string;
        email_verified?: string | boolean;
        name?: string;
        picture?: string;
        aud?: string;
      };
      const clientId = envVar(env, "GOOGLE_CLIENT_ID");
      if (clientId && info.aud !== clientId) {
        return json({ error: "wrong audience" }, 401);
      }
      const verified =
        info.email_verified === true || info.email_verified === "true";
      if (!info.email || !verified) {
        return json({ error: "email not verified" }, 401);
      }
      // Optional allowlist of Google emails granted access.
      const allow = envVar(env, "GOOGLE_ALLOWED_EMAILS");
      if (
        allow &&
        !allow
          .split(",")
          .map((e) => e.trim().toLowerCase())
          .includes(info.email.toLowerCase())
      ) {
        return json({ error: "email not permitted" }, 403);
      }
      const role = info.email.toLowerCase() === cfg.adminEmail.toLowerCase()
        ? "admin"
        : "merchant";
      const token = await signJwt(
        { sub: info.email, role, name: info.name ?? info.email },
        cfg.secret,
      );
      return json({
        token,
        user: {
          email: info.email,
          name: info.name,
          picture: info.picture,
          role,
        },
      });
    } catch {
      return json({ error: "google verification failed" }, 500);
    }
  }

  // Dashboard session bootstrap. The SPA still uses demo-role logins that carry
  // no password, so this mints a short-scoped, non-admin JWT that lets the back
  // office call the protected endpoints. It never issues an admin token (admin
  // requires the credentialed /login or Google). Set AUTH_REQUIRE_LOGIN to
  // disable it in production and force a real login for every operator.
  if (path === "/api/auth/session" && request.method === "POST") {
    const lock = envVar(env, "AUTH_REQUIRE_LOGIN");
    if (lock && lock !== "0" && lock.toLowerCase() !== "false") {
      return json({ error: "login required" }, 403);
    }
    const cfg = await getAuthConfig(env);
    if (!cfg) return json({ error: "auth unavailable" }, 503);
    const body = (await request.json().catch(() => ({}))) as { role?: string };
    const role = body.role === "staff" ? "staff" : "merchant";
    const token = await signJwt(
      { sub: `session:${role}`, role, name: "Operator" },
      cfg.secret,
    );
    return json({ token, user: { email: null, role, name: "Operator" } });
  }

  return null;
}
