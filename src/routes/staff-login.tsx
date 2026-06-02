import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Delete, Lock } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { getDemoStaffByPin, setStaffSession } from "@/lib/auth";

export const Route = createFileRoute("/staff-login")({
  component: StaffLoginPage,
});

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

function StaffLoginPage() {
  const navigate = useNavigate();
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [shake, setShake] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [countdown, setCountdown] = useState("");

  const isLocked = lockedUntil !== null && Date.now() < lockedUntil;

  // Countdown timer
  useEffect(() => {
    if (!lockedUntil) return;
    const tick = () => {
      const remaining = lockedUntil - Date.now();
      if (remaining <= 0) {
        setLockedUntil(null);
        setAttempts(0);
        setCountdown("");
        return;
      }
      const mins = Math.floor(remaining / 60000);
      const secs = Math.floor((remaining % 60000) / 1000);
      setCountdown(`${mins}:${secs.toString().padStart(2, "0")}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [lockedUntil]);

  const verifyPin = useCallback(
    (fullPin: string) => {
      const staffUser = getDemoStaffByPin(fullPin);
      if (staffUser) {
        setStaffSession(staffUser);
        void navigate({ to: "/dashboard" });
      } else {
        const newAttempts = attempts + 1;
        setAttempts(newAttempts);
        setError("Incorrect PIN");
        setShake(true);
        setTimeout(() => {
          setShake(false);
          setPin("");
          setError("");
        }, 1500);

        if (newAttempts >= MAX_ATTEMPTS) {
          setLockedUntil(Date.now() + LOCKOUT_MS);
          setPin("");
        }
      }
    },
    [attempts, navigate],
  );

  const addDigit = useCallback(
    (digit: string) => {
      if (isLocked) return;
      if (pin.length >= 4) return;
      const newPin = pin + digit;
      setPin(newPin);
      setError("");
      if (newPin.length === 4) {
        setTimeout(() => verifyPin(newPin), 200);
      }
    },
    [pin, isLocked, verifyPin],
  );

  const removeDigit = useCallback(() => {
    setPin((p) => p.slice(0, -1));
    setError("");
  }, []);

  // Keyboard support
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key >= "0" && e.key <= "9") addDigit(e.key);
      else if (e.key === "Backspace") removeDigit();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [addDigit, removeDigit]);

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
          <p className="mt-1 text-sm text-slate-400">Enter your 4-digit PIN</p>
        </div>

        {/* PIN dots */}
        <div
          className={`mb-8 flex items-center justify-center gap-4 ${shake ? "animate-shake" : ""}`}
        >
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className={`h-5 w-5 rounded-full border-2 transition-all ${
                i < pin.length
                  ? "border-violet-400 bg-violet-400 scale-110"
                  : "border-slate-600 bg-transparent"
              }`}
            />
          ))}
        </div>

        {/* Error / Lockout message */}
        {isLocked && (
          <div className="mb-6 rounded-xl bg-red-500/10 border border-red-500/30 p-3">
            <p className="text-sm font-medium text-red-400">
              Too many attempts
            </p>
            <p className="text-xs text-red-400/70">Try again in {countdown}</p>
          </div>
        )}
        {error && !isLocked && (
          <p className="mb-4 text-sm font-medium text-red-400">{error}</p>
        )}
        {attempts > 0 && attempts < MAX_ATTEMPTS && !isLocked && (
          <p className="mb-4 text-xs text-slate-500">
            {MAX_ATTEMPTS - attempts} attempt
            {MAX_ATTEMPTS - attempts !== 1 ? "s" : ""} remaining
          </p>
        )}

        {/* Number pad */}
        <div className="mx-auto grid max-w-[280px] grid-cols-3 gap-3">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"].map(
            (key) => {
              if (key === "") return <div key="empty" />;
              if (key === "del") {
                return (
                  <button
                    key="del"
                    onClick={removeDigit}
                    disabled={isLocked || pin.length === 0}
                    className="flex h-[72px] w-[72px] items-center justify-center rounded-2xl text-slate-400 transition hover:bg-slate-800 active:bg-slate-700 disabled:opacity-30"
                  >
                    <Delete className="h-6 w-6" />
                  </button>
                );
              }
              return (
                <button
                  key={key}
                  onClick={() => addDigit(key)}
                  disabled={isLocked}
                  className="flex h-[72px] w-[72px] items-center justify-center rounded-2xl bg-slate-900 text-2xl font-medium text-white transition hover:bg-slate-800 active:bg-slate-700 active:scale-95 disabled:opacity-30"
                >
                  {key}
                </button>
              );
            },
          )}
        </div>

        {/* Hint & Forgot PIN */}
        <div className="mt-8 space-y-2">
          <p className="text-xs text-slate-600">
            Demo PIN: <span className="font-mono text-slate-400">1234</span>
          </p>
          <button
            onClick={() => void navigate({ to: "/reset-pin" })}
            className="text-xs text-violet-400 hover:text-violet-300 hover:underline transition"
          >
            Forgot your PIN?
          </button>
        </div>
      </div>

      {/* Shake animation */}
      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-8px); }
          40% { transform: translateX(8px); }
          60% { transform: translateX(-4px); }
          80% { transform: translateX(4px); }
        }
        .animate-shake { animation: shake 0.4s ease-in-out; }
      `}</style>
    </div>
  );
}
