import type { Sql } from "@/lib/db";
import {
  ROLE_RANK,
  isVenueRole,
  type VenueRole,
} from "@/lib/tenancy";

// The catalogue of scopes an API token can carry. Fine-grained read/write per
// domain. `agent:invoke` grants entry to the A2A surface only; every selected
// tool must still carry the scope for its underlying domain action.
export const API_SCOPES = [
  "orders:read",
  "orders:write",
  "payments:read",
  "payments:write",
  "invoices:read",
  "invoices:write",
  "menu:read",
  "menu:write",
  "inventory:read",
  "inventory:write",
  "retail:read",
  "retail:write",
  "contacts:read",
  "contacts:write",
  "bookings:read",
  "bookings:write",
  "tables:read",
  "tables:write",
  "qr:read",
  "qr:write",
  "messaging:read",
  "messaging:write",
  "campaigns:read",
  "campaigns:write",
  "knowledge:read",
  "knowledge:write",
  "loyalty:read",
  "loyalty:write",
  "reviews:read",
  "reviews:write",
  "tips:read",
  "tips:write",
  "shifts:read",
  "shifts:write",
  "accounting:read",
  "accounting:write",
  "settlement:read",
  "settlement:write",
  "analytics:read",
  "agent:invoke",
] as const;

export type ApiScope = (typeof API_SCOPES)[number];

export function isValidScope(s: string): s is ApiScope {
  return (API_SCOPES as readonly string[]).includes(s);
}

// Tokens can never exceed manager — owner/admin-only surfaces (billing, settings,
// staff, plan) are off-limits to automation, preventing privilege escalation.
const TOKEN_ROLES = ["staff", "supervisor", "manager"] as const;
export type ApiTokenRole = (typeof TOKEN_ROLES)[number];

export function capTokenRole(role: string | undefined): ApiTokenRole {
  return role && (TOKEN_ROLES as readonly string[]).includes(role)
    ? (role as ApiTokenRole)
    : "staff";
}

function lowerTokenRole(
  requested: ApiTokenRole,
  membership: VenueRole,
): ApiTokenRole | null {
  if (!isVenueRole(membership)) return null;
  const membershipRank = ROLE_RANK[membership];
  const allowed = TOKEN_ROLES.filter(
    (role) => ROLE_RANK[role] <= membershipRank,
  );
  return allowed.includes(requested)
    ? requested
    : (allowed[allowed.length - 1] ?? null);
}

const encoder = new TextEncoder();

export async function hashToken(token: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(token)));
  return Array.from(digest)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Mint a fresh token: `pat_` + 40 hex chars. Returns the one-time plaintext, the
// display prefix, and the hash to store. The plaintext is never persisted.
export async function generateApiToken(): Promise<{
  token: string;
  prefix: string;
  hash: string;
}> {
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(20)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const token = `pat_${rand}`;
  return { token, prefix: token.slice(0, 12), hash: await hashToken(token) };
}

export type ApiTokenPrincipal = {
  kind: "api-token";
  sub: string;
  role: ApiTokenRole;
  venue: string;
  scopes: ApiScope[];
  tokenId: string;
  creatorUserId: string;
  creatorEmail: string;
  isApiToken: true;
};

// Resolve a `pat_` bearer token into a request principal, or null if unknown /
// revoked / expired. Bumps last_used_at at most once every 5 minutes (cheap on
// the hot path). Safe against timing: lookup is by the token's own SHA-256 hash.
export async function resolveApiToken(
  sql: Sql,
  token: string,
): Promise<ApiTokenPrincipal | null> {
  if (!token.startsWith("pat_")) return null;
  try {
    const hash = await hashToken(token);
    const [row] = await sql`
      SELECT t.id, t.venue_id, t.role, t.scopes,
             u.id AS creator_user_id, u.email AS creator_email,
             uv.role AS membership_role
      FROM api_tokens t
      JOIN app_users u ON u.id = t.created_by_user_id
      JOIN user_venues uv
        ON uv.user_id = u.id AND uv.venue_id = t.venue_id
      WHERE t.token_hash = ${hash}
        AND t.venue_id IS NOT NULL
        AND t.created_by_user_id IS NOT NULL
        AND t.revoked_at IS NULL
        AND (t.expires_at IS NULL OR t.expires_at > now())
      LIMIT 1`;
    if (!row) return null;
    const membershipRole = String(row.membership_role ?? "");
    if (!isVenueRole(membershipRole)) return null;
    const role = lowerTokenRole(
      capTokenRole(row.role as string),
      membershipRole,
    );
    if (!role) return null;
    const scopes = Array.isArray(row.scopes)
      ? row.scopes.map(String).filter(isValidScope)
      : [];
    if (scopes.length === 0) return null;
    await sql`
      UPDATE api_tokens SET last_used_at = now()
      WHERE id = ${row.id}
        AND (last_used_at IS NULL OR last_used_at < now() - interval '5 minutes')`;
    return {
      kind: "api-token",
      // Keep a non-human subject for compatibility with existing audit fields.
      sub: `token:${row.id}`,
      role,
      venue: String(row.venue_id),
      scopes,
      tokenId: String(row.id),
      creatorUserId: String(row.creator_user_id),
      creatorEmail: String(row.creator_email),
      isApiToken: true,
    };
  } catch {
    return null;
  }
}

// Does this principal carry a scope? Normal human JWT principals are governed by
// role/action policy; API tokens must carry the exact requested scope.
export function tokenHasScope(
  payload: Record<string, unknown> | null,
  scope: ApiScope,
): boolean {
  if (!payload || !(payload as { isApiToken?: boolean }).isApiToken) return true;
  const scopes = (payload.scopes as string[]) ?? [];
  return scopes.includes(scope);
}
