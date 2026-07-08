import {
  Link,
  Outlet,
  createFileRoute,
  useRouter,
} from "@tanstack/react-router";
import {
  Activity,
  LayoutDashboard,
  LockKeyhole,
  Menu,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Store,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";

import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { UserProfileMenu } from "@/components/auth/UserProfileMenu";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [{ title: "Master Admin Panel — PesaSwap" }],
  }),
  component: AdminLayout,
});

const navItems = [
  { to: "/admin", label: "Overview", icon: LayoutDashboard },
  { to: "/admin/merchants", label: "Merchants", icon: Store },
  { to: "/admin/features", label: "Feature Flags", icon: SlidersHorizontal },
  { to: "/admin/settings", label: "Settings", icon: Settings },
  { to: "/admin/activity", label: "Audit Log", icon: Activity },
] as const;

function AdminShell() {
  const router = useRouter();
  const pathname = router.state.location.pathname;
  const [mobileOpen, setMobileOpen] = useState(false);

  const breadcrumb = useMemo(() => {
    const item = navItems.find(
      (entry) => pathname === entry.to || pathname.startsWith(`${entry.to}/`),
    );
    return item?.label ?? "Overview";
  }, [pathname]);

  return (
    <div className="flex min-h-screen bg-slate-950 text-slate-100">
      <aside className="hidden w-72 shrink-0 border-r border-slate-800 bg-slate-900/95 lg:flex lg:flex-col">
        <div className="border-b border-slate-800 px-6 py-7">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-violet-500/15 text-violet-300">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.35em] text-violet-300">
                PesaSwap
              </p>
              <h1 className="mt-1 text-xl font-semibold text-white">
                Master Admin
              </h1>
            </div>
          </div>
          <p className="mt-4 text-sm text-slate-400">
            Platform operators can onboard merchants, control features, and
            audit every change.
          </p>
        </div>
        <nav className="flex-1 space-y-2 px-4 py-5">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active =
              pathname === item.to || pathname.startsWith(`${item.to}/`);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-medium transition hover:bg-slate-800/90",
                  active &&
                    "bg-violet-500/15 text-violet-100 ring-1 ring-violet-500/30",
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
          className="w-80 border-slate-800 bg-slate-900 p-0 text-slate-100 sm:max-w-none"
        >
          <div className="flex items-center justify-between border-b border-slate-800 px-5 py-5">
            <div>
              <p className="text-xs uppercase tracking-[0.35em] text-violet-300">
                PesaSwap
              </p>
              <p className="mt-1 text-lg font-semibold">Master Admin</p>
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
          <nav className="space-y-2 px-4 py-5">
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
                    "flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-medium transition hover:bg-slate-800/90",
                    active &&
                      "bg-violet-500/15 text-violet-100 ring-1 ring-violet-500/30",
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
        <header className="sticky top-0 z-20 border-b border-slate-800 bg-slate-950/90 px-4 backdrop-blur lg:px-8">
          <div className="flex min-h-20 items-center justify-between gap-4 py-4">
            <div className="flex items-center gap-3">
              <Button
                size="icon"
                variant="outline"
                className="border-slate-700 bg-slate-900 text-slate-100 hover:bg-slate-800 lg:hidden"
                onClick={() => setMobileOpen(true)}
              >
                <Menu className="h-4 w-4" />
              </Button>
              <div>
                <div className="flex items-center gap-2 text-xs uppercase tracking-[0.3em] text-slate-500">
                  <LockKeyhole className="h-3.5 w-3.5 text-violet-300" />
                  Admin Mode / {breadcrumb}
                </div>
                <h2 className="mt-1 text-2xl font-semibold text-white">
                  {breadcrumb}
                </h2>
              </div>
            </div>
            <UserProfileMenu variant="dark" />
          </div>
        </header>

        <main className="flex-1 overflow-y-auto bg-slate-950 p-4 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function AdminLayout() {
  return (
    <ProtectedRoute roles={["admin"]}>
      <AdminShell />
    </ProtectedRoute>
  );
}
