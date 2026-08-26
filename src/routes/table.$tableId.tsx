import { createFileRoute } from "@tanstack/react-router";
import {
  CalendarDays,
  Building2,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Clock3,
  Copy,
  CreditCard,
  MessageSquareText,
  Minus,
  Phone,
  Plus,
  Receipt,
  Share2,
  ShoppingCart,
  Sparkles,
  Star,
  Store,
  Users,
  UtensilsCrossed,
  X,
} from "lucide-react";
import { ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { BNPLCheckout } from "@/components/merchant/features/BNPLCheckout";
import type {
  BNPLTransaction,
  CatalogueItem,
  StaffMember,
  TableCombination,
} from "@/components/merchant/features/types";
import { executePayment, buildPaymentMetadata } from "@/lib/pesaswap-payments";
import {
  ensureMerchantDemoData,
  getActiveMenuSchedule,
  getCombinationTables,
  getLiveCombinationForTable,
  getTableZone,
  getVisibleCatalogueForTable,
  readStorage,
  writeStorage,
  type MerchantReview,
  type MerchantSnapshot,
  type MerchantTable,
  type MerchantTableItem,
} from "@/lib/merchant-dashboard";
import { generateOrderId, submitNewOrder } from "@/lib/realtime";
import { tipTierNotice, tipTiersFor } from "@/lib/tip-tiers";

export const Route = createFileRoute("/table/$tableId")({
  component: TableCustomerPage,
});

type CustomerScreen =
  | "menu"
  | "cart"
  | "order-placed"
  | "bill"
  | "pay"
  | "success";

type SplitMode = "full" | "equal" | "by-item" | "custom";
// "none", "custom", or the index of the suggested tier being offered. The tiers
// themselves are derived from the bill's auto-gratuity (A3.2), so they are not a
// fixed list any more.
type TipValue = "none" | "custom" | number;
type FulfilmentMode = "dine-in" | "collection";

type SelectedModifier = {
  modifierId: string;
  modifierName: string;
  optionId: string;
  optionName: string;
  price: number;
};

type CartItem = {
  key: string;
  itemId: string;
  name: string;
  description?: string;
  category: string;
  image?: string;
  dietary?: string[];
  quantity: number;
  basePrice: number;
  notes: string;
  selectedOptions: SelectedModifier[];
};

type BillItem = CartItem & {
  orderedAt: string;
  source: "existing" | "new-order";
};

type StoredPayment = {
  id: string;
  createdAt: string;
  amountPaid: number;
  tipAmount: number;
  totalCharged: number;
  phone: string;
  method: "mpesa" | "bnpl";
  splitMode: SplitMode;
  status: "success";
};

type PreOrderRecord = {
  tableId: string;
  items: CartItem[];
  scheduledFor: string;
  fulfilment: FulfilmentMode;
  createdAt: string;
};

type CustomerReviewRecord = {
  id: string;
  createdAt: string;
  paymentId: string;
  tableId: string;
  serverId?: string;
  serverName: string;
  rating: MerchantReview["rating"];
  comment: string;
  tags: string[];
};

type PaymentReceipt = {
  id: string;
  paidAt: string;
  amountPaid: number;
  tipAmount: number;
  totalCharged: number;
  phone: string;
  method?: "mpesa" | "bnpl";
  coopReference?: string;
  monthlyPayment?: number;
  tenure?: number;
  customerName?: string;
};

type EncodedTablePayload = {
  tableId?: string;
  tableNumber?: string;
  table?: string;
};

const ORDER_STATUS_KEY_SUFFIX = ".status";
const BILL_KEY_SUFFIX = ".bill";
const PAYMENTS_KEY_SUFFIX = ".payments";
const PREORDER_KEY_SUFFIX = ".preorder";
const RECEIPT_KEY_SUFFIX = ".receipt";
const REVIEW_KEY_SUFFIX = ".reviews";
const ARRIVAL_KEY_SUFFIX = ".arrival";

const REVIEW_TAGS = ["Food", "Service", "Speed", "Atmosphere", "Value"];
const OPEN_HOUR = 8;
const CLOSE_HOUR = 22;

function TableCustomerPage() {
  const { tableId } = Route.useParams();
  const [snapshot, setSnapshot] = useState<MerchantSnapshot | null>(null);
  const [screen, setScreen] = useState<CustomerScreen>("menu");
  const [activeCategory, setActiveCategory] = useState<string>("All");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [billItems, setBillItems] = useState<BillItem[]>([]);
  const [activeCombination, setActiveCombination] =
    useState<TableCombination | null>(null);
  const [payments, setPayments] = useState<StoredPayment[]>([]);
  const [staffMember, setStaffMember] = useState<StaffMember | null>(null);
  const [arrivalAt, setArrivalAt] = useState<string>(defaultArrivalTime());
  const [fulfilment, setFulfilment] = useState<FulfilmentMode>("dine-in");
  const [splitMode, setSplitMode] = useState<SplitMode>("full");
  const [splitCount, setSplitCount] = useState<number>(2);
  const [customAmount, setCustomAmount] = useState<string>("");
  const [selectedBillKeys, setSelectedBillKeys] = useState<string[]>([]);
  // Index 1 = the middle suggestion, so a tip stays pre-selected as before.
  const [tipSelection, setTipSelection] = useState<TipValue>(1);
  const [customTip, setCustomTip] = useState<string>("");
  const [phone, setPhone] = useState<string>("");
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<
    "mpesa" | "bnpl"
  >("mpesa");
  const [reviewRating, setReviewRating] = useState<number>(0);
  const [reviewComment, setReviewComment] = useState<string>("");
  const [reviewTags, setReviewTags] = useState<string[]>([]);
  const [reviewSubmitted, setReviewSubmitted] = useState<boolean>(false);
  const [paymentError, setPaymentError] = useState<string>("");
  const [orderNote, setOrderNote] = useState<string>("");
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  const [latestReceipt, setLatestReceipt] = useState<PaymentReceipt | null>(
    null,
  );
  const [justAddedToken, setJustAddedToken] = useState<number>(0);
  const [preorderLoaded, setPreorderLoaded] = useState<boolean>(false);
  const [modifierItem, setModifierItem] = useState<CatalogueItem | null>(null);
  const [modifierSelections, setModifierSelections] = useState<
    Record<string, string>
  >({});
  const [modifierNotes, setModifierNotes] = useState<string>("");
  const [modifierError, setModifierError] = useState<string>("");
  const [hydrated, setHydrated] = useState(false);

  const orderTimeoutRef = useRef<number | null>(null);
  const tableNumber = useMemo(() => {
    const normalized = Number.parseInt(tableId, 10);
    return Number.isFinite(normalized) ? normalized : null;
  }, [tableId]);

  const cartKey = `pesaswap.table.${tableId}.cart`;
  const billKey = `${cartKey}${BILL_KEY_SUFFIX}`;
  const paymentsKey = `${cartKey}${PAYMENTS_KEY_SUFFIX}`;
  const statusKey = `${cartKey}${ORDER_STATUS_KEY_SUFFIX}`;
  const preorderKey = `${cartKey}${PREORDER_KEY_SUFFIX}`;
  const arrivalKey = `${cartKey}${ARRIVAL_KEY_SUFFIX}`;
  const receiptKey = `${cartKey}${RECEIPT_KEY_SUFFIX}`;
  const reviewKey = `${cartKey}${REVIEW_KEY_SUFFIX}`;

  useEffect(() => {
    const merchantSnapshot = ensureMerchantDemoData();
    const query = getSearchParams();
    const explicitPreorder = query.get("preorder") === "true";
    const encodedPayload = parseEncodedPayload(query.get("t"));
    const resolvedTableNumber =
      tableNumber ??
      normalizeTableNumber(
        encodedPayload.tableNumber ??
          encodedPayload.tableId ??
          encodedPayload.table,
      );

    const currentTable = findTable(
      merchantSnapshot.tables,
      resolvedTableNumber ?? normalizeTableNumber(tableId),
    );
    const liveCombination =
      resolvedTableNumber != null
        ? getLiveCombinationForTable(
            merchantSnapshot.tableCombinations,
            merchantSnapshot.reservations,
            resolvedTableNumber,
          )
        : null;
    const billingItems: MerchantTableItem[] = liveCombination
      ? getCombinationTables(liveCombination, merchantSnapshot.tables).flatMap(
          (table) => table.items,
        )
      : (currentTable?.items ?? []);
    const initialBill = hydrateBillItems(
      readStorage<BillItem[]>(billKey, []),
      billingItems,
    );
    const storedCart = readStorage<CartItem[]>(cartKey, []);
    const storedPayments = readStorage<StoredPayment[]>(paymentsKey, []);
    const storedReceipt = readStorage<PaymentReceipt | null>(receiptKey, null);
    const storedArrival = readStorage<string>(arrivalKey, defaultArrivalTime());
    const storedStatus = readStorage<string>(statusKey, "");
    const storedPreorder = readStorage<PreOrderRecord | null>(
      preorderKey,
      null,
    );
    const resolvedStaff = hydrateStaff(merchantSnapshot.staffMembers);
    const assignedStaff = findAssignedStaff(
      resolvedStaff,
      currentTable,
      resolvedTableNumber ?? tableNumber,
    );
    const schedule = getActiveMenuSchedule(
      merchantSnapshot.menuSchedules,
      new Date(),
    );
    const outsideHours = !isWithinRestaurantHours(new Date()) || !schedule;
    const isPreorderMode = explicitPreorder || outsideHours;
    const canLoadPreorder =
      !isPreorderMode &&
      storedPreorder &&
      Array.isArray(storedPreorder.items) &&
      storedPreorder.items.length > 0;

    setSnapshot(merchantSnapshot);
    setStaffMember(assignedStaff);
    setBillItems(initialBill);
    setActiveCombination(liveCombination);
    setPayments(storedPayments);
    setLatestReceipt(storedReceipt);
    setArrivalAt(storedArrival);
    setFulfilment(storedPreorder?.fulfilment ?? "dine-in");
    setPhone(readStorage<string>("pesaswap.customer.phone", ""));
    setCart(
      canLoadPreorder && storedCart.length === 0
        ? storedPreorder.items
        : storedCart,
    );
    setPreorderLoaded(Boolean(canLoadPreorder && storedCart.length === 0));
    setScreen(resolveInitialScreen(initialBill, storedCart, storedStatus));
    setHydrated(true);
  }, [
    arrivalKey,
    billKey,
    cartKey,
    paymentsKey,
    preorderKey,
    receiptKey,
    statusKey,
    tableId,
    tableNumber,
  ]);

  useEffect(() => {
    if (!hydrated) return;
    writeStorage(cartKey, cart);
  }, [cart, cartKey, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    writeStorage(billKey, billItems);
  }, [billItems, billKey, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    writeStorage(paymentsKey, payments);
  }, [hydrated, payments, paymentsKey]);

  useEffect(() => {
    if (!hydrated) return;
    writeStorage(receiptKey, latestReceipt);
  }, [hydrated, latestReceipt, receiptKey]);

  useEffect(() => {
    if (!hydrated) return;
    writeStorage(arrivalKey, arrivalAt);
  }, [arrivalAt, arrivalKey, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    writeStorage("pesaswap.customer.phone", phone);
  }, [hydrated, phone]);

  useEffect(() => {
    if (!hydrated || !snapshot) return;
    const isPreorderMode = isPreorderActive(snapshot);
    if (isPreorderMode && cart.length > 0) {
      writeStorage<PreOrderRecord>(preorderKey, {
        tableId,
        createdAt: new Date().toISOString(),
        fulfilment,
        items: cart,
        scheduledFor: arrivalAt,
      });
      return;
    }

    if (!isPreorderMode && preorderLoaded) {
      removeStorage(preorderKey);
    }
  }, [
    arrivalAt,
    cart,
    fulfilment,
    hydrated,
    preorderKey,
    preorderLoaded,
    snapshot,
    tableId,
  ]);

  useEffect(() => {
    return () => {
      if (orderTimeoutRef.current) {
        window.clearTimeout(orderTimeoutRef.current);
      }
    };
  }, []);

  const currentTable = useMemo(() => {
    if (!snapshot || tableNumber === null) return null;
    return findTable(snapshot.tables, tableNumber);
  }, [snapshot, tableNumber]);

  const activeSchedule = useMemo(() => {
    if (!snapshot) return null;
    return getActiveMenuSchedule(snapshot.menuSchedules, new Date());
  }, [snapshot]);

  const preOrderMode = useMemo(() => {
    if (!snapshot) return false;
    return isPreorderActive(snapshot);
  }, [snapshot]);

  const activeZone = useMemo(() => {
    if (!snapshot || tableNumber === null) return null;
    return getTableZone(snapshot.zones, tableNumber);
  }, [snapshot, tableNumber]);

  const visibleCatalogue = useMemo(() => {
    if (!snapshot || tableNumber === null) return [];
    return getVisibleCatalogueForTable({
      activeSchedule,
      catalogue: snapshot.catalogue,
      menus: snapshot.menus,
      tableNumber,
      zones: snapshot.zones,
    });
  }, [activeSchedule, snapshot, tableNumber]);

  const categoryNames = useMemo(() => {
    const categories = new Set<string>(["All"]);
    visibleCatalogue.forEach((item) => categories.add(item.category));
    return Array.from(categories);
  }, [visibleCatalogue]);

  const filteredCatalogue = useMemo(() => {
    if (activeCategory === "All") return visibleCatalogue;
    return visibleCatalogue.filter((item) => item.category === activeCategory);
  }, [activeCategory, visibleCatalogue]);

  const cartQuantity = useMemo(
    () => cart.reduce((total, item) => total + item.quantity, 0),
    [cart],
  );

  const cartSubtotal = useMemo(
    () => cart.reduce((total, item) => total + cartLineTotal(item), 0),
    [cart],
  );

  const billSubtotal = useMemo(
    () => billItems.reduce((total, item) => total + cartLineTotal(item), 0),
    [billItems],
  );

  const billPaid = useMemo(
    () => payments.reduce((total, payment) => total + payment.amountPaid, 0),
    [payments],
  );

  const outstandingAmount = useMemo(
    () => Math.max(billSubtotal - billPaid, 0),
    [billPaid, billSubtotal],
  );

  const selectedByItemSubtotal = useMemo(() => {
    const selected = new Set(selectedBillKeys);
    return billItems.reduce((total, item) => {
      if (!selected.has(item.key)) return total;
      return total + cartLineTotal(item);
    }, 0);
  }, [billItems, selectedBillKeys]);

  const payerSubtotal = useMemo(() => {
    if (splitMode === "equal") {
      return roundCurrency(outstandingAmount / Math.max(splitCount, 1));
    }
    if (splitMode === "custom") {
      return clampCurrency(
        Number.parseFloat(customAmount) || 0,
        outstandingAmount,
      );
    }
    if (splitMode === "by-item") {
      return clampCurrency(selectedByItemSubtotal, outstandingAmount);
    }
    return outstandingAmount;
  }, [
    customAmount,
    outstandingAmount,
    selectedByItemSubtotal,
    splitCount,
    splitMode,
  ]);

  // A3.2 — suggestions adapt to any service charge / auto-gratuity already on
  // the bill. This surface has no POS-imported service-charge line yet (that
  // arrives with C5), so it is zero and the standard 20/23/25% options apply.
  const billServiceCharge = 0;
  const tipPlan = useMemo(
    () => tipTiersFor(payerSubtotal, billServiceCharge),
    [billServiceCharge, payerSubtotal],
  );
  const tipNotice = useMemo(() => tipTierNotice(tipPlan), [tipPlan]);

  const tipAmount = useMemo(() => {
    if (tipSelection === "custom") {
      return Math.max(Number.parseFloat(customTip) || 0, 0);
    }
    if (tipSelection === "none") return 0;
    return roundCurrency(tipPlan.tiers[tipSelection]?.amount ?? 0);
  }, [customTip, tipPlan, tipSelection]);

  const totalCharge = useMemo(
    () => roundCurrency(payerSubtotal + tipAmount),
    [payerSubtotal, tipAmount],
  );

  const billStatus = useMemo(() => {
    const latestOrder = billItems
      .map((item) => new Date(item.orderedAt).getTime())
      .sort((left, right) => right - left)[0];

    if (billItems.length === 0) return "No open bill yet";
    if (outstandingAmount <= 0) return "Bill settled";
    if (!latestOrder) return "Order received";

    const minutes = Math.round((Date.now() - latestOrder) / 60000);
    if (minutes < 3) return "Order sent to kitchen";
    if (minutes < 12) return "Kitchen is preparing your food";
    if (minutes < 25) return "Almost ready";
    return "Enjoy your meal";
  }, [billItems, outstandingAmount]);

  const preOrderSummary = useMemo(() => {
    if (!preOrderMode) return "";
    if (!arrivalAt) return "Choose when you'd like to arrive.";
    return `${fulfilment === "collection" ? "Collection" : "Dine-in"} for ${formatDateTime(
      arrivalAt,
    )}`;
  }, [arrivalAt, fulfilment, preOrderMode]);

  const canPlaceOrder = cart.length > 0;
  const canPay =
    selectedPaymentMethod === "mpesa" &&
    !isProcessingPayment &&
    payerSubtotal > 0 &&
    totalCharge > 0 &&
    phone.trim().length >= 10;

  if (tableNumber === null) {
    return (
      <main className="min-h-screen bg-slate-950 px-4 py-8 text-white">
        <CenteredShell>
          <StateCard
            title="Invalid table"
            subtitle="We couldn't recognise that table number."
          >
            <button
              className="mt-4 h-12 rounded-2xl bg-emerald-500 px-4 font-semibold text-slate-950"
              onClick={() => window.location.assign("/table")}
              type="button"
            >
              Go back
            </button>
          </StateCard>
        </CenteredShell>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto flex min-h-screen w-full max-w-[390px] flex-col px-4 pb-32 pt-5">
        <header className="rounded-[28px] border border-white/10 bg-gradient-to-br from-slate-900 via-slate-900 to-emerald-950/60 p-5 shadow-xl shadow-black/20">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-white/6 px-3 py-1 text-xs text-slate-200">
                <Store className="h-3.5 w-3.5" />
                Table {tableNumber}
                {activeZone ? ` · ${activeZone.name}` : ""}
              </div>
              {activeCombination ? (
                <div className="mt-2 inline-flex items-center gap-2 rounded-full bg-emerald-400/15 px-3 py-1 text-xs font-medium text-emerald-200">
                  <Users className="h-3.5 w-3.5" />
                  Combined bill · {activeCombination.name} (Tables{" "}
                  {activeCombination.tableNumbers.join(", ")})
                </div>
              ) : null}
              <h1 className="mt-3 text-2xl font-semibold">
                Order, tip, and pay in one flow
              </h1>
              <p className="mt-2 text-sm text-slate-300">
                Browse the zone menu, keep your cart close, then settle your
                bill without leaving this screen.
              </p>
            </div>
            <button
              className="rounded-full border border-white/10 bg-white/5 p-3 text-slate-200"
              onClick={() => window.location.assign("/table")}
              type="button"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-4 space-y-3">
            {preOrderMode ? (
              <Banner tone="amber">
                <div className="flex items-center gap-2">
                  <Clock3 className="h-4 w-4" />
                  <span className="font-medium">Pre-Order for Later</span>
                </div>
                <p className="mt-1 text-sm text-amber-50/90">
                  {preOrderSummary ||
                    "Build your order now and finish it when you arrive."}
                </p>
              </Banner>
            ) : null}

            {preorderLoaded ? (
              <Banner tone="emerald">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4" />
                  <span className="font-medium">Saved pre-order loaded</span>
                </div>
                <p className="mt-1 text-sm text-emerald-50/90">
                  Your saved items are back in the cart for table {tableNumber}.
                </p>
              </Banner>
            ) : null}

            {staffMember ? (
              <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-3">
                <AvatarLabel
                  image={staffMember.avatar}
                  name={staffMember.name}
                  size="md"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-white">
                    Your host: {staffMember.name}
                  </p>
                  <p className="text-xs text-slate-300">
                    Tip goes directly to {staffMember.name}
                    {staffMember.phone ? ` · ${staffMember.phone}` : ""}
                  </p>
                </div>
              </div>
            ) : null}
          </div>
        </header>

        <section className="mt-4 flex-1 space-y-4">
          {screen === "menu" ? (
            <>
              {preOrderMode ? (
                <ArrivalPlanner
                  arrivalAt={arrivalAt}
                  fulfilment={fulfilment}
                  onArrivalChange={setArrivalAt}
                  onFulfilmentChange={setFulfilment}
                />
              ) : null}

              <div className="flex gap-2 overflow-x-auto pb-1">
                {categoryNames.map((category) => (
                  <button
                    className={`h-10 shrink-0 rounded-full px-4 text-sm font-medium transition ${
                      activeCategory === category
                        ? "bg-emerald-500 text-slate-950"
                        : "border border-white/10 bg-white/5 text-slate-200"
                    }`}
                    key={category}
                    onClick={() => setActiveCategory(category)}
                    type="button"
                  >
                    {category}
                  </button>
                ))}
              </div>

              <div className="space-y-3">
                {filteredCatalogue.length > 0 ? (
                  filteredCatalogue.map((item) => (
                    <button
                      className="block w-full rounded-[24px] border border-white/10 bg-white/5 p-0 text-left transition hover:border-emerald-400/40"
                      key={item.id}
                      onClick={() =>
                        (item.modifiers?.length ?? 0) > 0
                          ? openModifierSheet(item)
                          : addCatalogueItem(item)
                      }
                      type="button"
                    >
                      <div className="flex gap-3 p-3">
                        <div className="h-24 w-24 overflow-hidden rounded-2xl bg-slate-800">
                          {item.image ? (
                            <img
                              alt={item.name}
                              className="h-full w-full object-cover"
                              src={item.image}
                            />
                          ) : (
                            <div className="flex h-full items-center justify-center bg-slate-900 text-slate-400">
                              <UtensilsCrossed className="h-7 w-7" />
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-base font-semibold text-white">
                                {item.name}
                              </p>
                              <p className="mt-1 text-sm text-slate-300 line-clamp-2">
                                {item.description}
                              </p>
                            </div>
                            <div className="text-sm font-semibold text-emerald-300">
                              {formatMoney(item.price)}
                            </div>
                          </div>

                          <div className="mt-3 flex items-center justify-between gap-3">
                            <div className="flex flex-wrap gap-2">
                              {(item.dietary ?? []).slice(0, 3).map((tag) => (
                                <span
                                  className="rounded-full bg-white/8 px-2.5 py-1 text-[11px] text-slate-200"
                                  key={`${item.id}-${tag}`}
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                            <span className="inline-flex h-11 items-center gap-2 rounded-full bg-emerald-500 px-4 text-sm font-semibold text-slate-950">
                              <Plus className="h-4 w-4" />
                              Quick add
                            </span>
                          </div>
                        </div>
                      </div>
                    </button>
                  ))
                ) : (
                  <StateCard
                    subtitle="No menu items are available for this table right now."
                    title="Menu unavailable"
                  />
                )}
              </div>
            </>
          ) : null}

          {screen === "cart" ? (
            <SectionCard
              action={
                <button
                  className="text-sm font-medium text-emerald-300"
                  onClick={() => setScreen("menu")}
                  type="button"
                >
                  Add more
                </button>
              }
              icon={<ShoppingCart className="h-5 w-5" />}
              subtitle="Adjust quantities, add notes, and get ready to place your order."
              title="Your cart"
            >
              {preOrderMode ? (
                <ArrivalPlanner
                  arrivalAt={arrivalAt}
                  fulfilment={fulfilment}
                  onArrivalChange={setArrivalAt}
                  onFulfilmentChange={setFulfilment}
                />
              ) : null}

              {cart.length > 0 ? (
                <div className="space-y-3">
                  {cart.map((item) => (
                    <div
                      className="rounded-2xl border border-white/10 bg-white/5 p-3"
                      key={item.key}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium text-white">{item.name}</p>
                          <p className="mt-1 text-sm text-slate-300">
                            {item.selectedOptions.length > 0
                              ? item.selectedOptions
                                  .map((option) => option.optionName)
                                  .join(", ")
                              : "No modifiers selected"}
                          </p>
                          {item.notes ? (
                            <p className="mt-2 text-xs text-amber-200">
                              Note: {item.notes}
                            </p>
                          ) : null}
                        </div>
                        <div className="text-sm font-semibold text-emerald-300">
                          {formatMoney(cartLineTotal(item))}
                        </div>
                      </div>

                      <div className="mt-3 flex items-center justify-between gap-3">
                        <div className="inline-flex items-center gap-3 rounded-full border border-white/10 bg-slate-900 px-3 py-2">
                          <button
                            className="text-slate-200"
                            onClick={() =>
                              updateCartItemQuantity(
                                item.key,
                                item.quantity - 1,
                              )
                            }
                            type="button"
                          >
                            <Minus className="h-4 w-4" />
                          </button>
                          <span className="min-w-6 text-center text-sm font-semibold">
                            {item.quantity}
                          </span>
                          <button
                            className="text-slate-200"
                            onClick={() =>
                              updateCartItemQuantity(
                                item.key,
                                item.quantity + 1,
                              )
                            }
                            type="button"
                          >
                            <Plus className="h-4 w-4" />
                          </button>
                        </div>
                        <button
                          className="text-sm text-slate-300"
                          onClick={() => removeFromCart(item.key)}
                          type="button"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}

                  <label className="block text-sm text-slate-200">
                    Order instructions
                    <textarea
                      className="mt-2 min-h-24 w-full rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-white outline-none transition focus:border-emerald-400"
                      onChange={(event) => setOrderNote(event.target.value)}
                      placeholder="Allergy notes, kitchen requests, or anything else."
                      value={orderNote}
                    />
                  </label>

                  <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-4">
                    <div className="flex items-center justify-between text-sm text-slate-300">
                      <span>{cartQuantity} item(s)</span>
                      <span>{formatMoney(cartSubtotal)}</span>
                    </div>
                    <button
                      className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
                      disabled={!canPlaceOrder}
                      onClick={handlePlaceOrder}
                      type="button"
                    >
                      {preOrderMode ? (
                        <>
                          <CalendarDays className="h-5 w-5" />
                          Save pre-order
                        </>
                      ) : (
                        <>
                          <Sparkles className="h-5 w-5" />
                          Place order
                        </>
                      )}
                    </button>
                  </div>
                </div>
              ) : (
                <EmptyState
                  ctaLabel="Browse menu"
                  onClick={() => setScreen("menu")}
                  subtitle="Your cart is empty. Add a few favourites to get started."
                  title="Nothing in cart yet"
                />
              )}
            </SectionCard>
          ) : null}

          {screen === "order-placed" ? (
            <StateCard
              subtitle={
                preOrderMode
                  ? "Your items are saved. We'll keep them ready for when you arrive."
                  : "Your order has been sent to the team. We'll keep the bill updated here."
              }
              title={preOrderMode ? "Pre-order saved" : "Order placed"}
            >
              <div className="mt-4 flex justify-center">
                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-300 animate-pulse">
                  <CheckCircle2 className="h-10 w-10" />
                </div>
              </div>
            </StateCard>
          ) : null}

          {screen === "bill" ? (
            <SectionCard
              action={
                <button
                  className="text-sm font-medium text-emerald-300"
                  onClick={() => setScreen("menu")}
                  type="button"
                >
                  Order more
                </button>
              }
              icon={<ClipboardList className="h-5 w-5" />}
              subtitle="See everything ordered so far and track what is still left to pay."
              title="Current bill"
            >
              {billItems.length > 0 ? (
                <div className="space-y-3">
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-white">
                          {billStatus}
                        </p>
                        <p className="mt-1 text-xs text-slate-300">
                          {outstandingAmount > 0
                            ? `${formatMoney(outstandingAmount)} still open`
                            : "Everything is paid for."}
                        </p>
                      </div>
                      <div className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-300">
                        {payments.length} payment
                        {payments.length === 1 ? "" : "s"}
                      </div>
                    </div>
                  </div>

                  {billItems.map((item) => (
                    <div
                      className="rounded-2xl border border-white/10 bg-white/5 p-3"
                      key={item.key}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium text-white">
                            {item.quantity} × {item.name}
                          </p>
                          <p className="mt-1 text-sm text-slate-300">
                            {item.selectedOptions.length > 0
                              ? item.selectedOptions
                                  .map((option) => option.optionName)
                                  .join(", ")
                              : item.category}
                          </p>
                        </div>
                        <p className="text-sm font-semibold text-white">
                          {formatMoney(cartLineTotal(item))}
                        </p>
                      </div>
                    </div>
                  ))}

                  <SummaryRow
                    label="Bill total"
                    value={formatMoney(billSubtotal)}
                  />
                  <SummaryRow
                    label="Paid so far"
                    value={formatMoney(billPaid)}
                  />
                  <SummaryRow
                    highlight
                    label="Outstanding"
                    value={formatMoney(outstandingAmount)}
                  />
                </div>
              ) : (
                <EmptyState
                  ctaLabel="Start ordering"
                  onClick={() => setScreen("menu")}
                  subtitle="Once you place an order, your running bill will show up here."
                  title="No live bill yet"
                />
              )}
            </SectionCard>
          ) : null}

          {screen === "pay" ? (
            <SectionCard
              icon={<CreditCard className="h-5 w-5" />}
              subtitle="Split, tip, and enter your M-Pesa number without hopping between screens."
              title="Pay your share"
            >
              {billItems.length > 0 ? (
                <div className="space-y-4">
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <p className="text-sm font-medium text-white">
                      Split options
                    </p>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <SplitOption
                        active={splitMode === "full"}
                        label="Pay full bill"
                        onClick={() => setSplitMode("full")}
                      />
                      <SplitOption
                        active={splitMode === "equal"}
                        label="Split equally"
                        onClick={() => setSplitMode("equal")}
                      />
                      <SplitOption
                        active={splitMode === "by-item"}
                        label="Pay by item"
                        onClick={() => setSplitMode("by-item")}
                      />
                      <SplitOption
                        active={splitMode === "custom"}
                        label="Custom amount"
                        onClick={() => setSplitMode("custom")}
                      />
                    </div>

                    {splitMode === "equal" ? (
                      <div className="mt-3 flex items-center gap-3 rounded-2xl bg-slate-900 p-3">
                        <Users className="h-4 w-4 text-slate-300" />
                        <label className="flex-1 text-sm text-slate-200">
                          Number of people
                          <input
                            className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-slate-950 px-3 outline-none focus:border-emerald-400"
                            min={2}
                            onChange={(event) =>
                              setSplitCount(
                                Math.max(
                                  Number.parseInt(event.target.value, 10) || 2,
                                  2,
                                ),
                              )
                            }
                            type="number"
                            value={splitCount}
                          />
                        </label>
                      </div>
                    ) : null}

                    {splitMode === "custom" ? (
                      <label className="mt-3 block text-sm text-slate-200">
                        Custom amount
                        <input
                          className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-slate-950 px-3 outline-none focus:border-emerald-400"
                          inputMode="decimal"
                          onChange={(event) =>
                            setCustomAmount(event.target.value)
                          }
                          placeholder="0.00"
                          value={customAmount}
                        />
                      </label>
                    ) : null}

                    {splitMode === "by-item" ? (
                      <div className="mt-3 space-y-2">
                        {billItems.map((item) => (
                          <label
                            className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-slate-900 p-3"
                            key={`pay-${item.key}`}
                          >
                            <div className="flex items-center gap-3">
                              <input
                                checked={selectedBillKeys.includes(item.key)}
                                className="h-4 w-4 accent-emerald-500"
                                onChange={() => toggleBillSelection(item.key)}
                                type="checkbox"
                              />
                              <span className="text-sm text-slate-200">
                                {item.quantity} × {item.name}
                              </span>
                            </div>
                            <span className="text-sm font-medium text-white">
                              {formatMoney(cartLineTotal(item))}
                            </span>
                          </label>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 p-4">
                    <p className="text-sm font-medium text-white">
                      Tip your staff
                    </p>
                    <p className="mt-1 text-xs text-amber-100/80">
                      {staffMember?.name
                        ? `Your tip goes directly to ${staffMember.name}${
                            staffMember.phone ? ` · ${staffMember.phone}` : ""
                          }`
                        : "Add a thank-you tip for the team."}
                    </p>
                    {tipNotice ? (
                      <p className="mt-1 text-xs text-amber-100/80">
                        {tipNotice}
                      </p>
                    ) : null}
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      <button
                        className={`h-11 rounded-2xl text-sm font-semibold transition ${
                          tipSelection === "none"
                            ? "bg-amber-300 text-slate-950"
                            : "border border-amber-200/25 bg-white/5 text-amber-50"
                        }`}
                        onClick={() => setTipSelection("none")}
                        type="button"
                      >
                        None
                      </button>
                      {tipPlan.tiers.map((tier, index) => (
                        <button
                          className={`h-11 rounded-2xl text-sm font-semibold transition ${
                            tipSelection === index
                              ? "bg-amber-300 text-slate-950"
                              : "border border-amber-200/25 bg-white/5 text-amber-50"
                          }`}
                          key={tier.pct}
                          onClick={() => setTipSelection(index)}
                          type="button"
                        >
                          {tier.pct}%
                        </button>
                      ))}
                      <button
                        className={`h-11 rounded-2xl text-sm font-semibold transition ${
                          tipSelection === "custom"
                            ? "bg-amber-300 text-slate-950"
                            : "border border-amber-200/25 bg-white/5 text-amber-50"
                        }`}
                        onClick={() => setTipSelection("custom")}
                        type="button"
                      >
                        Custom
                      </button>
                    </div>

                    {tipSelection === "custom" ? (
                      <label className="mt-3 block text-sm text-slate-200">
                        Custom tip
                        <input
                          className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-slate-950 px-3 outline-none focus:border-amber-300"
                          inputMode="decimal"
                          onChange={(event) => setCustomTip(event.target.value)}
                          placeholder="0.00"
                          value={customTip}
                        />
                      </label>
                    ) : null}
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <button
                      className={`rounded-2xl border p-4 text-left transition ${
                        selectedPaymentMethod === "mpesa"
                          ? "border-[#00A651] bg-[#00A651]/10 text-white"
                          : "border-white/10 bg-white/5 text-slate-200"
                      }`}
                      onClick={() => {
                        setPaymentError("");
                        setSelectedPaymentMethod("mpesa");
                      }}
                      type="button"
                    >
                      <div className="flex items-center gap-2 text-base font-semibold">
                        <Phone className="h-4 w-4" />
                        M-Pesa
                      </div>
                      <p className="mt-2 text-sm text-slate-300">
                        Instant STK push to the customer phone.
                      </p>
                    </button>
                    <button
                      className={`rounded-2xl border p-4 text-left transition ${
                        selectedPaymentMethod === "bnpl"
                          ? "border-[#003DA5] bg-[#003DA5]/15 text-white"
                          : "border-white/10 bg-white/5 text-slate-200"
                      }`}
                      onClick={() => {
                        setPaymentError("");
                        setSelectedPaymentMethod("bnpl");
                      }}
                      type="button"
                    >
                      <div className="flex items-center gap-2 text-base font-semibold">
                        <Building2 className="h-4 w-4" />
                        Co-op BNPL
                      </div>
                      <p className="mt-2 text-sm text-slate-300">
                        Buy now and repay in flexible instalments.
                      </p>
                    </button>
                  </div>

                  {selectedPaymentMethod === "mpesa" ? (
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                      <label className="block text-sm text-slate-200">
                        M-Pesa phone number
                        <input
                          className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-slate-950 px-4 outline-none transition focus:border-[#00A651]"
                          inputMode="tel"
                          onChange={(event) => setPhone(event.target.value)}
                          placeholder="07XX XXX XXX"
                          value={phone}
                        />
                      </label>

                      <div className="mt-4 space-y-2 rounded-2xl bg-slate-900 p-4">
                        <SummaryRow
                          label="Your bill share"
                          value={formatMoney(payerSubtotal)}
                        />
                        <SummaryRow
                          label="Tip"
                          value={formatMoney(tipAmount)}
                        />
                        <SummaryRow
                          highlight
                          label="M-Pesa charge"
                          value={formatMoney(totalCharge)}
                        />
                      </div>

                      {paymentError ? (
                        <p className="mt-3 text-sm text-rose-300">
                          {paymentError}
                        </p>
                      ) : null}

                      <button
                        className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#00A651] font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
                        disabled={!canPay}
                        onClick={handlePayment}
                        type="button"
                      >
                        {isProcessingPayment ? (
                          <>
                            <Clock3 className="h-5 w-5 animate-spin" />
                            Processing payment…
                          </>
                        ) : (
                          <>
                            <Phone className="h-5 w-5" />
                            Pay with M-Pesa
                          </>
                        )}
                      </button>
                    </div>
                  ) : (
                    <BNPLCheckout
                      amount={totalCharge}
                      description={`Table ${tableNumber} checkout at ${snapshot?.settings.businessProfile.name ?? "PesaSwap"}`}
                      merchantId={
                        snapshot?.settings.businessProfile.tillNumber ||
                        "fx-engine-demo"
                      }
                      onCancel={() => setSelectedPaymentMethod("mpesa")}
                      onSuccess={handleBNPLSuccess}
                      orderId={`table-${tableId}-${billItems.length}-${Math.round(totalCharge)}`}
                    />
                  )}
                </div>
              ) : (
                <EmptyState
                  ctaLabel="Review menu"
                  onClick={() => setScreen("menu")}
                  subtitle="Your pay screen becomes available once there is an active bill."
                  title="Nothing to pay yet"
                />
              )}
            </SectionCard>
          ) : null}

          {screen === "success" ? (
            <SectionCard
              icon={<Receipt className="h-5 w-5" />}
              subtitle="Thanks for paying. If you have a minute, tell us how it went."
              title="Payment confirmed"
            >
              <div className="rounded-2xl border border-emerald-400/30 bg-emerald-500/10 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-base font-semibold text-white">
                      {latestReceipt
                        ? formatMoney(latestReceipt.totalCharged)
                        : "Paid"}
                    </p>
                    <p className="mt-1 text-sm text-emerald-50/80">
                      {latestReceipt?.method === "bnpl"
                        ? `${latestReceipt.customerName || "Customer"} approved via Co-op BNPL${latestReceipt.monthlyPayment && latestReceipt.tenure ? ` · ${formatMoney(latestReceipt.monthlyPayment)}/month for ${latestReceipt.tenure} days` : ""}`
                        : latestReceipt?.phone
                          ? `STK push sent to ${latestReceipt.phone}`
                          : "Your payment went through successfully."}
                    </p>
                  </div>
                  <CheckCircle2 className="h-8 w-8 text-emerald-300" />
                </div>
                {latestReceipt?.method === "bnpl" &&
                latestReceipt.coopReference ? (
                  <p className="mt-3 text-sm text-emerald-50/80">
                    Co-op reference: {latestReceipt.coopReference}
                  </p>
                ) : null}
              </div>

              <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-sm font-medium text-white">
                  Rate your experience
                </p>
                <div className="mt-3 flex items-center justify-between gap-2">
                  {[1, 2, 3, 4, 5].map((value) => (
                    <button
                      className="rounded-full p-1"
                      key={value}
                      onClick={() => setReviewRating(value)}
                      type="button"
                      aria-label={`Rate ${value} star${value === 1 ? "" : "s"}`}
                      aria-pressed={reviewRating >= value}
                    >
                      <Star
                        className={`h-10 w-10 transition ${
                          reviewRating >= value
                            ? "fill-yellow-400 text-yellow-400"
                            : "text-slate-500"
                        }`}
                      />
                    </button>
                  ))}
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {REVIEW_TAGS.map((tag) => {
                    const active = reviewTags.includes(tag);
                    return (
                      <button
                        className={`rounded-full px-3 py-2 text-sm transition ${
                          active
                            ? "bg-yellow-400 text-slate-950"
                            : "border border-white/10 bg-slate-900 text-slate-200"
                        }`}
                        key={tag}
                        onClick={() => toggleReviewTag(tag)}
                        type="button"
                      >
                        {tag}
                      </button>
                    );
                  })}
                </div>

                <label className="mt-4 block text-sm text-slate-200">
                  Optional comment
                  <textarea
                    className="mt-2 min-h-24 w-full rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-sm outline-none transition focus:border-yellow-400"
                    onChange={(event) => setReviewComment(event.target.value)}
                    placeholder="What stood out today?"
                    value={reviewComment}
                  />
                </label>

                <button
                  className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-yellow-400 font-semibold text-slate-950 transition hover:bg-yellow-300 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
                  disabled={reviewRating === 0 || reviewSubmitted}
                  onClick={submitReview}
                  type="button"
                >
                  <MessageSquareText className="h-5 w-5" />
                  {reviewSubmitted ? "Thank you!" : "Submit review"}
                </button>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <button
                  className="flex h-11 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 text-sm font-medium text-white"
                  onClick={shareReceipt}
                  type="button"
                >
                  <Share2 className="h-4 w-4" />
                  WhatsApp
                </button>
                <button
                  className="flex h-11 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 text-sm font-medium text-white"
                  onClick={copyReceiptLink}
                  type="button"
                >
                  <Copy className="h-4 w-4" />
                  Copy link
                </button>
              </div>
            </SectionCard>
          ) : null}
        </section>
      </div>

      {screen === "menu" && cart.length > 0 ? (
        <div className="fixed inset-x-0 bottom-20 z-30 mx-auto w-full max-w-[390px] px-4">
          <button
            className="flex h-14 w-full items-center justify-between rounded-2xl border border-emerald-400/30 bg-slate-900/95 px-4 text-left shadow-lg shadow-black/40 backdrop-blur"
            onClick={() => setScreen("cart")}
            type="button"
          >
            <div>
              <p className="text-sm font-medium text-white">
                {cartQuantity} item{cartQuantity === 1 ? "" : "s"} in cart
              </p>
              <p className="text-xs text-slate-300">
                Tap to review before placing
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-emerald-300">
                {formatMoney(cartSubtotal)}
              </span>
              <ChevronRight className="h-4 w-4 text-slate-300" />
            </div>
          </button>
        </div>
      ) : null}

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-slate-950/95 pb-safe backdrop-blur">
        <div className="mx-auto grid h-20 w-full max-w-[390px] grid-cols-4 px-4">
          <TabButton
            active={screen === "menu"}
            icon={<UtensilsCrossed className="h-5 w-5" />}
            label="Menu"
            onClick={() => setScreen("menu")}
          />
          <TabButton
            active={screen === "cart"}
            badge={cartQuantity}
            bounceToken={justAddedToken}
            icon={<ShoppingCart className="h-5 w-5" />}
            label="Cart"
            onClick={() => setScreen("cart")}
          />
          <TabButton
            active={screen === "bill"}
            icon={<ClipboardList className="h-5 w-5" />}
            label="Bill"
            onClick={() => setScreen("bill")}
          />
          <TabButton
            active={screen === "pay" || screen === "success"}
            icon={<CreditCard className="h-5 w-5" />}
            label="Pay"
            onClick={() => setScreen(billItems.length > 0 ? "pay" : "menu")}
          />
        </div>
      </nav>

      {modifierItem ? (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm">
          <div className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-[390px] rounded-t-[28px] border border-white/10 bg-slate-950 p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-lg font-semibold text-white">
                  {modifierItem.name}
                </p>
                <p className="mt-1 text-sm text-slate-300">
                  Pick your extras before adding this item to the cart.
                </p>
              </div>
              <button
                className="rounded-full border border-white/10 p-2 text-slate-300"
                onClick={closeModifierSheet}
                type="button"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 max-h-[55vh] space-y-4 overflow-y-auto pr-1">
              {(modifierItem.modifiers ?? []).map((modifier) => (
                <div key={modifier.id}>
                  <p className="text-sm font-medium text-white">
                    {modifier.name}
                  </p>
                  <div className="mt-2 space-y-2">
                    {modifier.options.map((option) => {
                      const selected =
                        modifierSelections[modifier.id] === option.id;
                      return (
                        <button
                          className={`flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left transition ${
                            selected
                              ? "border-emerald-400 bg-emerald-500/10"
                              : "border-white/10 bg-white/5"
                          }`}
                          key={option.id}
                          onClick={() =>
                            setModifierSelections((current) => ({
                              ...current,
                              [modifier.id]: option.id,
                            }))
                          }
                          type="button"
                        >
                          <div>
                            <p className="text-sm font-medium text-white">
                              {option.label}
                            </p>
                            <p className="text-xs text-slate-300">
                              Standard choice
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-emerald-300">
                              {option.priceAdjustment > 0
                                ? `+${formatMoney(option.priceAdjustment)}`
                                : "Included"}
                            </span>
                            {selected ? (
                              <Check className="h-4 w-4 text-emerald-300" />
                            ) : null}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}

              <label className="block text-sm text-slate-200">
                Item notes
                <textarea
                  className="mt-2 min-h-20 w-full rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-sm outline-none focus:border-emerald-400"
                  onChange={(event) => setModifierNotes(event.target.value)}
                  placeholder="Extra spicy, no onions, serve later..."
                  value={modifierNotes}
                />
              </label>

              {modifierError ? (
                <p className="text-sm text-amber-300">{modifierError}</p>
              ) : null}
            </div>

            <button
              className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 font-semibold text-slate-950"
              onClick={confirmModifierSelection}
              type="button"
            >
              <Plus className="h-5 w-5" />
              Add to cart
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );

  function addCatalogueItem(
    item: CatalogueItem,
    notes = "",
    selected: SelectedModifier[] = [],
  ) {
    const nextItem: CartItem = {
      basePrice: item.price,
      category: item.category,
      description: item.description,
      dietary: item.dietary,
      image: item.image,
      itemId: item.id,
      key: createCartKey(item.id, selected),
      name: item.name,
      notes,
      quantity: 1,
      selectedOptions: selected,
    };

    setCart((current) => {
      const existing = current.find((entry) => entry.key === nextItem.key);
      if (!existing) return [...current, nextItem];

      return current.map((entry) =>
        entry.key === nextItem.key
          ? {
              ...entry,
              notes: notes || entry.notes,
              quantity: entry.quantity + 1,
            }
          : entry,
      );
    });
    setJustAddedToken(Date.now());
  }

  function openModifierSheet(item: CatalogueItem) {
    setModifierItem(item);
    setModifierSelections({});
    setModifierNotes("");
    setModifierError("");
  }

  function closeModifierSheet() {
    setModifierItem(null);
    setModifierSelections({});
    setModifierNotes("");
    setModifierError("");
  }

  function confirmModifierSelection() {
    if (!modifierItem) return;
    const selections = (modifierItem.modifiers ?? []).map((modifier) => {
      const optionId = modifierSelections[modifier.id];
      const selectedOption = modifier.options.find(
        (option) => option.id === optionId,
      );
      if (!selectedOption) return null;

      return {
        modifierId: modifier.id,
        modifierName: modifier.name,
        optionId: selectedOption.id,
        optionName: selectedOption.label,
        price: selectedOption.priceAdjustment,
      } satisfies SelectedModifier;
    });

    addCatalogueItem(
      modifierItem,
      modifierNotes,
      selections.filter((value): value is SelectedModifier => value !== null),
    );
    closeModifierSheet();
  }

  function updateCartItemQuantity(key: string, quantity: number) {
    if (quantity <= 0) {
      removeFromCart(key);
      return;
    }

    setCart((current) =>
      current.map((item) => (item.key === key ? { ...item, quantity } : item)),
    );
  }

  function removeFromCart(key: string) {
    setCart((current) => current.filter((item) => item.key !== key));
  }

  function toggleBillSelection(key: string) {
    setSelectedBillKeys((current) =>
      current.includes(key)
        ? current.filter((value) => value !== key)
        : [...current, key],
    );
  }

  function handlePlaceOrder() {
    if (!canPlaceOrder) return;

    if (preOrderMode) {
      writeStorage<PreOrderRecord>(preorderKey, {
        tableId,
        createdAt: new Date().toISOString(),
        fulfilment,
        items: cart,
        scheduledFor: arrivalAt,
      });
      setScreen("order-placed");
      orderTimeoutRef.current = window.setTimeout(() => {
        setScreen("menu");
      }, 2000);
      return;
    }

    const now = new Date().toISOString();
    const nextBillItems = [
      ...billItems,
      ...cart.map(
        (item) =>
          ({
            ...item,
            notes: item.notes || orderNote,
            orderedAt: now,
            source: "new-order",
          }) satisfies BillItem,
      ),
    ];

    // Broadcast to Kitchen Display (real-time via BroadcastChannel)
    submitNewOrder({
      id: generateOrderId(),
      tableId,
      tableNumber: (currentTable?.tableNumber ?? parseInt(tableId, 10)) || 0,
      items: cart.map((item) => ({
        id: item.key,
        name: item.name,
        quantity: item.quantity,
        price: item.basePrice,
        notes: item.notes || orderNote || undefined,
        options: item.selectedOptions?.map((o) => o.optionName),
      })),
      status: "new",
      total: cart.reduce(
        (sum, item) => sum + item.basePrice * item.quantity,
        0,
      ),
      customerNote: orderNote || undefined,
      fulfilment: fulfilment as "dine-in" | "takeaway" | "delivery",
      createdAt: now,
      updatedAt: now,
    });

    setBillItems(nextBillItems);
    setCart([]);
    setOrderNote("");
    writeStorage(statusKey, now);
    setScreen("order-placed");
    orderTimeoutRef.current = window.setTimeout(() => {
      setScreen("bill");
    }, 2000);
  }

  async function handlePayment() {
    if (!snapshot || !currentTable || !canPay) return;

    try {
      setIsProcessingPayment(true);
      setPaymentError("");

      const response = await executePayment({
        amount: totalCharge,
        currency: "KES",
        metadata: buildPaymentMetadata({
          customer: { phone },
          flow: "table",
          items: billItems.map((item) => ({
            category: item.category,
            name: item.name,
            price: item.basePrice + modifierTotal(item.selectedOptions),
            qty: item.quantity,
          })),
          merchant: {
            id: "fx-engine-demo",
            name: snapshot.settings.businessProfile.name,
            till: snapshot.settings.businessProfile.tillNumber,
          },
          qrScannedAt: new Date().toISOString(),
          split: {
            index: 1,
            totalParties: splitMode === "equal" ? splitCount : 1,
            type: splitMode === "by-item" ? "by_item" : splitMode,
          },
          table: {
            number: tableNumber!,
            orderId: `table-${tableId}-${Date.now()}`,
            server: staffMember?.name ?? currentTable.server,
          },
          tip:
            tipAmount > 0
              ? {
                  amount: tipAmount,
                  recipient: staffMember?.name ?? currentTable.server,
                }
              : undefined,
        }),
        phone,
      });

      if (!response.success) {
        throw new Error(
          response.error || "Payment could not be completed right now.",
        );
      }

      const paymentId = response.payment_id || `PAY-${Date.now()}`;
      const now = new Date().toISOString();

      const nextPayment: StoredPayment = {
        amountPaid: payerSubtotal,
        createdAt: now,
        id: paymentId,
        method: "mpesa",
        phone,
        splitMode,
        status: "success",
        tipAmount,
        totalCharged: totalCharge,
      };

      setPayments((current) => [...current, nextPayment]);
      setLatestReceipt({
        amountPaid: payerSubtotal,
        id: paymentId,
        method: "mpesa",
        paidAt: now,
        phone,
        tipAmount,
        totalCharged: totalCharge,
      });
      setScreen("success");
      setSelectedBillKeys([]);
      setPaymentError("");
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Payment could not be completed right now.";
      setPaymentError(message);
    } finally {
      setIsProcessingPayment(false);
    }
  }

  function handleBNPLSuccess(transaction: BNPLTransaction) {
    if (!snapshot || !currentTable) return;

    const now = new Date().toISOString();
    const nextPayment: StoredPayment = {
      amountPaid: payerSubtotal,
      createdAt: now,
      id: transaction.id,
      method: "bnpl",
      phone: transaction.customerPhone,
      splitMode,
      status: "success",
      tipAmount,
      totalCharged: totalCharge,
    };

    setPayments((current) => [...current, nextPayment]);
    setLatestReceipt({
      amountPaid: payerSubtotal,
      coopReference: transaction.coopReference,
      customerName: transaction.customerName,
      id: transaction.id,
      method: "bnpl",
      monthlyPayment: transaction.monthlyPayment,
      paidAt: now,
      phone: transaction.customerPhone,
      tenure: transaction.tenure,
      tipAmount,
      totalCharged: totalCharge,
    });
    setScreen("success");
    setSelectedBillKeys([]);
    setPaymentError("");
  }

  function toggleReviewTag(tag: string) {
    setReviewTags((current) =>
      current.includes(tag)
        ? current.filter((value) => value !== tag)
        : [...current, tag],
    );
  }

  function submitReview() {
    if (reviewRating === 0 || reviewSubmitted) return;

    const paymentId = latestReceipt?.id ?? `payment-${Date.now()}`;
    const serverName = staffMember?.name ?? currentTable?.server ?? "Team";
    const rating = toReviewRating(reviewRating);
    if (!rating) return;

    const reviewRecord: CustomerReviewRecord = {
      comment: reviewComment.trim(),
      createdAt: new Date().toISOString(),
      id: `review-${Date.now()}`,
      paymentId,
      rating,
      serverId: staffMember?.id,
      serverName,
      tableId,
      tags: reviewTags,
    };

    const existingReviews = readStorage<CustomerReviewRecord[]>(reviewKey, []);
    writeStorage(reviewKey, [reviewRecord, ...existingReviews]);

    const merchantReviews = readStorage<MerchantReview[]>(
      "fxengine.merchant.reviews",
      [],
    );
    const dashboardReview: MerchantReview = {
      comment: reviewRecord.comment || reviewRecord.tags.join(", "),
      customerName: `Table ${tableId}`,
      date: reviewRecord.createdAt,
      id: reviewRecord.id,
      paymentId,
      rating: reviewRecord.rating,
      server: reviewRecord.serverName,
      tableNumber: tableNumber!,
    };
    writeStorage("fxengine.merchant.reviews", [
      dashboardReview,
      ...merchantReviews,
    ]);
    setReviewSubmitted(true);
  }

  async function shareReceipt() {
    const shareText = buildShareText();
    const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(shareText)}`;

    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ text: shareText, title: "PesaSwap receipt" });
        return;
      } catch {
        // fall through to WhatsApp
      }
    }

    if (typeof window !== "undefined") {
      window.open(whatsappUrl, "_blank", "noopener,noreferrer");
    }
  }

  async function copyReceiptLink() {
    const receiptText = buildShareText();
    if (typeof navigator === "undefined" || !navigator.clipboard) return;

    await navigator.clipboard.writeText(receiptText);
  }

  function buildShareText() {
    const receiptAmount = latestReceipt
      ? formatMoney(latestReceipt.totalCharged)
      : "Paid";
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    return `PesaSwap receipt · Table ${tableId} · ${receiptAmount}${
      latestReceipt ? ` · Ref ${latestReceipt.id}` : ""
    }${origin ? ` · ${origin}/table/${tableId}` : ""}`;
  }
}

function TabButton({
  active,
  badge,
  bounceToken,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  badge?: number;
  bounceToken?: number;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`relative flex flex-col items-center justify-center gap-1 text-xs transition ${
        active ? "text-emerald-300" : "text-slate-400"
      } ${bounceToken ? "data-[pulse=true]:animate-bounce" : ""}`}
      data-pulse={Boolean(bounceToken)}
      onClick={onClick}
      type="button"
    >
      <span className="relative">
        {icon}
        {badge && badge > 0 ? (
          <span className="absolute -right-3 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-500 px-1 text-[10px] font-semibold text-slate-950">
            {badge}
          </span>
        ) : null}
      </span>
      <span>{label}</span>
    </button>
  );
}

function SectionCard({
  action,
  children,
  icon,
  subtitle,
  title,
}: {
  action?: ReactNode;
  children: ReactNode;
  icon: ReactNode;
  subtitle: string;
  title: string;
}) {
  return (
    <section className="rounded-[28px] border border-white/10 bg-slate-900/90 p-4 shadow-xl shadow-black/20">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="inline-flex rounded-full bg-white/6 p-2 text-emerald-300">
            {icon}
          </div>
          <h2 className="mt-3 text-xl font-semibold text-white">{title}</h2>
          <p className="mt-1 text-sm text-slate-300">{subtitle}</p>
        </div>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function StateCard({
  children,
  subtitle,
  title,
}: {
  children?: ReactNode;
  subtitle: string;
  title: string;
}) {
  return (
    <div className="rounded-[28px] border border-white/10 bg-slate-900/90 p-6 text-center shadow-xl shadow-black/20">
      <h2 className="text-xl font-semibold text-white">{title}</h2>
      <p className="mt-2 text-sm text-slate-300">{subtitle}</p>
      {children}
    </div>
  );
}

function EmptyState({
  ctaLabel,
  onClick,
  subtitle,
  title,
}: {
  ctaLabel: string;
  onClick: () => void;
  subtitle: string;
  title: string;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-white/15 bg-white/5 p-5 text-center">
      <p className="text-base font-semibold text-white">{title}</p>
      <p className="mt-2 text-sm text-slate-300">{subtitle}</p>
      <button
        className="mt-4 h-11 rounded-2xl bg-emerald-500 px-5 text-sm font-semibold text-slate-950"
        onClick={onClick}
        type="button"
      >
        {ctaLabel}
      </button>
    </div>
  );
}

function SummaryRow({
  highlight,
  label,
  value,
}: {
  highlight?: boolean;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className={highlight ? "font-medium text-white" : "text-slate-300"}>
        {label}
      </span>
      <span
        className={highlight ? "font-semibold text-emerald-300" : "text-white"}
      >
        {value}
      </span>
    </div>
  );
}

function Banner({
  children,
  tone,
}: {
  children: ReactNode;
  tone: "amber" | "emerald";
}) {
  return (
    <div
      className={`rounded-2xl border p-3 ${
        tone === "amber"
          ? "border-amber-300/30 bg-amber-500/10 text-amber-50"
          : "border-emerald-300/30 bg-emerald-500/10 text-emerald-50"
      }`}
    >
      {children}
    </div>
  );
}

function ArrivalPlanner({
  arrivalAt,
  fulfilment,
  onArrivalChange,
  onFulfilmentChange,
}: {
  arrivalAt: string;
  fulfilment: FulfilmentMode;
  onArrivalChange: (value: string) => void;
  onFulfilmentChange: (value: FulfilmentMode) => void;
}) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-white/5 p-4">
      <div className="flex items-center gap-2 text-sm font-medium text-white">
        <CalendarDays className="h-4 w-4 text-amber-300" />
        Plan your arrival
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          className={`h-11 rounded-2xl text-sm font-medium ${
            fulfilment === "dine-in"
              ? "bg-emerald-500 text-slate-950"
              : "border border-white/10 bg-slate-900 text-slate-200"
          }`}
          onClick={() => onFulfilmentChange("dine-in")}
          type="button"
        >
          Dine-in
        </button>
        <button
          className={`h-11 rounded-2xl text-sm font-medium ${
            fulfilment === "collection"
              ? "bg-emerald-500 text-slate-950"
              : "border border-white/10 bg-slate-900 text-slate-200"
          }`}
          onClick={() => onFulfilmentChange("collection")}
          type="button"
        >
          Collection
        </button>
      </div>
      <label className="mt-3 block text-sm text-slate-200">
        When will you arrive?
        <input
          className="mt-2 h-11 w-full rounded-2xl border border-white/10 bg-slate-900 px-4 outline-none focus:border-amber-300"
          min={defaultArrivalTime()}
          onChange={(event) => onArrivalChange(event.target.value)}
          type="datetime-local"
          value={arrivalAt}
        />
      </label>
    </div>
  );
}

function SplitOption({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`min-h-12 rounded-2xl px-3 py-2 text-sm font-medium transition ${
        active
          ? "bg-emerald-500 text-slate-950"
          : "border border-white/10 bg-slate-900 text-slate-200"
      }`}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

function AvatarLabel({
  image,
  name,
  size,
}: {
  image?: string;
  name: string;
  size: "md" | "sm";
}) {
  const dimension = size === "md" ? "h-12 w-12" : "h-10 w-10";
  const initials = name
    .split(" ")
    .slice(0, 2)
    .map((value) => value[0] ?? "")
    .join("")
    .toUpperCase();

  if (image) {
    return (
      <img
        alt={name}
        className={`${dimension} rounded-full object-cover`}
        src={image}
      />
    );
  }

  return (
    <div
      className={`flex ${dimension} items-center justify-center rounded-full bg-emerald-500/15 text-sm font-semibold text-emerald-300`}
    >
      {initials || "PS"}
    </div>
  );
}

function CenteredShell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-[80vh] w-full max-w-[390px] items-center">
      <div className="w-full">{children}</div>
    </div>
  );
}

function parseEncodedPayload(value: string | null): EncodedTablePayload {
  if (!value) return {};
  try {
    return JSON.parse(atob(value)) as EncodedTablePayload;
  } catch {
    return {};
  }
}

function getSearchParams() {
  if (typeof window === "undefined") return new URLSearchParams();
  return new URLSearchParams(window.location.search);
}

function findTable(tables: MerchantTable[], tableNumber: number | null) {
  if (tableNumber === null) return null;
  return tables.find((table) => table.tableNumber === tableNumber) ?? null;
}

function normalizeTableNumber(value: string | number | undefined) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function hydrateBillItems(
  storedBill: BillItem[],
  sourceItems: MerchantTableItem[],
) {
  if (Array.isArray(storedBill) && storedBill.length > 0) {
    return storedBill;
  }

  return sourceItems.map(
    (item, index) =>
      ({
        basePrice: item.price,
        category: item.category,
        itemId: item.id,
        key: `${item.id}-${index}`,
        name: item.name,
        notes: "",
        orderedAt: new Date().toISOString(),
        quantity: item.qty,
        selectedOptions: [],
        source: "existing",
      }) satisfies BillItem,
  );
}

function resolveInitialScreen(
  billItems: BillItem[],
  cartItems: CartItem[],
  storedStatus: string,
): CustomerScreen {
  if (storedStatus) return "bill";
  if (billItems.length > 0) return "bill";
  if (cartItems.length > 0) return "cart";
  return "menu";
}

function hydrateStaff(fallback: StaffMember[]) {
  const stored = readStorage<unknown>("fxengine.staff", null);
  if (Array.isArray(stored)) {
    return stored.filter(isStaffMember);
  }
  if (stored && typeof stored === "object" && "staffMembers" in stored) {
    const container = stored as { staffMembers?: unknown };
    if (Array.isArray(container.staffMembers)) {
      return container.staffMembers.filter(isStaffMember);
    }
  }
  return fallback;
}

function isStaffMember(value: unknown): value is StaffMember {
  return Boolean(
    value &&
    typeof value === "object" &&
    "id" in value &&
    "name" in value &&
    typeof (value as { id: unknown }).id === "string" &&
    typeof (value as { name: unknown }).name === "string",
  );
}

function findAssignedStaff(
  staffMembers: StaffMember[],
  table: MerchantTable | null,
  tableNumber: number | null,
) {
  if (tableNumber !== null) {
    const byAssignment = staffMembers.find((member) =>
      member.assignedTables?.includes(tableNumber),
    );
    if (byAssignment) return byAssignment;
  }

  if (table?.server) {
    const byName = staffMembers.find(
      (member) => member.name.toLowerCase() === table.server.toLowerCase(),
    );
    if (byName) return byName;
  }

  return staffMembers[0] ?? null;
}

function isPreorderActive(snapshot: MerchantSnapshot) {
  const query = getSearchParams();
  if (query.get("preorder") === "true") return true;
  if (!isWithinRestaurantHours(new Date())) return true;
  return !getActiveMenuSchedule(snapshot.menuSchedules, new Date());
}

function isWithinRestaurantHours(date: Date) {
  const hour = date.getHours();
  return hour >= OPEN_HOUR && hour < CLOSE_HOUR;
}

function createCartKey(itemId: string, selected: SelectedModifier[]) {
  const modifierKey = selected
    .map((option) => `${option.modifierId}:${option.optionId}`)
    .sort()
    .join("|");
  return `${itemId}::${modifierKey}`;
}

function modifierTotal(selected: SelectedModifier[]) {
  return selected.reduce((total, option) => total + option.price, 0);
}

function cartLineTotal(
  item: Pick<CartItem, "basePrice" | "quantity" | "selectedOptions">,
) {
  return roundCurrency(
    (item.basePrice + modifierTotal(item.selectedOptions)) * item.quantity,
  );
}

function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function clampCurrency(value: number, maximum: number) {
  return roundCurrency(Math.max(Math.min(value, maximum), 0));
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-KE", {
    currency: "KES",
    maximumFractionDigits: 0,
    style: "currency",
  }).format(value);
}

function formatDateTime(value: string) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-KE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

function defaultArrivalTime() {
  const now = new Date();
  now.setMinutes(now.getMinutes() + 45);
  const offset = now.getTimezoneOffset();
  const local = new Date(now.getTime() - offset * 60000);
  return local.toISOString().slice(0, 16);
}

function removeStorage(key: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore storage cleanup errors
  }
}

function toReviewRating(value: number): MerchantReview["rating"] | null {
  if (value >= 1 && value <= 5) {
    return value as MerchantReview["rating"];
  }
  return null;
}
