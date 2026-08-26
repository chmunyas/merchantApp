import type {
  AIStaffInsight,
  Area,
  Booking,
  Campaign,
  CampaignSegment,
  CatalogueItem,
  JobCard,
  LoyaltyCustomer,
  ExternalMenu,
  Menu,
  MessageLogEntry,
  CreditCustomer,
  DepositPolicy,
  Enquiry,
  MenuSchedule,
  OrderTicket,
  PurchaseOrder,
  Reservation,
  RetailProduct,
  RetailSale,
  ServiceCategory,
  ServiceClient,
  ServiceOffering,
  ServicePackage,
  StaffMember,
  StaffNotification,
  StaffPayout,
  StaffPerformanceChallenge,
  StaffRole,
  StaffShift,
  StockAdjustment,
  Supplier,
  TableCombination,
  Workflow,
  WorkflowTrigger,
  Zone,
} from "@/components/merchant/features/types";
import {
  hydrateMerchantState,
  isOnlineForMutation,
  readStorage,
  writeStorage,
} from "@/lib/browser-storage";
export {
  hydrateMerchantState,
  isOnlineForMutation,
  readStorage,
  writeStorage,
} from "@/lib/browser-storage";
import {
  getCurrentVenue,
  getCurrentVenueId,
  getVenues,
  isDemoVenue,
  resetTenant,
  setCurrentVenueId,
  setVenues,
  type Venue,
} from "@/lib/tenant-store";
export {
  getCurrentVenue,
  getCurrentVenueId,
  getVenues,
  isDemoVenue,
  resetTenant,
  setCurrentVenueId,
  setVenues,
  type Venue,
} from "@/lib/tenant-store";

export const MERCHANT_NAME = "Sade's Atelier";
export const TILL_NUMBER = "247365";
export const STAFF_NAMES = [
  "Grace M.",
  "James K.",
  "Faith W.",
  "Peter O.",
  "Amina N.",
  "Kevin O.",
] as const;

export const STAFF_ROLES = [
  "waiter",
  "bartender",
  "kitchen",
  "host",
  "manager",
  "admin",
] as const satisfies readonly StaffRole[];

export const STORAGE_KEYS = {
  catalogue: "fxengine.merchant.catalogue",
  menus: "fxengine.merchant.menus",
  zones: "fxengine.merchant.zones",
  areas: "fxengine.merchant.areas",
  categoryOrder: "fxengine.merchant.categoryOrder",
  menuSchedules: "fxengine.merchant.menuSchedules",
  externalMenus: "fxengine.merchant.externalMenus",
  tables: "fxengine.merchant.tables",
  tableCombinations: "fxengine.merchant.tableCombinations",
  orders: "fxengine.merchant.orders",
  reservations: "fxengine.merchant.reservations",
  enquiries: "fxengine.merchant.enquiries",
  depositPolicy: "fxengine.merchant.depositPolicy",
  reviews: "fxengine.merchant.reviews",
  settings: "fxengine.merchant.settings",
  staffMembers: "fxengine.merchant.staffMembers",
  staffShifts: "fxengine.merchant.staffShifts",
  staffNotifications: "fxengine.merchant.staffNotifications",
  staffPayouts: "fxengine.merchant.staffPayouts",
  staffChallenges: "fxengine.merchant.staffChallenges",
  staffInsights: "fxengine.merchant.staffInsights",
  workflows: "fxengine.merchant.workflows",
  campaigns: "fxengine.merchant.campaigns",
  messageLog: "fxengine.merchant.messageLog",
  loyaltyCustomers: "fxengine.merchant.loyaltyCustomers",
} as const;

export const RETAIL_STORAGE_KEYS = {
  storeProfile: "fxengine.retail.storeProfile",
  products: "fxengine.retail.products",
  sales: "fxengine.retail.sales",
  adjustments: "fxengine.retail.adjustments",
  creditCustomers: "fxengine.retail.creditCustomers",
  suppliers: "fxengine.retail.suppliers",
  purchaseOrders: "fxengine.retail.purchaseOrders",
} as const;

export type PaymentMethod = "M-Pesa" | "Card" | "Split" | "Cash";
export type PaymentStatus = "succeeded" | "refunded" | "failed";
export type TableStatus =
  | "open"
  | "requesting-bill"
  | "partially-paid"
  | "closed";

export type MerchantTableItem = {
  id: string;
  name: string;
  price: number;
  qty: number;
  category: string;
  destination?: "kitchen" | "bar";
  dietary?: string[];
};

export type MerchantPayment = {
  id: string;
  paymentId: string;
  reference: string;
  customerName: string;
  phone: string;
  amount: number;
  tip: number;
  method: PaymentMethod;
  status: PaymentStatus;
  tableNumber: number;
  server: string;
  createdAt: string;
  splitInfo?: { participants: number; shares: number[] };
  items: MerchantTableItem[];
  metadata: Record<string, string | number | boolean>;
  responseNote?: string;
};

export type MerchantTable = {
  id: string;
  tableNumber: number;
  capacity?: number;
  name?: string;
  bookable?: boolean;
  server: string;
  items: MerchantTableItem[];
  status: TableStatus;
  openedAt: string;
  closedAt?: string;
  paidAmount: number;
  payments: MerchantPayment[];
  revision?: number;
};

export type MerchantReview = {
  id: string;
  paymentId: string;
  customerName: string;
  rating: 1 | 2 | 3 | 4 | 5;
  comment: string;
  date: string;
  tableNumber: number;
  server: string;
  response?: string;
};

export type MerchantUser = {
  id: string;
  name: string;
  role: "Owner" | "Manager" | "Server" | "Kitchen";
  phone: string;
  active: boolean;
};

export type MerchantSettings = {
  businessProfile: {
    name: string;
    tillNumber: string;
    address: string;
    phone: string;
    logoUrl: string;
  };
  paymentConfiguration: {
    mpesa: boolean;
    card: boolean;
    applePay: boolean;
    googlePay: boolean;
    tipSuggestions: number[];
  };
  users: MerchantUser[];
  branding: {
    primaryColor: string;
    logoUrl: string;
  };
};

export type RetailStoreProfile = {
  id: string;
  name: string;
  location: string;
  phone: string;
  tillNumber: string;
  whatsapp: string;
  receiptFooter: string;
};

export type RetailSnapshot = {
  storeProfile: RetailStoreProfile;
  products: RetailProduct[];
  sales: RetailSale[];
  adjustments: StockAdjustment[];
  creditCustomers: CreditCustomer[];
  suppliers: Supplier[];
  purchaseOrders: PurchaseOrder[];
};

export type RetailAnalytics = {
  revenueToday: number;
  revenueWeek: number;
  revenueMonth: number;
  salesCount: number;
  unitsSold: number;
  grossProfitEstimate: number;
  paymentBreakdown: Array<{ name: string; value: number }>;
  topProducts: Array<{
    productId: string;
    name: string;
    qty: number;
    revenue: number;
  }>;
  revenueTrend: Array<{ label: string; revenue: number }>;
};

export type MerchantSnapshot = {
  catalogue: CatalogueItem[];
  menus: Menu[];
  zones: Zone[];
  areas: Area[];
  categoryOrder: string[];
  menuSchedules: MenuSchedule[];
  externalMenus: ExternalMenu[];
  tables: MerchantTable[];
  tableCombinations: TableCombination[];
  orders: OrderTicket[];
  reservations: Reservation[];
  enquiries: Enquiry[];
  depositPolicy: DepositPolicy;
  reviews: MerchantReview[];
  settings: MerchantSettings;
  staffMembers: StaffMember[];
  staffShifts: StaffShift[];
  staffNotifications: StaffNotification[];
  staffPayouts: StaffPayout[];
  staffChallenges: StaffPerformanceChallenge[];
  staffInsights: AIStaffInsight[];
  workflows: Workflow[];
  campaigns: Campaign[];
  messageLog: MessageLogEntry[];
  loyaltyCustomers: LoyaltyCustomer[];
};

const customerNames = [
  "Amina",
  "Brian",
  "Cynthia",
  "Dennis",
  "Eunice",
  "Farah",
  "George",
  "Hilda",
  "Ian",
  "Joy",
  "Kevin",
  "Lucy",
  "Moses",
  "Nadia",
  "Otieno",
  "Purity",
];

const reviewComments = [
  "Loved the ambience and the fast checkout.",
  "Friendly staff and the QR payment was seamless.",
  "Cocktails were excellent, would definitely come back.",
  "Service was good and food arrived hot.",
  "Great experience overall, especially the table service.",
  "Helpful server and smooth payment split.",
];

function cloneDate(base: Date) {
  return new Date(base.getTime());
}

function minusTime(base: Date, days: number, hours: number, minutes = 0) {
  const next = cloneDate(base);
  next.setDate(next.getDate() - days);
  next.setHours(next.getHours() - hours);
  next.setMinutes(next.getMinutes() - minutes);
  return next;
}

function plusDays(base: Date, days: number, hour: number, minute = 0) {
  const next = cloneDate(base);
  next.setDate(next.getDate() + days);
  next.setHours(hour, minute, 0, 0);
  return next;
}

function createImage(label: string, color: string) {
  return `https://placehold.co/200x200/${color}/white?text=${encodeURIComponent(label)}`;
}

function modifierOption(id: string, label: string, priceAdjustment: number) {
  return { id, label, priceAdjustment };
}

export function getScheduleDayIndex(date = new Date()) {
  return (date.getDay() + 6) % 7;
}

function toMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function toIsoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function createStaffId(prefix: string, suffix: string) {
  return `${prefix}-${suffix}`;
}

