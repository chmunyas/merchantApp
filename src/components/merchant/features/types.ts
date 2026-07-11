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
  paidRef?: string;
  timeline?: InvoiceTimelineEvent[];
  payments?: PartialPayment[];
  installmentPlan?: InstallmentPlan;
  fxLock?: FxLock;
  deliveryChannel?: "email" | "whatsapp" | "sms" | "link";
  customerPhone?: string;
  // The server (DB) id, when this invoice is a real, persisted record — used to
  // drive server mutations (pay / mark-paid). Absent for demo/seed invoices.
  serverId?: string;
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

export type SupportedMenuLocale = "en" | "sw" | "fr" | "ar";

export type CatalogueItemTranslation = {
  name: string;
  description?: string;
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
  translations?: Partial<Record<SupportedMenuLocale, CatalogueItemTranslation>>;
  syncSource?: string;
  syncedAt?: string;
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
  menuIds: string[];
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

export type TableCombination = {
  id: string;
  name: string;
  tableNumbers: number[];
  minCapacity: number;
  maxCapacity: number;
  priority: 1 | 2 | 3 | 4 | 5;
  active: boolean;
};

export type Area = {
  id: string;
  name: string;
  hiddenFromDayPlanner: boolean;
  tableNumbers: number[];
  order: number;
};

export type ExternalMenu = {
  id: string;
  name: string;
  type: "pdf" | "url";
  content: string;
  createdAt: string;
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
  combinationId?: string;
  customerName: string;
  phone: string;
  date: string; // ISO date
  time: string; // "HH:MM"
  covers: number;
  status: "confirmed" | "seated" | "cancelled" | "no-show";
  notes?: string;
  depositAmount?: number;
  depositStatus?: "pending" | "paid" | "refunded";
  depositPaidAt?: string;
};

export type EnquiryStatus = "new" | "approved" | "declined";

export type Enquiry = {
  id: string;
  customerName: string;
  phone: string;
  date: string; // YYYY-MM-DD
  time: string; // "HH:MM"
  covers: number;
  notes?: string;
  status: EnquiryStatus;
  source: "web" | "phone" | "walk-in";
  createdAt: string; // ISO
  reservationId?: string;
};

export type DepositPolicy = {
  enabled: boolean;
  perGuestKES: number;
  minCovers: number;
};

export type MessageChannel = "sms" | "whatsapp" | "email";

export type WorkflowTrigger =
  | "booking_created"
  | "reminder"
  | "post_visit"
  | "no_show";

export type Workflow = {
  id: string;
  name: string;
  trigger: WorkflowTrigger;
  channel: MessageChannel;
  offsetHours?: number;
  message: string;
  active: boolean;
};

export type CampaignSegment = "all" | "gold_plus" | "lapsed";

export type Campaign = {
  id: string;
  name: string;
  segment: CampaignSegment;
  channel: MessageChannel;
  message: string;
  status: "draft" | "sent";
  sentAt?: string;
  recipients?: number;
};

export type MessageLogEntry = {
  id: string;
  channel: MessageChannel;
  to: string;
  body: string;
  source: string;
  createdAt: string;
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

export type StaffRole =
  | "waiter"
  | "bartender"
  | "kitchen"
  | "host"
  | "manager"
  | "admin";

export type StaffMember = {
  id: string;
  name: string;
  phone: string;
  role: StaffRole;
  pin: string;
  isActive: boolean;
  hiredAt: string;
  avatar?: string;
  assignedZones?: string[];
  assignedTables?: number[];
  shift?: StaffShift;
  mpesaPayoutEnabled: boolean;
  totalEarnings: number;
  pendingPayout: number;
  lastPayoutAt?: string;
};

export type StaffShift = {
  id: string;
  staffId: string;
  date: string;
  startTime: string;
  endTime: string;
  clockInAt?: string;
  clockOutAt?: string;
  breakMinutes: number;
  status: "scheduled" | "active" | "completed" | "absent" | "late";
};

export type StaffNotification = {
  id: string;
  staffId: string;
  type:
    | "order_ready"
    | "table_seated"
    | "payment_received"
    | "tip_received"
    | "walkout"
    | "schedule_change"
    | "ai_suggestion"
    | "payout_sent";
  title: string;
  message: string;
  createdAt: string;
  readAt?: string;
  actionUrl?: string;
  metadata?: Record<string, unknown>;
};

export type StaffPayout = {
  id: string;
  staffId: string;
  amount: number;
  currency: string;
  mpesaPhone: string;
  mpesaReference?: string;
  status: "pending" | "processing" | "sent" | "failed";
  type: "tip" | "salary" | "bonus" | "incentive";
  createdAt: string;
  processedAt?: string;
  period?: string;
};

export type StaffPerformanceChallenge = {
  id: string;
  title: string;
  description: string;
  metric:
    | "tables_served"
    | "avg_rating"
    | "tip_percentage"
    | "speed"
    | "upsell_rate";
  target: number;
  reward: number;
  startDate: string;
  endDate: string;
  participants: { staffId: string; progress: number }[];
};

export type AIStaffInsight = {
  id: string;
  type:
    | "scheduling"
    | "performance"
    | "training"
    | "cost_saving"
    | "upsell_coaching";
  title: string;
  insight: string;
  recommendation: string;
  confidence: number;
  createdAt: string;
  dismissed?: boolean;
};

// ─── Retail Types ───

export type RetailProduct = {
  id: string;
  name: string;
  sku: string;
  barcode?: string;
  category: string;
  costPrice: number;
  sellPrice: number;
  stock: number;
  reorderLevel: number;
  unit: "pieces" | "kg" | "litres" | "packets" | "boxes" | "metres";
  supplier?: string;
  supplierPhone?: string;
  image?: string;
  isActive: boolean;
  lastRestocked?: string;
  createdAt: string;
};

export type RetailSale = {
  id: string;
  items: { productId: string; name: string; qty: number; unitPrice: number }[];
  total: number;
  paymentMethod: "mpesa" | "cash" | "credit" | "bnpl";
  customerName?: string;
  customerPhone?: string;
  mpesaRef?: string;
  createdAt: string;
  refunded?: boolean;
};

export type { BNPLTransaction } from "@/lib/coop-bnpl";

export type StockAdjustment = {
  id: string;
  productId: string;
  type: "received" | "damaged" | "returned" | "counted" | "sold";
  quantity: number;
  reason?: string;
  createdAt: string;
};

export type CreditCustomer = {
  id: string;
  name: string;
  phone: string;
  creditLimit: number;
  balance: number;
  entries: CreditEntry[];
  createdAt: string;
};

export type CreditEntry = {
  id: string;
  type: "purchase" | "payment";
  amount: number;
  description: string;
  date: string;
  dueDate?: string;
  saleId?: string;
};

export type Supplier = {
  id: string;
  name: string;
  phone: string;
  email?: string;
  products: string[];
  lastOrderDate?: string;
};

export type PurchaseOrder = {
  id: string;
  supplierId: string;
  supplierName: string;
  items: { productId: string; name: string; qty: number; unitCost: number }[];
  total: number;
  status: "draft" | "sent" | "received" | "paid";
  createdAt: string;
  receivedAt?: string;
  paidAt?: string;
};

// ─── Services Types ───

export type ServiceCategory = {
  id: string;
  name: string;
  icon?: string;
  color?: string;
};

export type ServiceOffering = {
  id: string;
  name: string;
  description?: string;
  category: string;
  price: number;
  priceType: "fixed" | "per_hour" | "from";
  duration: number;
  staffIds: string[];
  materials?: string[];
  isActive: boolean;
  image?: string;
};

export type ServicePackage = {
  id: string;
  name: string;
  description: string;
  services: string[];
  price: number;
  savings: number;
  isActive: boolean;
};

export type Booking = {
  id: string;
  clientId: string;
  clientName: string;
  clientPhone: string;
  serviceId: string;
  serviceName: string;
  staffId?: string;
  staffName?: string;
  date: string;
  startTime: string;
  endTime: string;
  duration: number;
  price: number;
  status:
    | "scheduled"
    | "confirmed"
    | "in_progress"
    | "completed"
    | "cancelled"
    | "no_show";
  paymentStatus: "unpaid" | "deposit" | "paid";
  paymentMethod?: "mpesa" | "cash" | "bnpl" | "card";
  notes?: string;
  isWalkIn?: boolean;
  createdAt: string;
};

export type ServiceClient = {
  id: string;
  name: string;
  phone: string;
  email?: string;
  tag: "new" | "regular" | "vip" | "corporate";
  totalVisits: number;
  totalSpent: number;
  lastVisit?: string;
  notes?: string;
  loyaltyPoints: number;
  createdAt: string;
};

export type JobCard = {
  id: string;
  clientId: string;
  clientName: string;
  clientPhone: string;
  title: string;
  description: string;
  status:
    | "received"
    | "diagnosed"
    | "quoted"
    | "approved"
    | "in_progress"
    | "done"
    | "invoiced"
    | "paid";
  estimatedCost: number;
  actualCost?: number;
  materials: { name: string; qty: number; unitCost: number }[];
  laborHours: number;
  laborRate: number;
  photos: {
    url: string;
    label: string;
    stage: "before" | "during" | "after";
  }[];
  assignedStaff: string;
  startedAt?: string;
  completedAt?: string;
  invoiceId?: string;
  createdAt: string;
};
