// Google Business Profile client (roadmap D6.3 / D6.5).
//
// This code is REAL but INERT without credentials. Every call goes to the actual
// Google endpoint; when the OAuth secrets are absent each function returns
// `{ ok: false, error: "not_configured" }` and the caller degrades to a clear
// "not connected" state. Nothing here fabricates a review, a location or a
// reply — an unconfigured venue simply has no Google data.
//
// Credentials are environment secrets ONLY:
//   GOOGLE_OAUTH_CLIENT_ID       (secret)
//   GOOGLE_OAUTH_CLIENT_SECRET   (secret)
//   GOOGLE_BUSINESS_REFRESH_TOKEN(secret)  — issued by the connect flow below
// The database stores only public identifiers (place id, account/location
// resource names). See db/71-reputation.sql.

import { envVar } from "@/lib/env";

export const GOOGLE_BUSINESS_SCOPE =
  "https://www.googleapis.com/auth/business.manage";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const ACCOUNTS_API = "https://mybusinessaccountmanagement.googleapis.com/v1";
const INFO_API = "https://mybusinessbusinessinformation.googleapis.com/v1";
const REVIEWS_API = "https://mybusiness.googleapis.com/v4";

export type GoogleResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: "not_configured" | "not_connected" | "google_error"; detail?: string };

export type GoogleOAuthConfig = {
  clientId: string;
  clientSecret: string;
};

export function googleOAuthConfig(env: unknown): GoogleOAuthConfig | null {
  const clientId = envVar(env, "GOOGLE_OAUTH_CLIENT_ID");
  const clientSecret = envVar(env, "GOOGLE_OAUTH_CLIENT_SECRET");
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

// The long-lived credential the connect flow produces. Stored as a secret by the
// operator, never written to the database.
export function googleRefreshToken(env: unknown): string | null {
  return envVar(env, "GOOGLE_BUSINESS_REFRESH_TOKEN") ?? null;
}

export function googleRedirectUri(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/api/reviews/google/callback`;
}

export function buildAuthorizeUrl(
  config: GoogleOAuthConfig,
  redirectUri: string,
  state: string,
): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_BUSINESS_SCOPE,
    access_type: "offline",
    include_granted_scopes: "true",
    // Force a refresh token even when the operator has consented before.
    prompt: "consent",
    state,
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

async function tokenRequest(
  body: URLSearchParams,
): Promise<GoogleResult<{ access_token: string; refresh_token?: string; expires_in?: number }>> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const text = await res.text();
  if (!res.ok) {
    return { ok: false, error: "google_error", detail: text.slice(0, 300) };
  }
  try {
    return { ok: true, data: JSON.parse(text) };
  } catch {
    return { ok: false, error: "google_error", detail: "unparseable token response" };
  }
}

export async function exchangeCode(
  env: unknown,
  code: string,
  redirectUri: string,
): Promise<GoogleResult<{ access_token: string; refresh_token?: string }>> {
  const config = googleOAuthConfig(env);
  if (!config) return { ok: false, error: "not_configured" };
  return tokenRequest(
    new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  );
}

// Exchange the stored refresh-token secret for a short-lived access token.
// Returns `not_connected` when the operator has not yet set the secret.
export async function accessToken(env: unknown): Promise<GoogleResult<string>> {
  const config = googleOAuthConfig(env);
  if (!config) return { ok: false, error: "not_configured" };
  const refresh = googleRefreshToken(env);
  if (!refresh) return { ok: false, error: "not_connected" };
  const res = await tokenRequest(
    new URLSearchParams({
      refresh_token: refresh,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "refresh_token",
    }),
  );
  if (!res.ok) return res;
  if (!res.data.access_token) {
    return { ok: false, error: "google_error", detail: "no access_token" };
  }
  return { ok: true, data: res.data.access_token };
}

async function apiGet<T>(
  env: unknown,
  url: string,
): Promise<GoogleResult<T>> {
  const token = await accessToken(env);
  if (!token.ok) return token;
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${token.data}` },
  });
  const text = await res.text();
  if (!res.ok) {
    return { ok: false, error: "google_error", detail: text.slice(0, 300) };
  }
  try {
    return { ok: true, data: JSON.parse(text) as T };
  } catch {
    return { ok: false, error: "google_error", detail: "unparseable response" };
  }
}

export type GoogleAccount = { name: string; accountName?: string };
export type GoogleLocation = {
  name: string;
  title?: string;
  metadata?: { placeId?: string };
};
export type GoogleReview = {
  name?: string;
  reviewId?: string;
  reviewer?: { displayName?: string };
  starRating?: string;
  comment?: string;
  createTime?: string;
  reviewReply?: { comment?: string; updateTime?: string };
};

const STAR_WORDS: Record<string, number> = {
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  FIVE: 5,
};

export function starRatingToNumber(value: string | undefined): number | null {
  return STAR_WORDS[String(value ?? "").toUpperCase()] ?? null;
}

export async function listAccounts(
  env: unknown,
): Promise<GoogleResult<GoogleAccount[]>> {
  const res = await apiGet<{ accounts?: GoogleAccount[] }>(
    env,
    `${ACCOUNTS_API}/accounts`,
  );
  return res.ok ? { ok: true, data: res.data.accounts ?? [] } : res;
}

// `account` is a resource name like "accounts/123456789".
export async function listLocations(
  env: unknown,
  account: string,
): Promise<GoogleResult<GoogleLocation[]>> {
  const url = `${INFO_API}/${account}/locations?readMask=name,title,metadata&pageSize=100`;
  const res = await apiGet<{ locations?: GoogleLocation[] }>(env, url);
  return res.ok ? { ok: true, data: res.data.locations ?? [] } : res;
}

// `location` is "accounts/{a}/locations/{l}". Reviews still live on the legacy
// v4 surface — there is no v1 replacement.
export async function listReviews(
  env: unknown,
  location: string,
): Promise<GoogleResult<GoogleReview[]>> {
  const res = await apiGet<{ reviews?: GoogleReview[] }>(
    env,
    `${REVIEWS_API}/${location}/reviews?pageSize=50`,
  );
  return res.ok ? { ok: true, data: res.data.reviews ?? [] } : res;
}

// `reviewName` is the full "accounts/{a}/locations/{l}/reviews/{r}" resource.
export async function replyToReview(
  env: unknown,
  reviewName: string,
  comment: string,
): Promise<GoogleResult<{ comment?: string }>> {
  const token = await accessToken(env);
  if (!token.ok) return token;
  const res = await fetch(`${REVIEWS_API}/${reviewName}/reply`, {
    method: "PUT",
    headers: {
      authorization: `Bearer ${token.data}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ comment }),
  });
  const text = await res.text();
  if (!res.ok) {
    return { ok: false, error: "google_error", detail: text.slice(0, 300) };
  }
  try {
    return { ok: true, data: JSON.parse(text) as { comment?: string } };
  } catch {
    return { ok: true, data: {} };
  }
}
