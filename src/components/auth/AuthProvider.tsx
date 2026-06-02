import { type ReactNode } from "react";

import { AuthContext, isDemoMode, useDemoAuth } from "@/lib/auth";

function DemoAuthProvider({ children }: { children: ReactNode }) {
  const auth = useDemoAuth();
  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  if (isDemoMode()) {
    return <DemoAuthProvider>{children}</DemoAuthProvider>;
  }

  // Production: Clerk provider — only imported when we have a real key
  // For now, fall back to demo mode (Clerk integration added when key is set)
  return <DemoAuthProvider>{children}</DemoAuthProvider>;
}
