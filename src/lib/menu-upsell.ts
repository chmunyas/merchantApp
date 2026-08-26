// C6.7 / A6.6 — related products (upsells).
//
// Sunday's model, matched deliberately:
//   * Product-specific upsells are configured MANUALLY, at PRODUCT level, not
//     category level. Add-ons/modifiers are the POS's job (C6.6, blocked on C5)
//     and are explicitly not this.
//   * "If a product appears in multiple menus, the same upsell recommendation
//     will appear everywhere that product is listed" — hence the link hangs off
//     the item id, never off a menu.
//   * "Products without photos won't appear in upsell recommendations", and a
//     recommended product that is not active/available must not be offered.
//   * Checkout recommendations are a titled block of up to five products.
//
// Pure and deterministic so the selection can be unit-tested without a database.

import { recommendUpsells, type CartLine, type MenuItemLite } from "@/lib/menu-ai";

export const MAX_CHECKOUT_UPSELLS = 5;
export const MAX_PRODUCT_UPSELLS = 5;

export type UpsellItem = MenuItemLite & {
  id: string;
  imageUrl?: string | null;
  imageAlt?: string | null;
};

export type UpsellLink = {
  itemId: string;
  suggestedItemId: string;
  displayOrder: number;
};

export type Upsell = {
  item: UpsellItem;
  reason: string;
  /** The cart line that triggered the suggestion, or null for checkout blocks. */
  triggeredBy: string | null;
  /** True when a merchant configured this pairing by hand. */
  configured: boolean;
};

const key = (value: string | undefined | null) => (value ?? "").trim().toLowerCase();

/**
 * Sunday's two publishing rules for a recommended product, in one place: it
 * must be orderable, and it must have a photo (the card is a picture card —
 * without one the guest is shown an empty box).
 */
export function isUpsellEligible(item: UpsellItem | undefined): item is UpsellItem {
  if (!item) return false;
  if (item.available === false) return false;
  return Boolean(item.imageUrl && item.imageUrl.trim());
}

function cartKeys(cart: readonly CartLine[]): Set<string> {
  return new Set(cart.flatMap((line) => [key(line.id), key(line.name)]).filter(Boolean));
}

/**
 * Product-specific upsells: for every item the guest has added, the products
 * the merchant attached to it. Ordered by the cart order, then by the
 * merchant's `display_order`, and de-duplicated across trigger items.
 */
export function selectProductUpsells(
  links: readonly UpsellLink[],
  menu: readonly UpsellItem[],
  cart: readonly CartLine[],
  max = MAX_PRODUCT_UPSELLS,
): Upsell[] {
  const byId = new Map(menu.map((item) => [key(item.id), item]));
  const inCart = cartKeys(cart);
  const chosen: Upsell[] = [];
  const seen = new Set<string>();

  for (const line of cart) {
    const triggerId = key(line.id);
    if (!triggerId) continue;
    const forTrigger = links
      .filter((link) => key(link.itemId) === triggerId)
      .sort((a, b) => a.displayOrder - b.displayOrder);
    for (const link of forTrigger) {
      if (chosen.length >= max) return chosen;
      const suggestedId = key(link.suggestedItemId);
      if (seen.has(suggestedId) || inCart.has(suggestedId)) continue;
      const item = byId.get(suggestedId);
      if (!isUpsellEligible(item)) continue;
      seen.add(suggestedId);
      chosen.push({
        item,
        reason: `Goes well with ${byId.get(triggerId)?.name ?? line.name ?? "your order"}`,
        triggeredBy: line.id ?? null,
        configured: true,
      });
    }
  }
  return chosen;
}

/**
 * Checkout recommendations — the titled block shown before the guest confirms.
 * Not tied to any one item, capped at five, and subject to the same photo and
 * availability rules.
 */
export function selectCheckoutUpsells(
  itemIds: readonly string[],
  menu: readonly UpsellItem[],
  cart: readonly CartLine[],
  max = MAX_CHECKOUT_UPSELLS,
): Upsell[] {
  const byId = new Map(menu.map((item) => [key(item.id), item]));
  const inCart = cartKeys(cart);
  const chosen: Upsell[] = [];
  const seen = new Set<string>();

  for (const rawId of itemIds) {
    if (chosen.length >= Math.min(max, MAX_CHECKOUT_UPSELLS)) break;
    const id = key(rawId);
    if (!id || seen.has(id) || inCart.has(id)) continue;
    const item = byId.get(id);
    if (!isUpsellEligible(item)) continue;
    seen.add(id);
    chosen.push({ item, reason: "", triggeredBy: null, configured: true });
  }
  return chosen;
}

export type CartUpsellOptions = {
  max?: number;
  /**
   * Sunday hides photo-less products from the guest's visual upsell cards. The
   * omnichannel agent renders text, so it passes `false` and keeps suggesting.
   */
  requirePhoto?: boolean;
};

/**
 * What to suggest for a cart: the merchant's manual pairings first (they are an
 * explicit instruction), topped up with the deterministic complement engine so
 * a venue that has configured nothing still gets a sensible suggestion instead
 * of an empty shelf.
 */
export function selectCartUpsells(
  links: readonly UpsellLink[],
  menu: readonly UpsellItem[],
  cart: readonly CartLine[],
  options: CartUpsellOptions = {},
): Upsell[] {
  const max = Math.max(1, Math.min(MAX_PRODUCT_UPSELLS, options.max ?? 3));
  const requirePhoto = options.requirePhoto ?? true;
  const chosen = selectProductUpsells(links, menu, cart, max);
  if (chosen.length >= max) return chosen;

  const seen = new Set(chosen.map((entry) => key(entry.item.id)));
  const pool = (requirePhoto ? menu.filter(isUpsellEligible) : [...menu]) as UpsellItem[];
  const fallbackCart = [...cart, ...chosen.map((entry) => ({ id: entry.item.id }))];
  for (const suggestion of recommendUpsells(pool, fallbackCart, max)) {
    if (chosen.length >= max) break;
    const id = key((suggestion.item as UpsellItem).id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    chosen.push({
      item: suggestion.item as UpsellItem,
      reason: suggestion.reason,
      triggeredBy: null,
      configured: false,
    });
  }
  return chosen;
}
