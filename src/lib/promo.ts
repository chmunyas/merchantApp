// Promo / offer codes. Pure + unit-testable. Amounts are MINOR units (cents) to
// match orders.total. `applyPromo` is the single source of truth for whether a code
// is valid against a subtotal and how much it discounts — reused by the public
// validate endpoint AND the order handler so preview + charge always agree.

export type PromoKind = "percent" | "fixed";

export type PromoCode = {
  code: string;
  kind: PromoKind;
  value: number; // percent (0-100) OR fixed minor units
  minOrder: number; // minor units
  maxDiscount: number; // minor units cap for percent (0 = no cap)
  active: boolean;
  startsAt?: string | null;
  expiresAt?: string | null;
  usageLimit: number; // 0 = unlimited
  usedCount: number;
};

export type PromoResult = {
  valid: boolean;
  discount: number; // minor units to subtract (0 when invalid)
  finalTotal: number; // subtotal - discount (== subtotal when invalid)
  reason?: string; // why it was rejected
};

// Normalise a code for storage + comparison (case-insensitive, trimmed, no spaces).
export function normalizeCode(code: string): string {
  return String(code ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

export function applyPromo(
  promo: PromoCode | null,
  subtotal: number,
  now: Date = new Date(),
): PromoResult {
  const sub = Math.max(0, Math.round(subtotal));
  const reject = (reason: string): PromoResult => ({
    valid: false,
    discount: 0,
    finalTotal: sub,
    reason,
  });

  if (!promo) return reject("Code not found");
  if (!promo.active) return reject("This code is no longer active");
  if (promo.startsAt && new Date(promo.startsAt).getTime() > now.getTime()) {
    return reject("This code isn't active yet");
  }
  if (promo.expiresAt && new Date(promo.expiresAt).getTime() < now.getTime()) {
    return reject("This code has expired");
  }
  if (promo.usageLimit > 0 && promo.usedCount >= promo.usageLimit) {
    return reject("This code has been fully redeemed");
  }
  if (sub < promo.minOrder) {
    return reject("Order is below this code's minimum");
  }

  let discount =
    promo.kind === "percent"
      ? Math.floor((sub * Math.min(100, Math.max(0, promo.value))) / 100)
      : Math.max(0, Math.round(promo.value));
  if (promo.kind === "percent" && promo.maxDiscount > 0) {
    discount = Math.min(discount, promo.maxDiscount);
  }
  // A discount can never exceed the bill.
  discount = Math.max(0, Math.min(discount, sub));
  if (discount <= 0) return reject("This code gives no discount on this order");

  return { valid: true, discount, finalTotal: sub - discount };
}