function slugifyRetailValue(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function createRetailId(prefix: string, value: string) {
  return `${prefix}-${slugifyRetailValue(value)}`;
}

function createRetailBarcode(seed: number) {
  return `616000${String(seed).padStart(6, "0")}`;
}

export function isMenuScheduleActive(schedule: MenuSchedule, now = new Date()) {
  const day = getScheduleDayIndex(now);
  if (!schedule.days.includes(day)) return false;

  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const startMinutes = toMinutes(schedule.startTime);
  const endMinutes = toMinutes(schedule.endTime);

  if (startMinutes <= endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
  }

  return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
}

export function getActiveMenuSchedule(
  schedules: MenuSchedule[],
  now = new Date(),
) {
  return (
    schedules.find((schedule) => isMenuScheduleActive(schedule, now)) ?? null
  );
}

export function getActiveMenuSchedules(
  schedules: MenuSchedule[],
  now = new Date(),
) {
  return schedules.filter((schedule) => isMenuScheduleActive(schedule, now));
}

export function getCurrentActiveMenuIds(
  menus: Menu[],
  schedules: MenuSchedule[],
  now = new Date(),
) {
  const activeMenuIds = getActiveMenus(menus).map((menu) => menu.id);
  const scheduledMenuIds = getActiveMenuSchedules(schedules, now).flatMap(
    (schedule) => schedule.menuIds ?? [],
  );
  return Array.from(
    new Set(
      scheduledMenuIds.length
        ? activeMenuIds.filter((menuId) => scheduledMenuIds.includes(menuId))
        : activeMenuIds,
    ),
  );
}

export function getMenuCategoriesByIds(menus: Menu[], menuIds: string[]) {
  return Array.from(
    new Set(
      menus
        .filter((menu) => menuIds.includes(menu.id))
        .flatMap((menu) => menu.categories)
        .filter(Boolean),
    ),
  );
}

function buildCatalogue(): CatalogueItem[] {
  return [
    {
      id: "cat-nyama",
      name: "Nyama Choma Platter",
      price: 1450,
      category: "Mains",
      destination: "kitchen",
      dietary: ["halal", "gluten-free"],
      image: createImage("Nyama", "059669"),
      available: true,
      description:
        "Charcoal-grilled beef platter served with kachumbari, pili pili salsa, and warm chapati.",
      translations: {
        sw: {
          name: "Sahani ya Nyama Choma",
          description:
            "Sahani ya nyama ya ng'ombe iliyochomwa na kachumbari, salsa ya pili pili na chapati ya moto.",
        },
        fr: {
          name: "Plateau de Nyama Choma",
          description:
            "Plateau de boeuf grillé au charbon servi avec kachumbari, salsa pimentée et chapati chaud.",
        },
        ar: {
          name: "طبق نياما تشوما",
          description:
            "طبق لحم بقري مشوي على الفحم يقدم مع كاتشومباري وصلصة فلفل حار وتشاباتي دافئ.",
        },
      },
      modifiers: [
        {
          id: "nyama-size",
          name: "Size",
          options: [
            modifierOption("nyama-small", "Small", 0),
            modifierOption("nyama-regular", "Regular", 0),
            modifierOption("nyama-large", "Large", 50),
          ],
        },
        {
          id: "nyama-extras",
          name: "Extras",
          options: [
            modifierOption("nyama-cheese", "Extra Cheese", 30),
            modifierOption("nyama-bacon", "Bacon", 50),
          ],
        },
      ],
      linkedProductIds: ["cat-chapati", "cat-tusker", "cat-sukuma"],
    },
    {
      id: "cat-tilapia",
      name: "Lake Victoria Tilapia",
      price: 1280,
      category: "Mains",
      destination: "kitchen",
      dietary: ["gluten-free"],
      image: createImage("Tilapia", "0f766e"),
      available: true,
      description:
        "Whole tilapia fried crisp and finished with lemon-herb butter and chilli mango relish.",
      translations: {
        sw: {
          name: "Tilapia ya Ziwa Victoria",
          description:
            "Samaki mzima wa tilapia uliokaangwa na kuongezewa siagi ya limau na relish ya embe yenye pilipili.",
        },
        fr: {
          name: "Tilapia du Lac Victoria",
          description:
            "Tilapia entier frit et servi avec beurre citronné aux herbes et relish mangue-piment.",
        },
      },
      linkedProductIds: ["cat-sukuma", "cat-soda", "cat-chapati"],
    },
    {
      id: "cat-pilau",
      name: "Spiced Coconut Pilau",
      price: 780,
      category: "Mains",
      destination: "kitchen",
      dietary: ["vegetarian"],
      image: createImage("Pilau", "b45309"),
      available: true,
      description:
        "Fragrant basmati pilau tossed with coconut cream, caramelised onions, and toasted cashews.",
      linkedProductIds: ["cat-wings", "cat-soda", "cat-cake"],
    },
    {
      id: "cat-wings",
      name: "Tamarind Wings",
      price: 640,
      category: "Sides",
      destination: "kitchen",
      dietary: ["halal"],
      image: createImage("Wings", "dc2626"),
      available: true,
      description:
        "Sticky tamarind-glazed wings with charred lime and a smoky house dip.",
      linkedProductIds: ["cat-spritz", "cat-soda", "cat-cake"],
    },
    {
      id: "cat-sukuma",
      name: "Charred Sukuma Wiki",
      price: 280,
      category: "Sides",
      destination: "kitchen",
      dietary: ["vegan", "gluten-free"],
      image: createImage("Sukuma", "65a30d"),
      available: true,
      description:
        "Flash-charred greens with garlic oil, sesame, and fresh lemon.",
      linkedProductIds: ["cat-nyama", "cat-tilapia"],
    },
    {
      id: "cat-chapati",
      name: "House Chapati Stack",
      price: 220,
      category: "Sides",
      destination: "kitchen",
      dietary: ["vegetarian"],
      image: createImage("Chapati", "a16207"),
      available: true,
      description:
        "Soft layered chapatis served warm with whipped garlic butter.",
      linkedProductIds: ["cat-nyama", "cat-tilapia", "cat-dawa"],
    },
    {
      id: "cat-tusker",
      name: "Tusker Lager",
      price: 340,
      category: "Drinks",
      destination: "bar",
      dietary: ["vegan"],
      image: createImage("Tusker", "1d4ed8"),
      available: true,
      description: "Crisp local lager served ice-cold from the tap.",
      translations: {
        sw: {
          name: "Tusker Lager",
          description: "Bia baridi ya kienyeji inayotolewa kutoka kwenye tapu.",
        },
        fr: {
          name: "Bière Tusker",
          description: "Bière locale bien fraîche servie pression.",
        },
        ar: {
          name: "توسكر لاجر",
          description: "بيرة محلية منعشة تقدم باردة مباشرة من الصنبور.",
        },
      },
      linkedProductIds: ["cat-nyama", "cat-wings", "cat-chapati"],
    },
    {
      id: "cat-soda",
      name: "Passion Soda",
      price: 180,
      category: "Drinks",
      destination: "bar",
      dietary: ["vegan", "gluten-free"],
      image: createImage("Soda", "7c3aed"),
      available: false,
      description: "Sparkling passion fruit soda with fresh mint and citrus.",
      linkedProductIds: ["cat-pilau", "cat-cake"],
    },
    {
      id: "cat-spritz",
      name: "Baobab Spritz",
      price: 760,
      category: "Cocktails",
      destination: "bar",
      dietary: ["vegan"],
      image: createImage("Spritz", "db2777"),
      available: true,
      description: "Bright baobab and prosecco spritz topped with orange zest.",
      modifiers: [
        {
          id: "spritz-size",
          name: "Pour",
          options: [
            modifierOption("spritz-regular", "Regular", 0),
            modifierOption("spritz-large", "Large", 80),
          ],
        },
      ],
      linkedProductIds: ["cat-wings", "cat-cake", "cat-mandazi"],
    },
    {
      id: "cat-dawa",
      name: "Dawa Martini",
      price: 820,
      category: "Cocktails",
      destination: "bar",
      dietary: ["gluten-free"],
      image: createImage("Dawa", "9333ea"),
      available: true,
      description:
        "Honey, lime, and vodka shaken with crushed ice for a modern Nairobi classic.",
      linkedProductIds: ["cat-nyama", "cat-chapati"],
    },
    {
      id: "cat-cake",
      name: "Cardamom Carrot Cake",
      price: 420,
      category: "Desserts",
      destination: "kitchen",
      dietary: ["vegetarian"],
      image: createImage("Cake", "ea580c"),
      available: true,
      description:
        "Moist carrot cake layered with cardamom cream cheese frosting.",
      linkedProductIds: ["cat-soda", "cat-spritz"],
    },
    {
      id: "cat-mandazi",
      name: "Mandazi Sundae",
      price: 390,
      category: "Desserts",
      destination: "kitchen",
      dietary: ["vegetarian"],
      image: createImage("Mandazi", "f59e0b"),
      available: true,
      description:
        "Warm mandazi bites with vanilla gelato and salted caramel drizzle.",
      linkedProductIds: ["cat-dawa", "cat-spritz"],
    },
  ];
}

function buildMenus(now = new Date()): Menu[] {
  return [
    {
      id: "menu-all-day",
      name: "All Day Classics",
      description: "Core dining menu for the main floor.",
      categories: ["Mains", "Sides", "Drinks", "Desserts"],
      isActive: true,
      createdAt: now.toISOString(),
    },
    {
      id: "menu-bar",
      name: "Bar & Cocktails",
      description: "Lounge drinks and late-evening pours.",
      categories: ["Drinks", "Cocktails"],
      isActive: true,
      createdAt: new Date(now.getTime() - 86_400_000).toISOString(),
    },
    {
      id: "menu-dessert",
      name: "Dessert Corner",
      description: "Sweet endings and coffee pairings.",
      categories: ["Desserts", "Drinks"],
      isActive: false,
      createdAt: new Date(now.getTime() - 172_800_000).toISOString(),
    },
  ];
}

function buildZones(): Zone[] {
  return [
    {
      id: "zone-terrace",
      name: "Terrace",
      menuIds: ["menu-all-day", "menu-bar"],
      tableRange: [1, 4],
    },
    {
      id: "zone-dining",
      name: "Dining Room",
      menuIds: ["menu-all-day"],
      tableRange: [5, 8],
    },
    {
      id: "zone-lounge",
      name: "Lounge",
      menuIds: ["menu-bar", "menu-dessert"],
      tableRange: [9, 12],
    },
  ];
}

function buildWorkflows(): Workflow[] {
  return [
    {
      id: "wf-confirm",
      name: "Booking confirmation",
      trigger: "booking_created",
      channel: "sms",
      message:
        "Hi {{name}}, your table for {{covers}} at {{venue}} on {{date}} {{time}} is confirmed. Reply to change.",
      active: true,
    },
    {
      id: "wf-remind",
      name: "Same-day reminder",
      trigger: "reminder",
      channel: "whatsapp",
      offsetHours: 3,
      message:
        "Reminder: see you at {{venue}} today at {{time}} for {{covers}}. Running late? Let us know.",
      active: true,
    },
    {
      id: "wf-review",
      name: "Post-visit review request",
      trigger: "post_visit",
      channel: "sms",
      offsetHours: 2,
      message:
        "Thanks for dining at {{venue}}, {{name}}! How did we do? Leave a quick review.",
      active: true,
    },
    {
      id: "wf-noshow",
      name: "No-show follow-up",
      trigger: "no_show",
      channel: "sms",
      message:
        "We missed you today, {{name}}. Rebook anytime - we'd love to host you.",
      active: false,
    },
  ];
}

function buildCampaigns(): Campaign[] {
  return [
    {
      id: "camp-brunch",
      name: "Weekend brunch offer",
      segment: "all",
      channel: "sms",
      message: "This weekend at {{venue}}: 2-for-1 brunch cocktails. Book now!",
      status: "draft",
    },
    {
      id: "camp-vip",
      name: "VIP tasting night",
      segment: "gold_plus",
      channel: "whatsapp",
      message:
        "Exclusive for our VIPs: a 6-course tasting night. Reserve your seat.",
      status: "draft",
    },
  ];
}

function buildLoyaltyCustomers(now: Date): LoyaltyCustomer[] {
  const daysAgo = (days: number) =>
    new Date(now.getTime() - days * 86_400_000).toISOString();
  return [
    {
      phone: "+254712000001",
      name: "Amina Yusuf",
      points: 1200,
      totalSpent: 48000,
      visits: 9,
      tier: "Platinum",
      lastVisit: daysAgo(3),
    },
    {
      phone: "+254712000002",
      name: "Brian Otieno",
      points: 600,
      totalSpent: 22000,
      visits: 5,
      tier: "Gold",
      lastVisit: daysAgo(8),
    },
    {
      phone: "+254712000003",
      name: "Cynthia Wambui",
      points: 150,
      totalSpent: 6000,
      visits: 2,
      tier: "Silver",
      lastVisit: daysAgo(12),
    },
    {
      phone: "+254712000004",
      name: "Dennis Kiptoo",
      points: 40,
      totalSpent: 1500,
      visits: 1,
      tier: "Bronze",
      lastVisit: daysAgo(45),
    },
    {
      phone: "+254712000005",
      name: "Esther Njoki",
      points: 900,
      totalSpent: 33000,
      visits: 7,
      tier: "Gold",
      lastVisit: daysAgo(60),
    },
  ];
}

function buildDepositPolicy(): DepositPolicy {
  return { enabled: true, perGuestKES: 500, minCovers: 6 };
}

function buildEnquiries(now: Date): Enquiry[] {
  const today = now.toISOString().slice(0, 10);
  const minutesAgo = (mins: number) =>
    new Date(now.getTime() - mins * 60_000).toISOString();
  return [
    {
      id: "enq-1",
      customerName: "Wanjiru Kamau",
      phone: "+254712345678",
      date: today,
      time: "19:30",
      covers: 6,
      notes: "Anniversary dinner, terrace if possible",
      status: "new",
      source: "web",
      createdAt: minutesAgo(35),
    },
    {
      id: "enq-2",
      customerName: "David Otieno",
      phone: "+254723456789",
      date: today,
      time: "13:00",
      covers: 4,
      notes: "Business lunch",
      status: "new",
      source: "phone",
      createdAt: minutesAgo(120),
    },
    {
      id: "enq-3",
      customerName: "Achieng Party",
      phone: "+254734567890",
      date: today,
      time: "20:00",
      covers: 10,
      notes: "Birthday - need a large/combined table",
      status: "new",
      source: "web",
      createdAt: minutesAgo(15),
    },
  ];
}

function buildAreas(): Area[] {
  return [
    {
      id: "area-terrace",
      name: "Terrace",
      hiddenFromDayPlanner: false,
      tableNumbers: [1, 2, 3, 4],
      order: 1,
    },
    {
      id: "area-dining",
      name: "Main Dining",
      hiddenFromDayPlanner: false,
      tableNumbers: [5, 6, 7, 8],
      order: 2,
    },
    {
      id: "area-lounge",
      name: "Lounge & Bar",
      hiddenFromDayPlanner: false,
      tableNumbers: [9, 10, 11, 12],
      order: 3,
    },
  ];
}

function buildTableCombinations(): TableCombination[] {
  return [
    {
      id: "combo-terrace-long",
      name: "Terrace Long Table",
      tableNumbers: [1, 2, 3],
      minCapacity: 6,
      maxCapacity: 12,
      priority: 4,
      active: true,
    },
    {
      id: "combo-lounge-booth",
      name: "Lounge Booth Merge",
      tableNumbers: [9, 10],
      minCapacity: 5,
      maxCapacity: 8,
      priority: 3,
      active: true,
    },
    {
      id: "combo-private-dining",
      name: "Private Dining (Dining Room)",
      tableNumbers: [5, 6, 7, 8],
      minCapacity: 10,
      maxCapacity: 20,
      priority: 5,
      active: false,
    },
  ];
}

function buildCategoryOrder(): string[] {
  return ["Mains", "Sides", "Drinks", "Cocktails", "Desserts"];
}

function buildMenuSchedules(): MenuSchedule[] {
  return [
    {
      id: "schedule-breakfast",
      name: "Breakfast",
      days: [0, 1, 2, 3, 4, 5, 6],
      startTime: "07:00",
      endTime: "11:30",
      categories: ["Sides", "Drinks", "Desserts"],
      menuIds: ["menu-all-day"],
    },
    {
      id: "schedule-lunch",
      name: "Lunch Menu",
      days: [0, 1, 2, 3, 4],
      startTime: "12:00",
      endTime: "16:00",
      categories: ["Mains", "Sides", "Drinks"],
      menuIds: ["menu-all-day"],
    },
    {
      id: "schedule-evening",
      name: "Evening Menu",
      days: [4, 5, 6],
      startTime: "16:00",
      endTime: "23:00",
      categories: ["Mains", "Sides", "Cocktails", "Desserts", "Drinks"],
      menuIds: ["menu-all-day", "menu-bar", "menu-dessert"],
    },
  ];
}

function buildExternalMenus(now = new Date()): ExternalMenu[] {
  return [
    {
      id: "external-wine-list",
      name: "Wine List",
      type: "url",
      content: "https://example.com",
      createdAt: minusTime(now, 2, 3).toISOString(),
    },
  ];
}

function buildItems(
  catalogue: CatalogueItem[],
  seed: number,
): MerchantTableItem[] {
  const count = 2 + (seed % 3);
  return Array.from({ length: count }).map((_, index) => {
    const item = catalogue[(seed + index * 2) % catalogue.length];
    return {
      id: item.id,
      name: item.name,
      price: item.price,
      qty: 1 + ((seed + index) % 2),
      category: item.category,
      destination: item.destination,
      dietary: item.dietary,
    };
  });
}

function totalForItems(items: MerchantTableItem[]) {
  return items.reduce((sum, item) => sum + item.price * item.qty, 0);
}

function buildPayments(
  catalogue: CatalogueItem[],
  now: Date,
): MerchantPayment[] {
  const methods: PaymentMethod[] = ["M-Pesa", "Card", "Split", "Cash"];
  const payments: MerchantPayment[] = [];

  for (let index = 0; index < 48; index += 1) {
    const createdAt = minusTime(
      now,
      Math.floor(index / 4),
      2 + (index % 4) * 3,
      (index * 11) % 60,
    );
    const items = buildItems(catalogue, index + 7);
    const amount = totalForItems(items);
    const method = methods[index % methods.length];
    const status: PaymentStatus =
      index % 17 === 0 ? "failed" : index % 13 === 0 ? "refunded" : "succeeded";
    const tip =
      status === "succeeded"
        ? Math.round(amount * (0.06 + (index % 5) * 0.02))
        : 0;
    const tableNumber = (index % 12) + 1;
    const customerName = `${customerNames[index % customerNames.length]} ${String.fromCharCode(65 + (index % 5))}.`;
    const phone = `+2547${String(12000000 + index * 731).padStart(8, "0")}`;

    payments.push({
      id: `pay-${index + 1}`,
      paymentId: `psw_${10000 + index}`,
      reference: `PSW-${(20480 + index).toString(36).toUpperCase()}`,
      customerName,
      phone,
      amount,
      tip,
      method,
      status,
      tableNumber,
      server: STAFF_NAMES[index % STAFF_NAMES.length],
      createdAt: createdAt.toISOString(),
      splitInfo:
        method === "Split"
          ? {
              participants: 2 + (index % 3),
              shares: Array.from({ length: 2 + (index % 3) }).map(
                (_, shareIndex) =>
                  Math.round(amount / (2 + (index % 3)) + shareIndex * 35),
              ),
            }
          : undefined,
      items,
      metadata: {
        merchant: MERCHANT_NAME,
        till: TILL_NUMBER,
        table_number: tableNumber,
        flow_type:
          method === "M-Pesa"
            ? "qr_pay"
            : method === "Split"
              ? "split_bill"
              : "counter",
        channel: method === "Cash" ? "manual-entry" : "pesaswap",
      },
      responseNote:
        index % 6 === 0 ? "Asked for window seat next visit" : undefined,
    });
  }

  return payments.sort(
    (a, b) => +new Date(b.createdAt) - +new Date(a.createdAt),
  );
}

function buildOrders(payments: MerchantPayment[]): OrderTicket[] {
  return payments.slice(0, 28).map((payment, index) => {
    const orderedAt = minusTime(
      new Date(payment.createdAt),
      0,
      0,
      28 + (index % 9),
    );
    const preparedAt = new Date(
      orderedAt.getTime() + (12 + (index % 8)) * 60_000,
    );
    const servedAt = new Date(
      preparedAt.getTime() + (5 + (index % 6)) * 60_000,
    );
    const status =
      index < 4
        ? "new"
        : index < 10
          ? "preparing"
          : index < 16
            ? "ready"
            : "served";

    return {
      id: `ord-${payment.id}`,
      tableNumber: payment.tableNumber,
      items: payment.items.map((item) => ({ name: item.name, qty: item.qty })),
      destination: payment.items.some((item) => item.destination === "bar")
        ? "bar"
        : "kitchen",
      status,
      orderedAt: orderedAt.toISOString(),
      preparedAt: status === "new" ? undefined : preparedAt.toISOString(),
      servedAt: status === "served" ? servedAt.toISOString() : undefined,
      server: payment.server,
      customerName: payment.customerName,
    };
  });
}

function buildReservations(now: Date): Reservation[] {
  return [
    {
      id: "res-combo-terrace",
      tableNumber: 1,
      combinationId: "combo-terrace-long",
      customerName: "Okoro Party",
      phone: "+254790112233",
      date: now.toISOString().slice(0, 10),
      time: "19:00",
      covers: 8,
      status: "seated",
      notes: "Combined terrace long table",
      depositAmount: 4000,
      depositStatus: "paid",
      depositPaidAt: now.toISOString(),
    },
    {
      id: "res-1",
      tableNumber: 2,
      customerName: "Njeri Family",
      phone: "+254722110220",
      date: plusDays(now, 0, 19, 0).toISOString().slice(0, 10),
      time: "19:00",
      covers: 4,
      status: "confirmed",
      notes: "Birthday dessert request",
    },
    {
      id: "res-2",
      tableNumber: 6,
      customerName: "Mwangi Group",
      phone: "+254733221144",
      date: plusDays(now, 0, 20, 30).toISOString().slice(0, 10),
      time: "20:30",
      covers: 6,
      status: "confirmed",
    },
    {
      id: "res-3",
      tableNumber: 9,
      customerName: "Aoko",
      phone: "+254711993311",
      date: plusDays(now, 1, 18, 45).toISOString().slice(0, 10),
      time: "18:45",
      covers: 2,
      status: "confirmed",
    },
    {
      id: "res-4",
      tableNumber: 4,
      customerName: "Otis Ventures",
      phone: "+254700552299",
      date: plusDays(now, 2, 13, 0).toISOString().slice(0, 10),
      time: "13:00",
      covers: 8,
      status: "confirmed",
      notes: "Corporate lunch",
    },
    {
      id: "res-5",
      tableNumber: 11,
      customerName: "Achieng'",
      phone: "+254745882211",
      date: plusDays(now, 0, 18, 15).toISOString().slice(0, 10),
      time: "18:15",
      covers: 3,
      status: "seated",
    },
  ];
}

function buildReviews(payments: MerchantPayment[]): MerchantReview[] {
  return payments
    .filter((payment) => payment.status === "succeeded")
    .slice(0, 18)
    .map((payment, index) => ({
      id: `review-${payment.id}`,
      paymentId: payment.paymentId,
      customerName: payment.customerName,
      rating: ([5, 4, 5, 3, 4] as const)[index % 5],
      comment: reviewComments[index % reviewComments.length],
      date: payment.createdAt,
      tableNumber: payment.tableNumber,
      server: payment.server,
      response:
        index % 4 === 0
          ? "Thank you for dining with us — see you again soon!"
          : undefined,
    }));
}

function buildSettings(): MerchantSettings {
  return {
    businessProfile: {
      name: MERCHANT_NAME,
      tillNumber: TILL_NUMBER,
      address: "14 Riverside Drive, Westlands, Nairobi",
      phone: "+254 700 247365",
      logoUrl: "",
    },
    paymentConfiguration: {
      mpesa: true,
      card: true,
      applePay: true,
      googlePay: false,
      tipSuggestions: [5, 10, 15],
    },
    users: [
      {
        id: "user-owner",
        name: "Sade A.",
        role: "Owner",
        phone: "+254700247365",
        active: true,
      },
      {
        id: "user-manager",
        name: "Brian O.",
        role: "Manager",
        phone: "+254722443311",
        active: true,
      },
      {
        id: "user-grace",
        name: "Grace M.",
        role: "Server",
        phone: "+254711110022",
        active: true,
      },
      {
        id: "user-james",
        name: "James K.",
        role: "Server",
        phone: "+254722330099",
        active: true,
      },
      {
        id: "user-faith",
        name: "Faith W.",
        role: "Server",
        phone: "+254733114499",
        active: true,
      },
      {
        id: "user-kitchen",
        name: "Chef Otieno",
        role: "Kitchen",
        phone: "+254744920011",
        active: true,
      },
    ],
    branding: {
      primaryColor: "#10b981",
      logoUrl: "",
    },
  };
}

export const DEFAULT_TABLE_CAPACITY = 4;

// Seed seat counts per table (index 0 => table 1). Mix of 2/4/6/8-tops.
const TABLE_CAPACITIES = [4, 2, 6, 4, 4, 8, 2, 4, 6, 4, 2, 6];

function buildTables(
  catalogue: CatalogueItem[],
  payments: MerchantPayment[],
): MerchantTable[] {
  const paymentsByTable = new Map<number, MerchantPayment[]>();

  payments.forEach((payment) => {
    const current = paymentsByTable.get(payment.tableNumber) || [];
    current.push(payment);
    paymentsByTable.set(payment.tableNumber, current);
  });

  const statuses: TableStatus[] = [
    "open",
    "requesting-bill",
    "partially-paid",
    "closed",
    "open",
    "requesting-bill",
    "closed",
    "partially-paid",
    "open",
    "closed",
    "requesting-bill",
    "open",
  ];

  return Array.from({ length: 12 }).map((_, index) => {
    const tableNumber = index + 1;
    const currentItems = buildItems(catalogue, index + 60);
    const currentTotal = totalForItems(currentItems);
    const status = statuses[index];
    const tablePayments = (paymentsByTable.get(tableNumber) || []).sort(
      (a, b) => +new Date(b.createdAt) - +new Date(a.createdAt),
    );
    const latestSuccessful = tablePayments.find(
      (payment) => payment.status === "succeeded",
    );
    const paidAmount =
      status === "partially-paid"
        ? Math.round(currentTotal * 0.45)
        : status === "closed"
          ? (latestSuccessful?.amount || currentTotal) +
            (latestSuccessful?.tip || 0)
          : 0;
    const openedAt = minusTime(
      new Date(),
      0,
      1 + (index % 5),
      index * 4,
    ).toISOString();

    return {
      id: `table-${tableNumber}`,
      tableNumber,
      capacity: TABLE_CAPACITIES[index] ?? DEFAULT_TABLE_CAPACITY,
      server: STAFF_NAMES[index % STAFF_NAMES.length],
      items: currentItems,
      status,
      openedAt,
      closedAt:
        status === "closed"
          ? new Date(new Date(openedAt).getTime() + 68 * 60_000).toISOString()
          : undefined,
      paidAmount,
      payments: tablePayments,
    };
  });
}

export type StaffDemoData = {
  staffMembers: StaffMember[];
  staffShifts: StaffShift[];
  staffNotifications: StaffNotification[];
  staffPayouts: StaffPayout[];
  staffChallenges: StaffPerformanceChallenge[];
  staffInsights: AIStaffInsight[];
};

export function getStaffPayoutSummary(payouts: StaffPayout[]) {
  return payouts.reduce(
    (summary, payout) => {
      summary.currency = payout.currency;
      summary.count += 1;
      summary.byType[payout.type] += payout.amount;
      if (payout.status === "sent") {
        summary.totalDisbursed += payout.amount;
      }
      if (payout.status === "failed") {
        summary.failed += payout.amount;
      }
      if (payout.status === "pending" || payout.status === "processing") {
        summary.pending += payout.amount;
      }
      return summary;
    },
    {
      currency: payouts[0]?.currency || "KES",
      count: 0,
      totalDisbursed: 0,
      pending: 0,
      failed: 0,
      byType: {
        tip: 0,
        salary: 0,
        bonus: 0,
        incentive: 0,
      },
    },
  );
}

export function generateAIStaffInsights(
  staff: StaffMember[],
  shifts: StaffShift[],
): AIStaffInsight[] {
  const now = new Date();
  const today = toIsoDate(now);
  const staffById = new Map(staff.map((member) => [member.id, member]));
  const activeTeam = staff.filter((member) => member.isActive);
  const todayShifts = shifts.filter((shift) => shift.date === today);
  const lateShift = todayShifts.find((shift) => shift.status === "late");
  const fridayEveningServers = shifts.filter((shift) => {
    const day = new Date(`${shift.date}T12:00:00`).getDay();
    const member = staffById.get(shift.staffId);
    return (
      day === 5 &&
      shift.startTime >= "17:00" &&
      (member?.role === "waiter" || member?.role === "host")
    );
  }).length;
  const topPerformer = [...activeTeam].sort(
    (left, right) =>
      right.totalEarnings +
      right.pendingPayout -
      (left.totalEarnings + left.pendingPayout),
  )[0];
  const highestPending = [...activeTeam].sort(
    (left, right) => right.pendingPayout - left.pendingPayout,
  )[0];
  const topTrainer = activeTeam.find((member) => member.role === "manager");

  return [
    {
      id: "ai-staff-checkin",
      type: "performance",
      title: "Watch service pace this week",
      insight: lateShift
        ? `${staffById.get(lateShift.staffId)?.name || "A team member"} clocked in late today, which can ripple into slower table turns during the dinner rush.`
        : "Shift starts have been steady this week, keeping table handoffs smooth across lunch and dinner service.",
      recommendation: lateShift
        ? "Check in early with the floor team before the next rush and stagger table assignments for the first 30 minutes."
        : "Keep the current pre-shift routine and reuse it for Friday dinner to preserve momentum.",
      confidence: lateShift ? 0.82 : 0.76,
      createdAt: now.toISOString(),
    },
    {
      id: "ai-staff-friday-coverage",
      type: "scheduling",
      title: "Friday evening staffing gap",
      insight:
        fridayEveningServers >= 3
          ? `You already have ${fridayEveningServers} front-of-house staff covering Friday evenings, which matches the recent demand pattern.`
          : `Recent demand suggests Friday 7–9pm needs 3 servers or hosts, but only ${fridayEveningServers} are scheduled right now.`,
      recommendation:
        fridayEveningServers >= 3
          ? "Keep one flex server on standby for large walk-ins and watch terrace turnover after 8pm."
          : "Add one more waiter or host to the Friday evening roster and prioritize terrace plus dining room coverage.",
      confidence: 0.91,
      createdAt: now.toISOString(),
    },
    {
      id: "ai-staff-mentor",
      type: "training",
      title: "Pair your strongest mentor with new hires",
      insight: topPerformer
        ? `${topPerformer.name} is leading the team on earnings momentum, which usually signals strong upsell conversations and guest trust.`
        : "One of your senior staff members is consistently outperforming the team on guest spend and payouts.",
      recommendation: topTrainer
        ? `Pair ${topPerformer?.name || "your top performer"} with ${topTrainer.name} to coach newer staff during the next busy evening shift.`
        : `Pair ${topPerformer?.name || "your top performer"} with newer staff for shadowing during the next busy evening shift.`,
      confidence: 0.87,
      createdAt: now.toISOString(),
    },
    {
      id: "ai-staff-payouts",
      type: "cost_saving",
      title: "Pending M-Pesa payouts are building up",
      insight: highestPending
        ? `${highestPending.name} has the largest pending payout balance at KES ${highestPending.pendingPayout.toLocaleString()}, which can affect morale if it sits too long.`
        : "Tip balances are currently low across the team, which reduces payout pressure this week.",
      recommendation:
        "Run a same-day M-Pesa disbursement for pending tips before the next peak shift to keep trust high and reduce manual follow-up.",
      confidence: 0.79,
      createdAt: now.toISOString(),
    },
    {
      id: "ai-staff-upsell",
      type: "upsell_coaching",
      title: "Ratings and upsell coaching opportunity",
      insight:
        "Tip pools typically expand fastest when more of the team consistently lands 4.5+ guest ratings and recommends premium add-ons confidently.",
      recommendation:
        "Use a quick coaching huddle before dinner: highlight top pairings, dessert prompts, and how to ask for feedback at the right moment.",
      confidence: 0.73,
      createdAt: now.toISOString(),
    },
  ];
}

export function generateStaffDemoData(now = new Date()): StaffDemoData {
  const zones = buildZones();
  const today = toIsoDate(now);
  const yesterday = toIsoDate(plusDays(now, -1, 12));
  const tomorrow = toIsoDate(plusDays(now, 1, 12));
  const friday = toIsoDate(plusDays(now, (5 - now.getDay() + 7) % 7 || 7, 18));
  const members: StaffMember[] = [
    {
      id: createStaffId("staff", "grace"),
      name: "Grace M.",
      phone: "254711110022",
      role: "waiter",
      isActive: true,
      hiredAt: "2025-11-08T09:00:00.000Z",
      assignedZones: [zones[0]?.id, zones[1]?.id].filter(Boolean),
      assignedTables: [1, 2, 3, 4, 5],
      mpesaPayoutEnabled: true,
      totalEarnings: 128400,
      pendingPayout: 3600,
    },
    {
      id: createStaffId("staff", "james"),
      name: "James K.",
      phone: "254722330099",
      role: "waiter",
      isActive: true,
      hiredAt: "2025-09-14T09:00:00.000Z",
      assignedZones: [zones[1]?.id].filter(Boolean),
      assignedTables: [6, 7, 8, 9],
      mpesaPayoutEnabled: true,
      totalEarnings: 116800,
      pendingPayout: 4250,
      lastPayoutAt: yesterday,
    },
    {
      id: createStaffId("staff", "faith"),
      name: "Faith W.",
      phone: "254733114499",
      role: "bartender",
      isActive: true,
      hiredAt: "2025-07-19T09:00:00.000Z",
      assignedZones: [zones[2]?.id].filter(Boolean),
      assignedTables: [10, 11, 12],
      mpesaPayoutEnabled: true,
      totalEarnings: 109500,
      pendingPayout: 2950,
      lastPayoutAt: yesterday,
    },
    {
      id: createStaffId("staff", "peter"),
      name: "Peter O.",
      phone: "254744920011",
      role: "kitchen",
      isActive: true,
      hiredAt: "2025-05-03T09:00:00.000Z",
      assignedZones: [zones[1]?.id].filter(Boolean),
      assignedTables: [5, 6, 7, 8],
      mpesaPayoutEnabled: false,
      totalEarnings: 98500,
      pendingPayout: 1200,
    },
    {
      id: createStaffId("staff", "amina"),
      name: "Amina N.",
      phone: "254701884422",
      role: "host",
      isActive: true,
      hiredAt: "2026-01-11T09:00:00.000Z",
      assignedZones: [zones[0]?.id].filter(Boolean),
      assignedTables: [1, 2, 3],
      mpesaPayoutEnabled: true,
      totalEarnings: 87400,
      pendingPayout: 1750,
    },
    {
      id: createStaffId("staff", "kevin"),
      name: "Kevin O.",
      phone: "254798556611",
      role: "manager",
      isActive: true,
      hiredAt: "2025-03-22T09:00:00.000Z",
      assignedZones: zones.map((zone) => zone.id),
      assignedTables: Array.from({ length: 12 }, (_, index) => index + 1),
      mpesaPayoutEnabled: true,
      totalEarnings: 142600,
      pendingPayout: 0,
      lastPayoutAt: yesterday,
    },
  ];

  const shifts: StaffShift[] = [
    {
      id: "shift-grace-today",
      staffId: members[0].id,
      date: today,
      startTime: "12:00",
      endTime: "21:00",
      clockInAt: `${today}T12:02:00.000Z`,
      breakMinutes: 30,
      status: "active",
    },
    {
      id: "shift-james-today",
      staffId: members[1].id,
      date: today,
      startTime: "15:00",
      endTime: "23:00",
      clockInAt: `${today}T15:21:00.000Z`,
      breakMinutes: 15,
      status: "late",
    },
    {
      id: "shift-faith-today",
      staffId: members[2].id,
      date: today,
      startTime: "14:00",
      endTime: "22:00",
      clockInAt: `${today}T13:55:00.000Z`,
      breakMinutes: 20,
      status: "active",
    },
    {
      id: "shift-peter-today",
      staffId: members[3].id,
      date: today,
      startTime: "11:00",
      endTime: "20:00",
      clockInAt: `${today}T10:52:00.000Z`,
      breakMinutes: 35,
      status: "active",
    },
    {
      id: "shift-amina-today",
      staffId: members[4].id,
      date: today,
      startTime: "12:00",
      endTime: "20:00",
      breakMinutes: 0,
      status: "scheduled",
    },
    {
      id: "shift-kevin-today",
      staffId: members[5].id,
      date: today,
      startTime: "10:00",
      endTime: "19:00",
      clockInAt: `${today}T09:48:00.000Z`,
      breakMinutes: 20,
      status: "active",
    },
    {
      id: "shift-grace-yesterday",
      staffId: members[0].id,
      date: yesterday,
      startTime: "13:00",
      endTime: "22:00",
      clockInAt: `${yesterday}T12:56:00.000Z`,
      clockOutAt: `${yesterday}T22:06:00.000Z`,
      breakMinutes: 30,
      status: "completed",
    },
    {
      id: "shift-james-yesterday",
      staffId: members[1].id,
      date: yesterday,
      startTime: "13:00",
      endTime: "22:00",
      clockInAt: `${yesterday}T13:07:00.000Z`,
      clockOutAt: `${yesterday}T22:11:00.000Z`,
      breakMinutes: 20,
      status: "completed",
    },
    {
      id: "shift-faith-tomorrow",
      staffId: members[2].id,
      date: tomorrow,
      startTime: "16:00",
      endTime: "23:00",
      breakMinutes: 15,
      status: "scheduled",
    },
    {
      id: "shift-amina-tomorrow",
      staffId: members[4].id,
      date: tomorrow,
      startTime: "11:00",
      endTime: "19:00",
      breakMinutes: 0,
      status: "scheduled",
    },
    {
      id: "shift-grace-friday",
      staffId: members[0].id,
      date: friday,
      startTime: "17:00",
      endTime: "23:00",
      breakMinutes: 20,
      status: "scheduled",
    },
    {
      id: "shift-james-friday",
      staffId: members[1].id,
      date: friday,
      startTime: "17:00",
      endTime: "23:00",
      breakMinutes: 20,
      status: "scheduled",
    },
  ];

  const shiftsByStaff = new Map(
    shifts
      .filter((shift) => shift.date === today)
      .map((shift) => [shift.staffId, shift] as const),
  );
  members.forEach((member) => {
    member.shift = shiftsByStaff.get(member.id);
  });

  const payouts: StaffPayout[] = [
    {
      id: "payout-grace-pending",
      staffId: members[0].id,
      amount: 3600,
      currency: "KES",
      mpesaPhone: members[0].phone,
      status: "pending",
      type: "tip",
      createdAt: now.toISOString(),
      period: `${today.slice(0, 7)}`,
    },
    {
      id: "payout-james-pending",
      staffId: members[1].id,
      amount: 4250,
      currency: "KES",
      mpesaPhone: members[1].phone,
      status: "pending",
      type: "tip",
      createdAt: now.toISOString(),
      period: `${today.slice(0, 7)}`,
    },
    {
      id: "payout-faith-sent",
      staffId: members[2].id,
      amount: 8200,
      currency: "KES",
      mpesaPhone: members[2].phone,
      mpesaReference: "MPSA-FAITH-8200",
      status: "sent",
      type: "bonus",
      createdAt: yesterday,
      processedAt: yesterday,
      period: `${today.slice(0, 7)}`,
    },
    {
      id: "payout-peter-failed",
      staffId: members[3].id,
      amount: 1200,
      currency: "KES",
      mpesaPhone: members[3].phone,
      status: "failed",
      type: "incentive",
      createdAt: yesterday,
      period: `${today.slice(0, 7)}`,
    },
    {
      id: "payout-amina-processing",
      staffId: members[4].id,
      amount: 1750,
      currency: "KES",
      mpesaPhone: members[4].phone,
      status: "processing",
      type: "tip",
      createdAt: now.toISOString(),
      period: `${today.slice(0, 7)}`,
    },
    {
      id: "payout-kevin-salary",
      staffId: members[5].id,
      amount: 28000,
      currency: "KES",
      mpesaPhone: members[5].phone,
      mpesaReference: "MPSA-KEVIN-28000",
      status: "sent",
      type: "salary",
      createdAt: "2026-05-29T06:00:00.000Z",
      processedAt: "2026-05-29T06:04:00.000Z",
      period: `${today.slice(0, 7)}`,
    },
  ];

  const notifications: StaffNotification[] = [
    {
      id: "notification-order-ready",
      staffId: members[0].id,
      type: "order_ready",
      title: "Order ready for Table 8",
      message: "Nyama choma platter is ready for pickup at the pass.",
      createdAt: now.toISOString(),
      actionUrl: "/dashboard/orders",
      metadata: { tableNumber: 8 },
    },
    {
      id: "notification-payment",
      staffId: members[1].id,
      type: "payment_received",
      title: "KES 6,850 received",
      message: "M-Pesa payment cleared for Table 11, including a KES 750 tip.",
      createdAt: now.toISOString(),
      metadata: { tableNumber: 11, amount: 6850 },
    },
    {
      id: "notification-tip",
      staffId: members[2].id,
      type: "tip_received",
      title: "Bar tip received",
      message:
        "A lounge customer added a KES 600 tip after the second cocktail round.",
      createdAt: now.toISOString(),
      metadata: { amount: 600 },
    },
    {
      id: "notification-table-seated",
      staffId: members[4].id,
      type: "table_seated",
      title: "Large walk-in seated",
      message:
        "A 6-top has been seated in the terrace section. Coordinate with Grace for service.",
      createdAt: now.toISOString(),
      metadata: { covers: 6, zone: "Terrace" },
    },
    {
      id: "notification-ai",
      staffId: members[5].id,
      type: "ai_suggestion",
      title: "AI staffing suggestion",
      message:
        "Friday 7–9pm is still trending understaffed by 1 front-of-house teammate.",
      createdAt: now.toISOString(),
    },
    {
      id: "notification-schedule",
      staffId: members[1].id,
      type: "schedule_change",
      title: "Schedule updated",
      message:
        "Your Friday shift now starts at 5:00pm to cover the dinner rush.",
      createdAt: now.toISOString(),
    },
    {
      id: "notification-payout",
      staffId: members[5].id,
      type: "payout_sent",
      title: "Salary payout sent",
      message: "Kevin's monthly salary was sent to M-Pesa successfully.",
      createdAt: "2026-05-29T06:04:00.000Z",
      readAt: "2026-05-29T06:12:00.000Z",
    },
  ];

  const challenges: StaffPerformanceChallenge[] = [
    {
      id: "challenge-most-tables",
      title: "Rush Hour Table Sprint",
      description:
        "Serve 18 tables this week to unlock a KES 3,500 dinner rush bonus.",
      metric: "tables_served",
      target: 18,
      reward: 3500,
      startDate: yesterday,
      endDate: tomorrow,
      participants: [
        { staffId: members[0].id, progress: 14 },
        { staffId: members[1].id, progress: 16 },
        { staffId: members[2].id, progress: 11 },
        { staffId: members[4].id, progress: 9 },
      ],
    },
    {
      id: "challenge-ratings",
      title: "4.7+ Guest Love",
      description:
        "Keep average guest ratings above 4.7 to unlock a KES 2,000 recognition bonus.",
      metric: "avg_rating",
      target: 4.7,
      reward: 2000,
      startDate: today,
      endDate: friday,
      participants: [
        { staffId: members[0].id, progress: 4.6 },
        { staffId: members[1].id, progress: 4.8 },
        { staffId: members[2].id, progress: 4.5 },
      ],
    },
  ];

  const insights = generateAIStaffInsights(members, shifts);

  return {
    staffMembers: members,
    staffShifts: shifts,
    staffNotifications: notifications,
    staffPayouts: payouts,
    staffChallenges: challenges,
    staffInsights: insights,
  };
}

export function createMerchantDemoData(now = new Date()): MerchantSnapshot {
  const catalogue = buildCatalogue();
  const menus = buildMenus(now);
  const zones = buildZones();
  const areas = buildAreas();
  const categoryOrder = buildCategoryOrder();
  const menuSchedules = buildMenuSchedules();
  const externalMenus = buildExternalMenus(now);
  const payments = buildPayments(catalogue, now);
  const tables = buildTables(catalogue, payments);
  const tableCombinations = buildTableCombinations();
  const orders = buildOrders(
    payments.filter((payment) => payment.status !== "failed"),
  );
  const reservations = buildReservations(now);
  const enquiries = buildEnquiries(now);
  const depositPolicy = buildDepositPolicy();
  const reviews = buildReviews(payments);
  const settings = buildSettings();
  const staffDemo = generateStaffDemoData(now);
  const workflows = buildWorkflows();
  const campaigns = buildCampaigns();
  const loyaltyCustomers = buildLoyaltyCustomers(now);

  return {
    catalogue,
    menus,
    zones,
    areas,
    categoryOrder,
    menuSchedules,
    externalMenus,
    tables,
    tableCombinations,
    orders,
    reservations,
    enquiries,
    depositPolicy,
    reviews,
    settings,
    staffMembers: staffDemo.staffMembers,
    staffShifts: staffDemo.staffShifts,
    staffNotifications: staffDemo.staffNotifications,
    staffPayouts: staffDemo.staffPayouts,
    staffChallenges: staffDemo.staffChallenges,
    staffInsights: staffDemo.staffInsights,
    workflows,
    campaigns,
    messageLog: [],
    loyaltyCustomers,
  };
}

function canUseStorage() {
  return (
    typeof window !== "undefined" && typeof window.localStorage !== "undefined"
  );
}

// --- Multi-venue scoping ---
// Merchant data is namespaced per venue. The "main" venue keeps the base keys
// so existing single-venue data is preserved; other venues get a suffix.


// An EMPTY starter snapshot for a freshly onboarded merchant: their own business
// name, a blank till (they configure M-Pesa in Settings), sensible config
// defaults, and no demo catalogue/orders/staff/etc. This is what makes a new
// tenant see THEIR business rather than shared demo content.
export function createMerchantStarterData(identity: {
  name: string;
  till?: string;
}): MerchantSnapshot {
  const base = buildSettings();
  const settings: MerchantSettings = {
    ...base,
    businessProfile: {
      ...base.businessProfile,
      name: identity.name || "My Business",
      tillNumber: identity.till ?? "",
      address: "",
      phone: "",
      logoUrl: "",
    },
    users: [],
  };
  return {
    catalogue: [],
    menus: [],
    zones: [],
    areas: [],
    categoryOrder: [],
    menuSchedules: [],
    externalMenus: [],
    tables: [],
    tableCombinations: [],
    orders: [],
    reservations: [],
    enquiries: [],
    depositPolicy: buildDepositPolicy(),
    reviews: [],
    settings,
    staffMembers: [],
    staffShifts: [],
    staffNotifications: [],
    staffPayouts: [],
    staffChallenges: [],
    staffInsights: [],
    workflows: [],
    campaigns: [],
    messageLog: [],
    loyaltyCustomers: [],
  };
}

// The seed identity used when creating a real merchant's starter — sourced from
// their pinned venue name (set at login). Never touches the snapshot (avoids
// recursion with loadMerchantSnapshot).
function currentMerchantIdentity(): { name: string; till: string } {
  const venue = getCurrentVenue();
  return { name: venue?.name || "My Business", till: "" };
}

// The base snapshot for the CURRENT venue: the rich demo for a demo venue, an
// empty per-merchant starter for a real tenant. Used as the seed + read fallback
// so a new merchant never falls back to demo data.
function baseSnapshotForCurrentVenue(): MerchantSnapshot {
  return isDemoVenue(getCurrentVenueId())
    ? createMerchantDemoData()
    : createMerchantStarterData(currentMerchantIdentity());
}

// The current tenant's public identity (name + till) for POS / KE-QR / receipts.
// Reads the per-venue business profile so each merchant shows their OWN brand.
export function getMerchantIdentity(): { name: string; till: string } {
  const profile = loadMerchantSnapshot().settings?.businessProfile;
  const demo = isDemoVenue(getCurrentVenueId());
  return {
    name: profile?.name || (demo ? MERCHANT_NAME : "My Business"),
    till: profile?.tillNumber || (demo ? TILL_NUMBER : ""),
  };
}

function mkey(baseKey: string): string {
  const venueId = getCurrentVenueId();
  return venueId === "main" ? baseKey : `${baseKey}::${venueId}`;
}

function readMerchant<T>(key: string, fallback: T): T {
  return readStorage(mkey(key), fallback);
}

function writeMerchant<T>(key: string, value: T): void {
  writeStorage(mkey(key), value);
}

export const SCHEMA_VERSION = 2;
const SCHEMA_VERSION_KEY = "fxengine.merchant.schemaVersion";

// Bring older persisted data up to the current shape without wiping user data.
function migrateMerchantData(): void {
  if (!canUseStorage()) return;
  const stored = Number(window.localStorage.getItem(SCHEMA_VERSION_KEY) ?? "1");
  if (stored >= SCHEMA_VERSION) return;

  // v1 -> v2: tables gained `capacity`/`bookable`; backfill so booking
  // capacity, combinations and the floor plan never see undefined seats.
  const tables = readStorage<MerchantTable[]>(STORAGE_KEYS.tables, []);
  if (tables.length > 0) {
    writeStorage(
      STORAGE_KEYS.tables,
      tables.map((table) => ({
        ...table,
        capacity: table.capacity ?? DEFAULT_TABLE_CAPACITY,
        bookable: table.bookable ?? true,
      })),
    );
  }

  writeStorage(SCHEMA_VERSION_KEY, SCHEMA_VERSION);
}

export function ensureMerchantDemoData() {
  if (!canUseStorage()) return baseSnapshotForCurrentVenue();

  if (isDemoVenue(getCurrentVenueId())) ensureRetailDemoData();
  const demo = baseSnapshotForCurrentVenue();

  (
    Object.entries(STORAGE_KEYS) as Array<[keyof typeof STORAGE_KEYS, string]>
  ).forEach(([name, key]) => {
    if (!window.localStorage.getItem(mkey(key))) {
      writeMerchant(key, demo[name]);
    }
  });

  migrateMerchantData();

  return loadMerchantSnapshot();
}

export function loadMerchantSnapshot(): MerchantSnapshot {
  const fallback = baseSnapshotForCurrentVenue();

  return {
    catalogue: readMerchant(STORAGE_KEYS.catalogue, fallback.catalogue),
    menus: readMerchant(STORAGE_KEYS.menus, fallback.menus),
    zones: readMerchant(STORAGE_KEYS.zones, fallback.zones),
    areas: readMerchant(STORAGE_KEYS.areas, fallback.areas),
    categoryOrder: readStorage(
      STORAGE_KEYS.categoryOrder,
      fallback.categoryOrder,
    ),
    menuSchedules: readStorage(
      STORAGE_KEYS.menuSchedules,
      fallback.menuSchedules,
    ),
    externalMenus: readStorage(
      STORAGE_KEYS.externalMenus,
      fallback.externalMenus,
    ),
    tables: readMerchant(STORAGE_KEYS.tables, fallback.tables),
    tableCombinations: readStorage(
      STORAGE_KEYS.tableCombinations,
      fallback.tableCombinations,
    ),
    orders: readMerchant(STORAGE_KEYS.orders, fallback.orders),
    reservations: readMerchant(STORAGE_KEYS.reservations, fallback.reservations),
    enquiries: readMerchant(STORAGE_KEYS.enquiries, fallback.enquiries),
    depositPolicy: readStorage(
      STORAGE_KEYS.depositPolicy,
      fallback.depositPolicy,
    ),
    reviews: readMerchant(STORAGE_KEYS.reviews, fallback.reviews),
    settings: readMerchant(STORAGE_KEYS.settings, fallback.settings),
    staffMembers: readMerchant(STORAGE_KEYS.staffMembers, fallback.staffMembers),
    staffShifts: readMerchant(STORAGE_KEYS.staffShifts, fallback.staffShifts),
    staffNotifications: readStorage(
      STORAGE_KEYS.staffNotifications,
      fallback.staffNotifications,
    ),
    staffPayouts: readMerchant(STORAGE_KEYS.staffPayouts, fallback.staffPayouts),
    staffChallenges: readStorage(
      STORAGE_KEYS.staffChallenges,
      fallback.staffChallenges,
    ),
    staffInsights: readStorage(
      STORAGE_KEYS.staffInsights,
      fallback.staffInsights,
    ),
    workflows: readMerchant(STORAGE_KEYS.workflows, fallback.workflows),
    campaigns: readMerchant(STORAGE_KEYS.campaigns, fallback.campaigns),
    messageLog: readMerchant(STORAGE_KEYS.messageLog, fallback.messageLog),
    loyaltyCustomers: readStorage(
      STORAGE_KEYS.loyaltyCustomers,
      fallback.loyaltyCustomers,
    ),
  };
}

export function saveMerchantTables(tables: MerchantTable[]) {
  writeMerchant(STORAGE_KEYS.tables, tables);
}

export function saveMerchantReservations(reservations: Reservation[]) {
  writeMerchant(STORAGE_KEYS.reservations, reservations);
}

export function saveMerchantEnquiries(enquiries: Enquiry[]) {
  writeMerchant(STORAGE_KEYS.enquiries, enquiries);
}

export function saveMerchantDepositPolicy(policy: DepositPolicy) {
  writeMerchant(STORAGE_KEYS.depositPolicy, policy);
}

export function saveMerchantWorkflows(workflows: Workflow[]) {
  writeMerchant(STORAGE_KEYS.workflows, workflows);
}

export function saveMerchantCampaigns(campaigns: Campaign[]) {
  writeMerchant(STORAGE_KEYS.campaigns, campaigns);
}

export function saveMerchantMessageLog(messageLog: MessageLogEntry[]) {
  writeMerchant(STORAGE_KEYS.messageLog, messageLog);
}

// Replace {{var}} placeholders in a message template.
export function renderTemplate(
  template: string,
  vars: Record<string, string | number>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = vars[key];
    return value === undefined ? "" : String(value);
  });
}

