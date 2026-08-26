// C5.2 — the Toast connector.
//
// REAL but INERT without credentials, the same posture as src/lib/google-business.ts:
// every call goes to Toast's actual API, and with no secrets configured each
// function returns `not_configured` so the dashboard renders an explicit
// "not connected" state. Nothing here fabricates a check.
//
// Secrets are environment-only:
//   TOAST_CLIENT_ID       (secret)
//   TOAST_CLIENT_SECRET   (secret)
//   TOAST_API_BASE        (optional; defaults to the production host)
// The venue's restaurant GUID is public routing data and lives in
// `pos_connections.external_location_id`.
//
// Sunday documents none of this exchange — its Toast article covers only the
// operator's dashboard clicks (install the integration, add the tender, enable
// Require Manager Approval, save AND publish). The auth model below is therefore
// our design decision, recorded here rather than implied.

import { envVar } from "@/lib/env";
import { normalizeCheck } from "@/lib/pos/normalize";
import type {
  PosCapability,
  PosCheck,
  PosConnector,
  PosContext,
  PosResult,
  PosVerification,
  TenderPushResult,
} from "@/lib/pos/types";

const DEFAULT_BASE = "https://ws-api.toasttab.com";

const CAPABILITIES: PosCapability[] = [
  "check.pull",
  "tender.push",
  "modifiers",
];

export function toastCredentials(env: unknown): Record<string, string> | null {
  const clientId = envVar(env, "TOAST_CLIENT_ID");
  const clientSecret = envVar(env, "TOAST_CLIENT_SECRET");
  if (!clientId || !clientSecret) return null;
  return {
    clientId,
    clientSecret,
    base: envVar(env, "TOAST_API_BASE") || DEFAULT_BASE,
  };
}

