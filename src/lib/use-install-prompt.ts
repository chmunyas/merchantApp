import { useEffect, useState } from "react";

// The non-standard event Chromium fires when the PWA meets install criteria.
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export type InstallState = {
  /** A native install prompt is available (Android / desktop Chromium). */
  canInstall: boolean;
  /** The app is already installed / running in standalone mode. */
  isStandalone: boolean;
  /** iOS Safari — needs the manual "Add to Home Screen" gesture. */
  isIOS: boolean;
  /** Trigger the native prompt. Returns the outcome or "unavailable". */
  promptInstall: () => Promise<"accepted" | "dismissed" | "unavailable">;
};

function detectStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const iosStandalone = (
    window.navigator as Navigator & { standalone?: boolean }
  ).standalone;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    iosStandalone === true
  );
}

function detectIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  // iPad on iOS 13+ reports as Mac, so also check for touch + Apple platform.
  const ua = navigator.userAgent;
  const isAppleMobile = /iphone|ipad|ipod/i.test(ua);
  const isIPadOS =
    navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  return isAppleMobile || isIPadOS;
}

// Captures the beforeinstallprompt event and exposes a clean install API so any
// component can offer a real "Install app" affordance (installability UX).
export function useInstallPrompt(): InstallState {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(
    null,
  );
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    setIsStandalone(detectStandalone());

    const onPrompt = (event: Event) => {
      // Prevent the mini-infobar so we can present our own button.
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setDeferred(null);
      setIsStandalone(true);
    };

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  async function promptInstall(): Promise<
    "accepted" | "dismissed" | "unavailable"
  > {
    if (!deferred) return "unavailable";
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    if (outcome === "accepted") setDeferred(null);
    return outcome;
  }

  return {
    canInstall: deferred !== null,
    isStandalone,
    isIOS: detectIOS(),
    promptInstall,
  };
}
