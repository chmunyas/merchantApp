import type {
  AIStaffInsight,
  CatalogueItem,
  ExternalMenu,
  Menu,
  CreditCustomer,
  MenuSchedule,
  OrderTicket,
  PurchaseOrder,
  Reservation,
  RetailProduct,
  RetailSale,
  StaffMember,
  StaffNotification,
  StaffPayout,
  StaffPerformanceChallenge,
  StaffRole,
  StaffShift,
  StockAdjustment,
  Supplier,
  Zone,
} from "@/components/merchant/features/types";

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
  categoryOrder: "fxengine.merchant.categoryOrder",
  menuSchedules: "fxengine.merchant.menuSchedules",
  externalMenus: "fxengine.merchant.externalMenus",
  tables: "fxengine.merchant.tables",
  orders: "fxengine.merchant.orders",
  reservations: "fxengine.merchant.reservations",
  reviews: "fxengine.merchant.reviews",
  settings: "fxengine.merchant.settings",
  staffMembers: "fxengine.merchant.staffMembers",
  staffShifts: "fxengine.merchant.staffShifts",
  staffNotifications: "fxengine.merchant.staffNotifications",
  staffPayouts: "fxengine.merchant.staffPayouts",
  staffChallenges: "fxengine.merchant.staffChallenges",
  staffInsights: "fxengine.merchant.staffInsights",
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
  server: string;
  items: MerchantTableItem[];
  status: TableStatus;
  openedAt: string;
  closedAt?: string;
  paidAmount: number;
  payments: MerchantPayment[];
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
  categoryOrder: string[];
  menuSchedules: MenuSchedule[];
  externalMenus: ExternalMenu[];
  tables: MerchantTable[];
  orders: OrderTicket[];
  reservations: Reservation[];
  reviews: MerchantReview[];
  settings: MerchantSettings;
  staffMembers: StaffMember[];
  staffShifts: StaffShift[];
  staffNotifications: StaffNotification[];
  staffPayouts: StaffPayout[];
  staffChallenges: StaffPerformanceChallenge[];
  staffInsights: AIStaffInsight[];
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
      pin: "1122",
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
      pin: "2200",
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
      pin: "4499",
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
      pin: "9011",
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
      pin: "8422",
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
      pin: "6611",
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
  const categoryOrder = buildCategoryOrder();
  const menuSchedules = buildMenuSchedules();
  const externalMenus = buildExternalMenus(now);
  const payments = buildPayments(catalogue, now);
  const tables = buildTables(catalogue, payments);
  const orders = buildOrders(
    payments.filter((payment) => payment.status !== "failed"),
  );
  const reservations = buildReservations(now);
  const reviews = buildReviews(payments);
  const settings = buildSettings();
  const staffDemo = generateStaffDemoData(now);

  return {
    catalogue,
    menus,
    zones,
    categoryOrder,
    menuSchedules,
    externalMenus,
    tables,
    orders,
    reservations,
    reviews,
    settings,
    staffMembers: staffDemo.staffMembers,
    staffShifts: staffDemo.staffShifts,
    staffNotifications: staffDemo.staffNotifications,
    staffPayouts: staffDemo.staffPayouts,
    staffChallenges: staffDemo.staffChallenges,
    staffInsights: staffDemo.staffInsights,
  };
}

function canUseStorage() {
  return (
    typeof window !== "undefined" && typeof window.localStorage !== "undefined"
  );
}

export function readStorage<T>(key: string, fallback: T): T {
  if (!canUseStorage()) return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeStorage<T>(key: string, value: T) {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    console.warn("[merchant-dashboard] Storage quota exceeded for key:", key);
  }
}

export function ensureMerchantDemoData() {
  if (!canUseStorage()) return createMerchantDemoData();

  ensureRetailDemoData();
  const demo = createMerchantDemoData();

  (
    Object.entries(STORAGE_KEYS) as Array<[keyof typeof STORAGE_KEYS, string]>
  ).forEach(([name, key]) => {
    if (!window.localStorage.getItem(key)) {
      writeStorage(key, demo[name]);
    }
  });

  return loadMerchantSnapshot();
}

export function loadMerchantSnapshot(): MerchantSnapshot {
  const fallback = createMerchantDemoData();

  return {
    catalogue: readStorage(STORAGE_KEYS.catalogue, fallback.catalogue),
    menus: readStorage(STORAGE_KEYS.menus, fallback.menus),
    zones: readStorage(STORAGE_KEYS.zones, fallback.zones),
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
    tables: readStorage(STORAGE_KEYS.tables, fallback.tables),
    orders: readStorage(STORAGE_KEYS.orders, fallback.orders),
    reservations: readStorage(STORAGE_KEYS.reservations, fallback.reservations),
    reviews: readStorage(STORAGE_KEYS.reviews, fallback.reviews),
    settings: readStorage(STORAGE_KEYS.settings, fallback.settings),
    staffMembers: readStorage(STORAGE_KEYS.staffMembers, fallback.staffMembers),
    staffShifts: readStorage(STORAGE_KEYS.staffShifts, fallback.staffShifts),
    staffNotifications: readStorage(
      STORAGE_KEYS.staffNotifications,
      fallback.staffNotifications,
    ),
    staffPayouts: readStorage(STORAGE_KEYS.staffPayouts, fallback.staffPayouts),
    staffChallenges: readStorage(
      STORAGE_KEYS.staffChallenges,
      fallback.staffChallenges,
    ),
    staffInsights: readStorage(
      STORAGE_KEYS.staffInsights,
      fallback.staffInsights,
    ),
  };
}

export function saveMerchantTables(tables: MerchantTable[]) {
  writeStorage(STORAGE_KEYS.tables, tables);
}

