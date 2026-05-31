/**
 * PesaSwap Payment Service Layer
 * Unified payment abstraction for all payment flows:
 * - Tap&Go (merchant POS)
 * - Table payments (split, tips)
 * - Invoice payments
 * - Refunds with full metadata sync
 */

// --- Configuration ---

export const PESASWAP_CONFIG = {
  publishableKey: import.meta.env.VITE_PESASWAP_PUBLISHABLE_KEY || "pk_snd_ba315f1daeef482cbabdd8317d8120fc",
  backendUrl: import.meta.env.VITE_BACKEND_URL || "",
  sandboxUrl: "https://sandbox.Pesaswap.io",
  prodUrl: "https://app.Pesaswap.io",
  hyperLoaderUrl: "https://beta.Pesaswap.io/v1/HyperLoader.js",
} as const;

// --- Types ---

export type PaymentMethod = "mpesa" | "card" | "apple_pay" | "google_pay" | "saved_card";

export type PaymentFlow = "mpesa_stk_push" | "one_tap_saved" | "full_checkout";

export type PaymentStatus =
  | "requires_payment_method"
  | "requires_confirmation"
  | "processing"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "requires_action";

export type PaymentContext = {
  amount: number; // in minor units (cents/centimes)
  currency: string;
  customer_phone?: string;
  has_saved_method?: boolean;
  preferred_method?: PaymentMethod;
};

export type PaymentMetadata = {
  // Identity
  merchant_id?: string;
  merchant_name: string;
  till_number: string;

  // Context
  table_number?: number;
  server_name?: string;
  order_id?: string;
  flow_type: "tapgo" | "table" | "invoice" | "quick_charge";

  // Line items
  items?: string; // JSON-encoded array

  // Split info
  split_type?: "full" | "equal" | "custom" | "by_item";
  split_of?: number;
  split_index?: number;

  // Customer
  customer_phone: string;
  customer_name?: string;
  customer_loyalty_id?: string;
  loyalty_points_earned?: number;

  // Tip
  tip_amount?: number;
  tip_recipient?: string;

  // Idempotency
  idempotency_key: string;

  // Fraud signals
  device_fingerprint?: string;
  geolocation?: string;
  qr_scanned_at?: string;
};

export type CreatePaymentRequest = {
  amount: number;
  currency: string;
  metadata: PaymentMetadata | Record<string, unknown>;
  customer_id?: string;
  payment_method?: PaymentMethod;
  description?: string;
  capture?: boolean; // auto-capture or manual
};

export type CreatePaymentResponse = {
  payment_id: string;
  client_secret: string;
  status: PaymentStatus;
  amount: number;
  currency: string;
};

export type RefundRequest = {
  payment_id: string;
  amount?: number; // partial refund; omit for full
  reason: "customer_request" | "item_quality" | "overcharge" | "duplicate" | "other";
  items?: Array<{ id: string; name: string; price: number; qty: number }>;
  refunded_by: string;
  metadata?: Record<string, string>;
};

export type RefundResponse = {
  refund_id: string;
  payment_id: string;
  amount: number;
  status: "pending" | "succeeded" | "failed";
  created_at: string;
};

// --- Smart Payment Flow Resolution ---

export function resolvePaymentFlow(context: PaymentContext): PaymentFlow {
  const { amount, currency, customer_phone, has_saved_method } = context;

  // M-Pesa STK Push: KES amounts under 150K with phone number → zero UI
  if (currency === "KES" && amount <= 15000000 && customer_phone) {
    return "mpesa_stk_push";
  }

  // Returning customer with saved payment method → one tap
  if (has_saved_method) {
    return "one_tap_saved";
  }

  // Default: full checkout widget
  return "full_checkout";
}

// --- Metadata Builder ---

