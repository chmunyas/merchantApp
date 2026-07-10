import type { Sql } from "@/lib/db";

// The catalogue of scopes an API token can carry. Fine-grained read/write per
// domain + a blanket `agent` scope for the natural-language A2A surface.
export const API_SCOPES = [
  "orders:read",
  "orders:write",
  "payments:read",
  "payments:write",
  "menu:read",
  "menu:write",
  "contacts:read",
  "contacts:write",
  "bookings:read",
  "bookings:write",
  "analytics:read",
  "agent",
] as const;

export type ApiScope = (typeof API_SCOPES)[number];

export function isValidScope(s: string): s is ApiScope {
  return (API_SCOPES as readonly string[]).includes(s);
}

// Tokens can never exceed manager — owner/admin-only surfaces (billing, settings,
// staff, plan) are off-limits to automation, preventing privilege escalation.
const ROLE_CAP: Record<string, number> = { staff: 1, supervisor: 2, manager: 3 };
export function capTokenRole(role: string | undefined): string {
  return role && ROLE_CAP[role] ? role : "staff";
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
  sub: string;
  role: string;
  venue?: string;
  org?: string;
  scopes: string[];
  tokenId: string;
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
      SELECT id, venue_id, org_id, role, scopes, created_by
      FROM api_tokens
      WHERE token_hash = ${hash}
        AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > now())
      LIMIT 1`;
    if (!row) return null;
    await sql`
      UPDATE api_tokens SET last_used_at = now()
      WHERE id = ${row.id}
        AND (last_used_at IS NULL OR last_used_at < now() - interval '5 minutes')`;
    return {
      sub: (row.created_by as string) || `token:${row.id}`,
      role: capTokenRole(row.role as string),
      venue: (row.venue_id as string) ?? undefined,
      org: (row.org_id as string) ?? undefined,
      scopes: (row.scopes as string[]) ?? [],
      tokenId: String(row.id),
      isApiToken: true,
    };
  } catch {
    return null;
  }
}

// Does this principal carry a scope? Normal (human JWT) principals have no
// `scopes` array → they are NOT scope-limited here (role gating governs them);
// only API-token principals are constrained. `agent` implies every scope.
export function tokenHasScope(
  payload: Record<string, unknown> | null,
  scope: ApiScope,
): boolean {
  if (!payload || !(payload as { isApiToken?: boolean }).isApiToken) return true;
  const scopes = (payload.scopes as string[]) ?? [];
  return scopes.includes("agent") || scopes.includes(scope);
}
