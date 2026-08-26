import { describe, expect, it, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  const state = {
    role: "staff" as string,
    capabilityEnabled: true,
    sales: [] as Array<{ id: string; key: string | null }>,
    lines: [] as Array<Record<string, unknown>>,
    movements: [] as Array<{ itemId: string; delta: number; reason: string }>,
    stockUpdates: [] as Array<{ itemId: string; qty: number }>,
  };
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");

    if (/SELECT vertical, tier FROM venues/i.test(text)) {
      return Promise.resolve([
        { vertical: state.capabilityEnabled ? "retail" : "restaurant", tier: "enterprise" },
      ]);
    }
    if (/FROM venue_capability_overrides/i.test(text)) return Promise.resolve([]);

    if (/INSERT INTO retail_sales/i.test(text)) {
      const key = (values[10] as string | null) ?? null;
      if (key && state.sales.some((s) => s.key === key)) return Promise.resolve([]);
      const id = `sale-${state.sales.length + 1}`;
      state.sales.push({ id, key });
      return Promise.resolve([{ id }]);
    }
    if (/INSERT INTO retail_sale_lines/i.test(text)) {
      state.lines.push({ saleId: values[1], name: values[3], qty: values[4] });
      return Promise.resolve([]);
    }
    if (/UPDATE inventory_items/i.test(text)) {
      state.stockUpdates.push({ itemId: String(values[2]), qty: Number(values[0]) });
      return Promise.resolve([]);
    }
    if (/INSERT INTO inventory_movements/i.test(text)) {
      state.movements.push({
        itemId: String(values[1]),
        delta: Number(values[2]),
        reason: String(values[3]),
      });
      return Promise.resolve([]);
    }
    if (/SELECT id FROM retail_sales[\s\S]*idempotency_key = \?/i.test(text)) {
      const key = String(values[1]);
      const found = state.sales.find((s) => s.key === key);
      return Promise.resolve(found ? [{ id: found.id }] : []);
    }
    if (/FROM retail_sales[\s\S]*AND id = \?/i.test(text)) {
      return Promise.resolve([
        {
          id: values[1],
          staff_id: null,
          customer_name: null,
          customer_phone: null,
          subtotal_minor: 58000,
          discount_minor: 0,
          total_minor: 58000,
          cost_minor: 45000,
          currency: "KES",
          payment_method: "cash",
          payment_id: null,
          status: "completed",
          created_at: "2026-08-24T10:00:00Z",
        },
      ]);
    }
    if (/FROM retail_sale_lines/i.test(text)) {
      return Promise.resolve([
        {
          name: "Maize flour 2kg",
          qty: 2,
          unit_price_minor: 18000,
          unit_cost_minor: 14000,
          total_minor: 36000,
          item_id: "11111111-1111-1111-1111-111111111111",
        },
      ]);
    }
    if (/FROM inventory_items[\s\S]*barcode = \?/i.test(text)) {
      return Promise.resolve([
        {
          id: "11111111-1111-1111-1111-111111111111",
          name: "Maize flour 2kg",
          sku: "MF2",
          barcode: "6161100000000",
          unit: "unit",
          price: 18000,
          cost: 14000,
          stock: 12,
          category: "Dry goods",
        },
      ]);
    }
    return Promise.resolve([]);
  }) as unknown as { begin: (fn: (tx: unknown) => Promise<unknown>) => Promise<unknown> };
  sql.begin = (fn) => fn(sql);
  return { state, sql };
});

vi.mock("../../src/lib/db", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, getSql: () => h.sql, hasDatabase: () => true };
});

vi.mock("../../src/api/auth", () => ({
  requireAuth: () =>
    Promise.resolve({ sub: "till@shop.test", role: h.state.role, venue: "v1" }),
}));

import { handleRetailRoute } from "../../src/api/retail";

const ITEM = "11111111-1111-1111-1111-111111111111";

const basket = [
  { itemId: ITEM, name: "Maize flour 2kg", qty: 2, unitPriceMinor: 18000, unitCostMinor: 14000 },
  { name: "Sugar 1kg", qty: 1, unitPriceMinor: 22000, unitCostMinor: 17000 },
];

