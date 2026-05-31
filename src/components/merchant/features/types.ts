export type InvoiceTimelineEvent = {
  label: string;
  at: string;
};

export type PartialPayment = {
  id: string;
  amount: number;
  paidAt: string;
  paidVia: string;
};

export type InstallmentPlan = {
  count: number;
  frequency: "Weekly" | "Bi-weekly" | "Monthly";
  installments: {
    number: number;
    amount: number;
    dueDate: string;
    status: "Paid" | "Due" | "Upcoming" | "Overdue";
    paidAt?: string;
  }[];
};

export type Invoice = {
  id: string;
  customer: string;
  amount: number;
  currency: string;
  status: "Paid" | "Pending" | "Overdue" | "Partial";
  date: string;
  note?: string;
  paidAt?: string;
  paidVia?: string;
  recurring?: {
    frequency: string;
    nextDate: string;
  };
  lastReminder?: string;
  timeline?: InvoiceTimelineEvent[];
  payments?: PartialPayment[];
  installmentPlan?: InstallmentPlan;
  fxLock?: FxLock;
  deliveryChannel?: "email" | "whatsapp" | "sms" | "link";
  customerPhone?: string;
};

export type FxLock = {
  rate: number;
  from: string;
  to: string;
  lockedAt: string;
  expiresAt: string;
  expired?: boolean;
};

export type PaymentMethod = {
  id: string;
  name: string;
  icon: string;
  region: string[];
};

export type TapGoTransaction = {
  id: string;
  amount: number;
  customerPhone: string;
  status: "pending" | "confirmed" | "failed";
  timestamp: string;
  method: "STK Push" | "QR Scan";
};

export type WalletProvider = {
  id: string;
  name: string;
  icon: string;
  color: string;
  bgColor: string;
  connected: boolean;
  balance: number;
  currency: string;
  lastSync: string;
  txCount: number;
};

export type WalletTransaction = {
  id: string;
  wallet: string;
  type: "credit" | "debit";
  amount: number;
  currency: string;
  from: string;
  reference: string;
  timestamp: string;
  matched: boolean;
  matchedInvoiceId?: string;
  status: "confirmed" | "pending" | "failed";
};

export type CustomerScore = {
  name: string;
  grade: "A" | "B" | "C";
  avgDaysToPay: number;
  totalInvoices: number;
  totalRevenue: number;
  onTimeRate: number;
};

export type PaymentPrediction = {
  invoiceId: string;
  customer: string;
  predictedDays: number;
  confidence: number;
  amount: number;
  currency: string;
};

export type ChaseStep = {
  day: number;
  tone: "gentle" | "firm" | "urgent" | "final";
  label: string;
  sent?: boolean;
};

export type TableOrder = {
  id: string;
  tableNumber: number;
  server: string;
  items: {
    id: string;
    name: string;
    price: number;
    qty: number;
    category: string;
  }[];
  status: "open" | "requesting-bill" | "partially-paid" | "closed";
  openedAt: string;
  closedAt?: string;
  paidAmount: number;
  payments: {
    name: string;
    amount: number;
    tip: number;
    phone: string;
    time: string;
  }[];
  quickCharge?: number;
};

export type CatalogueItem = {
  id: string;
  name: string;
  price: number;
  category: string;
  dietary?: string[]; // "vegan" | "vegetarian" | "gluten-free" | "halal" | "contains-nuts" | "dairy-free"
  destination?: "kitchen" | "bar"; // where the order goes
  image?: string;
  available?: boolean;
  description?: string;
  modifiers?: ItemModifier[];
  linkedProductIds?: string[];
};

export type ModifierOption = {
  id: string;
  label: string;
  priceAdjustment: number;
};

export type ItemModifier = {
  id: string;
  name: string;
  options: ModifierOption[];
};

export type MenuSchedule = {
  id: string;
  name: string;
  days: number[];
  startTime: string;
  endTime: string;
  categories: string[];
};

export type Menu = {
  id: string;
  name: string;
  description?: string;
  categories: string[];
  isActive: boolean;
  createdAt: string;
};

export type Zone = {
  id: string;
  name: string;
  menuIds: string[];
  tableRange: [number, number];
};

export type OrderTicket = {
  id: string;
  tableNumber: number;
  items: { name: string; qty: number; notes?: string }[];
  destination: "kitchen" | "bar";
  status: "new" | "preparing" | "ready" | "served";
  orderedAt: string;
  preparedAt?: string;
  servedAt?: string;
  server: string;
  customerName?: string;
};

export type Reservation = {
  id: string;
  tableNumber: number;
  customerName: string;
  phone: string;
  date: string; // ISO date
  time: string; // "HH:MM"
  covers: number;
  status: "confirmed" | "seated" | "cancelled" | "no-show";
  notes?: string;
};

export type LoyaltyCustomer = {
  phone: string;
  name: string;
  points: number;
  totalSpent: number;
  visits: number;
  tier: "Bronze" | "Silver" | "Gold" | "Platinum";
  lastVisit: string;
};
