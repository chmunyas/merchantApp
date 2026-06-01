export type MerchantVertical =
  | "restaurant"
  | "retail"
  | "services"
  | "hospital";
export type MerchantStatus = "pending" | "active" | "suspended";
export type SubscriptionTier = "free" | "starter" | "growth" | "enterprise";

export type MerchantAccount = {
  id: string;
  businessName: string;
  ownerName: string;
  phone: string;
  email: string;
  vertical: MerchantVertical;
  status: MerchantStatus;
  tier: SubscriptionTier;
  location: string;
  features: Record<string, boolean>;
  onboardedAt: string;
  lastLoginAt?: string;
  notes?: string;
};

export type FeatureFlag = {
  key: string;
  name: string;
  description: string;
  category: string;
  defaultEnabled: boolean;
  tierMinimum: SubscriptionTier;
};

export type AdminActivity = {
  id: string;
  adminEmail: string;
  action: string;
  targetMerchant?: string;
  details: string;
  timestamp: string;
};

export type MerchantUsageStats = {
  transactions: number;
  revenue: number;
  activeStaff: number;
  catalogueItems: number;
  featureUsage: number;
  lastTransactionAt: string;
};

type AdminSession = {
  email: string;
  token: string;
};

const STORAGE_KEYS = {
  session: "pesaswap.admin.session",
  merchants: "pesaswap.admin.merchants",
  activity: "pesaswap.admin.activity",
  globalFeatures: "pesaswap.admin.global-features",
} as const;

const DEMO_ADMIN = {
  email: "admin@pesaswap.io",
  password: "admin123",
} as const;

const TIER_ORDER: SubscriptionTier[] = [
  "free",
  "starter",
  "growth",
  "enterprise",
];

const FEATURE_FLAGS: FeatureFlag[] = [
  {
    key: "payments.mpesa",
    name: "M-Pesa Payments",
    description: "M-Pesa STK Push payments",
    category: "Payments",
    defaultEnabled: true,
    tierMinimum: "free",
  },
  {
    key: "payments.card",
    name: "Card Payments",
    description: "Card payments",
    category: "Payments",
    defaultEnabled: true,
    tierMinimum: "free",
  },
  {
    key: "payments.bnpl",
    name: "Co-op BNPL",
    description: "Co-op Bank BNPL",
    category: "Payments",
    defaultEnabled: false,
    tierMinimum: "enterprise",
  },
  {
    key: "payments.split",
    name: "Bill Splitting",
    description: "Bill splitting",
    category: "Payments",
    defaultEnabled: true,
    tierMinimum: "starter",
  },
  {
    key: "restaurant.menu",
    name: "Menu Management",
    description: "Menu management",
    category: "Restaurant",
    defaultEnabled: true,
    tierMinimum: "starter",
  },
  {
    key: "restaurant.zones",
    name: "Zone Menus",
    description: "Zone-based menus",
    category: "Restaurant",
    defaultEnabled: false,
    tierMinimum: "growth",
  },
  {
    key: "restaurant.scheduling",
    name: "Menu Scheduling",
    description: "Menu time scheduling",
    category: "Restaurant",
    defaultEnabled: false,
    tierMinimum: "growth",
  },
  {
    key: "restaurant.multilang",
    name: "Multi-language Menus",
    description: "Multi-language menus",
    category: "Restaurant",
    defaultEnabled: false,
    tierMinimum: "enterprise",
  },
  {
    key: "restaurant.preorder",
    name: "Pre-ordering",
    description: "Pre-ordering",
    category: "Restaurant",
    defaultEnabled: false,
    tierMinimum: "enterprise",
  },
  {
    key: "retail.pos",
    name: "Retail POS",
    description: "Retail POS",
    category: "Retail",
    defaultEnabled: true,
    tierMinimum: "starter",
  },
  {
    key: "retail.inventory",
    name: "Inventory",
    description: "Inventory management",
    category: "Retail",
    defaultEnabled: true,
    tierMinimum: "starter",
  },
  {
    key: "retail.credit",
    name: "Credit Book",
    description: "Credit book (deni)",
    category: "Retail",
    defaultEnabled: true,
    tierMinimum: "growth",
  },
  {
    key: "retail.suppliers",
    name: "Purchase Orders",
    description: "Purchase orders",
    category: "Retail",
    defaultEnabled: false,
    tierMinimum: "growth",
  },
  {
    key: "services.bookings",
    name: "Bookings",
    description: "Appointment bookings",
    category: "Services",
    defaultEnabled: true,
    tierMinimum: "starter",
  },
  {
    key: "services.jobcards",
    name: "Job Cards",
    description: "Job card tracking",
    category: "Services",
    defaultEnabled: false,
    tierMinimum: "growth",
  },
  {
    key: "services.packages",
    name: "Service Packages",
    description: "Service packages",
    category: "Services",
    defaultEnabled: false,
    tierMinimum: "enterprise",
  },
  {
    key: "staff.management",
    name: "Staff Management",
    description: "Staff profiles",
    category: "Staff",
    defaultEnabled: true,
    tierMinimum: "free",
  },
  {
    key: "staff.payouts",
    name: "Staff Payouts",
    description: "M-Pesa payouts to staff",
    category: "Staff",
    defaultEnabled: false,
    tierMinimum: "growth",
  },
  {
    key: "staff.challenges",
    name: "Staff Challenges",
    description: "Performance gamification",
    category: "Staff",
    defaultEnabled: false,
    tierMinimum: "growth",
  },
  {
    key: "staff.ai",
    name: "AI Staff Insights",
    description: "AI insights",
    category: "Staff",
    defaultEnabled: false,
    tierMinimum: "enterprise",
  },
  {
    key: "analytics.basic",
    name: "Basic Analytics",
    description: "Basic analytics",
    category: "Analytics",
    defaultEnabled: true,
    tierMinimum: "free",
  },
  {
    key: "analytics.ai",
    name: "AI Analytics",
    description: "AI-powered insights",
    category: "Analytics",
    defaultEnabled: false,
    tierMinimum: "enterprise",
  },
  {
    key: "admin.api",
    name: "API Access",
    description: "API access",
    category: "Admin",
    defaultEnabled: false,
    tierMinimum: "enterprise",
  },
];

