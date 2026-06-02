import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Building2, Shield, UserCheck, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  demoLogin,
  getDefaultRouteForRole,
  isDemoMode,
  useAuth,
} from "@/lib/auth";

export const Route = createFileRoute("/sign-in")({
  component: SignInPage,
});

function SignInPage() {
  const navigate = useNavigate();
  const { isSignedIn, user } = useAuth();

  // If already signed in, redirect
  if (isSignedIn && user) {
    void navigate({ to: getDefaultRouteForRole(user.role) });
    return null;
  }

  function handleDemoLogin(role: "admin" | "merchant" | "staff") {
    if (role === "staff") {
      void navigate({ to: "/staff-login" });
      return;
    }
    demoLogin(role);
    void navigate({ to: getDefaultRouteForRole(role) });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-4">
      <div className="w-full max-w-md">
        <div className="rounded-2xl border bg-white p-8 shadow-xl">
          {/* Header */}
          <div className="mb-8 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-100">
              <Shield className="h-7 w-7 text-violet-600" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900">
              Welcome to PesaSwap
            </h1>
            <p className="mt-2 text-sm text-slate-500">
              Sign in to access your dashboard
            </p>
          </div>

          {isDemoMode() && (
            <div className="mb-6 rounded-xl bg-amber-50 border border-amber-200 p-3 text-center">
              <span className="rounded-md bg-amber-200 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-800">
                Demo Mode
              </span>
              <p className="mt-1.5 text-xs text-amber-700">
                No Clerk key configured. Choose a role to explore.
              </p>
            </div>
          )}

          {/* Role buttons */}
          <div className="space-y-3">
            <Button
              onClick={() => handleDemoLogin("admin")}
              className="flex w-full items-center justify-start gap-3 rounded-xl bg-violet-600 px-4 py-6 text-left text-white hover:bg-violet-700"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/20">
                <Shield className="h-5 w-5" />
              </div>
              <div>
                <div className="font-semibold">Sign in as Admin</div>
                <div className="text-xs text-violet-200">
                  Platform management & feature flags
                </div>
              </div>
            </Button>

            <Button
              onClick={() => handleDemoLogin("merchant")}
              className="flex w-full items-center justify-start gap-3 rounded-xl bg-emerald-600 px-4 py-6 text-left text-white hover:bg-emerald-700"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/20">
                <Building2 className="h-5 w-5" />
              </div>
              <div>
                <div className="font-semibold">Sign in as Merchant</div>
                <div className="text-xs text-emerald-200">
                  Dashboard, POS, orders & analytics
                </div>
              </div>
            </Button>

            <Button
              onClick={() => handleDemoLogin("staff")}
              className="flex w-full items-center justify-start gap-3 rounded-xl bg-blue-600 px-4 py-6 text-left text-white hover:bg-blue-700"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/20">
                <Users className="h-5 w-5" />
              </div>
              <div>
                <div className="font-semibold">Sign in as Staff</div>
                <div className="text-xs text-blue-200">
                  PIN entry for shift & order access
                </div>
              </div>
            </Button>
          </div>

          {/* Footer */}
          <div className="mt-8 border-t pt-4 text-center">
            <p className="text-xs text-slate-400">
              Set{" "}
              <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[10px]">
                VITE_CLERK_PUBLISHABLE_KEY
              </code>{" "}
              to enable real auth
            </p>
          </div>
        </div>

        {/* Quick credentials reference */}
        <div className="mt-4 rounded-xl bg-white/60 p-4 text-center text-xs text-slate-500">
          <UserCheck className="mx-auto mb-1 h-4 w-4" />
          Staff PIN: <span className="font-mono font-bold">1234</span>
        </div>
      </div>
    </div>
  );
}
