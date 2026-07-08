import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CreditCard,
  MessageSquare,
  QrCode,
  Rocket,
  Store,
} from "lucide-react";
import { useMemo, useState } from "react";

import { InstallButton } from "@/components/InstallButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { signup } from "@/lib/auth";
import { useEffect } from "react";
import {
  ensureMerchantDemoData,
  saveMerchantSettings,
  setCurrentVenueId,
} from "@/lib/merchant-dashboard";

type ResellerBrand = {
  name: string;
  slug: string;
  logoUrl: string | null;
  primaryColor: string | null;
  poweredBy: string | null;
};

export const Route = createFileRoute("/get-started")({
  validateSearch: (search: Record<string, unknown>): { org?: string } => ({
    org: typeof search.org === "string" ? search.org : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Get started — PesaSwap" },
      {
        name: "description",
        content:
          "Set up your PesaSwap merchant account in under a minute — installable, mobile-first, self-serve.",
      },
    ],
  }),
  component: GetStartedPage,
});

const ONBOARDED_KEY = "pesaswap.onboarded";

type Step = "welcome" | "business" | "install" | "done";
const ORDER: Step[] = ["welcome", "business", "install", "done"];

function GetStartedPage() {
  const navigate = useNavigate();
  const { org } = Route.useSearch();
  const existing = useMemo(() => ensureMerchantDemoData(), []);
  const [step, setStep] = useState<Step>("welcome");
  const [bizName, setBizName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [reseller, setReseller] = useState<ResellerBrand | null>(null);

  // Co-branded signup: a merchant arriving via a bank's /get-started?org=<slug>
  // sees that reseller's brand and is linked to its org on signup.
  useEffect(() => {
    if (!org) return;
    let active = true;
    void (async () => {
      try {
        const res = await fetch(`/api/org?slug=${encodeURIComponent(org)}`);
        if (!res.ok) return;
        const data = (await res.json()) as { org?: ResellerBrand | null };
        if (active && data.org) setReseller(data.org);
      } catch {
        /* fall back to the default PesaSwap brand */
      }
    })();
    return () => {
      active = false;
    };
  }, [org]);

  const index = ORDER.indexOf(step);

  function next() {
    if (step === "business") {
      if (!bizName.trim()) {
        setError("Enter your business name.");
        return;
      }
      if (!email.trim() || !email.includes("@")) {
        setError("Enter a valid email address.");
        return;
      }
      if (password.length < 8) {
        setError("Password must be at least 8 characters.");
        return;
      }
      setError("");
    }
    const i = ORDER.indexOf(step);
    if (i < ORDER.length - 1) setStep(ORDER[i + 1]);
  }
  function back() {
    const i = ORDER.indexOf(step);
    if (i > 0) setStep(ORDER[i - 1]);
  }

  async function finish() {
    setSaving(true);
    setError("");
    const result = await signup({
      businessName: bizName.trim(),
      email: email.trim(),
      password,
      phone: phone.trim() || undefined,
      org: org || undefined,
    });
    if ("error" in result) {
      setError(result.error);
      setSaving(false);
      setStep("business");
      return;
    }
    // Scope the app to the new venue and personalise its storefront.
    if (result.venue) setCurrentVenueId(result.venue);
    try {
      const snap = ensureMerchantDemoData();
      saveMerchantSettings({
        ...snap.settings,
        businessProfile: {
          ...snap.settings.businessProfile,
          name: bizName.trim() || snap.settings.businessProfile.name,
          phone: phone.trim() || snap.settings.businessProfile.phone,
        },
      });
      localStorage.setItem(ONBOARDED_KEY, "1");
    } catch {
      /* ignore */
    }
    void navigate({ to: "/dashboard" });
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-white">
      {/* Progress */}
      <header className="mx-auto w-full max-w-md px-5 pt-6">
        <div className="flex items-center justify-between">
          {reseller ? (
            <span className="flex items-center gap-2 text-sm font-semibold tracking-tight">
              {reseller.logoUrl ? (
                <img
                  src={reseller.logoUrl}
                  alt={reseller.name}
                  className="h-5 w-auto rounded"
                />
              ) : null}
              {reseller.name}
              <span className="text-slate-500">× PesaSwap</span>
            </span>
          ) : (
            <span className="text-sm font-semibold tracking-tight">PesaSwap</span>
          )}
          <span className="text-xs text-slate-400">
            Step {Math.min(index + 1, 3)} of 3
          </span>
        </div>
        <div className="mt-3 flex gap-1.5">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className={`h-1 flex-1 rounded-full transition-colors ${
                i <= index ? "bg-emerald-500" : "bg-slate-800"
              }`}
            />
          ))}
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-5 py-8">
        {step === "welcome" && (
          <StepShell
            icon={<Rocket className="size-7 text-emerald-400" />}
            title="Run your business from your pocket"
            subtitle="Accept payments, send invoices, take bookings and chat with customers on WhatsApp & Telegram — all from one installable app."
          >
            <ul className="mt-6 space-y-3">
              {[
                { i: QrCode, t: "QR & Tap-to-pay checkout" },
                { i: CreditCard, t: "Invoices, reminders & recurring billing" },
                { i: MessageSquare, t: "WhatsApp / Telegram AI assistant" },
              ].map(({ i: Icon, t }) => (
                <li key={t} className="flex items-center gap-3 text-sm">
                  <span className="flex size-8 items-center justify-center rounded-lg bg-slate-800">
                    <Icon className="size-4 text-emerald-400" />
                  </span>
                  {t}
                </li>
              ))}
            </ul>
          </StepShell>
        )}

        {step === "business" && (
          <StepShell
            icon={<Store className="size-7 text-emerald-400" />}
            title="Create your account"
            subtitle="This sets up your own workspace, storefront, receipts and customer messages."
          >
            <div className="mt-6 space-y-4">
              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-slate-300">
                  Business name
                </span>
                <Input
                  value={bizName}
                  onChange={(e) => setBizName(e.target.value)}
                  placeholder={existing.settings.businessProfile.name}
                  className="h-11 rounded-xl border-slate-700 bg-slate-900 text-white placeholder:text-slate-500"
                  autoFocus
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-slate-300">
                  Work email
                </span>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@business.com"
                  className="h-11 rounded-xl border-slate-700 bg-slate-900 text-white placeholder:text-slate-500"
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-slate-300">
                  Password
                </span>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  className="h-11 rounded-xl border-slate-700 bg-slate-900 text-white placeholder:text-slate-500"
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-slate-300">
                  Business phone{" "}
                  <span className="text-slate-500">(optional)</span>
                </span>
                <Input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+254 7XX XXX XXX"
                  className="h-11 rounded-xl border-slate-700 bg-slate-900 text-white placeholder:text-slate-500"
                />
              </label>
              {error && <p className="text-sm text-red-400">{error}</p>}
            </div>
          </StepShell>
        )}

        {step === "install" && (
          <StepShell
            icon={<Rocket className="size-7 text-emerald-400" />}
            title="Install the app"
            subtitle="Add PesaSwap to your home screen for a full-screen, offline-ready experience that launches like a native app."
          >
            <div className="mt-6 space-y-3">
              <InstallButton className="w-full" />
              <p className="text-center text-[11px] text-slate-500">
                Optional — you can always install later from your browser menu.
              </p>
            </div>
          </StepShell>
        )}

        {/* Footer nav */}
        <div className="mt-auto pt-8">
          {step !== "install" ? (
            <div className="flex items-center gap-3">
              {index > 0 && (
                <Button
                  variant="ghost"
                  onClick={back}
                  className="text-slate-400 hover:text-white"
                >
                  <ArrowLeft className="mr-1 size-4" /> Back
                </Button>
              )}
              <Button
                onClick={next}
                className="h-12 flex-1 rounded-xl bg-emerald-600 text-base hover:bg-emerald-700"
              >
                Continue <ArrowRight className="ml-1 size-4" />
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                onClick={back}
                className="text-slate-400 hover:text-white"
              >
                <ArrowLeft className="mr-1 size-4" /> Back
              </Button>
              <Button
                onClick={finish}
                disabled={saving}
                className="h-12 flex-1 rounded-xl bg-emerald-600 text-base hover:bg-emerald-700"
              >
                {saving ? (
                  "Creating account…"
                ) : (
                  <>
                    <Check className="mr-1 size-4" /> Create account
                  </>
                )}
              </Button>
            </div>
          )}
          <p className="mt-4 text-center text-xs text-slate-500">
            Already have an account?{" "}
            <button
              type="button"
              onClick={() => void navigate({ to: "/sign-in" })}
              className="font-medium text-emerald-400 hover:underline"
            >
              Sign in
            </button>
          </p>
        </div>
      </main>
    </div>
  );
}

function StepShell({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="animate-slide-up">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-emerald-500/15">
        {icon}
      </div>
      <h1 className="mt-5 text-2xl font-bold leading-tight tracking-tight">
        {title}
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-slate-400">{subtitle}</p>
      {children}
    </div>
  );
}
