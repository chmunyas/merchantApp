import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  Building2,
  KeyRound,
  Mail,
  Shield,
  UserCheck,
  Users,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  demoLogin,
  getDefaultRouteForRole,
  isDemoMode,
  useAuth,
} from "@/lib/auth";

export const Route = createFileRoute("/sign-in")({
  component: SignInPage,
});

type View = "picker" | "login" | "forgot" | "reset-sent";

function SignInPage() {
  const navigate = useNavigate();
  const { isSignedIn, user } = useAuth();
  const [view, setView] = useState<View>("picker");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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

  function handleEmailLogin(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    // Demo mode: recognize demo credentials
    setTimeout(() => {
      if (email === "admin@pesaswap.io" && password === "admin123") {
        demoLogin("admin", { email });
        void navigate({ to: "/admin" });
      } else if (email === "merchant@demo.com" && password === "merchant123") {
        demoLogin("merchant", { email });
        void navigate({ to: "/dashboard" });
      } else if (isDemoMode()) {
        // In demo mode, any email works as merchant
        demoLogin("merchant", { email });
        toast.success("Signed in (demo mode)");
        void navigate({ to: "/dashboard" });
      } else {
        setError("Invalid email or password");
      }
      setLoading(false);
    }, 800);
  }

  function handleForgotPassword(e: FormEvent) {
    e.preventDefault();
    if (!email.trim()) {
      setError("Please enter your email address");
      return;
    }
    setError("");
    setLoading(true);
    // Simulate sending reset email
    setTimeout(() => {
      setLoading(false);
      setView("reset-sent");
      toast.success("Reset link sent!");
    }, 1000);
  }

  // Forgot password confirmation screen
  if (view === "reset-sent") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-4">
        <div className="w-full max-w-md">
          <div className="rounded-2xl border bg-white p-8 shadow-xl text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-100">
              <Mail className="h-7 w-7 text-emerald-600" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900">
              Check your email
            </h1>
            <p className="mt-3 text-sm text-slate-500">
              We've sent a password reset link to
              <br />
              <span className="font-medium text-slate-700">{email}</span>
            </p>
            <p className="mt-4 text-xs text-slate-400">
              Didn't receive it? Check spam or try again in a few minutes.
            </p>
            <div className="mt-6 space-y-3">
              <Button
                className="w-full rounded-xl"
                variant="outline"
                onClick={() => {
                  setView("forgot");
                  setEmail("");
                }}
              >
                Try a different email
              </Button>
              <Button
                className="w-full rounded-xl"
                onClick={() => setView("picker")}
              >
                Back to sign in
              </Button>
            </div>
            {isDemoMode() && (
              <p className="mt-4 rounded-lg bg-amber-50 border border-amber-200 p-2 text-[11px] text-amber-700">
                Demo mode: no real email sent. In production, Clerk handles
                password reset via email/SMS.
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Forgot password form
  if (view === "forgot") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-4">
        <div className="w-full max-w-md">
          <div className="rounded-2xl border bg-white p-8 shadow-xl">
            <button
              onClick={() => setView("login")}
              className="mb-4 flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 transition"
            >
              <ArrowLeft className="h-4 w-4" /> Back to login
            </button>
            <div className="mb-6 text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100">
                <KeyRound className="h-7 w-7 text-amber-600" />
              </div>
              <h1 className="text-2xl font-bold text-slate-900">
                Reset password
              </h1>
              <p className="mt-2 text-sm text-slate-500">
                Enter your email and we'll send a reset link
              </p>
            </div>

            <form onSubmit={handleForgotPassword} className="space-y-4">
              <div className="space-y-2">
                <label
                  className="text-sm font-medium text-slate-700"
                  htmlFor="reset-email"
                >
                  Email address
                </label>
                <Input
                  id="reset-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-11 rounded-xl"
                  placeholder="you@business.com"
                  autoFocus
                />
              </div>
              {error && (
                <p className="rounded-lg bg-red-50 border border-red-200 p-2 text-sm text-red-600">
                  {error}
                </p>
              )}
              <Button
                type="submit"
                disabled={loading}
                className="h-11 w-full rounded-xl bg-violet-600 hover:bg-violet-700"
              >
                {loading ? "Sending…" : "Send reset link"}
              </Button>
            </form>

            <div className="mt-6 text-center">
              <p className="text-xs text-slate-400">
                Staff member?{" "}
                <Link
                  to="/staff-login"
                  className="font-medium text-blue-600 hover:underline"
                >
                  Reset your PIN here
                </Link>
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Email/password login form
  if (view === "login") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-4">
        <div className="w-full max-w-md">
          <div className="rounded-2xl border bg-white p-8 shadow-xl">
            <button
              onClick={() => setView("picker")}
              className="mb-4 flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 transition"
            >
              <ArrowLeft className="h-4 w-4" /> Back
            </button>
            <div className="mb-6 text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-100">
                <Shield className="h-7 w-7 text-violet-600" />
              </div>
              <h1 className="text-2xl font-bold text-slate-900">Sign in</h1>
              <p className="mt-2 text-sm text-slate-500">
                Enter your credentials
              </p>
            </div>

            <form onSubmit={handleEmailLogin} className="space-y-4">
              <div className="space-y-2">
                <label
                  className="text-sm font-medium text-slate-700"
                  htmlFor="login-email"
                >
                  Email address
                </label>
                <Input
                  id="login-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-11 rounded-xl"
                  placeholder="you@business.com"
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label
                    className="text-sm font-medium text-slate-700"
                    htmlFor="login-password"
                  >
                    Password
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setError("");
                      setView("forgot");
                    }}
                    className="text-xs font-medium text-violet-600 hover:text-violet-700 hover:underline"
                  >
                    Forgot password?
                  </button>
                </div>
                <Input
                  id="login-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-11 rounded-xl"
                  placeholder="••••••••"
                />
              </div>
              {error && (
                <p className="rounded-lg bg-red-50 border border-red-200 p-2 text-sm text-red-600">
                  {error}
                </p>
              )}
              <Button
                type="submit"
                disabled={loading}
                className="h-11 w-full rounded-xl bg-violet-600 hover:bg-violet-700"
              >
                {loading ? "Signing in…" : "Sign in"}
              </Button>
            </form>

            <div className="mt-6 text-center space-y-2">
              <p className="text-xs text-slate-400">
                Staff member?{" "}
                <Link
                  to="/staff-login"
                  className="font-medium text-blue-600 hover:underline"
                >
                  Use PIN login
                </Link>
              </p>
            </div>

            {isDemoMode() && (
              <div className="mt-4 rounded-xl bg-slate-50 border border-slate-200 p-3 text-xs text-slate-500">
                <p className="font-medium text-slate-700 mb-1">
                  Demo credentials:
                </p>
                <div className="space-y-0.5 font-mono text-[11px]">
                  <p>admin@pesaswap.io / admin123</p>
                  <p>merchant@demo.com / merchant123</p>
                  <p>Or any email → signs in as merchant</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Role picker (default view)
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-4">
      <div className="w-full max-w-md">
        <div className="rounded-2xl border bg-white p-8 shadow-xl">
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
                Quick access — choose a role or use email login below.
              </p>
            </div>
          )}

          {/* Quick role buttons */}
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

          {/* Divider */}
          <div className="my-6 flex items-center gap-3">
            <div className="h-px flex-1 bg-slate-200" />
            <span className="text-xs text-slate-400">or</span>
            <div className="h-px flex-1 bg-slate-200" />
          </div>

          {/* Email login button */}
          <Button
            variant="outline"
            onClick={() => setView("login")}
            className="w-full rounded-xl h-11"
          >
            <Mail className="mr-2 h-4 w-4" />
            Sign in with email
          </Button>

          {/* Footer */}
          <div className="mt-6 text-center">
            <button
              onClick={() => {
                setView("forgot");
              }}
              className="text-xs text-slate-400 hover:text-violet-600 transition"
            >
              Forgot your password?
            </button>
          </div>
        </div>

        <div className="mt-4 rounded-xl bg-white/60 p-4 text-center text-xs text-slate-500">
          <UserCheck className="mx-auto mb-1 h-4 w-4" />
          Staff PIN: <span className="font-mono font-bold">1234</span>
        </div>
      </div>
    </div>
  );
}
