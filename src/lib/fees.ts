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
