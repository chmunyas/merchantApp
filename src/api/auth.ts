import { getAdapter } from "@/lib/channels";
import { getSql, type Sql } from "@/lib/db";
import { envVar } from "@/lib/env";
import { hashPassword, signJwt, verifyJwt, verifyPassword } from "@/lib/jwt";
import {
  generateOtpCode,
  hashOtp,
  normalizeDestination,
  timingSafeEqualHex,
} from "@/lib/otp";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { generateTotpSecret, totpUri, verifyTotp } from "@/lib/totp";
import { venueFromPayload } from "@/lib/tenancy";
import { verifyTurnstile } from "@/lib/turnstile";

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
  const secret = await getAuthSecret(env);
  if (!secret) return null;
  return verifyJwt(token, secret);
}

// The JWT secret is cached in-isolate so a warm worker verifies tokens WITHOUT a
// per-request `app_settings` round-trip to Neon — this shaves a full DB hop off
// every authenticated request (the dashboard polls several gated endpoints, so it
// dominated perceived latency). The secret is stable, so a 60s cache is safe.
let authSecretCache: { secret: string; expires: number } | null = null;
const AUTH_SECRET_TTL_MS = 60_000;

async function getAuthSecret(env: unknown): Promise<string | null> {
  // An explicit env override always wins and needs neither DB nor cache.
  const envSecret = envVar(env, "JWT_SECRET");
  if (envSecret) return envSecret;
  const now = Date.now();
  if (authSecretCache && authSecretCache.expires > now) {
    return authSecretCache.secret;
  }
  const cfg = await getAuthConfig(env);
  if (!cfg?.secret) return null;
  authSecretCache = { secret: cfg.secret, expires: now + AUTH_SECRET_TTL_MS };
  return cfg.secret;
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

// Mint an app JWT with the configured secret — for external login flows (SSO)
// that provision/resolve a user out-of-band and then hand back a session.
export async function mintToken(
  env: unknown,
  claims: Record<string, unknown>,
): Promise<string | null> {
  const cfg = await getAuthConfig(env);
  if (!cfg) return null;
  return signJwt(claims, cfg.secret);
}

// Passwordless provisioning: create a venue + owner app_user with NO password, so
// an OTP-verified identity gets a full merchant account. Mirrors signup's core
// (venue + app_users + user_venues) minus password / org / invite.
async function provisionPasswordlessMerchant(
  sql: Sql,
  identity: { email: string; phone?: string | null; name?: string | null },
): Promise<{ venueId: string; userId: string; name: string }> {
  const name = (
    identity.name?.trim() ||
    identity.email.split("@")[0] ||
    "My venue"
  ).slice(0, 60);
  const venueId = `v_${crypto.randomUUID().slice(0, 8)}`;
  const code = name.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase() || "VEN";
  await sql`
    INSERT INTO venues (id, name, code, active) VALUES (${venueId}, ${name}, ${code}, true)`;
  const [created] = await sql`
    INSERT INTO app_users (email, password_hash, name, phone, venue_id, role, plan)
    VALUES (${identity.email}, NULL, ${name}, ${identity.phone ?? null}, ${venueId}, 'merchant', 'free')
    RETURNING id`;
  await sql`
    INSERT INTO user_venues (user_id, venue_id, role)
    VALUES (${created.id}, ${venueId}, 'merchant') ON CONFLICT DO NOTHING`;
  return { venueId, userId: String(created.id), name };
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
    const body = (await request.json()) as {
      email?: string;
      password?: string;
      totp?: string;
    };
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
          SELECT email, password_hash, name, venue_id, role, plan, org_id,
                 totp_secret, totp_enabled
          FROM app_users WHERE lower(email) = ${email} LIMIT 1`;
        if (
          user &&
          user.password_hash &&
          (await verifyPassword(password, String(user.password_hash)))
        ) {
          // Optional TOTP second factor (high-assurance opt-in). When enabled the
          // password alone is not enough — a valid authenticator code is required.
          if (user.totp_enabled) {
            const code = String(body.totp ?? "").trim();
            if (!code) return json({ totpRequired: true }, 200);
            if (!(await verifyTotp(String(user.totp_secret ?? ""), code))) {
              return json({ error: "Invalid authenticator code." }, 401);
            }
          }
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

  // Multi-store: re-mint the JWT for another venue the user is a MEMBER of, so a
  // chain owner can switch stores with one login. Membership is verified
  // server-side, so a token can never be pointed at a venue the user doesn't own.
  if (path === "/api/auth/switch-venue" && request.method === "POST") {
    const payload = await requireAuth(request, env);
    if (!payload) return json({ error: "unauthorized" }, 401);
    const cfg = await getAuthConfig(env);
    const sql = getSql(env);
    if (!cfg || !sql) return json({ error: "auth unavailable" }, 503);
    const body = (await request.json().catch(() => ({}))) as { venue?: string };
    const target = String(body.venue ?? "").trim();
    if (!target) return json({ error: "venue required" }, 400);
    const email = String(payload.sub ?? "").toLowerCase();
    const [member] = await sql`
      SELECT uv.role, u.name, u.plan, u.org_id, v.name AS venue_name
      FROM user_venues uv
      JOIN app_users u ON u.id = uv.user_id
      JOIN venues v ON v.id = uv.venue_id
      WHERE lower(u.email) = ${email} AND uv.venue_id = ${target}
      LIMIT 1`;
    if (!member) return json({ error: "not a member of that venue" }, 403);
    const token = await signJwt(
      {
        sub: email,
        role: String(member.role ?? payload.role ?? "merchant"),
        name: (member.name as string) ?? undefined,
        venue: target,
        plan: (member.plan as string) ?? "free",
        org: (member.org_id as string) ?? undefined,
      },
      cfg.secret,
    );
    return json({
      token,
      user: {
        email,
        role: member.role,
        name: member.name,
        venue: target,
        venueName: member.venue_name,
        plan: (member.plan as string) ?? "free",
        org: (member.org_id as string) ?? null,
      },
    });
  }

  // Refresh the JWT from the CURRENT DB state (e.g. after a plan upgrade) without
  // a full re-login, so a new plan claim takes effect immediately.
  if (path === "/api/auth/refresh" && request.method === "POST") {
    const payload = await requireAuth(request, env);
    if (!payload) return json({ error: "unauthorized" }, 401);
    const cfg = await getAuthConfig(env);
    const sql = getSql(env);
    if (!cfg || !sql) return json({ error: "auth unavailable" }, 503);
    const email = String(payload.sub ?? "").toLowerCase();
    const venue = (payload as { venue?: string }).venue ?? null;
    const [u] = await sql`
      SELECT role, name, plan, org_id, venue_id
      FROM app_users
      WHERE lower(email) = ${email}
      ORDER BY (venue_id = ${venue}) DESC NULLS LAST
      LIMIT 1`;
    if (!u) return json({ error: "account not found" }, 404);
    const token = await signJwt(
      {
        sub: email,
        role: String(u.role ?? payload.role ?? "merchant"),
        name: (u.name as string) ?? undefined,
        venue: venue ?? (u.venue_id as string) ?? undefined,
        plan: (u.plan as string) ?? "free",
        org: (u.org_id as string) ?? undefined,
      },
      cfg.secret,
    );
    return json({
      token,
      user: {
        email,
        role: u.role,
        name: u.name,
        venue: venue ?? u.venue_id,
        plan: (u.plan as string) ?? "free",
        org: (u.org_id as string) ?? null,
      },
    });
  }

  // ===================== Passwordless OTP (email / WhatsApp / SMS) ===========
  // Request a one-time code, sent over the chosen channel. The account is created
  // on first successful verify (passwordless signup). Rate-limited per destination.
  if (path === "/api/auth/otp/request" && request.method === "POST") {
    const cfg = await getAuthConfig(env);
    const sql = getSql(env);
    if (!cfg || !sql) return json({ error: "auth unavailable" }, 503);
    const body = (await request.json().catch(() => ({}))) as {
      channel?: string;
      destination?: string;
    };
    const channel = String(body.channel ?? "email").toLowerCase();
    if (!["email", "whatsapp", "sms"].includes(channel)) {
      return json({ error: "unsupported channel" }, 400);
    }
    if (!(await verifyTurnstile(env, (body as { turnstileToken?: string }).turnstileToken, clientIp(request)))) {
      return json({ error: "Captcha verification failed." }, 403);
    }
    const dest = normalizeDestination(channel, body.destination ?? "");
    if (!dest || (channel === "email" && !dest.includes("@"))) {
      return json({ error: "A valid destination is required." }, 400);
    }
    // Abuse guard: 5 codes / hour / destination.
    const rl = await rateLimit(env, `otp:${channel}:${dest}`, 5, 3600);
    if (rl.limited) {
      return json({ error: "Too many codes requested. Try again later." }, 429);
    }
    const code = generateOtpCode();
    const codeHash = await hashOtp(code, dest, cfg.secret);
    const id = `otp_${crypto.randomUUID().replace(/-/g, "")}`;
    const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    await sql`
      INSERT INTO auth_otps (id, channel, destination, code_hash, purpose, expires_at)
      VALUES (${id}, ${channel}, ${dest}, ${codeHash}, 'login', ${expires})`;
    const message = `Your PesaSwap code is ${code}. It expires in 10 minutes. If you didn't request it, ignore this message.`;
    const handle = channel === "email" ? `email:${dest}` : dest;
    try {
      await getAdapter(channel).send(handle, message, env, "main");
    } catch {
      /* delivery best-effort; the code is still valid + can be re-sent */
    }
    // On non-prod (no HYPERDRIVE binding) or with AUTH_OTP_DEBUG, echo the code so
    // dev/E2E can complete the flow without a live ESP/WhatsApp. NEVER in prod.
    const isProd = Boolean((env as { HYPERDRIVE?: unknown } | null)?.HYPERDRIVE);
    const debug = !isProd || truthyEnv(envVar(env, "AUTH_OTP_DEBUG"));
    console.info(`[auth] OTP ${channel}:${dest}${debug ? ` = ${code}` : ""}`);
    return json({
      sent: true,
      channel,
      destination: dest,
      ...(debug ? { devCode: code } : {}),
    });
  }

  // Verify a code → mint a JWT (provisioning the account passwordlessly if new).
  if (path === "/api/auth/otp/verify" && request.method === "POST") {
    const cfg = await getAuthConfig(env);
    const sql = getSql(env);
    if (!cfg || !sql) return json({ error: "auth unavailable" }, 503);
    const body = (await request.json().catch(() => ({}))) as {
      channel?: string;
      destination?: string;
      code?: string;
      name?: string;
      totp?: string;
    };
    const channel = String(body.channel ?? "email").toLowerCase();
    const dest = normalizeDestination(channel, body.destination ?? "");
    const code = String(body.code ?? "").trim();
    if (!dest || !/^\d{6}$/.test(code)) return json({ error: "Invalid code." }, 400);

    const [otp] = await sql`
      SELECT id, code_hash, attempts FROM auth_otps
      WHERE destination = ${dest} AND channel = ${channel}
        AND consumed_at IS NULL AND expires_at > now()
      ORDER BY created_at DESC LIMIT 1`;
    if (!otp) return json({ error: "That code has expired. Request a new one." }, 401);
    if (Number(otp.attempts) >= 5) {
      await sql`UPDATE auth_otps SET consumed_at = now() WHERE id = ${otp.id}`;
      return json({ error: "Too many attempts. Request a new code." }, 429);
    }
    const expected = await hashOtp(code, dest, cfg.secret);
    if (!timingSafeEqualHex(expected, String(otp.code_hash))) {
      await sql`UPDATE auth_otps SET attempts = attempts + 1 WHERE id = ${otp.id}`;
      return json({ error: "Incorrect code." }, 401);
    }
    await sql`UPDATE auth_otps SET consumed_at = now() WHERE id = ${otp.id}`;

    let user =
      channel === "email"
        ? (
            await sql`
              SELECT id, email, name, venue_id, role, plan, org_id, totp_secret, totp_enabled
              FROM app_users WHERE lower(email) = ${dest} LIMIT 1`
          )[0]
        : (
            await sql`
              SELECT id, email, name, venue_id, role, plan, org_id, totp_secret, totp_enabled
              FROM app_users WHERE phone = ${dest} LIMIT 1`
          )[0];
    if (!user) {
      const email =
        channel === "email"
          ? dest
          : `${dest.replace(/[^\d]/g, "")}@phone.pesaswap.local`;
      const phone = channel === "email" ? null : dest;
      const prov = await provisionPasswordlessMerchant(sql, {
        email,
        phone,
        name: body.name,
      });
      [user] = await sql`
        SELECT id, email, name, venue_id, role, plan, org_id, totp_secret, totp_enabled
        FROM app_users WHERE id = ${prov.userId} LIMIT 1`;
    }
    if (!user) return json({ error: "Could not sign you in." }, 500);

    if (user.totp_enabled) {
      const t = String(body.totp ?? "").trim();
      if (!t) return json({ totpRequired: true }, 200);
      if (!(await verifyTotp(String(user.totp_secret ?? ""), t))) {
        return json({ error: "Invalid authenticator code." }, 401);
      }
    }
    const token = await signJwt(
      {
        sub: String(user.email),
        role: String(user.role ?? "merchant"),
        name: (user.name as string) ?? undefined,
        venue: (user.venue_id as string) ?? undefined,
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

  // ===================== TOTP 2FA (opt-in high assurance) ====================
  if (path === "/api/auth/totp/setup" && request.method === "POST") {
    const payload = await requireAuth(request, env);
    if (!payload) return json({ error: "unauthorized" }, 401);
    const sql = getSql(env);
    if (!sql) return json({ error: "auth unavailable" }, 503);
    const email = String(payload.sub ?? "").toLowerCase();
    const secret = generateTotpSecret();
    await sql`UPDATE app_users SET totp_secret = ${secret} WHERE lower(email) = ${email}`;
    return json({ secret, otpauthUrl: totpUri(secret, email) });
  }

  if (path === "/api/auth/totp/enable" && request.method === "POST") {
    const payload = await requireAuth(request, env);
    if (!payload) return json({ error: "unauthorized" }, 401);
    const sql = getSql(env);
    if (!sql) return json({ error: "auth unavailable" }, 503);
    const email = String(payload.sub ?? "").toLowerCase();
    const body = (await request.json().catch(() => ({}))) as { code?: string };
    const [u] = await sql`
      SELECT totp_secret FROM app_users WHERE lower(email) = ${email} LIMIT 1`;
    if (!u?.totp_secret) return json({ error: "Start setup first." }, 400);
    if (!(await verifyTotp(String(u.totp_secret), String(body.code ?? "")))) {
      return json({ error: "Invalid code." }, 401);
    }
    await sql`UPDATE app_users SET totp_enabled = true WHERE lower(email) = ${email}`;
    return json({ enabled: true });
  }

  if (path === "/api/auth/totp/disable" && request.method === "POST") {
    const payload = await requireAuth(request, env);
    if (!payload) return json({ error: "unauthorized" }, 401);
    const sql = getSql(env);
    if (!sql) return json({ error: "auth unavailable" }, 503);
    const email = String(payload.sub ?? "").toLowerCase();
    const body = (await request.json().catch(() => ({}))) as { code?: string };
    const [u] = await sql`
      SELECT totp_secret, totp_enabled FROM app_users WHERE lower(email) = ${email} LIMIT 1`;
    if (
      u?.totp_enabled &&
      !(await verifyTotp(String(u.totp_secret ?? ""), String(body.code ?? "")))
    ) {
      return json({ error: "Invalid code." }, 401);
    }
    await sql`
      UPDATE app_users SET totp_secret = NULL, totp_enabled = false
      WHERE lower(email) = ${email}`;
    return json({ disabled: true });
  }

  // Optionally set/replace a password (upgrade a passwordless account to one that
  // also supports password + TOTP for enterprise/high-assurance scenarios).
  if (path === "/api/auth/password/set" && request.method === "POST") {
    const payload = await requireAuth(request, env);
    if (!payload) return json({ error: "unauthorized" }, 401);
    const sql = getSql(env);
    if (!sql) return json({ error: "auth unavailable" }, 503);
    const email = String(payload.sub ?? "").toLowerCase();
    const body = (await request.json().catch(() => ({}))) as {
      password?: string;
      currentPassword?: string;
    };
    const password = String(body.password ?? "");
    if (password.length < 8) {
      return json({ error: "Password must be at least 8 characters." }, 400);
    }
    const [u] = await sql`
      SELECT password_hash FROM app_users WHERE lower(email) = ${email} LIMIT 1`;
    if (
      u?.password_hash &&
      !(await verifyPassword(String(body.currentPassword ?? ""), String(u.password_hash)))
    ) {
      return json({ error: "Current password is incorrect." }, 403);
    }
    await sql`
      UPDATE app_users SET password_hash = ${await hashPassword(password)}
      WHERE lower(email) = ${email}`;
    return json({ ok: true });
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
      invite?: string;
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
    if (!(await verifyTurnstile(env, (body as { turnstileToken?: string }).turnstileToken, clientIp(request)))) {
      return json({ error: "Captcha verification failed." }, 403);
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
      // linked to that org (and inherits its co-brand via the branding join). An
      // invite-only org additionally requires a valid, unused, unexpired token.
      let orgId: string | null = null;
      let inviteToken: string | null = null;
      if (body.org) {
        const [org] = await sql`
          SELECT id, require_invite FROM organizations
          WHERE slug = ${String(body.org).toLowerCase()} AND active = true
          LIMIT 1`;
        orgId = (org?.id as string) ?? null;
        if (org && org.require_invite) {
          const inv = String(body.invite ?? "").trim();
          if (!inv) {
            return json(
              { error: "This organization requires an invite to sign up." },
              403,
            );
          }
          const [row] = await sql`
            SELECT token FROM org_invites
            WHERE token = ${inv} AND org_id = ${org.id} AND used_at IS NULL
              AND expires_at > now()
              AND (email IS NULL OR lower(email) = ${email})
            LIMIT 1`;
          if (!row) {
            return json(
              { error: "That invite is invalid, already used or expired." },
              403,
            );
          }
          inviteToken = String(row.token);
        }
      }
      const venueId = `v_${crypto.randomUUID().slice(0, 8)}`;
      const code =
        businessName.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase() ||
        "VEN";
      await sql`
        INSERT INTO venues (id, name, code, active, org_id)
        VALUES (${venueId}, ${businessName}, ${code}, true, ${orgId})`;
      if (inviteToken) {
        await sql`
          UPDATE org_invites SET used_at = now(), used_venue = ${venueId}
          WHERE token = ${inviteToken}`;
      }
      const passwordHash = await hashPassword(password);
      const [created] = await sql`
        INSERT INTO app_users (email, password_hash, name, phone, venue_id, role, plan, org_id)
        VALUES (${email}, ${passwordHash}, ${businessName},
                ${body.phone?.trim() || null}, ${venueId}, 'merchant', 'free', ${orgId})
        RETURNING id`;
      // Membership row so this owner can later add + switch to more stores.
      await sql`
        INSERT INTO user_venues (user_id, venue_id, role)
        VALUES (${created.id}, ${venueId}, 'merchant')
        ON CONFLICT DO NOTHING`;
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

  // Public: the Turnstile site key for the CAPTCHA widget (null if unconfigured).
  if (path === "/api/auth/turnstile/config" && request.method === "GET") {
    return json({ siteKey: envVar(env, "TURNSTILE_SITE_KEY") ?? null });
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
      // Admin email always wins. Otherwise hydrate role + venue + plan from the
      // app_users row so an invited team member lands on THEIR store with THEIR
      // account role; a brand-new Google user defaults to a venue-less merchant.
      const isAdmin =
        info.email.toLowerCase() === cfg.adminEmail.toLowerCase();
      let role = isAdmin ? "admin" : "merchant";
      let venue: string | undefined;
      let plan = "free";
      let org: string | undefined;
      if (!isAdmin) {
        const sql = getSql(env);
        if (sql) {
          try {
            const [u] = await sql`
              SELECT role, venue_id, plan, org_id
              FROM app_users WHERE lower(email) = ${info.email.toLowerCase()} LIMIT 1`;
            if (u) {
              role = String(u.role);
              venue = (u.venue_id as string) ?? undefined;
              plan = (u.plan as string) ?? "free";
              org = (u.org_id as string) ?? undefined;
            }
          } catch {
            /* app_users not provisioned — keep defaults */
          }
        }
      }
      const token = await signJwt(
        { sub: info.email, role, name: info.name ?? info.email, venue, plan, org },
        cfg.secret,
      );
      return json({
        token,
        user: {
          email: info.email,
          name: info.name,
          picture: info.picture,
          role,
          venue: venue ?? null,
          plan,
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

  // Staff multi-venue: switch to another store this staff member is assigned to
  // (per-venue staff rows linked by phone). Re-mints the staff JWT for the target
  // store's staff row; the assignment is verified server-side (same phone, active
  // there), so a staff token can never be pointed at a store they don't work at.
  if (path === "/api/auth/staff-switch-venue" && request.method === "POST") {
    const payload = await requireAuth(request, env);
    if (!payload || payload.role !== "staff") {
      return json({ error: "unauthorized" }, 401);
    }
    const cfg = await getAuthConfig(env);
    const sql = getSql(env);
    if (!cfg || !sql) return json({ error: "auth unavailable" }, 503);
    const staffId =
      typeof payload.staff_id === "string" ? payload.staff_id : null;
    if (!staffId) return json({ error: "not a staff session" }, 403);
    const body = (await request.json().catch(() => ({}))) as { venue?: string };
    const target = String(body.venue ?? "").trim();
    if (!target) return json({ error: "venue required" }, 400);
    const [me] = await sql`SELECT phone FROM staff WHERE id = ${staffId} LIMIT 1`;
    const phone = me?.phone ? String(me.phone).trim() : "";
    if (!phone) return json({ error: "no linked venues" }, 403);
    const [targetStaff] = await sql`
      SELECT s.id, s.name, v.name AS venue_name
      FROM staff s JOIN venues v ON v.id = s.venue_id
      WHERE s.phone = ${phone} AND s.venue_id = ${target} AND s.active = true
      LIMIT 1`;
    if (!targetStaff) {
      return json({ error: "not assigned to that store" }, 403);
    }
    const token = await signJwt(
      {
        sub: `staff:${targetStaff.id}`,
        role: "staff",
        name: (targetStaff.name as string) ?? "Staff",
        venue: target,
        staff_id: targetStaff.id,
      },
      cfg.secret,
    );
    return json({
      token,
      user: {
        email: null,
        role: "staff",
        name: targetStaff.name,
        venue: target,
        venueName: targetStaff.venue_name,
        staffId: targetStaff.id,
      },
    });
  }

  // Staff PIN login: verify a PIN against the staff table + mint a staff JWT
  // (role=staff, venue + staff_id) so authFetch works for staff. Not gated by
  // AUTH_REQUIRE_LOGIN — it IS a real credential check.
  if (path === "/api/auth/staff-login" && request.method === "POST") {
    const cfg = await getAuthConfig(env);
    const sql = getSql(env);
    if (!cfg || !sql) return json({ error: "auth unavailable" }, 503);
    const body = (await request.json().catch(() => ({}))) as { pin?: string };
    const pin = String(body.pin ?? "").trim();
    if (!/^\d{4,8}$/.test(pin)) return json({ error: "invalid pin" }, 400);
    const [staff] = await sql`
      SELECT id, name, venue_id FROM staff
      WHERE pin = ${pin} AND active = true LIMIT 1`;
    if (!staff) return json({ error: "invalid pin" }, 401);
    const token = await signJwt(
      {
        sub: `staff:${staff.id}`,
        role: "staff",
        name: (staff.name as string) ?? "Staff",
        venue: (staff.venue_id as string) ?? undefined,
        staff_id: staff.id,
      },
      cfg.secret,
    );
    return json({
      token,
      user: {
        email: null,
        role: "staff",
        name: staff.name,
        venue: staff.venue_id,
        staffId: staff.id,
      },
    });
  }

  return null;
}
