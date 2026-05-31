import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useMemo, useRef } from "react";
import {
  Zap,
  CheckCircle2,
  ShieldCheck,
  Users,
  Receipt,
  Percent,
  SplitSquareVertical,
  Heart,
  Minus,
  Plus,
  ChevronDown,
  ChevronUp,
  Star,
  Share2,
  ExternalLink,
  AlertCircle,
  ImageIcon,
  X,
} from "lucide-react";
import type {
  CatalogueItem,
  Menu,
  MenuSchedule,
  ModifierOption,
  Zone,
} from "@/components/merchant/features/types";
import {
  ensureMerchantDemoData,
  getActiveMenuSchedule,
  getOrderedCategories,
  getTableZone,
  getVisibleCatalogueForTable,
  type MerchantSnapshot,
} from "@/lib/merchant-dashboard";
import {
  executePayment,
  buildPaymentMetadata,
  loadHyperLoader,
  type PaymentStatus,
} from "../lib/pesaswap-payments";

export const Route = createFileRoute("/table")({
  head: () => ({
    meta: [
      { title: "Table Payment — PesaSwap" },
      {
        name: "description",
        content: "Scan your table QR, view bill, split & pay with tips.",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1, maximum-scale=1",
      },
    ],
  }),
  component: TablePayPage,
});

// --- Types ---

type SelectedModifier = {
  modifierId: string;
  modifierName: string;
  optionId: string;
  optionLabel: string;
  priceAdjustment: number;
};

type TableItem = {
  id: string;
  name: string;
  price: number;
  qty: number;
  category?: string;
  dietary?: string[];
  destination?: "kitchen" | "bar";
  image?: string;
  description?: string;
  modifiers?: CatalogueItem["modifiers"];
  selectedModifiers?: SelectedModifier[];
};

type OrderSelection = {
  key: string;
  itemId: string;
  name: string;
  basePrice: number;
  quantity: number;
  category?: string;
  dietary?: string[];
  destination?: "kitchen" | "bar";
  image?: string;
  description?: string;
  selectedOptions: SelectedModifier[];
};

type TableData = {
  tableNumber: number;
  merchant: string;
  till: string;
  server: string;
  items: TableItem[];
  openedAt: string;
  quickCharge?: number;
  catalogue?: CatalogueItem[];
};

type EncodedTableData = Partial<TableData> & { table?: number };

type SplitMode = "full" | "equal" | "by-item" | "custom";

type TipOption = { label: string; percent: number };

const TIP_OPTIONS: TipOption[] = [
  { label: "No tip", percent: 0 },
  { label: "5%", percent: 5 },
  { label: "10%", percent: 10 },
  { label: "15%", percent: 15 },
  { label: "20%", percent: 20 },
];

// --- Multi-language ---

type Lang = "en" | "sw" | "fr";

const TRANSLATIONS: Record<Lang, Record<string, string>> = {
  en: {
    tablePay: "Table Pay",
    yourBill: "Your Bill",
    payNow: "Pay Now",
    orderMore: "Order More",
    splitPayment: "Split Payment",
    tip: "Tip",
    total: "Total",
    subtotal: "Subtotal",
    howToPay: "How would you like to split?",
    full: "Pay Full",
    equal: "Equal Split",
    byItem: "By Item",
    custom: "Custom",
    continue: "Continue",
    back: "Back",
    addToOrder: "Add to Order",
    placeOrder: "Place Order",
    kitchen: "Kitchen",
    bar: "Bar",
    noTip: "No tip",
    customTip: "Custom tip",
    mostGuestsTip: "Most guests tip 10–15% — you're awesome!",
    roundUp: "Round up to",
    paymentComplete: "Payment Complete",
    rateExperience: "How was your experience?",
    shareReceipt: "Share Receipt",
    server: "Server",
    table: "Table",
    items: "items",
    vegan: "Vegan",
    vegetarian: "Vegetarian",
    glutenFree: "Gluten-free",
    halal: "Halal",
    containsNuts: "Contains nuts",
    dairyFree: "Dairy-free",
    orderSent: "Order sent to",
    preparing: "Being prepared",
  },
  sw: {
    tablePay: "Lipa Meza",
    yourBill: "Bili Yako",
    payNow: "Lipa Sasa",
    orderMore: "Agiza Zaidi",
    splitPayment: "Gawanya Malipo",
    tip: "Tuzo",
    total: "Jumla",
    subtotal: "Jumla ndogo",
    howToPay: "Ungependa kugawanya vipi?",
    full: "Lipa Yote",
    equal: "Sawa Sawa",
    byItem: "Kwa Bidhaa",
    custom: "Kiasi Chako",
    continue: "Endelea",
    back: "Rudi",
    addToOrder: "Ongeza Agizo",
    placeOrder: "Tuma Agizo",
    kitchen: "Jikoni",
    bar: "Baa",
    noTip: "Bila tuzo",
    customTip: "Tuzo ya kawaida",
    mostGuestsTip: "Wageni wengi hutoa tuzo 10–15% — wewe ni bora!",
    roundUp: "Kamilisha hadi",
    paymentComplete: "Malipo Yamekamilika",
    rateExperience: "Uzoefu wako ulikuwaje?",
    shareReceipt: "Shiriki Risiti",
    server: "Mhudumu",
    table: "Meza",
    items: "bidhaa",
    vegan: "Mboga tu",
    vegetarian: "Mboga",
    glutenFree: "Bila gluteni",
    halal: "Halali",
    containsNuts: "Ina karanga",
    dairyFree: "Bila maziwa",
    orderSent: "Agizo limetumwa",
    preparing: "Linaandaliwa",
  },
  fr: {
    tablePay: "Paiement Table",
    yourBill: "Votre Addition",
    payNow: "Payer",
    orderMore: "Commander Plus",
    splitPayment: "Partager le paiement",
    tip: "Pourboire",
    total: "Total",
    subtotal: "Sous-total",
    howToPay: "Comment souhaitez-vous partager?",
    full: "Tout Payer",
    equal: "Parts Égales",
    byItem: "Par Article",
    custom: "Montant Libre",
    continue: "Continuer",
    back: "Retour",
    addToOrder: "Ajouter",
    placeOrder: "Commander",
    kitchen: "Cuisine",
    bar: "Bar",
    noTip: "Pas de pourboire",
    customTip: "Pourboire libre",
    mostGuestsTip: "La plupart des clients laissent 10–15% — merci!",
    roundUp: "Arrondir à",
    paymentComplete: "Paiement Réussi",
    rateExperience: "Comment était votre expérience?",
    shareReceipt: "Partager le reçu",
    server: "Serveur",
    table: "Table",
    items: "articles",
    vegan: "Végan",
    vegetarian: "Végétarien",
    glutenFree: "Sans gluten",
    halal: "Halal",
    containsNuts: "Contient noix",
    dairyFree: "Sans lactose",
    orderSent: "Commande envoyée à",
    preparing: "En préparation",
  },
};

// --- Demo Data ---

function getDemoTable(): TableData {
  const merchantData = ensureMerchantDemoData();
  return {
    tableNumber: 7,
    merchant: "Mama Oliech Restaurant",
    till: "874521",
    server: "Grace M.",
    openedAt: new Date(Date.now() - 45 * 60000).toISOString(),
    items: [
      {
        id: "i1",
        name: "Nyama Choma (500g)",
        price: 850,
        qty: 1,
        category: "Main",
      },
      { id: "i2", name: "Ugali", price: 100, qty: 2, category: "Side" },
      { id: "i3", name: "Sukuma Wiki", price: 80, qty: 2, category: "Side" },
      {
        id: "i4",
        name: "Tusker Lager",
        price: 250,
        qty: 3,
        category: "Drinks",
      },
      { id: "i5", name: "Coca Cola", price: 120, qty: 1, category: "Drinks" },
      { id: "i6", name: "Pilau Rice", price: 350, qty: 1, category: "Main" },
      { id: "i7", name: "Chapati", price: 50, qty: 4, category: "Side" },
    ],
    catalogue: merchantData.catalogue,
  };
}

