// Bridge: the retail counter's local sale → the server ledger.
//
// Two conversions matter and both are easy to get catastrophically wrong, so
// they live here, alone, and are unit-tested:
//
//   * MONEY. The counter works in whole shillings (a product is 180). The
//     ledger, like every other money path in this app, is minor units (18000).
//   * IDENTITY. A local product id (`prod_x7f`) is not an `inventory_items.id`.
//     Sending it as `itemId` would break a foreign key, so only a real UUID is
//     sent; otherwise the server is given the SKU/barcode to resolve itself.

import { getToken } from "@/lib/auth";
import type { RetailProduct, RetailSale } from "@/components/merchant/features/types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function toMinorUnits(wholeUnits: number): number {
  const value = Number(wholeUnits);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value * 100);
}

export type SalePayloadLine = {
  itemId: string | null;
  sku?: string;
  barcode?: string;
  name: string;
  qty: number;
  unitPriceMinor: number;
  unitCostMinor: number;
};

export type SalePayload = {
  lines: SalePayloadLine[];
  paymentMethod: string;
  customerName?: string;
  customerPhone?: string;
  paymentId?: string;
};

export function buildSalePayload(
  sale: RetailSale,
  products: readonly RetailProduct[],
): SalePayload {
  const byId = new Map(products.map((product) => [product.id, product]));
  const lines: SalePayloadLine[] = [];

  for (const item of sale.items) {
    const product = byId.get(item.productId);
    const line: SalePayloadLine = {
      itemId: UUID.test(item.productId) ? item.productId : null,
      name: item.name,
      qty: Number(item.qty) || 0,
      unitPriceMinor: toMinorUnits(item.unitPrice),
      unitCostMinor: toMinorUnits(product?.costPrice ?? 0),
    };
    // Let the server match the catalogue row when the local id is not a UUID.
    if (!line.itemId && product?.sku) line.sku = product.sku;
    if (!line.itemId && product?.barcode) line.barcode = product.barcode;
    if (line.qty > 0) lines.push(line);
  }

  return {
    lines,
    paymentMethod: sale.paymentMethod,
    ...(sale.customerName ? { customerName: sale.customerName } : {}),
    ...(sale.customerPhone ? { customerPhone: sale.customerPhone } : {}),
    ...(sale.mpesaRef ? { paymentId: sale.mpesaRef } : {}),
  };
}

export type PushResult =
  | { ok: true; serverId: string; replayed: boolean }
  | { ok: false; reason: "offline" | "rejected" | "unauthorized" };

/**
 * The local sale id doubles as the idempotency key, so a retry after a lost
 * response resolves to the original sale instead of ringing it twice.
 */
export async function pushRetailSale(
  sale: RetailSale,
  products: readonly RetailProduct[],
): Promise<PushResult> {
  const token = getToken();
  if (!token) return { ok: false, reason: "unauthorized" };
  const payload = buildSalePayload(sale, products);
  if (payload.lines.length === 0) return { ok: false, reason: "rejected" };

  try {
    const res = await fetch("/api/retail/sales", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        "Idempotency-Key": sale.id,
      },
      body: JSON.stringify(payload),
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, reason: "unauthorized" };
    }
    if (!res.ok) return { ok: false, reason: "rejected" };
    const body = (await res.json()) as {
      sale?: { id?: string };
      replayed?: boolean;
    };
    return {
      ok: true,
      serverId: String(body.sale?.id ?? ""),
      replayed: Boolean(body.replayed),
    };
  } catch {
    return { ok: false, reason: "offline" };
  }
}
