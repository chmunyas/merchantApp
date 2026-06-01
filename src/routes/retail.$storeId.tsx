import { createFileRoute } from "@tanstack/react-router";
import {
  Minus,
  Plus,
  ShoppingCart,
  Smartphone,
  Store,
  Wallet,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type {
  RetailProduct,
  RetailSale,
  StockAdjustment,
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
import { Input } from "@/components/ui/input";
import {
  ensureRetailDemoData,
  getRetailStoreSlug,
  saveRetailProducts,
  saveRetailSales,
  saveStockAdjustments,
  type RetailStoreProfile,
} from "@/lib/merchant-dashboard";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/retail/$storeId")({
  component: RetailStorefrontPage,
});

type CartItem = {
  productId: string;
  name: string;
  qty: number;
  unitPrice: number;
  image?: string;
  stock: number;
};

type Receipt = {
  title: string;
  message: string;
};

const currency = new Intl.NumberFormat("en-KE", {
  style: "currency",
  currency: "KES",
  maximumFractionDigits: 0,
});

function createId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function RetailStorefrontPage() {
  const { storeId } = Route.useParams();
  const [storeProfile, setStoreProfile] = useState<RetailStoreProfile | null>(
    null,
  );
  const [products, setProducts] = useState<RetailProduct[]>([]);
  const [sales, setSales] = useState<RetailSale[]>([]);
  const [adjustments, setAdjustments] = useState<StockAdjustment[]>([]);
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [customerName, setCustomerName] = useState("");
  const [mpesaPhone, setMpesaPhone] = useState("");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const snapshot = ensureRetailDemoData();
    setStoreProfile(snapshot.storeProfile);
    setProducts(snapshot.products.filter((product) => product.isActive));
    setSales(snapshot.sales);
    setAdjustments(snapshot.adjustments);
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    saveRetailProducts(products);
    saveRetailSales(sales);
    saveStockAdjustments(adjustments);
  }, [adjustments, loaded, products, sales]);

  const categories = useMemo(
    () => ["All", ...new Set(products.map((product) => product.category))],
    [products],
  );
  const filteredProducts = useMemo(() => {
    const lookup = query.trim().toLowerCase();
    return products.filter((product) => {
      const matchesQuery =
        !lookup ||
        product.name.toLowerCase().includes(lookup) ||
        product.category.toLowerCase().includes(lookup);
      const matchesCategory =
        categoryFilter === "All" || product.category === categoryFilter;
      return product.stock > 0 && matchesQuery && matchesCategory;
    });
  }, [categoryFilter, products, query]);
  const cartTotal = useMemo(
    () => cart.reduce((sum, item) => sum + item.qty * item.unitPrice, 0),
    [cart],
  );
  const publicStoreId = storeProfile ? getRetailStoreSlug(storeProfile) : "";

  function addToCart(product: RetailProduct) {
    setCart((current) => {
      const existing = current.find((item) => item.productId === product.id);
      if (existing) {
        return current.map((item) =>
          item.productId === product.id
            ? {
                ...item,
                qty: Math.min(item.qty + 1, product.stock),
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
          qty: 1,
          unitPrice: product.sellPrice,
          image: product.image,
          stock: product.stock,
        },
      ];
    });
  }

  function changeQty(productId: string, delta: number) {
    const product = products.find((entry) => entry.id === productId);
    if (!product) return;
    setCart((current) =>
      current
        .map((item) =>
          item.productId === productId
            ? {
                ...item,
                qty: Math.max(0, Math.min(item.qty + delta, product.stock)),
              }
            : item,
        )
        .filter((item) => item.qty > 0),
    );
  }

  function checkout() {
    if (!storeProfile || !cart.length) {
      setMessage("Add products to cart before checkout.");
      return;
    }
    if (!mpesaPhone.trim()) {
      setMessage("Enter your M-Pesa phone number to continue.");
      return;
    }

    const sale: RetailSale = {
      id: createId("sale"),
      items: cart.map((item) => ({
        productId: item.productId,
        name: item.name,
        qty: item.qty,
        unitPrice: item.unitPrice,
      })),
      total: cartTotal,
      paymentMethod: "mpesa",
      customerName: customerName.trim() || undefined,
      customerPhone: mpesaPhone.trim(),
      mpesaRef: `PS${Date.now().toString().slice(-6)}`,
      createdAt: new Date().toISOString(),
    };

    setSales((current) => [sale, ...current]);
    setProducts((current) =>
      current.map((product) => {
        const cartItem = cart.find((item) => item.productId === product.id);
        return cartItem
          ? { ...product, stock: product.stock - cartItem.qty }
          : product;
      }),
    );
    setAdjustments((current) => [
      ...cart.map((item) => ({
        id: createId("adj"),
        productId: item.productId,
        type: "sold" as const,
        quantity: -item.qty,
        reason: `Storefront ${sale.id}`,
        createdAt: sale.createdAt,
      })),
      ...current,
    ]);

    const receiptText = `${storeProfile.name}\nOrder: ${cart
      .map((item) => `${item.name} x${item.qty}`)
      .join(
        ", ",
      )}\nTotal: ${currency.format(cartTotal)}\nPaid via M-Pesa (${sale.mpesaRef})\nThank you for shopping with us.`;
    setReceipt({ title: `Receipt · ${sale.id}`, message: receiptText });
    setCart([]);
    setCustomerName("");
    setMpesaPhone("");
    setMessage(`M-Pesa checkout started for ${sale.customerPhone}.`);
  }

  if (!loaded || !storeProfile) {
    return <div className="p-6">Loading retail storefront…</div>;
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 lg:px-6">
        <div className="rounded-3xl border border-blue-100 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-2">
              <Badge className="w-fit rounded-full bg-blue-600 px-3 py-1 text-white hover:bg-blue-600">
                Retail checkout
              </Badge>
              <h1 className="text-3xl font-semibold">{storeProfile.name}</h1>
              <p className="text-sm text-muted-foreground">
                {storeProfile.location} • Till {storeProfile.tillNumber}
              </p>
              {storeId !== publicStoreId ? (
                <p className="text-xs text-amber-600">
                  Serving storefront {storeId}; active retail store is{" "}
                  {publicStoreId}.
                </p>
              ) : null}
            </div>
            <div className="flex items-center gap-3 rounded-2xl bg-blue-50 px-4 py-3 text-sm text-blue-700">
              <Store className="h-4 w-4" /> Scan, add to cart, pay via M-Pesa.
            </div>
          </div>
        </div>

        {message ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {message}
          </div>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-[1.7fr_420px]">
          <div className="space-y-6">
            <Card className="rounded-3xl">
              <CardHeader>
                <CardTitle>Browse products</CardTitle>
                <CardDescription>
                  Pick items available right now in store.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 md:grid-cols-[1.4fr_1fr]">
                  <Input
                    placeholder="Search products"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                  <div className="flex gap-2 overflow-x-auto pb-1 md:justify-end">
                    {categories.map((category) => (
                      <button
                        key={category}
                        type="button"
                        onClick={() => setCategoryFilter(category)}
                        className={cn(
                          "whitespace-nowrap rounded-full border px-4 py-2 text-sm font-medium",
                          categoryFilter === category
                            ? "border-blue-600 bg-blue-600 text-white"
                            : "border-border bg-white text-slate-700",
                        )}
                      >
                        {category}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {filteredProducts.map((product) => (
                    <div
                      key={product.id}
                      className="rounded-3xl border border-border bg-white p-4 shadow-sm"
                    >
                      <img
                        src={
                          product.image ||
                          "https://placehold.co/320x220/e2e8f0/0f172a?text=Retail"
                        }
                        alt={product.name}
                        className="h-40 w-full rounded-2xl object-cover"
                      />
                      <div className="mt-4 flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold">{product.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {product.category}
                          </p>
                        </div>
                        <Badge variant="outline">{product.stock} left</Badge>
                      </div>
                      <p className="mt-3 text-xl font-semibold text-blue-700">
                        {currency.format(product.sellPrice)}
                      </p>
                      <Button
                        className="mt-4 h-11 w-full rounded-2xl"
                        onClick={() => addToCart(product)}
                      >
                        <Plus className="mr-2 h-4 w-4" /> Add to cart
                      </Button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6 lg:sticky lg:top-6 lg:self-start">
            <Card className="rounded-3xl border-emerald-100">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ShoppingCart className="h-5 w-5 text-blue-600" /> Cart
                </CardTitle>
                <CardDescription>Quick checkout to M-Pesa</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {cart.length ? (
                  cart.map((item) => (
                    <div
                      key={item.productId}
                      className="rounded-2xl border border-border p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium">{item.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {currency.format(item.unitPrice)} each
                          </p>
                        </div>
                        <p className="font-semibold">
                          {currency.format(item.qty * item.unitPrice)}
                        </p>
                      </div>
                      <div className="mt-3 inline-flex items-center rounded-full border border-border bg-slate-50">
                        <button
                          className="px-3 py-2"
                          type="button"
                          onClick={() => changeQty(item.productId, -1)}
                        >
                          <Minus className="h-4 w-4" />
                        </button>
                        <span className="min-w-10 text-center text-sm font-semibold">
                          {item.qty}
                        </span>
                        <button
                          className="px-3 py-2"
                          type="button"
                          onClick={() => changeQty(item.productId, 1)}
                        >
                          <Plus className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                    Your cart is empty.
                  </div>
                )}

                <div className="grid gap-3">
                  <label className="space-y-2 text-sm">
                    <span className="font-medium">Name (optional)</span>
                    <Input
                      value={customerName}
                      onChange={(event) => setCustomerName(event.target.value)}
                    />
                  </label>
                  <label className="space-y-2 text-sm">
                    <span className="font-medium">M-Pesa phone</span>
                    <div className="relative">
                      <Smartphone className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        className="pl-9"
                        placeholder="2547xxxxxxxx"
                        value={mpesaPhone}
                        onChange={(event) => setMpesaPhone(event.target.value)}
                      />
                    </div>
                  </label>
                </div>

                <div className="rounded-2xl bg-slate-50 p-4">
                  <div className="flex items-center justify-between text-sm">
                    <span>Items</span>
                    <span>{cart.reduce((sum, item) => sum + item.qty, 0)}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-lg font-semibold">
                    <span>Total</span>
                    <span>{currency.format(cartTotal)}</span>
                  </div>
                </div>

                <Button
                  className="h-12 w-full rounded-2xl bg-emerald-600 text-base hover:bg-emerald-700"
                  onClick={checkout}
                >
                  <Wallet className="mr-2 h-4 w-4" /> Pay with M-Pesa
                </Button>
              </CardContent>
            </Card>

            {receipt ? (
              <Card className="rounded-3xl">
                <CardHeader>
                  <CardTitle>{receipt.title}</CardTitle>
                  <CardDescription>Receipt preview</CardDescription>
                </CardHeader>
                <CardContent>
                  <textarea
                    readOnly
                    className="min-h-40 w-full rounded-2xl border border-input bg-transparent p-3 text-sm"
                    value={receipt.message}
                  />
                </CardContent>
              </Card>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
