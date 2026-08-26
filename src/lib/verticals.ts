// The commercial model: what a venue is (vertical) and what it has paid for (tier).
//
// Two rules carry the whole design and they are deliberately different:
//
//   * VERTICAL is a DEFAULT. It decides what a venue sees out of the box. A
//     restaurant does not want a Retail counter in its sidebar. But a café that
//     also sells beans genuinely does, so a vertical default can be overridden.
//
//   * TIER is a LIMIT. It decides what a venue is entitled to. An override can
//     never buy a capability the plan does not include — otherwise the paywall
//     is decoration and the plan means nothing.
//
// Everything here is pure so the same answer is produced on the server (route
// enforcement) and in the browser (navigation), from one catalogue.

export const MERCHANT_VERTICALS = [
  "restaurant",
  "retail",
  "services",
  "hospitality",
] as const;

export type MerchantVertical = (typeof MERCHANT_VERTICALS)[number];

export const SUBSCRIPTION_TIERS = [
  "free",
  "starter",
  "growth",
  "enterprise",
] as const;

export type SubscriptionTier = (typeof SUBSCRIPTION_TIERS)[number];

const TIER_RANK: Record<SubscriptionTier, number> = {
  free: 0,
  starter: 1,
  growth: 2,
  enterprise: 3,
};

export type CapabilityGroup =
  | "Insights"
  | "Operations"
  | "Bookings"
  | "Sales"
  | "Engage"
  | "Setup";

export type Capability = {
  key: string;
  label: string;
  group: CapabilityGroup;
  /** `"all"` means every vertical gets it by default. */
  verticals: "all" | readonly MerchantVertical[];
  minTier: SubscriptionTier;
  /** The dashboard route this capability governs, when it owns one. */
  path?: string;
};

