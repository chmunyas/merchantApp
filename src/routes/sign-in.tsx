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
import { useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TurnstileWidget } from "@/components/auth/TurnstileWidget";
import {
  completeSso,
  demoLogin,
  getDefaultRouteForRole,
  googleLogin,
  isDemoMode,
  jwtLogin,
  requestOtp,
  verifyOtp,
  useAuth,
} from "@/lib/auth";

export const Route = createFileRoute("/sign-in")({
  component: SignInPage,
});

type View = "picker" | "login" | "otp" | "sso" | "forgot" | "reset-sent";

// Google Identity Services sign-in. Renders the official button when a
// GOOGLE_CLIENT_ID is configured; otherwise shows a disabled hint.
function GoogleSignInButton() {
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const [clientId, setClientId] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    fetch("/api/auth/google/config")
      .then((r) => r.json())
      .then((d: { clientId?: string | null }) => {
        setClientId(d.clientId ?? null);
        setChecked(true);
      })
      .catch(() => setChecked(true));
  }, []);

  useEffect(() => {
    if (!clientId || !ref.current) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    const init = () => {
      const gid = w.google?.accounts?.id;
      if (!gid || !ref.current) return;
      gid.initialize({
        client_id: clientId,
        callback: async (resp: { credential?: string }) => {
          if (!resp.credential) return;
          const user = await googleLogin(resp.credential);
          if (user) void navigate({ to: getDefaultRouteForRole(user.role) });
          else toast.error("Google sign-in failed.");
        },
      });
      gid.renderButton(ref.current, {
        theme: "outline",
        size: "large",
        width: 320,
        text: "signin_with",
      });
    };
    if (w.google?.accounts?.id) {
      init();
      return;
    }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = init;
    document.body.appendChild(script);
  }, [clientId, navigate]);

  if (checked && !clientId) {
    return (
      <button
        type="button"
        disabled
        className="h-11 w-full rounded-xl border border-slate-200 text-sm text-slate-400"
        title="Set GOOGLE_CLIENT_ID to enable Google sign-in"
      >
        Sign in with Google (configure GOOGLE_CLIENT_ID)
      </button>
    );
  }
  return <div ref={ref} className="flex justify-center" />;
}

