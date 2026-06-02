import {
  Link,
  Outlet,
  createFileRoute,
  useRouter,
} from "@tanstack/react-router";
import {
  BarChart3,
  BriefcaseBusiness,
  ChefHat,
  CreditCard,
  LayoutDashboard,
  Menu,
  Settings,
  ShoppingBag,
  Star,
  Users,
  UtensilsCrossed,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";

import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { UserProfileMenu } from "@/components/auth/UserProfileMenu";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard")({
  component: DashboardLayout,
});

const navItems = [
  { to: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { to: "/dashboard/orders", label: "Orders (KDS)", icon: ChefHat },
  { to: "/dashboard/payments", label: "Payments", icon: CreditCard },
  { to: "/dashboard/retail", label: "Retail", icon: ShoppingBag },
  { to: "/dashboard/services", label: "Services", icon: BriefcaseBusiness },
  { to: "/dashboard/staff", label: "Staff", icon: Users },
  { to: "/dashboard/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/dashboard/menu", label: "Menu", icon: UtensilsCrossed },
  { to: "/dashboard/reviews", label: "Reviews", icon: Star },
  { to: "/dashboard/settings", label: "Settings", icon: Settings },
] as const;

function DashboardShell() {
  const router = useRouter();
  const pathname = router.state.location.pathname;
  const { user } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [range, setRange] = useState("Today");

  const breadcrumb = useMemo(() => {
    const item = navItems.find(
      (entry) => pathname === entry.to || pathname.startsWith(`${entry.to}/`),
    );
    return item?.label || "Overview";
  }, [pathname]);

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-950">
      <aside className="hidden w-60 shrink-0 flex-col bg-slate-900 text-white lg:flex">
        <div className="border-b border-slate-800 px-6 py-6">
          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
            PesaSwap
          </p>
          <h1 className="mt-2 text-xl font-semibold">Merchant Dashboard</h1>
          <p className="mt-1 text-sm text-slate-400">
            {user?.name ?? "Merchant"}
          </p>
        </div>
        <nav className="flex-1 space-y-1 px-3 py-4">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active =
              pathname === item.to || pathname.startsWith(`${item.to}/`);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex items-center gap-3 rounded-r-xl px-4 py-3 text-sm font-medium transition hover:bg-slate-800",
                  active && "bg-slate-800 border-l-2 border-emerald-500",
                )}
              >
                <Icon className="h-4 w-4" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </aside>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent
          side="left"
          className="w-72 border-slate-800 bg-slate-900 p-0 text-white sm:max-w-none"
        >
          <div className="flex items-center justify-between border-b border-slate-800 px-5 py-5">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
                PesaSwap
              </p>
              <p className="mt-1 text-lg font-semibold">Merchant Dashboard</p>
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
          <nav className="space-y-1 px-3 py-4">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active =
                pathname === item.to || pathname.startsWith(`${item.to}/`);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={() => setMobileOpen(false)}
                  className={cn(
                    "flex items-center gap-3 rounded-r-xl px-4 py-3 text-sm font-medium transition hover:bg-slate-800",
                    active && "bg-slate-800 border-l-2 border-emerald-500",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
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
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function DashboardLayout() {
  return (
    <ProtectedRoute roles={["merchant", "admin"]}>
      <DashboardShell />
    </ProtectedRoute>
  );
}
