import { describe, expect, it } from "vitest";

import { buildSalePayload, toMinorUnits } from "../../src/lib/retail-sync";
import type {
  RetailProduct,
  RetailSale,
} from "../../src/components/merchant/features/types";

const UUID = "11111111-1111-1111-1111-111111111111";

const product = (over: Partial<RetailProduct> = {}): RetailProduct => ({
  id: "prod_local_1",
  name: "Maize flour 2kg",
  sku: "MF2",
  barcode: "6161100000000",
  category: "Dry goods",
  costPrice: 155,
  sellPrice: 180,
  stock: 12,
  reorderLevel: 4,
  unit: "pieces",
  isActive: true,
  createdAt: "2026-08-24T09:00:00Z",
  ...over,
});

const sale = (over: Partial<RetailSale> = {}): RetailSale => ({
  id: "sale_abc123",
  items: [
    { productId: "prod_local_1", name: "Maize flour 2kg", qty: 2, unitPrice: 180 },
  ],
  total: 360,
  paymentMethod: "cash",
  createdAt: "2026-08-24T10:00:00Z",
  ...over,
});

describe("money conversion", () => {
  it("converts whole shillings to minor units", () => {
    expect(toMinorUnits(180)).toBe(18000);
    expect(toMinorUnits(1)).toBe(100);
  });

  it("does not lose a cent on a fractional price", () => {
    expect(toMinorUnits(180.55)).toBe(18055);
    expect(toMinorUnits(0.29)).toBe(29);
  });

  it("treats nonsense as zero rather than NaN", () => {
    expect(toMinorUnits(Number.NaN)).toBe(0);
    expect(toMinorUnits(-50)).toBe(0);
  });
});

describe("sale payload", () => {
  it("sends prices and costs in minor units", () => {
    const payload = buildSalePayload(sale(), [product()]);
    expect(payload.lines[0].unitPriceMinor).toBe(18000);
    expect(payload.lines[0].unitCostMinor).toBe(15500);
    expect(payload.lines[0].qty).toBe(2);
  });

  it("never sends a local id as a catalogue foreign key", () => {
    const payload = buildSalePayload(sale(), [product()]);
    expect(payload.lines[0].itemId).toBeNull();
  });

  it("hands the server a sku and barcode to resolve instead", () => {
    const payload = buildSalePayload(sale(), [product()]);
    expect(payload.lines[0].sku).toBe("MF2");
    expect(payload.lines[0].barcode).toBe("6161100000000");
  });

  it("sends a real catalogue id straight through", () => {
    const payload = buildSalePayload(
      sale({
        items: [{ productId: UUID, name: "Maize flour 2kg", qty: 1, unitPrice: 180 }],
      }),
      [product({ id: UUID })],
    );
    expect(payload.lines[0].itemId).toBe(UUID);
    expect(payload.lines[0].sku).toBeUndefined();
  });

  it("carries the customer and M-Pesa reference when present", () => {
    const payload = buildSalePayload(
      sale({
        paymentMethod: "mpesa",
        customerName: "Achieng",
        customerPhone: "0712345678",
        mpesaRef: "PS123456",
      }),
      [product()],
    );
    expect(payload.paymentMethod).toBe("mpesa");
    expect(payload.customerName).toBe("Achieng");
    expect(payload.paymentId).toBe("PS123456");
  });

  it("drops a zero-quantity line rather than sending it", () => {
    const payload = buildSalePayload(
      sale({
        items: [{ productId: "prod_local_1", name: "Maize flour 2kg", qty: 0, unitPrice: 180 }],
      }),
      [product()],
    );
    expect(payload.lines).toHaveLength(0);
  });

  it("still records a line for a product missing from the catalogue", () => {
    const payload = buildSalePayload(sale(), []);
    expect(payload.lines).toHaveLength(1);
    expect(payload.lines[0].unitCostMinor).toBe(0);
  });
});