export function buildPaymentMetadata(params: {
  merchant: { name: string; till: string; id?: string };
  flow: "tapgo" | "table" | "invoice" | "quick_charge";
  customer: { phone: string; name?: string; loyaltyId?: string };
  table?: { number: number; server: string; orderId?: string };
  items?: Array<{ name: string; qty: number; price: number; category?: string }>;
  split?: { type: "full" | "equal" | "custom" | "by_item"; totalParties?: number; index?: number };
  tip?: { amount: number; recipient: string };
  qrScannedAt?: string;
}): PaymentMetadata {
  const { merchant, flow, customer, table, items, split, tip, qrScannedAt } = params;

  return {
    merchant_id: merchant.id,
    merchant_name: merchant.name,
    till_number: merchant.till,
    flow_type: flow,

    table_number: table?.number,
    server_name: table?.server,
    order_id: table?.orderId,

    items: items ? JSON.stringify(items) : undefined,

    split_type: split?.type || "full",
    split_of: split?.totalParties || 1,
    split_index: split?.index || 1,

    customer_phone: customer.phone,
    customer_name: customer.name,
    customer_loyalty_id: customer.loyaltyId,
    loyalty_points_earned: undefined, // calculated on server after payment

    tip_amount: tip?.amount || 0,
    tip_recipient: tip?.recipient,

    idempotency_key: generateIdempotencyKey(flow, table?.number, customer.phone),
    device_fingerprint: getDeviceFingerprint(),
    qr_scanned_at: qrScannedAt,
  };
}

// --- API Client ---

class PesaSwapClient {
  private backendUrl: string;

  constructor(backendUrl?: string) {
    this.backendUrl = backendUrl || PESASWAP_CONFIG.backendUrl;
  }

  async createPayment(request: CreatePaymentRequest): Promise<CreatePaymentResponse> {
    const response = await fetch(`${this.backendUrl}/api/payments/create`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": String((request.metadata as PaymentMetadata).idempotency_key || Date.now()),
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: "Payment creation failed" }));
      throw new PaymentError(error.message || "Failed to create payment", "creation_failed");
    }

    return response.json();
  }

  async getPaymentStatus(paymentId: string): Promise<{ status: PaymentStatus; amount: number }> {
    const response = await fetch(`${this.backendUrl}/api/payments/${paymentId}/status`);
    if (!response.ok) throw new PaymentError("Failed to get payment status", "status_check_failed");
    return response.json();
  }

  async processRefund(request: RefundRequest): Promise<RefundResponse> {
    const response = await fetch(`${this.backendUrl}/api/refunds`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": `refund-${request.payment_id}-${Date.now()}`,
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: "Refund failed" }));
      throw new PaymentError(error.message || "Refund processing failed", "refund_failed");
    }

    return response.json();
  }

  async getCustomerPaymentMethods(phone: string): Promise<{
    has_saved: boolean;
    methods: Array<{ id: string; type: PaymentMethod; last4?: string; label: string }>;
    default_method?: string;
  }> {
    const response = await fetch(`${this.backendUrl}/api/customers/payment-methods?phone=${encodeURIComponent(phone)}`);
    if (!response.ok) return { has_saved: false, methods: [] };
    return response.json();
  }
}

// --- HyperLoader Integration ---

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let hyperInstance: any = null;
let loaderPromise: Promise<void> | null = null;

export function loadHyperLoader(): Promise<void> {
  if (loaderPromise) return loaderPromise;

  loaderPromise = new Promise((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("HyperLoader requires browser environment"));
      return;
    }

    // Check if already loaded
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((window as any).Hyper) {
      resolve();
      return;
    }

    const script = document.createElement("script");
    script.src = PESASWAP_CONFIG.hyperLoaderUrl;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load PesaSwap HyperLoader"));
    document.head.appendChild(script);
  });

  return loaderPromise;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getHyperInstance(): any {
  if (hyperInstance) return hyperInstance;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Hyper = (window as any).Hyper as
    | ((key: string, opts?: Record<string, string>) => unknown)
    | undefined;

  if (!Hyper) throw new PaymentError("HyperLoader not loaded", "sdk_not_ready");

  hyperInstance = Hyper(PESASWAP_CONFIG.publishableKey, {
    customBackendUrl: PESASWAP_CONFIG.backendUrl || undefined,
  } as Record<string, string>);

  return hyperInstance;
}

// --- Payment Execution Functions ---

/**
 * One-Tap Payment (returning customer with saved method)
 * Confirms payment with default saved method - zero UI friction
 */