async function accessToken(ctx: PosContext): Promise<PosResult<string>> {
  const { clientId, clientSecret, base } = ctx.credentials;
  if (!clientId || !clientSecret) return { ok: false, error: "not_configured" };
  try {
    const res = await fetch(`${base ?? DEFAULT_BASE}/authentication/v1/authentication/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clientId,
        clientSecret,
        userAccessType: "TOAST_MACHINE_CLIENT",
      }),
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: "unauthorized" };
    }
    if (!res.ok) {
      return { ok: false, error: "provider_error", detail: `login ${res.status}` };
    }
    const body = (await res.json()) as {
      token?: { accessToken?: string };
    };
    const token = body.token?.accessToken;
    if (!token) return { ok: false, error: "provider_error", detail: "no access token" };
    return { ok: true, data: token };
  } catch (err) {
    return {
      ok: false,
      error: "provider_error",
      detail: err instanceof Error ? err.message : "network",
    };
  }
}

async function toastGet<T>(
  ctx: PosContext,
  path: string,
): Promise<PosResult<T>> {
  if (!ctx.externalLocationId) {
    return {
      ok: false,
      error: "misconfigured",
      detail: "no Toast restaurant GUID on the connection",
    };
  }
  const token = await accessToken(ctx);
  if (!token.ok) return token;
  const base = ctx.credentials.base ?? DEFAULT_BASE;
  try {
    const res = await fetch(`${base}${path}`, {
      headers: {
        authorization: `Bearer ${token.data}`,
        "Toast-Restaurant-External-ID": ctx.externalLocationId,
      },
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: "unauthorized" };
    }
    if (res.status === 404) {
      return { ok: false, error: "misconfigured", detail: `not found: ${path}` };
    }
    if (!res.ok) {
      return { ok: false, error: "provider_error", detail: `${path} ${res.status}` };
    }
    return { ok: true, data: (await res.json()) as T };
  } catch (err) {
    return {
      ok: false,
      error: "provider_error",
      detail: err instanceof Error ? err.message : "network",
    };
  }
}

type ToastCheck = Record<string, unknown>;

/**
 * Toast prices are decimal major units. A Toast order carries several checks;
 * each check is one guest bill, which is the unit we reconcile against.
 */
export function mapToastCheck(
  check: ToastCheck,
  order: Record<string, unknown>,
): PosCheck | null {
  const selections = Array.isArray(check.selections) ? check.selections : [];
  const appliedSvc = Array.isArray(check.appliedServiceCharges)
    ? (check.appliedServiceCharges as Array<Record<string, unknown>>)
    : [];
  const table = (order.table ?? {}) as Record<string, unknown>;
  const server = (order.server ?? {}) as Record<string, unknown>;
  const revenueCentre = (order.revenueCenter ?? {}) as Record<string, unknown>;

  return normalizeCheck(
    {
      posBillId: check.guid,
      posCheckNumber: check.displayNumber,
      posTableRef: table.name ?? table.guid ?? null,
      posServerId: server.guid ?? null,
      posServerName:
        [server.firstName, server.lastName].filter(Boolean).join(" ") || null,
      revenueCentre: revenueCentre.name ?? null,
      // Toast has no "service" concept; lunch/dinner is derived from the venue's
      // own service hours (db/67) at read time, never guessed here.
      service: null,
      covers: order.numberOfGuests,
      currency: "USD",
      subtotal: check.amount,
      tax: check.taxAmount,
      serviceCharge: appliedSvc.reduce(
        (sum, entry) => sum + Number(entry.chargeAmount ?? 0),
        0,
      ),
      discount: check.totalDiscountAmount,
      total: check.totalAmount,
      paid: check.paidDate ? check.totalAmount : 0,
      openedAt: check.openedDate ?? order.openedDate,
      closedAt: check.closedDate ?? null,
      lines: selections.map((selection) => {
        const line = (selection ?? {}) as Record<string, unknown>;
        const item = (line.item ?? {}) as Record<string, unknown>;
        return {
          id: line.guid,
          name: line.displayName,
          itemId: item.guid,
          quantity: line.quantity,
          unitPrice: line.preDiscountPrice ?? line.price,
          total: line.price,
          voided: line.voided,
          modifiers: Array.isArray(line.modifiers)
            ? (line.modifiers as Array<Record<string, unknown>>).map((mod) => ({
                name: mod.displayName,
                price: mod.price,
              }))
            : [],
        };
      }),
      raw: check,
    },
    "major",
  );
}

export const toastConnector: PosConnector = {
  provider: "toast",
  capabilities: new Set(CAPABILITIES),
  requiredSecrets: ["TOAST_CLIENT_ID", "TOAST_CLIENT_SECRET"],

  async verify(ctx) {
    const token = await accessToken(ctx);
    if (!token.ok) return token;
    const restaurant = await toastGet<{ general?: { name?: string } }>(
      ctx,
      `/restaurants/v1/restaurants/${encodeURIComponent(ctx.externalLocationId ?? "")}`,
    );
    if (!restaurant.ok) return restaurant;

    // Sunday makes two setup steps mandatory and warns that the integration
    // "will not load properly" if either is unpublished. We cannot read Toast's
    // tender configuration through this API, so the operator asserts it and we
    // say so rather than implying we checked.
    const verification: PosVerification = {
      externalLocationId: ctx.externalLocationId,
      locationName: restaurant.data.general?.name ?? null,
      capabilities: CAPABILITIES,
      warnings: [
        "Confirm the `sunday` payment method exists under Payments → Payment Methods → Other Payment Options, that Require Manager Approval is enabled, and that you clicked Save and then Publish. We cannot read that configuration from Toast.",
      ],
    };
    return { ok: true, data: verification };
  },

  async listOpenChecks(ctx) {
    const since = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
    const orders = await toastGet<Array<Record<string, unknown>>>(
      ctx,
      `/orders/v2/ordersBulk?startDate=${encodeURIComponent(since)}`,
    );
    if (!orders.ok) return orders;
    const checks: PosCheck[] = [];
    for (const order of orders.data ?? []) {
      const list = Array.isArray(order.checks) ? order.checks : [];
      for (const check of list) {
        const mapped = mapToastCheck(check as ToastCheck, order);
        if (mapped && !mapped.closedAt) checks.push(mapped);
      }
    }
    return { ok: true, data: checks };
  },

  async getCheck(ctx, posBillId) {
    const open = await this.listOpenChecks(ctx);
    if (!open.ok) return open;
    return {
      ok: true,
      data: open.data.find((check) => check.posBillId === posBillId) ?? null,
    };
  },

  // C5.6 — the payment lands on the check as one `sunday` other-payment line.
  // Toast keys idempotency off a caller-supplied external id, so a retry whose
  // first response we lost resolves to the same payment rather than a second one.
  async pushTender(ctx, request): Promise<PosResult<TenderPushResult>> {
    if (!ctx.externalLocationId) {
      return { ok: false, error: "misconfigured", detail: "no Toast restaurant GUID" };
    }
    const token = await accessToken(ctx);
    if (!token.ok) return token;
    const base = ctx.credentials.base ?? DEFAULT_BASE;
    try {
      const res = await fetch(
        `${base}/orders/v2/checks/${encodeURIComponent(request.posBillId)}/payments`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token.data}`,
            "Toast-Restaurant-External-ID": ctx.externalLocationId,
            "content-type": "application/json",
            "Toast-Idempotency-Key": request.idempotencyKey,
          },
          body: JSON.stringify({
            amount: request.amountMinor / 100,
            tipAmount: request.tipMinor / 100,
            type: "OTHER",
            otherPayment: { guid: request.posPaymentMethodId },
            paidBusinessDate: null,
            externalId: request.idempotencyKey,
          }),
        },
      );
      if (res.status === 401 || res.status === 403) {
        return { ok: false, error: "unauthorized" };
      }
      if (res.status === 404) {
        return { ok: false, error: "rejected", detail: "check not found on Toast" };
      }
      // A 4xx is Toast telling us this push will never work: a closed check, a
      // tender guid that does not exist. Retrying only delays telling a human.
      if (res.status >= 400 && res.status < 500) {
        return {
          ok: false,
          error: "rejected",
          detail: `toast ${res.status}: ${(await res.text()).slice(0, 200)}`,
        };
      }
      if (!res.ok) {
        return { ok: false, error: "provider_error", detail: `toast ${res.status}` };
      }
      const body = (await res.json()) as {
        guid?: string;
        paymentStatus?: string;
      };
      return {
        ok: true,
        data: {
          posPaymentId: body.guid ?? null,
          checkClosed: body.paymentStatus === "CLOSED",
        },
      };
    } catch (err) {
      return {
        ok: false,
        error: "provider_error",
        detail: err instanceof Error ? err.message : "network",
      };
    }
  },
};
