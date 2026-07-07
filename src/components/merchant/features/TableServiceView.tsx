import { useEffect, useMemo, useState } from "react";
import { PaymentQr } from "@/components/pay/PaymentQr";
import { toast } from "sonner";
import {
  AlertTriangle,
  BarChart3,
  Brain,
  Calendar,
  Check,
  CheckCircle2,
  ClipboardPaste,
  Clock3,
  Copy,
  Gift,
  Languages,
  Leaf,
  Minus,
  Pencil,
  Plus,
  QrCode,
  RefreshCw,
  Share2,
  Smartphone,
  Star,
  TrendingUp,
  Users,
  UtensilsCrossed,
  Wine,
  X,
  XCircle,
  Zap,
} from "lucide-react";

import { pesaswapClient } from "../../../lib/pesaswap-payments";
import type {
  CatalogueItem,
  LoyaltyCustomer,
  OrderTicket,
  Reservation,
  TableOrder,
} from "./types";
import { MERCHANT_NAME, TILL_NUMBER } from "./utils";

const DEFAULT_CATALOGUE: CatalogueItem[] = [
  {
    id: "m1",
    name: "Nyama Choma (500g)",
    price: 850,
    category: "Main",
    destination: "kitchen",
    dietary: ["halal"],
  },
  {
    id: "m2",
    name: "Pilau Rice",
    price: 350,
    category: "Main",
    destination: "kitchen",
    dietary: ["halal", "gluten-free"],
  },
  {
    id: "m3",
    name: "Fish Fry",
    price: 650,
    category: "Main",
    destination: "kitchen",
    dietary: ["gluten-free"],
  },
  {
    id: "m4",
    name: "Ugali",
    price: 100,
    category: "Side",
    destination: "kitchen",
    dietary: ["vegan", "gluten-free"],
  },
  {
    id: "m5",
    name: "Sukuma Wiki",
    price: 80,
    category: "Side",
    destination: "kitchen",
    dietary: ["vegan", "gluten-free"],
  },
  {
    id: "m6",
    name: "Chapati",
    price: 50,
    category: "Side",
    destination: "kitchen",
    dietary: ["vegetarian"],
  },
  {
    id: "m7",
    name: "Tusker Lager",
    price: 250,
    category: "Drinks",
    destination: "bar",
  },
  {
    id: "m8",
    name: "Coca Cola",
    price: 120,
    category: "Drinks",
    destination: "bar",
    dietary: ["vegan"],
  },
  {
    id: "m9",
    name: "Fresh Juice",
    price: 200,
    category: "Drinks",
    destination: "bar",
    dietary: ["vegan", "gluten-free"],
  },
  {
    id: "m10",
    name: "Mandazi (4pc)",
    price: 80,
    category: "Snack",
    destination: "kitchen",
    dietary: ["vegetarian"],
  },
];

const SERVERS = ["Grace M.", "Peter K.", "Alice N.", "David O."];