export const CAPABILITIES: readonly Capability[] = [
  // --- Insights ---
  { key: "core.overview", label: "Overview", group: "Insights", verticals: "all", minTier: "free", path: "/dashboard" },
  { key: "insights.copilot", label: "Copilot", group: "Insights", verticals: "all", minTier: "growth", path: "/dashboard/copilot" },
  { key: "insights.analytics", label: "Analytics", group: "Insights", verticals: "all", minTier: "starter", path: "/dashboard/analytics" },
  { key: "insights.forecast", label: "Forecast", group: "Insights", verticals: "all", minTier: "growth", path: "/dashboard/forecast" },
  { key: "insights.pricing", label: "Pricing intelligence", group: "Insights", verticals: ["restaurant", "retail", "hospitality"], minTier: "growth", path: "/dashboard/pricing" },
  { key: "core.multistore", label: "Chain view", group: "Insights", verticals: "all", minTier: "growth", path: "/dashboard/chain" },

  // --- Operations ---
  { key: "restaurant.kds", label: "Orders (KDS)", group: "Operations", verticals: ["restaurant", "hospitality"], minTier: "starter", path: "/dashboard/orders" },
  { key: "restaurant.tables", label: "Tables", group: "Operations", verticals: ["restaurant", "hospitality"], minTier: "starter", path: "/dashboard/tables" },
  { key: "restaurant.floorplan", label: "Floorplan", group: "Operations", verticals: ["restaurant", "hospitality"], minTier: "growth", path: "/dashboard/floorplan" },
  { key: "restaurant.walkouts", label: "Walkouts", group: "Operations", verticals: ["restaurant", "hospitality"], minTier: "growth", path: "/dashboard/walkouts" },
  { key: "core.guestrequests", label: "Guest requests", group: "Operations", verticals: "all", minTier: "starter", path: "/dashboard/guest-requests" },

  // --- Bookings ---
  { key: "services.bookings", label: "Bookings", group: "Bookings", verticals: ["restaurant", "services", "hospitality"], minTier: "starter", path: "/dashboard/bookings" },
  { key: "services.enquiries", label: "Enquiries", group: "Bookings", verticals: "all", minTier: "free", path: "/dashboard/enquiries" },
  { key: "services.deposits", label: "Deposits", group: "Bookings", verticals: ["restaurant", "services", "hospitality"], minTier: "growth", path: "/dashboard/deposits" },

  // --- Sales ---
  { key: "core.payments", label: "Payments", group: "Sales", verticals: "all", minTier: "free", path: "/dashboard/payments" },
  { key: "core.paymentmethods", label: "Payment methods", group: "Sales", verticals: "all", minTier: "free", path: "/dashboard/payment-methods" },
  { key: "core.invoices", label: "Invoices", group: "Sales", verticals: "all", minTier: "starter", path: "/dashboard/invoices" },
  { key: "core.reports", label: "Notebook", group: "Sales", verticals: "all", minTier: "starter", path: "/dashboard/reports" },
  { key: "core.settlement", label: "Settlement", group: "Sales", verticals: "all", minTier: "starter", path: "/dashboard/settlement" },
  { key: "core.fees", label: "Fees", group: "Sales", verticals: "all", minTier: "starter", path: "/dashboard/fees" },
  { key: "core.disputes", label: "Disputes", group: "Sales", verticals: "all", minTier: "growth", path: "/dashboard/disputes" },
  { key: "core.accounting", label: "Accounting", group: "Sales", verticals: "all", minTier: "growth", path: "/dashboard/accounting" },
  { key: "retail.counter", label: "Retail counter", group: "Sales", verticals: ["retail"], minTier: "starter", path: "/dashboard/retail" },
  { key: "retail.inventory", label: "Inventory", group: "Sales", verticals: ["retail", "restaurant", "hospitality"], minTier: "starter", path: "/dashboard/inventory" },
  { key: "retail.reorder", label: "Reorder", group: "Sales", verticals: ["retail", "restaurant"], minTier: "growth", path: "/dashboard/reorder" },
  { key: "services.catalogue", label: "Services", group: "Sales", verticals: ["services"], minTier: "starter", path: "/dashboard/services" },

  // --- Engage ---
  { key: "engage.inbox", label: "Inbox", group: "Engage", verticals: "all", minTier: "starter", path: "/dashboard/inbox" },
  { key: "core.contacts", label: "Contacts", group: "Engage", verticals: "all", minTier: "free", path: "/dashboard/contacts" },
  { key: "engage.retention", label: "Retention", group: "Engage", verticals: "all", minTier: "growth", path: "/dashboard/retention" },
  { key: "engage.knowledge", label: "Knowledge", group: "Engage", verticals: "all", minTier: "growth", path: "/dashboard/knowledge" },
  { key: "engage.automations", label: "Automations", group: "Engage", verticals: "all", minTier: "growth", path: "/dashboard/automations" },
  { key: "engage.promos", label: "Promos", group: "Engage", verticals: "all", minTier: "starter", path: "/dashboard/promos" },
  { key: "engage.reviews", label: "Reviews", group: "Engage", verticals: "all", minTier: "starter", path: "/dashboard/reviews" },
  { key: "engage.loyalty", label: "Rewards", group: "Engage", verticals: "all", minTier: "starter", path: "/dashboard/rewards" },

  // --- Setup ---
  { key: "restaurant.menu", label: "Menu", group: "Setup", verticals: ["restaurant", "hospitality"], minTier: "starter", path: "/dashboard/menu" },
  { key: "core.qr", label: "QR codes", group: "Setup", verticals: "all", minTier: "free", path: "/dashboard/qr" },
  { key: "core.staff", label: "Staff", group: "Setup", verticals: "all", minTier: "starter", path: "/dashboard/staff" },
  { key: "core.team", label: "Team", group: "Setup", verticals: "all", minTier: "free", path: "/dashboard/team" },
  { key: "engage.whatsapp", label: "WhatsApp", group: "Setup", verticals: "all", minTier: "starter", path: "/dashboard/whatsapp" },
  { key: "engage.telegram", label: "Telegram", group: "Setup", verticals: "all", minTier: "growth", path: "/dashboard/telegram" },
  { key: "core.settings", label: "Settings", group: "Setup", verticals: "all", minTier: "free", path: "/dashboard/settings" },
  { key: "core.billing", label: "Billing", group: "Setup", verticals: "all", minTier: "free", path: "/dashboard/billing" },
  { key: "core.apikeys", label: "API keys", group: "Setup", verticals: "all", minTier: "growth", path: "/dashboard/api-keys" },
] as const;

