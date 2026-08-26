import type { ApiScope, ApiTokenPrincipal } from "@/lib/api-tokens";
import {
  isAppRole,
  type AppRole,
  type OrganizationRole,
  type PlatformRole,
  type VenueRole,
} from "@/lib/tenancy";

export type HumanJwtPrincipal = {
  kind: "human-jwt";
  sub: string;
  role: AppRole;
  venue?: string;
  org?: string;
  staff_id?: string;
  staffId?: string;
  staffCredentialVersion?: number;
  plan?: string;
  name?: string;
};

export type CustomerTokenPrincipal = {
  kind: "customer-token";
  tokenKind:
    | "portal"
    | "qr-code"
    | "order-pay"
    | "pay-link"
    | "invoice-pay"
    | "payment-status"
    | "chat-session"
    | "push-device";
  tokenId: string;
  venue: string;
  customerId?: string;
  expiresAt?: string;
};

export type ServicePrincipal = {
  kind: "service";
  serviceId: string;
  scopes: readonly string[];
  venue?: string;
  accountId?: string;
};

export type WebhookPrincipal = {
  kind: "webhook";
  provider: string;
  accountId?: string;
  venue?: string;
  eventId?: string;
};

export type CronPrincipal = {
  kind: "cron";
  jobId: string;
  venues: readonly string[];
};

export type RequestPrincipal =
  | HumanJwtPrincipal
  | ApiTokenPrincipal
  | CustomerTokenPrincipal
  | ServicePrincipal
  | WebhookPrincipal
  | CronPrincipal;

export type VenueRoleRequirement = {
  domain: "venue";
  minimum: VenueRole;
};

export type ExactRoleRequirement =
  | { domain: "platform"; role: PlatformRole }
  | { domain: "organization"; role: OrganizationRole };

export type RoleRequirement = VenueRoleRequirement | ExactRoleRequirement;

export function isApiTokenPayload(
  payload: Record<string, unknown> | null,
): payload is Record<string, unknown> & { isApiToken: true } {
  return payload?.isApiToken === true;
}

export function isHumanPayload(
  payload: Record<string, unknown> | null,
): boolean {
  return Boolean(payload && !isApiTokenPayload(payload) && isAppRole(payload.role));
}

export function humanPrincipalFromPayload(
  payload: Record<string, unknown> | null,
): HumanJwtPrincipal | null {
  if (!payload || isApiTokenPayload(payload) || !isAppRole(payload.role)) {
    return null;
  }
  const sub = typeof payload.sub === "string" ? payload.sub.trim() : "";
  if (!sub) return null;
  return {
    kind: "human-jwt",
    sub,
    role: payload.role,
    venue: typeof payload.venue === "string" ? payload.venue : undefined,
    org: typeof payload.org === "string" ? payload.org : undefined,
    staff_id:
      typeof payload.staff_id === "string" ? payload.staff_id : undefined,
    staffId:
      typeof payload.staff_id === "string" ? payload.staff_id : undefined,
    staffCredentialVersion:
      typeof payload.staff_credential_version === "number"
        ? payload.staff_credential_version
        : undefined,
    plan: typeof payload.plan === "string" ? payload.plan : undefined,
    name: typeof payload.name === "string" ? payload.name : undefined,
  };
}

export function hasApiScope(
  principal: RequestPrincipal,
  scope: ApiScope,
): boolean {
  return principal.kind === "api-token" && principal.scopes.includes(scope);
}
