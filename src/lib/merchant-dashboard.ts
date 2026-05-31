import type {
  CatalogueItem,
  Menu,
  MenuSchedule,
  OrderTicket,
  Reservation,
  Zone,
} from "@/components/merchant/features/types";

export const MERCHANT_NAME = "Sade's Atelier";
export const TILL_NUMBER = "247365";
export const STAFF_NAMES = [
  "Grace M.",
  "James K.",
  "Faith W.",
  "Peter O.",
] as const;

export const STORAGE_KEYS = {
  catalogue: "fxengine.merchant.catalogue",
  menus: "fxengine.merchant.menus",
  zones: "fxengine.merchant.zones",
  categoryOrder: "fxengine.merchant.categoryOrder",
  menuSchedules: "fxengine.merchant.menuSchedules",
  tables: "fxengine.merchant.tables",
  orders: "fxengine.merchant.orders",
  reservations: "fxengine.merchant.reservations",
  reviews: "fxengine.merchant.reviews",
  settings: "fxengine.merchant.settings",
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

export type MerchantSnapshot = {
  catalogue: CatalogueItem[];
  menus: Menu[];
  zones: Zone[];
  categoryOrder: string[];
  menuSchedules: MenuSchedule[];
  tables: MerchantTable[];
  orders: OrderTicket[];
  reservations: Reservation[];
  reviews: MerchantReview[];
  settings: MerchantSettings;
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
    },
    {
      id: "schedule-lunch",
      name: "Lunch Menu",
      days: [0, 1, 2, 3, 4],
      startTime: "12:00",
      endTime: "16:00",
      categories: ["Mains", "Sides", "Drinks"],
    },
    {
      id: "schedule-evening",
      name: "Evening Menu",
      days: [4, 5, 6],
      startTime: "16:00",
      endTime: "23:00",
      categories: ["Mains", "Sides", "Cocktails", "Desserts", "Drinks"],
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

export function createMerchantDemoData(now = new Date()): MerchantSnapshot {
  const catalogue = buildCatalogue();
  const menus = buildMenus(now);
  const zones = buildZones();
  const categoryOrder = buildCategoryOrder();
  const menuSchedules = buildMenuSchedules();
  const payments = buildPayments(catalogue, now);
  const tables = buildTables(catalogue, payments);
  const orders = buildOrders(
    payments.filter((payment) => payment.status !== "failed"),
  );
  const reservations = buildReservations(now);
  const reviews = buildReviews(payments);
  const settings = buildSettings();

  return {
    catalogue,
    menus,
    zones,
    categoryOrder,
    menuSchedules,
    tables,
    orders,
    reservations,
    reviews,
    settings,
  };
}

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

export function ensureMerchantDemoData() {
  if (!canUseStorage()) return createMerchantDemoData();

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
    tables: readStorage(STORAGE_KEYS.tables, fallback.tables),
    orders: readStorage(STORAGE_KEYS.orders, fallback.orders),
    reservations: readStorage(STORAGE_KEYS.reservations, fallback.reservations),
    reviews: readStorage(STORAGE_KEYS.reviews, fallback.reviews),
    settings: readStorage(STORAGE_KEYS.settings, fallback.settings),
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

export function saveMerchantReviews(reviews: MerchantReview[]) {
  writeStorage(STORAGE_KEYS.reviews, reviews);
}

export function saveMerchantSettings(settings: MerchantSettings) {
  writeStorage(STORAGE_KEYS.settings, settings);
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
    allowedCategories = new Set(zoneCategories);
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
