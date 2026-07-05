import { Check, Download, Share } from "lucide-react";
import { useState } from "react";

import { useInstallPrompt } from "@/lib/use-install-prompt";

// A real "Install app" button: fires the native prompt where available, shows an
// "Add to Home Screen" hint on iOS, and confirms when already installed.
export function InstallButton({ className }: { className?: string }) {
  const { canInstall, isStandalone, isIOS, promptInstall } = useInstallPrompt();
  const [showIosHint, setShowIosHint] = useState(false);

  if (isStandalone) {
    return (
      <span
        className={`inline-flex items-center justify-center gap-1.5 rounded-md bg-emerald-500/10 px-3 py-2.5 text-xs font-semibold text-emerald-600 ${className ?? ""}`}
      >
        <Check className="size-3.5" /> App installed
      </span>
    );
  }

  async function handleClick() {
    if (canInstall) {
      const outcome = await promptInstall();
      if (outcome === "unavailable") setShowIosHint(true);
      return;
    }
    // No native prompt (iOS Safari, or criteria not yet met) — show the hint.
    setShowIosHint((value) => !value);
  }

  return (
    <div className={`relative ${className ?? ""}`}>
      <button
        type="button"
        onClick={handleClick}
        aria-label="Install PesaSwap app"
        className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-foreground px-3 py-2.5 text-xs font-semibold text-background transition-opacity hover:opacity-90"
      >
        <Download className="size-3.5" /> Install app
      </button>
      {showIosHint && (
        <div className="absolute inset-x-0 top-full z-20 mt-2 rounded-lg border border-border bg-card p-3 text-left text-[11px] leading-relaxed text-muted-foreground shadow-lg">
          <p className="flex items-center gap-1 font-semibold text-foreground">
            <Share className="size-3.5" />
            {isIOS ? "Add to Home Screen" : "Install from your browser"}
          </p>
          <p className="mt-1">
            {isIOS ? (
              <>
                Tap the <strong>Share</strong> button, then choose{" "}
                <strong>“Add to Home Screen”</strong>.
              </>
            ) : (
              <>
                Open your browser menu and choose <strong>“Install app”</strong>{" "}
                or <strong>“Add to Home Screen”</strong>.
              </>
            )}
          </p>
        </div>
      )}
    </div>
  );
}
