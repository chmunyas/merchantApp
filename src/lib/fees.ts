// Transparent, per-method fee model. Rates are config-as-code so a merchant can
// always see EXACTLY what they pay behind a headline rate — the review's "bill
// shock" fix. All amounts are in MINOR units (cents), matching the ledger.

export type PayMethod =
  | "mpesa"
  | "card"
  | "card_premium"
  | "pay_by_bank"
  | "wallet"
  | "other";

export type FeeTier = {
  method: PayMethod;
  label: string;
  percent: number; // percent of the amount
  fixed: number; // flat minor-unit fee per transaction
};

// The published schedule. A headline rate (e.g. 0.79%) is only honest when the
// merchant can see the real per-method rates behind it — especially that premium
// / international cards and instant payouts cost more.
export const DEFAULT_FEE_SCHEDULE: FeeTier[] = [
  { method: "pay_by_bank", label: "Pay by Bank (A2A)", percent: 0.3, fixed: 0 },
  { method: "mpesa", label: "M-Pesa", percent: 0.79, fixed: 0 },
  { method: "card", label: "Card", percent: 1.5, fixed: 0 },
  { method: "card_premium", label: "Premium / intl card", percent: 2.9, fixed: 0 },
  { method: "wallet", label: "Wallet (Apple / Google Pay)", percent: 1.5, fixed: 0 },
  { method: "other", label: "Other", percent: 1.5, fixed: 0 },
];

// Surcharge added on top of the transaction fee when the merchant takes an
// INSTANT payout instead of the standard schedule — a classic hidden cost.
export const INSTANT_PAYOUT_PERCENT = 1.0;

export type FeeQuote = {
  fee: number; // minor units
  net: number; // minor units the merchant keeps
  rate: number; // effective % on this transaction
  method: PayMethod;
  label: string;
};

export function feeTierFor(
  method: PayMethod,
  schedule: FeeTier[] = DEFAULT_FEE_SCHEDULE,
): FeeTier {
  return (
    schedule.find((t) => t.method === method) ??
    schedule.find((t) => t.method === "other") ?? {
      method: "other",
      label: "Other",
      percent: 1.5,
      fixed: 0,
    }
  );
}

// The fee (and net) for a single amount + method. Never exceeds the amount.
export function computeFee(
  amount: number,
  method: PayMethod = "mpesa",
  opts: { instantPayout?: boolean; schedule?: FeeTier[] } = {},
): FeeQuote {
  const tier = feeTierFor(method, opts.schedule);
  let fee = Math.round((amount * tier.percent) / 100) + tier.fixed;
  if (opts.instantPayout) {
    fee += Math.round((amount * INSTANT_PAYOUT_PERCENT) / 100);
  }
  fee = Math.max(0, Math.min(fee, amount));
  const net = amount - fee;
  const rate = amount > 0 ? (fee / amount) * 100 : 0;
  return { fee, net, rate, method: tier.method, label: tier.label };
}

// Map a payment's metadata to a billing method. Real flows tag `flow_type`
// (tapgo/invoice/table = M-Pesa here) or an explicit `method`/`payment_method`.
export function methodFromMetadata(
  meta: Record<string, unknown> | null | undefined,
): PayMethod {
  const m = String(
    (meta?.method as string) ?? (meta?.payment_method as string) ?? "",
  ).toLowerCase();
  const flow = String(meta?.flow_type ?? "").toLowerCase();
  if (m.includes("pay_by_bank") || m.includes("a2a") || m.includes("bank")) {
    return "pay_by_bank";
  }
  if (m.includes("premium") || m.includes("amex") || m.includes("intl")) {
    return "card_premium";
  }
  if (m.includes("apple") || m.includes("google") || m.includes("wallet")) {
    return "wallet";
  }
  if (m.includes("card")) return "card";
  if (
    m.includes("mpesa") ||
    m.includes("stk") ||
    flow === "tapgo" ||
    flow === "invoice" ||
    flow === "table" ||
    flow === "quick_charge"
  ) {
    return "mpesa";
  }
  return "mpesa"; // the default rail in this market
}

