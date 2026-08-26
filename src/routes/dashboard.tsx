import {
  Link,
  Outlet,
  createFileRoute,
  useRouter,
} from "@tanstack/react-router";
import {
  Armchair,
  BarChart3,
  Banknote,
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
  Percent,
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
import { useEffect, useMemo, useRef, useState } from "react";

import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { UserProfileMenu } from "@/components/auth/UserProfileMenu";
import { DemoVenueBanner } from "@/components/DemoVenueBanner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ModalOverlay } from "@/components/ui/modal-overlay";
import { PageErrorBoundary } from "@/components/PageErrorBoundary";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useAuth, ensureSessionToken, getToken, hasAuthoritativeVenueSession, isDemoSession, switchVenue as apiSwitchVenue, addStore, type UserRole } from "@/lib/auth";
import { canAccessPath } from "@/lib/rbac";
import {
  ensureMerchantDemoData,
  getCurrentVenue,
  getCurrentVenueId,
  getPendingEnquiryCount,
  getVenues,
  setCurrentVenueId,
  setVenues as persistVenues,
  type Venue,
} from "@/lib/merchant-dashboard";
import { hydrateMerchantState } from "@/lib/browser-storage";
import { cn } from "@/lib/utils";
import { useBranding } from "@/lib/branding";
import { toast } from "sonner";
import { hydrateServerEntities } from "@/lib/server-sync";
import { capabilityForPath } from "@/lib/verticals";
import {
  dashboardNavigationGroupId,
  isDashboardPathActive,
} from "@/lib/dashboard-navigation";

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
      { to: "/dashboard/walkouts", label: "Walkouts", icon: ShieldAlert },
      {
        to: "/dashboard/guest-requests",
        label: "Guest requests",
        icon: Inbox,
      },
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
      { to: "/dashboard/fees", label: "Fees", icon: Percent },
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
      { to: "/dashboard/payouts", label: "Payouts", icon: Banknote },
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
  capabilities,
  onNavigate,
}: {
  pathname: string;
  role: UserRole;
  newEnquiries: number;
  capabilities: ReadonlySet<string> | null;
  onNavigate?: () => void;
}) {
  const navigationRef = useRef<HTMLElement>(null);

  useEffect(() => {
    navigationRef.current
      ?.querySelector<HTMLElement>('[aria-current="page"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [pathname]);

  return (
    <nav
      ref={navigationRef}
      aria-label="Dashboard sections"
      className="space-y-5 px-3 py-4 pb-8"
    >
      {navGroups.map((group) => {
        // Two independent gates: RBAC decides what this ROLE may open, the venue's
        // resolved capabilities decide what this BUSINESS has. Capabilities are
        // advisory here — the server enforces them — so an unloaded profile shows
        // everything rather than stranding an offline dashboard.
        const items = group.items.filter((item) => {
          if (!canAccessPath(role, item.to)) return false;
          if (!capabilities) return true;
          const capability = capabilityForPath(item.to);
          return !capability || capabilities.has(capability.key);
        });
        if (items.length === 0) return null;
        const groupId = dashboardNavigationGroupId(group.label);
        return (
          <section
            key={group.label}
            aria-labelledby={groupId}
            className="space-y-1"
          >
            <h2
              id={groupId}
              className="px-4 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400"
            >
              {group.label}
            </h2>
            <ul className="list-none space-y-1 p-0">
              {items.map((item) => {
                const Icon = item.icon;
                const active = isDashboardPathActive(pathname, item.to);
                return (
                  <li key={item.to}>
                    <Link
                      to={item.to}
                      activeOptions={{ exact: true }}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex min-h-11 items-center gap-3 rounded-md border-l-4 border-transparent px-3 py-2 text-sm font-medium text-slate-200 transition-colors hover:bg-slate-800 hover:text-white",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-300",
                        active &&
                          "border-emerald-400 bg-slate-800 text-white",
                      )}
                    >
                      <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
                      <span>{item.label}</span>
                      {item.label === "Enquiries" && newEnquiries > 0 ? (
                        <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-400 px-1 text-[11px] font-bold text-slate-950">
                          <span aria-hidden="true">{newEnquiries}</span>
                          <span className="sr-only">
                            {newEnquiries} new enquiries
                          </span>
                        </span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
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
  const [capabilities, setCapabilities] = useState<ReadonlySet<string> | null>(
    null,
  );

  // Refetched on a venue switch: two stores under one merchant can be different
  // verticals on different plans.
  useEffect(() => {
    const token = getToken();
    if (!token || !hasAuthoritativeVenueSession(token)) {
      setCapabilities(null);
      return;
    }
    void (async () => {
      try {
        const res = await fetch("/api/venue-profile", {
          headers: { authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const data = (await res.json()) as { capabilities?: string[] };
        if (Array.isArray(data.capabilities)) {
          setCapabilities(new Set(data.capabilities));
        }
      } catch {
        /* offline — leave navigation ungated; the server still enforces */
      }
    })();
  }, [outletKey]);

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
    if (!token || !hasAuthoritativeVenueSession(token)) return;
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
      (entry) => isDashboardPathActive(pathname, entry.to),
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
    <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
      <div className="flex min-h-screen bg-slate-50 text-slate-950">
      {/* WCAG 2.4.1: 40+ sidebar links precede the content on every page. */}
      <a
        href="#dashboard-main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[70] focus:rounded-md focus:bg-slate-900 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white focus:outline-none focus:ring-2 focus:ring-emerald-300"
      >
        Skip to main content
      </a>
      <aside
        aria-label="Dashboard navigation panel"
        className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col bg-slate-900 text-white lg:flex"
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
            <p className="mt-3 text-[10px] uppercase tracking-wider text-slate-400">
              {branding.reseller.poweredBy}
            </p>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <NavSections
            pathname={pathname}
            role={user?.role ?? "staff"}
            newEnquiries={newEnquiries}
            capabilities={capabilities}
          />
        </div>
      </aside>

        <SheetContent
          side="left"
          closeLabel="Close dashboard navigation"
          closeClassName="text-white opacity-100 hover:bg-slate-800 focus-visible:ring-emerald-300 focus-visible:ring-offset-slate-900"
          className="w-[min(18rem,calc(100vw-1rem))] overflow-y-auto overscroll-contain border-slate-800 bg-slate-900 p-0 pb-[calc(1rem+env(safe-area-inset-bottom))] text-white sm:max-w-[18rem]"
        >
          <div className="border-b border-slate-800 px-5 py-5 pr-16">
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
              <SheetTitle className="mt-1 text-lg font-semibold text-white">
                {branding?.businessName ?? "Merchant Dashboard"}
              </SheetTitle>
              <SheetDescription className="sr-only">
                Navigate between back-office dashboard sections.
              </SheetDescription>
            </div>
          </div>
          <NavSections
            pathname={pathname}
            role={user?.role ?? "staff"}
            newEnquiries={newEnquiries}
            capabilities={capabilities}
            onNavigate={() => setMobileOpen(false)}
          />
        </SheetContent>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 border-b border-border bg-white/95 px-4 backdrop-blur lg:px-8">
          <div className="flex h-18 items-center justify-between gap-4 py-4">
            <div className="flex items-center gap-3">
              <SheetTrigger asChild>
                <Button
                  size="icon"
                  variant="outline"
                  aria-label="Open dashboard navigation"
                  className="size-11 shrink-0 focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:ring-offset-2 lg:hidden"
                >
                  <Menu aria-hidden="true" className="h-4 w-4" />
                </Button>
              </SheetTrigger>
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

        <DemoVenueBanner />

        <main
          id="dashboard-main"
          tabIndex={-1}
          className="flex-1 overflow-y-auto p-4 lg:p-8 focus:outline-none"
        >
          {user && !canAccessPath(user.role, pathname) ? (
            <AccessDenied role={user.role} />
          ) : (
            <div key={outletKey} className="contents">
              <PageErrorBoundary resetKey={pathname}>
                <Outlet />
              </PageErrorBoundary>
            </div>
          )}
        </main>
      </div>

      {venuePickerOpen ? (
        <ModalOverlay
          onClose={() => setVenuePickerOpen(false)}
          labelledBy="venue-picker-heading"
          className="flex items-start justify-center p-4 pt-24"
          panelClassName="w-full max-w-lg rounded-3xl bg-white p-5 shadow-2xl"
          closeLabel="Close venue picker"
        >
            <div className="flex items-center justify-between">
              <h3
                id="venue-picker-heading"
                className="text-lg font-semibold text-slate-950"
              >
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
        </ModalOverlay>
      ) : null}
      </div>
    </Sheet>
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
  useEffect(() => {
    void ensureSessionToken()
      .then(() => {
        if (isDemoSession()) return;
        return Promise.all([hydrateMerchantState()]);
      })
      // After the localStorage blob is pulled, mirror the server-authoritative
      // menu_items + dining_tables over it so every read-only consumer (overview,
      // floor plan, bookings, customer table view) sees ONE source of truth.
      .then(() => hydrateServerEntities())
      .catch(() => {});
  }, []);
  useEffect(() => {
    const blocked = () => toast.error("You're offline. Reconnect before changing shared business data.");
    const conflict = () => toast.error("This data changed on another device. The server copy was preserved; refresh and review.");
    const failed = () => {
      if (!hasAuthoritativeVenueSession()) return;
      toast.error("The change was not saved. Refresh before trying again.");
    };
    window.addEventListener("pesaswap:state-write-blocked", blocked);
    window.addEventListener("pesaswap:state-conflict", conflict);
    window.addEventListener("pesaswap:state-write-failed", failed);
    return () => {
      window.removeEventListener("pesaswap:state-write-blocked", blocked);
      window.removeEventListener("pesaswap:state-conflict", conflict);
      window.removeEventListener("pesaswap:state-write-failed", failed);
    };
  }, []);
  return <>{children}</>;
}
