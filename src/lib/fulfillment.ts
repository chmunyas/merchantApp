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
  timeZone = "Africa/Nairobi",
): string | null {
  if (!value) return null;
  const raw = String(value);
  let d: Date;
  const wall = raw.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/,
  );
  if (wall) {
    try {
      const targetUtc = Date.UTC(
        Number(wall[1]),
        Number(wall[2]) - 1,
        Number(wall[3]),
        Number(wall[4]),
        Number(wall[5]),
        Number(wall[6] ?? 0),
      );
      let candidate = targetUtc;
      for (let i = 0; i < 3; i += 1) {
        const parts = new Intl.DateTimeFormat("en-CA", {
          timeZone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hourCycle: "h23",
        }).formatToParts(new Date(candidate));
        const part = (type: Intl.DateTimeFormatPartTypes) =>
          Number(parts.find((entry) => entry.type === type)?.value ?? 0);
        const represented = Date.UTC(
          part("year"), part("month") - 1, part("day"), part("hour"),
          part("minute"), part("second"),
        );
        candidate += targetUtc - represented;
      }
      d = new Date(candidate);
      const verification = new Intl.DateTimeFormat("sv-SE", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(d).replace(" ", "T");
      if (verification !== raw.slice(0, 16)) return null;
    } catch {
      return null;
    }
  } else {
    d = new Date(raw);
  }
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
