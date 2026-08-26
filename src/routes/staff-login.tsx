import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Lock } from "lucide-react";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { staffLogin } from "@/lib/auth";

export const Route = createFileRoute("/staff-login")({
  component: StaffLoginPage,
});

function StaffLoginPage() {
  const navigate = useNavigate();
  const [venue, setVenue] = useState("");
  const [account, setAccount] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!venue.trim() || !account.trim() || !/^\d{6,8}$/.test(pin)) {
      setError("Enter your venue ID, phone/account, and 6–8 digit PIN.");
      return;
    }
    setLoading(true);
    setError("");
    const result = await staffLogin({
      venue: venue.trim(),
      account: account.trim(),
      pin,
    });
    setLoading(false);
    if ("user" in result) {
      void navigate({ to: "/staff-console" });
      return;
    }
    if (result.resetRequired) {
      setError("This credential must be reset by a manager before sign-in.");
    } else if (result.status === 429) {
      const minutes = Math.max(1, Math.ceil((result.retryAfter ?? 900) / 60));
      setError(`Too many attempts. Try again in about ${minutes} minutes.`);
    } else {
      setError("Invalid credentials.");
    }
    setPin("");
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-950 p-4">
      {/* Back button */}
      <div className="absolute left-4 top-4">
        <Button
          variant="ghost"
          className="text-slate-400 hover:text-white"
          onClick={() => void navigate({ to: "/sign-in" })}
        >
          <ArrowLeft className="mr-1 h-4 w-4" /> Back
        </Button>
      </div>

      <div className="w-full max-w-sm text-center">
        {/* Logo */}
        <div className="mb-8">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-violet-500/15">
            <Lock className="h-8 w-8 text-violet-400" />
          </div>
          <h1 className="text-xl font-semibold text-white">Staff Login</h1>
          <p className="mt-1 text-sm text-slate-400">
            Sign in to a specific venue with your account and PIN
          </p>
        </div>

        {error && (
          <p className="mb-4 text-sm font-medium text-red-400">{error}</p>
        )}

        <form onSubmit={submit} className="space-y-4 text-left">
          <Input
            value={venue}
            onChange={(event) => setVenue(event.target.value)}
            placeholder="Venue ID (for example v_ab12cd34)"
            autoComplete="organization"
            className="border-slate-700 bg-slate-900 text-white"
          />
          <Input
            value={account}
            onChange={(event) => setAccount(event.target.value)}
            placeholder="Phone or staff account"
            autoComplete="username"
            className="border-slate-700 bg-slate-900 text-white"
          />
          <Input
            value={pin}
            onChange={(event) =>
              setPin(event.target.value.replace(/\D/g, "").slice(0, 8))
            }
            type="password"
            inputMode="numeric"
            pattern="[0-9]{6,8}"
            minLength={6}
            maxLength={8}
            placeholder="6–8 digit PIN"
            autoComplete="current-password"
            className="border-slate-700 bg-slate-900 text-white"
          />
          <Button
            type="submit"
            disabled={loading}
            className="w-full bg-violet-600 hover:bg-violet-700"
          >
            {loading ? "Signing in…" : "Sign in"}
          </Button>
        </form>

        {/* Hint & Forgot PIN */}
        <div className="mt-8 space-y-2">
          <button
            onClick={() => void navigate({ to: "/reset-pin" })}
            className="text-xs text-violet-400 hover:text-violet-300 hover:underline transition"
          >
            Forgot your PIN?
          </button>
        </div>
      </div>

    </div>
  );
}
