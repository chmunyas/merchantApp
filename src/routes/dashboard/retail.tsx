import { Link, createFileRoute } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BarChart3,
  Building2,
  Boxes,
  ClipboardList,
  CreditCard,
  Download,
  HandCoins,
  PackagePlus,
  Plus,
  Search,
  ShoppingCart,
  Smartphone,
  Store,
  Truck,
  UserRound,
  Wallet,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type {
  BNPLTransaction,
  CreditCustomer,
  CreditEntry,
  PurchaseOrder,
  RetailProduct,
  RetailSale,
  StockAdjustment,
  Supplier,
} from "@/components/merchant/features/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BNPLCheckout } from "@/components/merchant/features/BNPLCheckout";
import {
  ensureRetailDemoData,
  getCreditAging,
  getLowStockProducts,
  getRetailAnalytics,
  getRetailStoreSlug,
  loadRetailSnapshot,
  saveCreditCustomers,
  savePurchaseOrders,
  saveRetailProducts,
  saveRetailSales,
  saveRetailStoreProfile,
  saveRetailSuppliers,
  saveStockAdjustments,
  type RetailSnapshot,
  type RetailStoreProfile,
} from "@/lib/merchant-dashboard";
import { pushRetailSale } from "@/lib/retail-sync";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/retail")({
  component: RetailDashboardPage,
});

type RetailTab = "products" | "inventory" | "sales" | "credit" | "suppliers";
type SaleCartItem = {
  productId: string;
  name: string;
  image?: string;
  unitPrice: number;
  qty: number;
  stock: number;
  sku: string;
};
type PaymentMethod = "mpesa" | "cash" | "bnpl";
type ProductForm = {
  id?: string;
  name: string;
  sku: string;
  barcode: string;
  category: string;
  costPrice: string;
  sellPrice: string;
  stock: string;
  reorderLevel: string;
  supplier: string;
  supplierPhone: string;
  unit: RetailProduct["unit"];
  image?: string;
  isActive: boolean;
};
type StockAdjustmentForm = {
  productId: string;
  type: StockAdjustment["type"];
  quantity: string;
  direction: "add" | "remove";
  reason: string;
};
type CreditCustomerForm = {
  name: string;
  phone: string;
  creditLimit: string;
};
type CreditPaymentForm = {
  customerId: string;
  amount: string;
  description: string;
};
type PurchaseOrderDraft = {
  supplierId: string;
  status: PurchaseOrder["status"];
  items: Array<{ productId: string; qty: string; unitCost: string }>;
};

type ReceiptPreview = {
  title: string;
  message: string;
};

const currency = new Intl.NumberFormat("en-KE", {
  style: "currency",
  currency: "KES",
  maximumFractionDigits: 0,
});

const paymentPieColors = ["#2563eb", "#10b981", "#dc2626", "#003DA5"];
const tabs: Array<{ value: RetailTab; label: string; icon: typeof Store }> = [
  { value: "products", label: "Products", icon: Store },
  { value: "inventory", label: "Inventory", icon: Boxes },
  { value: "sales", label: "Sales History", icon: BarChart3 },
  { value: "credit", label: "Credit Book", icon: HandCoins },
  { value: "suppliers", label: "Suppliers & PO", icon: Truck },
];
const units: RetailProduct["unit"][] = [
  "pieces",
  "kg",
  "litres",
  "packets",
  "boxes",
  "metres",
];

function formatDate(value?: string) {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-KE", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDateInput(value?: string) {
  if (!value) return "";
  return value.slice(0, 10);
}

function createId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function createSku(name: string, category: string) {
  const bits = `${category.slice(0, 3)}-${name}`
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .split("-")
    .filter(Boolean);
  return bits.slice(0, 3).join("-") || `SKU-${Date.now().toString().slice(-4)}`;
}

function getStockTone(stock: number) {
  if (stock <= 2) return "red";
  if (stock <= 10) return "amber";
  return "green";
}

function marginPercentage(costPrice: number, sellPrice: number) {
  if (!costPrice) return 0;
  return ((sellPrice - costPrice) / costPrice) * 100;
}

function clampSaleQty(requested: number, productStock: number) {
  return Math.max(0, Math.min(requested, productStock));
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to read image."));
    reader.readAsDataURL(file);
  });
}

function defaultProductForm(category = "Groceries"): ProductForm {
  return {
    name: "",
    sku: "",
    barcode: "",
    category,
    costPrice: "",
    sellPrice: "",
    stock: "0",
    reorderLevel: "5",
    supplier: "",
    supplierPhone: "",
    unit: "pieces",
    image: "",
    isActive: true,
  };
}

function defaultAdjustmentForm(productId = ""): StockAdjustmentForm {
  return {
    productId,
    type: "received",
    quantity: "1",
    direction: "add",
    reason: "",
  };
}

function defaultCreditCustomerForm(): CreditCustomerForm {
  return { name: "", phone: "", creditLimit: "5000" };
}

function defaultPaymentForm(): CreditPaymentForm {
  return { customerId: "", amount: "", description: "Repayment" };
}

function defaultPurchaseOrderDraft(): PurchaseOrderDraft {
  return {
    supplierId: "",
    status: "draft",
    items: [{ productId: "", qty: "1", unitCost: "0" }],
  };
}

function buildReceiptMessage(
  profile: RetailStoreProfile,
  sale: RetailSale,
  channelPhone: string,
) {
  const items = sale.items
    .map((item) => `${item.name} x${item.qty}`)
    .join(", ");
  return `${profile.name}\nSale: ${items}\nTotal: ${currency.format(sale.total)}\nPaid via ${sale.paymentMethod.toUpperCase()}${sale.mpesaRef ? ` (${sale.mpesaRef})` : ""}\nReceipt to: ${channelPhone || sale.customerPhone || "Walk-in"}\n${profile.receiptFooter}`;
}

function buildReminderMessage(
  customer: CreditCustomer,
  outstanding: number,
  oldestDays: number,
) {
  return `Habari ${customer.name}, kumbusho kutoka duka la PesaSwap. Una deni la ${currency.format(outstanding)} lililo kaa siku ${oldestDays}. Tafadhali lipa kupitia M-Pesa ama ututembelee dukani. Asante.`;
}

