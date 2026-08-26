import { requireAuth } from "@/api/auth";
import type { ApiScope } from "@/lib/api-tokens";
import { isApiTokenPayload } from "@/lib/principals";
import { type RoutePolicy } from "@/lib/route-policy";
import { roleAtLeast } from "@/lib/rbac";
import { principalVenue } from "@/lib/tenancy";

export type AuthorizedRequestContext = {
  routeId: string;
  action: string;
  params: Readonly<Record<string, string>>;
  principal: Record<string, unknown> | null;
  venue: string | null;
  requestId: string;
};

const contextMemo = new WeakMap<Request, AuthorizedRequestContext>();

export function authorizedRequestContext(
  request: Request,
): AuthorizedRequestContext | null {
  return contextMemo.get(request) ?? null;
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "cache-control": "no-store",
    },
  });
}

function hasAllScopes(
  principal: Record<string, unknown>,
  scopes: readonly ApiScope[],
): boolean {
  const actual = Array.isArray(principal.scopes)
    ? principal.scopes.map(String)
    : [];
  return scopes.every((scope) => actual.includes(scope));
}

function humanHasRequiredRole(
  principal: Record<string, unknown>,
  policy: RoutePolicy,
): boolean {
  if (policy.tenant === "organizationClaim") {
    return principal.role === "reseller_admin" && typeof principal.org === "string";
  }
  if (policy.sensitivity === "platform" && policy.tenant === "global") {
    return principal.role === "admin";
  }
  return policy.minimumVenueRole
    ? roleAtLeast(principal, policy.minimumVenueRole)
    : true;
}

export async function authorizeRouteRequest(
  request: Request,
  env: unknown,
  policy: RoutePolicy,
  params: Readonly<Record<string, string>>,
  requestId: string,
): Promise<Response | null> {
  // Customer/resource tokens and provider/service/cron credentials are currently
  // verified in their specialized handlers because they require raw bodies or
  // database object resolution. The central matcher still classifies them.
  if (
    policy.access === "public" ||
    policy.access === "customer-token" ||
    policy.access === "service" ||
    policy.access === "webhook" ||
    policy.access === "cron-or-human" ||
    policy.access === "development"
  ) {
    const specializedTenantPolicies = new Set([
      "global",
      "publicSelector",
      "publicOrPrincipalVenue",
      "resourceToken",
      "providerAccount",
      "cronScope",
    ]);
    if (!specializedTenantPolicies.has(policy.tenant)) {
      return jsonError("unsupported unauthenticated tenant policy", 500);
    }
    contextMemo.set(request, {
      routeId: policy.id,
      action: policy.id,
      params,
      principal: null,
      venue: null,
      requestId,
    });
    return null;
  }

  const principal = await requireAuth(request, env);
  if (!principal) return jsonError("unauthorized", 401);

  const apiToken = isApiTokenPayload(principal);
  if (policy.access === "human-only" && apiToken) {
    return jsonError("human session required", 403);
  }

  if (apiToken) {
    if (policy.access !== "human-or-api-token") {
      return jsonError("forbidden", 403);
    }
    if (!policy.scopes?.length || !hasAllScopes(principal, policy.scopes)) {
      return jsonError("insufficient token scope", 403);
    }
    if (
      policy.minimumVenueRole &&
      !roleAtLeast(
        { role: principal.role },
        policy.minimumVenueRole,
      )
    ) {
      return jsonError("forbidden", 403);
    }
  } else if (!humanHasRequiredRole(principal, policy)) {
    return jsonError("forbidden", 403);
  }

  const venue =
    policy.tenant === "principalVenue" ? principalVenue(principal) : null;
  if (policy.tenant === "principalVenue" && !venue) {
    return jsonError("venue claim required", 403);
  }
  if (
    ![
      "global",
      "principalVenue",
      "membershipTarget",
      "organizationClaim",
      "adminTarget",
    ].includes(policy.tenant)
  ) {
    return jsonError("unsupported authenticated tenant policy", 500);
  }
  if (policy.tenant === "organizationClaim") {
    if (principal.role !== "reseller_admin" || typeof principal.org !== "string") {
      return jsonError("organization claim required", 403);
    }
  }
  if (policy.tenant === "adminTarget" && principal.role !== "admin") {
    return jsonError("platform admin required", 403);
  }

  contextMemo.set(request, {
    routeId: policy.id,
    action: policy.id,
    params,
    principal,
    venue,
    requestId,
  });
  return null;
}