// ---------------------------------------------------------------------------
// Guest service fee (roadmap A5.5)
//
// A separate, OPTIONAL fee the guest pays for paying instantly from their own
// phone — instant settlement of the bill, splitting it in seconds, and an
// instant digital receipt. Sunday's guest-facing article is explicit that it is
// avoidable: a guest who prefers to wait for the traditional card machine pays
// nothing. That framing is contractual, so it is stated here next to the maths
// and rendered verbatim at checkout. Amounts are MINOR units.
// ---------------------------------------------------------------------------

export type GuestFeeConfig = {
  enabled: boolean;
  percent: number; // percent of the amount being paid
  fixed: number; // flat minor-unit fee
  cap: number | null; // optional per-transaction ceiling, minor units
};

// Off by default: a venue opts in explicitly, and until it does the guest sees
// "no extra fee" rather than a number we invented.
export const DEFAULT_GUEST_FEE: GuestFeeConfig = {
  enabled: false,
  percent: 0,
  fixed: 0,
  cap: null,
};

// A guest fee above this is not "convenience", it is a surprise. Hard ceiling.
export const MAX_GUEST_FEE_PERCENT = 5;

export const GUEST_FEE_BENEFITS = [
  "Settle the bill instantly — no waiting for the card machine",
  "Split it with the table in seconds",
  "Your receipt lands on your phone straight away",
] as const;

export const GUEST_FEE_OPT_OUT =
  "This fee is optional — you can wait for the traditional card machine instead and pay nothing extra.";

export type GuestFeeQuote = {
  enabled: boolean;
  fee: number; // minor units the guest pays on top
  total: number; // amount + fee, minor units
  percent: number;
  fixed: number;
  cap: number | null;
  benefits: readonly string[];
  optOut: string;
};

// Normalise whatever is stored/submitted into a config we are willing to charge.
export function normalizeGuestFeeConfig(
  input: Partial<GuestFeeConfig> | null | undefined,
): GuestFeeConfig {
  const percent = Math.min(
    MAX_GUEST_FEE_PERCENT,
    Math.max(0, Number(input?.percent) || 0),
  );
  const fixed = Math.max(0, Math.round(Number(input?.fixed) || 0));
  const rawCap = Number(input?.cap);
  const cap =
    input?.cap === null || input?.cap === undefined || !Number.isFinite(rawCap)
      ? null
      : Math.max(0, Math.round(rawCap));
  return { enabled: Boolean(input?.enabled), percent, fixed, cap };
}

// What the guest actually pays on top. Never negative, never above the cap, and
// always zero while the venue has not opted in.
export function computeGuestServiceFee(
  amount: number,
  config: Partial<GuestFeeConfig> | null | undefined = DEFAULT_GUEST_FEE,
): GuestFeeQuote {
  const cfg = normalizeGuestFeeConfig(config);
  const base = Math.max(0, Math.round(Number(amount) || 0));
  let fee = 0;
  if (cfg.enabled && base > 0) {
    fee = Math.round((base * cfg.percent) / 100) + cfg.fixed;
    if (cfg.cap !== null) fee = Math.min(fee, cfg.cap);
    fee = Math.max(0, fee);
  }
  return {
    enabled: cfg.enabled,
    fee,
    total: base + fee,
    percent: cfg.percent,
    fixed: cfg.fixed,
    cap: cfg.cap,
    benefits: GUEST_FEE_BENEFITS,
    optOut: GUEST_FEE_OPT_OUT,
  };
}

export type BlendedTotals = {
  gross: number;
  fees: number;
  net: number;
  rate: number; // blended effective %
  count: number;
};

// The blended effective rate across many transactions = total fees / total gross.
export function blendedRate(
  rows: Array<{ amount: number; fee: number }>,
): BlendedTotals {
  let gross = 0;
  let fees = 0;
  for (const r of rows) {
    gross += r.amount;
    fees += r.fee;
  }
  return {
    gross,
    fees,
    net: gross - fees,
    rate: gross > 0 ? (fees / gross) * 100 : 0,
    count: rows.length,
  };
}
