import { mintToken, requireHumanAuth } from "@/api/auth";
import { getSql } from "@/lib/db";
import { verifyIdToken } from "@/lib/oidc";
import { roleAtLeast } from "@/lib/rbac";

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

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { location } });
}

function safeRedirectPath(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/sign-in";
  }
  try {
    const parsed = new URL(value, "https://local.invalid");
    if (parsed.origin !== "https://local.invalid") return "/sign-in";
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return "/sign-in";
  }
}

// Enterprise OIDC single sign-on. A reseller (bank/enterprise) configures its IdP
// once; its people sign in via the authorization-code flow. The id_token is
// verified (RS256 against the IdP JWKS) before we ever mint a session.
export async function handleSsoRoute(
  request: Request,
  env: unknown,
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith("/api/auth/sso") && path !== "/api/org/sso") return null;
  if (request.method === "OPTIONS") return json({ ok: true });
  const sql = getSql(env);
  if (!sql) return json({ error: "database not configured" }, 503);

  // --- Reseller config: set / read the org's OIDC connection (admins only) -----
  if (path === "/api/org/sso") {
    const payload = await requireHumanAuth(request, env);
    if (!payload) return json({ error: "unauthorized" }, 401);
    if (!roleAtLeast(payload, "reseller_admin")) {
      return json({ error: "forbidden" }, 403);
    }
    const orgId = (payload as { org?: string }).org;
    if (!orgId) return json({ error: "no organization on this account" }, 400);

    if (request.method === "GET") {
      const [c] = await sql`
        SELECT provider, issuer, client_id, authorize_url, token_url, jwks_url,
               email_domain, default_role, enabled
        FROM sso_connections WHERE org_id = ${orgId} LIMIT 1`;
      // Never return the client secret.
      return json({ connection: c ?? null });
    }
    if (request.method === "POST") {
      const b = (await request.json().catch(() => ({}))) as Record<string, string>;
      const required = ["issuer", "clientId", "clientSecret", "authorizeUrl", "tokenUrl", "jwksUrl"];
      for (const k of required) {
        if (!b[k]?.trim()) return json({ error: `${k} is required` }, 400);
      }
      const defaultRole = b.defaultRole || "reseller_admin";
      if (defaultRole !== "reseller_admin") {
        return json({ error: "defaultRole must be reseller_admin" }, 400);
      }
      await sql`
        INSERT INTO sso_connections
          (org_id, provider, issuer, client_id, client_secret, authorize_url,
           token_url, jwks_url, email_domain, default_role, enabled, updated_at)
        VALUES (${orgId}, 'oidc', ${b.issuer}, ${b.clientId}, ${b.clientSecret},
                ${b.authorizeUrl}, ${b.tokenUrl}, ${b.jwksUrl},
                ${b.emailDomain || null}, ${defaultRole},
                ${b.enabled === "false" ? false : true}, now())
        ON CONFLICT (org_id) DO UPDATE SET
          issuer = EXCLUDED.issuer, client_id = EXCLUDED.client_id,
          client_secret = EXCLUDED.client_secret, authorize_url = EXCLUDED.authorize_url,
          token_url = EXCLUDED.token_url, jwks_url = EXCLUDED.jwks_url,
          email_domain = EXCLUDED.email_domain, default_role = EXCLUDED.default_role,
          enabled = EXCLUDED.enabled, updated_at = now()`;
      return json({ ok: true });
    }
    return null;
  }

  // --- Start: redirect the user to their org's IdP -----------------------------
  const startMatch = path.match(/^\/api\/auth\/sso\/([^/]+)\/start$/);
  if (startMatch && request.method === "GET") {
    const slug = startMatch[1].toLowerCase();
    const [org] = await sql`SELECT id FROM organizations WHERE slug = ${slug} LIMIT 1`;
    if (!org) return json({ error: "unknown organization" }, 404);
    const [conn] = await sql`
      SELECT client_id, authorize_url FROM sso_connections
      WHERE org_id = ${org.id} AND enabled = true LIMIT 1`;
    if (!conn) return json({ error: "SSO is not configured for this organization" }, 404);

    const state = crypto.randomUUID().replace(/-/g, "");
    const nonce = crypto.randomUUID().replace(/-/g, "");
    const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    await sql`
      INSERT INTO sso_states (state, org_id, nonce, redirect_to, expires_at)
      VALUES (${state}, ${org.id}, ${nonce}, ${safeRedirectPath(url.searchParams.get("redirect_to"))}, ${expires})`;

    const redirectUri = `${url.origin}/api/auth/sso/callback`;
    const authUrl = new URL(String(conn.authorize_url));
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("client_id", String(conn.client_id));
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("scope", "openid email profile");
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("nonce", nonce);
    return redirect(authUrl.toString());
  }

  // --- Callback: exchange the code, verify the id_token, mint a session --------
  if (path === "/api/auth/sso/callback" && request.method === "GET") {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || !state) return redirect("/sign-in?sso_error=1");
    const [st] = await sql`
      SELECT org_id, nonce, redirect_to FROM sso_states
      WHERE state = ${state} AND expires_at > now() LIMIT 1`;
    if (!st) return redirect("/sign-in?sso_error=state");
    await sql`DELETE FROM sso_states WHERE state = ${state}`;

    const [conn] = await sql`
      SELECT issuer, client_id, client_secret, token_url, jwks_url, email_domain,
             default_role FROM sso_connections WHERE org_id = ${st.org_id} LIMIT 1`;
    if (!conn) return redirect("/sign-in?sso_error=config");

    // Exchange the authorization code for tokens.
    const redirectUri = `${url.origin}/api/auth/sso/callback`;
    let idToken = "";
    try {
      const form = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: String(conn.client_id),
        client_secret: String(conn.client_secret),
      });
      const tok = (await (
        await fetch(String(conn.token_url), {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: form.toString(),
        })
      ).json()) as { id_token?: string };
      idToken = tok.id_token ?? "";
    } catch {
      return redirect("/sign-in?sso_error=token");
    }
    if (!idToken) return redirect("/sign-in?sso_error=token");

    const claims = await verifyIdToken(idToken, {
      jwksUrl: String(conn.jwks_url),
      issuer: String(conn.issuer),
      clientId: String(conn.client_id),
      nonce: String(st.nonce),
    });
    if (!claims?.email) return redirect("/sign-in?sso_error=verify");
    const email = String(claims.email).toLowerCase();
    if (
      conn.email_domain &&
      !email.endsWith(`@${String(conn.email_domain).toLowerCase().replace(/^@/, "")}`)
    ) {
      return redirect("/sign-in?sso_error=domain");
    }

    // Find or provision the user, attaching them to the org.
    const role = "reseller_admin";
    const name = String(claims.name || email.split("@")[0]);
    let [user] = await sql`
      SELECT id, email, name, role, org_id, venue_id, plan
      FROM app_users WHERE lower(email) = ${email} LIMIT 1`;
    if (!user) {
      [user] = await sql`
        INSERT INTO app_users (email, password_hash, name, role, org_id, plan)
        VALUES (${email}, NULL, ${name}, ${role}, ${st.org_id}, 'pro')
        RETURNING id, email, name, role, org_id, venue_id, plan`;
    } else if (!user.org_id) {
      await sql`UPDATE app_users SET org_id = ${st.org_id} WHERE id = ${user.id}`;
      user.org_id = st.org_id;
    }

    const token = await mintToken(env, {
      sub: email,
      role: String(user.role ?? role),
      name: user.name ?? name,
      venue: (user.venue_id as string) ?? undefined,
      org: String(user.org_id ?? st.org_id),
      plan: (user.plan as string) ?? "pro",
    });
    if (!token) return redirect("/sign-in?sso_error=mint");
    // Hand the session to the SPA via the URL fragment (never sent to a server).
    const dest = safeRedirectPath(st.redirect_to ? String(st.redirect_to) : null);
    return redirect(`${dest}#sso_token=${encodeURIComponent(token)}`);
  }

  return null;
}
