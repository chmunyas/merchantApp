import { ExternalLink, Smartphone } from "lucide-react";

import { InstallButton } from "@/components/InstallButton";
import { launchAppUrl } from "@/lib/auth";

// Dashboard section: launch the installable mobile app (/pesaswapApp) already
// signed in with the logged-in merchant's session, or install it to the home
// screen. The session is handed off via the URL fragment (adopted on open), so a
// standalone PWA window starts authenticated without a re-login.
export function LaunchAppCard() {
  function launch() {
    if (typeof window === "undefined") return;
    window.open(launchAppUrl(), "_blank", "noopener");
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-foreground/5 p-3">
            <Smartphone className="size-6" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Mobile app</h2>
            <p className="max-w-md text-sm text-muted-foreground">
              Run PesaSwap on your phone — Tap &amp; Go, QR invoicing, orders and AI
              insights. Opens signed in to your account.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={launch}
            className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-4 py-2.5 text-sm font-semibold text-background transition-opacity hover:opacity-90"
          >
            <ExternalLink className="size-4" /> Launch app
          </button>
          <InstallButton />
        </div>
      </div>
    </div>
  );
}
