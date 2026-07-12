import { useEffect, useState } from "react";

import { isDemoSession } from "@/lib/auth";

// A slim, unmissable notice shown ONLY when the app is running on an anonymous
// session scoped to the shared demo venue (see isDemoSession). This is the fix for
// the "I signed in but I'm looking at someone else's data" trap: a cold-opened PWA
// silently gets a demo session, so we tell the operator exactly what they're seeing
// and offer a one-tap way to sign into their own business.
export function DemoVenueBanner() {
  const [demo, setDemo] = useState(false);

  useEffect(() => {
    const check = () => setDemo(isDemoSession());
    check();
    window.addEventListener("pesaswap:auth-changed", check);
    window.addEventListener("storage", check);
    return () => {
      window.removeEventListener("pesaswap:auth-changed", check);
      window.removeEventListener("storage", check);
    };
  }, []);

  if (!demo) return null;

  return (
    <div
      role="status"
      className="flex items-center justify-between gap-3 border-b border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200"
    >
      <span className="leading-tight">
        You’re viewing the <strong>demo venue</strong>. Sign in to see your
        business.
      </span>
      <a
        href="/sign-in"
        className="shrink-0 rounded-md bg-amber-500 px-2.5 py-1 font-semibold text-white hover:bg-amber-600"
      >
        Sign in
      </a>
    </div>
  );
}
