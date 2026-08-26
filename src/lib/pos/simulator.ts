// C5.1 — a deterministic in-memory POS, for development and tests only.
//
// This exists so the framework, the pull worker and the guest bill can be
// exercised end to end without a Toast partner account. It is gated by
// `simulatorsAllowed(env)` exactly like the channel simulators, so it can never
// be selected in production.
//
// It is deliberately not a mock of Toast. It returns the shapes our normalizer
// promises, so a test that passes here proves our side of the contract — never
// that a real provider behaves this way.

import { normalizeCheck } from "@/lib/pos/normalize";
import type {
  PosCapability,
  PosCheck,
  PosConnector,
  PosContext,
  PosResult,
  PosVerification,
} from "@/lib/pos/types";

const CAPABILITIES: PosCapability[] = [
  "check.pull",
  "tender.push",
  "modifiers",
  "staff.list",
];

function seededChecks(venue: string): PosCheck[] {
  const openedAt = new Date(Date.now() - 45 * 60 * 1000).toISOString();
  const source = [
    {
      posBillId: `sim-${venue}-1`,
      posCheckNumber: "104",
      posTableRef: "12",
      posServerId: "sim-server-1",
      posServerName: "Amina",
      revenueCentre: "Main Room",
      covers: 2,
      currency: "KES",
      subtotal: 3400,
      tax: 544,
      serviceCharge: 340,
      total: 4284,
      paid: 0,
      openedAt,
      lines: [
        {
          id: "sim-line-1",
          name: "Nyama Choma Platter",
          itemId: "sim-item-1",
          quantity: 1,
          unitPrice: 2200,
          total: 2200,
          category: "Mains",
          modifiers: [{ name: "Extra kachumbari", price: 0 }],
        },
        {
          id: "sim-line-2",
          name: "Tusker",
          itemId: "sim-item-2",
          quantity: 2,
          unitPrice: 600,
          total: 1200,
          category: "Drinks",
        },
      ],
    },
    {
      posBillId: `sim-${venue}-2`,
      posCheckNumber: "105",
      posTableRef: "4",
      posServerId: "sim-server-2",
      posServerName: "Brian",
      revenueCentre: "Terrace",
      covers: 4,
      currency: "KES",
      subtotal: 1800,
      tax: 288,
      serviceCharge: 0,
      total: 2088,
      paid: 1000,
      openedAt,
      lines: [
        {
          id: "sim-line-3",
          name: "Pilau",
          itemId: "sim-item-3",
          quantity: 2,
          unitPrice: 900,
          total: 1800,
          category: "Mains",
        },
      ],
    },
  ];
  return source
    .map((entry) => normalizeCheck(entry, "major"))
    .filter((check): check is PosCheck => check !== null);
}

export const simulatorConnector: PosConnector = {
  provider: "simulator",
  capabilities: new Set(CAPABILITIES),
  requiredSecrets: [],

  async verify(ctx: PosContext): Promise<PosResult<PosVerification>> {
    return {
      ok: true,
      data: {
        externalLocationId: ctx.externalLocationId ?? "simulator",
        locationName: "Simulator restaurant",
        capabilities: CAPABILITIES,
        warnings: [
          "This is the simulator connector. No real POS is connected and no payment will ever reach one.",
        ],
      },
    };
  },

  async listOpenChecks(ctx) {
    return { ok: true, data: seededChecks(ctx.venue) };
  },

  async getCheck(ctx, posBillId) {
    return {
      ok: true,
      data: seededChecks(ctx.venue).find((c) => c.posBillId === posBillId) ?? null,
    };
  },

  async listStaff() {
    return {
      ok: true,
      data: [
        { posUserId: "sim-server-1", name: "Amina" },
        { posUserId: "sim-server-2", name: "Brian" },
      ],
    };
  },

  // A bill id the seed data does not know is rejected, not accepted, so the
  // unsynced-payment path is reachable in development without breaking anything.
  async pushTender(ctx, request) {
    const known = seededChecks(ctx.venue).some(
      (check) => check.posBillId === request.posBillId,
    );
    if (!known) {
      return { ok: false, error: "rejected", detail: "unknown simulator bill" };
    }
    return {
      ok: true,
      data: {
        posPaymentId: `sim-pay-${request.idempotencyKey}`,
        checkClosed: true,
      },
    };
  },
};