function normaliseTableData(
  payload: EncodedTableData,
  merchantData: MerchantSnapshot,
): TableData | null {
  const tableNumber = Number(payload.tableNumber ?? payload.table);
  if (!Number.isFinite(tableNumber) || tableNumber <= 0) return null;

  return {
    tableNumber,
    merchant: payload.merchant || "Mama Oliech Restaurant",
    till: payload.till || "874521",
    server: payload.server || "Grace M.",
    openedAt: payload.openedAt || new Date().toISOString(),
    items: payload.items || [],
    quickCharge: payload.quickCharge,
    catalogue:
      payload.catalogue && payload.catalogue.length > 0
        ? payload.catalogue
        : merchantData.catalogue,
  };
}

function mapOptionToSelection(
  modifierId: string,
  modifierName: string,
  option: ModifierOption,
): SelectedModifier {
  return {
    modifierId,
    modifierName,
    optionId: option.id,
    optionLabel: option.label,
    priceAdjustment: option.priceAdjustment,
  };
}

function makeOrderKey(itemId: string, options: SelectedModifier[]) {
  const suffix =
    options
      .map((option) => option.optionId)
      .sort()
      .join(",") || "base";
  return `${itemId}::${suffix}`;
}

function getSelectionUnitPrice(selection: OrderSelection) {
  return (
    selection.basePrice +
    selection.selectedOptions.reduce(
      (sum, option) => sum + option.priceAdjustment,
      0,
    )
  );
}

// --- Main Page ---

type PageState =
  | "loading"
  | "bill"
  | "order"
  | "order-sent"
  | "split"
  | "tip"
  | "phone"
  | "processing"
  | "success"
  | "error";

function TablePayPage() {
  const [state, setState] = useState<PageState>("loading");
  const [tableData, setTableData] = useState<TableData | null>(null);
  const [merchantSnapshot, setMerchantSnapshot] =
    useState<MerchantSnapshot | null>(null);
  const [splitMode, setSplitMode] = useState<SplitMode>("full");
  const [splitCount, setSplitCount] = useState(2);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [customAmount, setCustomAmount] = useState("");
  const [tipPercent, setTipPercent] = useState(10);
  const [customTip, setCustomTip] = useState("");
  const [phone, setPhone] = useState("");
  const [payerName, setPayerName] = useState("");
  const [lang, setLang] = useState<Lang>("en");
  // Order-at-table state
  const [orderItems, setOrderItems] = useState<OrderSelection[]>([]);
  const [orderSentTo, setOrderSentTo] = useState<string[]>([]);
  const [menuSchedules, setMenuSchedules] = useState<MenuSchedule[]>([]);
  // PesaSwap payment state
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const startTimeRef = useRef<number>(0);
  const qrScannedAtRef = useRef<string>("");

  // Preload HyperLoader
  useEffect(() => {
    loadHyperLoader().catch(() => {});
  }, []);

  const t = TRANSLATIONS[lang];

  // Detect browser language
  useEffect(() => {
    if (typeof window === "undefined") return;
    const browserLang = navigator.language.slice(0, 2);
    if (browserLang === "sw") setLang("sw");
    else if (browserLang === "fr") setLang("fr");
  }, []);

  // Parse URL for table QR data
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const tableParam = params.get("t");
    qrScannedAtRef.current = new Date().toISOString();
    const merchantData = ensureMerchantDemoData();
    setMerchantSnapshot(merchantData);
    setMenuSchedules(merchantData.menuSchedules);

    const withMerchantCatalogue = (data: TableData) => ({
      ...data,
      catalogue:
        data.catalogue && data.catalogue.length > 0
          ? data.catalogue
          : merchantData.catalogue,
    });

    if (tableParam) {
      try {
        const data = JSON.parse(atob(tableParam)) as EncodedTableData;
        setTableData(
          normaliseTableData(data, merchantData) ||
            withMerchantCatalogue(getDemoTable()),
        );
        setState("bill");
      } catch {
        // Invalid - use demo
        setTableData(getDemoTable());
        setState("bill");
      }
    } else {
      // Demo mode
      setTimeout(() => {
        setTableData(getDemoTable());
        setState("bill");
      }, 800);
    }
  }, []);

  const totalBill = useMemo(
    () =>
      tableData?.quickCharge ??
      tableData?.items.reduce((s, i) => s + i.price * i.qty, 0) ??
      0,
    [tableData],
  );
  const activeSchedule = useMemo(
    () => getActiveMenuSchedule(menuSchedules),
    [menuSchedules],
  );

  const mySubtotal = useMemo(() => {
    if (splitMode === "full") return totalBill;
    if (splitMode === "equal") return Math.ceil(totalBill / splitCount);
    if (splitMode === "by-item") {
      return (
        tableData?.items
          .filter((i) => selectedItems.has(i.id))
          .reduce((s, i) => s + i.price * i.qty, 0) ?? 0
      );
    }
    if (splitMode === "custom") return Number(customAmount) || 0;
    return totalBill;
  }, [
    splitMode,
    totalBill,
    splitCount,
    selectedItems,
    customAmount,
    tableData,
  ]);

  const tipAmount = useMemo(() => {
    if (customTip) return Number(customTip) || 0;
    return Math.round(mySubtotal * (tipPercent / 100));
  }, [mySubtotal, tipPercent, customTip]);

  const myTotal = mySubtotal + tipAmount;

  const remainingBalance = totalBill - mySubtotal;

  function proceedToTip() {
    setState("tip");
  }

  function proceedToPhone() {
    setState("phone");
  }

  async function processPayment() {
    if (phone.length < 9 || !tableData) return;
    setState("processing");
    setErrorMsg("");
    startTimeRef.current = Date.now();

    const metadata = buildPaymentMetadata({
      merchant: { name: tableData.merchant, till: tableData.till },
      flow: tableData.quickCharge ? "quick_charge" : "table",
      customer: { phone, name: payerName || undefined },
      table: {
        number: tableData.tableNumber,
        server: tableData.server,
      },
      items: tableData.items.map((i) => ({
        name: i.name,
        qty: i.qty,
        price: i.price,
        category: i.category,
      })),
      split: {
        type:
          splitMode === "by-item"
            ? "by_item"
            : (splitMode as "full" | "equal" | "custom"),
        totalParties: splitMode === "equal" ? splitCount : 1,
        index: 1,
      },
      tip:
        tipAmount > 0
          ? { amount: tipAmount, recipient: tableData.server }
          : undefined,
      qrScannedAt: qrScannedAtRef.current,
    });

    const result = await executePayment({
      amount: myTotal,
      currency: "KES",
      metadata,
      phone,
      onStatusChange: (status: PaymentStatus) => {
        if (status === "processing") setState("processing");
      },
    });

    if (result.success) {
      setPaymentId(result.payment_id || null);
      setState("success");
    } else {
      setErrorMsg(result.error || "Payment failed. Please try again.");
      setState("error");
    }
  }

  function reset() {
    setState("bill");
    setSplitMode("full");
    setSplitCount(2);
    setSelectedItems(new Set());
    setCustomAmount("");
    setTipPercent(10);
    setCustomTip("");
    setPhone("");
    setPayerName("");
    setOrderItems([]);
    setOrderSentTo([]);
    setPaymentId(null);
    setErrorMsg("");
  }

  function retryPayment() {
    setErrorMsg("");
    setState("phone");
  }

  function placeOrder() {
    if (!tableData || orderItems.length === 0) return;
    const destinations = new Set<string>();
    const nextItems: TableItem[] = [...tableData.items];

    orderItems.forEach((selection) => {
      destinations.add(
        selection.destination ||
          (selection.category === "Drinks" || selection.category === "Cocktails"
            ? "bar"
            : "kitchen"),
      );
      nextItems.push({
        id: `order-${selection.key}-${Date.now()}`,
        name: selection.name,
        price: getSelectionUnitPrice(selection),
        qty: selection.quantity,
        category: selection.category,
        dietary: selection.dietary,
        destination: selection.destination,
        image: selection.image,
        description: selection.description,
        selectedModifiers: selection.selectedOptions,
      });
    });

    setTableData({ ...tableData, items: nextItems });
    setOrderSentTo(Array.from(destinations));
    setOrderItems([]);
    setState("order-sent");
    // Auto-return to bill after 3s
    setTimeout(() => setState("bill"), 3000);
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Header with language toggle */}
        <div className="text-center mb-4">
          <div className="inline-flex items-center gap-2 rounded-full bg-foreground text-background px-4 py-2 mb-2">
            <Receipt className="size-4" />
            <span className="text-sm font-bold font-mono">
              PesaSwap {t.tablePay}
            </span>
          </div>
          {/* Language toggle */}
          <div className="flex items-center justify-center gap-1 mt-1">
            {(["en", "sw", "fr"] as Lang[]).map((l) => (
              <button
                key={l}
                onClick={() => setLang(l)}
                className={`px-2 py-0.5 rounded text-[9px] font-semibold ${lang === l ? "bg-foreground text-background" : "text-muted-foreground"}`}
              >
                {l === "en" ? "EN" : l === "sw" ? "SW" : "FR"}
              </button>
            ))}
          </div>
        </div>

        {state === "loading" && <LoadingState />}
        {state === "bill" && tableData && (
          <BillView
            table={tableData}
            total={totalBill}
            onProceed={() => setState("split")}
            onOrder={() => setState("order")}
            t={t}
          />
        )}
        {state === "order" && tableData && (
          <OrderView
            table={tableData}
            orderItems={orderItems}
            setOrderItems={setOrderItems}
            activeSchedule={activeSchedule}
            menus={merchantSnapshot?.menus || []}
            zones={merchantSnapshot?.zones || []}
            categoryOrder={merchantSnapshot?.categoryOrder || []}
            onBack={() => setState("bill")}
            onPlace={placeOrder}
            t={t}
          />
        )}
        {state === "order-sent" && (
          <OrderSentState destinations={orderSentTo} t={t} />
        )}
        {state === "split" && tableData && (
          <SplitView
            table={tableData}
            total={totalBill}
            splitMode={splitMode}
            setSplitMode={setSplitMode}
            splitCount={splitCount}
            setSplitCount={setSplitCount}
            selectedItems={selectedItems}
            setSelectedItems={setSelectedItems}
            customAmount={customAmount}
            setCustomAmount={setCustomAmount}
            mySubtotal={mySubtotal}
            remainingBalance={remainingBalance}
            onBack={() => setState("bill")}
            onProceed={proceedToTip}
          />
        )}
        {state === "tip" && tableData && (
          <TipView
            server={tableData.server}
            subtotal={mySubtotal}
            tipPercent={tipPercent}
            setTipPercent={setTipPercent}
            customTip={customTip}
            setCustomTip={setCustomTip}
            tipAmount={tipAmount}
            myTotal={myTotal}
            onBack={() => setState("split")}
            onProceed={proceedToPhone}
          />
        )}
        {state === "phone" && (
          <PhoneView
            myTotal={myTotal}
            phone={phone}
            setPhone={setPhone}
            payerName={payerName}
            setPayerName={setPayerName}
            onBack={() => setState("tip")}
            onPay={processPayment}
          />
        )}
        {state === "processing" && <ProcessingState />}
        {state === "error" && (
          <PaymentErrorState
            message={errorMsg}
            onRetry={retryPayment}
            onCancel={reset}
            lang={lang}
          />
        )}
        {state === "success" && tableData && (
          <SuccessState
            table={tableData}
            myTotal={myTotal}
            tipAmount={tipAmount}
            phone={phone}
            payerName={payerName}
            paymentId={paymentId}
            elapsedMs={Date.now() - startTimeRef.current}
            remainingBalance={remainingBalance}
            onDone={reset}
          />
        )}
      </div>
    </div>
  );
}