function SalePanel({
  items,
  customerName,
  customerPhone,
  receiptPhone,
  onCustomerNameChange,
  onCustomerPhoneChange,
  onReceiptPhoneChange,
  onQtyChange,
  onRemove,
  onCharge,
  onCredit,
  total,
  profile,
}: {
  items: SaleCartItem[];
  customerName: string;
  customerPhone: string;
  receiptPhone: string;
  onCustomerNameChange: (value: string) => void;
  onCustomerPhoneChange: (value: string) => void;
  onReceiptPhoneChange: (value: string) => void;
  onQtyChange: (productId: string, delta: number) => void;
  onRemove: (productId: string) => void;
  onCharge: () => void;
  onCredit: () => void;
  total: number;
  profile: RetailStoreProfile | null;
}) {
  return (
    <Card className="overflow-hidden border-blue-100 shadow-sm">
      <CardHeader className="bg-blue-50/80">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-lg">Active sale</CardTitle>
            <CardDescription>
              Fast counter checkout for {profile?.name || "your duka"}
            </CardDescription>
          </div>
          <div className="rounded-2xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white">
            {currency.format(total)}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 p-4">
        {items.length ? (
          <div className="space-y-3">
            {items.map((item) => (
              <div
                key={item.productId}
                className="rounded-2xl border border-border bg-white p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{item.name}</p>
                    <p className="text-xs text-muted-foreground">{item.sku}</p>
                  </div>
                  <button
                    type="button"
                    className="text-xs font-medium text-red-600"
                    onClick={() => onRemove(item.productId)}
                  >
                    Remove
                  </button>
                </div>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <div className="inline-flex items-center rounded-full border border-border bg-slate-50">
                    <button
                      type="button"
                      className="px-3 py-2 text-lg"
                      onClick={() => onQtyChange(item.productId, -1)}
                    >
                      −
                    </button>
                    <span className="min-w-12 px-2 text-center text-sm font-semibold">
                      {item.qty}
                    </span>
                    <button
                      type="button"
                      className="px-3 py-2 text-lg"
                      onClick={() => onQtyChange(item.productId, 1)}
                    >
                      +
                    </button>
                  </div>
                  <div className="text-right text-sm">
                    <p className="font-semibold">
                      {currency.format(item.unitPrice * item.qty)}
                    </p>
                    <p className="text-muted-foreground">
                      {currency.format(item.unitPrice)} each
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Add products from the POS grid to begin a sale.
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-2 text-sm">
            <span className="font-medium">Customer name</span>
            <Input
              placeholder="Optional"
              value={customerName}
              onChange={(event) => onCustomerNameChange(event.target.value)}
            />
          </label>
          <label className="space-y-2 text-sm">
            <span className="font-medium">Customer phone</span>
            <Input
              placeholder="07xx xxx xxx"
              value={customerPhone}
              onChange={(event) => onCustomerPhoneChange(event.target.value)}
            />
          </label>
        </div>

        <label className="space-y-2 text-sm">
          <span className="font-medium">Receipt phone (SMS / WhatsApp)</span>
          <Input
            placeholder="Number to send receipt"
            value={receiptPhone}
            onChange={(event) => onReceiptPhoneChange(event.target.value)}
          />
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <Button
            className="h-12 rounded-2xl bg-emerald-600 text-base hover:bg-emerald-700"
            disabled={!items.length}
            onClick={onCharge}
          >
            <Wallet className="mr-2 h-4 w-4" /> Charge
          </Button>
          <Button
            variant="outline"
            className="h-12 rounded-2xl border-red-200 text-base text-red-600 hover:bg-red-50"
            disabled={!items.length}
            onClick={onCredit}
          >
            <HandCoins className="mr-2 h-4 w-4" /> On Credit
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function RetailDashboardPage() {
  const [activeTab, setActiveTab] = useState<RetailTab>("products");
  const [snapshotLoaded, setSnapshotLoaded] = useState(false);
  const [storeProfile, setStoreProfile] = useState<RetailStoreProfile | null>(
    null,
  );
  const [products, setProducts] = useState<RetailProduct[]>([]);
  const [sales, setSales] = useState<RetailSale[]>([]);
  const [adjustments, setAdjustments] = useState<StockAdjustment[]>([]);
  const [creditCustomers, setCreditCustomers] = useState<CreditCustomer[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [productQuery, setProductQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [barcodeEntry, setBarcodeEntry] = useState("");
  const [saleItems, setSaleItems] = useState<SaleCartItem[]>([]);
  const [saleCustomerName, setSaleCustomerName] = useState("");
  const [saleCustomerPhone, setSaleCustomerPhone] = useState("");
  const [receiptPhone, setReceiptPhone] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("mpesa");
  const [mpesaPhone, setMpesaPhone] = useState("");
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [saleSheetOpen, setSaleSheetOpen] = useState(false);
  const [productModalOpen, setProductModalOpen] = useState(false);
  const [productForm, setProductForm] =
    useState<ProductForm>(defaultProductForm());
  const [adjustmentModalOpen, setAdjustmentModalOpen] = useState(false);
  const [adjustmentForm, setAdjustmentForm] = useState<StockAdjustmentForm>(
    defaultAdjustmentForm(),
  );
  const [creditCustomerModalOpen, setCreditCustomerModalOpen] = useState(false);
  const [creditCustomerForm, setCreditCustomerForm] =
    useState<CreditCustomerForm>(defaultCreditCustomerForm());
  const [creditPaymentModalOpen, setCreditPaymentModalOpen] = useState(false);
  const [creditPaymentForm, setCreditPaymentForm] =
    useState<CreditPaymentForm>(defaultPaymentForm());
  const [purchaseOrderModalOpen, setPurchaseOrderModalOpen] = useState(false);
  const [purchaseOrderDraft, setPurchaseOrderDraft] =
    useState<PurchaseOrderDraft>(defaultPurchaseOrderDraft());
  const [salesStartDate, setSalesStartDate] = useState("");
  const [salesEndDate, setSalesEndDate] = useState("");
  const [salesPaymentFilter, setSalesPaymentFilter] = useState("all");
  const [salesProductFilter, setSalesProductFilter] = useState("all");
  const [salesCustomerFilter, setSalesCustomerFilter] = useState("");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [receiptPreview, setReceiptPreview] = useState<ReceiptPreview | null>(
    null,
  );
  const [clipboardMessage, setClipboardMessage] = useState<string | null>(null);

  useEffect(() => {
    const snapshot = ensureRetailDemoData();
    hydrateSnapshot(snapshot);
  }, []);

  useEffect(() => {
    if (!snapshotLoaded || !storeProfile) return;
    saveRetailStoreProfile(storeProfile);
    saveRetailProducts(products);
    saveRetailSales(sales);
    saveStockAdjustments(adjustments);
    saveCreditCustomers(creditCustomers);
    saveRetailSuppliers(suppliers);
    savePurchaseOrders(purchaseOrders);
  }, [
    adjustments,
    creditCustomers,
    products,
    purchaseOrders,
    sales,
    snapshotLoaded,
    storeProfile,
    suppliers,
  ]);

  useEffect(() => {
    if (!barcodeEntry.trim()) return;
    const match = products.find(
      (product) => product.barcode === barcodeEntry.trim(),
    );
    if (match) {
      addProductToSale(match);
      setBarcodeEntry("");
      setStatusMessage(`Added ${match.name} from barcode scan.`);
    }
  }, [barcodeEntry, products]);

  function hydrateSnapshot(snapshot: RetailSnapshot) {
    setStoreProfile(snapshot.storeProfile);
    setProducts(snapshot.products);
    setSales(
      snapshot.sales.sort(
        (a, b) => +new Date(b.createdAt) - +new Date(a.createdAt),
      ),
    );
    setAdjustments(
      snapshot.adjustments.sort(
        (a, b) => +new Date(b.createdAt) - +new Date(a.createdAt),
      ),
    );
    setCreditCustomers(snapshot.creditCustomers);
    setSuppliers(snapshot.suppliers);
    setPurchaseOrders(
      snapshot.purchaseOrders.sort(
        (a, b) => +new Date(b.createdAt) - +new Date(a.createdAt),
      ),
    );
    setSnapshotLoaded(true);
  }

  const categories = useMemo(
    () => ["All", ...new Set(products.map((product) => product.category))],
    [products],
  );
  const filteredProducts = useMemo(() => {
    const query = productQuery.trim().toLowerCase();
    return products.filter((product) => {
      const matchesQuery =
        !query ||
        product.name.toLowerCase().includes(query) ||
        product.sku.toLowerCase().includes(query) ||
        product.barcode?.toLowerCase().includes(query);
      const matchesCategory =
        categoryFilter === "All" || product.category === categoryFilter;
      return product.isActive && matchesQuery && matchesCategory;
    });
  }, [categoryFilter, productQuery, products]);
  const saleTotal = useMemo(
    () => saleItems.reduce((sum, item) => sum + item.unitPrice * item.qty, 0),
    [saleItems],
  );
  const analytics = useMemo(
    () => getRetailAnalytics(sales, products),
    [products, sales],
  );
  const lowStock = useMemo(() => getLowStockProducts(products), [products]);
  const creditAging = useMemo(
    () => getCreditAging(creditCustomers),
    [creditCustomers],
  );
  const inventorySummary = useMemo(() => {
    const totalCostValue = products.reduce(
      (sum, product) => sum + product.costPrice * product.stock,
      0,
    );
    const totalRetailValue = products.reduce(
      (sum, product) => sum + product.sellPrice * product.stock,
      0,
    );
    return {
      totalCostValue,
      totalRetailValue,
      potentialProfit: totalRetailValue - totalCostValue,
    };
  }, [products]);
  const filteredSales = useMemo(() => {
    return sales.filter((sale) => {
      const createdAt = new Date(sale.createdAt).getTime();
      const startMatch = salesStartDate
        ? createdAt >= new Date(`${salesStartDate}T00:00:00`).getTime()
        : true;
      const endMatch = salesEndDate
        ? createdAt <= new Date(`${salesEndDate}T23:59:59`).getTime()
        : true;
      const paymentMatch =
        salesPaymentFilter === "all" ||
        sale.paymentMethod === salesPaymentFilter;
      const productMatch =
        salesProductFilter === "all" ||
        sale.items.some((item) => item.productId === salesProductFilter);
      const customerQuery = salesCustomerFilter.trim().toLowerCase();
      const customerMatch =
        !customerQuery ||
        sale.customerName?.toLowerCase().includes(customerQuery) ||
        sale.customerPhone?.toLowerCase().includes(customerQuery);
      return (
        startMatch &&
        endMatch &&
        paymentMatch &&
        productMatch &&
        Boolean(customerMatch)
      );
    });
  }, [
    sales,
    salesCustomerFilter,
    salesEndDate,
    salesPaymentFilter,
    salesProductFilter,
    salesStartDate,
  ]);
  const publicStoreId = storeProfile
    ? getRetailStoreSlug(storeProfile)
    : "retail";
  const purchaseOrderRows = purchaseOrderDraft.items;

  function addProductToSale(product: RetailProduct) {
    if (product.stock <= 0) {
      setStatusMessage(`${product.name} is out of stock.`);
      return;
    }
    setSaleItems((current) => {
      const existing = current.find((item) => item.productId === product.id);
      if (existing) {
        return current.map((item) =>
          item.productId === product.id
            ? {
                ...item,
                qty: clampSaleQty(item.qty + 1, product.stock),
                stock: product.stock,
              }
            : item,
        );
      }
      return [
        ...current,
        {
          productId: product.id,
          name: product.name,
          image: product.image,
          unitPrice: product.sellPrice,
          qty: 1,
          stock: product.stock,
          sku: product.sku,
        },
      ];
    });
    setSaleSheetOpen(true);
  }

  function updateSaleQty(productId: string, delta: number) {
    const product = products.find((entry) => entry.id === productId);
    if (!product) return;
    setSaleItems((current) =>
      current
        .map((item) =>
          item.productId === productId
            ? {
                ...item,
                qty: clampSaleQty(item.qty + delta, product.stock),
              }
            : item,
        )
        .filter((item) => item.qty > 0),
    );
  }

  function removeSaleItem(productId: string) {
    setSaleItems((current) =>
      current.filter((item) => item.productId !== productId),
    );
  }

  function resetSale() {
    setSaleItems([]);
    setSaleCustomerName("");
    setSaleCustomerPhone("");
    setReceiptPhone("");
    setMpesaPhone("");
    setPaymentMethod("mpesa");
    setPaymentOpen(false);
  }

  function syncCustomerBalance(customers: CreditCustomer[]) {
    return customers.map((customer) => ({
      ...customer,
      balance: customer.entries.reduce((sum, entry) => {
        return entry.type === "purchase"
          ? sum + entry.amount
          : sum - entry.amount;
      }, 0),
    }));
  }

  function completeSale(
    method: RetailSale["paymentMethod"],
    overrides?: {
      bnplTransaction?: BNPLTransaction;
      customerName?: string;
      customerPhone?: string;
    },
  ) {
    if (!storeProfile || !saleItems.length) return;
    const productMap = new Map(
      products.map((product) => [product.id, product]),
    );
    const insufficient = saleItems.find((item) => {
      const product = productMap.get(item.productId);
      return !product || product.stock < item.qty;
    });
    if (insufficient) {
      setStatusMessage(`${insufficient.name} no longer has enough stock.`);
      return;
    }
    if (method === "mpesa" && !mpesaPhone.trim()) {
      setStatusMessage("Enter an M-Pesa number to trigger checkout.");
      return;
    }
    if (method === "credit" && !saleCustomerName.trim()) {
      setStatusMessage("Capture customer name before recording credit.");
      return;
    }

    const sale: RetailSale = {
      id: createId("sale"),
      items: saleItems.map((item) => ({
        productId: item.productId,
        name: item.name,
        qty: item.qty,
        unitPrice: item.unitPrice,
      })),
      total: saleTotal,
      paymentMethod: method,
      customerName:
        overrides?.customerName || saleCustomerName.trim() || undefined,
      customerPhone:
        (method === "mpesa"
          ? mpesaPhone
          : overrides?.customerPhone || saleCustomerPhone
        ).trim() || undefined,
      mpesaRef:
        method === "mpesa" ? `PS${Date.now().toString().slice(-6)}` : undefined,
      createdAt: new Date().toISOString(),
    };

    const nextProducts = products.map((product) => {
      const soldItem = saleItems.find((item) => item.productId === product.id);
      if (!soldItem) return product;
      return { ...product, stock: product.stock - soldItem.qty };
    });
    const newAdjustments: StockAdjustment[] = saleItems.map((item) => ({
      id: createId("adj"),
      productId: item.productId,
      type: "sold",
      quantity: -item.qty,
      reason: `Sale ${sale.id}`,
      createdAt: sale.createdAt,
    }));

    let nextCreditCustomers = creditCustomers;
    if (method === "credit") {
      const lookupName = saleCustomerName.trim().toLowerCase();
      const lookupPhone = saleCustomerPhone.trim();
      const existingCustomer = creditCustomers.find(
        (customer) =>
          customer.name.toLowerCase() === lookupName ||
          (lookupPhone && customer.phone === lookupPhone),
      );
      const creditEntry: CreditEntry = {
        id: createId("credit"),
        type: "purchase",
        amount: sale.total,
        description: `${sale.items.length} POS items sold on credit`,
        date: sale.createdAt,
        dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10),
        saleId: sale.id,
      };
      const customer =
        existingCustomer ||
        ({
          id: createId("customer"),
          name: saleCustomerName.trim(),
          phone: lookupPhone || "Pending phone",
          creditLimit: 5000,
          balance: 0,
          entries: [],
          createdAt: sale.createdAt,
        } satisfies CreditCustomer);
      if (customer.balance + sale.total > customer.creditLimit) {
        setStatusMessage(
          `${customer.name} is above the suggested credit limit. Sale still recorded for follow-up.`,
        );
      }
      nextCreditCustomers = syncCustomerBalance(
        existingCustomer
          ? creditCustomers.map((entry) =>
              entry.id === existingCustomer.id
                ? { ...entry, entries: [...entry.entries, creditEntry] }
                : entry,
            )
          : [...creditCustomers, { ...customer, entries: [creditEntry] }],
      );
      setCreditCustomers(nextCreditCustomers);
    }

    setProducts(nextProducts);
    setSales((current) => [sale, ...current]);
    setAdjustments((current) => [...newAdjustments, ...current]);

    // Mirror the sale into the server ledger so takings and stock survive this
    // browser and are visible on every other till. Local state is not blocked on
    // it: a shop must keep selling when the network is down.
    void pushRetailSale(sale, nextProducts).then((result) => {
      if (!result.ok && result.reason === "offline") {
        setStatusMessage(
          "Sale recorded on this device — it will need re-syncing while offline.",
        );
      }
    });

    if (method !== "credit") {
      setStatusMessage(
        method === "mpesa"
          ? `M-Pesa STK push sent to ${mpesaPhone}.`
          : method === "bnpl"
            ? `Co-op BNPL approved${overrides?.bnplTransaction?.coopReference ? ` · ${overrides.bnplTransaction.coopReference}` : ""}.`
            : "Cash sale recorded successfully.",
      );
    }
    setReceiptPreview({
      title: `Receipt · ${sale.id}`,
      message: buildReceiptMessage(storeProfile, sale, receiptPhone.trim()),
    });
    resetSale();
  }

  function saveProduct() {
    const name = productForm.name.trim();
    if (!name) {
      setStatusMessage("Product name is required.");
      return;
    }
    const costPrice = Number(productForm.costPrice || 0);
    const sellPrice = Number(productForm.sellPrice || 0);
    const stock = Number(productForm.stock || 0);
    const reorderLevel = Number(productForm.reorderLevel || 0);
    const now = new Date().toISOString();
    const nextProduct: RetailProduct = {
      id: productForm.id || createId("product"),
      name,
      sku: productForm.sku || createSku(name, productForm.category),
      barcode: productForm.barcode || undefined,
      category: productForm.category,
      costPrice,
      sellPrice,
      stock,
      reorderLevel,
      supplier: productForm.supplier || undefined,
      supplierPhone: productForm.supplierPhone || undefined,
      unit: productForm.unit,
      image: productForm.image || undefined,
      isActive: productForm.isActive,
      lastRestocked: stock > 0 ? now : undefined,
      createdAt: productForm.id
        ? products.find((entry) => entry.id === productForm.id)?.createdAt ||
          now
        : now,
    };
    setProducts((current) => {
      const exists = current.some((entry) => entry.id === nextProduct.id);
      return exists
        ? current.map((entry) =>
            entry.id === nextProduct.id ? nextProduct : entry,
          )
        : [nextProduct, ...current];
    });
    setProductModalOpen(false);
    setProductForm(defaultProductForm(nextProduct.category));
    setStatusMessage(`${nextProduct.name} saved in inventory.`);
  }

  function openEditProduct(product: RetailProduct) {
    setProductForm({
      id: product.id,
      name: product.name,
      sku: product.sku,
      barcode: product.barcode || "",
      category: product.category,
      costPrice: String(product.costPrice),
      sellPrice: String(product.sellPrice),
      stock: String(product.stock),
      reorderLevel: String(product.reorderLevel),
      supplier: product.supplier || "",
      supplierPhone: product.supplierPhone || "",
      unit: product.unit,
      image: product.image,
      isActive: product.isActive,
    });
    setProductModalOpen(true);
  }

  function applyStockAdjustment() {
    const product = products.find(
      (entry) => entry.id === adjustmentForm.productId,
    );
    const quantity = Number(adjustmentForm.quantity || 0);
    if (!product || quantity <= 0) {
      setStatusMessage(
        "Select a product and quantity for the stock adjustment.",
      );
      return;
    }
    const signedQuantity =
      adjustmentForm.direction === "add" ? quantity : -quantity;
    const nextStock = Math.max(0, product.stock + signedQuantity);
    setProducts((current) =>
      current.map((entry) =>
        entry.id === product.id
          ? {
              ...entry,
              stock: nextStock,
              lastRestocked:
                signedQuantity > 0
                  ? new Date().toISOString()
                  : entry.lastRestocked,
            }
          : entry,
      ),
    );
    setAdjustments((current) => [
      {
        id: createId("adj"),
        productId: product.id,
        type: adjustmentForm.type,
        quantity: signedQuantity,
        reason: adjustmentForm.reason || adjustmentForm.type,
        createdAt: new Date().toISOString(),
      },
      ...current,
    ]);
    setAdjustmentModalOpen(false);
    setAdjustmentForm(defaultAdjustmentForm());
    setStatusMessage(`Stock updated for ${product.name}.`);
  }

  function exportSalesCsv() {
    const rows = [
      [
        "Date",
        "Sale ID",
        "Items",
        "Total",
        "Payment Method",
        "Customer",
        "Phone",
      ],
      ...filteredSales.map((sale) => [
        formatDate(sale.createdAt),
        sale.id,
        sale.items.map((item) => `${item.name} x${item.qty}`).join(" | "),
        String(sale.total),
        sale.paymentMethod,
        sale.customerName || "Walk-in",
        sale.customerPhone || "",
      ]),
    ];
    const csv = rows
      .map((row) =>
        row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(","),
      )
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `retail-sales-${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function refundSale(sale: RetailSale) {
    if (sale.refunded) return;
    setSales((current) =>
      current.map((entry) =>
        entry.id === sale.id ? { ...entry, refunded: true } : entry,
      ),
    );
    setProducts((current) =>
      current.map((product) => {
        const returned = sale.items.find(
          (item) => item.productId === product.id,
        );
        return returned
          ? { ...product, stock: product.stock + returned.qty }
          : product;
      }),
    );
    setAdjustments((current) => [
      ...sale.items.map((item) => ({
        id: createId("adj"),
        productId: item.productId,
        type: "returned" as const,
        quantity: item.qty,
        reason: `Refund ${sale.id}`,
        createdAt: new Date().toISOString(),
      })),
      ...current,
    ]);
    if (sale.paymentMethod === "credit") {
      const nextCustomers = syncCustomerBalance(
        creditCustomers.map((customer) => {
          const matchingEntry = customer.entries.find(
            (entry) => entry.saleId === sale.id,
          );
          if (!matchingEntry) return customer;
          return {
            ...customer,
            entries: [
              ...customer.entries,
              {
                id: createId("credit"),
                type: "payment",
                amount: matchingEntry.amount,
                description: `Refund reversal for ${sale.id}`,
                date: new Date().toISOString(),
                saleId: sale.id,
              },
            ],
          };
        }),
      );
      setCreditCustomers(nextCustomers);
    }
    setStatusMessage(`Refund recorded and stock restored for ${sale.id}.`);
  }

  async function copyToClipboard(message: string, successText: string) {
    try {
      await navigator.clipboard.writeText(message);
      setClipboardMessage(successText);
    } catch {
      setClipboardMessage(
        "Clipboard permission unavailable. Copy manually below.",
      );
    }
  }

  function addCreditCustomer() {
    const name = creditCustomerForm.name.trim();
    const phone = creditCustomerForm.phone.trim();
    if (!name || !phone) {
      setStatusMessage("Credit customer needs a name and phone.");
      return;
    }
    setCreditCustomers((current) => [
      {
        id: createId("customer"),
        name,
        phone,
        creditLimit: Number(creditCustomerForm.creditLimit || 0),
        balance: 0,
        entries: [],
        createdAt: new Date().toISOString(),
      },
      ...current,
    ]);
    setCreditCustomerModalOpen(false);
    setCreditCustomerForm(defaultCreditCustomerForm());
    setStatusMessage(`${name} added to credit book.`);
  }

  function recordCreditPayment() {
    const amount = Number(creditPaymentForm.amount || 0);
    if (!creditPaymentForm.customerId || amount <= 0) {
      setStatusMessage("Choose a customer and valid amount.");
      return;
    }
    setCreditCustomers((current) =>
      syncCustomerBalance(
        current.map((customer) =>
          customer.id === creditPaymentForm.customerId
            ? {
                ...customer,
                entries: [
                  ...customer.entries,
                  {
                    id: createId("credit"),
                    type: "payment",
                    amount,
                    description: creditPaymentForm.description || "Repayment",
                    date: new Date().toISOString(),
                  },
                ],
              }
            : customer,
        ),
      ),
    );
    setCreditPaymentModalOpen(false);
    setCreditPaymentForm(defaultPaymentForm());
    setStatusMessage("Credit payment recorded.");
  }

  function createPurchaseOrder() {
    const supplier = suppliers.find(
      (entry) => entry.id === purchaseOrderDraft.supplierId,
    );
    if (!supplier) {
      setStatusMessage("Select a supplier to create a purchase order.");
      return;
    }
    const items = purchaseOrderDraft.items
      .map((item) => {
        const product = products.find((entry) => entry.id === item.productId);
        if (!product || Number(item.qty || 0) <= 0) return null;
        return {
          productId: product.id,
          name: product.name,
          qty: Number(item.qty),
          unitCost: Number(item.unitCost || product.costPrice),
        };
      })
      .filter((item): item is PurchaseOrder["items"][number] => Boolean(item));
    if (!items.length) {
      setStatusMessage("Add at least one product to the purchase order.");
      return;
    }
    const purchaseOrder: PurchaseOrder = {
      id: createId("po"),
      supplierId: supplier.id,
      supplierName: supplier.name,
      items,
      total: items.reduce((sum, item) => sum + item.qty * item.unitCost, 0),
      status: purchaseOrderDraft.status,
      createdAt: new Date().toISOString(),
      receivedAt:
        purchaseOrderDraft.status === "received" ||
        purchaseOrderDraft.status === "paid"
          ? new Date().toISOString()
          : undefined,
      paidAt:
        purchaseOrderDraft.status === "paid"
          ? new Date().toISOString()
          : undefined,
    };
    setPurchaseOrders((current) => [purchaseOrder, ...current]);
    setSuppliers((current) =>
      current.map((entry) =>
        entry.id === supplier.id
          ? { ...entry, lastOrderDate: purchaseOrder.createdAt }
          : entry,
      ),
    );
    setPurchaseOrderModalOpen(false);
    setPurchaseOrderDraft(defaultPurchaseOrderDraft());
    setStatusMessage(`Purchase order ${purchaseOrder.id} created.`);
  }

  function updatePurchaseOrderStatus(
    purchaseOrderId: string,
    status: PurchaseOrder["status"],
  ) {
    setPurchaseOrders((current) =>
      current.map((purchaseOrder) =>
        purchaseOrder.id === purchaseOrderId
          ? {
              ...purchaseOrder,
              status,
              receivedAt:
                status === "received" || status === "paid"
                  ? purchaseOrder.receivedAt || new Date().toISOString()
                  : purchaseOrder.receivedAt,
              paidAt:
                status === "paid"
                  ? purchaseOrder.paidAt || new Date().toISOString()
                  : purchaseOrder.paidAt,
            }
          : purchaseOrder,
      ),
    );
  }

  function suggestPurchaseOrder(product?: RetailProduct) {
    const suggestedProducts = product ? [product] : lowStock.slice(0, 6);
    const supplierName = suggestedProducts[0]?.supplier;
    const supplier =
      suppliers.find((entry) => entry.name === supplierName) || suppliers[0];
    setPurchaseOrderDraft({
      supplierId: supplier?.id || "",
      status: "draft",
      items: suggestedProducts.map((entry) => ({
        productId: entry.id,
        qty: String(Math.max(entry.reorderLevel * 2 - entry.stock, 1)),
        unitCost: String(entry.costPrice),
      })),
    });
    setPurchaseOrderModalOpen(true);
  }

  const aiInsights = creditAging.customers
    .filter((customer) => customer.oldestDays >= 30 || customer.balance > 5000)
    .map((customer) => {
      const action =
        customer.balance > 5000 || customer.oldestDays >= 45
          ? "suggest limiting"
          : "follow up";
      return `${customer.name} has ${currency.format(customer.balance)} outstanding for ${customer.oldestDays} days — ${action}.`;
    });

  if (!snapshotLoaded || !storeProfile) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6">
        Loading retail dashboard…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 rounded-3xl border border-blue-100 bg-gradient-to-br from-blue-50 via-white to-emerald-50 p-6 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-2">
          <Badge className="w-fit rounded-full bg-blue-600 px-3 py-1 text-white hover:bg-blue-600">
            Retail / Duka module
          </Badge>
          <h1 className="text-3xl font-semibold tracking-tight">
            Retail counter & stock control
          </h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Sell fast at the counter, manage inventory, follow credit balances,
            and replenish suppliers from one workflow.
          </p>
          <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <span>{storeProfile.name}</span>
            <span>•</span>
            <span>{storeProfile.location}</span>
            <span>•</span>
            <span>Till {storeProfile.tillNumber}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link
            to="/retail/$storeId"
            params={{ storeId: publicStoreId }}
            className="inline-flex h-11 items-center justify-center rounded-2xl border border-border bg-white px-4 text-sm font-medium shadow-sm"
          >
            <Store className="mr-2 h-4 w-4" /> Open customer storefront
          </Link>
          <Button
            className="h-11 rounded-2xl bg-blue-600 hover:bg-blue-700"
            onClick={() => {
              setProductForm(defaultProductForm());
              setProductModalOpen(true);
            }}
          >
            <PackagePlus className="mr-2 h-4 w-4" /> Add product
          </Button>
        </div>
      </div>

      {statusMessage ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {statusMessage}
        </div>
      ) : null}
      {clipboardMessage ? (
        <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
          {clipboardMessage}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="Revenue today"
          value={currency.format(analytics.revenueToday)}
          description="Till plus mobile money"
          icon={Wallet}
          accent="text-emerald-600"
        />
        <MetricCard
          title="Low stock SKUs"
          value={String(lowStock.length)}
          description="Below reorder point"
          icon={AlertTriangle}
          accent="text-amber-500"
        />
        <MetricCard
          title="Credit outstanding"
          value={currency.format(
            creditCustomers.reduce(
              (sum, customer) => sum + customer.balance,
              0,
            ),
          )}
          description="Deni to collect"
          icon={HandCoins}
          accent="text-red-500"
        />
        <MetricCard
          title="Open purchase orders"
          value={String(
            purchaseOrders.filter(
              (purchaseOrder) => purchaseOrder.status !== "paid",
            ).length,
          )}
          description="Draft, sent or received"
          icon={ClipboardList}
          accent="text-blue-500"
        />
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as RetailTab)}
      >
        <div className="overflow-x-auto pb-2">
          <TabsList className="h-auto min-w-max rounded-2xl bg-slate-100 p-1">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <TabsTrigger
                  key={tab.value}
                  value={tab.value}
                  className="rounded-2xl px-4 py-3 text-sm"
                >
                  <Icon className="mr-2 h-4 w-4" /> {tab.label}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </div>

        <TabsContent value="products" className="space-y-6">
          <div className="grid gap-6 xl:grid-cols-[1.8fr_420px]">
            <div className="space-y-6">
              <Card className="rounded-3xl border-blue-100">
                <CardHeader>
                  <CardTitle>POS product picker</CardTitle>
                  <CardDescription>
                    Search, tap and add items quickly during service.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-3 md:grid-cols-[1.4fr_1fr]">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        className="h-11 rounded-2xl pl-9"
                        placeholder="Search name, SKU or barcode"
                        value={productQuery}
                        onChange={(event) =>
                          setProductQuery(event.target.value)
                        }
                      />
                    </div>
                    <div className="relative">
                      <Smartphone className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        className="h-11 rounded-2xl pl-9"
                        placeholder="Enter barcode digits"
                        value={barcodeEntry}
                        onChange={(event) =>
                          setBarcodeEntry(event.target.value)
                        }
                      />
                    </div>
                  </div>
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {categories.map((category) => (
                      <button
                        key={category}
                        type="button"
                        onClick={() => setCategoryFilter(category)}
                        className={cn(
                          "whitespace-nowrap rounded-full border px-4 py-2 text-sm font-medium transition",
                          categoryFilter === category
                            ? "border-blue-600 bg-blue-600 text-white"
                            : "border-border bg-white text-slate-700 hover:bg-slate-50",
                        )}
                      >
                        {category}
                      </button>
                    ))}
                  </div>

                  <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
                    {filteredProducts.map((product) => (
                      <div
                        key={product.id}
                        className="rounded-3xl border border-border bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                      >
                        <div className="flex gap-4">
                          <img
                            src={
                              product.image ||
                              "https://placehold.co/120x120/e2e8f0/0f172a?text=SKU"
                            }
                            alt={product.name}
                            className="h-20 w-20 rounded-2xl object-cover"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <p className="line-clamp-2 font-semibold">
                                  {product.name}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {product.category} • {product.sku}
                                </p>
                              </div>
                              <Badge variant="outline">{product.unit}</Badge>
                            </div>
                            <p className="mt-2 text-sm text-muted-foreground">
                              Barcode: {product.barcode || "—"}
                            </p>
                            <p className="mt-2 text-xl font-semibold text-blue-700">
                              {currency.format(product.sellPrice)}
                            </p>
                          </div>
                        </div>
                        <div className="mt-4 space-y-3">
                          <StockIndicator
                            stock={product.stock}
                            reorderLevel={product.reorderLevel}
                          />
                          <Button
                            className="h-12 w-full rounded-2xl bg-blue-600 text-base hover:bg-blue-700"
                            disabled={product.stock <= 0}
                            onClick={() => addProductToSale(product)}
                          >
                            <ShoppingCart className="mr-2 h-4 w-4" /> Add to
                            sale
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="hidden xl:block">
              <SalePanel
                items={saleItems}
                customerName={saleCustomerName}
                customerPhone={saleCustomerPhone}
                receiptPhone={receiptPhone}
                onCustomerNameChange={setSaleCustomerName}
                onCustomerPhoneChange={setSaleCustomerPhone}
                onReceiptPhoneChange={setReceiptPhone}
                onQtyChange={updateSaleQty}
                onRemove={removeSaleItem}
                onCharge={() => setPaymentOpen(true)}
                onCredit={() => completeSale("credit")}
                total={saleTotal}
                profile={storeProfile}
              />
            </div>
          </div>

          <div className="xl:hidden">
            <Button
              className="fixed bottom-6 right-4 z-20 h-14 rounded-full bg-blue-600 px-5 text-base shadow-lg hover:bg-blue-700"
              onClick={() => setSaleSheetOpen(true)}
            >
              <ShoppingCart className="mr-2 h-4 w-4" /> Cart ·{" "}
              {saleItems.length}
            </Button>
            <Sheet open={saleSheetOpen} onOpenChange={setSaleSheetOpen}>
              <SheetContent
                side="bottom"
                className="max-h-[90vh] rounded-t-[28px] p-0"
              >
                <div className="p-4">
                  <SalePanel
                    items={saleItems}
                    customerName={saleCustomerName}
                    customerPhone={saleCustomerPhone}
                    receiptPhone={receiptPhone}
                    onCustomerNameChange={setSaleCustomerName}
                    onCustomerPhoneChange={setSaleCustomerPhone}
                    onReceiptPhoneChange={setReceiptPhone}
                    onQtyChange={updateSaleQty}
                    onRemove={removeSaleItem}
                    onCharge={() => {
                      setSaleSheetOpen(false);
                      setPaymentOpen(true);
                    }}
                    onCredit={() => {
                      setSaleSheetOpen(false);
                      completeSale("credit");
                    }}
                    total={saleTotal}
                    profile={storeProfile}
                  />
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </TabsContent>

        <TabsContent value="inventory" className="space-y-6">
          <div className="grid gap-4 md:grid-cols-3">
            <MetricCard
              title="Total cost value"
              value={currency.format(inventorySummary.totalCostValue)}
              description="Capital tied in stock"
              icon={Boxes}
              accent="text-blue-600"
            />
            <MetricCard
              title="Retail value"
              value={currency.format(inventorySummary.totalRetailValue)}
              description="Potential shelf value"
              icon={Wallet}
              accent="text-emerald-600"
            />
            <MetricCard
              title="Potential profit"
              value={currency.format(inventorySummary.potentialProfit)}
              description="If all available stock sells"
              icon={BarChart3}
              accent="text-amber-500"
            />
          </div>

          <div className="grid gap-6 xl:grid-cols-[1.7fr_1fr]">
            <Card className="rounded-3xl">
              <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle>Inventory table</CardTitle>
                  <CardDescription>
                    Manage pricing, margins and reorder thresholds.
                  </CardDescription>
                </div>
                <Button
                  className="rounded-2xl"
                  onClick={() => {
                    setProductForm(defaultProductForm());
                    setProductModalOpen(true);
                  }}
                >
                  <Plus className="mr-2 h-4 w-4" /> Add product
                </Button>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Product</TableHead>
                        <TableHead>SKU</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>Cost</TableHead>
                        <TableHead>Sell</TableHead>
                        <TableHead>Margin</TableHead>
                        <TableHead>Stock</TableHead>
                        <TableHead>Reorder</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {products.map((product) => (
                        <TableRow key={product.id}>
                          <TableCell>
                            <div>
                              <p className="font-medium">{product.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {product.supplier || "No supplier set"}
                              </p>
                            </div>
                          </TableCell>
                          <TableCell>{product.sku}</TableCell>
                          <TableCell>{product.category}</TableCell>
                          <TableCell>
                            {currency.format(product.costPrice)}
                          </TableCell>
                          <TableCell>
                            {currency.format(product.sellPrice)}
                          </TableCell>
                          <TableCell>
                            {marginPercentage(
                              product.costPrice,
                              product.sellPrice,
                            ).toFixed(1)}
                            %
                          </TableCell>
                          <TableCell>{product.stock}</TableCell>
                          <TableCell>{product.reorderLevel}</TableCell>
                          <TableCell>
                            <StockStatusBadge
                              stock={product.stock}
                              reorderLevel={product.reorderLevel}
                            />
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => openEditProduct(product)}
                              >
                                Edit
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setAdjustmentForm(
                                    defaultAdjustmentForm(product.id),
                                  );
                                  setAdjustmentModalOpen(true);
                                }}
                              >
                                Adjust
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            <div className="space-y-6">
              <Card className="rounded-3xl border-amber-100">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-amber-700">
                    <AlertTriangle className="h-5 w-5" /> Low stock alerts
                  </CardTitle>
                  <CardDescription>
                    Items below reorder level and ready for supplier action.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {lowStock.length ? (
                    lowStock.map((product) => (
                      <div
                        key={product.id}
                        className="rounded-2xl border border-amber-100 bg-amber-50/60 p-4"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-medium">{product.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {product.stock} left • reorder at{" "}
                              {product.reorderLevel}
                            </p>
                          </div>
                          <Button
                            size="sm"
                            className="rounded-xl bg-amber-500 hover:bg-amber-600"
                            onClick={() => suggestPurchaseOrder(product)}
                          >
                            Order from supplier
                          </Button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      All products are safely above reorder level.
                    </p>
                  )}
                </CardContent>
              </Card>

              <Card className="rounded-3xl">
                <CardHeader>
                  <CardTitle>Recent stock adjustments</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {adjustments.slice(0, 7).map((adjustment) => {
                    const product = products.find(
                      (item) => item.id === adjustment.productId,
                    );
                    return (
                      <div
                        key={adjustment.id}
                        className="flex items-start justify-between gap-3 rounded-2xl border border-border p-3"
                      >
                        <div>
                          <p className="font-medium">
                            {product?.name || adjustment.productId}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {adjustment.type} •{" "}
                            {adjustment.reason || "No reason"}
                          </p>
                        </div>
                        <div className="text-right text-sm">
                          <p
                            className={cn(
                              "font-semibold",
                              adjustment.quantity > 0
                                ? "text-emerald-600"
                                : "text-red-600",
                            )}
                          >
                            {adjustment.quantity > 0 ? "+" : ""}
                            {adjustment.quantity}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {formatDate(adjustment.createdAt)}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="sales" className="space-y-6">
          <div className="grid gap-4 md:grid-cols-3">
            <MetricCard
              title="Daily revenue"
              value={currency.format(analytics.revenueToday)}
              description="Today"
              icon={Wallet}
              accent="text-emerald-600"
            />
            <MetricCard
              title="Weekly revenue"
              value={currency.format(analytics.revenueWeek)}
              description="Last 7 days"
              icon={BarChart3}
              accent="text-blue-600"
            />
            <MetricCard
              title="Monthly revenue"
              value={currency.format(analytics.revenueMonth)}
              description="Last 30 days"
              icon={CreditCard}
              accent="text-purple-600"
            />
          </div>

          <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
            <Card className="rounded-3xl">
              <CardHeader>
                <CardTitle>Revenue trend</CardTitle>
                <CardDescription>Last 7 days of retail sales</CardDescription>
              </CardHeader>
              <CardContent className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={analytics.revenueTrend}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="label" />
                    <YAxis
                      tickFormatter={(value) =>
                        `${Math.round(Number(value) / 1000)}k`
                      }
                    />
                    <Tooltip
                      formatter={(value: number) => currency.format(value)}
                    />
                    <Bar
                      dataKey="revenue"
                      fill="#2563eb"
                      radius={[12, 12, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card className="rounded-3xl">
              <CardHeader>
                <CardTitle>Payment mix</CardTitle>
                <CardDescription>
                  M-Pesa, cash, credit and Co-op BNPL
                </CardDescription>
              </CardHeader>
              <CardContent className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={analytics.paymentBreakdown}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={55}
                      outerRadius={95}
                    >
                      {analytics.paymentBreakdown.map((entry, index) => (
                        <Cell
                          key={entry.name}
                          fill={
                            paymentPieColors[index % paymentPieColors.length]
                          }
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value: number) => currency.format(value)}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          <Card className="rounded-3xl">
            <CardHeader className="space-y-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <CardTitle>Sales ledger</CardTitle>
                  <CardDescription>
                    Track totals, refunds and payment channels
                  </CardDescription>
                </div>
                <Button
                  className="rounded-2xl"
                  variant="outline"
                  onClick={exportSalesCsv}
                >
                  <Download className="mr-2 h-4 w-4" /> Export CSV
                </Button>
              </div>
              <div className="grid gap-3 md:grid-cols-5">
                <Input
                  type="date"
                  value={salesStartDate}
                  onChange={(event) => setSalesStartDate(event.target.value)}
                />
                <Input
                  type="date"
                  value={salesEndDate}
                  onChange={(event) => setSalesEndDate(event.target.value)}
                />
                <select
                  className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                  value={salesPaymentFilter}
                  onChange={(event) =>
                    setSalesPaymentFilter(event.target.value)
                  }
                >
                  <option value="all">All payments</option>
                  <option value="mpesa">M-Pesa</option>
                  <option value="cash">Cash</option>
                  <option value="credit">Credit</option>
                  <option value="bnpl">Co-op BNPL</option>
                </select>
                <select
                  className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                  value={salesProductFilter}
                  onChange={(event) =>
                    setSalesProductFilter(event.target.value)
                  }
                >
                  <option value="all">All products</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name}
                    </option>
                  ))}
                </select>
                <Input
                  placeholder="Filter customer"
                  value={salesCustomerFilter}
                  onChange={(event) =>
                    setSalesCustomerFilter(event.target.value)
                  }
                />
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Items sold</TableHead>
                      <TableHead>Total</TableHead>
                      <TableHead>Payment</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredSales.map((sale) => (
                      <TableRow
                        key={sale.id}
                        className={sale.refunded ? "bg-red-50/40" : undefined}
                      >
                        <TableCell>{formatDate(sale.createdAt)}</TableCell>
                        <TableCell>
                          <div className="max-w-md text-sm">
                            {sale.items
                              .map((item) => `${item.name} x${item.qty}`)
                              .join(", ")}
                          </div>
                        </TableCell>
                        <TableCell className="font-medium">
                          {currency.format(sale.total)}
                        </TableCell>
                        <TableCell>
                          <Badge
                            className={cn(
                              "rounded-full px-3 py-1 capitalize",
                              sale.paymentMethod === "mpesa" &&
                                "bg-emerald-100 text-emerald-700",
                              sale.paymentMethod === "cash" &&
                                "bg-slate-100 text-slate-700",
                              sale.paymentMethod === "credit" &&
                                "bg-red-100 text-red-700",
                              sale.paymentMethod === "bnpl" &&
                                "bg-blue-100 text-blue-700",
                            )}
                          >
                            {sale.paymentMethod === "bnpl"
                              ? "Co-op BNPL"
                              : sale.paymentMethod}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div>
                            <p>{sale.customerName || "Walk-in"}</p>
                            <p className="text-xs text-muted-foreground">
                              {sale.customerPhone || "—"}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={sale.refunded}
                            onClick={() => refundSale(sale)}
                          >
                            {sale.refunded ? "Refunded" : "Refund / Return"}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="credit" className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              title="Total outstanding"
              value={currency.format(
                creditCustomers.reduce(
                  (sum, customer) => sum + customer.balance,
                  0,
                ),
              )}
              description="All customers"
              icon={HandCoins}
              accent="text-red-500"
            />
            <MetricCard
              title="Current"
              value={currency.format(creditAging.totals.current)}
              description="0–29 days"
              icon={Wallet}
              accent="text-emerald-600"
            />
            <MetricCard
              title="30+ days"
              value={currency.format(
                creditAging.totals.thirty +
                  creditAging.totals.sixty +
                  creditAging.totals.ninety,
              )}
              description="Needs follow-up"
              icon={AlertTriangle}
              accent="text-amber-500"
            />
            <MetricCard
              title="Customers"
              value={String(creditCustomers.length)}
              description="On the deni ledger"
              icon={UserRound}
              accent="text-blue-600"
            />
          </div>

          <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
            <Card className="rounded-3xl">
              <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle>Credit customer ledger</CardTitle>
                  <CardDescription>
                    Record balances, send reminders, and collect payments.
                  </CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="rounded-2xl"
                    onClick={() => setCreditPaymentModalOpen(true)}
                  >
                    Record payment
                  </Button>
                  <Button
                    className="rounded-2xl"
                    onClick={() => setCreditCustomerModalOpen(true)}
                  >
                    Add customer
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {creditAging.customers.map((customerAgingItem) => {
                  const customer = creditCustomers.find(
                    (entry) => entry.id === customerAgingItem.customerId,
                  );
                  if (!customer) return null;
                  const reminder = buildReminderMessage(
                    customer,
                    customerAgingItem.balance,
                    customerAgingItem.oldestDays,
                  );
                  return (
                    <div
                      key={customer.id}
                      className="rounded-3xl border border-border p-4"
                    >
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-lg font-semibold">
                              {customer.name}
                            </h3>
                            <Badge variant="outline">
                              Limit {currency.format(customer.creditLimit)}
                            </Badge>
                          </div>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {customer.phone}
                          </p>
                          <p className="mt-3 text-2xl font-semibold text-red-600">
                            {currency.format(customer.balance)}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            variant="outline"
                            className="rounded-2xl"
                            onClick={() =>
                              copyToClipboard(
                                reminder,
                                `Reminder copied for ${customer.name}.`,
                              )
                            }
                          >
                            Send reminder
                          </Button>
                          <Button
                            className="rounded-2xl"
                            onClick={() => {
                              setCreditPaymentForm({
                                customerId: customer.id,
                                amount: "",
                                description: "Repayment",
                              });
                              setCreditPaymentModalOpen(true);
                            }}
                          >
                            Record payment
                          </Button>
                        </div>
                      </div>

                      <div className="mt-4 grid gap-3 md:grid-cols-4">
                        <AgingBucket
                          label="Current"
                          value={customerAgingItem.buckets.current}
                          tone="green"
                        />
                        <AgingBucket
                          label="30+"
                          value={customerAgingItem.buckets.thirty}
                          tone="amber"
                        />
                        <AgingBucket
                          label="60+"
                          value={customerAgingItem.buckets.sixty}
                          tone="orange"
                        />
                        <AgingBucket
                          label="90+"
                          value={customerAgingItem.buckets.ninety}
                          tone="red"
                        />
                      </div>

                      <div className="mt-4 space-y-2">
                        {customer.entries
                          .slice()
                          .sort((a, b) => +new Date(b.date) - +new Date(a.date))
                          .slice(0, 4)
                          .map((entry) => (
                            <div
                              key={entry.id}
                              className="flex items-center justify-between gap-3 rounded-2xl bg-slate-50 p-3 text-sm"
                            >
                              <div>
                                <p className="font-medium">
                                  {entry.description}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {formatDate(entry.date)}{" "}
                                  {entry.dueDate
                                    ? `• due ${entry.dueDate}`
                                    : ""}
                                </p>
                              </div>
                              <p
                                className={cn(
                                  "font-semibold",
                                  entry.type === "purchase"
                                    ? "text-red-600"
                                    : "text-emerald-600",
                                )}
                              >
                                {entry.type === "purchase" ? "-" : "+"}
                                {currency.format(entry.amount)}
                              </p>
                            </div>
                          ))}
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            <div className="space-y-6">
              <Card className="rounded-3xl border-red-100">
                <CardHeader>
                  <CardTitle className="text-red-700">
                    AI credit insight
                  </CardTitle>
                  <CardDescription>
                    Highlight risky debt before it grows.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  {aiInsights.length ? (
                    aiInsights.map((insight) => (
                      <div
                        key={insight}
                        className="rounded-2xl border border-red-100 bg-red-50 p-3 text-red-700"
                      >
                        {insight}
                      </div>
                    ))
                  ) : (
                    <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-3 text-emerald-700">
                      Credit health is stable. Keep nudging customers before 30
                      days.
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="rounded-3xl">
                <CardHeader>
                  <CardTitle>Reminder preview</CardTitle>
                </CardHeader>
                <CardContent>
                  <textarea
                    className="min-h-52 w-full rounded-2xl border border-input bg-transparent p-3 text-sm"
                    readOnly
                    value={
                      receiptPreview?.message ||
                      clipboardMessage ||
                      "Copy a reminder or receipt preview to see text here."
                    }
                  />
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="suppliers" className="space-y-6">
          <div className="grid gap-6 xl:grid-cols-[1.2fr_1fr]">
            <Card className="rounded-3xl">
              <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle>Supplier directory</CardTitle>
                  <CardDescription>
                    Manage contacts and replenishment partners.
                  </CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="rounded-2xl"
                    onClick={() => suggestPurchaseOrder()}
                  >
                    Auto-suggest low stock PO
                  </Button>
                  <Button
                    className="rounded-2xl"
                    onClick={() => setPurchaseOrderModalOpen(true)}
                  >
                    Create purchase order
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                {suppliers.map((supplier) => (
                  <div
                    key={supplier.id}
                    className="rounded-3xl border border-border p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-lg font-semibold">
                          {supplier.name}
                        </h3>
                        <p className="text-sm text-muted-foreground">
                          {supplier.phone}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {supplier.email || "No email set"}
                        </p>
                      </div>
                      <Badge variant="outline">
                        {supplier.products.length} products
                      </Badge>
                    </div>
                    <p className="mt-4 text-sm text-muted-foreground">
                      Last order: {formatDate(supplier.lastOrderDate)}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {supplier.products.slice(0, 4).map((productId) => {
                        const product = products.find(
                          (entry) => entry.id === productId,
                        );
                        return product ? (
                          <Badge
                            key={productId}
                            variant="secondary"
                            className="rounded-full"
                          >
                            {product.name}
                          </Badge>
                        ) : null;
                      })}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="rounded-3xl border-blue-100">
              <CardHeader>
                <CardTitle>PO suggestions</CardTitle>
                <CardDescription>
                  Build the next replenishment from low stock alerts.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {lowStock.slice(0, 5).map((product) => (
                  <div
                    key={product.id}
                    className="rounded-2xl border border-blue-100 bg-blue-50/60 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium">{product.name}</p>
                        <p className="text-xs text-muted-foreground">
                          Suggested qty{" "}
                          {Math.max(
                            product.reorderLevel * 2 - product.stock,
                            1,
                          )}{" "}
                          • supplier {product.supplier || "Assign supplier"}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => suggestPurchaseOrder(product)}
                      >
                        Add to PO
                      </Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          <Card className="rounded-3xl">
            <CardHeader>
              <CardTitle>Purchase order tracker</CardTitle>
              <CardDescription>
                Draft → sent → received → paid, with gross margin visibility.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {purchaseOrders.map((purchaseOrder) => {
                const potentialRetail = purchaseOrder.items.reduce(
                  (sum, item) => {
                    const product = products.find(
                      (entry) => entry.id === item.productId,
                    );
                    return (
                      sum + item.qty * (product?.sellPrice || item.unitCost)
                    );
                  },
                  0,
                );
                return (
                  <div
                    key={purchaseOrder.id}
                    className="rounded-3xl border border-border p-4"
                  >
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-lg font-semibold">
                            {purchaseOrder.id}
                          </h3>
                          <Badge
                            className="rounded-full capitalize"
                            variant="outline"
                          >
                            {purchaseOrder.status}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {purchaseOrder.supplierName} • created{" "}
                          {formatDate(purchaseOrder.createdAt)}
                        </p>
                        <div className="mt-3 text-sm text-muted-foreground">
                          Cost {currency.format(purchaseOrder.total)} • retail
                          value {currency.format(potentialRetail)} • margin{" "}
                          {currency.format(
                            potentialRetail - purchaseOrder.total,
                          )}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {(["draft", "sent", "received", "paid"] as const).map(
                          (status) => (
                            <Button
                              key={status}
                              size="sm"
                              variant={
                                purchaseOrder.status === status
                                  ? "default"
                                  : "outline"
                              }
                              onClick={() =>
                                updatePurchaseOrderStatus(
                                  purchaseOrder.id,
                                  status,
                                )
                              }
                            >
                              {status}
                            </Button>
                          ),
                        )}
                      </div>
                    </div>
                    <div className="mt-4 space-y-2">
                      {purchaseOrder.items.map((item) => (
                        <div
                          key={`${purchaseOrder.id}-${item.productId}`}
                          className="flex items-center justify-between rounded-2xl bg-slate-50 p-3 text-sm"
                        >
                          <span>
                            {item.name} × {item.qty}
                          </span>
                          <span>
                            {currency.format(item.unitCost * item.qty)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={paymentOpen} onOpenChange={setPaymentOpen}>
        <DialogContent
          className={cn(
            "rounded-3xl",
            paymentMethod === "bnpl" ? "sm:max-w-2xl" : "sm:max-w-xl",
          )}
        >
          <DialogHeader>
            <DialogTitle>Charge customer</DialogTitle>
            <DialogDescription>
              Choose the payment method and issue a receipt.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <button
                type="button"
                className={cn(
                  "rounded-2xl border p-4 text-left",
                  paymentMethod === "mpesa"
                    ? "border-emerald-500 bg-emerald-50"
                    : "border-border",
                )}
                onClick={() => setPaymentMethod("mpesa")}
              >
                <p className="font-semibold">M-Pesa STK push</p>
                <p className="text-sm text-muted-foreground">
                  Charge direct to phone
                </p>
              </button>
              <button
                type="button"
                className={cn(
                  "rounded-2xl border p-4 text-left",
                  paymentMethod === "cash"
                    ? "border-blue-500 bg-blue-50"
                    : "border-border",
                )}
                onClick={() => setPaymentMethod("cash")}
              >
                <p className="font-semibold">Cash</p>
                <p className="text-sm text-muted-foreground">
                  Record till payment immediately
                </p>
              </button>
              <button
                type="button"
                className={cn(
                  "rounded-2xl border p-4 text-left",
                  paymentMethod === "bnpl"
                    ? "border-[#003DA5] bg-blue-50"
                    : "border-border",
                )}
                onClick={() => setPaymentMethod("bnpl")}
              >
                <div className="flex items-center gap-2 font-semibold">
                  <Building2 className="h-4 w-4" />
                  Co-op BNPL
                </div>
                <p className="text-sm text-muted-foreground">
                  Approve instalments inside this checkout modal
                </p>
              </button>
            </div>
            {paymentMethod === "bnpl" ? (
              <BNPLCheckout
                amount={saleTotal}
                description={`${saleItems.length} retail items at ${storeProfile?.name || "PesaSwap"}`}
                merchantId={storeProfile?.id}
                onCancel={() => setPaymentMethod("mpesa")}
                onSuccess={(transaction) =>
                  completeSale("bnpl", {
                    bnplTransaction: transaction,
                    customerName: transaction.customerName,
                    customerPhone: transaction.customerPhone,
                  })
                }
                orderId={`retail-${Date.now()}`}
              />
            ) : null}
            {paymentMethod === "mpesa" ? (
              <label className="space-y-2 text-sm">
                <span className="font-medium">M-Pesa phone number</span>
                <Input
                  value={mpesaPhone}
                  onChange={(event) => setMpesaPhone(event.target.value)}
                  placeholder="2547xxxxxxxx"
                />
              </label>
            ) : null}
            {paymentMethod !== "bnpl" ? (
              <>
                <div className="rounded-2xl bg-slate-50 p-4 text-sm">
                  <div className="flex items-center justify-between">
                    <span>Items</span>
                    <span>
                      {saleItems.reduce((sum, item) => sum + item.qty, 0)}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center justify-between font-semibold">
                    <span>Total</span>
                    <span>{currency.format(saleTotal)}</span>
                  </div>
                </div>
                <Button
                  className="h-12 w-full rounded-2xl"
                  onClick={() => completeSale(paymentMethod)}
                >
                  Confirm {paymentMethod === "mpesa" ? "M-Pesa" : "cash"}{" "}
                  payment
                </Button>
              </>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={productModalOpen} onOpenChange={setProductModalOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto rounded-3xl sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {productForm.id ? "Edit retail product" : "Add retail product"}
            </DialogTitle>
            <DialogDescription>
              Capture supplier, pricing and stock details for your duka.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2 text-sm">
              <span className="font-medium">Name</span>
              <Input
                value={productForm.name}
                onChange={(event) =>
                  setProductForm((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <label className="space-y-2 text-sm">
                <span className="font-medium">SKU</span>
                <Input
                  value={productForm.sku}
                  onChange={(event) =>
                    setProductForm((current) => ({
                      ...current,
                      sku: event.target.value,
                    }))
                  }
                />
              </label>
              <Button
                type="button"
                variant="outline"
                className="self-end rounded-2xl"
                onClick={() =>
                  setProductForm((current) => ({
                    ...current,
                    sku: createSku(current.name || "Product", current.category),
                  }))
                }
              >
                Auto-generate
              </Button>
            </div>
            <label className="space-y-2 text-sm">
              <span className="font-medium">Barcode</span>
              <Input
                value={productForm.barcode}
                onChange={(event) =>
                  setProductForm((current) => ({
                    ...current,
                    barcode: event.target.value,
                  }))
                }
              />
            </label>
            <label className="space-y-2 text-sm">
              <span className="font-medium">Category</span>
              <select
                className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                value={productForm.category}
                onChange={(event) =>
                  setProductForm((current) => ({
                    ...current,
                    category: event.target.value,
                  }))
                }
              >
                {[
                  "Groceries",
                  "Beverages",
                  "Personal Care",
                  "Household",
                  "Airtime & Electronics",
                ].map((category) => (
                  <option key={category}>{category}</option>
                ))}
              </select>
            </label>
            <label className="space-y-2 text-sm">
              <span className="font-medium">Cost price</span>
              <Input
                type="number"
                value={productForm.costPrice}
                onChange={(event) =>
                  setProductForm((current) => ({
                    ...current,
                    costPrice: event.target.value,
                  }))
                }
              />
            </label>
            <label className="space-y-2 text-sm">
              <span className="font-medium">Sell price</span>
              <Input
                type="number"
                value={productForm.sellPrice}
                onChange={(event) =>
                  setProductForm((current) => ({
                    ...current,
                    sellPrice: event.target.value,
                  }))
                }
              />
            </label>
            <label className="space-y-2 text-sm">
              <span className="font-medium">Current stock</span>
              <Input
                type="number"
                value={productForm.stock}
                onChange={(event) =>
                  setProductForm((current) => ({
                    ...current,
                    stock: event.target.value,
                  }))
                }
              />
            </label>
            <label className="space-y-2 text-sm">
              <span className="font-medium">Reorder level</span>
              <Input
                type="number"
                value={productForm.reorderLevel}
                onChange={(event) =>
                  setProductForm((current) => ({
                    ...current,
                    reorderLevel: event.target.value,
                  }))
                }
              />
            </label>
            <label className="space-y-2 text-sm">
              <span className="font-medium">Supplier name</span>
              <Input
                value={productForm.supplier}
                onChange={(event) =>
                  setProductForm((current) => ({
                    ...current,
                    supplier: event.target.value,
                  }))
                }
              />
            </label>
            <label className="space-y-2 text-sm">
              <span className="font-medium">Supplier phone</span>
              <Input
                value={productForm.supplierPhone}
                onChange={(event) =>
                  setProductForm((current) => ({
                    ...current,
                    supplierPhone: event.target.value,
                  }))
                }
              />
            </label>
            <label className="space-y-2 text-sm">
              <span className="font-medium">Unit</span>
              <select
                className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                value={productForm.unit}
                onChange={(event) =>
                  setProductForm((current) => ({
                    ...current,
                    unit: event.target.value as RetailProduct["unit"],
                  }))
                }
              >
                {units.map((unit) => (
                  <option key={unit}>{unit}</option>
                ))}
              </select>
            </label>
            <label className="space-y-2 text-sm md:col-span-2">
              <span className="font-medium">Photo upload (base64)</span>
              <Input
                type="file"
                accept="image/*"
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  const image = await readFileAsDataUrl(file);
                  setProductForm((current) => ({ ...current, image }));
                }}
              />
            </label>
          </div>
          <div className="rounded-2xl bg-slate-50 p-4 text-sm">
            Margin preview:{" "}
            {marginPercentage(
              Number(productForm.costPrice || 0),
              Number(productForm.sellPrice || 0),
            ).toFixed(1)}
            %
          </div>
          <Button className="h-11 rounded-2xl" onClick={saveProduct}>
            Save product
          </Button>
        </DialogContent>
      </Dialog>

      <Dialog open={adjustmentModalOpen} onOpenChange={setAdjustmentModalOpen}>
        <DialogContent className="rounded-3xl sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Stock adjustment</DialogTitle>
            <DialogDescription>
              Record received, damaged, returned or counted stock.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <label className="space-y-2 text-sm">
              <span className="font-medium">Product</span>
              <select
                className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                value={adjustmentForm.productId}
                onChange={(event) =>
                  setAdjustmentForm((current) => ({
                    ...current,
                    productId: event.target.value,
                  }))
                }
              >
                <option value="">Select product</option>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="space-y-2 text-sm">
                <span className="font-medium">Type</span>
                <select
                  className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                  value={adjustmentForm.type}
                  onChange={(event) =>
                    setAdjustmentForm((current) => ({
                      ...current,
                      type: event.target.value as StockAdjustment["type"],
                    }))
                  }
                >
                  {(
                    ["received", "damaged", "returned", "counted"] as const
                  ).map((type) => (
                    <option key={type}>{type}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-2 text-sm">
                <span className="font-medium">Direction</span>
                <select
                  className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                  value={adjustmentForm.direction}
                  onChange={(event) =>
                    setAdjustmentForm((current) => ({
                      ...current,
                      direction: event.target.value as "add" | "remove",
                    }))
                  }
                >
                  <option value="add">Add (+)</option>
                  <option value="remove">Reduce (-)</option>
                </select>
              </label>
              <label className="space-y-2 text-sm">
                <span className="font-medium">Quantity</span>
                <Input
                  type="number"
                  value={adjustmentForm.quantity}
                  onChange={(event) =>
                    setAdjustmentForm((current) => ({
                      ...current,
                      quantity: event.target.value,
                    }))
                  }
                />
              </label>
            </div>
            <label className="space-y-2 text-sm">
              <span className="font-medium">Reason</span>
              <Input
                value={adjustmentForm.reason}
                onChange={(event) =>
                  setAdjustmentForm((current) => ({
                    ...current,
                    reason: event.target.value,
                  }))
                }
              />
            </label>
            <Button className="h-11 rounded-2xl" onClick={applyStockAdjustment}>
              Apply adjustment
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={creditCustomerModalOpen}
        onOpenChange={setCreditCustomerModalOpen}
      >
        <DialogContent className="rounded-3xl sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add credit customer</DialogTitle>
            <DialogDescription>
              Add the customer to the deni book before issuing more stock on
              credit.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Input
              placeholder="Customer name"
              value={creditCustomerForm.name}
              onChange={(event) =>
                setCreditCustomerForm((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
            />
            <Input
              placeholder="Phone"
              value={creditCustomerForm.phone}
              onChange={(event) =>
                setCreditCustomerForm((current) => ({
                  ...current,
                  phone: event.target.value,
                }))
              }
            />
            <Input
              type="number"
              placeholder="Credit limit"
              value={creditCustomerForm.creditLimit}
              onChange={(event) =>
                setCreditCustomerForm((current) => ({
                  ...current,
                  creditLimit: event.target.value,
                }))
              }
            />
            <Button className="h-11 rounded-2xl" onClick={addCreditCustomer}>
              Save customer
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={creditPaymentModalOpen}
        onOpenChange={setCreditPaymentModalOpen}
      >
        <DialogContent className="rounded-3xl sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Record credit payment</DialogTitle>
            <DialogDescription>
              Capture partial or full repayments.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <select
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
              value={creditPaymentForm.customerId}
              onChange={(event) =>
                setCreditPaymentForm((current) => ({
                  ...current,
                  customerId: event.target.value,
                }))
              }
            >
              <option value="">Select customer</option>
              {creditCustomers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                </option>
              ))}
            </select>
            <Input
              type="number"
              placeholder="Amount paid"
              value={creditPaymentForm.amount}
              onChange={(event) =>
                setCreditPaymentForm((current) => ({
                  ...current,
                  amount: event.target.value,
                }))
              }
            />
            <Input
              placeholder="Description"
              value={creditPaymentForm.description}
              onChange={(event) =>
                setCreditPaymentForm((current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
            />
            <Button className="h-11 rounded-2xl" onClick={recordCreditPayment}>
              Record payment
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={purchaseOrderModalOpen}
        onOpenChange={setPurchaseOrderModalOpen}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto rounded-3xl sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Create purchase order</DialogTitle>
            <DialogDescription>
              Build a PO from low stock items or selected supplier lines.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <select
                className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                value={purchaseOrderDraft.supplierId}
                onChange={(event) =>
                  setPurchaseOrderDraft((current) => ({
                    ...current,
                    supplierId: event.target.value,
                  }))
                }
              >
                <option value="">Select supplier</option>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
              </select>
              <select
                className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                value={purchaseOrderDraft.status}
                onChange={(event) =>
                  setPurchaseOrderDraft((current) => ({
                    ...current,
                    status: event.target.value as PurchaseOrder["status"],
                  }))
                }
              >
                {(["draft", "sent", "received", "paid"] as const).map(
                  (status) => (
                    <option key={status}>{status}</option>
                  ),
                )}
              </select>
            </div>
            <div className="space-y-3">
              {purchaseOrderRows.map((item, index) => (
                <div
                  key={`${index}-${item.productId}`}
                  className="grid gap-3 rounded-2xl border border-border p-3 md:grid-cols-[1.2fr_120px_120px_auto]"
                >
                  <select
                    className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                    value={item.productId}
                    onChange={(event) =>
                      setPurchaseOrderDraft((current) => ({
                        ...current,
                        items: current.items.map((entry, entryIndex) =>
                          entryIndex === index
                            ? {
                                ...entry,
                                productId: event.target.value,
                                unitCost: String(
                                  products.find(
                                    (product) =>
                                      product.id === event.target.value,
                                  )?.costPrice || entry.unitCost,
                                ),
                              }
                            : entry,
                        ),
                      }))
                    }
                  >
                    <option value="">Select product</option>
                    {products.map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.name}
                      </option>
                    ))}
                  </select>
                  <Input
                    type="number"
                    placeholder="Qty"
                    value={item.qty}
                    onChange={(event) =>
                      setPurchaseOrderDraft((current) => ({
                        ...current,
                        items: current.items.map((entry, entryIndex) =>
                          entryIndex === index
                            ? { ...entry, qty: event.target.value }
                            : entry,
                        ),
                      }))
                    }
                  />
                  <Input
                    type="number"
                    placeholder="Unit cost"
                    value={item.unitCost}
                    onChange={(event) =>
                      setPurchaseOrderDraft((current) => ({
                        ...current,
                        items: current.items.map((entry, entryIndex) =>
                          entryIndex === index
                            ? { ...entry, unitCost: event.target.value }
                            : entry,
                        ),
                      }))
                    }
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      setPurchaseOrderDraft((current) => ({
                        ...current,
                        items:
                          current.items.length === 1
                            ? current.items
                            : current.items.filter(
                                (_, entryIndex) => entryIndex !== index,
                              ),
                      }))
                    }
                  >
                    Remove
                  </Button>
                </div>
              ))}
            </div>
            <Button
              type="button"
              variant="outline"
              className="rounded-2xl"
              onClick={() =>
                setPurchaseOrderDraft((current) => ({
                  ...current,
                  items: [
                    ...current.items,
                    { productId: "", qty: "1", unitCost: "0" },
                  ],
                }))
              }
            >
              <Plus className="mr-2 h-4 w-4" /> Add product line
            </Button>
            <Button className="h-11 rounded-2xl" onClick={createPurchaseOrder}>
              Save purchase order
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {receiptPreview ? (
        <Card className="rounded-3xl border-emerald-100">
          <CardHeader>
            <CardTitle>{receiptPreview.title}</CardTitle>
            <CardDescription>
              Send this receipt via SMS or WhatsApp to the customer.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <textarea
              readOnly
              className="min-h-40 w-full rounded-2xl border border-input bg-transparent p-3 text-sm"
              value={receiptPreview.message}
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function MetricCard({
  title,
  value,
  description,
  icon: Icon,
  accent,
}: {
  title: string;
  value: string;
  description: string;
  icon: typeof Wallet;
  accent: string;
}) {
  return (
    <Card className="rounded-3xl shadow-sm">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm text-muted-foreground">{title}</p>
            <p className="mt-3 text-2xl font-semibold">{value}</p>
            <p className="mt-2 text-xs text-muted-foreground">{description}</p>
          </div>
          <div className={cn("rounded-2xl bg-slate-50 p-3", accent)}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function StockIndicator({
  stock,
  reorderLevel,
}: {
  stock: number;
  reorderLevel: number;
}) {
  const tone = getStockTone(stock);
  const progress = Math.min(
    100,
    Math.max(8, (stock / Math.max(reorderLevel * 2, 1)) * 100),
  );
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2 font-medium">
          <span
            className={cn(
              "h-2.5 w-2.5 rounded-full animate-pulse",
              tone === "green" && "bg-emerald-500",
              tone === "amber" && "bg-amber-500",
              tone === "red" && "bg-red-500",
            )}
          />
          Stock {stock}
        </div>
        <StockStatusBadge stock={stock} reorderLevel={reorderLevel} />
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
        <div
          className={cn(
            "h-full rounded-full",
            tone === "green" && "bg-emerald-500",
            tone === "amber" && "bg-amber-500",
            tone === "red" && "bg-red-500",
          )}
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}

function StockStatusBadge({
  stock,
  reorderLevel,
}: {
  stock: number;
  reorderLevel: number;
}) {
  if (stock <= 2) {
    return (
      <Badge className="rounded-full bg-red-100 text-red-700">Critical</Badge>
    );
  }
  if (stock <= reorderLevel || stock <= 10) {
    return (
      <Badge className="rounded-full bg-amber-100 text-amber-700">Low</Badge>
    );
  }
  return (
    <Badge className="rounded-full bg-emerald-100 text-emerald-700">
      Healthy
    </Badge>
  );
}

function AgingBucket({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "green" | "amber" | "orange" | "red";
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border p-3",
        tone === "green" && "border-emerald-100 bg-emerald-50 text-emerald-700",
        tone === "amber" && "border-amber-100 bg-amber-50 text-amber-700",
        tone === "orange" && "border-orange-100 bg-orange-50 text-orange-700",
        tone === "red" && "border-red-100 bg-red-50 text-red-700",
      )}
    >
      <p className="text-xs font-medium uppercase tracking-wide">{label}</p>
      <p className="mt-2 text-lg font-semibold">{currency.format(value)}</p>
    </div>
  );
}
