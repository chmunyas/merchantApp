import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";

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
          "width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover",
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
  // so the app opens signed in as the logged-in merchant, THEN fall back to a
  // scoped session only if there's still no token (so /api/share etc. are authed).
  useEffect(() => {
    adoptLaunchToken();
    void ensureSessionToken("merchant");
  }, []);

  return (
    <div className="min-h-[100dvh] bg-slate-950 sm:flex sm:items-center sm:justify-center sm:p-6">
      <div className="relative mx-auto h-[100dvh] w-full overflow-hidden bg-background sm:h-[860px] sm:max-h-[92dvh] sm:w-[420px] sm:rounded-[2.2rem] sm:border sm:border-border sm:shadow-2xl">
        <MerchantApp standalone />
      </div>
    </div>
  );
}