// --- Sub-components ---

function LoadingState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 space-y-4">
      <div className="size-12 border-4 border-foreground border-t-transparent rounded-full animate-spin" />
      <p className="text-sm text-muted-foreground font-mono">
        Loading table bill...
      </p>
    </div>
  );
}

function BillView({
  table,
  total,
  onProceed,
  onOrder,
  t,
}: {
  table: TableData;
  total: number;
  onProceed: () => void;
  onOrder: () => void;
  t: Record<string, string>;
}) {
  const [expanded, setExpanded] = useState(true);
  const elapsed = Math.round(
    (Date.now() - new Date(table.openedAt).getTime()) / 60000,
  );

  return (
    <div className="space-y-4">
      {/* Table info */}
      <div className="rounded-2xl bg-muted p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-lg font-bold">{table.merchant}</p>
            <p className="text-sm text-muted-foreground">
              {t.table} {table.tableNumber} · {t.server}: {table.server}
            </p>
          </div>
          <div className="size-12 rounded-full bg-foreground text-background flex items-center justify-center text-lg font-bold">
            {table.tableNumber}
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground mt-2 font-mono">
          Opened {elapsed} min ago · Till {table.till}
        </p>
      </div>

      {/* Items or amount */}
      {table.items.length > 0 ? (
        <div className="rounded-2xl border border-border overflow-hidden">
          <button
            onClick={() => setExpanded(!expanded)}
            className="w-full flex items-center justify-between px-4 py-3 bg-card"
          >
            <span className="text-sm font-semibold">
              {t.yourBill} ({table.items.length} {t.items})
            </span>
            {expanded ? (
              <ChevronUp className="size-4" />
            ) : (
              <ChevronDown className="size-4" />
            )}
          </button>

          {expanded && (
            <div className="divide-y divide-border">
              {table.items.map((item) => (
                <div
                  key={item.id}
                  className="px-4 py-2.5 flex items-center justify-between"
                >
                  <div>
                    <p className="text-sm font-medium">{item.name}</p>
                    <div className="flex items-center gap-1">
                      <p className="text-[10px] text-muted-foreground">
                        {item.category} · Qty: {item.qty}
                      </p>
                      {item.dietary && item.dietary.length > 0 && (
                        <span className="text-[9px]">
                          {item.dietary
                            .map((d) =>
                              d === "vegan"
                                ? "🌱"
                                : d === "vegetarian"
                                  ? "🥬"
                                  : d === "gluten-free"
                                    ? "🌾✗"
                                    : d === "halal"
                                      ? "☪"
                                      : d === "contains-nuts"
                                        ? "🥜"
                                        : "🥛✗",
                            )
                            .join("")}
                        </span>
                      )}
                    </div>
                    {item.selectedModifiers?.length ? (
                      <p className="text-[10px] text-muted-foreground">
                        {item.selectedModifiers
                          .map((option) => option.optionLabel)
                          .join(" · ")}
                      </p>
                    ) : null}
                  </div>
                  <p className="text-sm font-mono font-bold">
                    {(item.price * item.qty).toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-2xl border border-border p-6 text-center">
          <p className="text-sm text-muted-foreground">
            Amount charged by merchant
          </p>
        </div>
      )}

      {/* Total */}
      <div className="rounded-2xl bg-foreground text-background p-4 flex items-center justify-between">
        <span className="font-semibold">{t.total}</span>
        <span className="text-2xl font-bold font-mono">
          KES {total.toLocaleString()}
        </span>
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={onOrder}
          className="flex-1 border-2 border-foreground text-foreground py-3.5 rounded-2xl text-sm font-bold flex items-center justify-center gap-2"
        >
          <Plus className="size-4" />
          {t.orderMore}
        </button>
        <button
          onClick={onProceed}
          className="flex-1 bg-emerald-600 text-white py-3.5 rounded-2xl text-sm font-bold flex items-center justify-center gap-2"
        >
          <Zap className="size-4" />
          {t.payNow}
        </button>
      </div>

      <div className="flex items-center gap-2 justify-center text-[10px] text-muted-foreground">
        <ShieldCheck className="size-3" />
        <span>Secured by PesaSwap · Instant M-Pesa checkout</span>
      </div>
    </div>
  );
}

// --- Order at Table View ---
function OrderView({
  table,
  orderItems,
  setOrderItems,
  activeSchedule,
  menus,
  zones,
  categoryOrder,
  onBack,
  onPlace,
  t,
}: {
  table: TableData;
  orderItems: OrderSelection[];
  setOrderItems: (items: OrderSelection[]) => void;
  activeSchedule: MenuSchedule | null;
  menus: Menu[];
  zones: Zone[];
  categoryOrder: string[];
  onBack: () => void;
  onPlace: () => void;
  t: Record<string, string>;
}) {
  const menu = table.catalogue || [];
  const visibleMenu = getVisibleCatalogueForTable({
    catalogue: menu,
    menus,
    zones,
    tableNumber: table.tableNumber,
    activeSchedule,
  });
  const categories = getOrderedCategories(
    visibleMenu.map((item) => item.category || "Other"),
    categoryOrder,
  );
  const activeZone = getTableZone(zones, table.tableNumber);
  const [filterCat, setFilterCat] = useState<string>("All");
  const filteredMenu =
    filterCat === "All"
      ? visibleMenu
      : visibleMenu.filter((i) => i.category === filterCat);
  const [modifierItem, setModifierItem] = useState<CatalogueItem | null>(null);
  const [selectedModifierOptions, setSelectedModifierOptions] = useState<
    Record<string, string>
  >({});
  const [lastAddedItemId, setLastAddedItemId] = useState<string | null>(null);

  const orderTotal = orderItems.reduce(
    (sum, item) => sum + getSelectionUnitPrice(item) * item.quantity,
    0,
  );
  const suggestedItems = useMemo(() => {
    if (!lastAddedItemId) return [];
    const sourceItem = visibleMenu.find((item) => item.id === lastAddedItemId);
    if (!sourceItem?.linkedProductIds?.length) return [];
    return sourceItem.linkedProductIds
      .map((linkedId) => visibleMenu.find((item) => item.id === linkedId))
      .filter(
        (item): item is CatalogueItem =>
          item != null && (item.available ?? true) !== false,
      )
      .slice(0, 3);
  }, [lastAddedItemId, visibleMenu]);

  useEffect(() => {
    if (filterCat !== "All" && !categories.includes(filterCat)) {
      setFilterCat("All");
    }
  }, [categories, filterCat]);

  function setDefaultModifierSelections(item: CatalogueItem) {
    const defaults = Object.fromEntries(
      (item.modifiers || [])
        .filter((modifier) => modifier.options[0])
        .map((modifier) => [modifier.id, modifier.options[0].id]),
    );
    setSelectedModifierOptions(defaults);
  }

  function addSelection(
    item: CatalogueItem,
    selectedOptions: SelectedModifier[],
  ) {
    const key = makeOrderKey(item.id, selectedOptions);
    const existing = orderItems.find((entry) => entry.key === key);

    if (existing) {
      setOrderItems(
        orderItems.map((entry) =>
          entry.key === key
            ? { ...entry, quantity: entry.quantity + 1 }
            : entry,
        ),
      );
      setLastAddedItemId(item.id);
      return;
    }

    setOrderItems([
      ...orderItems,
      {
        key,
        itemId: item.id,
        name: item.name,
        basePrice: item.price,
        quantity: 1,
        category: item.category,
        dietary: item.dietary,
        destination: item.destination,
        image: item.image,
        description: item.description,
        selectedOptions,
      },
    ]);
    setLastAddedItemId(item.id);
  }

  function addItem(item: CatalogueItem) {
    if ((item.available ?? true) === false) return;
    if (item.modifiers?.length) {
      setModifierItem(item);
      setDefaultModifierSelections(item);
      return;
    }
    addSelection(item, []);
  }

  function confirmModifierSelection() {
    if (!modifierItem) return;
    const selectedOptions = (modifierItem.modifiers || [])
      .map((modifier) => {
        const optionId = selectedModifierOptions[modifier.id];
        const option = modifier.options.find((entry) => entry.id === optionId);
        return option
          ? mapOptionToSelection(modifier.id, modifier.name, option)
          : null;
      })
      .filter(Boolean) as SelectedModifier[];

    addSelection(modifierItem, selectedOptions);
    setModifierItem(null);
  }

  function changeQuantity(key: string, delta: number) {
    const existing = orderItems.find((entry) => entry.key === key);
    if (!existing) return;
    const nextQty = existing.quantity + delta;
    if (nextQty <= 0) {
      setOrderItems(orderItems.filter((entry) => entry.key !== key));
      return;
    }

    setOrderItems(
      orderItems.map((entry) =>
        entry.key === key ? { ...entry, quantity: nextQty } : entry,
      ),
    );
  }

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="text-sm text-muted-foreground">
        ← {t.back}
      </button>
      <p className="text-lg font-bold">{t.orderMore}</p>
      <p className="text-xs text-muted-foreground">
        {t.table} {table.tableNumber} · Orders route to {t.kitchen} or {t.bar}{" "}
        automatically
      </p>
      {activeSchedule ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700">
          {activeSchedule.name} is active · Showing{" "}
          {activeSchedule.categories.join(", ")}
        </div>
      ) : null}
      {activeZone ? (
        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-3 text-xs text-blue-700">
          Zone detected: {activeZone.name} · Tables {activeZone.tableRange[0]}–
          {activeZone.tableRange[1]}
        </div>
      ) : null}

      {/* Category filter */}
      <div className="flex gap-1 overflow-x-auto pb-1">
        <button
          onClick={() => setFilterCat("All")}
          className={`px-3 py-1.5 rounded-full text-[10px] font-semibold whitespace-nowrap ${filterCat === "All" ? "bg-foreground text-background" : "bg-muted"}`}
        >
          All
        </button>
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setFilterCat(cat)}
            className={`px-3 py-1.5 rounded-full text-[10px] font-semibold whitespace-nowrap ${filterCat === cat ? "bg-foreground text-background" : "bg-muted"}`}
          >
            {cat === "Drinks" || cat === "Cocktails" ? "🍺 " : "🍳 "}
            {cat}
          </button>
        ))}
      </div>

      {/* Menu items */}
      <div className="space-y-1 max-h-64 overflow-y-auto">
        {filteredMenu.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border px-4 py-5 text-center text-xs text-muted-foreground">
            No items available for this schedule.
          </div>
        ) : null}
        {filteredMenu.map((item) => {
          const itemSelections = orderItems.filter(
            (entry) => entry.itemId === item.id,
          );
          const qty = itemSelections.reduce(
            (sum, entry) => sum + entry.quantity,
            0,
          );
          const isAvailable = item.available ?? true;
          return (
            <div
              key={item.id}
              className={`flex items-center justify-between gap-3 py-2.5 px-3 rounded-xl border border-border ${isAvailable ? "" : "bg-muted/40 opacity-70"}`}
            >
              <div className="flex-1">
                <p
                  className={`text-xs font-medium ${isAvailable ? "" : "line-through text-muted-foreground"}`}
                >
                  {item.destination === "bar" ||
                  item.category === "Drinks" ||
                  item.category === "Cocktails"
                    ? "🍺"
                    : "🍳"}{" "}
                  {item.name}
                </p>
                <div className="flex items-center gap-1.5">
                  <p className="text-[10px] font-mono text-muted-foreground">
                    KES {item.price}
                  </p>
                  {item.dietary && item.dietary.length > 0 && (
                    <span className="text-[8px]">
                      {item.dietary
                        .map((d) =>
                          d === "vegan"
                            ? "🌱"
                            : d === "vegetarian"
                              ? "🥬"
                              : d === "gluten-free"
                                ? "🌾✗"
                                : d === "halal"
                                  ? "☪"
                                  : d === "contains-nuts"
                                    ? "🥜"
                                    : "🥛✗",
                        )
                        .join("")}
                    </span>
                  )}
                  <span className="text-[8px] text-muted-foreground">
                    →{" "}
                    {item.destination === "bar" ||
                    item.category === "Drinks" ||
                    item.category === "Cocktails"
                      ? t.bar
                      : t.kitchen}
                  </span>
                  {item.modifiers?.length ? (
                    <span className="text-[8px] text-emerald-700">
                      Modifiers
                    </span>
                  ) : null}
                </div>
                {item.description ? (
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {item.description}
                  </p>
                ) : null}
                {!isAvailable ? (
                  <span className="mt-2 inline-flex rounded-full bg-red-500 px-2 py-0.5 text-[9px] font-semibold text-white">
                    Sold Out
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                {qty > 0 && (
                  <>
                    <button
                      onClick={() => {
                        const latestSelection =
                          itemSelections[itemSelections.length - 1];
                        if (latestSelection)
                          changeQuantity(latestSelection.key, -1);
                      }}
                      className="size-6 rounded-full border border-border flex items-center justify-center"
                    >
                      <Minus className="size-3" />
                    </button>
                    <span className="text-xs font-bold w-4 text-center">
                      {qty}
                    </span>
                  </>
                )}
                <button
                  onClick={() => addItem(item)}
                  disabled={!isAvailable}
                  className="size-6 rounded-full bg-emerald-600 text-white flex items-center justify-center disabled:bg-slate-300"
                >
                  <Plus className="size-3" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Order summary */}
      {orderItems.length > 0 && (
        <div className="rounded-2xl bg-foreground text-background p-4 space-y-2">
          <div className="space-y-2">
            {orderItems.map((item) => (
              <div key={item.key} className="rounded-xl bg-white/10 p-2">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold">{item.name}</p>
                    {item.selectedOptions.length ? (
                      <p className="text-[10px] text-white/70">
                        {item.selectedOptions
                          .map((option) => option.optionLabel)
                          .join(" · ")}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => changeQuantity(item.key, -1)}
                      className="size-6 rounded-full border border-white/30 flex items-center justify-center"
                    >
                      <Minus className="size-3" />
                    </button>
                    <span className="text-xs font-bold w-4 text-center">
                      {item.quantity}
                    </span>
                    <button
                      onClick={() => changeQuantity(item.key, 1)}
                      className="size-6 rounded-full bg-emerald-500 text-white flex items-center justify-center"
                    >
                      <Plus className="size-3" />
                    </button>
                  </div>
                </div>
                <p className="mt-1 text-[10px] font-mono text-white/80">
                  KES{" "}
                  {(
                    getSelectionUnitPrice(item) * item.quantity
                  ).toLocaleString()}
                </p>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">
              {orderItems.length} {t.items}
            </span>
            <span className="text-lg font-bold font-mono">
              KES {orderTotal.toLocaleString()}
            </span>
          </div>
          <button
            onClick={onPlace}
            className="w-full bg-emerald-500 text-white py-3 rounded-xl text-sm font-bold"
          >
            {t.placeOrder} →
          </button>
        </div>
      )}

      {suggestedItems.length > 0 ? (
        <div className="space-y-2">
          <p className="text-sm font-semibold">Goes well with...</p>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {suggestedItems.map((item) => (
              <button
                key={item.id}
                onClick={() => addItem(item)}
                className="min-w-[180px] rounded-2xl border border-border bg-card p-3 text-left"
              >
                <p className="text-sm font-semibold">{item.name}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {item.category}
                </p>
                <p className="mt-3 text-sm font-mono font-bold">
                  KES {item.price.toLocaleString()}
                </p>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {modifierItem ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-3xl bg-background p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-lg font-bold">{modifierItem.name}</p>
                <p className="text-xs text-muted-foreground">
                  Choose your options before adding to order.
                </p>
              </div>
              <button
                onClick={() => setModifierItem(null)}
                className="rounded-full border border-border p-2"
              >
                <X className="size-4" />
              </button>
            </div>

            {modifierItem.image ? (
              <img
                src={modifierItem.image}
                alt={modifierItem.name}
                className="mt-4 h-32 w-full rounded-2xl object-cover"
              />
            ) : (
              <div className="mt-4 flex h-32 items-center justify-center rounded-2xl border border-dashed border-border bg-muted/30 text-muted-foreground">
                <ImageIcon className="size-8" />
              </div>
            )}

            <div className="mt-4 space-y-4">
              {(modifierItem.modifiers || []).map((modifier) => (
                <div key={modifier.id} className="space-y-2">
                  <p className="text-sm font-semibold">{modifier.name}</p>
                  <div className="space-y-2">
                    {modifier.options.map((option) => {
                      const checked =
                        selectedModifierOptions[modifier.id] === option.id;
                      return (
                        <button
                          key={option.id}
                          onClick={() =>
                            setSelectedModifierOptions((current) => ({
                              ...current,
                              [modifier.id]: option.id,
                            }))
                          }
                          className={`flex w-full items-center justify-between rounded-2xl border px-3 py-2 text-left ${checked ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-border"}`}
                        >
                          <span className="text-sm font-medium">
                            {option.label}
                          </span>
                          <span className="text-xs font-mono">
                            {option.priceAdjustment > 0
                              ? `+KES ${option.priceAdjustment}`
                              : "+KES 0"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            <button
              onClick={confirmModifierSelection}
              className="mt-5 w-full rounded-2xl bg-emerald-600 py-3 text-sm font-bold text-white"
            >
              {t.addToOrder}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// --- Order Sent Confirmation ---
function OrderSentState({
  destinations,
  t,
}: {
  destinations: string[];
  t: Record<string, string>;
}) {
  return (
    <div className="text-center py-12 space-y-4">
      <div className="text-5xl animate-bounce">✅</div>
      <p className="text-lg font-bold">{t.orderSent}:</p>
      <div className="flex items-center justify-center gap-3">
        {destinations.map((d) => (
          <span
            key={d}
            className={`px-4 py-2 rounded-xl text-sm font-bold ${d === "bar" ? "bg-purple-100 text-purple-800" : "bg-orange-100 text-orange-800"}`}
          >
            {d === "bar" ? "🍺 " + t.bar : "🍳 " + t.kitchen}
          </span>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{t.preparing}...</p>
    </div>
  );
}

function SplitView({
  table,
  total,
  splitMode,
  setSplitMode,
  splitCount,
  setSplitCount,
  selectedItems,
  setSelectedItems,
  customAmount,
  setCustomAmount,
  mySubtotal,
  remainingBalance,
  onBack,
  onProceed,
}: {
  table: TableData;
  total: number;
  splitMode: SplitMode;
  setSplitMode: (m: SplitMode) => void;
  splitCount: number;
  setSplitCount: (n: number) => void;
  selectedItems: Set<string>;
  setSelectedItems: (s: Set<string>) => void;
  customAmount: string;
  setCustomAmount: (s: string) => void;
  mySubtotal: number;
  remainingBalance: number;
  onBack: () => void;
  onProceed: () => void;
}) {
  const splitOptions: {
    mode: SplitMode;
    icon: typeof Receipt;
    label: string;
    desc: string;
  }[] = [
    {
      mode: "full",
      icon: Receipt,
      label: "Pay full bill",
      desc: "I'll cover everything",
    },
    {
      mode: "equal",
      icon: Users,
      label: "Split equally",
      desc: "Divide evenly among group",
    },
    ...(table.items.length > 0
      ? [
          {
            mode: "by-item" as SplitMode,
            icon: SplitSquareVertical,
            label: "Pay for my items",
            desc: "Select what I ordered",
          },
        ]
      : []),
    {
      mode: "custom",
      icon: Percent,
      label: "Custom amount",
      desc: "Enter specific amount",
    },
  ];

  function toggleItem(id: string) {
    const next = new Set(selectedItems);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedItems(next);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="text-sm text-muted-foreground">
          ← Back
        </button>
        <p className="text-[10px] font-mono text-muted-foreground">
          Total: KES {total.toLocaleString()}
        </p>
      </div>

      <p className="text-lg font-bold">How would you like to pay?</p>

      {/* Split mode selector */}
      <div className="grid grid-cols-2 gap-2">
        {splitOptions.map((opt) => (
          <button
            key={opt.mode}
            onClick={() => setSplitMode(opt.mode)}
            className={`p-3 rounded-xl border text-left transition-all ${
              splitMode === opt.mode
                ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30"
                : "border-border"
            }`}
          >
            <opt.icon
              className={`size-4 mb-1 ${splitMode === opt.mode ? "text-emerald-600" : "text-muted-foreground"}`}
            />
            <p className="text-xs font-semibold">{opt.label}</p>
            <p className="text-[9px] text-muted-foreground">{opt.desc}</p>
          </button>
        ))}
      </div>

      {/* Split equal controls */}
      {splitMode === "equal" && (
        <div className="rounded-2xl border border-border p-4 space-y-3">
          <p className="text-xs font-semibold">How many people?</p>
          <div className="flex items-center gap-4">
            <button
              onClick={() => setSplitCount(Math.max(2, splitCount - 1))}
              className="size-10 rounded-full border border-border flex items-center justify-center"
            >
              <Minus className="size-4" />
            </button>
            <span className="text-3xl font-bold font-mono w-12 text-center">
              {splitCount}
            </span>
            <button
              onClick={() => setSplitCount(Math.min(12, splitCount + 1))}
              className="size-10 rounded-full border border-border flex items-center justify-center"
            >
              <Plus className="size-4" />
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            Each person pays:{" "}
            <span className="font-bold font-mono">
              KES {Math.ceil(total / splitCount).toLocaleString()}
            </span>
          </p>
        </div>
      )}

      {/* By-item picker */}
      {splitMode === "by-item" && (
        <div className="rounded-2xl border border-border overflow-hidden max-h-48 overflow-y-auto">
          <p className="text-[10px] font-mono uppercase text-muted-foreground px-4 pt-3 pb-1">
            Tap items you ordered
          </p>
          {table.items.map((item) => (
            <button
              key={item.id}
              onClick={() => toggleItem(item.id)}
              className={`w-full px-4 py-2.5 flex items-center justify-between border-t border-border transition-colors ${
                selectedItems.has(item.id)
                  ? "bg-emerald-50 dark:bg-emerald-950/20"
                  : ""
              }`}
            >
              <div className="flex items-center gap-3">
                <div
                  className={`size-5 rounded-full border-2 flex items-center justify-center ${
                    selectedItems.has(item.id)
                      ? "border-emerald-500 bg-emerald-500"
                      : "border-border"
                  }`}
                >
                  {selectedItems.has(item.id) && (
                    <CheckCircle2 className="size-3 text-white" />
                  )}
                </div>
                <div className="text-left">
                  <p className="text-xs font-medium">{item.name}</p>
                  <p className="text-[9px] text-muted-foreground">
                    Qty: {item.qty}
                  </p>
                </div>
              </div>
              <span className="text-xs font-mono font-bold">
                {(item.price * item.qty).toLocaleString()}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Custom amount */}
      {splitMode === "custom" && (
        <div className="rounded-2xl border border-border p-4 space-y-2">
          <p className="text-xs font-semibold">Enter your share</p>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground font-mono">KES</span>
            <input
              type="tel"
              value={customAmount}
              onChange={(e) =>
                setCustomAmount(e.target.value.replace(/[^0-9]/g, ""))
              }
              placeholder="0"
              className="flex-1 bg-transparent text-2xl font-mono font-bold outline-none"
              max={total}
            />
          </div>
          {Number(customAmount) > total && (
            <p className="text-[10px] text-red-500">
              Amount exceeds total bill
            </p>
          )}
        </div>
      )}

      {/* My subtotal summary */}
      <div className="rounded-2xl bg-muted p-4 space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Your share</span>
          <span className="font-bold font-mono">
            KES {mySubtotal.toLocaleString()}
          </span>
        </div>
        {splitMode !== "full" && (
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Remaining on table</span>
            <span className="font-mono text-amber-600">
              KES {remainingBalance.toLocaleString()}
            </span>
          </div>
        )}
      </div>

      <button
        onClick={onProceed}
        disabled={
          mySubtotal <= 0 ||
          (splitMode === "custom" && Number(customAmount) > total)
        }
        className="w-full bg-emerald-600 text-white py-4 rounded-2xl text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-40"
      >
        Continue — KES {mySubtotal.toLocaleString()}
      </button>
    </div>
  );
}

function TipView({
  server,
  subtotal,
  tipPercent,
  setTipPercent,
  customTip,
  setCustomTip,
  tipAmount,
  myTotal,
  onBack,
  onProceed,
}: {
  server: string;
  subtotal: number;
  tipPercent: number;
  setTipPercent: (n: number) => void;
  customTip: string;
  setCustomTip: (s: string) => void;
  tipAmount: number;
  myTotal: number;
  onBack: () => void;
  onProceed: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="text-sm text-muted-foreground">
          ← Back
        </button>
        <p className="text-[10px] font-mono text-muted-foreground">
          Step 3 of 4
        </p>
      </div>

      <div className="text-center space-y-2">
        <div className="size-14 rounded-full bg-amber-100 mx-auto flex items-center justify-center">
          <Heart className="size-7 text-amber-600" />
        </div>
        <p className="text-lg font-bold">Leave a tip for {server}?</p>
        <p className="text-xs text-muted-foreground">
          Tips go directly to your server via M-Pesa
        </p>
        <p className="text-[10px] text-emerald-600 font-medium">
          💡 Most guests tip 10–15% — you're awesome!
        </p>
      </div>

      {/* Tip options */}
      <div className="grid grid-cols-5 gap-2">
        {TIP_OPTIONS.map((opt) => (
          <button
            key={opt.percent}
            onClick={() => {
              setTipPercent(opt.percent);
              setCustomTip("");
            }}
            className={`py-3 rounded-xl border text-center transition-all ${
              tipPercent === opt.percent && !customTip
                ? "border-amber-500 bg-amber-50 dark:bg-amber-950/30"
                : "border-border"
            }`}
          >
            <p className="text-xs font-bold">{opt.label}</p>
            {opt.percent > 0 && (
              <p className="text-[9px] text-muted-foreground font-mono">
                {Math.round((subtotal * opt.percent) / 100)}
              </p>
            )}
          </button>
        ))}
      </div>

      {/* Custom tip */}
      <div className="rounded-xl border border-border p-3 flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Custom tip: KES</span>
        <input
          type="tel"
          value={customTip}
          onChange={(e) => {
            setCustomTip(e.target.value.replace(/[^0-9]/g, ""));
            setTipPercent(0);
          }}
          placeholder="0"
          className="flex-1 bg-transparent text-sm font-mono font-bold outline-none text-right"
        />
      </div>

      {/* Summary */}
      <div className="rounded-2xl bg-muted p-4 space-y-2">
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">Subtotal</span>
          <span className="font-mono">KES {subtotal.toLocaleString()}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">Tip for {server}</span>
          <span className="font-mono text-amber-600">
            + KES {tipAmount.toLocaleString()}
          </span>
        </div>
        <div className="h-px bg-border" />
        <div className="flex justify-between text-sm font-bold">
          <span>You pay</span>
          <span className="font-mono">KES {myTotal.toLocaleString()}</span>
        </div>
        {/* Round-up suggestion */}
        {(() => {
          const roundTo = Math.ceil(myTotal / 100) * 100;
          const diff = roundTo - myTotal;
          if (diff > 0 && diff <= 50 && diff !== tipAmount) {
            return (
              <button
                onClick={() => {
                  setCustomTip(String(tipAmount + diff));
                  setTipPercent(0);
                }}
                className="w-full text-[10px] text-emerald-600 bg-emerald-50 dark:bg-emerald-950/20 py-1.5 rounded-lg mt-1"
              >
                Round up to KES {roundTo.toLocaleString()}? (+{diff})
              </button>
            );
          }
          return null;
        })()}
      </div>

      <button
        onClick={onProceed}
        className="w-full bg-emerald-600 text-white py-4 rounded-2xl text-sm font-bold"
      >
        Continue to pay KES {myTotal.toLocaleString()}
      </button>

      {tipPercent === 0 && !customTip && (
        <button
          onClick={onProceed}
          className="w-full text-xs text-muted-foreground underline text-center"
        >
          Skip tip
        </button>
      )}
    </div>
  );
}

function PhoneView({
  myTotal,
  phone,
  setPhone,
  payerName,
  setPayerName,
  onBack,
  onPay,
}: {
  myTotal: number;
  phone: string;
  setPhone: (s: string) => void;
  payerName: string;
  setPayerName: (s: string) => void;
  onBack: () => void;
  onPay: () => void;
}) {
  const [payMethod, setPayMethod] = useState<
    "mpesa" | "card" | "apple" | "google"
  >("mpesa");

  const methods = [
    { id: "mpesa" as const, label: "M-Pesa", icon: "📱", desc: "STK Push" },
    { id: "card" as const, label: "Card", icon: "💳", desc: "Visa/MC" },
    { id: "apple" as const, label: "Apple Pay", icon: "🍎", desc: "Touch ID" },
    { id: "google" as const, label: "Google Pay", icon: "🟢", desc: "GPay" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="text-sm text-muted-foreground">
          ← Back
        </button>
        <p className="text-[10px] font-mono text-muted-foreground">
          Step 4 of 4
        </p>
      </div>

      <p className="text-lg font-bold">Confirm & Pay</p>

      {/* Payment method selector */}
      <div className="space-y-2">
        <p className="text-[10px] font-mono uppercase text-muted-foreground">
          Payment method
        </p>
        <div className="grid grid-cols-4 gap-1.5">
          {methods.map((m) => (
            <button
              key={m.id}
              onClick={() => setPayMethod(m.id)}
              className={`py-2.5 px-1 rounded-xl border text-center transition-all ${
                payMethod === m.id
                  ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30"
                  : "border-border"
              }`}
            >
              <p className="text-base">{m.icon}</p>
              <p className="text-[9px] font-semibold mt-0.5">{m.label}</p>
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-border p-4 space-y-3">
        <div>
          <p className="text-[10px] font-mono uppercase text-muted-foreground mb-1">
            Your name (optional)
          </p>
          <input
            type="text"
            value={payerName}
            onChange={(e) => setPayerName(e.target.value)}
            placeholder="e.g. John"
            className="w-full bg-muted rounded-xl px-4 py-3 text-sm outline-none"
          />
        </div>

        {payMethod === "mpesa" && (
          <div>
            <p className="text-[10px] font-mono uppercase text-muted-foreground mb-1">
              M-Pesa number
            </p>
            <div className="flex items-center gap-2 bg-muted rounded-xl px-4 py-3">
              <span className="text-sm font-mono text-muted-foreground">
                +254
              </span>
              <input
                type="tel"
                value={phone}
                onChange={(e) =>
                  setPhone(e.target.value.replace(/[^0-9]/g, "").slice(0, 9))
                }
                placeholder="7XX XXX XXX"
                className="flex-1 bg-transparent text-sm font-mono font-bold outline-none"
              />
            </div>
          </div>
        )}

        {payMethod === "card" && (
          <div className="space-y-2">
            <div>
              <p className="text-[10px] font-mono uppercase text-muted-foreground mb-1">
                Card number
              </p>
              <input
                type="tel"
                placeholder="4242 4242 4242 4242"
                className="w-full bg-muted rounded-xl px-4 py-3 text-sm font-mono outline-none"
              />
            </div>
            <div className="flex gap-2">
              <input
                type="tel"
                placeholder="MM/YY"
                className="flex-1 bg-muted rounded-xl px-4 py-3 text-sm font-mono outline-none"
              />
              <input
                type="tel"
                placeholder="CVV"
                className="w-20 bg-muted rounded-xl px-4 py-3 text-sm font-mono outline-none"
              />
            </div>
          </div>
        )}

        {(payMethod === "apple" || payMethod === "google") && (
          <div className="rounded-xl bg-muted p-4 text-center">
            <p className="text-2xl mb-1">
              {payMethod === "apple" ? "🍎" : "🟢"}
            </p>
            <p className="text-xs text-muted-foreground">
              {payMethod === "apple"
                ? "Tap to pay with Apple Pay"
                : "Tap to pay with Google Pay"}
            </p>
            <p className="text-[10px] text-muted-foreground mt-1">
              Biometric confirmation required
            </p>
          </div>
        )}
      </div>

      <div className="rounded-2xl bg-foreground text-background p-4 flex items-center justify-between">
        <span className="font-semibold">Total</span>
        <span className="text-xl font-bold font-mono">
          KES {myTotal.toLocaleString()}
        </span>
      </div>

      <p className="text-[10px] text-center text-muted-foreground">
        {payMethod === "mpesa" &&
          "An M-Pesa STK push will be sent to your phone for PIN confirmation"}
        {payMethod === "card" &&
          "Your card will be charged securely via PCI-DSS compliant gateway"}
        {payMethod === "apple" &&
          "Authenticate with Face ID or Touch ID to confirm"}
        {payMethod === "google" && "Authenticate with your device to confirm"}
      </p>

      <button
        onClick={onPay}
        disabled={payMethod === "mpesa" ? phone.length < 9 : false}
        className="w-full bg-emerald-600 text-white py-4 rounded-2xl text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-40"
      >
        <Zap className="size-5" />
        Pay KES {myTotal.toLocaleString()}
      </button>

      <div className="flex items-center gap-2 justify-center text-[10px] text-muted-foreground">
        <ShieldCheck className="size-3" />
        <span>256-bit encryption · PCI-DSS Level 1</span>
      </div>
    </div>
  );
}

function ProcessingState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 space-y-4">
      <div className="size-16 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      <p className="text-sm font-semibold">Processing payment...</p>
      <p className="text-xs text-muted-foreground text-center">
        Confirming via PesaSwap — check your phone for M-Pesa prompt
      </p>
    </div>
  );
}

function PaymentErrorState({
  message,
  onRetry,
  onCancel,
  lang,
}: {
  message: string;
  onRetry: () => void;
  onCancel: () => void;
  lang: string;
}) {
  return (
    <div className="space-y-5">
      <div className="flex flex-col items-center py-8 space-y-4">
        <div className="size-20 rounded-full bg-red-100 flex items-center justify-center">
          <AlertCircle className="size-12 text-red-600" />
        </div>
        <div className="text-center">
          <p className="text-lg font-bold text-red-700">
            {lang === "sw"
              ? "Malipo yameshindikana"
              : lang === "fr"
                ? "Paiement échoué"
                : "Payment failed"}
          </p>
          <p className="text-sm text-muted-foreground mt-2">{message}</p>
        </div>
      </div>

      <button
        onClick={onRetry}
        className="w-full bg-foreground text-background py-4 rounded-2xl text-sm font-bold flex items-center justify-center gap-2"
      >
        <Zap className="size-4" />
        {lang === "sw"
          ? "Jaribu tena"
          : lang === "fr"
            ? "Réessayer"
            : "Try Again"}
      </button>

      <button
        onClick={onCancel}
        className="w-full border border-border py-3 rounded-2xl text-sm text-muted-foreground"
      >
        {lang === "sw" ? "Ghairi" : lang === "fr" ? "Annuler" : "Cancel"}
      </button>
    </div>
  );
}

function SuccessState({
  table,
  myTotal,
  tipAmount,
  phone,
  payerName,
  paymentId,
  elapsedMs,
  remainingBalance,
  onDone,
}: {
  table: TableData;
  myTotal: number;
  tipAmount: number;
  phone: string;
  payerName: string;
  paymentId: string | null;
  elapsedMs: number;
  remainingBalance: number;
  onDone: () => void;
}) {
  const [showReview, setShowReview] = useState(false);
  const [rating, setRating] = useState(0);
  const [reviewSubmitted, setReviewSubmitted] = useState(false);

  const receiptRef = paymentId || `TP${Date.now().toString(36).toUpperCase()}`;
  const receiptTime = new Date().toLocaleTimeString();
  const elapsedSec = Math.round(elapsedMs / 1000);

  const receiptText = [
    `🧾 PesaSwap Receipt`,
    `━━━━━━━━━━━━━━━`,
    `${table.merchant}`,
    `Table #${table.tableNumber}`,
    ...(payerName ? [`Paid by: ${payerName}`] : []),
    `Phone: +254 ${phone.slice(0, 3)}***${phone.slice(-2)}`,
    `━━━━━━━━━━━━━━━`,
    `Subtotal: KES ${(myTotal - tipAmount).toLocaleString()}`,
    ...(tipAmount > 0
      ? [`Tip (${table.server}): KES ${tipAmount.toLocaleString()}`]
      : []),
    `Total: KES ${myTotal.toLocaleString()}`,
    `━━━━━━━━━━━━━━━`,
    `Ref: ${receiptRef}`,
    `Time: ${receiptTime}`,
    `Method: M-Pesa via PesaSwap`,
    ``,
    `Powered by PesaSwap`,
  ].join("\n");

  function shareReceipt() {
    if (navigator.share) {
      navigator.share({
        title: `Receipt — ${table.merchant}`,
        text: receiptText,
      });
    } else {
      navigator.clipboard.writeText(receiptText);
      alert("Receipt copied to clipboard!");
    }
  }

  function submitReview() {
    setReviewSubmitted(true);
    // In production: deeplink to Google Maps review page
    // window.open(`https://search.google.com/local/writereview?placeid=PLACE_ID`);
  }

  // Show review prompt 2 seconds after success
  useEffect(() => {
    const timer = setTimeout(() => setShowReview(true), 2000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-center py-5 space-y-3">
        <div className="size-20 rounded-full bg-emerald-100 flex items-center justify-center">
          <CheckCircle2 className="size-12 text-emerald-600" />
        </div>
        <div className="text-center">
          <p className="text-lg font-bold text-emerald-700">
            Payment successful!
          </p>
          <p className="text-2xl font-bold font-mono mt-1">
            KES {myTotal.toLocaleString()}
          </p>
        </div>
      </div>

      {/* Receipt */}
      <div className="rounded-2xl bg-muted p-4 space-y-2">
        {[
          ["Merchant", table.merchant],
          ["Table", `#${table.tableNumber}`],
          ...(payerName ? [["Paid by", payerName]] : []),
          [
            "Phone",
            phone ? `+254 ${phone.slice(0, 3)}***${phone.slice(-2)}` : "—",
          ],
          ["Subtotal", `KES ${(myTotal - tipAmount).toLocaleString()}`],
          ...(tipAmount > 0
            ? [["Tip for " + table.server, `KES ${tipAmount.toLocaleString()}`]]
            : []),
          ["Total paid", `KES ${myTotal.toLocaleString()}`],
          ["Reference", receiptRef],
          ["Time", receiptTime],
        ].map(([k, v]) => (
          <div key={k} className="flex justify-between text-[11px]">
            <span className="text-muted-foreground">{k}</span>
            <span className="font-mono font-semibold">{v}</span>
          </div>
        ))}
      </div>

      {/* Share receipt button */}
      <button
        onClick={shareReceipt}
        className="w-full border border-border py-3 rounded-2xl text-xs font-semibold flex items-center justify-center gap-2"
      >
        <Share2 className="size-3.5" />
        Share receipt
      </button>

      {remainingBalance > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/20 p-3 text-center">
          <p className="text-xs text-amber-700 dark:text-amber-400">
            Remaining on table:{" "}
            <span className="font-bold font-mono">
              KES {remainingBalance.toLocaleString()}
            </span>
          </p>
          <p className="text-[10px] text-amber-600 dark:text-amber-500 mt-0.5">
            Others in your group can scan the same QR to pay their share
          </p>
        </div>
      )}

      {/* Review prompt */}
      {showReview && !reviewSubmitted && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 dark:bg-amber-950/20 p-4 space-y-3 animate-in fade-in slide-in-from-bottom-2">
          <p className="text-sm font-semibold text-center">
            How was your experience?
          </p>
          <div className="flex justify-center gap-1">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                onClick={() => setRating(star)}
                className="p-1"
              >
                <Star
                  className={`size-8 transition-colors ${
                    star <= rating
                      ? "text-amber-500 fill-amber-500"
                      : "text-muted-foreground"
                  }`}
                />
              </button>
            ))}
          </div>
          {rating > 0 && (
            <button
              onClick={submitReview}
              className="w-full bg-amber-500 text-white py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2"
            >
              <ExternalLink className="size-3.5" />
              {rating >= 4 ? "Leave a Google review" : "Send feedback"}
            </button>
          )}
          <button
            onClick={() => setShowReview(false)}
            className="w-full text-[10px] text-muted-foreground text-center"
          >
            Maybe later
          </button>
        </div>
      )}

      {reviewSubmitted && (
        <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/20 p-3 text-center">
          <p className="text-xs text-emerald-700">
            Thank you for your feedback! 🙏
          </p>
        </div>
      )}

      <button
        onClick={onDone}
        className="w-full border border-border py-3 rounded-2xl text-sm font-semibold"
      >
        Done
      </button>
    </div>
  );
}