export function getCampaignRecipients(
  segment: CampaignSegment,
  customers: LoyaltyCustomer[],
  now: Date = new Date(),
): LoyaltyCustomer[] {
  if (segment === "all") return customers;
  if (segment === "gold_plus") {
    return customers.filter(
      (customer) => customer.tier === "Gold" || customer.tier === "Platinum",
    );
  }
  const cutoff = now.getTime() - 30 * 86_400_000;
  return customers.filter(
    (customer) => new Date(customer.lastVisit).getTime() < cutoff,
  );
}

// Which bookings an automation trigger applies to on a given date.
export function matchReservationsForTrigger(
  trigger: WorkflowTrigger,
  reservations: Reservation[],
  date: string,
): Reservation[] {
  const forDate = reservations.filter((reservation) => reservation.date === date);
  switch (trigger) {
    case "booking_created":
      return forDate.filter((reservation) => reservation.status === "confirmed");
    case "reminder":
      return forDate.filter(
        (reservation) =>
          reservation.status === "confirmed" || reservation.status === "seated",
      );
    case "post_visit":
      return forDate.filter((reservation) => reservation.status === "seated");
    case "no_show":
      return forDate.filter((reservation) => reservation.status === "no-show");
    default:
      return [];
  }
}

export function getDepositDue(policy: DepositPolicy, covers: number): number {
  if (!policy.enabled || covers < policy.minCovers) return 0;
  return policy.perGuestKES * covers;
}

