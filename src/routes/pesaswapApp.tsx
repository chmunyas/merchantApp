import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { MerchantApp } from "@/components/merchant/MerchantApp";
import { adoptLaunchToken, ensureSessionToken } from "@/lib/auth";

// pesaswapApp — the MerchantApp repackaged as a standalone, installable web app.
// Full-screen on mobile (a real PWA), centred app-card on desktop.
export const Route = createFileRoute("/pesaswapApp")({
  head: () => ({
    meta: [
      { title: "pesaswapApp" },
      {
        name: "description",
        content:
          "PesaSwap merchant app — QR invoicing, Tap & Go, ledger and AI insights. Installable, offline-ready PWA.",
      },
      { name: "theme-color", content: "#0f172a" },
      {
        name: "viewport",
        content:
          "width=device-width, initial-scale=1, viewport-fit=cover",
      },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      {
        name: "apple-mobile-web-app-status-bar-style",
        content: "black-translucent",
      },
      { name: "apple-mobile-web-app-title", content: "pesaswapApp" },
    ],
  }),
  component: PesaSwapAppPage,
});

function PesaSwapAppPage() {
  // Adopt a session handed off from the dashboard "Launch app" button (#token=…)
  // SYNCHRONOUSLY, before MerchantApp reads the venue — a lazy useState initializer
  // runs during THIS render, before the child renders. This guarantees the app
  // paints the logged-in merchant's OWN venue on the first frame instead of
  // briefly (or, on a slow client, persistently) showing the shared demo venue
  // while a post-render effect races to adopt. Idempotent + client-only.
  useState(() => {
    if (typeof window !== "undefined") adoptLaunchToken();
    return null;
  });
  // SSR cannot read sessionStorage, so rendering MerchantApp on the server would
  // emit demo invoices while an authenticated client renders live venue data.
  // Keep the server and first client frame identical; the token above is adopted
  // synchronously before the real operator surface mounts on the next frame.
  const [clientReady, setClientReady] = useState(false);
  // Fall back to a scoped session if there is no token. The operator surface
  // paints immediately; auth bootstrap continues without blocking first paint.
  useEffect(() => {
    void ensureSessionToken("merchant");
    setClientReady(true);
  }, []);

  return (
    <div className="min-h-[100dvh] bg-slate-950 md:flex md:items-center md:justify-center md:p-6">
      <div
        data-testid="operator-shell"
        className="relative mx-auto h-[100dvh] w-full overflow-hidden bg-background md:h-[min(900px,92dvh)] md:w-[min(100%,960px)] md:rounded-2xl md:border md:border-border md:shadow-2xl"
      >
        {clientReady ? <MerchantApp standalone /> : null}
      </div>
    </div>
  );
}
