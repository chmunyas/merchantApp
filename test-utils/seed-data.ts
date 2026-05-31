/**
 * Test seed data factories for PesaSwap
 * Use these to create consistent test data across all test files
 */

export function createTable(overrides: Partial<any> = {}) {
  return {
    id: `tbl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    tableNumber: 1,
    server: "Grace M.",
    items: [
      { id: "i1", name: "Nyama Choma (500g)", price: 850, qty: 1, category: "Main" },
      { id: "i2", name: "Pilau Rice", price: 350, qty: 1, category: "Main" },
      { id: "i3", name: "Tusker Lager", price: 280, qty: 2, category: "Drink" },
    ],
    status: "open" as const,
    openedAt: new Date().toISOString(),
    closedAt: undefined,
    paidAmount: 0,
    payments: [],
    quickCharge: undefined,
    ...overrides,
  };
}

export function createPayment(overrides: Partial<any> = {}) {
  return {
    name: "John K.",
    amount: 1500,
    tip: 150,
    phone: "0712345678",
    time: new Date().toISOString(),
    ...overrides,
  };
}

export function createInvoice(overrides: Partial<any> = {}) {
  return {
    id: `INV-${Math.floor(10000 + Math.random() * 90000)}`,
    client: "Acme Trading Ltd",
    amount: 25000,
    currency: "KES",
    status: "Pending" as const,
    createdAt: new Date().toISOString(),
    dueDate: new Date(Date.now() + 7 * 86400000).toISOString(),
    paidVia: "",
    partialPayments: [],
    timeline: [],
    recurring: null,
    fxLock: null,
    installmentPlan: null,
    ...overrides,
  };
}

export function createCatalogueItem(overrides: Partial<any> = {}) {
  return {
    id: `cat-${Date.now()}`,
    name: "Test Item",
    price: 500,
    category: "Main",
    ...overrides,
  };
}

/**
 * Returns a full seed dataset for testing
 */
export function seedFullDataset() {
  const tables = [
    createTable({ tableNumber: 1, server: "Grace M.", status: "open" }),
    createTable({ tableNumber: 2, server: "Alice N.", status: "open", paidAmount: 500, payments: [createPayment({ amount: 500, tip: 50 })] }),
    createTable({ tableNumber: 3, server: "Peter K.", status: "requesting-bill" }),
    createTable({ tableNumber: 4, server: "Grace M.", status: "closed", closedAt: new Date().toISOString(), paidAmount: 2000, payments: [createPayment({ amount: 2000, tip: 200 })] }),
    createTable({ tableNumber: 5, server: "Alice N.", status: "partially-paid", paidAmount: 800, payments: [createPayment({ amount: 800, tip: 80 })] }),
  ];

  const invoices = [
    createInvoice({ status: "Paid", paidVia: "M-Pesa" }),
    createInvoice({ status: "Pending" }),
    createInvoice({ status: "Overdue", dueDate: new Date(Date.now() - 3 * 86400000).toISOString() }),
    createInvoice({ status: "Partial", partialPayments: [{ id: "pp1", amount: 10000, paidAt: new Date().toISOString(), paidVia: "M-Pesa" }] }),
  ];

  const catalogue = [
    createCatalogueItem({ id: "m1", name: "Nyama Choma (500g)", price: 850, category: "Main" }),
    createCatalogueItem({ id: "m2", name: "Pilau Rice", price: 350, category: "Main" }),
    createCatalogueItem({ id: "m3", name: "Fish Fry", price: 650, category: "Main" }),
    createCatalogueItem({ id: "m4", name: "Ugali", price: 100, category: "Side" }),
    createCatalogueItem({ id: "m5", name: "Sukuma Wiki", price: 80, category: "Side" }),
    createCatalogueItem({ id: "m6", name: "Chapati", price: 50, category: "Side" }),
    createCatalogueItem({ id: "m7", name: "Tusker Lager", price: 280, category: "Drink" }),
    createCatalogueItem({ id: "m8", name: "Coca Cola", price: 100, category: "Drink" }),
    createCatalogueItem({ id: "m9", name: "Fresh Juice", price: 200, category: "Drink" }),
    createCatalogueItem({ id: "m10", name: "Mandazi (3pc)", price: 80, category: "Dessert" }),
  ];

  return { tables, invoices, catalogue };
}
