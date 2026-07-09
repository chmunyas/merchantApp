// Customer notification copy for the order lifecycle. Pure + unit-testable.
// One builder covers every stage and is fulfillment-aware (dine-in vs collection
// vs delivery) so the customer gets the right words + timing on any channel.

import type { FulfillmentType } from "@/lib/fulfillment";

// A short "3:15 PM" style time, or "" when there is no valid scheduled time.
function scheduledTime(scheduledAt?: string | Date | null): string {
  if (!scheduledAt) return "";
  const d = new Date(scheduledAt);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export type OrderNotifyOpts = {
  venueName?: string | null;
  fulfillment?: FulfillmentType;
  scheduledAt?: string | Date | null;
};

// The customer-facing message for an order transitioning INTO `status`. Returns
// null for statuses that should NOT alert the customer (new / served / cancelled)
// so callers can simply skip when null.
export function orderStatusMessage(
  status: string,
  opts: OrderNotifyOpts = {},
): string | null {
  const where = opts.venueName?.trim() ? opts.venueName.trim() : "the venue";
  const fulfillment = opts.fulfillment ?? "collection";
  const time = scheduledTime(opts.scheduledAt);

  switch (status) {
    case "accepted":
      // Acknowledgement — the venue has received + confirmed the order.
      return (
        `👍 ${where} has received your order — it's confirmed.` +
        (time ? ` We'll have it ready for ${time}.` : "") +
        ` We'll keep you posted.`
      );
    case "preparing":
      // Processed — the kitchen has started.
      return (
        `👨‍🍳 Your order at ${where} is now being prepared.` +
        (time ? ` Aiming for ${time}.` : "")
      );
    case "ready":
      if (fulfillment === "dine_in") {
        return `✅ Your order at ${where} is ready — we're bringing it to your table. Enjoy!`;
      }
      if (fulfillment === "delivery") {
        return `✅ Your order at ${where} is ready and on its way to you. Thanks for ordering!`;
      }
      return (
        `✅ Your order at ${where} is ready for collection!` +
        (time ? ` Your collection slot is ${time}.` : "") +
        ` Thanks for ordering.`
      );
    default:
      return null;
  }
}

// Backward-compatible "your order is ready" message (collection-worded, includes
// the collection slot when known). Delegates to the unified builder.
export function orderReadyMessage(
  venueName: string,
  pickupAt?: string | Date | null,
): string {
  return orderStatusMessage("ready", {
    venueName,
    fulfillment: "collection",
    scheduledAt: pickupAt,
  })!;
}