export function getDepositStats(
  policy: DepositPolicy,
  reservations: Reservation[],
) {
  let collected = 0;
  let pending = 0;
  let refunded = 0;
  for (const reservation of reservations) {
    if (reservation.status === "cancelled" || reservation.status === "no-show") {
      continue;
    }
    if (reservation.depositStatus === "paid") {
      collected += reservation.depositAmount ?? 0;
    } else if (reservation.depositStatus === "refunded") {
      refunded += reservation.depositAmount ?? 0;
    } else {
      pending += getDepositDue(policy, reservation.covers);
    }
  }
  return { collected, pending, refunded };
}

export function getNewEnquiries(enquiries: Enquiry[]): Enquiry[] {
  return enquiries
    .filter((enquiry) => enquiry.status === "new")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function getPendingEnquiryCount(enquiries: Enquiry[]): number {
  return enquiries.filter((enquiry) => enquiry.status === "new").length;
}

export type PartyAssignment =
  | { kind: "table"; tableNumber: number }
  | { kind: "combination"; combinationId: string };

// Best fit for a party at a slot: smallest free single table, else the highest
// priority free combination. Reused by bookings and enquiry approval.
export function suggestPartyAssignment(
  tables: MerchantTable[],
  combinations: TableCombination[],
  reservations: Reservation[],
  date: string,
  time: string,
  covers: number,
): PartyAssignment | null {
  const occupied = getOccupiedTableNumbers(
    reservations,
    combinations,
    date,
    time,
  );
  const table = getAvailableTablesForParty(tables, covers, occupied)[0];
  if (table) return { kind: "table", tableNumber: table.tableNumber };
  const combination = getAvailableCombinationsForParty(
    combinations,
    covers,
    occupied,
  )[0];
  if (combination) return { kind: "combination", combinationId: combination.id };
  return null;
}

export function saveMerchantCatalogue(catalogue: CatalogueItem[]) {
  writeMerchant(STORAGE_KEYS.catalogue, catalogue);
}

export function saveMerchantMenus(menus: Menu[]) {
  writeMerchant(STORAGE_KEYS.menus, menus);
}

export function saveMerchantZones(zones: Zone[]) {
  writeMerchant(STORAGE_KEYS.zones, zones);
}

export function saveMerchantTableCombinations(
  tableCombinations: TableCombination[],
) {
  writeMerchant(STORAGE_KEYS.tableCombinations, tableCombinations);
}

export function tableSeats(table: MerchantTable): number {
  return table.capacity ?? DEFAULT_TABLE_CAPACITY;
}

export function isTableBookable(table: MerchantTable): boolean {
  return table.bookable !== false;
}

export function getBookableTables(tables: MerchantTable[]): MerchantTable[] {
  return tables.filter(isTableBookable);
}

export function tableLabel(table: MerchantTable): string {
  return table.name?.trim() ? table.name.trim() : `Table ${table.tableNumber}`;
}

export function getCombinationSeats(
  combination: TableCombination,
  tables: MerchantTable[],
): number {
  return combination.tableNumbers.reduce((total, tableNumber) => {
    const table = tables.find((entry) => entry.tableNumber === tableNumber);
    return total + (table ? tableSeats(table) : 0);
  }, 0);
}

// Booking allocation: pick the highest-priority active combination whose
// capacity window fits the party size (mirrors Stampede's 1-5 priority model).
export function pickCombinationForParty(
  combinations: TableCombination[],
  covers: number,
): TableCombination | null {
  return (
    combinations
      .filter(
        (combination) =>
          combination.active &&
          covers >= combination.minCapacity &&
          covers <= combination.maxCapacity,
      )
      .sort((a, b) => b.priority - a.priority)[0] ?? null
  );
}

// Table numbers already taken by a booking for a given date + time slot.
// A combination booking occupies every table it merges. Cancelled and
// no-show bookings free their tables.
export function getOccupiedTableNumbers(
  reservations: Reservation[],
  combinations: TableCombination[],
  date: string,
  time: string,
): Set<number> {
  const occupied = new Set<number>();
  for (const reservation of reservations) {
    if (reservation.date !== date || reservation.time !== time) continue;
    if (
      reservation.status === "cancelled" ||
      reservation.status === "no-show"
    ) {
      continue;
    }
    if (reservation.combinationId) {
      const combination = combinations.find(
        (entry) => entry.id === reservation.combinationId,
      );
      if (combination) {
        combination.tableNumbers.forEach((tableNumber) =>
          occupied.add(tableNumber),
        );
        continue;
      }
    }
    occupied.add(reservation.tableNumber);
  }
  return occupied;
}

// Bookable single tables that seat the party and are free for the slot,
// smallest suitable table first (avoid wasting large tables).
export function getAvailableTablesForParty(
  tables: MerchantTable[],
  covers: number,
  occupied: Set<number>,
): MerchantTable[] {
  return getBookableTables(tables)
    .filter(
      (table) =>
        tableSeats(table) >= covers && !occupied.has(table.tableNumber),
    )
    .sort((a, b) => tableSeats(a) - tableSeats(b));
}

// Active combinations whose capacity window fits the party and whose member
// tables are all free for the slot, highest priority first.
export function getAvailableCombinationsForParty(
  combinations: TableCombination[],
  covers: number,
  occupied: Set<number>,
): TableCombination[] {
  return combinations
    .filter(
      (combination) =>
        combination.active &&
        covers >= combination.minCapacity &&
        covers <= combination.maxCapacity &&
        combination.tableNumbers.every(
          (tableNumber) => !occupied.has(tableNumber),
        ),
    )
    .sort((a, b) => b.priority - a.priority);
}

// A combination is "live" (physically in use, billed as one) once a booking
// that references it has been seated.
export function getSeatedCombinationIds(
  reservations: Reservation[],
): Set<string> {
  const ids = new Set<string>();
  for (const reservation of reservations) {
    if (reservation.combinationId && reservation.status === "seated") {
      ids.add(reservation.combinationId);
    }
  }
  return ids;
}

export function getLiveCombinationForTable(
  combinations: TableCombination[],
  reservations: Reservation[],
  tableNumber: number,
): TableCombination | null {
  const seated = getSeatedCombinationIds(reservations);
  return (
    combinations.find(
      (combination) =>
        seated.has(combination.id) &&
        combination.tableNumbers.includes(tableNumber),
    ) ?? null
  );
}

export function getSeatedCombinationsByTable(
  combinations: TableCombination[],
  reservations: Reservation[],
): Map<number, TableCombination> {
  const seated = getSeatedCombinationIds(reservations);
  const byTable = new Map<number, TableCombination>();
  for (const combination of combinations) {
    if (!seated.has(combination.id)) continue;
    for (const tableNumber of combination.tableNumbers) {
      byTable.set(tableNumber, combination);
    }
  }
  return byTable;
}

export function getCombinationTables(
  combination: TableCombination,
  tables: MerchantTable[],
): MerchantTable[] {
  return combination.tableNumbers
    .map((tableNumber) =>
      tables.find((table) => table.tableNumber === tableNumber),
    )
    .filter((table): table is MerchantTable => Boolean(table));
}

export function saveMerchantAreas(areas: Area[]) {
  writeMerchant(STORAGE_KEYS.areas, areas);
}

export function getVisibleAreas(areas: Area[]): Area[] {
  return areas
    .filter((area) => !area.hiddenFromDayPlanner)
    .sort((a, b) => a.order - b.order);
}

export function getAreaForTable(
  areas: Area[],
  tableNumber: number,
): Area | null {
  return (
    [...areas]
      .sort((a, b) => a.order - b.order)
      .find((area) => area.tableNumbers.includes(tableNumber)) ?? null
  );
}

export function getReservationTableNumbers(
  reservation: Reservation,
  combinations: TableCombination[],
): number[] {
  if (reservation.combinationId) {
    const combination = combinations.find(
      (entry) => entry.id === reservation.combinationId,
    );
    if (combination) return combination.tableNumbers;
  }
  return [reservation.tableNumber];
}

export function getBookingStats(reservations: Reservation[], date: string) {
  const forDate = reservations.filter(
    (reservation) =>
      reservation.date === date &&
      reservation.status !== "cancelled" &&
      reservation.status !== "no-show",
  );
  return {
    bookings: forDate.length,
    covers: forDate.reduce((sum, reservation) => sum + reservation.covers, 0),
    confirmed: forDate.filter((entry) => entry.status === "confirmed").length,
    seated: forDate.filter((entry) => entry.status === "seated").length,
  };
}

export type AreaBookings = {
  area: Area | null;
  reservations: Reservation[];
};

// Bookings for a date, grouped by (visible) area. Bookings whose tables aren't
// in any visible area fall into a trailing "Unassigned" group (area: null).
export function getBookingsByArea(
  areas: Area[],
  reservations: Reservation[],
  combinations: TableCombination[],
  date: string,
): AreaBookings[] {
  const visible = getVisibleAreas(areas);
  const forDate = reservations
    .filter(
      (reservation) =>
        reservation.date === date &&
        reservation.status !== "cancelled" &&
        reservation.status !== "no-show",
    )
    .sort((a, b) => a.time.localeCompare(b.time));

  const groups: AreaBookings[] = visible.map((area) => ({
    area,
    reservations: [],
  }));
  const unassigned: Reservation[] = [];

  for (const reservation of forDate) {
    const tableNumbers = getReservationTableNumbers(reservation, combinations);
    const group = groups.find((entry) => {
      const area = entry.area;
      return (
        area !== null &&
        tableNumbers.some((tableNumber) =>
          area.tableNumbers.includes(tableNumber),
        )
      );
    });
    if (group) group.reservations.push(reservation);
    else unassigned.push(reservation);
  }

  if (unassigned.length > 0) {
    groups.push({ area: null, reservations: unassigned });
  }
  return groups;
}

export function saveMerchantCategoryOrder(categoryOrder: string[]) {
  writeMerchant(STORAGE_KEYS.categoryOrder, categoryOrder);
}

export function saveMerchantMenuSchedules(menuSchedules: MenuSchedule[]) {
  writeMerchant(STORAGE_KEYS.menuSchedules, menuSchedules);
}

export function saveMerchantExternalMenus(externalMenus: ExternalMenu[]) {
  writeMerchant(STORAGE_KEYS.externalMenus, externalMenus);
}

export function saveMerchantReviews(reviews: MerchantReview[]) {
  writeMerchant(STORAGE_KEYS.reviews, reviews);
}

export function saveMerchantSettings(settings: MerchantSettings) {
  writeMerchant(STORAGE_KEYS.settings, settings);
}

export function saveMerchantStaffMembers(staffMembers: StaffMember[]) {
  writeMerchant(STORAGE_KEYS.staffMembers, staffMembers);
}

export function saveMerchantStaffShifts(staffShifts: StaffShift[]) {
  writeMerchant(STORAGE_KEYS.staffShifts, staffShifts);
}

export function saveMerchantStaffNotifications(
  staffNotifications: StaffNotification[],
) {
  writeMerchant(STORAGE_KEYS.staffNotifications, staffNotifications);
}

export function saveMerchantStaffPayouts(staffPayouts: StaffPayout[]) {
  writeMerchant(STORAGE_KEYS.staffPayouts, staffPayouts);
}

export function saveMerchantStaffChallenges(
  staffChallenges: StaffPerformanceChallenge[],
) {
  writeMerchant(STORAGE_KEYS.staffChallenges, staffChallenges);
}

export function saveMerchantStaffInsights(staffInsights: AIStaffInsight[]) {
  writeMerchant(STORAGE_KEYS.staffInsights, staffInsights);
}

export function flattenTransactions(tables: MerchantTable[]) {
  return tables
    .flatMap((table) =>
      table.payments.map((payment) => ({
        ...payment,
        tableNumber: table.tableNumber,
        // Persisted (localStorage) payments from older schema versions may lack
        // metadata; guarantee an object so consumers can read keys safely.
        metadata: payment.metadata ?? {},
      })),
    )
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
}

export function createTableQrValue(
  tableNumber: number,
  settings?: MerchantSettings,
) {
  const profile = settings?.businessProfile;
  return JSON.stringify({
    merchant: profile?.name || MERCHANT_NAME,
    till: profile?.tillNumber || TILL_NUMBER,
    table: tableNumber,
    route: `/pay?table=${tableNumber}`,
  });
}

export function getActiveMenus(menus: Menu[]) {
  return menus.filter((menu) => menu.isActive);
}

export function getTableZone(zones: Zone[], tableNumber: number) {
  return (
    zones.find(
      (zone) =>
        tableNumber >= zone.tableRange[0] && tableNumber <= zone.tableRange[1],
    ) ?? null
  );
}

export function getOrderedCategories(
  categories: string[],
  categoryOrder: string[],
) {
  const unique = Array.from(new Set(categories.filter(Boolean)));
  const indexMap = new Map(
    categoryOrder.map((category, index) => [category, index]),
  );
  return unique.sort((left, right) => {
    const leftIndex = indexMap.get(left);
    const rightIndex = indexMap.get(right);
    if (leftIndex != null && rightIndex != null) return leftIndex - rightIndex;
    if (leftIndex != null) return -1;
    if (rightIndex != null) return 1;
    return left.localeCompare(right);
  });
}

export const getOrderedMerchantCategories = getOrderedCategories;
export const getZoneForTable = getTableZone;

export function getVisibleCatalogueForTable({
  catalogue,
  menus,
  zones,
  tableNumber,
  activeSchedule,
}: {
  catalogue: CatalogueItem[];
  menus: Menu[];
  zones: Zone[];
  tableNumber: number;
  activeSchedule?: MenuSchedule | null;
}) {
  let allowedCategories = new Set(
    catalogue.map((item) => item.category).filter(Boolean),
  );

  const activeMenus = getActiveMenus(menus);
  if (activeMenus.length) {
    allowedCategories = new Set(
      activeMenus.flatMap((menu) => menu.categories).filter(Boolean),
    );
  }

  const zone = getTableZone(zones, tableNumber);
  if (zone) {
    const zoneCategories = activeMenus
      .filter((menu) => zone.menuIds.includes(menu.id))
      .flatMap((menu) => menu.categories)
      .filter(Boolean);
    if (zoneCategories.length) {
      allowedCategories = new Set(zoneCategories);
    }
  }

  if (activeSchedule) {
    const scheduleCategories = new Set(activeSchedule.categories);
    allowedCategories = new Set(
      Array.from(allowedCategories).filter((category) =>
        scheduleCategories.has(category),
      ),
    );
  }

  return catalogue.filter((item) => allowedCategories.has(item.category));
}

function retailProductImage(label: string, background: string) {
  return `https://placehold.co/240x240/${background}/ffffff?text=${encodeURIComponent(label)}`;
}

function balanceCreditEntries(entries: CreditCustomer["entries"]) {
  return entries.reduce((sum, entry) => {
    return entry.type === "purchase" ? sum + entry.amount : sum - entry.amount;
  }, 0);
}

function buildRetailStoreProfile(): RetailStoreProfile {
  return {
    id: "sades-corner-duka",
    name: "Sade's Corner Duka",
    location: "Westlands, Nairobi",
    phone: "+254700247365",
    tillNumber: TILL_NUMBER,
    whatsapp: "+254700247365",
    receiptFooter: "Asante kwa kununua na PesaSwap. Karibu tena.",
  };
}

function buildRetailProducts(now = new Date()): RetailProduct[] {
  const createdAt = minusTime(now, 45, 0).toISOString();
  return [
    {
      id: "retail-pembe-2kg",
      name: "Pembe Maize Flour 2kg",
      sku: "GRO-PEM-2KG",
      barcode: createRetailBarcode(1),
      category: "Groceries",
      costPrice: 155,
      sellPrice: 180,
      stock: 32,
      reorderLevel: 12,
      unit: "packets",
      supplier: "Unga Distributors",
      supplierPhone: "+254722410120",
      image: retailProductImage("Pembe 2kg", "2563eb"),
      isActive: true,
      lastRestocked: minusTime(now, 6, 2).toISOString(),
      createdAt,
    },
    {
      id: "retail-mumias-sugar",
      name: "Mumias Sugar 1kg",
      sku: "GRO-MUM-1KG",
      barcode: createRetailBarcode(2),
      category: "Groceries",
      costPrice: 160,
      sellPrice: 180,
      stock: 18,
      reorderLevel: 10,
      unit: "packets",
      supplier: "Mumias Wholesale",
      supplierPhone: "+254733101010",
      image: retailProductImage("Sugar", "16a34a"),
      isActive: true,
      lastRestocked: minusTime(now, 5, 4).toISOString(),
      createdAt,
    },
    {
      id: "retail-fresh-fry-1l",
      name: "Fresh Fry Cooking Oil 1L",
      sku: "GRO-FFO-1L",
      barcode: createRetailBarcode(3),
      category: "Groceries",
      costPrice: 245,
      sellPrice: 280,
      stock: 14,
      reorderLevel: 8,
      unit: "litres",
      supplier: "Bidco Kenya",
      supplierPhone: "+254722330055",
      image: retailProductImage("Oil 1L", "f59e0b"),
      isActive: true,
      lastRestocked: minusTime(now, 8, 3).toISOString(),
      createdAt,
    },
    {
      id: "retail-rice-2kg",
      name: "Pishori Rice 2kg",
      sku: "GRO-RIC-2KG",
      barcode: createRetailBarcode(4),
      category: "Groceries",
      costPrice: 265,
      sellPrice: 320,
      stock: 11,
      reorderLevel: 8,
      unit: "packets",
      supplier: "Nairobi Grain Stores",
      supplierPhone: "+254734555111",
      image: retailProductImage("Rice 2kg", "0f766e"),
      isActive: true,
      lastRestocked: minusTime(now, 11, 1).toISOString(),
      createdAt,
    },
    {
      id: "retail-royco-100g",
      name: "Royco Mchuzi Mix 100g",
      sku: "GRO-ROY-100G",
      barcode: createRetailBarcode(5),
      category: "Groceries",
      costPrice: 22,
      sellPrice: 30,
      stock: 56,
      reorderLevel: 20,
      unit: "packets",
      supplier: "Unga Distributors",
      supplierPhone: "+254722410120",
      image: retailProductImage("Royco", "ea580c"),
      isActive: true,
      lastRestocked: minusTime(now, 2, 2).toISOString(),
      createdAt,
    },
    {
      id: "retail-indomie-pack",
      name: "Indomie Noodles Pack",
      sku: "GRO-IND-PK",
      barcode: createRetailBarcode(6),
      category: "Groceries",
      costPrice: 38,
      sellPrice: 50,
      stock: 44,
      reorderLevel: 18,
      unit: "packets",
      supplier: "Quickmart Wholesale",
      supplierPhone: "+254722447700",
      image: retailProductImage("Indomie", "dc2626"),
      isActive: true,
      lastRestocked: minusTime(now, 4, 1).toISOString(),
      createdAt,
    },
    {
      id: "retail-brookside-500ml",
      name: "Brookside Milk 500ml",
      sku: "BEV-BRO-500",
      barcode: createRetailBarcode(7),
      category: "Beverages",
      costPrice: 52,
      sellPrice: 65,
      stock: 24,
      reorderLevel: 10,
      unit: "pieces",
      supplier: "Brookside Route",
      supplierPhone: "+254700889911",
      image: retailProductImage("Milk", "3b82f6"),
      isActive: true,
      lastRestocked: minusTime(now, 1, 5).toISOString(),
      createdAt,
    },
    {
      id: "retail-coke-500ml",
      name: "Coca Cola 500ml",
      sku: "BEV-COK-500",
      barcode: createRetailBarcode(8),
      category: "Beverages",
      costPrice: 55,
      sellPrice: 70,
      stock: 36,
      reorderLevel: 12,
      unit: "pieces",
      supplier: "Coca-Cola Beverages",
      supplierPhone: "+254722980010",
      image: retailProductImage("Coke", "b91c1c"),
      isActive: true,
      lastRestocked: minusTime(now, 3, 6).toISOString(),
      createdAt,
    },
    {
      id: "retail-fanta-500ml",
      name: "Fanta Orange 500ml",
      sku: "BEV-FAN-500",
      barcode: createRetailBarcode(9),
      category: "Beverages",
      costPrice: 55,
      sellPrice: 70,
      stock: 28,
      reorderLevel: 12,
      unit: "pieces",
      supplier: "Coca-Cola Beverages",
      supplierPhone: "+254722980010",
      image: retailProductImage("Fanta", "f97316"),
      isActive: true,
      lastRestocked: minusTime(now, 3, 6).toISOString(),
      createdAt,
    },
    {
      id: "retail-dasani-1l",
      name: "Dasani Water 1L",
      sku: "BEV-DAS-1L",
      barcode: createRetailBarcode(10),
      category: "Beverages",
      costPrice: 40,
      sellPrice: 50,
      stock: 41,
      reorderLevel: 20,
      unit: "pieces",
      supplier: "Coca-Cola Beverages",
      supplierPhone: "+254722980010",
      image: retailProductImage("Water", "0284c7"),
      isActive: true,
      lastRestocked: minusTime(now, 2, 3).toISOString(),
      createdAt,
    },
    {
      id: "retail-tusker-500ml",
      name: "Tusker Lager 500ml",
      sku: "BEV-TUS-500",
      barcode: createRetailBarcode(11),
      category: "Beverages",
      costPrice: 200,
      sellPrice: 250,
      stock: 9,
      reorderLevel: 10,
      unit: "pieces",
      supplier: "EABL Distributor",
      supplierPhone: "+254711100221",
      image: retailProductImage("Tusker", "ca8a04"),
      isActive: true,
      lastRestocked: minusTime(now, 9, 2).toISOString(),
      createdAt,
    },
    {
      id: "retail-redbull-250ml",
      name: "Red Bull 250ml",
      sku: "BEV-RBL-250",
      barcode: createRetailBarcode(12),
      category: "Beverages",
      costPrice: 130,
      sellPrice: 160,
      stock: 7,
      reorderLevel: 8,
      unit: "pieces",
      supplier: "Energy Brands EA",
      supplierPhone: "+254744228811",
      image: retailProductImage("Energy", "1d4ed8"),
      isActive: true,
      lastRestocked: minusTime(now, 10, 1).toISOString(),
      createdAt,
    },
    {
      id: "retail-dettol-175g",
      name: "Dettol Soap 175g",
      sku: "PER-DET-175",
      barcode: createRetailBarcode(13),
      category: "Personal Care",
      costPrice: 95,
      sellPrice: 120,
      stock: 22,
      reorderLevel: 10,
      unit: "pieces",
      supplier: "Reckitt Benckiser",
      supplierPhone: "+254701223344",
      image: retailProductImage("Dettol", "15803d"),
      isActive: true,
      lastRestocked: minusTime(now, 7, 1).toISOString(),
      createdAt,
    },
    {
      id: "retail-colgate-100ml",
      name: "Colgate Toothpaste 100ml",
      sku: "PER-COL-100",
      barcode: createRetailBarcode(14),
      category: "Personal Care",
      costPrice: 105,
      sellPrice: 135,
      stock: 17,
      reorderLevel: 8,
      unit: "pieces",
      supplier: "Orbit Consumer Supplies",
      supplierPhone: "+254720448877",
      image: retailProductImage("Colgate", "dc2626"),
      isActive: true,
      lastRestocked: minusTime(now, 8, 2).toISOString(),
      createdAt,
    },
    {
      id: "retail-softcare-roll",
      name: "Softcare Tissue Roll",
      sku: "PER-SFT-RLL",
      barcode: createRetailBarcode(15),
      category: "Personal Care",
      costPrice: 28,
      sellPrice: 40,
      stock: 60,
      reorderLevel: 18,
      unit: "pieces",
      supplier: "Household Depot",
      supplierPhone: "+254745442211",
      image: retailProductImage("Tissue", "7c3aed"),
      isActive: true,
      lastRestocked: minusTime(now, 1, 1).toISOString(),
      createdAt,
    },
    {
      id: "retail-pampers-small",
      name: "Pampers Small Pack",
      sku: "PER-PAM-SML",
      barcode: createRetailBarcode(16),
      category: "Personal Care",
      costPrice: 310,
      sellPrice: 360,
      stock: 6,
      reorderLevel: 6,
      unit: "packets",
      supplier: "Baby Needs Kenya",
      supplierPhone: "+254712331100",
      image: retailProductImage("Pampers", "ec4899"),
      isActive: true,
      lastRestocked: minusTime(now, 12, 2).toISOString(),
      createdAt,
    },
    {
      id: "retail-omo-500g",
      name: "Omo Washing Powder 500g",
      sku: "HOU-OMO-500",
      barcode: createRetailBarcode(17),
      category: "Household",
      costPrice: 78,
      sellPrice: 95,
      stock: 13,
      reorderLevel: 8,
      unit: "packets",
      supplier: "Unilever Kenya",
      supplierPhone: "+254733019988",
      image: retailProductImage("Omo", "0ea5e9"),
      isActive: true,
      lastRestocked: minusTime(now, 9, 4).toISOString(),
      createdAt,
    },
    {
      id: "retail-jik-750ml",
      name: "Jik Bleach 750ml",
      sku: "HOU-JIK-750",
      barcode: createRetailBarcode(18),
      category: "Household",
      costPrice: 145,
      sellPrice: 175,
      stock: 8,
      reorderLevel: 8,
      unit: "pieces",
      supplier: "Unilever Kenya",
      supplierPhone: "+254733019988",
      image: retailProductImage("Jik", "0284c7"),
      isActive: true,
      lastRestocked: minusTime(now, 10, 2).toISOString(),
      createdAt,
    },
    {
      id: "retail-matchbox",
      name: "Flamingo Matchbox",
      sku: "HOU-MTC-BOX",
      barcode: createRetailBarcode(19),
      category: "Household",
      costPrice: 8,
      sellPrice: 15,
      stock: 54,
      reorderLevel: 25,
      unit: "boxes",
      supplier: "Household Depot",
      supplierPhone: "+254745442211",
      image: retailProductImage("Match", "9333ea"),
      isActive: true,
      lastRestocked: minusTime(now, 4, 2).toISOString(),
      createdAt,
    },
    {
      id: "retail-kerosene-1l",
      name: "Kerosene 1L",
      sku: "HOU-KER-1L",
      barcode: createRetailBarcode(20),
      category: "Household",
      costPrice: 172,
      sellPrice: 195,
      stock: 5,
      reorderLevel: 8,
      unit: "litres",
      supplier: "Fuelmart Agency",
      supplierPhone: "+254733880090",
      image: retailProductImage("Kero", "475569"),
      isActive: true,
      lastRestocked: minusTime(now, 15, 1).toISOString(),
      createdAt,
    },
    {
      id: "retail-charcoal-2kg",
      name: "Charcoal Pack 2kg",
      sku: "HOU-CHR-2KG",
      barcode: createRetailBarcode(21),
      category: "Household",
      costPrice: 88,
      sellPrice: 120,
      stock: 4,
      reorderLevel: 6,
      unit: "packets",
      supplier: "Household Depot",
      supplierPhone: "+254745442211",
      image: retailProductImage("Charcoal", "334155"),
      isActive: true,
      lastRestocked: minusTime(now, 14, 2).toISOString(),
      createdAt,
    },
    {
      id: "retail-safaricom-50",
      name: "Safaricom Airtime KES 50",
      sku: "AIR-SAF-050",
      barcode: createRetailBarcode(22),
      category: "Airtime & Electronics",
      costPrice: 48,
      sellPrice: 50,
      stock: 80,
      reorderLevel: 30,
      unit: "pieces",
      supplier: "Safaricom Dealer",
      supplierPhone: "+254722551177",
      image: retailProductImage("Airtime 50", "16a34a"),
      isActive: true,
      lastRestocked: minusTime(now, 1, 0).toISOString(),
      createdAt,
    },
    {
      id: "retail-safaricom-100",
      name: "Safaricom Airtime KES 100",
      sku: "AIR-SAF-100",
      barcode: createRetailBarcode(23),
      category: "Airtime & Electronics",
      costPrice: 96,
      sellPrice: 100,
      stock: 64,
      reorderLevel: 30,
      unit: "pieces",
      supplier: "Safaricom Dealer",
      supplierPhone: "+254722551177",
      image: retailProductImage("Airtime 100", "22c55e"),
      isActive: true,
      lastRestocked: minusTime(now, 1, 0).toISOString(),
      createdAt,
    },
    {
      id: "retail-safaricom-250",
      name: "Safaricom Airtime KES 250",
      sku: "AIR-SAF-250",
      barcode: createRetailBarcode(24),
      category: "Airtime & Electronics",
      costPrice: 242,
      sellPrice: 250,
      stock: 21,
      reorderLevel: 12,
      unit: "pieces",
      supplier: "Safaricom Dealer",
      supplierPhone: "+254722551177",
      image: retailProductImage("Airtime 250", "65a30d"),
      isActive: true,
      lastRestocked: minusTime(now, 6, 0).toISOString(),
      createdAt,
    },
    {
      id: "retail-usb-cable",
      name: "USB Charging Cable",
      sku: "AIR-USB-CBL",
      barcode: createRetailBarcode(25),
      category: "Airtime & Electronics",
      costPrice: 180,
      sellPrice: 250,
      stock: 12,
      reorderLevel: 6,
      unit: "pieces",
      supplier: "Tech Accessory Hub",
      supplierPhone: "+254701559944",
      image: retailProductImage("USB", "111827"),
      isActive: true,
      lastRestocked: minusTime(now, 13, 3).toISOString(),
      createdAt,
    },
    {
      id: "retail-earphones",
      name: "In-Ear Earphones",
      sku: "AIR-EAR-PHN",
      barcode: createRetailBarcode(26),
      category: "Airtime & Electronics",
      costPrice: 260,
      sellPrice: 350,
      stock: 3,
      reorderLevel: 5,
      unit: "pieces",
      supplier: "Tech Accessory Hub",
      supplierPhone: "+254701559944",
      image: retailProductImage("Earphones", "4f46e5"),
      isActive: true,
      lastRestocked: minusTime(now, 16, 2).toISOString(),
      createdAt,
    },
  ];
}

function buildRetailSuppliers(products: RetailProduct[]): Supplier[] {
  return [
    {
      id: "supplier-unga",
      name: "Unga Distributors",
      phone: "+254722410120",
      email: "orders@unga.co.ke",
      products: products
        .filter((product) =>
          [
            "Unga Distributors",
            "Mumias Wholesale",
            "Bidco Kenya",
            "Nairobi Grain Stores",
            "Quickmart Wholesale",
          ].includes(product.supplier || ""),
        )
        .map((product) => product.id),
      lastOrderDate: minusTime(new Date(), 6, 2).toISOString(),
    },
    {
      id: "supplier-household",
      name: "Household Depot",
      phone: "+254745442211",
      email: "hello@householddepot.co.ke",
      products: products
        .filter((product) =>
          [
            "Household Depot",
            "Unilever Kenya",
            "Reckitt Benckiser",
            "Orbit Consumer Supplies",
            "Baby Needs Kenya",
          ].includes(product.supplier || ""),
        )
        .map((product) => product.id),
      lastOrderDate: minusTime(new Date(), 9, 3).toISOString(),
    },
    {
      id: "supplier-connect",
      name: "Safaricom Dealer",
      phone: "+254722551177",
      email: "dealer@safaricom.co.ke",
      products: products
        .filter((product) =>
          [
            "Safaricom Dealer",
            "Tech Accessory Hub",
            "Coca-Cola Beverages",
            "EABL Distributor",
            "Energy Brands EA",
            "Brookside Route",
            "Fuelmart Agency",
          ].includes(product.supplier || ""),
        )
        .map((product) => product.id),
      lastOrderDate: minusTime(new Date(), 3, 5).toISOString(),
    },
  ];
}

function buildRetailSales(
  products: RetailProduct[],
  now = new Date(),
): RetailSale[] {
  const productMap = new Map(products.map((product) => [product.id, product]));
  const combos = [
    ["retail-pembe-2kg", 2, "retail-brookside-500ml", 1],
    ["retail-coke-500ml", 2, "retail-indomie-pack", 3],
    ["retail-mumias-sugar", 1, "retail-fresh-fry-1l", 1],
    ["retail-dettol-175g", 1, "retail-colgate-100ml", 1],
    ["retail-safaricom-100", 1, "retail-softcare-roll", 2],
    ["retail-tusker-500ml", 4, "retail-matchbox", 1],
    ["retail-omo-500g", 1, "retail-jik-750ml", 1],
    ["retail-redbull-250ml", 1, "retail-usb-cable", 1],
    ["retail-safaricom-50", 2, "retail-coke-500ml", 1],
    ["retail-rice-2kg", 1, "retail-royco-100g", 2],
    ["retail-charcoal-2kg", 1, "retail-kerosene-1l", 1],
    ["retail-pampers-small", 1, "retail-brookside-500ml", 2],
    ["retail-earphones", 1, "retail-safaricom-250", 1],
    ["retail-dasani-1l", 3, "retail-indomie-pack", 2],
    ["retail-fanta-500ml", 2, "retail-softcare-roll", 1],
    ["retail-pembe-2kg", 1, "retail-mumias-sugar", 1],
    ["retail-dettol-175g", 2, "retail-omo-500g", 1],
    ["retail-coke-500ml", 1, "retail-safaricom-50", 1],
  ] as const;
  const paymentMethods: RetailSale["paymentMethod"][] = [
    "mpesa",
    "cash",
    "bnpl",
    "mpesa",
    "credit",
  ];
  const customers = [
    { name: "Mama Brian", phone: "+254712334455" },
    { name: "Kevin K.", phone: "+254722991100" },
    { name: "Akinyi", phone: "+254733558811" },
    { name: "Mr. Kamau", phone: "+254711009988" },
    { name: "Njeri Boutique", phone: "+254745880011" },
  ];

  return combos.map((combo, index) => {
    const items = [
      { productId: combo[0], qty: combo[1] },
      { productId: combo[2], qty: combo[3] },
    ].map((entry) => {
      const product = productMap.get(entry.productId);
      if (!product)
        throw new Error(`Missing retail product ${entry.productId}`);
      return {
        productId: product.id,
        name: product.name,
        qty: entry.qty,
        unitPrice: product.sellPrice,
      };
    });
    const total = items.reduce(
      (sum, item) => sum + item.qty * item.unitPrice,
      0,
    );
    const customer = customers[index % customers.length];
    const paymentMethod = paymentMethods[index % paymentMethods.length];
    const createdAt = minusTime(
      now,
      Math.floor(index / 2),
      1 + (index % 4),
      (index * 13) % 60,
    ).toISOString();
    return {
      id: `sale-${index + 1}`,
      items,
      total,
      paymentMethod,
      customerName:
        paymentMethod === "cash" && index % 3 === 0 ? undefined : customer.name,
      customerPhone:
        paymentMethod === "cash" && index % 3 === 0
          ? undefined
          : customer.phone,
      mpesaRef: paymentMethod === "mpesa" ? `QJ${820100 + index}` : undefined,
      createdAt,
      refunded: index === 11,
    };
  });
}

function buildRetailCreditCustomers(now = new Date()): CreditCustomer[] {
  const customers: CreditCustomer[] = [
    {
      id: "credit-mama-brian",
      name: "Mama Brian",
      phone: "+254712334455",
      creditLimit: 7000,
      balance: 0,
      entries: [
        {
          id: "credit-entry-1",
          type: "purchase",
          amount: 2500,
          description: "Groceries for estate delivery",
          date: minusTime(now, 45, 0).toISOString(),
          dueDate: minusTime(now, -15, 0).toISOString().slice(0, 10),
          saleId: "sale-5",
        },
        {
          id: "credit-entry-2",
          type: "payment",
          amount: 1200,
          description: "Cash repayment",
          date: minusTime(now, 18, 0).toISOString(),
        },
        {
          id: "credit-entry-3",
          type: "purchase",
          amount: 900,
          description: "Milk, sugar and flour",
          date: minusTime(now, 9, 0).toISOString(),
          dueDate: minusTime(now, -21, 0).toISOString().slice(0, 10),
        },
      ],
      createdAt: minusTime(now, 120, 0).toISOString(),
    },
    {
      id: "credit-njeri-boutique",
      name: "Njeri Boutique",
      phone: "+254745880011",
      creditLimit: 10000,
      balance: 0,
      entries: [
        {
          id: "credit-entry-4",
          type: "purchase",
          amount: 5000,
          description: "Tissue, detergents and beverages",
          date: minusTime(now, 45, 0).toISOString(),
          dueDate: minusTime(now, -5, 0).toISOString().slice(0, 10),
          saleId: "sale-10",
        },
      ],
      createdAt: minusTime(now, 200, 0).toISOString(),
    },
    {
      id: "credit-boda-juma",
      name: "Juma Boda",
      phone: "+254722991100",
      creditLimit: 3000,
      balance: 0,
      entries: [
        {
          id: "credit-entry-5",
          type: "purchase",
          amount: 600,
          description: "Fuel and airtime top-up",
          date: minusTime(now, 12, 0).toISOString(),
          dueDate: minusTime(now, -18, 0).toISOString().slice(0, 10),
        },
        {
          id: "credit-entry-6",
          type: "payment",
          amount: 200,
          description: "M-Pesa partial repayment",
          date: minusTime(now, 2, 0).toISOString(),
        },
      ],
      createdAt: minusTime(now, 40, 0).toISOString(),
    },
  ];

  return customers.map((customer) => ({
    ...customer,
    balance: balanceCreditEntries(customer.entries),
  }));
}

function buildRetailPurchaseOrders(
  products: RetailProduct[],
  suppliers: Supplier[],
  now = new Date(),
): PurchaseOrder[] {
  const productMap = new Map(products.map((product) => [product.id, product]));
  const unga = suppliers[0];
  const household = suppliers[1];
  return [
    {
      id: "po-001",
      supplierId: unga?.id || "supplier-unga",
      supplierName: unga?.name || "Unga Distributors",
      items: [
        "retail-pembe-2kg",
        "retail-mumias-sugar",
        "retail-fresh-fry-1l",
      ].map((productId, index) => {
        const product = productMap.get(productId);
        if (!product) throw new Error(`Missing retail product ${productId}`);
        return {
          productId,
          name: product.name,
          qty: 10 + index * 5,
          unitCost: product.costPrice,
        };
      }),
      total: [
        "retail-pembe-2kg",
        "retail-mumias-sugar",
        "retail-fresh-fry-1l",
      ].reduce((sum, productId, index) => {
        const product = productMap.get(productId);
        return sum + (product?.costPrice || 0) * (10 + index * 5);
      }, 0),
      status: "sent",
      createdAt: minusTime(now, 6, 0).toISOString(),
    },
    {
      id: "po-002",
      supplierId: household?.id || "supplier-household",
      supplierName: household?.name || "Household Depot",
      items: [
        "retail-charcoal-2kg",
        "retail-kerosene-1l",
        "retail-pampers-small",
      ].map((productId, index) => {
        const product = productMap.get(productId);
        if (!product) throw new Error(`Missing retail product ${productId}`);
        return {
          productId,
          name: product.name,
          qty: 6 + index * 2,
          unitCost: product.costPrice,
        };
      }),
      total: [
        "retail-charcoal-2kg",
        "retail-kerosene-1l",
        "retail-pampers-small",
      ].reduce((sum, productId, index) => {
        const product = productMap.get(productId);
        return sum + (product?.costPrice || 0) * (6 + index * 2);
      }, 0),
      status: "received",
      createdAt: minusTime(now, 14, 0).toISOString(),
      receivedAt: minusTime(now, 10, 0).toISOString(),
    },
  ];
}

function buildRetailAdjustments(
  products: RetailProduct[],
  sales: RetailSale[],
  now = new Date(),
): StockAdjustment[] {
  const adjustments: StockAdjustment[] = sales.flatMap((sale, saleIndex) =>
    sale.items.map((item, itemIndex) => ({
      id: `adj-sale-${saleIndex + 1}-${itemIndex + 1}`,
      productId: item.productId,
      type: "sold",
      quantity: -item.qty,
      reason: `Sale ${sale.id}`,
      createdAt: new Date(
        new Date(sale.createdAt).getTime() + itemIndex * 60_000,
      ).toISOString(),
    })),
  );

  const extraAdjustments: StockAdjustment[] = [
    {
      id: "adj-restock-1",
      productId: "retail-tusker-500ml",
      type: "received",
      quantity: 24,
      reason: "Weekend restock",
      createdAt: minusTime(now, 9, 1).toISOString(),
    },
    {
      id: "adj-damaged-1",
      productId: "retail-brookside-500ml",
      type: "damaged",
      quantity: -3,
      reason: "Damaged in chiller",
      createdAt: minusTime(now, 3, 2).toISOString(),
    },
    {
      id: "adj-returned-1",
      productId: "retail-coke-500ml",
      type: "returned",
      quantity: 2,
      reason: "Customer return",
      createdAt: minusTime(now, 4, 5).toISOString(),
    },
    {
      id: "adj-counted-1",
      productId: products[0]?.id || "retail-pembe-2kg",
      type: "counted",
      quantity: -1,
      reason: "Cycle count variance",
      createdAt: minusTime(now, 1, 3).toISOString(),
    },
  ];

  return [...adjustments, ...extraAdjustments].sort(
    (a, b) => +new Date(b.createdAt) - +new Date(a.createdAt),
  );
}

export function generateRetailDemoData(now = new Date()): RetailSnapshot {
  const storeProfile = buildRetailStoreProfile();
  const products = buildRetailProducts(now);
  const sales = buildRetailSales(products, now);
  const suppliers = buildRetailSuppliers(products);
  const adjustments = buildRetailAdjustments(products, sales, now);
  const creditCustomers = buildRetailCreditCustomers(now);
  const purchaseOrders = buildRetailPurchaseOrders(products, suppliers, now);

  return {
    storeProfile,
    products,
    sales,
    adjustments,
    creditCustomers,
    suppliers,
    purchaseOrders,
  };
}

export function getRetailAnalytics(
  sales: RetailSale[],
  products: RetailProduct[],
): RetailAnalytics {
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const productMap = new Map(products.map((product) => [product.id, product]));
  const validSales = sales.filter((sale) => !sale.refunded);

  const revenueToday = validSales
    .filter((sale) => new Date(sale.createdAt) >= startToday)
    .reduce((sum, sale) => sum + sale.total, 0);
  const revenueWeek = validSales
    .filter((sale) => new Date(sale.createdAt) >= weekAgo)
    .reduce((sum, sale) => sum + sale.total, 0);
  const revenueMonth = validSales
    .filter((sale) => new Date(sale.createdAt) >= monthAgo)
    .reduce((sum, sale) => sum + sale.total, 0);
  const unitsSold = validSales.reduce(
    (sum, sale) =>
      sum + sale.items.reduce((itemSum, item) => itemSum + item.qty, 0),
    0,
  );
  const grossProfitEstimate = validSales.reduce((sum, sale) => {
    return (
      sum +
      sale.items.reduce((itemSum, item) => {
        const product = productMap.get(item.productId);
        return (
          itemSum + (item.unitPrice - (product?.costPrice || 0)) * item.qty
        );
      }, 0)
    );
  }, 0);

  const paymentBreakdown = ["mpesa", "cash", "credit", "bnpl"].map(
    (method) => ({
      name: method,
      value: validSales
        .filter((sale) => sale.paymentMethod === method)
        .reduce((sum, sale) => sum + sale.total, 0),
    }),
  );

  const topProducts = Array.from(
    validSales
      .reduce((acc, sale) => {
        sale.items.forEach((item) => {
          const current = acc.get(item.productId) || {
            productId: item.productId,
            name: item.name,
            qty: 0,
            revenue: 0,
          };
          current.qty += item.qty;
          current.revenue += item.qty * item.unitPrice;
          acc.set(item.productId, current);
        });
        return acc;
      }, new Map<string, { productId: string; name: string; qty: number; revenue: number }>())
      .values(),
  )
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);

  const revenueTrend = Array.from({ length: 7 }).map((_, index) => {
    const day = new Date(now.getTime() - (6 - index) * 24 * 60 * 60 * 1000);
    const start = new Date(day.getFullYear(), day.getMonth(), day.getDate());
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    return {
      label: start.toLocaleDateString("en-KE", { weekday: "short" }),
      revenue: validSales
        .filter((sale) => {
          const createdAt = new Date(sale.createdAt);
          return createdAt >= start && createdAt < end;
        })
        .reduce((sum, sale) => sum + sale.total, 0),
    };
  });

  return {
    revenueToday,
    revenueWeek,
    revenueMonth,
    salesCount: validSales.length,
    unitsSold,
    grossProfitEstimate,
    paymentBreakdown,
    topProducts,
    revenueTrend,
  };
}

