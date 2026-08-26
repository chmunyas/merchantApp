import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, KeyRound, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/reset-pin")({
  component: ResetPinPage,
});

function ResetPinPage() {
  const navigate = useNavigate();
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 p-4 text-white">
      <Button
        variant="ghost"
        className="absolute left-4 top-4 text-slate-400 hover:text-white"
        onClick={() => void navigate({ to: "/staff-login" })}
      >
        <ArrowLeft className="mr-1 h-4 w-4" /> Back
      </Button>
      <section className="w-full max-w-sm rounded-2xl border border-slate-800 bg-slate-900 p-8 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-violet-500/15">
          <KeyRound className="h-8 w-8 text-violet-400" />
        </div>
        <h1 className="mt-5 text-xl font-semibold">Reset your staff PIN</h1>
        <p className="mt-3 text-sm leading-6 text-slate-400">
          For security, PINs are never displayed or reset from browser data. Ask
          your venue manager to issue a new 6–8 digit PIN from the staff settings.
        </p>
        <div className="mt-6 flex items-start gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-left">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
          <p className="text-xs leading-5 text-emerald-100">
            The previous credential and all staff sessions are revoked when a
            manager rotates the PIN.
          </p>
        </div>
        <Button
          className="mt-6 w-full bg-violet-600 hover:bg-violet-700"
          onClick={() => void navigate({ to: "/staff-login" })}
        >
          Return to staff sign-in
        </Button>
      </section>
    </main>
  );
}