const sell = (body: unknown, key?: string) =>
  handleRetailRoute(
    new Request("https://app.test/api/retail/sales", {
      method: "POST",
      body: JSON.stringify(body),
      ...(key ? { headers: { "Idempotency-Key": key } } : {}),
    }),
    {},
  );

beforeEach(() => {
  h.state.role = "staff";
  h.state.capabilityEnabled = true;
  h.state.sales = [];
  h.state.lines = [];
  h.state.movements = [];
  h.state.stockUpdates = [];
});

describe("capability gate", () => {
  it("refuses the counter when the venue has not enabled it", async () => {
    h.state.capabilityEnabled = false;
    const res = await sell({ lines: basket, paymentMethod: "cash" });
    expect(res!.status).toBe(403);
    expect(h.state.sales).toHaveLength(0);
  });
});

describe("ringing a sale", () => {
  it("records the sale, its lines and the stock movement together", async () => {
    const res = await sell({ lines: basket, paymentMethod: "cash" });
    expect(res!.status).toBe(201);
    expect(h.state.sales).toHaveLength(1);
    expect(h.state.lines).toHaveLength(2);
    // Only the catalogue-linked line moves stock; the ad-hoc line cannot.
    expect(h.state.movements).toEqual([
      { itemId: ITEM, delta: -2, reason: "sale:sale-1" },
    ]);
    expect(h.state.stockUpdates).toEqual([{ itemId: ITEM, qty: 2 }]);
  });

  it("lets a cashier sell", async () => {
    h.state.role = "staff";
    const res = await sell({ lines: basket, paymentMethod: "mpesa" });
    expect(res!.status).toBe(201);
  });

  it("rejects an empty basket without touching stock", async () => {
    const res = await sell({ lines: [], paymentMethod: "cash" });
    expect(res!.status).toBe(400);
    expect(h.state.movements).toHaveLength(0);
  });

  it("rejects an unsupported tender", async () => {
    const res = await sell({ lines: basket, paymentMethod: "cheque" });
    expect(res!.status).toBe(400);
    expect(h.state.sales).toHaveLength(0);
  });
});

describe("idempotency", () => {
  it("does not ring a double-tapped sale twice", async () => {
    const first = await sell({ lines: basket, paymentMethod: "cash" }, "till-tap-1");
    const second = await sell({ lines: basket, paymentMethod: "cash" }, "till-tap-1");

    expect(first!.status).toBe(201);
    expect(second!.status).toBe(200);
    expect((await second!.json()).replayed).toBe(true);
    expect(h.state.sales).toHaveLength(1);
    expect(h.state.movements).toHaveLength(1);
  });
});

describe("cost visibility", () => {
  it("hides cost and margin from a cashier", async () => {
    h.state.role = "staff";
    const res = await sell({ lines: basket, paymentMethod: "cash" });
    const body = (await res!.json()) as { sale: Record<string, unknown> };
    expect(body.sale.costMinor).toBeUndefined();
    expect(body.sale.marginMinor).toBeUndefined();
    expect((body.sale.lines as Array<Record<string, unknown>>)[0].unitCostMinor).toBeUndefined();
  });

  it("shows cost and margin to a manager", async () => {
    h.state.role = "manager";
    const res = await sell({ lines: basket, paymentMethod: "cash" });
    const body = (await res!.json()) as { sale: Record<string, unknown> };
    expect(body.sale.costMinor).toBe(45000);
    expect(body.sale.marginMinor).toBe(13000);
  });
});

describe("barcode lookup", () => {
  it("returns the price for a scanned barcode", async () => {
    const res = await handleRetailRoute(
      new Request("https://app.test/api/retail/lookup?barcode=6161100000000"),
      {},
    );
    const body = (await res!.json()) as { item: Record<string, unknown> };
    expect(body.item.priceMinor).toBe(18000);
    expect(body.item.costMinor).toBeUndefined();
  });

  it("requires a barcode or sku", async () => {
    const res = await handleRetailRoute(
      new Request("https://app.test/api/retail/lookup"),
      {},
    );
    expect(res!.status).toBe(400);
  });
});
