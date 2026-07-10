import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  Link,
} from "@tanstack/react-router";

import appCss from "../styles.css?url";
import { AppSidebar } from "@/components/AppSidebar";
import { AuthProvider } from "@/components/auth/AuthProvider";
import { Toaster } from "@/components/ui/sonner";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ChatWidget } from "@/components/omni/ChatWidget";
import { InstallBanner } from "@/components/InstallBanner";
import { Menu } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist.
        </p>
        <Link
          to="/"
          className="mt-6 inline-flex items-center justify-center rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background"
        >
          Back to home
        </Link>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
        <button
          onClick={() => {
            router.invalidate();
            reset();
          }}
          className="mt-6 inline-flex items-center justify-center rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background"
        >
          Try again
        </button>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()(
  {
    head: () => ({
      meta: [
        { charSet: "utf-8" },
        {
          name: "viewport",
          content: "width=device-width, initial-scale=1, viewport-fit=cover",
        },
        { name: "application-name", content: "PesaSwap" },
        { name: "apple-mobile-web-app-title", content: "PesaSwap" },
        { name: "theme-color", content: "#0f172a" },
        { name: "mobile-web-app-capable", content: "yes" },
        { name: "apple-mobile-web-app-capable", content: "yes" },
        {
          name: "apple-mobile-web-app-status-bar-style",
          content: "black-translucent",
        },
        { title: "PesaSwap Merchant" },
        {
          name: "description",
          content:
            "PesaSwap merchant POS for tables, bookings, orders and M-Pesa payments.",
        },
        {
          property: "og:title",
          content: "PesaSwap Merchant",
        },
        {
          property: "og:description",
          content: "Fast M-Pesa, card and split payments for merchants.",
        },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary" },
      ],
      links: [
        { rel: "stylesheet", href: appCss },
        { rel: "manifest", href: "/api/manifest" },
        {
          rel: "icon",
          type: "image/png",
          sizes: "192x192",
          href: "/icons/icon-192.png",
        },
        { rel: "apple-touch-icon", href: "/icons/apple-touch-icon-180.png" },
        { rel: "preconnect", href: "https://fonts.googleapis.com" },
        {
          rel: "preconnect",
          href: "https://fonts.gstatic.com",
          crossOrigin: "anonymous",
        },
        {
          rel: "stylesheet",
          href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&display=swap",
        },
      ],
    }),
    shellComponent: RootShell,
    component: RootComponent,
    notFoundComponent: NotFoundComponent,
    errorComponent: ErrorComponent,
  },
);

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();
  const pathname = router.state.location.pathname;
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }
    const promptUpdate = (worker: ServiceWorker) => {
      toast("Update available", {
        description: "A new version of PesaSwap is ready.",
        action: {
          label: "Refresh",
          onClick: () => worker.postMessage({ type: "SKIP_WAITING" }),
        },
        duration: Infinity,
      });
    };
    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
        if (registration.waiting) promptUpdate(registration.waiting);
        registration.addEventListener("updatefound", () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            if (
              installing.state === "installed" &&
              navigator.serviceWorker.controller
            ) {
              promptUpdate(installing);
            }
          });
        });
        // Proactively check for a new deploy so a long-open PWA never serves stale
        // code: whenever the tab regains focus, and hourly.
        const checkForUpdate = () => registration.update().catch(() => {});
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") checkForUpdate();
        });
        window.setInterval(checkForUpdate, 60 * 60 * 1000);
      })
      .catch(() => {});
    let reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    });
  }, []);
  // Sidebar: open by default on desktop, hidden on mobile; follow the breakpoint.
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const apply = () => setSidebarOpen(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // Brand the installable app per merchant: point the manifest at the logged-in
  // venue so an install carries ITS name/colour/logo. Falls back to the generic
  // manifest when no venue is known. Progressive enhancement — never blocks.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("fxengine.merchant.currentVenue");
      if (!raw) return;
      let venue = raw;
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed === "string") venue = parsed;
      } catch {
        /* raw was a plain string */
      }
      if (!/^[\w-]{2,64}$/.test(venue)) return;
      const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
      if (link) link.setAttribute("href", `/api/manifest?venue=${encodeURIComponent(venue)}`);
    } catch {
      /* ignore — keep the default manifest */
    }
  }, [pathname]);

  const isStandaloneLayout =
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/pay") ||
    pathname.startsWith("/table") ||
    pathname.startsWith("/enquire") ||
    pathname.startsWith("/get-started") ||
    pathname.startsWith("/admin") ||
    pathname.startsWith("/sign-in") ||
    pathname.startsWith("/staff-login") ||
    pathname.startsWith("/pesaswapApp");

  // Customer touchpoints get the in-app chat widget (seamless omnichannel).
  const isCustomerFacing =
    pathname.startsWith("/pay") ||
    pathname.startsWith("/table") ||
    pathname.startsWith("/book") ||
    pathname.startsWith("/enquire") ||
    pathname.startsWith("/merchant");

  if (isStandaloneLayout) {
    return (
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <ErrorBoundary>
            <div className="min-h-screen bg-background text-foreground">
              <Outlet />
              <Toaster position="top-right" richColors />
              {isCustomerFacing && <ChatWidget />}
              <InstallBanner />
            </div>
          </ErrorBoundary>
        </AuthProvider>
      </QueryClientProvider>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ErrorBoundary>
          <div className="min-h-screen bg-background text-foreground">
            <AppSidebar
              open={sidebarOpen}
              onClose={() => setSidebarOpen(false)}
            />
            {!sidebarOpen ? (
              <button
                type="button"
                onClick={() => setSidebarOpen(true)}
                aria-label="Open menu"
                className="fixed left-4 top-4 z-30 flex size-10 items-center justify-center rounded-xl border border-border bg-card/90 text-foreground shadow-lg backdrop-blur transition-colors hover:bg-muted"
              >
                <Menu className="size-5" />
              </button>
            ) : null}
            <main
              className={`transition-[padding] duration-200 ${
                sidebarOpen ? "lg:pl-64" : "pl-0"
              }`}
            >
              <Outlet />
            </main>
            <Toaster position="top-right" richColors />
            {isCustomerFacing && <ChatWidget />}
            <InstallBanner />
          </div>
        </ErrorBoundary>
      </AuthProvider>
    </QueryClientProvider>
  );
}