export function getLowStockProducts(products: RetailProduct[]) {
  return [...products]
    .filter((product) => product.stock <= product.reorderLevel)
    .sort((a, b) => a.stock - b.stock);
}

export function getCreditAging(customers: CreditCustomer[]) {
  const now = new Date();
  const customerAging = customers.map((customer) => {
    const buckets = { current: 0, thirty: 0, sixty: 0, ninety: 0 };
    customer.entries
      .filter((entry) => entry.type === "purchase")
      .forEach((entry) => {
        const baseDate = entry.dueDate
          ? new Date(entry.dueDate)
          : new Date(entry.date);
        const ageDays = Math.max(
          0,
          Math.floor(
            (now.getTime() - baseDate.getTime()) / (24 * 60 * 60 * 1000),
          ),
        );
        if (ageDays >= 90) buckets.ninety += entry.amount;
        else if (ageDays >= 60) buckets.sixty += entry.amount;
        else if (ageDays >= 30) buckets.thirty += entry.amount;
        else buckets.current += entry.amount;
      });

    const payments = customer.entries
      .filter((entry) => entry.type === "payment")
      .reduce((sum, entry) => sum + entry.amount, 0);
    let remainingPayments = payments;
    const orderedBuckets = ["ninety", "sixty", "thirty", "current"] as const;
    const adjustedBuckets = { ...buckets };
    orderedBuckets.forEach((bucket) => {
      if (remainingPayments <= 0) return;
      const offset = Math.min(adjustedBuckets[bucket], remainingPayments);
      adjustedBuckets[bucket] -= offset;
      remainingPayments -= offset;
    });

    return {
      customerId: customer.id,
      name: customer.name,
      balance: customer.balance,
      buckets: adjustedBuckets,
      oldestDays: customer.entries
        .filter((entry) => entry.type === "purchase")
        .reduce((max, entry) => {
          const baseDate = entry.dueDate
            ? new Date(entry.dueDate)
            : new Date(entry.date);
          const ageDays = Math.max(
            0,
            Math.floor(
              (now.getTime() - baseDate.getTime()) / (24 * 60 * 60 * 1000),
            ),
          );
          return Math.max(max, ageDays);
        }, 0),
    };
  });

  const totals = customerAging.reduce(
    (summary, customer) => {
      summary.current += customer.buckets.current;
      summary.thirty += customer.buckets.thirty;
      summary.sixty += customer.buckets.sixty;
      summary.ninety += customer.buckets.ninety;
      return summary;
    },
    { current: 0, thirty: 0, sixty: 0, ninety: 0 },
  );

  return { customers: customerAging, totals };
}

