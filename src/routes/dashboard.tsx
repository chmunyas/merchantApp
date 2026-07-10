import {
  Link,
  Outlet,
  createFileRoute,
  useRouter,
} from "@tanstack/react-router";
import {
  Armchair,
  BarChart3,
  CalendarClock,
  Tags,
  BookOpen,
  Bot,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  ChefHat,
  Contact,
  UserCheck,
  CreditCard,
  Gift,
  Inbox,
  LayoutDashboard,
  LayoutGrid,
  Landmark,
  Scale,
  ShieldAlert,
  Gem,
  KeyRound,
  Menu,
  MessagesSquare,
  NotebookPen,
  Package,
  PackageCheck,
  Ticket,
  QrCode,
  Receipt,
  Search,
  Send,
  Settings,
  ShoppingBag,
  Smartphone,
  Star,
  Users,
  UsersRound,
  UtensilsCrossed,
  Wallet,
  X,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { UserProfileMenu } from "@/components/auth/UserProfileMenu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useAuth, ensureSessionToken, getToken, switchVenue as apiSwitchVenue, addStore, type UserRole } from "@/lib/auth";
import { canAccessPath } from "@/lib/rbac";
import {
  ensureMerchantDemoData,
  getCurrentVenue,
  getCurrentVenueId,
  getPendingEnquiryCount,
  getVenues,
  hydrateMerchantState,
  setCurrentVenueId,
  setVenues as persistVenues,
  type Venue,
} from "@/lib/merchant-dashboard";
import { cn } from "@/lib/utils";
import { useBranding } from "@/lib/branding";
import { toast } from "sonner";
import { hydrateServerEntities } from "@/lib/server-sync";

export const Route = createFileRoute("/dashboard")({
  component: DashboardLayout,
});

const navGroups = [
  {
    label: "Insights",
    items: [
      { to: "/dashboard", label: "Overview", icon: LayoutDashboard },
      { to: "/dashboard/copilot", label: "Copilot", icon: Bot },
      { to: "/dashboard/analytics", label: "Analytics", icon: BarChart3 },
      { to: "/dashboard/forecast", label: "Forecast", icon: CalendarClock },
      { to: "/dashboard/pricing", label: "Pricing", icon: Tags },
      { to: "/dashboard/chain", label: "Chain", icon: Building2 },
    ],
  },
  {
    label: "Operations",
    items: [
      { to: "/dashboard/orders", label: "Orders (KDS)", icon: ChefHat },
      { to: "/dashboard/tables", label: "Tables", icon: LayoutGrid },
      { to: "/dashboard/floorplan", label: "Floorplan", icon: Armchair },
    ],
  },
  {
    label: "Bookings",
    items: [
      { to: "/dashboard/bookings", label: "Bookings", icon: CalendarDays },
      { to: "/dashboard/enquiries", label: "Enquiries", icon: Inbox },
      { to: "/dashboard/deposits", label: "Deposits", icon: Wallet },
    ],
  },
  {
    label: "Sales",
    items: [
      { to: "/dashboard/payments", label: "Payments", icon: CreditCard },
      { to: "/dashboard/payment-methods", label: "Methods", icon: Wallet },
      { to: "/dashboard/invoices", label: "Invoices", icon: Receipt },
      { to: "/dashboard/reports", label: "Notebook", icon: NotebookPen },
      { to: "/dashboard/settlement", label: "Settlement", icon: Landmark },
      { to: "/dashboard/disputes", label: "Disputes", icon: ShieldAlert },
      { to: "/dashboard/accounting", label: "Accounting", icon: Scale },
      { to: "/dashboard/retail", label: "Retail", icon: ShoppingBag },
      { to: "/dashboard/inventory", label: "Inventory", icon: Package },
      { to: "/dashboard/reorder", label: "Reorder", icon: PackageCheck },
      { to: "/dashboard/services", label: "Services", icon: BriefcaseBusiness },
    ],
  },
  {
    label: "Engage",
    items: [
      { to: "/dashboard/inbox", label: "Inbox", icon: MessagesSquare },
      { to: "/dashboard/contacts", label: "Contacts", icon: Contact },
      { to: "/dashboard/retention", label: "Retention", icon: UserCheck },
      { to: "/dashboard/knowledge", label: "Knowledge", icon: BookOpen },
      { to: "/dashboard/automations", label: "Automations", icon: Zap },
      { to: "/dashboard/promos", label: "Promos", icon: Ticket },
      { to: "/dashboard/reviews", label: "Reviews", icon: Star },
      { to: "/dashboard/rewards", label: "Rewards", icon: Gift },
    ],
  },
  {
    label: "Setup",
    items: [
      { to: "/dashboard/menu", label: "Menu", icon: UtensilsCrossed },
      { to: "/dashboard/qr", label: "QR codes", icon: QrCode },
      { to: "/dashboard/staff", label: "Staff", icon: Users },
      { to: "/dashboard/team", label: "Team", icon: UsersRound },
      { to: "/dashboard/whatsapp", label: "WhatsApp", icon: Smartphone },
      { to: "/dashboard/telegram", label: "Telegram", icon: Send },
      { to: "/dashboard/settings", label: "Settings", icon: Settings },
      { to: "/dashboard/billing", label: "Billing", icon: Gem },
      { to: "/dashboard/api-keys", label: "API keys", icon: KeyRound },
    ],
  },
] as const;

const navItems = navGroups.flatMap((group) =>
  group.items.map((item) => ({ to: item.to, label: item.label })),
);

function NavSections({
  pathname,
  role,
  newEnquiries,
  onNavigate,
}: {
  pathname: string;
  role: UserRole;
  newEnquiries: number;
  onNavigate?: () => void;
}) {
  return (
    <nav className="flex-1 space-y-5 px-3 py-4">
      {navGroups.map((group) => {
        // Hide any nav item the current role may not open, and drop groups that
        // become empty (per-page RBAC — see src/lib/rbac.ts).
        const items = group.items.filter((item) =>
          canAccessPath(role, item.to),
        );
        if (items.length === 0) return null;
        return (
          <div key={group.label} className="space-y-1">
            <p className="px-4 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
              {group.label}
            </p>
            {items.map((item) => {
              const Icon = item.icon;
              const active =
                pathname === item.to || pathname.startsWith(`${item.to}/`);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={onNavigate}
                  className={cn(
                    "flex items-center gap-3 rounded-r-xl px-4 py-2.5 text-sm font-medium transition hover:bg-slate-800",
                    active && "bg-slate-800 border-l-2 border-emerald-500",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span>{item.label}</span>
                  {item.label === "Enquiries" && newEnquiries > 0 ? (
                    <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1 text-[11px] font-semibold text-white">
                      {newEnquiries}
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </div>
        );
      })}
    </nav>
  );
}

function AccessDenied({ role }: { role: UserRole }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-2xl">
        🔒
      </div>
      <h1 className="mt-3 text-xl font-bold">Access restricted</h1>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        Your role ({role}) can&apos;t open this page. Ask an owner or manager if
        you need access.
      </p>
      <Link
        to="/dashboard"
        className="mt-4 rounded-lg bg-foreground px-4 py-2 text-sm font-semibold text-background"
      >
        Back to overview
      </Link>
    </div>
  );
}

function DashboardShell() {
  const router = useRouter();
  const pathname = router.state.location.pathname;
  const { user } = useAuth();
  const branding = useBranding();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [range, setRange] = useState("Today");
  const [newEnquiries, setNewEnquiries] = useState(0);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [currentVenue, setCurrentVenue] = useState<Venue | null>(null);
  const [venuePickerOpen, setVenuePickerOpen] = useState(false);
  const [venueSearch, setVenueSearch] = useState("");
  const [newStoreName, setNewStoreName] = useState("");
  const [addingStore, setAddingStore] = useState(false);
  const [switching, setSwitching] = useState(false);
  // Bumped on a venue switch to remount the active page (refetch for the new
  // store) WITHOUT a full-document reload — see the keyed Outlet below.
  const [outletKey, setOutletKey] = useState(0);

  useEffect(() => {
    setNewEnquiries(getPendingEnquiryCount(ensureMerchantDemoData().enquiries));
    setVenues(getVenues());
    setCurrentVenue(getCurrentVenue());
  }, [pathname]);

  // Serve the picker from Postgres (principal-scoped) so a real merchant sees their
  // OWN venue(s), not the demo set. Additive: only overrides when the API returns
  // venues (a venue-less demo/session token gets [] and keeps the local demo list).
  useEffect(() => {
    const token = getToken();
    if (!token) return;
    void (async () => {
      try {
        const res = await fetch("/api/venues", {
          headers: { authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const data = (await res.json()) as { venues?: Venue[] };
        if (!data.venues || data.venues.length === 0) return;
        const list = data.venues.map((v) => ({
          id: v.id,
          name: v.name,
          code: v.code ?? "",
          active: v.active !== false,
        }));
        persistVenues(list);
        setVenues(list);
        const current =
          list.find((v) => v.id === getCurrentVenueId()) ?? list[0];
        if (current) setCurrentVenue(current);
      } catch {
        /* offline — keep the local venue list */
      }
    })();
  }, []);

  const breadcrumb = useMemo(() => {
    const item = navItems.find(
      (entry) => pathname === entry.to || pathname.startsWith(`${entry.to}/`),
    );
    return item?.label || "Overview";
  }, [pathname]);

  const filteredVenues = useMemo(() => {
    const query = venueSearch.trim().toLowerCase();
    if (!query) return venues;
    return venues.filter(
      (venue) =>
        venue.name.toLowerCase().includes(query) ||
        venue.code.toLowerCase().includes(query),
    );
  }, [venues, venueSearch]);

  async function switchVenue(id: string) {
    if (switching || id === currentVenue?.id) {
      setVenuePickerOpen(false);
      return;
    }
    setSwitching(true);
    try {
      // Re-mint the JWT for the target store (server verifies membership), pull
      // its state, then remount the active page — seamless, no page reload.
      const ok = await apiSwitchVenue(id);
      if (!ok) setCurrentVenueId(id);
      await hydrateMerchantState().catch(() => {});
      const next = venues.find((v) => v.id === id) ?? null;
      if (next) setCurrentVenue(next);
      window.dispatchEvent(new Event("pesaswap:auth-changed"));
      setOutletKey((k) => k + 1);
    } finally {
      setSwitching(false);
      setVenuePickerOpen(false);
    }
  }

  async function handleAddStore() {
    const name = newStoreName.trim();
    if (!name || addingStore) return;
    setAddingStore(true);
    try {
      const result = await addStore(name);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`Store "${result.name}" created`);
      const newVenue: Venue = {
        id: result.id,
        name: result.name,
        code:
          result.name.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase() ||
          "VEN",
        active: true,
      };
      setVenues((prev) => {
        const list = [...prev.filter((v) => v.id !== newVenue.id), newVenue];
        persistVenues(list);
        return list;
      });
      // Switch into the new store seamlessly (no reload).
      await apiSwitchVenue(result.id);
      await hydrateMerchantState().catch(() => {});
      setCurrentVenue(newVenue);
      window.dispatchEvent(new Event("pesaswap:auth-changed"));
      setOutletKey((k) => k + 1);
      setNewStoreName("");
      setVenuePickerOpen(false);
    } finally {
      setAddingStore(false);
    }
  }

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-950">
      <aside
        className="hidden w-60 shrink-0 flex-col bg-slate-900 text-white lg:flex"
        style={
          branding?.primaryColor
            ? { borderTop: `3px solid ${branding.primaryColor}` }
            : undefined
        }
      >
        <div className="border-b border-slate-800 px-6 py-6">
          {branding?.logoUrl ? (
            <img
              src={branding.logoUrl}
              alt={branding.businessName}
              className="mb-2 h-8 w-auto max-w-[140px] object-contain"
            />
          ) : (
            <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
              {branding?.reseller?.name ?? "PesaSwap"}
            </p>
          )}
          <h1 className="mt-2 text-xl font-semibold">
            {branding?.businessName ?? "Merchant Dashboard"}
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            {user?.name ?? "Merchant"}
          </p>
          {branding?.reseller?.poweredBy ? (
            <p className="mt-3 text-[10px] uppercase tracking-wider text-slate-500">
              {branding.reseller.poweredBy}
            </p>
          ) : null}
        </div>
        <div className="overflow-y-auto">
          <NavSections
            pathname={pathname}
            role={user?.role ?? "staff"}
            newEnquiries={newEnquiries}
          />
        </div>
      </aside>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent
          side="left"
          className="w-72 overflow-y-auto border-slate-800 bg-slate-900 p-0 text-white sm:max-w-none"
        >
          <div className="flex items-center justify-between border-b border-slate-800 px-5 py-5">
            <div>
              {branding?.logoUrl ? (
                <img
                  src={branding.logoUrl}
                  alt={branding.businessName}
                  className="mb-1 h-7 w-auto max-w-[120px] object-contain"
                />
              ) : (
                <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
                  {branding?.reseller?.name ?? "PesaSwap"}
                </p>
              )}
              <p className="mt-1 text-lg font-semibold">
                {branding?.businessName ?? "Merchant Dashboard"}
              </p>
            </div>
            <Button
              size="icon"
              variant="ghost"
              className="text-white hover:bg-slate-800"
              onClick={() => setMobileOpen(false)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <NavSections
            pathname={pathname}
            role={user?.role ?? "staff"}
            newEnquiries={newEnquiries}
            onNavigate={() => setMobileOpen(false)}
          />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 border-b border-border bg-white/95 px-4 backdrop-blur lg:px-8">
          <div className="flex h-18 items-center justify-between gap-4 py-4">
            <div className="flex items-center gap-3">
              <Button
                size="icon"
                variant="outline"
                className="lg:hidden"
                onClick={() => setMobileOpen(true)}
              >
                <Menu className="h-4 w-4" />
              </Button>
              <div>
                <div className="text-xs uppercase tracking-[0.25em] text-muted-foreground">
                  Dashboard / {breadcrumb}
                </div>
                <h2 className="text-xl font-semibold">{breadcrumb}</h2>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setVenuePickerOpen(true)}
                className="hidden items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-sm shadow-sm hover:bg-slate-50 sm:flex"
              >
                <Building2 className="h-4 w-4 text-slate-400" />
                <span className="max-w-[160px] truncate font-medium">
                  {currentVenue?.name ?? "Venue"}
                </span>
              </button>
              <select
                value={range}
                onChange={(event) => setRange(event.target.value)}
                className="rounded-xl border border-border bg-background px-3 py-2 text-sm shadow-sm"
              >
                <option>Today</option>
                <option>This week</option>
                <option>This month</option>
                <option>Custom</option>
              </select>
              <UserProfileMenu variant="light" />
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 lg:p-8">
          {user && !canAccessPath(user.role, pathname) ? (
            <AccessDenied role={user.role} />
          ) : (
            <div key={outletKey} className="contents">
              <Outlet />
            </div>
          )}
        </main>
      </div>

      {venuePickerOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-slate-950/60 p-4 pt-24"
          onClick={() => setVenuePickerOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-3xl bg-white p-5 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-950">
                Select venue
              </h3>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setVenuePickerOpen(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="relative mt-4">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={venueSearch}
                onChange={(event) => setVenueSearch(event.target.value)}
                placeholder="Search venues..."
                className="pl-9"
              />
            </div>
            <div className="mt-4 max-h-80 space-y-2 overflow-y-auto">
              {filteredVenues.map((venue) => {
                const active = venue.id === currentVenue?.id;
                return (
                  <button
                    key={venue.id}
                    type="button"
                    onClick={() => switchVenue(venue.id)}
                    className={cn(
                      "flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left transition",
                      active
                        ? "border-emerald-300 bg-emerald-50"
                        : "border-slate-200 bg-white hover:bg-slate-50",
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
                        <Building2 className="h-4 w-4" />
                      </span>
                      <div>
                        <p className="font-medium text-slate-900">
                          {venue.name}
                        </p>
                        <p className="text-xs text-slate-400">{venue.code}</p>
                      </div>
                    </div>
                    {active ? (
                      <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                        Current
                      </span>
                    ) : venue.active ? (
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500">
                        Active
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
            <div className="mt-4 border-t border-slate-100 pt-4">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">
                Add a store
              </p>
              <div className="flex gap-2">
                <Input
                  value={newStoreName}
                  onChange={(event) => setNewStoreName(event.target.value)}
                  placeholder="New store name"
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void handleAddStore();
                  }}
                />
                <Button
                  onClick={() => void handleAddStore()}
                  disabled={addingStore || !newStoreName.trim()}
                >
                  {addingStore ? "Adding…" : "Add store"}
                </Button>
              </div>
              <p className="mt-2 text-xs text-slate-400">
                Creates a new, empty store under your account — you'll switch into
                it to set it up.
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DashboardLayout() {
  return (
    <ProtectedRoute roles={["merchant", "admin", "manager", "supervisor", "staff"]}>
      <StateHydrator>
        <DashboardShell />
      </StateHydrator>
    </ProtectedRoute>
  );
}

// Pull shared state from Postgres into localStorage before the dashboard renders
// so the back office and PWA work off the same data. Brief gate on first load.
function StateHydrator({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
    Promise.all([ensureSessionToken(), hydrateMerchantState()])
      // After the localStorage blob is pulled, mirror the server-authoritative
      // menu_items + dining_tables over it so every read-only consumer (overview,
      // floor plan, bookings, customer table view) sees ONE source of truth.
      .then(() => hydrateServerEntities())
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, []);
  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Syncing your workspace…
      </div>
    );
  }
  return <>{children}</>;
}