export async function oneClickPay(clientSecret: string): Promise<{
  success: boolean;
  status: PaymentStatus;
  error?: string;
}> {
  await loadHyperLoader();
  const hyper = getHyperInstance();

  hyper.initPaymentSession({ clientSecret });

  const result = await hyper.confirmWithCustomerDefaultPaymentMethod({
    confirmParams: {
      return_url: `${window.location.origin}/pay?status=complete`,
    },
    redirect: "if_required",
  });

  if (result.error) {
    return { success: false, status: "failed", error: result.error.message };
  }

  return { success: true, status: result.status || "succeeded" };
}

/**
 * M-Pesa STK Push Payment
 * Triggers STK push to customer's phone - they confirm on handset
 */
export async function mpesaStkPay(
  clientSecret: string,
  phone: string,
): Promise<{ success: boolean; status: PaymentStatus; error?: string }> {
  await loadHyperLoader();
  const hyper = getHyperInstance();

  hyper.initPaymentSession({ clientSecret });

  const result = await hyper.confirmPayment({
    clientSecret,
    confirmParams: {
      return_url: `${window.location.origin}/pay?status=complete`,
      payment_method: "mobile_payment",
      payment_method_data: {
        billing_details: { phone: formatKenyanPhone(phone) },
        mobile_payment: { phone_number: formatKenyanPhone(phone) },
      },
    },
    redirect: "if_required", // M-Pesa doesn't need redirect
  });

  if (result.error) {
    return { success: false, status: "failed", error: result.error.message };
  }

  return { success: true, status: result.status || "processing" };
}

/**
 * Full Checkout Widget
 * Mounts the PesaSwap Unified Checkout in a container element
 */
export async function mountCheckoutWidget(
  clientSecret: string,
  containerId: string,
  options?: { theme?: "midnight" | "default" | "flat"; layout?: "tabs" | "accordion" },
): Promise<{
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  widgets: any;
  confirmPayment: () => Promise<{ success: boolean; status: PaymentStatus; error?: string }>;
}> {
  await loadHyperLoader();
  const hyper = getHyperInstance();

  const appearance = { theme: options?.theme || "midnight" };
  const widgets = hyper.widgets({ appearance, clientSecret });

  const unifiedCheckout = widgets.create("payment", {
    layout: options?.layout || "tabs",
    wallets: {
      walletReturnUrl: `${window.location.origin}/pay?status=complete`,
    },
  });

  unifiedCheckout.mount(containerId);

  return {
    widgets,
    confirmPayment: async () => {
      const { error, status } = await hyper.confirmPayment({
        widgets,
        confirmParams: {
          return_url: `${window.location.origin}/pay?status=complete`,
        },
        redirect: "if_required",
      });

      if (error) {
        return { success: false, status: "failed" as PaymentStatus, error: error.message };
      }
      return { success: true, status: status || ("succeeded" as PaymentStatus) };
    },
  };
}

// --- Unified Payment Orchestrator ---

/**
 * Main payment function that handles the full flow:
 * 1. Creates payment intent on backend
 * 2. Resolves optimal payment method
 * 3. Executes payment (STK push, one-tap, or full checkout)
 * 4. Returns result with status
 */