// Empty per-tenant retail starter — a real venue creates its OWN catalogue rather
// than inheriting the demo store. Mirrors baseSnapshotForCurrentVenue (menu/tables).
export function emptyRetailSnapshot(): RetailSnapshot {
  const identity = currentMerchantIdentity();
  return {
    storeProfile: {
      id: getCurrentVenueId(),
      name: identity.name,
      location: "",
      phone: "",
      tillNumber: identity.till,
      whatsapp: "",
      receiptFooter: "Thank you for your purchase.",
    },
    products: [],
    sales: [],
    adjustments: [],
    creditCustomers: [],
    suppliers: [],
    purchaseOrders: [],
  };
}

// The retail base for the CURRENT venue: rich demo for a demo venue, empty starter
// for a real tenant (so a new merchant never inherits the sample store).
function baseRetailSnapshot(): RetailSnapshot {
  return isDemoVenue(getCurrentVenueId())
    ? generateRetailDemoData()
    : emptyRetailSnapshot();
}

export function ensureRetailDemoData() {
  if (!canUseStorage()) return baseRetailSnapshot();

  const base = baseRetailSnapshot();
  (
    Object.entries(RETAIL_STORAGE_KEYS) as Array<
      [keyof typeof RETAIL_STORAGE_KEYS, string]
    >
  ).forEach(([name, key]) => {
    if (!window.localStorage.getItem(mkey(key))) writeStorage(mkey(key), base[name]);
  });

  return loadRetailSnapshot();
}

