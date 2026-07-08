// Pure order-fulfillment helpers (pre-order for collection / dine-in / delivery).
// Kept dependency-free so the order API + UI share one normalization and it is
// trivially unit-tested.

export type FulfillmentType = "dine_in" | "collection" | "delivery";

const ALIASES: Record<string, FulfillmentType> = {
  dine_in: "dine_in",
  dinein: "dine_in",
  eat_in: "dine_in",
  eatin: "dine_in",
  "eat-in": "dine_in",
  table: "dine_in",
  collection: "collection",
  takeaway: "collection",
  take_away: "collection",
  pickup: "collection",
  pick_up: "collection",
  delivery: "delivery",
  deliver: "delivery",
};

// Normalise any client value to a known fulfillment type (defaults to dine_in so
// existing/blank orders keep their behaviour).
export function normalizeFulfillment(value: unknown): FulfillmentType {
  const key = String(value ?? "").toLowerCase().trim().replace(/[\s-]+/g, "_");
  return ALIASES[key] ?? "dine_in";
}

// Parse a requested pre-order time. Returns an ISO string for a FUTURE time, or
// null (= ASAP) for an empty/invalid/past value. A small 1-minute grace absorbs
// clock skew so "now" isn't rejected.
export function parseScheduledAt(
  value: unknown,
  now: Date = new Date(),
): string | null {
  if (!value) return null;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return null;
  if (d.getTime() < now.getTime() - 60_000) return null;
  return d.toISOString();
}

export function fulfillmentLabel(type: FulfillmentType): string {
  switch (type) {
    case "collection":
      return "Collection";
    case "delivery":
      return "Delivery";
    default:
      return "Dine-in";
  }
}
