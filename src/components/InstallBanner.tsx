import { Download, Share, X } from "lucide-react";
import { useEffect, useState } from "react";

import { useInstallPrompt } from "@/lib/use-install-prompt";

const DISMISS_KEY = "pesaswap.install-banner.dismissed";

// A slim, dismissible app-wide banner that appears only when the PWA is
// installable (and not already installed). Remembers dismissal.
export function InstallBanner() {
  const { canInstall, isStandalone, isIOS, promptInstall } = useInstallPrompt();
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(DISMISS_KEY) === "1");
    } catch {
      setDismissed(false);
    }
  }, []);

  const show = !dismissed && !isStandalone && (canInstall || isIOS);
  if (!show) return null;

  function close() {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
  }

  async function install() {
    if (!canInstall) return;
    const outcome = await promptInstall();
    if (outcome !== "dismissed") close();
  }

  return (
    <div
      role="region"
      aria-label="Install PesaSwap app"
      className="fixed inset-x-0 bottom-0 z-[60] border-t border-border bg-card/95 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-[0_-4px_20px_rgba(0,0,0,0.08)] backdrop-blur supports-[backdrop-filter]:bg-card/80"
    >
      <div className="mx-auto flex max-w-2xl items-center gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-foreground text-background">
          <Download className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">
            Install PesaSwap
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {isIOS ? (
              <>
                Tap <Share className="inline size-3 align-[-2px]" /> Share →{" "}
                <strong>Add to Home Screen</strong>
              </>
            ) : (
              "Add to your home screen — works offline, feels native."
            )}
          </p>
        </div>
        {canInstall && (
          <button
            type="button"
            onClick={install}
            className="shrink-0 rounded-lg bg-foreground px-3 py-2 text-xs font-semibold text-background transition-opacity hover:opacity-90"
          >
            Install
          </button>
        )}
        <button
          type="button"
          onClick={close}
          aria-label="Dismiss install banner"
          className="shrink-0 rounded-lg p-2 text-muted-foreground hover:bg-muted"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