export function loadRetailSnapshot(): RetailSnapshot {
  const fallback = baseRetailSnapshot();
  return {
    storeProfile: readStorage(
      mkey(RETAIL_STORAGE_KEYS.storeProfile),
      fallback.storeProfile,
    ),
    products: readStorage(mkey(RETAIL_STORAGE_KEYS.products), fallback.products),
    sales: readStorage(mkey(RETAIL_STORAGE_KEYS.sales), fallback.sales),
    adjustments: readStorage(
      mkey(RETAIL_STORAGE_KEYS.adjustments),
      fallback.adjustments,
    ),
    creditCustomers: readStorage(
      mkey(RETAIL_STORAGE_KEYS.creditCustomers),
      fallback.creditCustomers,
    ).map((customer) => ({
      ...customer,
      balance: balanceCreditEntries(customer.entries),
    })),
    suppliers: readStorage(
      mkey(RETAIL_STORAGE_KEYS.suppliers),
      fallback.suppliers,
    ),
    purchaseOrders: readStorage(
      mkey(RETAIL_STORAGE_KEYS.purchaseOrders),
      fallback.purchaseOrders,
    ),
  };
}

export function saveRetailStoreProfile(storeProfile: RetailStoreProfile) {
  writeStorage(mkey(RETAIL_STORAGE_KEYS.storeProfile), storeProfile);
}

export function saveRetailProducts(products: RetailProduct[]) {
  writeStorage(mkey(RETAIL_STORAGE_KEYS.products), products);
}

export function saveRetailSales(sales: RetailSale[]) {
  writeStorage(mkey(RETAIL_STORAGE_KEYS.sales), sales);
}

export function saveStockAdjustments(adjustments: StockAdjustment[]) {
  writeStorage(mkey(RETAIL_STORAGE_KEYS.adjustments), adjustments);
}

export function saveCreditCustomers(creditCustomers: CreditCustomer[]) {
  writeStorage(
    mkey(RETAIL_STORAGE_KEYS.creditCustomers),
    creditCustomers.map((customer) => ({
      ...customer,
      balance: balanceCreditEntries(customer.entries),
    })),
  );
}

export function saveRetailSuppliers(suppliers: Supplier[]) {
  writeStorage(mkey(RETAIL_STORAGE_KEYS.suppliers), suppliers);
}

export function savePurchaseOrders(purchaseOrders: PurchaseOrder[]) {
  writeStorage(mkey(RETAIL_STORAGE_KEYS.purchaseOrders), purchaseOrders);
}

export function getRetailStoreSlug(profile?: RetailStoreProfile) {
  return profile?.id || createRetailId("store", profile?.name || MERCHANT_NAME);
}

export const SERVICES_STORAGE_KEY = "pesaswap.services.data";

export type ServiceBusinessType =
  | "mechanic"
  | "salon"
  | "tutor"
  | "cleaner"
  | "plumber"
  | "general";

export type ServiceBusinessProfile = {
  id: string;
  name: string;
  type: ServiceBusinessType;
  description: string;
  location: string;
  phone: string;
  whatsapp: string;
  email: string;
  tillNumber: string;
  logoUrl: string;
  website?: string;
  operatingHours: Array<{
    day: number;
    label: string;
    start: string;
    end: string;
  }>;
};

export type ServiceStaff = {
  id: string;
  name: string;
  role: string;
  specialty: string;
  phone: string;
  color: string;
  isActive: boolean;
  avatar?: string;
  availability: Array<{ day: number; start: string; end: string }>;
};

export type ServicesSnapshot = {
  business: ServiceBusinessProfile;
  staff: ServiceStaff[];
  categories: ServiceCategory[];
  services: ServiceOffering[];
  packages: ServicePackage[];
  clients: ServiceClient[];
  bookings: Booking[];
  jobCards: JobCard[];
};

export type ServiceAnalytics = {
  revenueByServiceType: Array<{ name: string; value: number }>;
  busiestMatrix: Array<{ day: string; hour: string; count: number }>;
  busiestDays: Array<{ name: string; value: number }>;
  busiestHours: Array<{ name: string; value: number }>;
  bookingStatusBreakdown: Array<{ name: string; value: number }>;
  clientRetentionRate: number;
  averageJobValue: number;
  monthlyComparison: { current: number; previous: number; delta: number };
  aiInsights: string[];
};

const SERVICE_WEEK_DAYS = [
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
  "Sun",
] as const;
const ACTIVE_BOOKING_STATUSES: Booking["status"][] = [
  "scheduled",
  "confirmed",
  "in_progress",
  "completed",
];
const SERVICE_OPEN_MINUTES = 8 * 60;
const SERVICE_CLOSE_MINUTES = 18 * 60;

function serviceStartOfWeek(date: Date) {
  const next = new Date(date);
  const day = (next.getDay() + 6) % 7;
  next.setDate(next.getDate() - day);
  next.setHours(0, 0, 0, 0);
  return next;
}