function canUseStorage() {
  return (
    typeof window !== "undefined" && typeof window.localStorage !== "undefined"
  );
}

function readStorage<T>(key: string, fallback: T): T {
  if (!canUseStorage()) return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeStorage<T>(key: string, value: T) {
  if (!canUseStorage()) return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

function createId(prefix: string) {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function minusDays(days: number, hours = 0) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(date.getHours() - hours);
  return date.toISOString();
}

function normalizeTier(tier: string): SubscriptionTier {
  return TIER_ORDER.includes(tier as SubscriptionTier)
    ? (tier as SubscriptionTier)
    : "free";
}

function tierAtLeast(tier: SubscriptionTier, minimum: SubscriptionTier) {
  return TIER_ORDER.indexOf(tier) >= TIER_ORDER.indexOf(minimum);
}

function createDemoMerchants(): MerchantAccount[] {
  const merchants: Array<Omit<MerchantAccount, "features">> = [
    {
      id: "merchant-urban-bites",
      businessName: "Urban Bites Kitchen",
      ownerName: "Lorna Nyaga",
      phone: "254712445501",
      email: "lorna@urbanbites.co.ke",
      vertical: "restaurant",
      status: "active",
      tier: "starter",
      location: "Westlands, Nairobi",
      onboardedAt: minusDays(140),
      lastLoginAt: minusDays(0, 6),
      notes: "Flagship restaurant using QR-first checkout.",
    },
    {
      id: "merchant-mama-njeri-duka",
      businessName: "Mama Njeri Duka",
      ownerName: "Njeri Wambui",
      phone: "254701992321",
      email: "hello@mamaduka.co.ke",
      vertical: "retail",
      status: "active",
      tier: "free",
      location: "Kasarani, Nairobi",
      onboardedAt: minusDays(92),
      lastLoginAt: minusDays(1, 4),
      notes: "High repeat traffic neighbourhood store.",
    },
    {
      id: "merchant-glow-go",
      businessName: "Glow & Go Salon",
      ownerName: "Jackline Achieng",
      phone: "254733120887",
      email: "ops@glowandgo.africa",
      vertical: "services",
      status: "active",
      tier: "growth",
      location: "Kilimani, Nairobi",
      onboardedAt: minusDays(65),
      lastLoginAt: minusDays(0, 2),
      notes: "Runs appointment bundles and premium staff incentives.",
    },
    {
      id: "merchant-afyalink",
      businessName: "AfyaLink Clinic",
      ownerName: "Dr. Mercy Atieno",
      phone: "254719880332",
      email: "admin@afyalink.health",
      vertical: "hospital",
      status: "pending",
      tier: "enterprise",
      location: "Ngong Road, Nairobi",
      onboardedAt: minusDays(10),
      notes: "Awaiting compliance review before go-live.",
    },
    {
      id: "merchant-coastline-grill",
      businessName: "Coastline Grill",
      ownerName: "Salim Mwarabu",
      phone: "254723678991",
      email: "salim@coastlinegrill.com",
      vertical: "restaurant",
      status: "active",
      tier: "growth",
      location: "Nyali, Mombasa",
      onboardedAt: minusDays(48),
      lastLoginAt: minusDays(2, 3),
      notes: "Pilot merchant for zone menus and staff performance challenges.",
    },
    {
      id: "merchant-jirani-mini-mart",
      businessName: "Jirani Mini Mart",
      ownerName: "Paul Kamau",
      phone: "254711320018",
      email: "owner@jiranimart.co.ke",
      vertical: "retail",
      status: "suspended",
      tier: "starter",
      location: "Eldoret CBD",
      onboardedAt: minusDays(122),
      lastLoginAt: minusDays(14),
      notes: "Suspended pending KYC document refresh.",
    },
    {
      id: "merchant-swiftfix",
      businessName: "SwiftFix Garage",
      ownerName: "Dennis Mutiso",
      phone: "254705401219",
      email: "hello@swiftfix.ke",
      vertical: "services",
      status: "pending",
      tier: "growth",
      location: "Industrial Area, Nairobi",
      onboardedAt: minusDays(6),
      notes: "Requests job cards and payout workflows from day one.",
    },
    {
      id: "merchant-peak-pharmacy",
      businessName: "PeakCare Pharmacy",
      ownerName: "Ruth Kiplagat",
      phone: "254714900411",
      email: "ruth@peakcare.co.ke",
      vertical: "hospital",
      status: "active",
      tier: "enterprise",
      location: "Kisumu CBD",
      onboardedAt: minusDays(34),
      lastLoginAt: minusDays(0, 9),
      notes: "Enterprise account with API and AI analytics pilot enabled.",
    },
  ];

  return merchants.map((merchant) => {
    const defaults = getTierDefaults(merchant.tier);
    const features = { ...defaults };
    if (merchant.id === "merchant-coastline-grill") {
      features["restaurant.zones"] = true;
      features["staff.challenges"] = true;
    }
    if (merchant.id === "merchant-peak-pharmacy") {
      features["payments.bnpl"] = true;
      features["analytics.ai"] = true;
      features["admin.api"] = true;
    }
    return { ...merchant, features };
  });
}

function createDemoActivities(): AdminActivity[] {
  const items: Array<Omit<AdminActivity, "id">> = [
    {
      adminEmail: "admin@pesaswap.io",
      action: "merchant_created",
      targetMerchant: "merchant-afyalink",
      details:
        "AfyaLink Clinic profile created from enterprise onboarding form.",
      timestamp: minusDays(10, 2),
    },
    {
      adminEmail: "ops@pesaswap.io",
      action: "settings_changed",
      targetMerchant: "merchant-urban-bites",
      details:
        "Updated settlement window to hourly payouts for Urban Bites Kitchen.",
      timestamp: minusDays(9, 1),
    },
    {
      adminEmail: "admin@pesaswap.io",
      action: "feature_enabled",
      targetMerchant: "merchant-coastline-grill",
      details: "Zone-based menus activated for Coastline Grill.",
      timestamp: minusDays(8, 4),
    },
    {
      adminEmail: "finance@pesaswap.io",
      action: "payout_approved",
      targetMerchant: "merchant-glow-go",
      details: "Approved KES 86,000 merchant settlement batch.",
      timestamp: minusDays(8, 0),
    },
    {
      adminEmail: "admin@pesaswap.io",
      action: "merchant_created",
      targetMerchant: "merchant-swiftfix",
      details: "SwiftFix Garage submitted via services onboarding flow.",
      timestamp: minusDays(7, 5),
    },
    {
      adminEmail: "ops@pesaswap.io",
      action: "feature_disabled",
      targetMerchant: "merchant-jirani-mini-mart",
      details: "Supplier purchase orders disabled after overdue documents.",
      timestamp: minusDays(7, 1),
    },
    {
      adminEmail: "admin@pesaswap.io",
      action: "merchant_suspended",
      targetMerchant: "merchant-jirani-mini-mart",
      details: "Jirani Mini Mart suspended pending KYC refresh.",
      timestamp: minusDays(6, 6),
    },
    {
      adminEmail: "finance@pesaswap.io",
      action: "settings_changed",
      targetMerchant: "merchant-peak-pharmacy",
      details: "Raised PeakCare Pharmacy daily transaction threshold.",
      timestamp: minusDays(6, 2),
    },
    {
      adminEmail: "admin@pesaswap.io",
      action: "feature_enabled",
      targetMerchant: "merchant-peak-pharmacy",
      details: "API access activated for PeakCare Pharmacy.",
      timestamp: minusDays(5, 3),
    },
    {
      adminEmail: "ops@pesaswap.io",
      action: "feature_enabled",
      targetMerchant: "merchant-glow-go",
      details: "Staff payout rails activated for Glow & Go Salon.",
      timestamp: minusDays(5, 0),
    },
    {
      adminEmail: "admin@pesaswap.io",
      action: "merchant_approved",
      targetMerchant: "merchant-peak-pharmacy",
      details: "PeakCare Pharmacy passed enterprise review and went live.",
      timestamp: minusDays(4, 7),
    },
    {
      adminEmail: "finance@pesaswap.io",
      action: "payout_approved",
      targetMerchant: "merchant-coastline-grill",
      details: "Released KES 124,000 weekend settlement.",
      timestamp: minusDays(4, 2),
    },
    {
      adminEmail: "ops@pesaswap.io",
      action: "settings_changed",
      targetMerchant: "merchant-mama-njeri-duka",
      details: "Updated till alias and cashier roster for Mama Njeri Duka.",
      timestamp: minusDays(3, 5),
    },
    {
      adminEmail: "admin@pesaswap.io",
      action: "feature_enabled",
      targetMerchant: "merchant-urban-bites",
      details: "Bill splitting activated for Urban Bites Kitchen.",
      timestamp: minusDays(3, 1),
    },
    {
      adminEmail: "admin@pesaswap.io",
      action: "settings_changed",
      targetMerchant: "merchant-afyalink",
      details:
        "Compliance reviewer added onboarding notes for AfyaLink Clinic.",
      timestamp: minusDays(2, 8),
    },
    {
      adminEmail: "ops@pesaswap.io",
      action: "feature_disabled",
      targetMerchant: "merchant-afyalink",
      details: "BNPL kept disabled pending hospital board approval.",
      timestamp: minusDays(2, 4),
    },
    {
      adminEmail: "finance@pesaswap.io",
      action: "payout_approved",
      targetMerchant: "merchant-urban-bites",
      details: "Settled MTD restaurant takings for Urban Bites Kitchen.",
      timestamp: minusDays(1, 10),
    },
    {
      adminEmail: "admin@pesaswap.io",
      action: "settings_changed",
      targetMerchant: "merchant-glow-go",
      details: "Upgraded Glow & Go Salon to Growth tier playbook.",
      timestamp: minusDays(1, 7),
    },
    {
      adminEmail: "ops@pesaswap.io",
      action: "feature_enabled",
      targetMerchant: "merchant-coastline-grill",
      details: "Restaurant scheduling enabled for lunch and dinner menus.",
      timestamp: minusDays(1, 4),
    },
    {
      adminEmail: "admin@pesaswap.io",
      action: "merchant_created",
      targetMerchant: "merchant-swiftfix",
      details:
        "Requested follow-up on payout and job card setup for SwiftFix Garage.",
      timestamp: minusDays(1, 1),
    },
    {
      adminEmail: "finance@pesaswap.io",
      action: "payout_approved",
      targetMerchant: "merchant-mama-njeri-duka",
      details: "Approved retail settlement release for Mama Njeri Duka.",
      timestamp: minusDays(0, 18),
    },
    {
      adminEmail: "admin@pesaswap.io",
      action: "feature_enabled",
      targetMerchant: "merchant-peak-pharmacy",
      details: "AI analytics pilot enabled for PeakCare Pharmacy.",
      timestamp: minusDays(0, 14),
    },
    {
      adminEmail: "ops@pesaswap.io",
      action: "settings_changed",
      targetMerchant: "merchant-coastline-grill",
      details: "Changed support owner for Coastline Grill launch checklist.",
      timestamp: minusDays(0, 9),
    },
    {
      adminEmail: "admin@pesaswap.io",
      action: "settings_changed",
      targetMerchant: "merchant-afyalink",
      details: "Requested missing regulator letter before approval.",
      timestamp: minusDays(0, 3),
    },
  ];

  return items
    .map((item, index) => ({ id: `activity-${index + 1}`, ...item }))
    .sort((a, b) => +new Date(b.timestamp) - +new Date(a.timestamp));
}

function createGlobalFeatureDefaults() {
  return FEATURE_FLAGS.reduce<Record<string, boolean>>((state, feature) => {
    state[feature.key] = feature.defaultEnabled;
    return state;
  }, {});
}

export function adminLogin(
  email: string,
  password: string,
): { success: boolean; token?: string; error?: string } {
  const normalizedEmail = email.trim().toLowerCase();
  if (
    normalizedEmail !== DEMO_ADMIN.email ||
    password.trim() !== DEMO_ADMIN.password
  ) {
    return { success: false, error: "Invalid credentials" };
  }

  const session: AdminSession = {
    email: normalizedEmail,
    token: createId("admin-token"),
  };
  writeStorage(STORAGE_KEYS.session, session);
  return { success: true, token: session.token };
}

export function adminLogout(): void {
  if (!canUseStorage()) return;
  window.localStorage.removeItem(STORAGE_KEYS.session);
}

export function getAdminSession(): {
  authenticated: boolean;
  email?: string;
  token?: string;
} {
  const session = readStorage<AdminSession | null>(STORAGE_KEYS.session, null);
  if (!session?.email || !session.token) {
    return { authenticated: false };
  }
  return {
    authenticated: true,
    email: session.email,
    token: session.token,
  };
}

export function getMerchants(): MerchantAccount[] {
  return readStorage(STORAGE_KEYS.merchants, createDemoMerchants()).sort(
    (a, b) => +new Date(b.onboardedAt) - +new Date(a.onboardedAt),
  );
}

export function saveMerchant(merchant: MerchantAccount): void {
  const merchants = getMerchants();
  const index = merchants.findIndex((entry) => entry.id === merchant.id);
  if (index >= 0) {
    merchants[index] = merchant;
  } else {
    merchants.push(merchant);
  }
  writeStorage(STORAGE_KEYS.merchants, merchants);
}

export function deleteMerchant(id: string): void {
  const merchants = getMerchants().filter((merchant) => merchant.id !== id);
  writeStorage(STORAGE_KEYS.merchants, merchants);
}

export function getFeatureFlags(): FeatureFlag[] {
  return FEATURE_FLAGS.map((feature) => ({ ...feature }));
}

export function getMerchantFeatures(
  merchantId: string,
): Record<string, boolean> {
  return (
    getMerchants().find((merchant) => merchant.id === merchantId)?.features ??
    {}
  );
}

export function setMerchantFeature(
  merchantId: string,
  featureKey: string,
  enabled: boolean,
): void {
  const merchants = getMerchants();
  const merchant = merchants.find((entry) => entry.id === merchantId);
  if (!merchant) return;
  merchant.features = { ...merchant.features, [featureKey]: enabled };
  writeStorage(STORAGE_KEYS.merchants, merchants);
}

export function getTierDefaults(tier: string): Record<string, boolean> {
  const normalizedTier = normalizeTier(tier);
  return FEATURE_FLAGS.reduce<Record<string, boolean>>((defaults, feature) => {
    defaults[feature.key] = tierAtLeast(normalizedTier, feature.tierMinimum);
    return defaults;
  }, {});
}

export function getGlobalFeatureState(): Record<string, boolean> {
  return readStorage(
    STORAGE_KEYS.globalFeatures,
    createGlobalFeatureDefaults(),
  );
}

export function setGlobalFeatureState(
  featureKey: string,
  enabled: boolean,
): void {
  const current = getGlobalFeatureState();
  writeStorage(STORAGE_KEYS.globalFeatures, {
    ...current,
    [featureKey]: enabled,
  });
}

export function getMerchantUsageStats(
  merchant: MerchantAccount,
): MerchantUsageStats {
  const seed = merchant.id
    .split("")
    .reduce(
      (total, character, index) =>
        total + character.charCodeAt(0) * (index + 1),
      0,
    );
  const multiplier =
    merchant.status === "active"
      ? 1
      : merchant.status === "pending"
        ? 0.35
        : 0.2;
  const tierBonus = TIER_ORDER.indexOf(merchant.tier) + 1;
  const baseRevenue = 180000 + (seed % 450000);
  const featureUsage = Object.values(merchant.features).filter(Boolean).length;
  const transactions = Math.round(
    (140 + (seed % 420)) * multiplier * tierBonus,
  );

  return {
    transactions,
    revenue: Math.round(baseRevenue * multiplier * tierBonus),
    activeStaff: Math.max(
      2,
      Math.round((4 + (seed % 12)) * multiplier + tierBonus),
    ),
    catalogueItems: Math.max(
      8,
      Math.round((30 + (seed % 90)) * multiplier + tierBonus * 4),
    ),
    featureUsage,
    lastTransactionAt: new Date(
      Date.now() - ((seed % 72) + 1) * 60 * 60 * 1000,
    ).toISOString(),
  };
}

export function logActivity(
  action: string,
  details: string,
  merchantId?: string,
): void {
  const activity = getActivityLog();
  const session = getAdminSession();
  const next: AdminActivity = {
    id: createId("activity"),
    adminEmail: session.email ?? DEMO_ADMIN.email,
    action,
    targetMerchant: merchantId,
    details,
    timestamp: new Date().toISOString(),
  };
  writeStorage(STORAGE_KEYS.activity, [next, ...activity]);
}

export function getActivityLog(): AdminActivity[] {
  return readStorage(STORAGE_KEYS.activity, createDemoActivities()).sort(
    (a, b) => +new Date(b.timestamp) - +new Date(a.timestamp),
  );
}

export function ensureAdminDemoData(): void {
  if (!canUseStorage()) return;
  if (!window.localStorage.getItem(STORAGE_KEYS.merchants)) {
    writeStorage(STORAGE_KEYS.merchants, createDemoMerchants());
  }
  if (!window.localStorage.getItem(STORAGE_KEYS.activity)) {
    writeStorage(STORAGE_KEYS.activity, createDemoActivities());
  }
  if (!window.localStorage.getItem(STORAGE_KEYS.globalFeatures)) {
    writeStorage(STORAGE_KEYS.globalFeatures, createGlobalFeatureDefaults());
  }
}