export async function executePayment(params: {
  amount: number; // in base currency units (e.g., KES 2450, not cents)
  currency?: string;
  metadata: PaymentMetadata;
  phone: string;
  preferredFlow?: PaymentFlow;
  checkoutContainerId?: string; // for full checkout widget
  onStatusChange?: (status: PaymentStatus) => void;
}): Promise<{
  success: boolean;
  status: PaymentStatus;
  payment_id?: string;
  error?: string;
}> {
  const { amount, currency = "KES", metadata, phone, preferredFlow, onStatusChange } = params;

  const client = new PesaSwapClient();

  try {
    // 1. Create payment intent
    onStatusChange?.("requires_payment_method");
    const payment = await client.createPayment({
      amount: amount * 100, // convert to minor units
      currency,
      metadata,
      description: describePayment(metadata),
    });

    onStatusChange?.("requires_confirmation");

    // 2. Resolve flow
    const savedMethods = await client.getCustomerPaymentMethods(phone);
    const flow =
      preferredFlow ||
      resolvePaymentFlow({
        amount: amount * 100,
        currency,
        customer_phone: phone,
        has_saved_method: savedMethods.has_saved,
      });

    // 3. Execute based on flow
    let result: { success: boolean; status: PaymentStatus; error?: string };

    switch (flow) {
      case "mpesa_stk_push":
        onStatusChange?.("processing");
        result = await mpesaStkPay(payment.client_secret, phone);
        break;

      case "one_tap_saved":
        onStatusChange?.("processing");
        result = await oneClickPay(payment.client_secret);
        break;

      case "full_checkout":
        if (params.checkoutContainerId) {
          const checkout = await mountCheckoutWidget(payment.client_secret, params.checkoutContainerId);
          result = await checkout.confirmPayment();
        } else {
          // Fallback to M-Pesa if no container for widget
          onStatusChange?.("processing");
          result = await mpesaStkPay(payment.client_secret, phone);
        }
        break;

      default:
        result = { success: false, status: "failed", error: "Unknown payment flow" };
    }

    // 4. Verify server-side status (never trust client alone)
    if (result.success) {
      const verified = await pollPaymentStatus(client, payment.payment_id, 30000);
      onStatusChange?.(verified.status);
      return {
        success: verified.status === "succeeded",
        status: verified.status,
        payment_id: payment.payment_id,
        error: verified.status !== "succeeded" ? "Payment not confirmed by server" : undefined,
      };
    }

    onStatusChange?.(result.status);
    return { ...result, payment_id: payment.payment_id };
  } catch (error) {
    const message = error instanceof PaymentError ? error.message : "Payment failed unexpectedly";
    onStatusChange?.("failed");
    return { success: false, status: "failed", error: message };
  }
}

// --- Polling for Payment Verification ---

async function pollPaymentStatus(
  client: PesaSwapClient,
  paymentId: string,
  timeoutMs: number,
): Promise<{ status: PaymentStatus }> {
  const start = Date.now();
  const interval = 2000;

  while (Date.now() - start < timeoutMs) {
    try {
      const { status } = await client.getPaymentStatus(paymentId);
      if (status === "succeeded" || status === "failed" || status === "cancelled") {
        return { status };
      }
    } catch {
      // Retry on network error
    }
    await sleep(interval);
  }

  // Timeout — report as processing (will be resolved via webhook)
  return { status: "processing" };
}

// --- Utility Functions ---

export function formatKenyanPhone(phone: string): string {
  const cleaned = phone.replace(/\D/g, "");
  if (cleaned.startsWith("254")) return `+${cleaned}`;
  if (cleaned.startsWith("0")) return `+254${cleaned.slice(1)}`;
  if (cleaned.startsWith("7") || cleaned.startsWith("1")) return `+254${cleaned}`;
  return `+254${cleaned}`;
}

function generateIdempotencyKey(flow: string, tableNumber?: number, phone?: string): string {
  const timestamp = Math.floor(Date.now() / 1000); // 1-second granularity prevents rapid double-tap
  const parts = [flow, tableNumber || "direct", phone || "anon", timestamp];
  return parts.join("-");
}

function getDeviceFingerprint(): string {
  if (typeof window === "undefined") return "server";
  const { userAgent, language, hardwareConcurrency } = navigator;
  const screen = `${window.screen.width}x${window.screen.height}`;
  const raw = `${userAgent}|${language}|${hardwareConcurrency}|${screen}`;
  // Simple hash for fingerprint (non-cryptographic, for fraud signal only)
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = ((hash << 5) - hash + raw.charCodeAt(i)) | 0;
  }
  return `df_${Math.abs(hash).toString(36)}`;
}

function describePayment(metadata: PaymentMetadata): string {
  if (metadata.table_number) {
    return `Table ${metadata.table_number} payment at ${metadata.merchant_name}`;
  }
  if (metadata.flow_type === "tapgo") {
    return `Tap&Go payment to ${metadata.merchant_name}`;
  }
  if (metadata.flow_type === "invoice") {
    return `Invoice payment to ${metadata.merchant_name}`;
  }
  return `Payment to ${metadata.merchant_name}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- Error Class ---

export class PaymentError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "PaymentError";
    this.code = code;
  }
}

// --- Singleton Client Export ---

export const pesaswapClient = new PesaSwapClient();
