// C5.1 — the POS connector contract.
//
// Every provider is reached through this one interface so that the rest of the
// app never learns a vendor's name. Two ideas carry the design:
//
//  1. **Capabilities are declared, not assumed.** A connector states what it can
//     do and the product degrades out loud. Sunday publishes that line-by-line
//     reconciliation simply does not work on Clover, Comtrex, PI Electronique or
//     Zonal, and that menu sync covers only some providers; a venue on one of
//     those must be told, not silently served an empty report.
//
//  2. **Knowing a POS and being able to talk to it are different facts.** A
//     provider can have a published capability profile with no implementation
//     yet. `POS_PROVIDERS` answers "what would this POS give us"; the registry
//     answers "can we actually connect today". Conflating them is how a roadmap
//     starts lying.
//
// Money is in minor units throughout. Credentials never appear in this file's
// types: a connector receives them from the environment at call time.

export const POS_CAPABILITIES = [
  "check.pull",
  "tender.push",
  "tender.void",
  "menu.sync",
  "reconciliation.export",
  "staff.list",
  "modifiers",
] as const;

export type PosCapability = (typeof POS_CAPABILITIES)[number];

export type PosProvider =
  | "toast"
  | "ncr_aloha"
  | "res3700"
  | "simphony"
  | "lightspeed"
  | "laddition"
  | "zelty"
  | "trivec"
  | "tevalis"
  | "cashpad"
  | "carrepos"
  | "positouch"
  | "clover"
  | "comtrex"
  | "pi_electronique"
  | "zonal"
  | "simulator";

export type PosConnectionStatus = "draft" | "connected" | "disabled" | "error";

/** A check pulled from the POS, normalized. All amounts are minor units. */
export type PosCheck = {
  posBillId: string;
  posCheckNumber: string | null;
  posTableRef: string | null;
  posServerId: string | null;
  posServerName: string | null;
  revenueCentre: string | null;
  service: string | null;
  /** Guest count. The denominator for revenue-per-guest and adoption. */
  covers: number | null;
  currency: string;
  subtotalMinor: number;
  taxMinor: number;
  /** Auto-gratuity. Drives the A3.2 tip tiers, which have had no source until now. */
  serviceChargeMinor: number;
  discountMinor: number;
  totalMinor: number;
  paidMinor: number;
  openedAt: string | null;
  closedAt: string | null;
  lines: PosCheckLine[];
  /** The provider's original payload, kept so a mapping bug stays diagnosable. */
  raw: Record<string, unknown>;
};

export type PosCheckLine = {
  posLineId: string;
  posItemId: string | null;
  name: string;
  category: string | null;
  qty: number;
  unitPriceMinor: number;
  totalMinor: number;
  /** Add-ons owned by the POS ("Size: Large"). Retrieved, never authored here. */
  modifiers: PosModifier[];
  voided: boolean;
};

export type PosModifier = {
  name: string;
  priceMinor: number;
};

export type PosCashier = {
  posUserId: string;
  name: string;
};

/**
 * One Sunday payment, going onto one POS check as one tender line.
 *
 * `amountMinor` is subtotal + tip and EXCLUDES the guest's digital fee: the
 * guest pays that to us, not to the venue, and pushing it would overstate the
 * check. `idempotencyKey` is the payment id, so a retry can never double-tender
 * even if the provider accepted a call whose response we lost.
 */
export type TenderPushRequest = {
  posBillId: string;
  posPaymentMethodId: string;
  amountMinor: number;
  tipMinor: number;
  currency: string;
  idempotencyKey: string;
};

export type TenderPushResult = {
  posPaymentId: string | null;
  /** True when the POS reports the check settled and closed by this tender. */
  checkClosed: boolean;
};

/**
 * What a connector is handed per call. `credentials` is read from Worker secrets
 * by the caller; it is never persisted and never logged.
 */
export type PosContext = {
  venue: string;
  connectionId: string;
  externalLocationId: string | null;
  config: Record<string, unknown>;
  credentials: Record<string, string>;
};

export type PosFailure =
  /** No connector implementation exists for this provider yet. */
  | "not_implemented"
  /** The operator has not supplied the provider secrets. */
  | "not_configured"
  /** Credentials present but rejected by the provider. */
  | "unauthorized"
  /** The venue's setup is incomplete on the provider's side. */
  | "misconfigured"
  /** The connector cannot do this at all on this provider. */
  | "unsupported"
  /** The POS refused this specific push and will refuse the retry too. */
  | "rejected"
  | "provider_error";

/**
 * Whether trying again could plausibly succeed. A `rejected` push or a
 * `misconfigured` venue will fail identically forever, so retrying it only
 * delays the moment a human is told — which for an unsynced payment is the
 * only thing that actually fixes it.
 */
export function isRetryable(error: PosFailure): boolean {
  return error === "provider_error" || error === "not_configured";
}

export type PosResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: PosFailure; detail?: string };

export type PosVerification = {
  externalLocationId: string | null;
  locationName: string | null;
  capabilities: PosCapability[];
  /**
   * Setup problems the connector could detect but must not fix silently — e.g.
   * Toast's `Require Manager Approval` being off on the sunday tender, which
   * Sunday makes a hard instruction. Surfaced to the operator verbatim.
   */
  warnings: string[];
};