function serviceMinutesFromTime(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function serviceTimeFromMinutes(value: number) {
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function serviceAddMinutes(time: string, duration: number) {
  return serviceTimeFromMinutes(serviceMinutesFromTime(time) + duration);
}

function servicePhoto(label: string, background = "1d4ed8") {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="420" viewBox="0 0 600 420"><rect width="600" height="420" fill="#${background}" rx="36"/><text x="50%" y="48%" dominant-baseline="middle" text-anchor="middle" fill="#ffffff" font-size="36" font-family="Arial, sans-serif">${label}</text><text x="50%" y="60%" dominant-baseline="middle" text-anchor="middle" fill="#dbeafe" font-size="18" font-family="Arial, sans-serif">PesaSwap Job Card</text></svg>`;
  const encode =
    typeof globalThis.btoa === "function" ? globalThis.btoa(svg) : svg;
  return `data:image/svg+xml;base64,${encode}`;
}

function serviceImage(label: string, background: string) {
  return `https://placehold.co/320x240/${background}/ffffff?text=${encodeURIComponent(label)}`;
}

function getServiceBookingRevenue(
  bookings: Booking[],
  statuses: Booking["status"][],
) {
  return bookings
    .filter((booking) => statuses.includes(booking.status))
    .reduce((sum, booking) => sum + booking.price, 0);
}

function buildServiceBusiness(): ServiceBusinessProfile {
  return {
    id: "nairobi-auto-care",
    name: "Nairobi Auto Care",
    type: "mechanic",
    description:
      "Trusted neighbourhood garage for diagnostics, servicing, brakes, tyres, AC work, and fleet maintenance.",
    location: "Muthithi Road, Westlands, Nairobi",
    phone: "+254711247365",
    whatsapp: "+254711247365",
    email: "service@nairobiautocare.co.ke",
    tillNumber: "522247",
    logoUrl: serviceImage("Auto Care", "1e3a8a"),
    website: "https://pesaswap.africa/book/nairobi-auto-care",
    operatingHours: [
      { day: 0, label: "Sun", start: "09:00", end: "14:00" },
      { day: 1, label: "Mon", start: "08:00", end: "18:00" },
      { day: 2, label: "Tue", start: "08:00", end: "18:00" },
      { day: 3, label: "Wed", start: "08:00", end: "18:00" },
      { day: 4, label: "Thu", start: "08:00", end: "18:00" },
      { day: 5, label: "Fri", start: "08:00", end: "18:00" },
      { day: 6, label: "Sat", start: "08:00", end: "17:00" },
    ],
  };
}

function buildServiceStaff(): ServiceStaff[] {
  const availability = [1, 2, 3, 4, 5, 6].map((day) => ({
    day,
    start: "08:00",
    end: day === 6 ? "17:00" : "18:00",
  }));
  return [
    {
      id: "staff-kariuki",
      name: "John Kariuki",
      role: "Lead mechanic",
      specialty: "Engine service & scheduled maintenance",
      phone: "+254722340120",
      color: "#2563eb",
      isActive: true,
      avatar: serviceImage("JK", "2563eb"),
      availability,
    },
    {
      id: "staff-otieno",
      name: "Peter Otieno",
      role: "Brake specialist",
      specialty: "Brakes, suspension & wheel alignment",
      phone: "+254733102233",
      color: "#0f766e",
      isActive: true,
      avatar: serviceImage("PO", "0f766e"),
      availability,
    },
    {
      id: "staff-mutiso",
      name: "Alex Mutiso",
      role: "General technician",
      specialty: "Quick service, batteries & tyres",
      phone: "+254712881144",
      color: "#f59e0b",
      isActive: true,
      avatar: serviceImage("AM", "f59e0b"),
      availability,
    },
    {
      id: "staff-wanjiru",
      name: "Faith Wanjiru",
      role: "Auto electrician",
      specialty: "Diagnostics, AC & electrical systems",
      phone: "+254700112299",
      color: "#7c3aed",
      isActive: true,
      avatar: serviceImage("FW", "7c3aed"),
      availability: availability.map((entry) => ({
        ...entry,
        start: entry.day === 6 ? "09:00" : "08:30",
      })),
    },
  ];
}

function buildServiceCategories(): ServiceCategory[] {
  return [
    { id: "service", name: "Service", icon: "Wrench", color: "#2563eb" },
    { id: "repair", name: "Repair", icon: "Hammer", color: "#dc2626" },
    {
      id: "diagnostics",
      name: "Diagnostics",
      icon: "ScanLine",
      color: "#7c3aed",
    },
    {
      id: "bodywork",
      name: "Bodywork",
      icon: "CarFront",
      color: "#0f766e",
    },
  ];
}

function buildServiceCatalogue(staff: ServiceStaff[]): ServiceOffering[] {
  const john = staff[0]?.id ?? "staff-kariuki";
  const peter = staff[1]?.id ?? "staff-otieno";
  const alex = staff[2]?.id ?? "staff-mutiso";
  const faith = staff[3]?.id ?? "staff-wanjiru";
  return [
    {
      id: "svc-oil-change",
      name: "Oil Change",
      description:
        "Engine oil, oil filter change, top-up fluids, and 12-point safety check.",
      category: "Service",
      price: 3500,
      priceType: "fixed",
      duration: 60,
      staffIds: [john, alex],
      materials: ["Engine oil", "Oil filter", "Drain plug washer"],
      isActive: true,
      image: serviceImage("Oil Change", "2563eb"),
    },
    {
      id: "svc-brake-service",
      name: "Brake Service",
      description:
        "Brake pad inspection, cleaning, machining, and fluid top-up.",
      category: "Repair",
      price: 8000,
      priceType: "fixed",
      duration: 120,
      staffIds: [peter, john],
      materials: ["Brake pads", "Brake cleaner", "Brake fluid"],
      isActive: true,
      image: serviceImage("Brakes", "dc2626"),
    },
    {
      id: "svc-wheel-alignment",
      name: "Wheel Alignment",
      description:
        "Front and rear alignment for smooth handling and tyre life.",
      category: "Service",
      price: 2500,
      priceType: "fixed",
      duration: 45,
      staffIds: [peter, alex],
      materials: ["Alignment shims"],
      isActive: true,
      image: serviceImage("Alignment", "0f766e"),
    },
    {
      id: "svc-full-service",
      name: "Full Service",
      description:
        "Full periodic service covering oil, filters, brakes, diagnostics, and wash.",
      category: "Service",
      price: 12000,
      priceType: "fixed",
      duration: 240,
      staffIds: [john, peter],
      materials: ["Engine oil", "Oil filter", "Air filter", "Cabin filter"],
      isActive: true,
      image: serviceImage("Full Service", "1d4ed8"),
    },
    {
      id: "svc-diagnostics",
      name: "Diagnostics",
      description: "OBD scan, electrical checks, and fault-code report.",
      category: "Diagnostics",
      price: 2000,
      priceType: "fixed",
      duration: 30,
      staffIds: [faith, john],
      materials: ["Diagnostic scan"],
      isActive: true,
      image: serviceImage("Diagnostics", "7c3aed"),
    },
    {
      id: "svc-ac-repair",
      name: "AC Repair",
      description:
        "Compressor check, gas refill, leak test, and cabin cooling tune-up.",
      category: "Repair",
      price: 15000,
      priceType: "from",
      duration: 180,
      staffIds: [faith, john],
      materials: ["AC gas", "Compressor oil", "UV leak dye"],
      isActive: true,
      image: serviceImage("AC Repair", "0ea5e9"),
    },
    {
      id: "svc-battery-replacement",
      name: "Battery Replacement",
      description:
        "Battery supply, fitment, terminal cleanup, and charging test.",
      category: "Repair",
      price: 5000,
      priceType: "fixed",
      duration: 30,
      staffIds: [alex, faith],
      materials: ["Battery", "Terminal grease"],
      isActive: true,
      image: serviceImage("Battery", "f59e0b"),
    },
    {
      id: "svc-tire-rotation",
      name: "Tire Rotation",
      description: "Tyre rotation, pressure balancing, and quick tread report.",
      category: "Service",
      price: 1500,
      priceType: "fixed",
      duration: 30,
      staffIds: [alex, peter],
      materials: ["Wheel weights"],
      isActive: true,
      image: serviceImage("Tyres", "475569"),
    },
  ];
}

function buildServicePackages(services: ServiceOffering[]): ServicePackage[] {
  const lookup = new Map(services.map((service) => [service.name, service.id]));
  return [
    {
      id: "pkg-full-service-bundle",
      name: "Full Service Bundle",
      description:
        "Oil change, brake service, and wheel alignment for fleet cars and busy commuters.",
      services: [
        lookup.get("Oil Change") ?? "svc-oil-change",
        lookup.get("Brake Service") ?? "svc-brake-service",
        lookup.get("Wheel Alignment") ?? "svc-wheel-alignment",
      ],
      price: 12000,
      savings: 2000,
      isActive: true,
    },
    {
      id: "pkg-ac-diagnostic",
      name: "Cooling Rescue Pack",
      description:
        "Diagnostics plus AC repair assessment and gas top-up for city traffic heat.",
      services: [
        lookup.get("Diagnostics") ?? "svc-diagnostics",
        lookup.get("AC Repair") ?? "svc-ac-repair",
      ],
      price: 15500,
      savings: 1500,
      isActive: true,
    },
  ];
}

function buildServiceClients(now = new Date()): ServiceClient[] {
  return [
    {
      id: "client-wanjiku",
      name: "Wanjiku Maina",
      phone: "+254712334455",
      email: "wanjiku.maina@example.com",
      tag: "vip",
      totalVisits: 8,
      totalSpent: 46200,
      lastVisit: minusTime(now, 2, 4).toISOString(),
      notes: "Prefers same-day diagnostics updates on WhatsApp.",
      loyaltyPoints: 80,
      createdAt: minusTime(now, 120, 0).toISOString(),
    },
    {
      id: "client-otieno",
      name: "Otieno Odhiambo",
      phone: "+254723456701",
      email: "otieno@example.com",
      tag: "regular",
      totalVisits: 5,
      totalSpent: 25700,
      lastVisit: minusTime(now, 8, 3).toISOString(),
      notes: "Fleet rider; likes early morning slots.",
      loyaltyPoints: 50,
      createdAt: minusTime(now, 95, 0).toISOString(),
    },
    {
      id: "client-fatma",
      name: "Fatma Noor",
      phone: "+254701456789",
      email: "fatma.noor@example.com",
      tag: "regular",
      totalVisits: 4,
      totalSpent: 19800,
      lastVisit: minusTime(now, 5, 2).toISOString(),
      notes: "Needs aircon checked before long drives to Mombasa.",
      loyaltyPoints: 40,
      createdAt: minusTime(now, 82, 0).toISOString(),
    },
    {
      id: "client-atieno",
      name: "Atieno Achieng",
      phone: "+254722908172",
      tag: "new",
      totalVisits: 1,
      totalSpent: 3500,
      lastVisit: minusTime(now, 1, 5).toISOString(),
      notes: "First service booked after QR poster scan.",
      loyaltyPoints: 10,
      createdAt: minusTime(now, 18, 0).toISOString(),
    },
    {
      id: "client-kamau",
      name: "Kamau Karanja",
      phone: "+254700234123",
      email: "kamau.k@example.com",
      tag: "corporate",
      totalVisits: 12,
      totalSpent: 124000,
      lastVisit: minusTime(now, 3, 1).toISOString(),
      notes: "Runs three delivery vans. Send approvals by SMS and WhatsApp.",
      loyaltyPoints: 120,
      createdAt: minusTime(now, 150, 0).toISOString(),
    },
    {
      id: "client-njeri",
      name: "Njeri Wambui",
      phone: "+254714555222",
      tag: "vip",
      totalVisits: 9,
      totalSpent: 60200,
      lastVisit: minusTime(now, 4, 2).toISOString(),
      notes: "Requests pickup reminders one day before service.",
      loyaltyPoints: 90,
      createdAt: minusTime(now, 170, 0).toISOString(),
    },
    {
      id: "client-mwikali",
      name: "Mwikali Mutua",
      phone: "+254711334499",
      tag: "regular",
      totalVisits: 3,
      totalSpent: 12000,
      lastVisit: minusTime(now, 6, 1).toISOString(),
      notes: "Keeps paperless invoices only.",
      loyaltyPoints: 30,
      createdAt: minusTime(now, 60, 0).toISOString(),
    },
  ];
}

function buildServiceBookings(
  services: ServiceOffering[],
  clients: ServiceClient[],
  staff: ServiceStaff[],
  now = new Date(),
): Booking[] {
  const serviceMap = new Map(services.map((service) => [service.id, service]));
  const clientMap = new Map(clients.map((client) => [client.id, client]));
  const staffMap = new Map(staff.map((member) => [member.id, member]));
  const createBooking = (
    id: string,
    daysOffset: number,
    startTime: string,
    serviceId: string,
    clientId: string,
    staffId: string | undefined,
    status: Booking["status"],
    paymentStatus: Booking["paymentStatus"],
    paymentMethod: Booking["paymentMethod"] | undefined,
    notes?: string,
    isWalkIn?: boolean,
  ): Booking => {
    const service = serviceMap.get(serviceId);
    const client = clientMap.get(clientId);
    const member = staffId ? staffMap.get(staffId) : undefined;
    const baseDate = plusDays(
      now,
      daysOffset,
      Number(startTime.slice(0, 2)),
      Number(startTime.slice(3, 5)),
    );
    const duration = service?.duration ?? 60;
    return {
      id,
      clientId: client?.id ?? clientId,
      clientName: client?.name ?? "Walk-in Customer",
      clientPhone: client?.phone ?? "+254700000000",
      serviceId: service?.id ?? serviceId,
      serviceName: service?.name ?? "Service",
      staffId: member?.id,
      staffName: member?.name,
      date: toIsoDate(baseDate),
      startTime,
      endTime: serviceAddMinutes(startTime, duration),
      duration,
      price: service?.price ?? 0,
      status,
      paymentStatus,
      paymentMethod,
      notes,
      isWalkIn,
      createdAt: new Date(
        baseDate.getTime() - 2 * 60 * 60 * 1000,
      ).toISOString(),
    };
  };

  return [
    createBooking(
      "booking-001",
      -5,
      "09:00",
      "svc-oil-change",
      "client-wanjiku",
      "staff-kariuki",
      "completed",
      "paid",
      "mpesa",
      "Requested synthetic oil and wiper fluid top-up.",
    ),
    createBooking(
      "booking-002",
      -4,
      "11:30",
      "svc-diagnostics",
      "client-fatma",
      "staff-wanjiru",
      "completed",
      "paid",
      "card",
      "Dashboard light on after school run.",
    ),
    createBooking(
      "booking-003",
      -3,
      "14:00",
      "svc-brake-service",
      "client-otieno",
      "staff-otieno",
      "completed",
      "deposit",
      "cash",
      "Rear brake squeal on rough road.",
    ),
    createBooking(
      "booking-004",
      -2,
      "16:00",
      "svc-ac-repair",
      "client-njeri",
      "staff-wanjiru",
      "no_show",
      "unpaid",
      undefined,
      "Client travelling back from Naivasha.",
    ),
    createBooking(
      "booking-005",
      -1,
      "10:30",
      "svc-wheel-alignment",
      "client-kamau",
      "staff-otieno",
      "completed",
      "paid",
      "mpesa",
      "Delivery van steering drift.",
    ),
    createBooking(
      "booking-006",
      0,
      "08:30",
      "svc-oil-change",
      "client-atieno",
      "staff-mutiso",
      "scheduled",
      "unpaid",
      undefined,
      "Waiting customer - quick turnaround needed.",
    ),
    createBooking(
      "booking-007",
      0,
      "09:30",
      "svc-diagnostics",
      "client-wanjiku",
      "staff-wanjiru",
      "in_progress",
      "deposit",
      "mpesa",
      "Intermittent engine light after weekend trip.",
    ),
    createBooking(
      "booking-008",
      0,
      "11:00",
      "svc-battery-replacement",
      "client-mwikali",
      "staff-mutiso",
      "confirmed",
      "paid",
      "mpesa",
      "Battery failing in the mornings.",
      true,
    ),
    createBooking(
      "booking-009",
      0,
      "13:30",
      "svc-full-service",
      "client-kamau",
      "staff-kariuki",
      "scheduled",
      "deposit",
      "bnpl",
      "Van needed by 5pm for next route.",
    ),
    createBooking(
      "booking-010",
      0,
      "15:00",
      "svc-tire-rotation",
      "client-fatma",
      "staff-otieno",
      "scheduled",
      "unpaid",
      undefined,
      "Check front tyre wear pattern.",
    ),
    createBooking(
      "booking-011",
      1,
      "09:00",
      "svc-brake-service",
      "client-otieno",
      "staff-otieno",
      "confirmed",
      "deposit",
      "card",
      "Pad replacement and rotor skim.",
    ),
    createBooking(
      "booking-012",
      1,
      "13:00",
      "svc-ac-repair",
      "client-njeri",
      "staff-wanjiru",
      "scheduled",
      "unpaid",
      undefined,
      "AC weak in traffic.",
    ),
    createBooking(
      "booking-013",
      2,
      "10:00",
      "svc-full-service",
      "client-kamau",
      "staff-kariuki",
      "scheduled",
      "deposit",
      "mpesa",
      "Fleet vehicle due for 40,000 km service.",
    ),
    createBooking(
      "booking-014",
      3,
      "14:30",
      "svc-wheel-alignment",
      "client-atieno",
      "staff-otieno",
      "cancelled",
      "unpaid",
      undefined,
      "Client rescheduled after work meeting.",
    ),
  ];
}

function buildJobCards(clients: ServiceClient[], now = new Date()): JobCard[] {
  const clientMap = new Map(clients.map((client) => [client.id, client]));
  const job = (
    id: string,
    clientId: string,
    title: string,
    description: string,
    status: JobCard["status"],
    estimatedCost: number,
    actualCost: number | undefined,
    assignedStaff: string,
    laborHours: number,
    laborRate: number,
    materials: JobCard["materials"],
    stages: JobCard["photos"],
    createdAt: string,
    startedAt?: string,
    completedAt?: string,
    invoiceId?: string,
  ): JobCard => {
    const client = clientMap.get(clientId);
    return {
      id,
      clientId,
      clientName: client?.name ?? "Client",
      clientPhone: client?.phone ?? "+254700000000",
      title,
      description,
      status,
      estimatedCost,
      actualCost,
      materials,
      laborHours,
      laborRate,
      photos: stages,
      assignedStaff,
      startedAt,
      completedAt,
      invoiceId,
      createdAt,
    };
  };

  return [
    job(
      "job-001",
      "client-wanjiku",
      "Toyota Fielder KCJ 123A - Overheating",
      "Customer reported temperature spike on Waiyaki Way. Radiator fan relay and coolant hose need replacement.",
      "in_progress",
      18000,
      undefined,
      "John Kariuki",
      3.5,
      1800,
      [
        { name: "Coolant hose", qty: 1, unitCost: 2200 },
        { name: "Fan relay", qty: 1, unitCost: 1800 },
        { name: "Coolant", qty: 2, unitCost: 950 },
      ],
      [
        {
          url: servicePhoto("Before Check", "1d4ed8"),
          label: "Engine bay arrival",
          stage: "before",
        },
        {
          url: servicePhoto("Repair Ongoing", "f59e0b"),
          label: "Hose replacement",
          stage: "during",
        },
      ],
      minusTime(now, 1, 3).toISOString(),
      minusTime(now, 0, 5).toISOString(),
    ),
    job(
      "job-002",
      "client-otieno",
      "Nissan Note KDA 456B - Brake noise",
      "Grinding sound from rear left wheel. Brake shoe and drum inspection complete, quotation awaiting approval.",
      "quoted",
      9600,
      undefined,
      "Peter Otieno",
      1.5,
      1800,
      [
        { name: "Brake shoes", qty: 1, unitCost: 3200 },
        { name: "Brake fluid", qty: 1, unitCost: 750 },
      ],
      [
        {
          url: servicePhoto("Brake Wear", "dc2626"),
          label: "Worn brake shoe",
          stage: "before",
        },
      ],
      minusTime(now, 0, 6).toISOString(),
    ),
    job(
      "job-003",
      "client-fatma",
      "Subaru Forester KDL 908N - AC not cooling",
      "Leak test, compressor service, and gas refill completed. Invoice shared on WhatsApp.",
      "invoiced",
      16500,
      15800,
      "Faith Wanjiru",
      4,
      2000,
      [
        { name: "AC gas", qty: 2, unitCost: 2500 },
        { name: "Compressor seal kit", qty: 1, unitCost: 1800 },
      ],
      [
        {
          url: servicePhoto("Warm Cabin", "7c3aed"),
          label: "Before service",
          stage: "before",
        },
        {
          url: servicePhoto("Cold Air", "0f766e"),
          label: "After service",
          stage: "after",
        },
      ],
      minusTime(now, 4, 2).toISOString(),
      minusTime(now, 4, 1).toISOString(),
      minusTime(now, 3, 5).toISOString(),
      "INV-AC-908N",
    ),
    job(
      "job-004",
      "client-kamau",
      "Toyota Hiace KCS 778P - Fleet service",
      "Quarterly fleet inspection completed with oil, brake, and suspension checks. Awaiting payment settlement.",
      "paid",
      22000,
      21400,
      "Alex Mutiso",
      5,
      1700,
      [
        { name: "Engine oil", qty: 6, unitCost: 850 },
        { name: "Oil filter", qty: 1, unitCost: 1200 },
        { name: "Brake pads", qty: 1, unitCost: 3200 },
      ],
      [
        {
          url: servicePhoto("Fleet Arrival", "334155"),
          label: "Fleet van received",
          stage: "before",
        },
        {
          url: servicePhoto("Delivery", "15803d"),
          label: "Ready for pickup",
          stage: "after",
        },
      ],
      minusTime(now, 8, 3).toISOString(),
      minusTime(now, 8, 2).toISOString(),
      minusTime(now, 7, 5).toISOString(),
      "INV-FLT-778P",
    ),
  ];
}

export function generateServicesDemoData(now = new Date()): ServicesSnapshot {
  const business = buildServiceBusiness();
  const staff = buildServiceStaff();
  const categories = buildServiceCategories();
  const services = buildServiceCatalogue(staff);
  const packages = buildServicePackages(services);
  const clients = buildServiceClients(now);
  const bookings = buildServiceBookings(services, clients, staff, now);
  const jobCards = buildJobCards(clients, now);

  return {
    business,
    staff,
    categories,
    services,
    packages,
    clients,
    bookings,
    jobCards,
  };
}

// Empty per-tenant services starter — a real venue builds its OWN catalogue.
export function emptyServicesSnapshot(): ServicesSnapshot {
  const identity = currentMerchantIdentity();
  const labels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return {
    business: {
      id: getCurrentVenueId(),
      name: identity.name,
      type: "general",
      description: "",
      location: "",
      phone: "",
      whatsapp: "",
      email: "",
      tillNumber: identity.till,
      logoUrl: "",
      website: "",
      operatingHours: labels.map((label, day) => ({
        day,
        label,
        start: "09:00",
        end: "17:00",
      })),
    },
    staff: [],
    categories: [
      { id: "general", name: "General", icon: "Wrench", color: "#2563eb" },
    ],
    services: [],
    packages: [],
    clients: [],
    bookings: [],
    jobCards: [],
  };
}

function baseServicesSnapshot(): ServicesSnapshot {
  return isDemoVenue(getCurrentVenueId())
    ? generateServicesDemoData()
    : emptyServicesSnapshot();
}

export function ensureServicesDemoData() {
  if (!canUseStorage()) return baseServicesSnapshot();
  if (!window.localStorage.getItem(mkey(SERVICES_STORAGE_KEY))) {
    writeStorage(mkey(SERVICES_STORAGE_KEY), baseServicesSnapshot());
  }
  return loadServicesSnapshot();
}

export function loadServicesSnapshot(): ServicesSnapshot {
  const fallback = baseServicesSnapshot();
  return readStorage(mkey(SERVICES_STORAGE_KEY), fallback);
}

export function saveServicesSnapshot(snapshot: ServicesSnapshot) {
  writeStorage(mkey(SERVICES_STORAGE_KEY), snapshot);
}

export function getAvailableSlots(
  bookings: Booking[],
  date: string,
  staffId?: string,
) {
  const dayBookings = bookings.filter((booking) => {
    if (booking.date !== date) return false;
    if (staffId && booking.staffId !== staffId) return false;
    return ACTIVE_BOOKING_STATUSES.includes(booking.status);
  });

  const slots: string[] = [];
  for (
    let minutes = SERVICE_OPEN_MINUTES;
    minutes <= SERVICE_CLOSE_MINUTES - 30;
    minutes += 30
  ) {
    const occupied = dayBookings.some((booking) => {
      const start = serviceMinutesFromTime(booking.startTime);
      const end = serviceMinutesFromTime(booking.endTime);
      return minutes >= start && minutes < end;
    });
    if (!occupied) slots.push(serviceTimeFromMinutes(minutes));
  }
  return slots;
}

export function getStaffUtilization(
  bookings: Booking[],
  staff: ServiceStaff[],
) {
  const now = new Date();
  const weekStart = serviceStartOfWeek(now);
  const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);

  return staff.map((member) => {
    const availableHours = member.availability.reduce((sum, entry) => {
      return (
        sum +
        (serviceMinutesFromTime(entry.end) -
          serviceMinutesFromTime(entry.start)) /
          60
      );
    }, 0);
    const bookedHours = bookings
      .filter((booking) => {
        if (booking.staffId !== member.id) return false;
        if (
          !["scheduled", "confirmed", "in_progress", "completed"].includes(
            booking.status,
          )
        )
          return false;
        const bookingDate = new Date(`${booking.date}T${booking.startTime}:00`);
        return bookingDate >= weekStart && bookingDate < weekEnd;
      })
      .reduce((sum, booking) => sum + booking.duration / 60, 0);

    return {
      staffId: member.id,
      staffName: member.name,
      role: member.role,
      color: member.color,
      bookedHours,
      availableHours,
      utilization: availableHours
        ? Math.round((bookedHours / availableHours) * 100)
        : 0,
    };
  });
}

export function getServiceAnalytics(
  bookings: Booking[],
  services: ServiceOffering[],
): ServiceAnalytics {
  const serviceMap = new Map(services.map((service) => [service.id, service]));
  const revenueByService = new Map<string, number>();
  const dayCounts = new Map<string, number>();
  const hourCounts = new Map<string, number>();
  const busiestMatrix: Array<{ day: string; hour: string; count: number }> = [];
  const clientVisits = new Map<string, number>();
  const billableBookings = bookings.filter(
    (booking) =>
      booking.status === "completed" || booking.status === "in_progress",
  );
  const validBookings = bookings.filter(
    (booking) => booking.status !== "cancelled" && booking.status !== "no_show",
  );
  const now = new Date();
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const previousMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

  billableBookings.forEach((booking) => {
    const label =
      serviceMap.get(booking.serviceId)?.name ?? booking.serviceName;
    revenueByService.set(
      label,
      (revenueByService.get(label) ?? 0) + booking.price,
    );
  });

  SERVICE_WEEK_DAYS.forEach((day) => {
    for (let hour = 8; hour < 18; hour += 1) {
      const hourLabel = `${String(hour).padStart(2, "0")}:00`;
      const count = bookings.filter((booking) => {
        const bookingDate = new Date(`${booking.date}T${booking.startTime}:00`);
        const bookingDay = SERVICE_WEEK_DAYS[(bookingDate.getDay() + 6) % 7];
        return (
          bookingDay === day && Number(booking.startTime.slice(0, 2)) === hour
        );
      }).length;
      busiestMatrix.push({ day, hour: hourLabel, count });
      dayCounts.set(day, (dayCounts.get(day) ?? 0) + count);
      hourCounts.set(hourLabel, (hourCounts.get(hourLabel) ?? 0) + count);
    }
  });

  validBookings.forEach((booking) => {
    clientVisits.set(
      booking.clientId,
      (clientVisits.get(booking.clientId) ?? 0) + 1,
    );
  });

  const currentMonthRevenue = getServiceBookingRevenue(
    billableBookings.filter(
      (booking) =>
        new Date(`${booking.date}T${booking.startTime}:00`) >=
        currentMonthStart,
    ),
    ["completed", "in_progress"],
  );
  const previousMonthRevenue = getServiceBookingRevenue(
    billableBookings.filter((booking) => {
      const bookingDate = new Date(`${booking.date}T${booking.startTime}:00`);
      return (
        bookingDate >= previousMonthStart && bookingDate < currentMonthStart
      );
    }),
    ["completed", "in_progress"],
  );
  const underBookedDay = [...dayCounts.entries()].sort(
    (left, right) => left[1] - right[1],
  )[0];
  const topHour = [...hourCounts.entries()].sort(
    (left, right) => right[1] - left[1],
  )[0];
  const retentionBase = clientVisits.size || 1;
  const repeatClients = [...clientVisits.values()].filter(
    (count) => count >= 2,
  ).length;
  const clientRetentionRate = Math.round((repeatClients / retentionBase) * 100);
  const averageJobValue = billableBookings.length
    ? Math.round(
        billableBookings.reduce((sum, booking) => sum + booking.price, 0) /
          billableBookings.length,
      )
    : 0;
  const delta = previousMonthRevenue
    ? Math.round(
        ((currentMonthRevenue - previousMonthRevenue) / previousMonthRevenue) *
          100,
      )
    : currentMonthRevenue > 0
      ? 100
      : 0;

  return {
    revenueByServiceType: [...revenueByService.entries()]
      .map(([name, value]) => ({ name, value }))
      .sort((left, right) => right.value - left.value),
    busiestMatrix,
    busiestDays: [...dayCounts.entries()].map(([name, value]) => ({
      name,
      value,
    })),
    busiestHours: [...hourCounts.entries()].map(([name, value]) => ({
      name,
      value,
    })),
    bookingStatusBreakdown: [
      "scheduled",
      "confirmed",
      "in_progress",
      "completed",
      "cancelled",
      "no_show",
    ].map((status) => ({
      name: status,
      value: bookings.filter((booking) => booking.status === status).length,
    })),
    clientRetentionRate,
    averageJobValue,
    monthlyComparison: {
      current: currentMonthRevenue,
      previous: previousMonthRevenue,
      delta,
    },
    aiInsights: [
      underBookedDay
        ? `${underBookedDay[0]} is 40% under-booked compared with peak days — try a targeted service discount.`
        : "Bookings are balanced across the week.",
      topHour
        ? `${topHour[0]} is your busiest hour. Consider assigning diagnostics overflow to keep bays moving.`
        : "No clear peak hour yet.",
      clientRetentionRate >= 45
        ? `Repeat customers are ${clientRetentionRate}%. Double down on reminders and loyalty rewards.`
        : `Retention is ${clientRetentionRate}%. Follow up with recent clients to improve repeat visits.`,
    ],
  };
}

export function getServicesBusinessSlug(profile?: ServiceBusinessProfile) {
  return profile?.id || "nairobi-auto-care";
}
