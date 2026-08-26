import { aiChat } from "@/lib/ai-providers";
import { getSql, type Sql } from "@/lib/db";
import {
  applyTemplate,
  buildReplyPrompt,
  clampRating,
  DEFAULT_REPLY_TEMPLATES,
  DEFAULT_REPUTATION_SETTINGS,
  googleReviewUrl,
  isNegative,
  normalizeSettings,
  originShare,
  reviewTrend,
  routeRating,
  staffAttribution,
  summarizeReviews,
  type ReputationSettings,
  type ReviewRow,
} from "@/lib/reviews";
import {
  buildAuthorizeUrl,
  googleOAuthConfig,
  googleRedirectUri,
  googleRefreshToken,
  exchangeCode,
  listAccounts,
  listLocations,
  listReviews,
  replyToReview,
  starRatingToNumber,
} from "@/lib/google-business";
import { getBaseUrl } from "@/lib/links";
import { signJwt, verifyJwt } from "@/lib/jwt";
import { venueFromPayload } from "@/lib/tenancy";
import { getSigningSecret, requireAuth, resolveVenue } from "@/api/auth";
import { deliverStaffNotification } from "@/lib/staff-notify";
import { roleAtLeast } from "@/lib/rbac";
import { tokenHasScope } from "@/lib/api-tokens";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders },
  });
}