function SignInPage() {
  const navigate = useNavigate();
  const { isSignedIn, user } = useAuth();
  const [view, setView] = useState<View>("picker");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  // Passwordless OTP + optional TOTP second factor.
  const [otpSent, setOtpSent] = useState(false);
  const [code, setCode] = useState("");
  const [totp, setTotp] = useState("");
  const [needTotp, setNeedTotp] = useState(false);
  const [devHint, setDevHint] = useState<string | null>(null);
  const [captcha, setCaptcha] = useState("");
  const [ssoSlug, setSsoSlug] = useState(() =>
    typeof window !== "undefined"
      ? (new URLSearchParams(window.location.search).get("org") ?? "")
      : "",
  );

  function startSso() {
    const slug = ssoSlug.trim().toLowerCase();
    if (!slug) {
      setError("Enter your organization");
      return;
    }
    window.location.href = `/api/auth/sso/${encodeURIComponent(slug)}/start`;
  }

  // Enterprise SSO handoff: the IdP callback returns the app JWT in the URL
  // fragment (never sent to a server). Consume it, then route to the right home.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const m = window.location.hash.match(/sso_token=([^&]+)/);
    if (m) {
      const done = completeSso(decodeURIComponent(m[1]));
      window.history.replaceState(null, "", window.location.pathname);
      if (done) {
        void navigate({ to: getDefaultRouteForRole(done.role) });
        return;
      }
      toast.error("Single sign-on failed. Please try again.");
    }
    if (new URLSearchParams(window.location.search).get("sso_error")) {
      toast.error("Single sign-on failed. Please try again.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // If already signed in, redirect
  if (isSignedIn && user) {
    void navigate({ to: getDefaultRouteForRole(user.role) });
    return null;
  }

  async function handleDemoLogin(role: "admin" | "merchant" | "staff") {
    if (role === "staff") {
      void navigate({ to: "/staff-login" });
      return;
    }
    if (role === "admin") {
      const { user } = await jwtLogin("admin@pesaswap.io", "pesaswap-admin");
      if (user) {
        void navigate({ to: "/admin" });
        return;
      }
      // On a real deploy the demo admin password doesn't apply, so DON'T fall back
      // to a fake client-only admin session (it can't call the admin APIs). Take the
      // operator to the real admin password form instead, pre-filled.
      setEmail("admin@pesaswap.io");
      setPassword("");
      setError("");
      setView("login");
      return;
    }
    demoLogin(role);
    void navigate({ to: getDefaultRouteForRole(role) });
  }

  async function handleEmailLogin(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    // Real server-verified login (PBKDF2 + JWT), with optional TOTP second factor.
    const { user, totpRequired } = await jwtLogin(
      email,
      password,
      totp || undefined,
    );
    if (totpRequired) {
      setNeedTotp(true);
      setError("");
      setLoading(false);
      return;
    }
    if (user) {
      void navigate({ to: getDefaultRouteForRole(user.role) });
    } else if (isDemoMode()) {
      demoLogin("merchant", { email });
      toast.success("Signed in (demo mode)");
      void navigate({ to: "/dashboard" });
    } else {
      setError(needTotp ? "Invalid authenticator code" : "Invalid email or password");
    }
    setLoading(false);
  }

  // Passwordless (Email OTP) — the default, lowest-friction sign-in.
  async function handleSendOtp(e: FormEvent) {
    e.preventDefault();
    if (!email.trim()) {
      setError("Enter your email address");
      return;
    }
    setError("");
    setLoading(true);
    const r = await requestOtp("email", email.trim(), captcha || undefined);
    setLoading(false);
    if (!r.sent) {
      setError(r.error ?? "Could not send the code.");
      return;
    }
    setOtpSent(true);
    setDevHint(r.devCode ? `Dev code: ${r.devCode}` : null);
    toast.success("We sent a code to your email");
  }

  async function handleVerifyOtp(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const r = await verifyOtp("email", email.trim(), code.trim(), {
      totp: totp || undefined,
    });
    if (r.totpRequired) {
      setNeedTotp(true);
      setLoading(false);
      return;
    }
    setLoading(false);
    if (r.user) {
      void navigate({ to: getDefaultRouteForRole(r.user.role) });
    } else {
      setError(r.error ?? "Verification failed.");
    }
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

  // Enterprise SSO (enter organization → redirect to their IdP)
  if (view === "sso") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-4">
        <div className="w-full max-w-md">
          <div className="rounded-2xl border bg-white p-8 shadow-xl">
            <button
              onClick={() => {
                setView("picker");
                setError("");
              }}
              className="mb-4 flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 transition"
            >
              <ArrowLeft className="h-4 w-4" /> Back
            </button>
            <div className="mb-6 text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-900">
                <Building2 className="h-7 w-7 text-white" />
              </div>
              <h1 className="text-2xl font-bold text-slate-900">
                Company single sign-on
              </h1>
              <p className="mt-2 text-sm text-slate-500">
                Enter your organization to continue to your identity provider.
              </p>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                startSso();
              }}
              className="space-y-4"
            >
              <Input
                value={ssoSlug}
                onChange={(e) => setSsoSlug(e.target.value)}
                className="h-11 rounded-xl"
                placeholder="your-organization"
                autoFocus
              />
              {error && (
                <p className="rounded-lg bg-red-50 border border-red-200 p-2 text-sm text-red-600">
                  {error}
                </p>
              )}
              <Button
                type="submit"
                className="h-11 w-full rounded-xl bg-slate-900 hover:bg-slate-800"
              >
                Continue with SSO
              </Button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  // Passwordless email OTP (default sign-in)
  if (view === "otp") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-4">
        <div className="w-full max-w-md">
          <div className="rounded-2xl border bg-white p-8 shadow-xl">
            <button
              onClick={() => {
                setView("picker");
                setOtpSent(false);
                setCode("");
                setNeedTotp(false);
                setError("");
              }}
              className="mb-4 flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 transition"
            >
              <ArrowLeft className="h-4 w-4" /> Back
            </button>
            <div className="mb-6 text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-100">
                <Mail className="h-7 w-7 text-emerald-600" />
              </div>
              <h1 className="text-2xl font-bold text-slate-900">
                {otpSent ? "Enter your code" : "Sign in with email"}
              </h1>
              <p className="mt-2 text-sm text-slate-500">
                {otpSent
                  ? `We sent a 6-digit code to ${email}`
                  : "No password needed — we'll email you a one-time code."}
              </p>
            </div>

            {!otpSent ? (
              <form onSubmit={handleSendOtp} className="space-y-4">
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-11 rounded-xl"
                  placeholder="you@business.com"
                  autoFocus
                />
                <TurnstileWidget onToken={setCaptcha} />
                {error && (
                  <p className="rounded-lg bg-red-50 border border-red-200 p-2 text-sm text-red-600">
                    {error}
                  </p>
                )}
                <Button
                  type="submit"
                  disabled={loading}
                  className="h-11 w-full rounded-xl bg-emerald-600 hover:bg-emerald-700"
                >
                  {loading ? "Sending…" : "Send me a code"}
                </Button>
              </form>
            ) : (
              <form onSubmit={handleVerifyOtp} className="space-y-4">
                <Input
                  inputMode="numeric"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="h-11 rounded-xl text-center text-lg tracking-[0.4em]"
                  placeholder="000000"
                  maxLength={6}
                  autoFocus
                />
                {needTotp && (
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-600">
                      Authenticator code (2FA)
                    </label>
                    <Input
                      inputMode="numeric"
                      value={totp}
                      onChange={(e) => setTotp(e.target.value)}
                      className="h-11 rounded-xl text-center tracking-[0.3em]"
                      placeholder="000000"
                      maxLength={6}
                    />
                  </div>
                )}
                {devHint && (
                  <p className="rounded-lg bg-amber-50 border border-amber-200 p-2 text-center text-xs text-amber-700">
                    {devHint}
                  </p>
                )}
                {error && (
                  <p className="rounded-lg bg-red-50 border border-red-200 p-2 text-sm text-red-600">
                    {error}
                  </p>
                )}
                <Button
                  type="submit"
                  disabled={loading}
                  className="h-11 w-full rounded-xl bg-emerald-600 hover:bg-emerald-700"
                >
                  {loading ? "Verifying…" : "Verify & sign in"}
                </Button>
                <button
                  type="button"
                  onClick={(e) => void handleSendOtp(e as unknown as FormEvent)}
                  className="w-full text-xs text-slate-400 hover:text-emerald-600"
                >
                  Resend code
                </button>
              </form>
            )}

            <div className="mt-6 text-center">
              <button
                onClick={() => {
                  setView("login");
                  setError("");
                }}
                className="text-xs text-slate-400 hover:text-violet-600 transition"
              >
                Prefer a password? Sign in with a password
              </button>
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
              {needTotp && (
                <div className="space-y-2">
                  <label
                    className="text-sm font-medium text-slate-700"
                    htmlFor="login-totp"
                  >
                    Authenticator code (2FA)
                  </label>
                  <Input
                    id="login-totp"
                    inputMode="numeric"
                    value={totp}
                    onChange={(e) => setTotp(e.target.value)}
                    className="h-11 rounded-xl text-center tracking-[0.3em]"
                    placeholder="000000"
                    maxLength={6}
                    autoFocus
                  />
                </div>
              )}
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

            <div className="mt-4 flex items-center gap-3">
              <div className="h-px flex-1 bg-slate-200" />
              <span className="text-xs text-slate-400">or</span>
              <div className="h-px flex-1 bg-slate-200" />
            </div>
            <div className="mt-4">
              <GoogleSignInButton />
            </div>

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
                  <p>admin@pesaswap.io / pesaswap-admin</p>
                  <p>Or any email → signs in as merchant (demo)</p>
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

          {/* Email login button (passwordless-first) */}
          <Button
            variant="outline"
            onClick={() => {
              setOtpSent(false);
              setCode("");
              setNeedTotp(false);
              setError("");
              setView("otp");
            }}
            className="w-full rounded-xl h-11"
          >
            <Mail className="mr-2 h-4 w-4" />
            Sign in with email
          </Button>

          <div className="mt-3">
            <GoogleSignInButton />
          </div>

          <button
            type="button"
            onClick={() => {
              setError("");
              setView("sso");
            }}
            className="mt-3 w-full rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            Sign in with company SSO
          </button>

          {/* Footer */}
          <div className="mt-6 space-y-3 text-center">
            <button
              onClick={() => {
                setView("forgot");
              }}
              className="text-xs text-slate-400 hover:text-violet-600 transition"
            >
              Forgot your password?
            </button>
            <p className="text-xs text-slate-500">
              New to PesaSwap?{" "}
              <Link
                to="/get-started"
                className="font-semibold text-violet-600 hover:underline"
              >
                Get started
              </Link>
            </p>
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
