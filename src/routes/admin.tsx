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
  LogOut,
  Menu,
  ShieldCheck,
  SlidersHorizontal,
  Store,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import {
  adminLogin,
  adminLogout,
  ensureAdminDemoData,
  getAdminSession,
} from "@/lib/admin";
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
  { to: "/admin/activity", label: "Audit Log", icon: Activity },
] as const;

function AdminLayout() {
  const router = useRouter();
  const pathname = router.state.location.pathname;
  const [ready, setReady] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [email, setEmail] = useState("admin@pesaswap.io");
  const [password, setPassword] = useState("admin123");
  const [error, setError] = useState("");
  const [session, setSession] = useState(() => getAdminSession());

  useEffect(() => {
    ensureAdminDemoData();
    const syncSession = () => {
      setSession(getAdminSession());
      setReady(true);
    };

    syncSession();
    window.addEventListener("storage", syncSession);
    window.addEventListener("focus", syncSession);
    return () => {
      window.removeEventListener("storage", syncSession);
      window.removeEventListener("focus", syncSession);
    };
  }, []);

  const breadcrumb = useMemo(() => {
    const item = navItems.find(
      (entry) => pathname === entry.to || pathname.startsWith(`${entry.to}/`),
    );
    return item?.label ?? "Overview";
  }, [pathname]);

  function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = adminLogin(email, password);
    if (!result.success) {
      setError(result.error ?? "Invalid credentials");
      return;
    }
    setError("");
    setSession(getAdminSession());
    toast.success("Welcome to Admin Mode");
  }

  function handleLogout() {
    adminLogout();
    setSession(getAdminSession());
    setMobileOpen(false);
    toast.success("Logged out of Admin Mode");
  }

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-200">
        <div className="rounded-3xl border border-slate-800 bg-slate-900 px-6 py-5 text-sm">
          Loading Admin Panel…
        </div>
      </div>
    );
  }

  if (!session.authenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-10 text-slate-100">
        <Card className="w-full max-w-md rounded-3xl border-slate-800 bg-slate-900 shadow-2xl shadow-violet-950/30">
          <CardContent className="p-8">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-500/15 text-violet-300">
              <LockKeyhole className="h-7 w-7" />
            </div>
            <div className="mt-6 text-center">
              <p className="text-xs uppercase tracking-[0.35em] text-violet-300">
                PesaSwap
              </p>
              <h1 className="mt-3 text-3xl font-semibold text-white">
                Master Admin Panel
              </h1>
              <p className="mt-2 text-sm text-slate-400">
                Secure operator access for onboarding, controls, and platform
                oversight.
              </p>
            </div>

            <form className="mt-8 space-y-4" onSubmit={handleLogin}>
              <div className="space-y-2">
                <label
                  className="text-sm font-medium text-slate-300"
                  htmlFor="admin-email"
                >
                  Email address
                </label>
                <Input
                  id="admin-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="h-11 rounded-xl border-slate-700 bg-slate-950 text-slate-100"
                  placeholder="admin@pesaswap.io"
                />
              </div>
              <div className="space-y-2">
                <label
                  className="text-sm font-medium text-slate-300"
                  htmlFor="admin-password"
                >
                  Password
                </label>
                <Input
                  id="admin-password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="h-11 rounded-xl border-slate-700 bg-slate-950 text-slate-100"
                  placeholder="••••••••"
                />
              </div>
              {error ? (
                <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                  {error}
                </div>
              ) : null}
              <Button className="h-11 w-full rounded-xl bg-violet-500 text-white hover:bg-violet-400">
                Enter Admin Mode
              </Button>
            </form>

            <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-950/70 p-4 text-sm text-slate-400">
              Demo access:{" "}
              <span className="font-medium text-slate-100">
                admin@pesaswap.io
              </span>
              <span className="mx-2 text-slate-600">/</span>
              <span className="font-medium text-slate-100">admin123</span>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

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
            <div className="flex items-center gap-3">
              <div className="hidden rounded-2xl border border-slate-800 bg-slate-900 px-4 py-2 text-right sm:block">
                <div className="text-xs uppercase tracking-[0.25em] text-slate-500">
                  Signed in
                </div>
                <div className="text-sm font-medium text-slate-100">
                  {session.email}
                </div>
              </div>
              <Button
                variant="outline"
                className="border-slate-700 bg-slate-900 text-slate-100 hover:bg-slate-800"
                onClick={handleLogout}
              >
                <LogOut className="h-4 w-4" /> Logout
              </Button>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto bg-slate-950 p-4 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