function validUuid(value: unknown): string | null {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

type ReviewSettingsRow = {
  public_redirect_enabled: boolean;
  public_redirect_min_rating: number;
  google_place_id: string | null;
  google_account_name: string | null;
  google_location_name: string | null;
  google_location_title: string | null;
  google_connected_at: string | null;
};

// Reputation settings for a venue, falling back to the code defaults when the
// venue has never been configured (or db/71 has not been applied yet), so a
// fresh database and a migrated one behave identically.
async function loadSettings(
  sql: Sql,
  venue: string,
): Promise<{ settings: ReputationSettings; row: ReviewSettingsRow | null }> {
  try {
    const [row] = (await sql`
      SELECT public_redirect_enabled, public_redirect_min_rating, google_place_id,
             google_account_name, google_location_name, google_location_title,
             google_connected_at
      FROM review_settings WHERE venue_id = ${venue} LIMIT 1`) as ReviewSettingsRow[];
    if (!row) return { settings: DEFAULT_REPUTATION_SETTINGS, row: null };
    return {
      settings: normalizeSettings({
        publicRedirectEnabled: row.public_redirect_enabled,
        publicRedirectMinRating: Number(row.public_redirect_min_rating),
        googlePlaceId: row.google_place_id,
      }),
      row,
    };
  } catch {
    return { settings: DEFAULT_REPUTATION_SETTINGS, row: null };
  }
}

// The connection state the dashboard renders. "not_configured" means the
// operator has not set the OAuth client secrets on this deployment at all;
// "not_connected" means the secrets exist but no venue has completed the flow.
function googleStatus(
  env: unknown,
  row: ReviewSettingsRow | null,
): {
  state: "not_configured" | "not_connected" | "connected";
  placeId: string | null;
  locationName: string | null;
  locationTitle: string | null;
  accountName: string | null;
  connectedAt: string | null;
  reviewUrl: string | null;
} {
  const configured = Boolean(googleOAuthConfig(env));
  const hasToken = Boolean(googleRefreshToken(env));
  const state = !configured
    ? "not_configured"
    : hasToken && row?.google_location_name
      ? "connected"
      : "not_connected";
  return {
    state,
    placeId: row?.google_place_id ?? null,
    locationName: row?.google_location_name ?? null,
    locationTitle: row?.google_location_title ?? null,
    accountName: row?.google_account_name ?? null,
    connectedAt: row?.google_connected_at ?? null,
    reviewUrl: googleReviewUrl(row?.google_place_id ?? null),
  };
}

export async function handleReviewsRoute(
  request: Request,
  env: unknown,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/reviews")) return null;
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  const sql = getSql(env);
  if (!sql) return json({ error: "database not configured" }, 503);

  // ---------------------------------------------------------------------
  // D6.3 — Google OAuth callback. Google redirects the operator's BROWSER
  // here, so there is no Authorization header: the venue travels in a signed,
  // short-lived `state` handle minted by /google/connect. An unsigned or
  // expired state is rejected outright.
  // ---------------------------------------------------------------------
  if (
    url.pathname === "/api/reviews/google/callback" &&
    request.method === "GET"
  ) {
    return googleCallback(request, env, sql, url);
  }

  // Public prompt config — lets the post-payment widget know, BEFORE a star is
  // tapped, at what rating this venue sends guests to Google and whether the
  // Google side is usable at all. No credentials, no PII.
  if (url.pathname === "/api/reviews/prompt" && request.method === "GET") {
    const venue = await resolveVenue(request, env, url);
    const { settings } = await loadSettings(sql, venue);
    return json({
      minRating: settings.publicRedirectMinRating,
      redirectEnabled: settings.publicRedirectEnabled,
      googleReady: Boolean(settings.googlePlaceId),
    });
  }

  // Public capture — the post-payment review prompt (pay / table / QR pages).
  if (url.pathname === "/api/reviews" && request.method === "POST") {
    const venue = await resolveVenue(request, env, url);
    const body = (await request.json().catch(() => ({}))) as {
      rating?: number;
      food?: number;
      service?: number;
      ambience?: number;
      value?: number;
      comment?: string;
      customerName?: string;
      phone?: string;
      staffId?: string;
      paymentId?: string;
      source?: string;
    };
    const rating = clampRating(body.rating);
    if (!rating) return json({ error: "rating 1-5 required" }, 400);
    const { settings } = await loadSettings(sql, venue);
    // D6.2 / D6.8 — decide BEFORE writing, so the row records what happened.
    const decision = routeRating(rating, settings);
    const [row] = await sql`
      INSERT INTO reviews
        (venue_id, rating, food, service, ambience, value, comment,
         customer_name, phone, staff_id, payment_id, source)
      VALUES (${venue}, ${rating}, ${clampRating(body.food)}, ${clampRating(body.service)},
              ${clampRating(body.ambience)}, ${clampRating(body.value)},
              ${body.comment ?? null}, ${body.customerName ?? null}, ${body.phone ?? null},
              ${validUuid(body.staffId)}, ${body.paymentId ?? null}, ${body.source ?? "pay"})
      RETURNING id`;
    if (decision.destination === "google") {
      // Best-effort provenance: never fail the guest's rating over a column
      // that only exists after db/71.
      try {
        await sql`
          UPDATE reviews SET redirected_to_google = true, redirected_at = now()
          WHERE id = ${row.id} AND venue_id = ${venue}`;
      } catch {
        /* provenance is additive */
      }
    }
    // B2.11 — the served staff member hears about their own feedback. D6.8 —
    // a rating held back from Google is explicitly flagged so the team can
    // recover the guest before it ever becomes public.
    await deliverStaffNotification(env, {
      venue,
      type: "review.new",
      targetStaffId: validUuid(body.staffId),
      rating,
      comment:
        typeof body.comment === "string" ? body.comment.slice(0, 140) : null,
      dedupeKey: `review.new:${row.id}`,
      url: "/dashboard/reviews",
      data: {
        review_id: String(row.id),
        negative: decision.alertStaff,
        intercepted: decision.destination === "private",
      },
    });
    return json(
      {
        ok: true,
        id: row.id,
        negative: isNegative(rating),
        // What the guest should see next.
        destination: decision.destination,
        reason: decision.reason,
        googleUrl: decision.googleUrl,
      },
      201,
    );
  }

  // Everything below is gated (dashboard).
  const payload = await requireAuth(request, env);
  if (!payload) return json({ error: "unauthorized" }, 401);
  const write = request.method !== "GET";
  if (
    !roleAtLeast(payload, "manager") ||
    !tokenHasScope(payload, write ? "reviews:write" : "reviews:read")
  ) {
    return json({ error: "forbidden" }, 403);
  }
  const venue = venueFromPayload(payload, url);

  if (url.pathname === "/api/reviews" && request.method === "GET") {
    const rows = await sql`
      SELECT id, rating, food, service, ambience, value, comment, customer_name,
             phone, staff_id, payment_id, source, response, response_ai,
             responded_at, created_at
      FROM reviews WHERE venue_id = ${venue}
      ORDER BY created_at DESC LIMIT 200`;
    return json({
      reviews: rows,
      stats: summarizeReviews(rows as unknown as ReviewRow[]),
    });
  }

  // -----------------------------------------------------------------------
  // D6.2 / D6.8 — reputation settings (threshold + Google identifiers).
  // -----------------------------------------------------------------------
  if (url.pathname === "/api/reviews/settings") {
    if (request.method === "GET") {
      const { settings, row } = await loadSettings(sql, venue);
      return json({ settings, google: googleStatus(env, row) });
    }
    if (request.method === "PUT") {
      const body = (await request.json().catch(() => ({}))) as {
        publicRedirectEnabled?: boolean;
        publicRedirectMinRating?: number;
        googlePlaceId?: string | null;
        googleAccountName?: string | null;
        googleLocationName?: string | null;
        googleLocationTitle?: string | null;
      };
      const { settings: current } = await loadSettings(sql, venue);
      const next = normalizeSettings({
        publicRedirectEnabled:
          typeof body.publicRedirectEnabled === "boolean"
            ? body.publicRedirectEnabled
            : current.publicRedirectEnabled,
        publicRedirectMinRating:
          body.publicRedirectMinRating ?? current.publicRedirectMinRating,
        googlePlaceId:
          body.googlePlaceId === undefined
            ? current.googlePlaceId
            : body.googlePlaceId,
      });
      const account = body.googleAccountName?.trim() || null;
      const location = body.googleLocationName?.trim() || null;
      const title = body.googleLocationTitle?.trim() || null;
      await sql`
        INSERT INTO review_settings
          (venue_id, public_redirect_enabled, public_redirect_min_rating,
           google_place_id, google_account_name, google_location_name,
           google_location_title, google_connected_at, google_connected_by)
        VALUES (${venue}, ${next.publicRedirectEnabled}, ${next.publicRedirectMinRating},
                ${next.googlePlaceId}, ${account}, ${location}, ${title},
                ${location ? new Date().toISOString() : null},
                ${location ? String(payload.sub ?? payload.email ?? "") || null : null})
        ON CONFLICT (venue_id) DO UPDATE SET
          public_redirect_enabled    = EXCLUDED.public_redirect_enabled,
          public_redirect_min_rating = EXCLUDED.public_redirect_min_rating,
          google_place_id            = EXCLUDED.google_place_id,
          google_account_name        = COALESCE(EXCLUDED.google_account_name, review_settings.google_account_name),
          google_location_name       = COALESCE(EXCLUDED.google_location_name, review_settings.google_location_name),
          google_location_title      = COALESCE(EXCLUDED.google_location_title, review_settings.google_location_title),
          google_connected_at        = COALESCE(EXCLUDED.google_connected_at, review_settings.google_connected_at),
          google_connected_by        = COALESCE(EXCLUDED.google_connected_by, review_settings.google_connected_by),
          updated_at                 = now()`;
      const { settings, row } = await loadSettings(sql, venue);
      return json({ ok: true, settings, google: googleStatus(env, row) });
    }
    return json({ error: "method not allowed" }, 405);
  }

  // -----------------------------------------------------------------------
  // D6.4 — average rating, evolution over time, share originating from us,
  // and D6.9 per-server attribution.
  // -----------------------------------------------------------------------
  if (url.pathname === "/api/reviews/analytics" && request.method === "GET") {
    const rows = (await sql`
      SELECT id, rating, food, service, ambience, value, comment, response,
             source, staff_id, created_at
      FROM reviews WHERE venue_id = ${venue}
      ORDER BY created_at DESC LIMIT 2000`) as unknown as ReviewRow[];
    const { settings } = await loadSettings(sql, venue);
    const attribution = staffAttribution(rows, settings.publicRedirectMinRating);
    const names = new Map<string, string>();
    if (attribution.length) {
      const ids = attribution.map((a) => a.staffId);
      const staff = await sql`
        SELECT id, name FROM staff
        WHERE venue_id = ${venue} AND id = ANY(${ids}::uuid[])`;
      for (const s of staff) names.set(String(s.id), String(s.name));
    }
    return json({
      stats: summarizeReviews(rows),
      trend: reviewTrend(rows),
      origin: originShare(rows),
      staff: attribution.map((a) => ({
        ...a,
        name: names.get(a.staffId) ?? null,
      })),
    });
  }

  // -----------------------------------------------------------------------
  // D6.6 — reply templates.
  // -----------------------------------------------------------------------
  if (url.pathname === "/api/reviews/templates") {
    if (request.method === "GET") {
      const rows = await sql`
        SELECT id, title, body, created_at, updated_at FROM review_templates
        WHERE venue_id = ${venue} ORDER BY created_at DESC LIMIT 200`;
      return json({ templates: rows, builtin: DEFAULT_REPLY_TEMPLATES });
    }
    if (request.method === "POST") {
      const body = (await request.json().catch(() => ({}))) as {
        title?: string;
        body?: string;
      };
      const title = (body.title ?? "").trim();
      const text = (body.body ?? "").trim();
      if (!title || !text) return json({ error: "title and body required" }, 400);
      const [row] = await sql`
        INSERT INTO review_templates (venue_id, title, body)
        VALUES (${venue}, ${title.slice(0, 120)}, ${text.slice(0, 2000)})
        ON CONFLICT (venue_id, lower(title)) DO UPDATE
          SET body = EXCLUDED.body, updated_at = now()
        RETURNING id, title, body, created_at, updated_at`;
      return json({ ok: true, template: row }, 201);
    }
    return json({ error: "method not allowed" }, 405);
  }

  const templateMatch = url.pathname.match(
    /^\/api\/reviews\/templates\/([0-9a-f-]{36})$/i,
  );
  if (templateMatch) {
    const id = templateMatch[1];
    if (request.method === "PATCH") {
      const body = (await request.json().catch(() => ({}))) as {
        title?: string;
        body?: string;
      };
      const [row] = await sql`
        UPDATE review_templates SET
          title = COALESCE(${body.title?.trim().slice(0, 120) || null}, title),
          body  = COALESCE(${body.body?.trim().slice(0, 2000) || null}, body),
          updated_at = now()
        WHERE id = ${id} AND venue_id = ${venue}
        RETURNING id, title, body, created_at, updated_at`;
      if (!row) return json({ error: "template not found" }, 404);
      return json({ ok: true, template: row });
    }
    if (request.method === "DELETE") {
      const [row] = await sql`
        DELETE FROM review_templates WHERE id = ${id} AND venue_id = ${venue}
        RETURNING id`;
      if (!row) return json({ error: "template not found" }, 404);
      return json({ ok: true });
    }
    return json({ error: "method not allowed" }, 405);
  }

  // -----------------------------------------------------------------------
  // D6.3 — start the Google connection, and list the locations the connected
  // account manages. Both are inert without the OAuth secrets.
  // -----------------------------------------------------------------------
  if (
    url.pathname === "/api/reviews/google/connect" &&
    request.method === "POST"
  ) {
    if (payload.kind !== "human-jwt" || !roleAtLeast(payload, "merchant")) {
      return json({ error: "forbidden" }, 403);
    }
    const config = googleOAuthConfig(env);
    if (!config) {
      return json(
        {
          error: "not_configured",
          message:
            "Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET as secrets to enable the Google connection.",
        },
        503,
      );
    }
    const secret = await getSigningSecret(env);
    if (!secret) return json({ error: "signing unavailable" }, 503);
    const base = await getBaseUrl(env);
    const state = await signJwt(
      { venue, purpose: "google-connect" },
      secret,
      600,
    );
    return json({
      ok: true,
      authorizeUrl: buildAuthorizeUrl(config, googleRedirectUri(base), state),
    });
  }

  if (
    url.pathname === "/api/reviews/google/locations" &&
    request.method === "GET"
  ) {
    if (payload.kind !== "human-jwt" || !roleAtLeast(payload, "merchant")) {
      return json({ error: "forbidden" }, 403);
    }
    const accounts = await listAccounts(env);
    if (!accounts.ok) return json(accounts, 503);
    const out: Array<{
      account: string;
      location: string;
      title: string | null;
      placeId: string | null;
    }> = [];
    for (const account of accounts.data) {
      const locations = await listLocations(env, account.name);
      if (!locations.ok) continue;
      for (const loc of locations.data) {
        // Business Information returns "locations/{id}"; the reviews surface
        // needs the account-qualified "accounts/{a}/locations/{id}".
        out.push({
          account: account.name,
          location: `${account.name}/${loc.name.replace(/^\/+/, "")}`,
          title: loc.title ?? null,
          placeId: loc.metadata?.placeId ?? null,
        });
      }
    }
    // An empty list is a real answer, not an error: it means the connected
    // Google account does not manage this venue's Business Profile.
    return json({ ok: true, locations: out });
  }

  // Import the venue's Google reviews so they can be answered here (D6.5) and
  // counted in the origin share (D6.4).
  if (url.pathname === "/api/reviews/google/sync" && request.method === "POST") {
    const { row } = await loadSettings(sql, venue);
    if (!row?.google_location_name) {
      return json({ error: "not_connected" }, 409);
    }
    const res = await listReviews(env, row.google_location_name);
    if (!res.ok) return json(res, 503);
    let imported = 0;
    for (const gr of res.data) {
      const stars = starRatingToNumber(gr.starRating);
      const externalId = gr.reviewId ?? gr.name;
      if (!stars || !externalId) continue;
      await sql`
        INSERT INTO reviews
          (venue_id, rating, comment, customer_name, source, google_review_id,
           response, responded_at, created_at)
        VALUES (${venue}, ${stars}, ${gr.comment ?? null},
                ${gr.reviewer?.displayName ?? null}, 'google', ${externalId},
                ${gr.reviewReply?.comment ?? null},
                ${gr.reviewReply?.updateTime ?? null},
                ${gr.createTime ?? new Date().toISOString()})
        ON CONFLICT (venue_id, google_review_id) DO UPDATE SET
          rating   = EXCLUDED.rating,
          comment  = EXCLUDED.comment,
          response = COALESCE(EXCLUDED.response, reviews.response)`;
      imported += 1;
    }
    return json({ ok: true, imported });
  }

  // Reply to a review — provide `text`, a `templateId`, or neither for an
  // AI-generated reply (D6.5 / D6.6 / D6.7). When the review came from Google
  // and the connection is live, the reply is pushed back to Google too.
  const replyMatch = url.pathname.match(
    /^\/api\/reviews\/([0-9a-f-]{36})\/reply$/i,
  );
  if (replyMatch && request.method === "POST") {
    const id = replyMatch[1];
    const [rev] = await sql`
      SELECT id, rating, comment, customer_name, google_review_id FROM reviews
      WHERE id = ${id} AND venue_id = ${venue}`;
    if (!rev) return json({ error: "review not found" }, 404);
    const body = (await request.json().catch(() => ({}))) as {
      text?: string;
      templateId?: string;
    };
    const [v] = await sql`SELECT name FROM venues WHERE id = ${venue} LIMIT 1`;
    const venueName = (v?.name as string) || "our venue";
    const loaded = await loadSettings(sql, venue);
    const settings = loaded.settings;

    let text = typeof body.text === "string" ? body.text.trim() : "";
    let ai = false;
    if (!text && body.templateId) {
      const builtin = DEFAULT_REPLY_TEMPLATES.find(
        (t) => t.id === body.templateId,
      );
      if (builtin) {
        text = builtin.body;
      } else if (validUuid(body.templateId)) {
        const [tpl] = await sql`
          SELECT body FROM review_templates
          WHERE id = ${body.templateId} AND venue_id = ${venue}`;
        if (!tpl) return json({ error: "template not found" }, 404);
        text = String(tpl.body);
      } else {
        return json({ error: "template not found" }, 404);
      }
    }
    if (!text) {
      text =
        (await aiChat(
          buildReplyPrompt(
            venueName,
            {
              rating: Number(rev.rating),
              comment: rev.comment as string | null,
            },
            settings.publicRedirectMinRating,
          ),
          env,
        )) ?? "";
      ai = true;
      if (!text) return json({ error: "AI reply unavailable" }, 503);
    }
    text = applyTemplate(text, {
      customerName: rev.customer_name as string | null,
      venueName,
    });

    let googleSynced = false;
    let googleError: string | null = null;
    if (rev.google_review_id && loaded.row?.google_location_name) {
      const pushed = await replyToReview(
        env,
        `${loaded.row.google_location_name}/reviews/${rev.google_review_id}`,
        text,
      );
      googleSynced = pushed.ok;
      if (!pushed.ok) googleError = pushed.error;
    }

    await sql`
      UPDATE reviews SET response = ${text}, response_ai = ${ai}, responded_at = now(),
        response_synced_at = ${googleSynced ? new Date().toISOString() : null}
      WHERE id = ${id} AND venue_id = ${venue}`;
    return json({ ok: true, response: text, ai, googleSynced, googleError });
  }

  return null;
}

// The browser-facing half of the OAuth dance. Google returns the operator here
// with `code` + our signed `state`. We exchange the code for a refresh token and
// show it ONCE so the operator can store it as a secret — it is deliberately
// never written to the database (see db/71 header and the API route rules).
async function googleCallback(
  request: Request,
  env: unknown,
  sql: Sql,
  url: URL,
): Promise<Response> {
  const html = (title: string, body: string, status = 200) =>
    new Response(
      `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
        `<title>${title}</title>` +
        `<body style="font:15px/1.5 system-ui;margin:0;padding:32px;max-width:640px">` +
        `<h1 style="font-size:20px">${title}</h1>${body}` +
        `<p><a href="/dashboard/reviews">Back to Reviews</a></p></body>`,
      { status, headers: { "content-type": "text/html; charset=utf-8" } },
    );

  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  const error = url.searchParams.get("error");
  if (error) return html("Google connection cancelled", `<p>${escapeHtml(error)}</p>`, 400);

  const secret = await getSigningSecret(env);
  if (!secret) return html("Not available", "<p>Signing key unavailable.</p>", 503);
  const claims = await verifyJwt(state, secret);
  if (!claims || claims.purpose !== "google-connect" || typeof claims.venue !== "string") {
    return html("Invalid or expired link", "<p>Start the connection again from the Reviews tab.</p>", 400);
  }
  if (!code) return html("Missing authorization code", "<p>Start again.</p>", 400);

  const base = await getBaseUrl(env);
  const exchanged = await exchangeCode(env, code, googleRedirectUri(base));
  if (!exchanged.ok) {
    return html(
      "Could not complete the connection",
      `<p>${escapeHtml(exchanged.error)}${exchanged.detail ? `: ${escapeHtml(exchanged.detail)}` : ""}</p>`,
      502,
    );
  }
  const refresh = exchanged.data.refresh_token;

  // Record that this venue completed the flow. Only non-secret identifiers.
  try {
    await sql`
      INSERT INTO review_settings (venue_id, google_connected_at)
      VALUES (${claims.venue}, now())
      ON CONFLICT (venue_id) DO UPDATE
        SET google_connected_at = now(), updated_at = now()`;
  } catch {
    /* the operator can still finish by selecting a location */
  }

  if (!refresh) {
    return html(
      "Connected, but Google returned no refresh token",
      "<p>Remove this app from your Google account's third-party access and connect again so Google issues a refresh token.</p>",
      200,
    );
  }
  return html(
    "Google authorised",
    `<p>Store this refresh token as a secret, then choose your location in the Reviews tab. It is shown once and is <strong>not</strong> saved to the database.</p>` +
      `<pre style="white-space:pre-wrap;word-break:break-all;background:#f4f4f5;padding:12px;border-radius:8px">wrangler secret put GOOGLE_BUSINESS_REFRESH_TOKEN</pre>` +
      `<pre style="white-space:pre-wrap;word-break:break-all;background:#f4f4f5;padding:12px;border-radius:8px">${escapeHtml(refresh)}</pre>`,
  );
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