export function saveMerchantCatalogue(catalogue: CatalogueItem[]) {
  writeStorage(STORAGE_KEYS.catalogue, catalogue);
}

export function saveMerchantMenus(menus: Menu[]) {
  writeStorage(STORAGE_KEYS.menus, menus);
}

export function saveMerchantZones(zones: Zone[]) {
  writeStorage(STORAGE_KEYS.zones, zones);
}

export function saveMerchantCategoryOrder(categoryOrder: string[]) {
  writeStorage(STORAGE_KEYS.categoryOrder, categoryOrder);
}

export function saveMerchantMenuSchedules(menuSchedules: MenuSchedule[]) {
  writeStorage(STORAGE_KEYS.menuSchedules, menuSchedules);
}

export function saveMerchantExternalMenus(externalMenus: ExternalMenu[]) {
  writeStorage(STORAGE_KEYS.externalMenus, externalMenus);
}

export function saveMerchantReviews(reviews: MerchantReview[]) {
  writeStorage(STORAGE_KEYS.reviews, reviews);
}

export function saveMerchantSettings(settings: MerchantSettings) {
  writeStorage(STORAGE_KEYS.settings, settings);
}

export function saveMerchantStaffMembers(staffMembers: StaffMember[]) {
  writeStorage(STORAGE_KEYS.staffMembers, staffMembers);
}

export function saveMerchantStaffShifts(staffShifts: StaffShift[]) {
  writeStorage(STORAGE_KEYS.staffShifts, staffShifts);
}

export function saveMerchantStaffNotifications(
  staffNotifications: StaffNotification[],
) {
  writeStorage(STORAGE_KEYS.staffNotifications, staffNotifications);
}

export function saveMerchantStaffPayouts(staffPayouts: StaffPayout[]) {
  writeStorage(STORAGE_KEYS.staffPayouts, staffPayouts);
}

export function saveMerchantStaffChallenges(
  staffChallenges: StaffPerformanceChallenge[],
) {
  writeStorage(STORAGE_KEYS.staffChallenges, staffChallenges);
}

export function saveMerchantStaffInsights(staffInsights: AIStaffInsight[]) {
  writeStorage(STORAGE_KEYS.staffInsights, staffInsights);
}

export function flattenTransactions(tables: MerchantTable[]) {
  return tables
    .flatMap((table) =>
      table.payments.map((payment) => ({
        ...payment,
        tableNumber: table.tableNumber,
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
    "cash",
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

  const paymentBreakdown = ["mpesa", "cash", "credit"].map((method) => ({
    name: method,
    value: validSales
      .filter((sale) => sale.paymentMethod === method)
      .reduce((sum, sale) => sum + sale.total, 0),
  }));

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

export function ensureRetailDemoData() {
  if (!canUseStorage()) return generateRetailDemoData();

  const demo = generateRetailDemoData();
  (
    Object.entries(RETAIL_STORAGE_KEYS) as Array<
      [keyof typeof RETAIL_STORAGE_KEYS, string]
    >
  ).forEach(([name, key]) => {
    if (!window.localStorage.getItem(key)) writeStorage(key, demo[name]);
  });

  return loadRetailSnapshot();
}

export function loadRetailSnapshot(): RetailSnapshot {
  const fallback = generateRetailDemoData();
  return {
    storeProfile: readStorage(
      RETAIL_STORAGE_KEYS.storeProfile,
      fallback.storeProfile,
    ),
    products: readStorage(RETAIL_STORAGE_KEYS.products, fallback.products),
    sales: readStorage(RETAIL_STORAGE_KEYS.sales, fallback.sales),
    adjustments: readStorage(
      RETAIL_STORAGE_KEYS.adjustments,
      fallback.adjustments,
    ),
    creditCustomers: readStorage(
      RETAIL_STORAGE_KEYS.creditCustomers,
      fallback.creditCustomers,
    ).map((customer) => ({
      ...customer,
      balance: balanceCreditEntries(customer.entries),
    })),
    suppliers: readStorage(RETAIL_STORAGE_KEYS.suppliers, fallback.suppliers),
    purchaseOrders: readStorage(
      RETAIL_STORAGE_KEYS.purchaseOrders,
      fallback.purchaseOrders,
    ),
  };
}

export function saveRetailStoreProfile(storeProfile: RetailStoreProfile) {
  writeStorage(RETAIL_STORAGE_KEYS.storeProfile, storeProfile);
}

export function saveRetailProducts(products: RetailProduct[]) {
  writeStorage(RETAIL_STORAGE_KEYS.products, products);
}

export function saveRetailSales(sales: RetailSale[]) {
  writeStorage(RETAIL_STORAGE_KEYS.sales, sales);
}

export function saveStockAdjustments(adjustments: StockAdjustment[]) {
  writeStorage(RETAIL_STORAGE_KEYS.adjustments, adjustments);
}

export function saveCreditCustomers(creditCustomers: CreditCustomer[]) {
  writeStorage(
    RETAIL_STORAGE_KEYS.creditCustomers,
    creditCustomers.map((customer) => ({
      ...customer,
      balance: balanceCreditEntries(customer.entries),
    })),
  );
}

export function saveRetailSuppliers(suppliers: Supplier[]) {
  writeStorage(RETAIL_STORAGE_KEYS.suppliers, suppliers);
}

export function savePurchaseOrders(purchaseOrders: PurchaseOrder[]) {
  writeStorage(RETAIL_STORAGE_KEYS.purchaseOrders, purchaseOrders);
}

export function getRetailStoreSlug(profile?: RetailStoreProfile) {
  return profile?.id || createRetailId("store", profile?.name || MERCHANT_NAME);
}