const BY_KEY = new Map(CAPABILITIES.map((c) => [c.key, c]));
const BY_PATH = new Map(
  CAPABILITIES.filter((c) => c.path).map((c) => [c.path as string, c]),
);

export function isMerchantVertical(value: unknown): value is MerchantVertical {
  return (
    typeof value === "string" &&
    (MERCHANT_VERTICALS as readonly string[]).includes(value)
  );
}

export function isSubscriptionTier(value: unknown): value is SubscriptionTier {
  return (
    typeof value === "string" &&
    (SUBSCRIPTION_TIERS as readonly string[]).includes(value)
  );
}

/** `hospital` was an aspirational label for what is really hospitality. */
export function normalizeVertical(value: unknown): MerchantVertical {
  if (value === "hospital") return "hospitality";
  return isMerchantVertical(value) ? value : "restaurant";
}

export function normalizeTier(value: unknown): SubscriptionTier {
  return isSubscriptionTier(value) ? value : "free";
}

export function tierAtLeast(
  actual: SubscriptionTier,
  minimum: SubscriptionTier,
): boolean {
  return TIER_RANK[actual] >= TIER_RANK[minimum];
}

export function capabilityByKey(key: string): Capability | null {
  return BY_KEY.get(key) ?? null;
}

/** Longest-prefix match, so `/dashboard/menu/123` still resolves to the menu. */
export function capabilityForPath(pathname: string): Capability | null {
  const exact = BY_PATH.get(pathname);
  if (exact) return exact;
  let best: Capability | null = null;
  for (const [path, capability] of BY_PATH) {
    if (path === "/dashboard") continue;
    if (!pathname.startsWith(`${path}/`)) continue;
    if (!best || path.length > (best.path as string).length) best = capability;
  }
  return best;
}

export type VenueProfile = {
  vertical: MerchantVertical;
  tier: SubscriptionTier;
  /** Explicit per-venue opt-in/opt-out, applied on top of the vertical default. */
  overrides?: Readonly<Record<string, boolean>>;
};

function includedByVertical(
  capability: Capability,
  vertical: MerchantVertical,
): boolean {
  return (
    capability.verticals === "all" || capability.verticals.includes(vertical)
  );
}

export function canUseCapability(key: string, profile: VenueProfile): boolean {
  const capability = BY_KEY.get(key);
  if (!capability) return false;
  // The paywall is absolute: an override cannot buy an unentitled capability.
  if (!tierAtLeast(profile.tier, capability.minTier)) return false;
  const override = profile.overrides?.[key];
  if (typeof override === "boolean") return override;
  return includedByVertical(capability, profile.vertical);
}

export function resolveCapabilities(profile: VenueProfile): Set<string> {
  const enabled = new Set<string>();
  for (const capability of CAPABILITIES) {
    if (canUseCapability(capability.key, profile)) enabled.add(capability.key);
  }
  return enabled;
}

/** What the owner may toggle: everything their tier entitles them to. */
export function offerableCapabilities(
  profile: VenueProfile,
): readonly Capability[] {
  return CAPABILITIES.filter((c) => tierAtLeast(profile.tier, c.minTier));
}

/** Capabilities withheld purely by plan — the upgrade prompt. */
export function upgradeLockedCapabilities(
  profile: VenueProfile,
): readonly Capability[] {
  return CAPABILITIES.filter(
    (c) =>
      !tierAtLeast(profile.tier, c.minTier) &&
      includedByVertical(c, profile.vertical),
  );
}
