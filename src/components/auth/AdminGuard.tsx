import { type ReactNode, useEffect, useRef, useState } from "react";

import { authFetch, useAuth } from "@/lib/auth";

// Server-verified admin gate. A client-side role (localStorage) can only HIDE the
// admin UI, never protect it — anyone can set it. This confirms with the server
// that the current JWT is a REAL platform admin before rendering the portal. Wrap
// the whole admin layout so every admin page and feature is covered by one check.
export function AdminGuard({ children }: { children: ReactNode }) {
  const { signOut } = useAuth();
  const signOutRef = useRef(signOut);
  signOutRef.current = signOut;
  const [state, setState] = useState<"checking" | "ok" | "denied">("checking");

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await authFetch("/api/admin/session");
        if (!alive) return;
        if (res.ok) {
          setState("ok");
          return;
        }
        setState("denied");
        // A definitive rejection means the session isn't a real admin (or the admin
        // token expired). Clear it so the parent ProtectedRoute redirects to sign-in
        // cleanly instead of bouncing a stale localStorage role in a loop.
        if (res.status === 401 || res.status === 403) signOutRef.current();
      } catch {
        if (alive) setState("denied");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (state === "ok") return <>{children}</>;

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950">
      <div className="text-center">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-violet-500 border-t-transparent" />
        <p className="mt-3 text-sm text-slate-400">
          {state === "checking"
            ? "Verifying admin access…"
            : "Admin access only — redirecting to sign in…"}
        </p>
      </div>
    </div>
  );
}