export interface PosConnector {
  readonly provider: PosProvider;
  /** What this connector implements. Never wider than the provider's profile. */
  readonly capabilities: ReadonlySet<PosCapability>;
  /** Which env secrets must be present before any call is attempted. */
  readonly requiredSecrets: readonly string[];
  verify(ctx: PosContext): Promise<PosResult<PosVerification>>;
  listOpenChecks(ctx: PosContext): Promise<PosResult<PosCheck[]>>;
  getCheck(ctx: PosContext, posBillId: string): Promise<PosResult<PosCheck | null>>;
  pushTender?(
    ctx: PosContext,
    request: TenderPushRequest,
  ): Promise<PosResult<TenderPushResult>>;
  voidTender?(ctx: PosContext, posPaymentId: string): Promise<PosResult<true>>;
  listStaff?(ctx: PosContext): Promise<PosResult<PosCashier[]>>;
}

/**
 * Published capability profile per provider — what the POS could give us, before
 * any question of whether a connector exists.
 *
 * `reconciliation.export` is false for exactly the four providers Sunday names as
 * incompatible. `menu.sync` is true only where Sunday names it; its published
 * list is truncated mid-sentence at "Toast, NCR Aloha," so anything beyond those
 * two would be a guess, and a guess here becomes a broken promise in the UI.
 */
export const POS_PROVIDERS: Record<
  PosProvider,
  { label: string; via?: string; capabilities: PosCapability[] }
> = {
  toast: {
    label: "Toast",
    capabilities: [
      "check.pull",
      "tender.push",
      "tender.void",
      "menu.sync",
      "reconciliation.export",
      "staff.list",
      "modifiers",
    ],
  },
  ncr_aloha: {
    label: "NCR Aloha",
    via: "Omnivore",
    capabilities: [
      "check.pull",
      "tender.push",
      "tender.void",
      "menu.sync",
      "reconciliation.export",
      "staff.list",
      "modifiers",
    ],
  },
  res3700: {
    label: "Res3700",
    via: "Omnivore",
    capabilities: ["check.pull", "tender.push", "reconciliation.export", "modifiers"],
  },
  simphony: {
    label: "Oracle Simphony",
    via: "Omnivore",
    capabilities: ["check.pull", "tender.push", "reconciliation.export", "modifiers"],
  },
  lightspeed: {
    label: "Lightspeed / iKentoo",
    capabilities: ["check.pull", "tender.push", "reconciliation.export", "modifiers"],
  },
  laddition: {
    label: "L'addition",
    capabilities: ["check.pull", "tender.push", "reconciliation.export", "modifiers"],
  },
  zelty: {
    label: "Zelty",
    capabilities: ["check.pull", "tender.push", "reconciliation.export", "modifiers"],
  },
  trivec: {
    label: "Trivec",
    capabilities: ["check.pull", "tender.push", "reconciliation.export", "modifiers"],
  },
  tevalis: {
    label: "Tevalis",
    capabilities: ["check.pull", "tender.push", "reconciliation.export", "modifiers"],
  },
  cashpad: {
    label: "Cashpad",
    capabilities: ["check.pull", "tender.push", "reconciliation.export", "modifiers"],
  },
  carrepos: {
    label: "CarréPOS",
    capabilities: ["check.pull", "tender.push", "reconciliation.export", "modifiers"],
  },
  positouch: {
    label: "Positouch",
    capabilities: ["check.pull", "tender.push", "reconciliation.export", "modifiers"],
  },
  // The four Sunday names as incompatible with line-by-line reconciliation.
  clover: {
    label: "Clover",
    capabilities: ["check.pull", "tender.push", "modifiers"],
  },
  comtrex: {
    label: "Comtrex",
    capabilities: ["check.pull", "tender.push"],
  },
  pi_electronique: {
    label: "PI Electronique",
    capabilities: ["check.pull", "tender.push"],
  },
  zonal: {
    label: "Zonal",
    capabilities: ["check.pull", "tender.push"],
  },
  simulator: {
    label: "Simulator (non-production)",
    capabilities: [
      "check.pull",
      "tender.push",
      "tender.void",
      "staff.list",
      "modifiers",
    ],
  },
};

export function isPosProvider(value: unknown): value is PosProvider {
  return typeof value === "string" && value in POS_PROVIDERS;
}

export function providerCapabilities(provider: PosProvider): Set<PosCapability> {
  return new Set(POS_PROVIDERS[provider].capabilities);
}

/**
 * What the venue is told when a capability is missing. The distinction matters:
 * "your POS cannot do this" is permanent and the merchant should stop waiting,
 * "we have not built it yet" is ours to fix.
 */
export type CapabilityVerdict =
  | { available: true }
  | { available: false; reason: "provider" | "connector"; message: string };

export function capabilityVerdict(
  provider: PosProvider,
  connector: PosConnector | null,
  capability: PosCapability,
): CapabilityVerdict {
  const label = POS_PROVIDERS[provider].label;
  if (!providerCapabilities(provider).has(capability)) {
    return {
      available: false,
      reason: "provider",
      message: `${label} does not support this. It is not a setting you can turn on.`,
    };
  }
  if (!connector || !connector.capabilities.has(capability)) {
    return {
      available: false,
      reason: "connector",
      message: `${label} supports this, but our connector does not implement it yet.`,
    };
  }
  return { available: true };
}
