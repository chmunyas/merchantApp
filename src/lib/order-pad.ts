// Pure helpers for the staff order pad. Kept out of the component so the
// money-critical conversion is unit-tested: the MENU is priced in whole KES, but
// orders (and payments) are stored in MINOR units, so every line is ×100 on the
// way to POST /api/orders. Getting this wrong over- or under-charges the customer.

export type OrderPadLine = {
  name: string;
  price: number; // whole KES (as shown on the menu)
  qty: number;
  notes: string;
};

export type OrderItemPayload = {
  name: string;
  qty: number;
  price: number; // minor units
  notes?: string;
};

// Build the /api/orders items payload from the cart: drop empty lines, trim, and
// convert whole KES → minor units.
export function toOrderItems(lines: OrderPadLine[]): OrderItemPayload[] {
  return lines
    .filter((l) => l.qty > 0 && l.name.trim() !== "")
    .map((l) => ({
      name: l.name.trim(),
      qty: Math.floor(l.qty),
      price: Math.round(l.price * 100),
      notes: l.notes.trim() === "" ? undefined : l.notes.trim(),
    }));
}

// The order total shown to staff, in WHOLE KES (matches the menu prices).
export function orderPadTotal(lines: OrderPadLine[]): number {
  return lines.reduce((sum, l) => sum + Math.max(0, Math.floor(l.qty)) * l.price, 0);
}
