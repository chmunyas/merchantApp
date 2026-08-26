// A2.2 — split a bill BY ITEM.
//
// The contract this module exists to guarantee:
//
//   1. `orders.total` is the authoritative amount the venue is owed. It already
//      carries the discount, any tax and any service charge / auto-gratuity the
//      POS put on the bill. `order_items` only ever sum to the *pre-discount*
//      subtotal, so a guest who paid "just the sum of my dishes" would underpay
//      (discounted bill) or overpay (bill with tax/service on top).
//
//      So we never charge the raw item subtotal. We apportion `orders.total`
//      across the lines IN PROPORTION to each line's subtotal. A guest therefore
//      pays their dishes plus exactly their proportional slice of the tax, the
//      service charge and the discount. That is the whole rule.
//
//   2. The apportionment is exact: the per-line amounts always sum to `total`,
//      to the cent. No cent is created and no cent is lost. Remainder cents are
//      handed out by the largest-remainder (Hamilton) method — biggest
//      fractional part first, ties broken by line order — so the allocation is
//      DETERMINISTIC. That determinism is load-bearing: two guests claiming
//      disjoint sets of lines, minutes apart, must together pay the bill exactly.
//
//   3. All arithmetic is integer arithmetic in minor units. No floats, ever.

export type BillLine = {
  id: string;
  qty: number;
  /** Unit price in minor units. */
  price: number;
};

/** A line's own subtotal in minor units (qty x unit price). */
export function lineSubtotal(line: Pick<BillLine, "qty" | "price">): number {
  const qty = Math.max(0, Math.trunc(Number(line.qty) || 0));
  const price = Math.max(0, Math.trunc(Number(line.price) || 0));
  return qty * price;
}

/**
 * Split `total` across `weights` so that the result sums to `total` EXACTLY.
 *
 * Largest-remainder: every slot gets `floor(total * w / sum)`, then the leftover
 * cents go one each to the slots with the largest fractional part (ties broken
 * by ascending index, so the result is stable across calls and processes).
 *
 * Degenerate inputs are handled explicitly rather than left to float luck:
 * - no slots -> no allocation;
 * - all weights zero (a bill of freebies that still carries a service charge)
 *   -> the total is shared equally, again by largest remainder;
 * - negative weights are clamped to zero; a negative total is clamped to zero.
 */
export function apportion(weights: readonly number[], total: number): number[] {
  const n = weights.length;
  if (n === 0) return [];

  const target = Math.max(0, Math.trunc(Number(total) || 0));
  const safe = weights.map((w) => Math.max(0, Math.trunc(Number(w) || 0)));
  const sum = safe.reduce((a, b) => a + b, 0);
  // Nothing to weight by: fall back to an equal share so the cents still balance.
  const effective = sum > 0 ? safe : safe.map(() => 1);
  const denominator = sum > 0 ? sum : n;

  const base: number[] = new Array(n);
  // Fractional part, kept as an integer numerator over `denominator` so we never
  // compare floats.
  const remainderNumerator: number[] = new Array(n);
  let allocated = 0;
  for (let i = 0; i < n; i += 1) {
    const numerator = target * effective[i];
    const floor = Math.floor(numerator / denominator);
    base[i] = floor;
    remainderNumerator[i] = numerator - floor * denominator;
    allocated += floor;
  }

  let leftover = target - allocated;
  if (leftover > 0) {
    const order = base
      .map((_, i) => i)
      .sort((a, b) =>
        remainderNumerator[b] === remainderNumerator[a]
          ? a - b
          : remainderNumerator[b] - remainderNumerator[a],
      );
    for (let k = 0; k < order.length && leftover > 0; k += 1) {
      base[order[k]] += 1;
      leftover -= 1;
    }
  }
  return base;
}

/**
 * Apportion an order's authoritative total across its lines.
 * Returns a line-id -> minor-units map whose values sum to `totalMinor`.
 */
export function apportionBill(
  lines: readonly BillLine[],
  totalMinor: number,
): Map<string, number> {
  const amounts = apportion(lines.map(lineSubtotal), totalMinor);
  const byId = new Map<string, number>();
  lines.forEach((line, i) => {
    // Duplicate ids would silently swallow money; sum instead of overwrite.
    byId.set(line.id, (byId.get(line.id) ?? 0) + amounts[i]);
  });
  return byId;
}

/**
 * What a guest owes for the lines they selected: their dishes plus their
 * proportional slice of tax, service charge and discount.
 */
export function shareForItems(
  lines: readonly BillLine[],
  totalMinor: number,
  selectedIds: readonly string[],
): number {
  const byId = apportionBill(lines, totalMinor);
  const wanted = new Set(selectedIds);
  let share = 0;
  for (const [id, amount] of byId) {
    if (wanted.has(id)) share += amount;
  }
  return share;
}
