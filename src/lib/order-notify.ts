// Customer notification copy for the order lifecycle. Pure + unit-testable.

// The "your order is ready" message sent when an order transitions to `ready`.
// Includes the collection time when one was booked.
export function orderReadyMessage(
  venueName: string,
  pickupAt?: string | Date | null,
): string {
  const where = venueName?.trim() ? venueName.trim() : "the venue";
  let when = "";
  if (pickupAt) {
    const d = new Date(pickupAt);
    if (!Number.isNaN(d.getTime())) {
      const time = d.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
      when = ` Your collection slot is ${time}.`;
    }
  }
  return `✅ Your order at ${where} is ready for collection!${when} Thanks for ordering.`;
}
