import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  CheckCircle2,
  KeyRound,
  Phone,
  ShieldCheck,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/reset-pin")({
  component: ResetPinPage,
});

type Step = "identify" | "verify" | "new-pin" | "done";

function ResetPinPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("identify");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function handleIdentify(e: FormEvent) {
    e.preventDefault();
    if (!phone.trim() || phone.length < 10) {
      setError("Enter a valid phone number");
      return;
    }
    setError("");
    setLoading(true);
    // Simulate OTP send
    setTimeout(() => {
      setLoading(false);
      setStep("verify");
      toast.success(
        "OTP sent to " + phone.slice(0, 4) + "****" + phone.slice(-2),
      );
    }, 1000);
  }

  function handleVerifyOtp(e: FormEvent) {
    e.preventDefault();
    if (otp.length !== 4) {
      setError("Enter the 4-digit code");
      return;
    }
    setError("");
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      // Demo: any 4-digit OTP works
      if (otp === "0000") {
        setError("Invalid OTP. Try again.");
        return;
      }
      setStep("new-pin");
    }, 800);
  }

  function handleSetNewPin(e: FormEvent) {
    e.preventDefault();
    if (newPin.length !== 4) {
      setError("PIN must be exactly 4 digits");
      return;
    }
    if (newPin !== confirmPin) {
      setError("PINs do not match");
      return;
    }
    if (newPin === "0000" || newPin === "1111") {
      setError("PIN too simple. Choose something harder.");
      return;
    }
    setError("");
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      setStep("done");
      toast.success("PIN updated successfully!");
    }, 800);
  }

  if (step === "done") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 p-4">
        <div className="w-full max-w-sm text-center">
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-8">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/15">
              <CheckCircle2 className="h-8 w-8 text-emerald-400" />
            </div>
            <h1 className="text-xl font-semibold text-white">
              PIN Reset Complete
            </h1>
            <p className="mt-2 text-sm text-slate-400">
              Your new PIN is active. Use it to sign in.
            </p>
            <Button
              className="mt-6 w-full rounded-xl bg-violet-600 hover:bg-violet-700"
              onClick={() => void navigate({ to: "/staff-login" })}
            >
              Sign in with new PIN
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 p-4">
      {/* Back */}
      <div className="absolute left-4 top-4">
        <Button
          variant="ghost"
          className="text-slate-400 hover:text-white"
          onClick={() => {
            if (step === "identify") void navigate({ to: "/staff-login" });
            else if (step === "verify") setStep("identify");
            else setStep("verify");
          }}
        >
          <ArrowLeft className="mr-1 h-4 w-4" /> Back
        </Button>
      </div>

      <div className="w-full max-w-sm">
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-8">
          {/* Step 1: Phone identification */}
          {step === "identify" && (
            <>
              <div className="mb-6 text-center">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/15">
                  <Phone className="h-7 w-7 text-amber-400" />
                </div>
                <h1 className="text-xl font-semibold text-white">
                  Reset your PIN
                </h1>
                <p className="mt-2 text-sm text-slate-400">
                  Enter the phone number linked to your staff account
                </p>
              </div>
              <form onSubmit={handleIdentify} className="space-y-4">
                <Input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="h-11 rounded-xl border-slate-700 bg-slate-950 text-white"
                  placeholder="0712 345 678"
                  autoFocus
                />
                {error && <p className="text-sm text-red-400">{error}</p>}
                <Button
                  type="submit"
                  disabled={loading}
                  className="h-11 w-full rounded-xl bg-violet-600 hover:bg-violet-700"
                >
                  {loading ? "Sending OTP…" : "Send verification code"}
                </Button>
              </form>
              <p className="mt-4 text-center text-[11px] text-slate-500">
                We'll send a one-time code via SMS to verify your identity.
              </p>
            </>
          )}

          {/* Step 2: OTP verification */}
          {step === "verify" && (
            <>
              <div className="mb-6 text-center">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-500/15">
                  <ShieldCheck className="h-7 w-7 text-blue-400" />
                </div>
                <h1 className="text-xl font-semibold text-white">
                  Verify identity
                </h1>
                <p className="mt-2 text-sm text-slate-400">
                  Enter the 4-digit code sent to {phone.slice(0, 4)}****
                  {phone.slice(-2)}
                </p>
              </div>
              <form onSubmit={handleVerifyOtp} className="space-y-4">
                <Input
                  type="text"
                  inputMode="numeric"
                  maxLength={4}
                  value={otp}
                  onChange={(e) =>
                    setOtp(e.target.value.replace(/\D/g, "").slice(0, 4))
                  }
                  className="h-14 rounded-xl border-slate-700 bg-slate-950 text-center text-2xl font-mono tracking-[0.5em] text-white"
                  placeholder="• • • •"
                  autoFocus
                />
                {error && <p className="text-sm text-red-400">{error}</p>}
                <Button
                  type="submit"
                  disabled={loading}
                  className="h-11 w-full rounded-xl bg-violet-600 hover:bg-violet-700"
                >
                  {loading ? "Verifying…" : "Verify code"}
                </Button>
              </form>
              <p className="mt-4 text-center text-[11px] text-slate-500">
                Demo: any 4-digit code works (except 0000)
              </p>
            </>
          )}

          {/* Step 3: Set new PIN */}
          {step === "new-pin" && (
            <>
              <div className="mb-6 text-center">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/15">
                  <KeyRound className="h-7 w-7 text-emerald-400" />
                </div>
                <h1 className="text-xl font-semibold text-white">
                  Set new PIN
                </h1>
                <p className="mt-2 text-sm text-slate-400">
                  Choose a new 4-digit PIN for your staff login
                </p>
              </div>
              <form onSubmit={handleSetNewPin} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300">
                    New PIN
                  </label>
                  <Input
                    type="password"
                    inputMode="numeric"
                    maxLength={4}
                    value={newPin}
                    onChange={(e) =>
                      setNewPin(e.target.value.replace(/\D/g, "").slice(0, 4))
                    }
                    className="h-12 rounded-xl border-slate-700 bg-slate-950 text-center text-xl font-mono tracking-[0.4em] text-white"
                    placeholder="• • • •"
                    autoFocus
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300">
                    Confirm PIN
                  </label>
                  <Input
                    type="password"
                    inputMode="numeric"
                    maxLength={4}
                    value={confirmPin}
                    onChange={(e) =>
                      setConfirmPin(
                        e.target.value.replace(/\D/g, "").slice(0, 4),
                      )
                    }
                    className="h-12 rounded-xl border-slate-700 bg-slate-950 text-center text-xl font-mono tracking-[0.4em] text-white"
                    placeholder="• • • •"
                  />
                </div>
                {error && <p className="text-sm text-red-400">{error}</p>}
                <Button
                  type="submit"
                  disabled={loading}
                  className="h-11 w-full rounded-xl bg-emerald-600 hover:bg-emerald-700"
                >
                  {loading ? "Saving…" : "Save new PIN"}
                </Button>
              </form>
              <p className="mt-4 text-center text-[11px] text-slate-500">
                Avoid simple PINs like 0000 or 1111.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