export function TableServiceView() {
  const [catalogue, setCatalogue] = useState<CatalogueItem[]>(() => {
    if (typeof window === "undefined") return DEFAULT_CATALOGUE;
    const saved = localStorage.getItem("fxengine.merchant.catalogue");
    return saved ? JSON.parse(saved) : DEFAULT_CATALOGUE;
  });

  const [tables, setTables] = useState<TableOrder[]>(() => {
    if (typeof window === "undefined") return [];
    const saved = localStorage.getItem("fxengine.merchant.tables");
    if (saved) return JSON.parse(saved);
    return [
      {
        id: "tbl-1",
        tableNumber: 1,
        server: "Grace M.",
        items: [
          {
            id: "m1",
            name: "Nyama Choma (500g)",
            price: 850,
            qty: 1,
            category: "Main",
          },
          { id: "m4", name: "Ugali", price: 100, qty: 2, category: "Side" },
          {
            id: "m7",
            name: "Tusker Lager",
            price: 250,
            qty: 2,
            category: "Drinks",
          },
        ],
        status: "open" as const,
        openedAt: new Date(Date.now() - 35 * 60000).toISOString(),
        paidAmount: 0,
        payments: [],
      },
      {
        id: "tbl-3",
        tableNumber: 3,
        server: "Peter K.",
        items: [
          {
            id: "m2",
            name: "Pilau Rice",
            price: 350,
            qty: 2,
            category: "Main",
          },
          {
            id: "m8",
            name: "Coca Cola",
            price: 120,
            qty: 3,
            category: "Drinks",
          },
          {
            id: "m10",
            name: "Mandazi (4pc)",
            price: 80,
            qty: 1,
            category: "Snack",
          },
        ],
        status: "requesting-bill" as const,
        openedAt: new Date(Date.now() - 50 * 60000).toISOString(),
        paidAmount: 0,
        payments: [],
      },
      {
        id: "tbl-7",
        tableNumber: 7,
        server: "Alice N.",
        items: [
          { id: "m3", name: "Fish Fry", price: 650, qty: 2, category: "Main" },
          {
            id: "m5",
            name: "Sukuma Wiki",
            price: 80,
            qty: 2,
            category: "Side",
          },
          {
            id: "m9",
            name: "Fresh Juice",
            price: 200,
            qty: 4,
            category: "Drinks",
          },
          { id: "m6", name: "Chapati", price: 50, qty: 6, category: "Side" },
        ],
        status: "partially-paid" as const,
        openedAt: new Date(Date.now() - 72 * 60000).toISOString(),
        paidAmount: 1200,
        payments: [
          {
            name: "John",
            amount: 1200,
            tip: 100,
            phone: "+254722***456",
            time: new Date(Date.now() - 10 * 60000).toISOString(),
          },
        ],
      },
    ];
  });

  const [selectedTable, setSelectedTable] = useState<TableOrder | null>(null);
  const [view, setView] = useState<
    | "overview"
    | "detail"
    | "add-items"
    | "qr"
    | "catalogue"
    | "quick-charge"
    | "tips-analytics"
    | "payment-history"
    | "ai-forecast"
    | "ai-staffing"
    | "ai-insights"
    | "ai-anomalies"
    | "orders-queue"
    | "reservations"
    | "loyalty"
  >("overview");
  const [newTableNum, setNewTableNum] = useState("");
  const [newTableServer, setNewTableServer] = useState(SERVERS[0]);
  const [showNewTable, setShowNewTable] = useState(false);
  const [addingItems, setAddingItems] = useState<Map<string, number>>(
    new Map(),
  );
  // Catalogue form
  const [catName, setCatName] = useState("");
  const [catPrice, setCatPrice] = useState("");
  const [catCategory, setCatCategory] = useState("Main");
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  // Quick charge
  const [quickAmount, setQuickAmount] = useState("");

  // Orders queue (kitchen/bar)
  const [orders, setOrders] = useState<OrderTicket[]>(() => {
    if (typeof window === "undefined") return [];
    const saved = localStorage.getItem("fxengine.merchant.orders");
    return saved ? JSON.parse(saved) : [];
  });
  const [ordersFilter, setOrdersFilter] = useState<"all" | "kitchen" | "bar">(
    "all",
  );

  // Reservations
  const [reservations, setReservations] = useState<Reservation[]>(() => {
    if (typeof window === "undefined") return [];
    const saved = localStorage.getItem("fxengine.merchant.reservations");
    return saved ? JSON.parse(saved) : [];
  });

  // Loyalty
  const [loyaltyCustomers, setLoyaltyCustomers] = useState<LoyaltyCustomer[]>(
    () => {
      if (typeof window === "undefined") return [];
      const saved = localStorage.getItem("fxengine.merchant.loyalty");
      return saved ? JSON.parse(saved) : [];
    },
  );

  // Catalogue form extras (dietary/destination)
  const [catDietary, setCatDietary] = useState<string[]>([]);
  const [catDest, setCatDest] = useState<"kitchen" | "bar">("kitchen");

  // Reservation form
  const [resName, setResName] = useState("");
  const [resPhone, setResPhone] = useState("");
  const [resDate, setResDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [resTime, setResTime] = useState("19:00");
  const [resCovers, setResCovers] = useState("2");
  const [resTable, setResTable] = useState("");

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("fxengine.merchant.tables", JSON.stringify(tables));
    }
  }, [tables]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem(
        "fxengine.merchant.catalogue",
        JSON.stringify(catalogue),
      );
    }
  }, [catalogue]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("fxengine.merchant.orders", JSON.stringify(orders));
    }
  }, [orders]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem(
        "fxengine.merchant.reservations",
        JSON.stringify(reservations),
      );
    }
  }, [reservations]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem(
        "fxengine.merchant.loyalty",
        JSON.stringify(loyaltyCustomers),
      );
    }
  }, [loyaltyCustomers]);

  // Loyalty helper: award points on payment
  function awardLoyaltyPoints(phone: string, name: string, amount: number) {
    const points = Math.floor(amount / 10); // 1 point per KES 10
    setLoyaltyCustomers((prev) => {
      const existing = prev.find((c) => c.phone === phone);
      if (existing) {
        return prev.map((c) =>
          c.phone === phone
            ? {
                ...c,
                points: c.points + points,
                totalSpent: c.totalSpent + amount,
                visits: c.visits + 1,
                lastVisit: new Date().toISOString(),
                tier: getTier(c.totalSpent + amount),
              }
            : c,
        );
      }
      return [
        ...prev,
        {
          phone,
          name: name || "Guest",
          points,
          totalSpent: amount,
          visits: 1,
          tier: "Bronze" as const,
          lastVisit: new Date().toISOString(),
        },
      ];
    });
  }

  function getTier(
    totalSpent: number,
  ): "Bronze" | "Silver" | "Gold" | "Platinum" {
    if (totalSpent >= 50000) return "Platinum";
    if (totalSpent >= 20000) return "Gold";
    if (totalSpent >= 5000) return "Silver";
    return "Bronze";
  }

  // Order ticket helper
  function submitOrder(
    tableNum: number,
    items: {
      name: string;
      qty: number;
      notes?: string;
      destination: "kitchen" | "bar";
    }[],
    server: string,
    customerName?: string,
  ) {
    const kitchenItems = items.filter((i) => i.destination === "kitchen");
    const barItems = items.filter((i) => i.destination === "bar");
    const newOrders: OrderTicket[] = [];
    if (kitchenItems.length > 0) {
      newOrders.push({
        id: `ord-k-${Date.now()}`,
        tableNumber: tableNum,
        items: kitchenItems.map(({ name, qty, notes }) => ({
          name,
          qty,
          notes,
        })),
        destination: "kitchen",
        status: "new",
        orderedAt: new Date().toISOString(),
        server,
        customerName,
      });
    }
    if (barItems.length > 0) {
      newOrders.push({
        id: `ord-b-${Date.now()}`,
        tableNumber: tableNum,
        items: barItems.map(({ name, qty, notes }) => ({ name, qty, notes })),
        destination: "bar",
        status: "new",
        orderedAt: new Date().toISOString(),
        server,
        customerName,
      });
    }
    setOrders((prev) => [...newOrders, ...prev]);
    newOrders.forEach((o) => {
      notifyStaff(
        tableNum,
        0,
        `New ${o.destination} order: ${o.items.length} items`,
      );
    });
  }

  function updateOrderStatus(orderId: string, status: OrderTicket["status"]) {
    setOrders((prev) =>
      prev.map((o) => {
        if (o.id !== orderId) return o;
        const updates: Partial<OrderTicket> = { status };
        if (status === "ready") updates.preparedAt = new Date().toISOString();
        if (status === "served") updates.servedAt = new Date().toISOString();
        return { ...o, ...updates };
      }),
    );
    const order = orders.find((o) => o.id === orderId);
    if (order && status === "ready") {
      toast.success(
        `🔔 Table ${order.tableNumber}: ${order.destination} order ready!`,
      );
    }
  }

  function getTotal(t: TableOrder) {
    if (t.quickCharge) return t.quickCharge;
    return t.items.reduce((s, i) => s + i.price * i.qty, 0);
  }

  function getRemainingBalance(t: TableOrder) {
    return getTotal(t) - t.paidAmount;
  }

  // Staff notification with sound
  function notifyStaff(tableNum: number, amount: number, payer: string) {
    // Play notification sound
    try {
      const ctx = new (
        window.AudioContext || (window as any).webkitAudioContext
      )();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      osc.type = "sine";
      gain.gain.value = 0.3;
      osc.start();
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      osc.stop(ctx.currentTime + 0.3);
    } catch {
      /* audio not available */
    }

    toast.success(
      `💰 Table ${tableNum} — KES ${amount.toLocaleString()} received`,
      {
        description: `From ${payer} via M-Pesa`,
        duration: 5000,
      },
    );
  }

  // Walkout risk detection
  const walkoutRiskTables = useMemo(
    () =>
      tables.filter((t) => {
        if (t.status === "closed") return false;
        const elapsed = (Date.now() - new Date(t.openedAt).getTime()) / 60000;
        return elapsed > 120 && t.paidAmount === 0;
      }),
    [tables],
  );

  // Auto-close tables that are fully paid
  useEffect(() => {
    const toClose = tables.filter((t) => {
      if (t.status === "closed") return false;
      const total = getTotal(t);
      return total > 0 && t.paidAmount >= total;
    });
    if (toClose.length > 0) {
      setTables((prev) =>
        prev.map((t) => {
          const total = getTotal(t);
          if (t.status !== "closed" && total > 0 && t.paidAmount >= total) {
            return {
              ...t,
              status: "closed" as const,
              closedAt: new Date().toISOString(),
            };
          }
          return t;
        }),
      );
      toClose.forEach((t) => {
        toast.success(`✅ Table ${t.tableNumber} auto-closed (fully paid)`);
      });
    }
  }, [tables]);

  function createTable() {
    if (!newTableNum) return;
    const t: TableOrder = {
      id: `tbl-${Date.now().toString(36)}`,
      tableNumber: Number(newTableNum),
      server: newTableServer,
      items: [],
      status: "open",
      openedAt: new Date().toISOString(),
      paidAmount: 0,
      payments: [],
    };
    setTables((prev) => [...prev, t]);
    setNewTableNum("");
    setShowNewTable(false);
    setSelectedTable(t);
    setView("add-items");
    toast.success(`Table ${t.tableNumber} opened`);
  }

  function createQuickChargeTable() {
    if (!newTableNum || !quickAmount || Number(quickAmount) <= 0) return;
    const t: TableOrder = {
      id: `tbl-${Date.now().toString(36)}`,
      tableNumber: Number(newTableNum),
      server: newTableServer,
      items: [],
      status: "open",
      openedAt: new Date().toISOString(),
      paidAmount: 0,
      payments: [],
      quickCharge: Number(quickAmount),
    };
    setTables((prev) => [...prev, t]);
    setNewTableNum("");
    setQuickAmount("");
    setView("overview");
    toast.success(
      `Table ${t.tableNumber} opened — KES ${Number(quickAmount).toLocaleString()}`,
    );
  }

  function addItemsToTable() {
    if (!selectedTable) return;
    const newItems = [...selectedTable.items];
    addingItems.forEach((qty, menuId) => {
      if (qty <= 0) return;
      const menuItem = catalogue.find((m) => m.id === menuId);
      if (!menuItem) return;
      const existing = newItems.find((i) => i.id === menuId);
      if (existing) {
        existing.qty += qty;
      } else {
        newItems.push({ ...menuItem, qty });
      }
    });
    setTables((prev) =>
      prev.map((t) =>
        t.id === selectedTable.id ? { ...t, items: newItems } : t,
      ),
    );
    setSelectedTable({ ...selectedTable, items: newItems });
    setAddingItems(new Map());
    setView("detail");
    toast.success("Items added to table");
  }

  function closeTable(tableId: string) {
    setTables((prev) =>
      prev.map((t) =>
        t.id === tableId
          ? {
              ...t,
              status: "closed" as const,
              closedAt: new Date().toISOString(),
            }
          : t,
      ),
    );
    setSelectedTable(null);
    setView("overview");
    toast.success("Table closed");
  }

  function saveCatalogueItem() {
    if (!catName || !catPrice || Number(catPrice) <= 0) return;
    if (editingCatId) {
      setCatalogue((prev) =>
        prev.map((c) =>
          c.id === editingCatId
            ? {
                ...c,
                name: catName,
                price: Number(catPrice),
                category: catCategory,
              }
            : c,
        ),
      );
      setEditingCatId(null);
    } else {
      setCatalogue((prev) => [
        ...prev,
        {
          id: `cat-${Date.now().toString(36)}`,
          name: catName,
          price: Number(catPrice),
          category: catCategory,
        },
      ]);
    }
    setCatName("");
    setCatPrice("");
    setCatCategory("Main");
    toast.success(editingCatId ? "Item updated" : "Item added to catalogue");
  }

  function deleteCatalogueItem(id: string) {
    setCatalogue((prev) => prev.filter((c) => c.id !== id));
    toast.success("Item removed");
  }

  function generateTableQR(t: TableOrder) {
    const payload = btoa(
      JSON.stringify({
        tableNumber: t.tableNumber,
        merchant: MERCHANT_NAME,
        till: TILL_NUMBER,
        server: t.server,
        items: t.items,
        openedAt: t.openedAt,
        ...(t.quickCharge ? { quickCharge: t.quickCharge } : {}),
      }),
    );
    return typeof window !== "undefined"
      ? `${window.location.origin}/table?t=${encodeURIComponent(payload)}`
      : "";
  }

  const activeTables = tables.filter((t) => t.status !== "closed");
  const totalRevenue = tables
    .filter((t) => t.status === "closed" || t.paidAmount > 0)
    .reduce((s, t) => s + t.paidAmount, 0);
  const totalTips = tables.reduce(
    (s, t) => s + t.payments.reduce((ps, p) => ps + p.tip, 0),
    0,
  );

  const categories = [...new Set(catalogue.map((c) => c.category))];

  // --- Catalogue View ---
  if (view === "catalogue") {
    const DIETARY_OPTIONS = [
      "vegan",
      "vegetarian",
      "gluten-free",
      "halal",
      "contains-nuts",
      "dairy-free",
    ];

    return (
      <div className="px-5 pt-4 pb-20 space-y-4">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setView("overview")}
            className="text-sm text-muted-foreground"
          >
            ← Back
          </button>
          <p className="text-xs font-mono text-muted-foreground">
            {catalogue.length} items
          </p>
        </div>
        <p className="text-lg font-bold">Menu Catalogue</p>
        <p className="text-xs text-muted-foreground">
          Add items with prices, dietary info & routing (kitchen/bar).
        </p>

        {/* Add/Edit form */}
        <div className="rounded-2xl border border-border p-3 space-y-2">
          <p className="text-[10px] font-mono uppercase text-muted-foreground">
            {editingCatId ? "Edit item" : "Add new item"}
          </p>
          <input
            type="text"
            value={catName}
            onChange={(e) => setCatName(e.target.value)}
            placeholder="Item name"
            className="w-full bg-muted rounded-xl px-3 py-2.5 text-xs outline-none"
          />
          <div className="flex gap-2">
            <div className="flex-1 flex items-center gap-1 bg-muted rounded-xl px-3 py-2.5">
              <span className="text-[10px] text-muted-foreground">KES</span>
              <input
                type="tel"
                value={catPrice}
                onChange={(e) =>
                  setCatPrice(e.target.value.replace(/[^0-9]/g, ""))
                }
                placeholder="Price"
                className="flex-1 bg-transparent text-xs font-mono font-bold outline-none"
              />
            </div>
            <select
              value={catCategory}
              onChange={(e) => setCatCategory(e.target.value)}
              className="bg-muted rounded-xl px-3 py-2.5 text-xs outline-none"
            >
              {[
                "Main",
                "Side",
                "Drinks",
                "Cocktails",
                "Snack",
                "Dessert",
                "Other",
              ].map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          {/* Destination: Kitchen or Bar */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground">Goes to:</span>
            <button
              onClick={() => setCatDest("kitchen")}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-semibold ${catDest === "kitchen" ? "bg-orange-100 text-orange-700 border border-orange-300" : "bg-muted"}`}
            >
              🍳 Kitchen
            </button>
            <button
              onClick={() => setCatDest("bar")}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-semibold ${catDest === "bar" ? "bg-purple-100 text-purple-700 border border-purple-300" : "bg-muted"}`}
            >
              🍺 Bar
            </button>
          </div>
          {/* Dietary tags */}
          <div className="space-y-1">
            <span className="text-[10px] text-muted-foreground">Dietary:</span>
            <div className="flex flex-wrap gap-1">
              {DIETARY_OPTIONS.map((d) => (
                <button
                  key={d}
                  onClick={() =>
                    setCatDietary((prev) =>
                      prev.includes(d)
                        ? prev.filter((x) => x !== d)
                        : [...prev, d],
                    )
                  }
                  className={`px-2 py-0.5 rounded-full text-[9px] border ${catDietary.includes(d) ? "bg-emerald-100 border-emerald-300 text-emerald-800" : "border-border text-muted-foreground"}`}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                saveCatalogueItem();
                // Also save dietary and destination via direct catalogue update
                if (catName && catPrice) {
                  setCatalogue((prev) =>
                    prev.map((item) => {
                      if (item.name === catName)
                        return {
                          ...item,
                          dietary: catDietary,
                          destination: catDest,
                        };
                      return item;
                    }),
                  );
                }
                setCatDietary([]);
                setCatDest("kitchen");
              }}
              disabled={!catName || !catPrice}
              className="flex-1 bg-emerald-600 text-white py-2.5 rounded-xl text-xs font-bold disabled:opacity-40"
            >
              {editingCatId ? "Update" : "Add"}
            </button>
            {editingCatId && (
              <button
                onClick={() => {
                  setEditingCatId(null);
                  setCatName("");
                  setCatPrice("");
                  setCatCategory("Main");
                  setCatDietary([]);
                  setCatDest("kitchen");
                }}
                className="px-4 py-2.5 rounded-xl border border-border text-xs"
              >
                Cancel
              </button>
            )}
          </div>
        </div>

        {/* Items by category */}
        <div className="space-y-3 max-h-56 overflow-y-auto">
          {categories.map((cat) => (
            <div key={cat}>
              <p className="text-[9px] font-mono uppercase text-muted-foreground mb-1">
                {cat}
              </p>
              {catalogue
                .filter((c) => c.category === cat)
                .map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-muted/50"
                  >
                    <div>
                      <p className="text-xs font-medium">
                        {item.destination === "bar" ? "🍺" : "🍳"} {item.name}
                      </p>
                      <div className="flex items-center gap-1">
                        <p className="text-[9px] text-muted-foreground font-mono">
                          KES {item.price.toLocaleString()}
                        </p>
                        {item.dietary && item.dietary.length > 0 && (
                          <span className="text-[8px] text-emerald-600">
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
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => {
                          setEditingCatId(item.id);
                          setCatName(item.name);
                          setCatPrice(String(item.price));
                          setCatCategory(item.category);
                          setCatDietary(item.dietary || []);
                          setCatDest(item.destination || "kitchen");
                        }}
                        className="size-6 rounded-full border border-border flex items-center justify-center"
                      >
                        <Pencil className="size-2.5" />
                      </button>
                      <button
                        onClick={() => deleteCatalogueItem(item.id)}
                        className="size-6 rounded-full border border-red-200 text-red-500 flex items-center justify-center"
                      >
                        <X className="size-2.5" />
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // --- Quick Charge View ---
  if (view === "quick-charge") {
    return (
      <div className="px-5 pt-4 pb-20 space-y-4">
        <button
          onClick={() => setView("overview")}
          className="text-sm text-muted-foreground"
        >
          ← Back
        </button>
        <p className="text-lg font-bold">Quick Charge</p>
        <p className="text-xs text-muted-foreground">
          Enter amount only — no line items needed. Perfect for bars, quick
          orders, or custom bills.
        </p>

        <div className="rounded-2xl border border-border p-4 space-y-3">
          <div className="flex gap-2">
            <input
              type="tel"
              value={newTableNum}
              onChange={(e) =>
                setNewTableNum(
                  e.target.value.replace(/[^0-9]/g, "").slice(0, 3),
                )
              }
              placeholder="Table #"
              className="w-20 bg-muted rounded-xl px-3 py-3 text-sm font-mono outline-none text-center"
            />
            <select
              value={newTableServer}
              onChange={(e) => setNewTableServer(e.target.value)}
              className="flex-1 bg-muted rounded-xl px-3 py-3 text-xs outline-none"
            >
              {SERVERS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2 bg-muted rounded-xl px-4 py-4">
            <span className="text-sm text-muted-foreground font-mono">KES</span>
            <input
              type="tel"
              value={quickAmount}
              onChange={(e) =>
                setQuickAmount(e.target.value.replace(/[^0-9]/g, ""))
              }
              placeholder="0"
              className="flex-1 bg-transparent text-3xl font-mono font-bold outline-none"
            />
          </div>
          <button
            onClick={createQuickChargeTable}
            disabled={!newTableNum || !quickAmount || Number(quickAmount) <= 0}
            className="w-full bg-emerald-600 text-white py-3.5 rounded-xl text-sm font-bold disabled:opacity-40 flex items-center justify-center gap-2"
          >
            <Zap className="size-4" />
            Charge Table {newTableNum || "#"} — KES{" "}
            {quickAmount ? Number(quickAmount).toLocaleString() : "0"}
          </button>
        </div>

        <p className="text-[10px] text-center text-muted-foreground">
          A table QR will be generated. Customers scan → confirm → pay via
          M-Pesa.
        </p>
      </div>
    );
  }

  // --- Tips Analytics View ---
  if (view === "tips-analytics") {
    const allPayments = tables.flatMap((t) =>
      t.payments.map((p) => ({
        ...p,
        tableNumber: t.tableNumber,
        server: t.server,
      })),
    );
    const serverTips: Record<string, { total: number; count: number }> = {};
    allPayments.forEach((p) => {
      if (!serverTips[p.server]) serverTips[p.server] = { total: 0, count: 0 };
      serverTips[p.server].total += p.tip;
      serverTips[p.server].count += 1;
    });
    const sortedServers = Object.entries(serverTips).sort(
      (a, b) => b[1].total - a[1].total,
    );
    const totalTipsAll = allPayments.reduce((s, p) => s + p.tip, 0);
    const avgTipPercent =
      allPayments.length > 0
        ? Math.round(
            (totalTipsAll / allPayments.reduce((s, p) => s + p.amount, 0)) *
              100,
          )
        : 0;

    return (
      <div className="px-5 pt-4 pb-20 space-y-4">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setView("overview")}
            className="text-sm text-muted-foreground"
          >
            ← Back
          </button>
          <p className="text-[10px] font-mono text-muted-foreground">
            {allPayments.length} transactions
          </p>
        </div>
        <p className="text-lg font-bold">Tips Analytics</p>

        {/* Summary cards */}
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-xl bg-amber-50 dark:bg-amber-950/20 p-3 text-center">
            <p className="text-lg font-bold font-mono text-amber-700">
              {totalTipsAll.toLocaleString()}
            </p>
            <p className="text-[9px] text-muted-foreground">Total tips (KES)</p>
          </div>
          <div className="rounded-xl bg-muted p-3 text-center">
            <p className="text-lg font-bold font-mono">{avgTipPercent}%</p>
            <p className="text-[9px] text-muted-foreground">Avg tip rate</p>
          </div>
          <div className="rounded-xl bg-muted p-3 text-center">
            <p className="text-lg font-bold font-mono">{allPayments.length}</p>
            <p className="text-[9px] text-muted-foreground">Payments</p>
          </div>
        </div>

        {/* Server leaderboard */}
        <div className="rounded-2xl border border-border p-3 space-y-2">
          <p className="text-[10px] font-mono uppercase text-muted-foreground">
            Server leaderboard
          </p>
          {sortedServers.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-2">
              No tips recorded yet
            </p>
          )}
          {sortedServers.map(([server, data], idx) => (
            <div key={server} className="flex items-center gap-3">
              <span
                className={`size-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
                  idx === 0
                    ? "bg-amber-100 text-amber-700"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {idx + 1}
              </span>
              <div className="flex-1">
                <p className="text-xs font-medium">{server}</p>
                <p className="text-[9px] text-muted-foreground">
                  {data.count} payments
                </p>
              </div>
              <p className="text-xs font-bold font-mono text-amber-600">
                KES {data.total.toLocaleString()}
              </p>
            </div>
          ))}
        </div>

        {/* Recent tips */}
        <div className="rounded-2xl border border-border p-3 space-y-2">
          <p className="text-[10px] font-mono uppercase text-muted-foreground">
            Recent tips
          </p>
          {allPayments
            .filter((p) => p.tip > 0)
            .slice(0, 8)
            .map((p, idx) => (
              <div key={idx} className="flex justify-between text-xs">
                <div>
                  <span className="font-medium">{p.name || "Anonymous"}</span>
                  <span className="text-muted-foreground ml-1">
                    Table {p.tableNumber}
                  </span>
                </div>
                <span className="font-mono font-bold text-amber-600">
                  +{p.tip.toLocaleString()}
                </span>
              </div>
            ))}
        </div>
      </div>
    );
  }

  // --- Payment History View ---
  if (view === "payment-history") {
    const allPayments = tables.flatMap((t) =>
      t.payments.map((p) => ({
        ...p,
        tableNumber: t.tableNumber,
        server: t.server,
        tableId: t.id,
      })),
    );
    const filtered = allPayments.filter((p) => {
      if (newTableNum && p.tableNumber !== Number(newTableNum)) return false;
      return true;
    });
    const totalFiltered = filtered.reduce((s, p) => s + p.amount + p.tip, 0);

    return (
      <div className="px-5 pt-4 pb-20 space-y-4">
        <div className="flex items-center justify-between">
          <button
            onClick={() => {
              setNewTableNum("");
              setView("overview");
            }}
            className="text-sm text-muted-foreground"
          >
            ← Back
          </button>
          <p className="text-[10px] font-mono text-muted-foreground">
            {filtered.length} payments · KES {totalFiltered.toLocaleString()}
          </p>
        </div>
        <p className="text-lg font-bold">Payment History</p>

        {/* Filters */}
        <div className="flex gap-2">
          <div className="flex-1 flex items-center gap-2 bg-muted rounded-xl px-3 py-2.5">
            <span className="text-[10px] text-muted-foreground">Table #</span>
            <input
              type="tel"
              value={newTableNum}
              onChange={(e) =>
                setNewTableNum(
                  e.target.value.replace(/[^0-9]/g, "").slice(0, 3),
                )
              }
              placeholder="All"
              className="flex-1 bg-transparent text-xs font-mono outline-none"
            />
          </div>
          {newTableNum && (
            <button
              onClick={() => setNewTableNum("")}
              className="px-3 rounded-xl border border-border text-xs"
            >
              Clear
            </button>
          )}
        </div>

        {/* Payment list */}
        <div className="space-y-1 max-h-72 overflow-y-auto">
          {filtered.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-4">
              No payments found
            </p>
          )}
          {filtered.map((p, idx) => (
            <div
              key={idx}
              className="flex items-center justify-between py-2 px-3 rounded-xl border border-border"
            >
              <div>
                <p className="text-xs font-medium">{p.name || "Anonymous"}</p>
                <p className="text-[9px] text-muted-foreground">
                  Table {p.tableNumber} · {p.server} · {p.phone}
                </p>
                <p className="text-[9px] text-muted-foreground">
                  {new Date(p.time).toLocaleString()}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs font-bold font-mono">
                  {p.amount.toLocaleString()}
                </p>
                {p.tip > 0 && (
                  <p className="text-[9px] text-amber-600 font-mono">
                    +{p.tip} tip
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // --- QR View ---
  if (view === "qr" && selectedTable) {
    const qrUrl = generateTableQR(selectedTable);
    return (
      <div className="px-5 pt-4 pb-20 space-y-4">
        <button
          onClick={() => setView("detail")}
          className="text-sm text-muted-foreground"
        >
          ← Back
        </button>
        <div className="text-center space-y-2">
          <p className="text-lg font-bold">
            Table {selectedTable.tableNumber} QR Code
          </p>
          <p className="text-xs text-muted-foreground">
            Print and place on table. Customers scan to view bill, split & pay.
          </p>
        </div>
        <div className="flex justify-center py-4">
          <div className="bg-white p-4 rounded-2xl shadow-lg">
            <PaymentQr
              merchantName={MERCHANT_NAME}
              till={TILL_NUMBER}
              reference={`Table ${selectedTable.tableNumber}`}
              cameraUrl={qrUrl}
              defaultMode="camera"
              size={200}
            />
          </div>
        </div>
        <div className="rounded-2xl bg-muted p-3 space-y-1">
          <p className="text-[10px] font-mono break-all text-muted-foreground">
            {qrUrl}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => {
              navigator.clipboard.writeText(qrUrl);
              toast.success("Link copied!");
            }}
            className="border border-border py-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-2"
          >
            <Copy className="size-3.5" />
            Copy link
          </button>
          <button
            onClick={() => {
              if (navigator.share) {
                navigator.share({
                  title: `Table ${selectedTable.tableNumber}`,
                  url: qrUrl,
                });
              } else {
                navigator.clipboard.writeText(qrUrl);
                toast.success("Link copied!");
              }
            }}
            className="border border-border py-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-2"
          >
            <Share2 className="size-3.5" />
            Share
          </button>
        </div>
        <div className="rounded-2xl border border-border p-3 space-y-2">
          <p className="text-[10px] font-mono uppercase text-muted-foreground">
            Customer gets:
          </p>
          <div className="space-y-1 text-xs">
            <p>✓ Full itemized bill</p>
            <p>✓ Split equally, by item, or custom amount</p>
            <p>✓ Leave tip for {selectedTable.server}</p>
            <p>✓ Instant M-Pesa STK Push payment</p>
            <p>✓ Auto-calculated remaining balance</p>
          </div>
        </div>
      </div>
    );
  }

  // --- Add Items View ---
  if (view === "add-items" && selectedTable) {
    return (
      <div className="px-5 pt-4 pb-20 space-y-4">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setView("detail")}
            className="text-sm text-muted-foreground"
          >
            ← Back
          </button>
          <p className="text-xs font-mono text-muted-foreground">
            Table {selectedTable.tableNumber}
          </p>
        </div>
        <p className="text-lg font-bold">Add items to order</p>
        <div className="space-y-1 max-h-64 overflow-y-auto">
          {catalogue.map((item) => {
            const qty = addingItems.get(item.id) ?? 0;
            return (
              <div
                key={item.id}
                className="flex items-center justify-between py-2 px-3 rounded-xl border border-border"
              >
                <div>
                  <p className="text-xs font-medium">{item.name}</p>
                  <p className="text-[9px] text-muted-foreground">
                    {item.category} · KES {item.price}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {qty > 0 && (
                    <button
                      onClick={() => {
                        const m = new Map(addingItems);
                        m.set(item.id, qty - 1);
                        if (qty - 1 <= 0) m.delete(item.id);
                        setAddingItems(m);
                      }}
                      className="size-7 rounded-full border border-border flex items-center justify-center"
                    >
                      <Minus className="size-3" />
                    </button>
                  )}
                  {qty > 0 && (
                    <span className="text-sm font-bold font-mono w-4 text-center">
                      {qty}
                    </span>
                  )}
                  <button
                    onClick={() => {
                      const m = new Map(addingItems);
                      m.set(item.id, qty + 1);
                      setAddingItems(m);
                    }}
                    className="size-7 rounded-full bg-foreground text-background flex items-center justify-center"
                  >
                    <Plus className="size-3" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        {addingItems.size > 0 && (
          <div className="rounded-xl bg-muted p-3">
            <p className="text-xs text-muted-foreground">
              Adding{" "}
              {Array.from(addingItems.values()).reduce((s, q) => s + q, 0)}{" "}
              items ·{" "}
              <span className="font-bold">
                KES{" "}
                {Array.from(addingItems.entries())
                  .reduce(
                    (s, [id, q]) =>
                      s + (catalogue.find((m) => m.id === id)?.price ?? 0) * q,
                    0,
                  )
                  .toLocaleString()}
              </span>
            </p>
          </div>
        )}
        <button
          onClick={addItemsToTable}
          disabled={addingItems.size === 0}
          className="w-full bg-emerald-600 text-white py-3.5 rounded-xl text-sm font-bold disabled:opacity-40"
        >
          Add to order
        </button>
      </div>
    );
  }

  // --- Table Detail View ---
  if (view === "detail" && selectedTable) {
    const total = getTotal(selectedTable);
    const remaining = getRemainingBalance(selectedTable);
    const elapsed = Math.round(
      (Date.now() - new Date(selectedTable.openedAt).getTime()) / 60000,
    );

    return (
      <div className="px-5 pt-4 pb-20 space-y-3">
        <div className="flex items-center justify-between">
          <button
            onClick={() => {
              setSelectedTable(null);
              setView("overview");
            }}
            className="text-sm text-muted-foreground"
          >
            ← All tables
          </button>
          <span
            className={`text-[9px] px-2 py-0.5 rounded-full font-mono uppercase ${
              selectedTable.status === "open"
                ? "bg-emerald-100 text-emerald-700"
                : selectedTable.status === "requesting-bill"
                  ? "bg-amber-100 text-amber-700"
                  : selectedTable.status === "partially-paid"
                    ? "bg-blue-100 text-blue-700"
                    : "bg-muted text-muted-foreground"
            }`}
          >
            {selectedTable.status.replace("-", " ")}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-xl font-bold">
              Table {selectedTable.tableNumber}
            </p>
            <p className="text-xs text-muted-foreground">
              Server: {selectedTable.server} · {elapsed} min
            </p>
          </div>
          <div className="size-12 rounded-full bg-foreground text-background flex items-center justify-center text-lg font-bold">
            {selectedTable.tableNumber}
          </div>
        </div>

        {/* Items */}
        <div className="rounded-xl border border-border overflow-hidden">
          <p className="text-[10px] font-mono uppercase text-muted-foreground px-3 pt-2">
            Order ({selectedTable.items.length} items)
          </p>
          <div className="divide-y divide-border">
            {selectedTable.items.map((item, idx) => (
              <div key={idx} className="px-3 py-2 flex justify-between">
                <div>
                  <p className="text-xs font-medium">{item.name}</p>
                  <p className="text-[9px] text-muted-foreground">
                    ×{item.qty} · {item.category}
                  </p>
                </div>
                <p className="text-xs font-mono font-bold">
                  {(item.price * item.qty).toLocaleString()}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Totals */}
        <div className="rounded-xl bg-muted p-3 space-y-1.5">
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Total</span>
            <span className="font-bold font-mono">
              KES {total.toLocaleString()}
            </span>
          </div>
          {selectedTable.paidAmount > 0 && (
            <>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Paid</span>
                <span className="font-mono text-emerald-600">
                  -KES {selectedTable.paidAmount.toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between text-xs font-bold">
                <span>Remaining</span>
                <span className="font-mono text-amber-600">
                  KES {remaining.toLocaleString()}
                </span>
              </div>
              <div className="h-1.5 bg-border rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500 rounded-full transition-all"
                  style={{
                    width: `${Math.min(100, (selectedTable.paidAmount / total) * 100)}%`,
                  }}
                />
              </div>
            </>
          )}
        </div>

        {/* Payments */}
        {selectedTable.payments.length > 0 && (
          <div className="rounded-xl border border-border p-3 space-y-2">
            <p className="text-[10px] font-mono uppercase text-muted-foreground">
              Payments received
            </p>
            {selectedTable.payments.map((p, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between text-xs"
              >
                <div>
                  <span className="font-medium">{p.name || "Anonymous"}</span>
                  <span className="text-muted-foreground ml-1">
                    ({p.phone})
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="text-right">
                    <span className="font-mono font-bold">
                      {p.amount.toLocaleString()}
                    </span>
                    {p.tip > 0 && (
                      <span className="text-amber-600 ml-1">+{p.tip} tip</span>
                    )}
                  </div>
                  <button
                    onClick={async () => {
                      const refundAmt = p.amount + p.tip;
                      if (
                        !confirm(
                          `Refund KES ${refundAmt.toLocaleString()} to ${p.name || "customer"}?`,
                        )
                      )
                        return;

                      try {
                        // Call PesaSwap refund API
                        await pesaswapClient.processRefund({
                          payment_id:
                            ((p as Record<string, unknown>)
                              .paymentId as string) ||
                            `pay_${selectedTable.id}_${idx}`,
                          amount: refundAmt * 100, // minor units
                          reason: "customer_request",
                          items: selectedTable.items?.map((it) => ({
                            id: it.id,
                            name: it.name,
                            price: it.price,
                            qty: it.qty,
                          })),
                          refunded_by: selectedTable.server || "merchant",
                        });

                        setTables((prev) =>
                          prev.map((t) =>
                            t.id === selectedTable.id
                              ? {
                                  ...t,
                                  paidAmount: Math.max(
                                    0,
                                    t.paidAmount - refundAmt,
                                  ),
                                  payments: t.payments.map((pay, i) =>
                                    i === idx
                                      ? {
                                          ...pay,
                                          amount: 0,
                                          tip: 0,
                                          name: `${pay.name} (REFUNDED)`,
                                        }
                                      : pay,
                                  ),
                                }
                              : t,
                          ),
                        );
                        setSelectedTable({
                          ...selectedTable,
                          paidAmount: Math.max(
                            0,
                            selectedTable.paidAmount - refundAmt,
                          ),
                          payments: selectedTable.payments.map((pay, i) =>
                            i === idx
                              ? {
                                  ...pay,
                                  amount: 0,
                                  tip: 0,
                                  name: `${pay.name} (REFUNDED)`,
                                }
                              : pay,
                          ),
                        });
                        toast.success(
                          `Refund of KES ${refundAmt.toLocaleString()} processed via PesaSwap`,
                        );
                      } catch (err) {
                        toast.error(
                          "Refund failed: " +
                            (err instanceof Error
                              ? err.message
                              : "Unknown error"),
                        );
                      }
                    }}
                    disabled={p.amount === 0}
                    className="text-[9px] text-red-500 border border-red-200 px-1.5 py-0.5 rounded disabled:opacity-30"
                  >
                    Refund
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Actions */}
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setView("qr")}
            className="py-3 rounded-xl border border-border text-xs font-semibold flex items-center justify-center gap-1.5"
          >
            <QrCode className="size-3.5" />
            Table QR
          </button>
          <button
            onClick={() => {
              setAddingItems(new Map());
              setView("add-items");
            }}
            className="py-3 rounded-xl border border-border text-xs font-semibold flex items-center justify-center gap-1.5"
          >
            <Plus className="size-3.5" />
            Add items
          </button>
        </div>

        {selectedTable.status !== "closed" &&
          remaining <= 0 &&
          selectedTable.paidAmount > 0 && (
            <button
              onClick={() => closeTable(selectedTable.id)}
              className="w-full bg-foreground text-background py-3 rounded-xl text-xs font-bold"
            >
              Close table (fully paid)
            </button>
          )}

        {selectedTable.status !== "closed" && remaining > 0 && (
          <button
            onClick={() => {
              const payment = {
                name: "Walk-in",
                amount: remaining,
                tip: Math.round(remaining * 0.1),
                phone: "+254711***XXX",
                time: new Date().toISOString(),
              };
              const newPaid =
                selectedTable.paidAmount + payment.amount + payment.tip;
              const total = getTotal(selectedTable);
              const autoClose = newPaid >= total;
              setTables((prev) =>
                prev.map((t) =>
                  t.id === selectedTable.id
                    ? {
                        ...t,
                        paidAmount: newPaid,
                        payments: [...t.payments, payment],
                        status: autoClose
                          ? ("closed" as const)
                          : ("partially-paid" as const),
                      }
                    : t,
                ),
              );
              // Staff notification
              notifyStaff(
                selectedTable.tableNumber,
                payment.amount,
                payment.name,
              );
              if (autoClose) {
                setSelectedTable(null);
                setView("overview");
              } else {
                setSelectedTable({
                  ...selectedTable,
                  paidAmount: newPaid,
                  payments: [...selectedTable.payments, payment],
                  status: "partially-paid",
                });
              }
            }}
            className="w-full border border-emerald-300 text-emerald-700 py-3 rounded-xl text-xs font-bold"
          >
            Simulate payment (demo)
          </button>
        )}
      </div>
    );
  }

  // --- AI Revenue Forecast View ---
  if (view === "ai-forecast") {
    const allPayments = tables.flatMap((t) =>
      t.payments.map((p) => ({
        ...p,
        tableNumber: t.tableNumber,
        openedAt: t.openedAt,
      })),
    );
    // Group by day
    const dailyRevenue: Record<string, number> = {};
    allPayments.forEach((p) => {
      const day = new Date(p.time).toLocaleDateString("en-KE", {
        weekday: "short",
      });
      dailyRevenue[day] = (dailyRevenue[day] || 0) + p.amount + p.tip;
    });
    const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const dayData = days.map((d) => ({
      day: d,
      revenue: dailyRevenue[d] || 0,
    }));
    const maxDay = Math.max(...dayData.map((d) => d.revenue), 1);
    const avgDaily =
      allPayments.length > 0
        ? Math.round(
            allPayments.reduce((s, p) => s + p.amount + p.tip, 0) /
              Math.max(Object.keys(dailyRevenue).length, 1),
          )
        : 0;
    const totalWeek = dayData.reduce((s, d) => s + d.revenue, 0);
    // Simple linear projection: avg * 7
    const projectedWeekly = avgDaily * 7;
    const trend =
      projectedWeekly > totalWeek
        ? "up"
        : projectedWeekly < totalWeek
          ? "down"
          : "flat";
    // Peak hour analysis
    const hourBuckets: Record<number, number> = {};
    allPayments.forEach((p) => {
      const h = new Date(p.time).getHours();
      hourBuckets[h] = (hourBuckets[h] || 0) + p.amount + p.tip;
    });
    const peakHour = Object.entries(hourBuckets).sort(
      (a, b) => Number(b[1]) - Number(a[1]),
    )[0];
    const avgPerTable =
      tables.length > 0
        ? Math.round(
            allPayments.reduce((s, p) => s + p.amount + p.tip, 0) /
              tables.filter((t) => t.payments.length > 0).length || 0,
          )
        : 0;

    return (
      <div className="px-5 pt-4 pb-20 space-y-4">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setView("overview")}
            className="text-sm text-muted-foreground"
          >
            ← Back
          </button>
          <div className="flex items-center gap-1.5">
            <Brain className="size-3.5 text-purple-600" />
            <span className="text-[10px] font-mono text-purple-600">
              AI Powered
            </span>
          </div>
        </div>
        <p className="text-lg font-bold">Revenue Forecast</p>

        {/* Summary cards */}
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-xl bg-muted p-3 text-center">
            <p className="text-lg font-bold font-mono text-emerald-600">
              {avgDaily.toLocaleString()}
            </p>
            <p className="text-[9px] text-muted-foreground uppercase">
              Avg/Day
            </p>
          </div>
          <div className="rounded-xl bg-muted p-3 text-center">
            <p className="text-lg font-bold font-mono">
              {projectedWeekly.toLocaleString()}
            </p>
            <p className="text-[9px] text-muted-foreground uppercase">
              Proj. Week
            </p>
          </div>
          <div className="rounded-xl bg-muted p-3 text-center">
            <p
              className={`text-lg font-bold font-mono ${trend === "up" ? "text-emerald-600" : trend === "down" ? "text-red-600" : ""}`}
            >
              {trend === "up" ? "↑" : trend === "down" ? "↓" : "→"}
            </p>
            <p className="text-[9px] text-muted-foreground uppercase">Trend</p>
          </div>
        </div>

        {/* Weekly bar chart */}
        <div className="rounded-2xl border border-border p-4 space-y-3">
          <p className="text-xs font-semibold">Revenue by Day</p>
          <div className="flex items-end gap-1.5 h-24">
            {dayData.map((d) => (
              <div
                key={d.day}
                className="flex-1 flex flex-col items-center gap-1"
              >
                <div
                  className="w-full rounded-t bg-emerald-500/80 min-h-[2px] transition-all"
                  style={{ height: `${(d.revenue / maxDay) * 100}%` }}
                />
                <span className="text-[8px] text-muted-foreground">
                  {d.day}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Insights */}
        <div className="rounded-2xl border border-border p-4 space-y-2">
          <p className="text-xs font-semibold flex items-center gap-1.5">
            <Brain className="size-3" /> AI Insights
          </p>
          <div className="space-y-1.5">
            {peakHour && (
              <p className="text-[11px] text-muted-foreground">
                💰 Peak revenue hour:{" "}
                <span className="font-semibold text-foreground">
                  {Number(peakHour[0]) % 12 || 12}
                  {Number(peakHour[0]) >= 12 ? "PM" : "AM"}
                </span>{" "}
                (KES {Number(peakHour[1]).toLocaleString()})
              </p>
            )}
            <p className="text-[11px] text-muted-foreground">
              📊 Avg spend per table:{" "}
              <span className="font-semibold text-foreground">
                KES {avgPerTable.toLocaleString()}
              </span>
            </p>
            {trend === "up" && (
              <p className="text-[11px] text-emerald-600">
                📈 Revenue trending upward — consider extending peak-hour
                capacity
              </p>
            )}
            {trend === "down" && (
              <p className="text-[11px] text-red-600">
                📉 Revenue below projection — review menu pricing or promotions
              </p>
            )}
            <p className="text-[11px] text-muted-foreground">
              🎯 To hit KES {(projectedWeekly * 1.2).toLocaleString()}/week, aim
              for{" "}
              {Math.ceil(
                avgPerTable > 0 ? (projectedWeekly * 0.2) / avgPerTable : 3,
              )}{" "}
              more tables/day
            </p>
          </div>
        </div>
      </div>
    );
  }

  // --- AI Smart Staffing View ---
  if (view === "ai-staffing") {
    const allPayments = tables.flatMap((t) =>
      t.payments.map((p) => ({
        ...p,
        tableNumber: t.tableNumber,
        server: t.server,
      })),
    );
    // Group by hour
    const hourlyLoad: Record<number, number> = {};
    allPayments.forEach((p) => {
      const h = new Date(p.time).getHours();
      hourlyLoad[h] = (hourlyLoad[h] || 0) + 1;
    });
    const hours = Array.from({ length: 14 }, (_, i) => i + 8); // 8AM-9PM
    const hourData = hours.map((h) => ({ hour: h, count: hourlyLoad[h] || 0 }));
    const maxHourCount = Math.max(...hourData.map((h) => h.count), 1);

    // Server performance
    const serverStats: Record<
      string,
      { tables: number; revenue: number; tips: number }
    > = {};
    tables.forEach((t) => {
      if (!serverStats[t.server])
        serverStats[t.server] = { tables: 0, revenue: 0, tips: 0 };
      serverStats[t.server].tables += 1;
      t.payments.forEach((p) => {
        serverStats[t.server].revenue += p.amount;
        serverStats[t.server].tips += p.tip;
      });
    });
    const serverList = Object.entries(serverStats).sort(
      (a, b) => b[1].revenue - a[1].revenue,
    );

    // Suggest staffing
    const peakHours = hourData
      .filter((h) => h.count >= maxHourCount * 0.7)
      .map((h) => h.hour);
    const quietHours = hourData
      .filter((h) => h.count > 0 && h.count <= maxHourCount * 0.3)
      .map((h) => h.hour);
    const currentActive = activeTables.length;
    const suggestedStaff = Math.max(1, Math.ceil(currentActive / 4)); // 4 tables per server

    return (
      <div className="px-5 pt-4 pb-20 space-y-4">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setView("overview")}
            className="text-sm text-muted-foreground"
          >
            ← Back
          </button>
          <div className="flex items-center gap-1.5">
            <Brain className="size-3.5 text-purple-600" />
            <span className="text-[10px] font-mono text-purple-600">
              AI Powered
            </span>
          </div>
        </div>
        <p className="text-lg font-bold">Smart Staffing</p>

        {/* Current recommendation */}
        <div className="rounded-2xl border-2 border-purple-200 bg-purple-50 dark:bg-purple-950/20 p-4 space-y-2">
          <div className="flex items-center gap-2">
            <Users className="size-4 text-purple-600" />
            <p className="text-sm font-semibold text-purple-900 dark:text-purple-200">
              Right Now
            </p>
          </div>
          <p className="text-2xl font-bold font-mono text-purple-700 dark:text-purple-300">
            {suggestedStaff} servers needed
          </p>
          <p className="text-[10px] text-purple-600 dark:text-purple-400">
            {currentActive} active tables · optimal ratio 1:4
          </p>
        </div>

        {/* Hourly heatmap */}
        <div className="rounded-2xl border border-border p-4 space-y-3">
          <p className="text-xs font-semibold">Hourly Traffic Heatmap</p>
          <div className="grid grid-cols-7 gap-1">
            {hourData.map((h) => {
              const intensity = h.count / maxHourCount;
              const bg =
                intensity > 0.7
                  ? "bg-red-500"
                  : intensity > 0.4
                    ? "bg-amber-400"
                    : intensity > 0
                      ? "bg-emerald-300"
                      : "bg-muted";
              return (
                <div
                  key={h.hour}
                  className="flex flex-col items-center gap-0.5"
                >
                  <div
                    className={`w-full aspect-square rounded ${bg} opacity-80`}
                  />
                  <span className="text-[7px] text-muted-foreground">
                    {h.hour % 12 || 12}
                    {h.hour >= 12 ? "p" : "a"}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="flex items-center gap-3 text-[8px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="size-2 rounded bg-red-500" /> Peak
            </span>
            <span className="flex items-center gap-1">
              <span className="size-2 rounded bg-amber-400" /> Busy
            </span>
            <span className="flex items-center gap-1">
              <span className="size-2 rounded bg-emerald-300" /> Normal
            </span>
            <span className="flex items-center gap-1">
              <span className="size-2 rounded bg-muted border" /> Quiet
            </span>
          </div>
        </div>

        {/* AI suggestions */}
        <div className="rounded-2xl border border-border p-4 space-y-2">
          <p className="text-xs font-semibold flex items-center gap-1.5">
            <Brain className="size-3" /> Recommendations
          </p>
          <div className="space-y-1.5">
            {peakHours.length > 0 && (
              <p className="text-[11px] text-muted-foreground">
                🔥 Peak hours:{" "}
                <span className="font-semibold text-foreground">
                  {peakHours
                    .map((h) => `${h % 12 || 12}${h >= 12 ? "PM" : "AM"}`)
                    .join(", ")}
                </span>{" "}
                — schedule extra staff
              </p>
            )}
            {quietHours.length > 0 && (
              <p className="text-[11px] text-muted-foreground">
                😴 Quiet hours:{" "}
                <span className="font-semibold text-foreground">
                  {quietHours
                    .map((h) => `${h % 12 || 12}${h >= 12 ? "PM" : "AM"}`)
                    .join(", ")}
                </span>{" "}
                — reduce to {Math.max(1, suggestedStaff - 1)} staff
              </p>
            )}
            <p className="text-[11px] text-muted-foreground">
              👥 Top performer:{" "}
              <span className="font-semibold text-foreground">
                {serverList[0]?.[0] || "—"}
              </span>
              {serverList[0]
                ? ` (KES ${serverList[0][1].revenue.toLocaleString()} revenue)`
                : ""}
            </p>
          </div>
        </div>

        {/* Server table */}
        <div className="rounded-2xl border border-border p-4 space-y-2">
          <p className="text-xs font-semibold">Server Performance</p>
          <div className="space-y-1">
            {serverList.map(([name, stats]) => (
              <div
                key={name}
                className="flex items-center justify-between py-1.5 border-b border-border last:border-0"
              >
                <div>
                  <p className="text-xs font-medium">{name}</p>
                  <p className="text-[9px] text-muted-foreground">
                    {stats.tables} tables
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-mono">
                    {stats.revenue.toLocaleString()}
                  </p>
                  <p className="text-[9px] text-amber-600">
                    +{stats.tips.toLocaleString()} tips
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // --- AI Customer Insights View ---
  if (view === "ai-insights") {
    const allPayments = tables.flatMap((t) =>
      t.payments.map((p) => ({
        ...p,
        tableNumber: t.tableNumber,
        server: t.server,
        openedAt: t.openedAt,
        closedAt: t.closedAt,
      })),
    );
    // Average dwell time (for closed tables)
    const closedTables = tables.filter(
      (t) => t.status === "closed" && t.closedAt,
    );
    const avgDwell =
      closedTables.length > 0
        ? Math.round(
            closedTables.reduce(
              (s, t) =>
                s +
                (new Date(t.closedAt!).getTime() -
                  new Date(t.openedAt).getTime()),
              0,
            ) /
              closedTables.length /
              60000,
          )
        : 0;
    // Popular items
    const itemCounts: Record<string, number> = {};
    tables.forEach((t) =>
      t.items.forEach((item) => {
        itemCounts[item.name] = (itemCounts[item.name] || 0) + item.qty;
      }),
    );
    const popularItems = Object.entries(itemCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
    const maxItemQty = popularItems[0]?.[1] || 1;
    // Peak hours
    const hourCounts: Record<number, number> = {};
    allPayments.forEach((p) => {
      const h = new Date(p.time).getHours();
      hourCounts[h] = (hourCounts[h] || 0) + 1;
    });
    // Avg spend per customer
    const avgSpend =
      allPayments.length > 0
        ? Math.round(
            allPayments.reduce((s, p) => s + p.amount + p.tip, 0) /
              allPayments.length,
          )
        : 0;
    // Repeat customers (same phone)
    const phoneCounts: Record<string, number> = {};
    allPayments.forEach((p) => {
      if (p.phone) phoneCounts[p.phone] = (phoneCounts[p.phone] || 0) + 1;
    });
    const repeatCustomers = Object.values(phoneCounts).filter(
      (c) => c > 1,
    ).length;
    const totalCustomers = Object.keys(phoneCounts).length;
    const repeatRate =
      totalCustomers > 0
        ? Math.round((repeatCustomers / totalCustomers) * 100)
        : 0;
    // Table utilization
    const tableUtilization =
      tables.length > 0
        ? Math.round((activeTables.length / Math.max(tables.length, 1)) * 100)
        : 0;

    return (
      <div className="px-5 pt-4 pb-20 space-y-4">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setView("overview")}
            className="text-sm text-muted-foreground"
          >
            ← Back
          </button>
          <div className="flex items-center gap-1.5">
            <Brain className="size-3.5 text-purple-600" />
            <span className="text-[10px] font-mono text-purple-600">
              AI Powered
            </span>
          </div>
        </div>
        <p className="text-lg font-bold">Customer Insights</p>

        {/* Key metrics */}
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: "Avg Dwell", value: `${avgDwell}m`, sub: "time at table" },
            {
              label: "Avg Spend",
              value: `${avgSpend.toLocaleString()}`,
              sub: "per customer",
            },
            {
              label: "Repeat Rate",
              value: `${repeatRate}%`,
              sub: `${repeatCustomers} of ${totalCustomers}`,
            },
            {
              label: "Utilization",
              value: `${tableUtilization}%`,
              sub: "tables in use",
            },
          ].map((m) => (
            <div key={m.label} className="rounded-xl bg-muted p-3">
              <p className="text-lg font-bold font-mono">{m.value}</p>
              <p className="text-[9px] text-muted-foreground uppercase">
                {m.label}
              </p>
              <p className="text-[8px] text-muted-foreground">{m.sub}</p>
            </div>
          ))}
        </div>

        {/* Popular items */}
        <div className="rounded-2xl border border-border p-4 space-y-3">
          <p className="text-xs font-semibold">🏆 Most Popular Items</p>
          {popularItems.length === 0 && (
            <p className="text-[10px] text-muted-foreground">
              No item data yet
            </p>
          )}
          <div className="space-y-1.5">
            {popularItems.map(([name, qty], i) => (
              <div key={name} className="flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground w-4">
                  {i + 1}.
                </span>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium">{name}</span>
                    <span className="text-[10px] font-mono text-muted-foreground">
                      ×{qty}
                    </span>
                  </div>
                  <div className="h-1 rounded-full bg-muted mt-0.5 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-emerald-500 transition-all"
                      style={{ width: `${(qty / maxItemQty) * 100}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Behavior patterns */}
        <div className="rounded-2xl border border-border p-4 space-y-2">
          <p className="text-xs font-semibold flex items-center gap-1.5">
            <Brain className="size-3" /> Behavior Patterns
          </p>
          <div className="space-y-1.5">
            <p className="text-[11px] text-muted-foreground">
              ⏱️ Customers stay an average of{" "}
              <span className="font-semibold text-foreground">
                {avgDwell} minutes
              </span>
              {avgDwell > 60
                ? " — consider table turnover strategies"
                : avgDwell > 0
                  ? " — healthy turnover rate"
                  : ""}
            </p>
            <p className="text-[11px] text-muted-foreground">
              🔄{" "}
              <span className="font-semibold text-foreground">
                {repeatRate}%
              </span>{" "}
              of customers return
              {repeatRate > 30
                ? " — excellent loyalty!"
                : repeatRate > 0
                  ? " — room to improve retention"
                  : ""}
            </p>
            {popularItems[0] && (
              <p className="text-[11px] text-muted-foreground">
                ⭐ Top seller:{" "}
                <span className="font-semibold text-foreground">
                  {popularItems[0][0]}
                </span>{" "}
                — consider upsell bundles
              </p>
            )}
            <p className="text-[11px] text-muted-foreground">
              💡 Tip: Items ordered together often make great combo deals
            </p>
          </div>
        </div>
      </div>
    );
  }

  // --- AI Anomaly Detection View ---
  if (view === "ai-anomalies") {
    const allPayments = tables.flatMap((t) =>
      t.payments.map((p) => ({
        ...p,
        tableNumber: t.tableNumber,
        server: t.server,
      })),
    );
    // Detect anomalies
    type Anomaly = {
      severity: "high" | "medium" | "low";
      title: string;
      detail: string;
      icon: string;
    };
    const anomalies: Anomaly[] = [];

    // 1. Low tip rate tables
    const tableTipRates = tables
      .filter((t) => t.payments.length > 0)
      .map((t) => {
        const totalPaid = t.payments.reduce((s, p) => s + p.amount, 0);
        const totalTips = t.payments.reduce((s, p) => s + p.tip, 0);
        return {
          table: t.tableNumber,
          server: t.server,
          tipRate: totalPaid > 0 ? totalTips / totalPaid : 0,
        };
      });
    const zeroTipTables = tableTipRates.filter((t) => t.tipRate === 0);
    if (zeroTipTables.length > 2) {
      anomalies.push({
        severity: "medium",
        title: "Low Tipping Pattern",
        detail: `${zeroTipTables.length} tables left no tip. Servers: ${[...new Set(zeroTipTables.map((t) => t.server))].join(", ")}`,
        icon: "💰",
      });
    }

    // 2. Walkout risk (open tables with no payment for 2h+)
    if (walkoutRiskTables.length > 0) {
      anomalies.push({
        severity: "high",
        title: "Walkout Risk Detected",
        detail: `Tables ${walkoutRiskTables.map((t) => t.tableNumber).join(", ")} open 2h+ with no payment`,
        icon: "🚨",
      });
    }

    // 3. Revenue drop detection (compare recent vs older)
    const now = Date.now();
    const recentPayments = allPayments.filter(
      (p) => now - new Date(p.time).getTime() < 3600000 * 3,
    );
    const olderPayments = allPayments.filter((p) => {
      const age = now - new Date(p.time).getTime();
      return age >= 3600000 * 3 && age < 3600000 * 6;
    });
    const recentRev = recentPayments.reduce((s, p) => s + p.amount + p.tip, 0);
    const olderRev = olderPayments.reduce((s, p) => s + p.amount + p.tip, 0);
    if (olderRev > 0 && recentRev < olderRev * 0.5) {
      anomalies.push({
        severity: "medium",
        title: "Revenue Drop",
        detail: `Last 3h revenue (KES ${recentRev.toLocaleString()}) is ${Math.round((1 - recentRev / olderRev) * 100)}% below previous period`,
        icon: "📉",
      });
    }

    // 4. Unusually high transaction
    const avgPayment =
      allPayments.length > 0
        ? allPayments.reduce((s, p) => s + p.amount, 0) / allPayments.length
        : 0;
    const highPayments = allPayments.filter(
      (p) => p.amount > avgPayment * 3 && avgPayment > 0,
    );
    if (highPayments.length > 0) {
      anomalies.push({
        severity: "low",
        title: "Unusually Large Payments",
        detail: `${highPayments.length} payment(s) 3x above average (KES ${Math.round(avgPayment).toLocaleString()} avg)`,
        icon: "⚠️",
      });
    }

    // 5. Server tip disparity
    const serverTips: Record<string, { total: number; count: number }> = {};
    allPayments.forEach((p) => {
      if (!serverTips[p.server]) serverTips[p.server] = { total: 0, count: 0 };
      serverTips[p.server].total += p.tip;
      serverTips[p.server].count += 1;
    });
    const serverAvgs = Object.entries(serverTips)
      .filter(([, s]) => s.count > 0)
      .map(([name, s]) => ({ name, avg: s.total / s.count }));
    if (serverAvgs.length >= 2) {
      const maxAvg = Math.max(...serverAvgs.map((s) => s.avg));
      const minAvg = Math.min(...serverAvgs.map((s) => s.avg));
      if (maxAvg > 0 && minAvg < maxAvg * 0.3) {
        const lowServer = serverAvgs.find((s) => s.avg === minAvg);
        anomalies.push({
          severity: "low",
          title: "Tip Disparity",
          detail: `${lowServer?.name} receiving significantly lower tips — may need service coaching`,
          icon: "👤",
        });
      }
    }

    // 6. Long table times (closed tables that took unusually long)
    const closedWithTimes = tables.filter(
      (t) => t.status === "closed" && t.closedAt,
    );
    const dwellTimes = closedWithTimes.map(
      (t) =>
        (new Date(t.closedAt!).getTime() - new Date(t.openedAt).getTime()) /
        60000,
    );
    const avgDwell =
      dwellTimes.length > 0
        ? dwellTimes.reduce((s, d) => s + d, 0) / dwellTimes.length
        : 0;
    const longTables = closedWithTimes.filter((t) => {
      const dwell =
        (new Date(t.closedAt!).getTime() - new Date(t.openedAt).getTime()) /
        60000;
      return dwell > avgDwell * 2 && avgDwell > 0;
    });
    if (longTables.length > 0) {
      anomalies.push({
        severity: "low",
        title: "Extended Table Times",
        detail: `${longTables.length} table(s) took 2x longer than average (${Math.round(avgDwell)}min avg)`,
        icon: "⏰",
      });
    }

    const severityOrder = { high: 0, medium: 1, low: 2 };
    anomalies.sort(
      (a, b) => severityOrder[a.severity] - severityOrder[b.severity],
    );

    return (
      <div className="px-5 pt-4 pb-20 space-y-4">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setView("overview")}
            className="text-sm text-muted-foreground"
          >
            ← Back
          </button>
          <div className="flex items-center gap-1.5">
            <Brain className="size-3.5 text-purple-600" />
            <span className="text-[10px] font-mono text-purple-600">
              AI Powered
            </span>
          </div>
        </div>
        <p className="text-lg font-bold">Anomaly Detection</p>

        {/* Status badge */}
        <div
          className={`rounded-2xl p-4 text-center ${anomalies.length === 0 ? "bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200" : "bg-amber-50 dark:bg-amber-950/20 border border-amber-200"}`}
        >
          <p className="text-2xl">{anomalies.length === 0 ? "✅" : "⚡"}</p>
          <p
            className={`text-sm font-semibold mt-1 ${anomalies.length === 0 ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}`}
          >
            {anomalies.length === 0
              ? "All Clear"
              : `${anomalies.length} Issue${anomalies.length > 1 ? "s" : ""} Detected`}
          </p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {anomalies.length === 0
              ? "No anomalies detected — operations running smoothly"
              : "Review items below for potential action"}
          </p>
        </div>

        {/* Anomaly cards */}
        <div className="space-y-2">
          {anomalies.map((a, i) => (
            <div
              key={i}
              className={`rounded-xl border p-3 space-y-1 ${
                a.severity === "high"
                  ? "border-red-200 bg-red-50 dark:bg-red-950/20"
                  : a.severity === "medium"
                    ? "border-amber-200 bg-amber-50 dark:bg-amber-950/20"
                    : "border-border"
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="text-sm">{a.icon}</span>
                <p
                  className={`text-xs font-semibold ${
                    a.severity === "high"
                      ? "text-red-700 dark:text-red-300"
                      : a.severity === "medium"
                        ? "text-amber-700 dark:text-amber-300"
                        : ""
                  }`}
                >
                  {a.title}
                </p>
                <span
                  className={`ml-auto text-[8px] font-mono uppercase px-1.5 py-0.5 rounded-full ${
                    a.severity === "high"
                      ? "bg-red-200 text-red-800"
                      : a.severity === "medium"
                        ? "bg-amber-200 text-amber-800"
                        : "bg-muted text-muted-foreground"
                  }`}
                >
                  {a.severity}
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground">{a.detail}</p>
            </div>
          ))}
        </div>

        {/* Monitoring status */}
        <div className="rounded-2xl border border-border p-4 space-y-2">
          <p className="text-xs font-semibold">Monitoring Active</p>
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: "Tip Rates", status: "✓" },
              { label: "Walkout Risk", status: "✓" },
              { label: "Revenue Drops", status: "✓" },
              { label: "Large Payments", status: "✓" },
              { label: "Staff Performance", status: "✓" },
              { label: "Table Times", status: "✓" },
            ].map((m) => (
              <div key={m.label} className="flex items-center gap-1.5">
                <span className="text-[9px] text-emerald-600">{m.status}</span>
                <span className="text-[10px] text-muted-foreground">
                  {m.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // --- Orders Queue (Kitchen/Bar Display) ---
  if (view === "orders-queue") {
    const filteredOrders = orders.filter(
      (o) => ordersFilter === "all" || o.destination === ordersFilter,
    );
    const newOrders2 = filteredOrders.filter((o) => o.status === "new");
    const preparingOrders = filteredOrders.filter(
      (o) => o.status === "preparing",
    );
    const readyOrders = filteredOrders.filter((o) => o.status === "ready");

    return (
      <div className="px-5 pt-4 pb-20 space-y-4">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setView("overview")}
            className="text-sm text-muted-foreground"
          >
            ← Back
          </button>
          <p className="text-[10px] font-mono text-muted-foreground">
            {filteredOrders.length} orders
          </p>
        </div>
        <p className="text-lg font-bold">Orders Queue</p>

        {/* Filter tabs */}
        <div className="flex gap-1 bg-muted rounded-xl p-1">
          {(["all", "kitchen", "bar"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setOrdersFilter(f)}
              className={`flex-1 py-2 rounded-lg text-[10px] font-semibold capitalize ${ordersFilter === f ? "bg-background shadow-sm" : ""}`}
            >
              {f === "kitchen" ? "🍳 " : f === "bar" ? "🍺 " : ""}
              {f}
            </button>
          ))}
        </div>

        {/* New orders */}
        {newOrders2.length > 0 && (
          <div className="space-y-2">
            <p className="text-[10px] font-mono uppercase text-red-600 flex items-center gap-1">
              <span className="size-2 rounded-full bg-red-500 animate-pulse" />{" "}
              NEW ({newOrders2.length})
            </p>
            {newOrders2.map((o) => (
              <div
                key={o.id}
                className="rounded-xl border-2 border-red-200 bg-red-50 dark:bg-red-950/20 p-3 space-y-1.5"
              >
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold">
                    Table {o.tableNumber} ·{" "}
                    {o.destination === "bar" ? "🍺 Bar" : "🍳 Kitchen"}
                  </p>
                  <span className="text-[8px] text-muted-foreground">
                    {new Date(o.orderedAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
                {o.items.map((item, i) => (
                  <p key={i} className="text-[11px]">
                    × {item.qty} {item.name}
                    {item.notes ? ` (${item.notes})` : ""}
                  </p>
                ))}
                <p className="text-[9px] text-muted-foreground">
                  Server: {o.server}
                  {o.customerName ? ` · Customer: ${o.customerName}` : ""}
                </p>
                <button
                  onClick={() => updateOrderStatus(o.id, "preparing")}
                  className="w-full bg-orange-500 text-white py-2 rounded-xl text-xs font-bold mt-1"
                >
                  Start Preparing
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Preparing */}
        {preparingOrders.length > 0 && (
          <div className="space-y-2">
            <p className="text-[10px] font-mono uppercase text-orange-600">
              🔥 PREPARING ({preparingOrders.length})
            </p>
            {preparingOrders.map((o) => (
              <div
                key={o.id}
                className="rounded-xl border border-orange-200 bg-orange-50 dark:bg-orange-950/20 p-3 space-y-1.5"
              >
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold">
                    Table {o.tableNumber} ·{" "}
                    {o.destination === "bar" ? "🍺" : "🍳"}
                  </p>
                  <span className="text-[8px] text-muted-foreground">
                    {Math.round(
                      (Date.now() - new Date(o.orderedAt).getTime()) / 60000,
                    )}
                    m ago
                  </span>
                </div>
                {o.items.map((item, i) => (
                  <p key={i} className="text-[11px]">
                    × {item.qty} {item.name}
                  </p>
                ))}
                <button
                  onClick={() => updateOrderStatus(o.id, "ready")}
                  className="w-full bg-emerald-600 text-white py-2 rounded-xl text-xs font-bold mt-1"
                >
                  ✓ Mark Ready
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Ready for pickup */}
        {readyOrders.length > 0 && (
          <div className="space-y-2">
            <p className="text-[10px] font-mono uppercase text-emerald-600">
              ✅ READY ({readyOrders.length})
            </p>
            {readyOrders.map((o) => (
              <div
                key={o.id}
                className="rounded-xl border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 p-3 space-y-1.5"
              >
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold">
                    Table {o.tableNumber} ·{" "}
                    {o.destination === "bar" ? "🍺" : "🍳"}
                  </p>
                  <span className="text-[8px] text-emerald-600 font-semibold">
                    READY
                  </span>
                </div>
                {o.items.map((item, i) => (
                  <p key={i} className="text-[11px]">
                    × {item.qty} {item.name}
                  </p>
                ))}
                <button
                  onClick={() => updateOrderStatus(o.id, "served")}
                  className="w-full border border-emerald-300 text-emerald-700 py-2 rounded-xl text-xs font-bold mt-1"
                >
                  Served ✓
                </button>
              </div>
            ))}
          </div>
        )}

        {filteredOrders.length === 0 && (
          <div className="text-center py-8">
            <p className="text-2xl">👨‍🍳</p>
            <p className="text-xs text-muted-foreground mt-2">
              No active orders
            </p>
            <p className="text-[10px] text-muted-foreground">
              Orders from tables will appear here in real time
            </p>
          </div>
        )}
      </div>
    );
  }

  // --- Reservations View ---
  if (view === "reservations") {
    function createReservation() {
      if (!resName || !resPhone || !resTable) return;
      const newRes: Reservation = {
        id: `res-${Date.now()}`,
        tableNumber: Number(resTable),
        customerName: resName,
        phone: resPhone,
        date: resDate,
        time: resTime,
        covers: Number(resCovers) || 2,
        status: "confirmed",
      };
      setReservations((prev) => [...prev, newRes]);
      setResName("");
      setResPhone("");
      setResTable("");
      toast.success(`Reservation confirmed: Table ${resTable} at ${resTime}`);
    }

    const todayRes = reservations.filter(
      (r) => r.date === new Date().toISOString().slice(0, 10),
    );
    const upcomingRes = reservations.filter(
      (r) =>
        r.date > new Date().toISOString().slice(0, 10) &&
        r.status === "confirmed",
    );

    return (
      <div className="px-5 pt-4 pb-20 space-y-4">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setView("overview")}
            className="text-sm text-muted-foreground"
          >
            ← Back
          </button>
          <p className="text-[10px] font-mono text-muted-foreground">
            {reservations.length} total
          </p>
        </div>
        <p className="text-lg font-bold">Table Reservations</p>

        {/* New reservation form */}
        <div className="rounded-2xl border border-border p-3 space-y-2">
          <p className="text-[10px] font-mono uppercase text-muted-foreground">
            New Reservation
          </p>
          <input
            type="text"
            value={resName}
            onChange={(e) => setResName(e.target.value)}
            placeholder="Customer name"
            className="w-full bg-muted rounded-xl px-3 py-2.5 text-xs outline-none"
          />
          <input
            type="tel"
            value={resPhone}
            onChange={(e) => setResPhone(e.target.value)}
            placeholder="Phone (0712...)"
            className="w-full bg-muted rounded-xl px-3 py-2.5 text-xs outline-none"
          />
          <div className="flex gap-2">
            <input
              type="date"
              value={resDate}
              onChange={(e) => setResDate(e.target.value)}
              className="flex-1 bg-muted rounded-xl px-3 py-2.5 text-xs outline-none"
            />
            <input
              type="time"
              value={resTime}
              onChange={(e) => setResTime(e.target.value)}
              className="w-24 bg-muted rounded-xl px-3 py-2.5 text-xs outline-none"
            />
          </div>
          <div className="flex gap-2">
            <div className="flex-1 flex items-center gap-1 bg-muted rounded-xl px-3 py-2.5">
              <span className="text-[10px] text-muted-foreground">Table #</span>
              <input
                type="tel"
                value={resTable}
                onChange={(e) =>
                  setResTable(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))
                }
                className="flex-1 bg-transparent text-xs font-mono outline-none"
              />
            </div>
            <div className="flex items-center gap-1 bg-muted rounded-xl px-3 py-2.5">
              <span className="text-[10px] text-muted-foreground">Covers</span>
              <input
                type="tel"
                value={resCovers}
                onChange={(e) =>
                  setResCovers(
                    e.target.value.replace(/[^0-9]/g, "").slice(0, 2),
                  )
                }
                className="w-8 bg-transparent text-xs font-mono outline-none text-center"
              />
            </div>
          </div>
          <button
            onClick={createReservation}
            disabled={!resName || !resPhone || !resTable}
            className="w-full bg-emerald-600 text-white py-2.5 rounded-xl text-xs font-bold disabled:opacity-40"
          >
            Confirm Reservation
          </button>
        </div>

        {/* Today's reservations */}
        {todayRes.length > 0 && (
          <div className="space-y-2">
            <p className="text-[10px] font-mono uppercase text-muted-foreground">
              Today ({todayRes.length})
            </p>
            {todayRes.map((r) => (
              <div
                key={r.id}
                className="rounded-xl border border-border p-3 flex items-center justify-between"
              >
                <div>
                  <p className="text-xs font-medium">{r.customerName}</p>
                  <p className="text-[9px] text-muted-foreground">
                    Table {r.tableNumber} · {r.time} · {r.covers} covers
                  </p>
                </div>
                <div className="flex gap-1">
                  {r.status === "confirmed" && (
                    <button
                      onClick={() =>
                        setReservations((prev) =>
                          prev.map((x) =>
                            x.id === r.id ? { ...x, status: "seated" } : x,
                          ),
                        )
                      }
                      className="px-2 py-1 rounded-lg bg-emerald-100 text-emerald-700 text-[9px] font-semibold"
                    >
                      Seat
                    </button>
                  )}
                  {r.status === "confirmed" && (
                    <button
                      onClick={() =>
                        setReservations((prev) =>
                          prev.map((x) =>
                            x.id === r.id ? { ...x, status: "no-show" } : x,
                          ),
                        )
                      }
                      className="px-2 py-1 rounded-lg bg-red-100 text-red-700 text-[9px] font-semibold"
                    >
                      No-show
                    </button>
                  )}
                  <span
                    className={`px-2 py-1 rounded-lg text-[9px] font-semibold ${
                      r.status === "seated"
                        ? "bg-emerald-100 text-emerald-700"
                        : r.status === "no-show"
                          ? "bg-red-100 text-red-700"
                          : r.status === "cancelled"
                            ? "bg-muted text-muted-foreground"
                            : "bg-blue-100 text-blue-700"
                    }`}
                  >
                    {r.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Upcoming */}
        {upcomingRes.length > 0 && (
          <div className="space-y-2">
            <p className="text-[10px] font-mono uppercase text-muted-foreground">
              Upcoming ({upcomingRes.length})
            </p>
            {upcomingRes.map((r) => (
              <div
                key={r.id}
                className="rounded-xl border border-border p-2.5 flex items-center justify-between"
              >
                <div>
                  <p className="text-xs font-medium">{r.customerName}</p>
                  <p className="text-[9px] text-muted-foreground">
                    Table {r.tableNumber} · {r.date} {r.time} · {r.covers} pax
                  </p>
                </div>
                <button
                  onClick={() =>
                    setReservations((prev) =>
                      prev.map((x) =>
                        x.id === r.id ? { ...x, status: "cancelled" } : x,
                      ),
                    )
                  }
                  className="px-2 py-1 rounded-lg border border-red-200 text-red-600 text-[9px]"
                >
                  Cancel
                </button>
              </div>
            ))}
          </div>
        )}

        {reservations.length === 0 && (
          <div className="text-center py-8">
            <p className="text-2xl">📅</p>
            <p className="text-xs text-muted-foreground mt-2">
              No reservations yet
            </p>
          </div>
        )}
      </div>
    );
  }

  // --- Loyalty & Rewards View ---
  if (view === "loyalty") {
    const TIER_COLORS = {
      Bronze: "text-amber-700 bg-amber-100",
      Silver: "text-gray-700 bg-gray-100",
      Gold: "text-yellow-700 bg-yellow-100",
      Platinum: "text-purple-700 bg-purple-100",
    };
    const totalPoints = loyaltyCustomers.reduce((s, c) => s + c.points, 0);
    const sortedCustomers = [...loyaltyCustomers].sort(
      (a, b) => b.totalSpent - a.totalSpent,
    );

    return (
      <div className="px-5 pt-4 pb-20 space-y-4">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setView("overview")}
            className="text-sm text-muted-foreground"
          >
            ← Back
          </button>
          <div className="flex items-center gap-1.5">
            <Gift className="size-3.5 text-amber-600" />
            <span className="text-[10px] font-mono text-amber-600">
              {loyaltyCustomers.length} members
            </span>
          </div>
        </div>
        <p className="text-lg font-bold">Loyalty & Rewards</p>

        {/* Program summary */}
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-xl bg-muted p-3 text-center">
            <p className="text-lg font-bold font-mono text-amber-600">
              {loyaltyCustomers.length}
            </p>
            <p className="text-[9px] text-muted-foreground uppercase">
              Members
            </p>
          </div>
          <div className="rounded-xl bg-muted p-3 text-center">
            <p className="text-lg font-bold font-mono">
              {totalPoints.toLocaleString()}
            </p>
            <p className="text-[9px] text-muted-foreground uppercase">Points</p>
          </div>
          <div className="rounded-xl bg-muted p-3 text-center">
            <p className="text-lg font-bold font-mono text-emerald-600">
              {loyaltyCustomers.filter((c) => c.visits > 1).length}
            </p>
            <p className="text-[9px] text-muted-foreground uppercase">Repeat</p>
          </div>
        </div>

        {/* Tier breakdown */}
        <div className="rounded-2xl border border-border p-4 space-y-2">
          <p className="text-xs font-semibold">Tier Program</p>
          <p className="text-[10px] text-muted-foreground">
            Earn 1 point per KES 10 spent. Points redeemable at checkout.
          </p>
          <div className="grid grid-cols-4 gap-1.5 mt-2">
            {(["Bronze", "Silver", "Gold", "Platinum"] as const).map((tier) => {
              const count = loyaltyCustomers.filter(
                (c) => c.tier === tier,
              ).length;
              const threshold =
                tier === "Bronze"
                  ? "0"
                  : tier === "Silver"
                    ? "5K"
                    : tier === "Gold"
                      ? "20K"
                      : "50K+";
              return (
                <div key={tier} className="text-center">
                  <p
                    className={`text-xs font-bold rounded-lg py-1 ${TIER_COLORS[tier]}`}
                  >
                    {count}
                  </p>
                  <p className="text-[8px] font-semibold mt-0.5">{tier}</p>
                  <p className="text-[7px] text-muted-foreground">
                    {threshold}
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        {/* Customer list */}
        <div className="space-y-1 max-h-52 overflow-y-auto">
          {sortedCustomers.length === 0 && (
            <div className="text-center py-6">
              <p className="text-2xl">🎁</p>
              <p className="text-xs text-muted-foreground mt-2">
                No loyalty members yet
              </p>
              <p className="text-[10px] text-muted-foreground">
                Customers auto-enroll on first payment with phone number
              </p>
            </div>
          )}
          {sortedCustomers.map((c) => (
            <div
              key={c.phone}
              className="flex items-center justify-between py-2 px-3 rounded-xl border border-border"
            >
              <div>
                <p className="text-xs font-medium">{c.name}</p>
                <p className="text-[9px] text-muted-foreground">
                  {c.phone} · {c.visits} visits
                </p>
              </div>
              <div className="text-right">
                <span
                  className={`px-1.5 py-0.5 rounded-full text-[8px] font-bold ${TIER_COLORS[c.tier]}`}
                >
                  {c.tier}
                </span>
                <p className="text-[9px] font-mono mt-0.5">
                  {c.points.toLocaleString()} pts
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // --- Overview ---
  return (
    <div className="px-5 pt-4 pb-20 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-lg font-bold">Table Service</p>
        <button
          onClick={() => setShowNewTable(!showNewTable)}
          className="size-8 rounded-full bg-foreground text-background flex items-center justify-center"
        >
          <Plus className="size-4" />
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2">
        {[
          {
            label: "Active",
            value: activeTables.length.toString(),
            color: "text-emerald-600",
          },
          {
            label: "Revenue",
            value: `${(totalRevenue / 1000).toFixed(1)}K`,
            color: "text-foreground",
          },
          {
            label: "Tips",
            value: `${totalTips.toLocaleString()}`,
            color: "text-amber-600",
          },
        ].map((s) => (
          <div key={s.label} className="rounded-xl bg-muted p-3 text-center">
            <p className={`text-lg font-bold font-mono ${s.color}`}>
              {s.value}
            </p>
            <p className="text-[9px] text-muted-foreground uppercase">
              {s.label}
            </p>
          </div>
        ))}
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => setView("quick-charge")}
          className="py-3 rounded-xl border border-border text-xs font-semibold flex items-center justify-center gap-1.5"
        >
          <Zap className="size-3.5" />
          Quick Charge
        </button>
        <button
          onClick={() => setView("catalogue")}
          className="py-3 rounded-xl border border-border text-xs font-semibold flex items-center justify-center gap-1.5"
        >
          <ClipboardPaste className="size-3.5" />
          Catalogue ({catalogue.length})
        </button>
        <button
          onClick={() => setView("tips-analytics")}
          className="py-3 rounded-xl border border-border text-xs font-semibold flex items-center justify-center gap-1.5"
        >
          <TrendingUp className="size-3.5" />
          Tips Analytics
        </button>
        <button
          onClick={() => setView("payment-history")}
          className="py-3 rounded-xl border border-border text-xs font-semibold flex items-center justify-center gap-1.5"
        >
          <Clock3 className="size-3.5" />
          History
        </button>
      </div>

      {/* Intelligence Layer */}
      <div className="rounded-2xl border-2 border-purple-200 dark:border-purple-800 bg-purple-50/50 dark:bg-purple-950/20 p-3 space-y-2">
        <div className="flex items-center gap-1.5">
          <Brain className="size-3.5 text-purple-600" />
          <p className="text-xs font-semibold text-purple-900 dark:text-purple-200">
            Intelligence Layer
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setView("ai-forecast")}
            className="py-2.5 rounded-xl bg-purple-100 dark:bg-purple-900/40 text-[10px] font-semibold text-purple-800 dark:text-purple-200 flex items-center justify-center gap-1"
          >
            <TrendingUp className="size-3" />
            Revenue Forecast
          </button>
          <button
            onClick={() => setView("ai-staffing")}
            className="py-2.5 rounded-xl bg-purple-100 dark:bg-purple-900/40 text-[10px] font-semibold text-purple-800 dark:text-purple-200 flex items-center justify-center gap-1"
          >
            <Users className="size-3" />
            Smart Staffing
          </button>
          <button
            onClick={() => setView("ai-insights")}
            className="py-2.5 rounded-xl bg-purple-100 dark:bg-purple-900/40 text-[10px] font-semibold text-purple-800 dark:text-purple-200 flex items-center justify-center gap-1"
          >
            <BarChart3 className="size-3" />
            Customer Insights
          </button>
          <button
            onClick={() => setView("ai-anomalies")}
            className="py-2.5 rounded-xl bg-purple-100 dark:bg-purple-900/40 text-[10px] font-semibold text-purple-800 dark:text-purple-200 flex items-center justify-center gap-1"
          >
            <AlertTriangle className="size-3" />
            Anomaly Detection
          </button>
        </div>
      </div>

      {/* Operations */}
      <div className="rounded-2xl border-2 border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20 p-3 space-y-2">
        <div className="flex items-center gap-1.5">
          <UtensilsCrossed className="size-3.5 text-amber-600" />
          <p className="text-xs font-semibold text-amber-900 dark:text-amber-200">
            Operations
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={() => setView("orders-queue")}
            className="py-2.5 rounded-xl bg-amber-100 dark:bg-amber-900/40 text-[10px] font-semibold text-amber-800 dark:text-amber-200 flex flex-col items-center gap-0.5"
          >
            <span className="text-sm">🍳🍺</span>
            Orders
            {orders.filter((o) => o.status === "new").length > 0 && (
              <span className="size-4 rounded-full bg-red-500 text-white text-[8px] flex items-center justify-center font-bold">
                {orders.filter((o) => o.status === "new").length}
              </span>
            )}
          </button>
          <button
            onClick={() => setView("reservations")}
            className="py-2.5 rounded-xl bg-amber-100 dark:bg-amber-900/40 text-[10px] font-semibold text-amber-800 dark:text-amber-200 flex flex-col items-center gap-0.5"
          >
            <Calendar className="size-4" />
            Reservations
          </button>
          <button
            onClick={() => setView("loyalty")}
            className="py-2.5 rounded-xl bg-amber-100 dark:bg-amber-900/40 text-[10px] font-semibold text-amber-800 dark:text-amber-200 flex flex-col items-center gap-0.5"
          >
            <Gift className="size-4" />
            Loyalty
          </button>
        </div>
      </div>

      {/* Walkout risk alert */}
      {walkoutRiskTables.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-950/20 p-3 space-y-1">
          <div className="flex items-center gap-2">
            <AlertTriangle className="size-3.5 text-red-600" />
            <p className="text-xs font-semibold text-red-700 dark:text-red-400">
              Walkout risk
            </p>
          </div>
          <p className="text-[10px] text-red-600 dark:text-red-400">
            {walkoutRiskTables.map((t) => `Table ${t.tableNumber}`).join(", ")}{" "}
            — open 2h+ with no payment
          </p>
        </div>
      )}

      {/* New table form */}
      {showNewTable && (
        <div className="rounded-2xl border border-border p-4 space-y-3">
          <p className="text-sm font-semibold">Open new table</p>
          <div className="flex gap-2">
            <input
              type="tel"
              value={newTableNum}
              onChange={(e) =>
                setNewTableNum(
                  e.target.value.replace(/[^0-9]/g, "").slice(0, 3),
                )
              }
              placeholder="Table #"
              className="flex-1 bg-muted rounded-xl px-3 py-2.5 text-sm font-mono outline-none"
            />
            <select
              value={newTableServer}
              onChange={(e) => setNewTableServer(e.target.value)}
              className="flex-1 bg-muted rounded-xl px-3 py-2.5 text-xs outline-none"
            >
              {SERVERS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={createTable}
            disabled={!newTableNum}
            className="w-full bg-emerald-600 text-white py-2.5 rounded-xl text-xs font-bold disabled:opacity-40"
          >
            Open table {newTableNum || "#"}
          </button>
        </div>
      )}

      {/* Active tables */}
      <div className="space-y-2">
        <p className="text-[10px] font-mono uppercase text-muted-foreground">
          Active tables ({activeTables.length})
        </p>
        {activeTables.length === 0 && (
          <p className="text-xs text-muted-foreground py-4 text-center">
            No active tables. Tap + to open one.
          </p>
        )}
        {activeTables.map((t) => {
          const total = getTotal(t);
          const remaining = getRemainingBalance(t);
          const elapsed = Math.round(
            (Date.now() - new Date(t.openedAt).getTime()) / 60000,
          );
          return (
            <button
              key={t.id}
              onClick={() => {
                setSelectedTable(t);
                setView("detail");
              }}
              className="w-full text-left rounded-xl border border-border p-3 flex items-center gap-3 hover:bg-muted/50 transition-colors"
            >
              <div
                className={`size-10 rounded-full flex items-center justify-center text-sm font-bold ${
                  t.status === "requesting-bill"
                    ? "bg-amber-100 text-amber-700"
                    : t.status === "partially-paid"
                      ? "bg-blue-100 text-blue-700"
                      : "bg-muted text-foreground"
                }`}
              >
                {t.tableNumber}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-xs font-semibold">Table {t.tableNumber}</p>
                  {t.status === "requesting-bill" && (
                    <span className="text-[8px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-mono">
                      BILL REQUESTED
                    </span>
                  )}
                  {elapsed > 120 &&
                    t.paidAmount === 0 &&
                    t.status !== "closed" && (
                      <span className="text-[8px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full font-mono animate-pulse">
                        ⚠️ WALKOUT
                      </span>
                    )}
                </div>
                <p className="text-[10px] text-muted-foreground">
                  {t.server} · {t.items.length} items · {elapsed}m
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs font-bold font-mono">
                  {remaining.toLocaleString()}
                </p>
                {t.paidAmount > 0 && (
                  <p className="text-[9px] text-emerald-600">
                    -{t.paidAmount.toLocaleString()} paid
                  </p>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
