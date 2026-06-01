import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Landmark,
  Loader2,
  Lock,
  ShieldCheck,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import type { BNPLTransaction } from "@/lib/coop-bnpl";
import {
  calculateMonthlyPayment,
  checkEligibility,
  getBNPLTransactions,
  initiateBNPL,
  isValidNationalId,
  verifyBNPLOtp,
} from "@/lib/coop-bnpl";
import { cn } from "@/lib/utils";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type BNPLCheckoutProps = {
  amount: number;
  currency?: string;
  orderId: string;
  merchantId?: string;
  description: string;
  onSuccess: (transaction: BNPLTransaction) => void;
  onCancel: () => void;
};

type CheckoutStep = "entry" | "result" | "otp" | "success";

const COOP_BLUE = "#003DA5";

function formatCurrency(amount: number, currency: string) {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

function roundAmount(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function maskId(value: string) {
  return value.length <= 4 ? value : `****${value.slice(-4)}`;
}

async function runWithTimeout<T>(promise: Promise<T>, timeoutMs = 10000) {
  return await Promise.race<T>([
    promise,
    new Promise<T>((_, reject) => {
      window.setTimeout(() => {
        reject(new Error("Co-op Bank request timed out. Please try again."));
      }, timeoutMs);
    }),
  ]);
}

export function BNPLCheckout({
  amount,
  currency = "KES",
  orderId,
  merchantId,
  description,
  onSuccess,
  onCancel,
}: BNPLCheckoutProps) {
  const [step, setStep] = useState<CheckoutStep>("entry");
  const [nationalId, setNationalId] = useState("");
  const [consent, setConsent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [eligibility, setEligibility] = useState<Awaited<
    ReturnType<typeof checkEligibility>
  > | null>(null);
  const [selectedTenure, setSelectedTenure] = useState(30);
  const [transactionId, setTransactionId] = useState("");
  const [otpPhone, setOtpPhone] = useState("");
  const [otpDigits, setOtpDigits] = useState(["", "", "", "", "", ""]);
  const [resendCountdown, setResendCountdown] = useState(30);
  const [approvedTransaction, setApprovedTransaction] =
    useState<BNPLTransaction | null>(null);
  const otpRefs = useRef<Array<HTMLInputElement | null>>([]);

  const interestRate = eligibility?.interestRate ?? 0;
  const interestAmount = useMemo(
    () => roundAmount(amount * (interestRate / 100)),
    [amount, interestRate],
  );
  const totalPayable = useMemo(
    () => roundAmount(amount + interestAmount),
    [amount, interestAmount],
  );
  const monthlyPayment = useMemo(
    () => calculateMonthlyPayment(amount, selectedTenure, interestRate),
    [amount, selectedTenure, interestRate],
  );

  useEffect(() => {
    if (step !== "otp" || resendCountdown <= 0) return;
    const timer = window.setTimeout(() => {
      setResendCountdown((current) => current - 1);
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [resendCountdown, step]);

  useEffect(() => {
    if (step !== "otp") return;
    otpRefs.current[0]?.focus();
  }, [step]);

  async function handleCheckEligibility() {
    const cleanId = nationalId.replace(/\D/g, "").slice(0, 8);
    if (!isValidNationalId(cleanId)) {
      setError("Enter a valid 8-digit Kenyan National ID.");
      return;
    }
    if (!consent) {
      setError("Consent is required before checking BNPL eligibility.");
      return;
    }

    try {
      setLoading(true);
      setError("");
      const response = await runWithTimeout(
        checkEligibility({ amount, merchantId, nationalId: cleanId }),
      );
      setEligibility(response);
      setSelectedTenure(response.tenure[0] ?? 30);
      setStep("result");
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to reach Co-op Bank right now.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirmBnpl() {
    if (!eligibility?.eligible) return;

    try {
      setLoading(true);
      setError("");
      const response = await runWithTimeout(
        initiateBNPL({
          amount,
          description,
          merchantId: merchantId ?? "fx-engine-demo",
          nationalId,
          orderId,
          tenure: selectedTenure,
        }),
      );

      if (response.status !== "otp_sent") {
        setError("Co-op Bank could not issue an OTP for this request.");
        return;
      }

      setTransactionId(response.transactionId);
      setOtpPhone(response.otpPhone);
      setOtpDigits(["", "", "", "", "", ""]);
      setResendCountdown(30);
      setStep("otp");
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to initiate BNPL right now.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyOtp() {
    const code = otpDigits.join("").trim();
    if (code.length < 4) {
      setError("Enter the OTP sent by Co-op Bank.");
      return;
    }

    try {
      setLoading(true);
      setError("");
      const response = await runWithTimeout(verifyBNPLOtp(transactionId, code));

      if (response.status !== "approved") {
        setError(
          response.status === "expired"
            ? "This OTP session expired. Please request a new one."
            : "OTP verification failed. Use demo code 1234.",
        );
        return;
      }

      const savedTransaction = getBNPLTransactions().find(
        (entry) => entry.id === transactionId,
      );
      if (!savedTransaction) {
        setError(
          "BNPL approval was recorded, but details could not be loaded.",
        );
        return;
      }

      setApprovedTransaction(savedTransaction);
      setStep("success");
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to verify the OTP right now.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleResendOtp() {
    if (resendCountdown > 0 || !eligibility?.eligible) return;
    await handleConfirmBnpl();
  }

  function updateOtpDigit(index: number, value: string) {
    const digit = value.replace(/\D/g, "").slice(-1);
    setOtpDigits((current) => {
      const next = [...current];
      next[index] = digit;
      return next;
    });
    if (digit && index < otpRefs.current.length - 1) {
      otpRefs.current[index + 1]?.focus();
    }
  }

  function handleOtpKeyDown(
    event: KeyboardEvent<HTMLInputElement>,
    index: number,
  ) {
    if (event.key === "Backspace" && !otpDigits[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  }

  return (
    <div className="overflow-hidden rounded-3xl border border-[#003DA5]/15 bg-white text-slate-900 shadow-sm transition-all duration-300">
      <div className="border-b border-slate-100 bg-[linear-gradient(135deg,#003DA5_0%,#0f4cc7_100%)] p-5 text-white">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="border-white/15 bg-white/15 text-white hover:bg-white/15">
                Powered by Co-operative Bank
              </Badge>
              <Badge className="border-white/15 bg-white/10 text-white hover:bg-white/10">
                Regulated by CBK
              </Badge>
            </div>
            <h3 className="mt-3 text-xl font-semibold">
              Buy Now, Pay Later with Co-operative Bank
            </h3>
            <p className="mt-1 text-sm text-blue-100">
              Fast credit approval for Kenyan shoppers with clear repayment
              terms.
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            className="rounded-full bg-white/10 text-white hover:bg-white/20"
            onClick={onCancel}
          >
            Cancel
          </Button>
        </div>
      </div>

      <div className="space-y-5 p-5">
        <div className="flex flex-wrap items-center gap-3 text-xs font-medium text-slate-600">
          <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1">
            <ShieldCheck className="h-4 w-4 text-[#003DA5]" /> Secure credit
            check
          </div>
          <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1">
            <Landmark className="h-4 w-4 text-[#003DA5]" /> CBK regulated lender
          </div>
        </div>

        {error ? (
          <div className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            <AlertTriangle className="mt-0.5 h-4 w-4" />
            <span>{error}</span>
          </div>
        ) : null}

        {step === "entry" ? (
          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <label className="block text-sm font-medium text-slate-700">
                National ID number
                <div className="relative mt-2">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    value={nationalId}
                    onChange={(event) =>
                      setNationalId(
                        event.target.value.replace(/\D/g, "").slice(0, 8),
                      )
                    }
                    placeholder="Enter 8-digit ID"
                    inputMode="numeric"
                    className="h-12 rounded-2xl border-slate-200 bg-white pl-10 text-base"
                  />
                </div>
              </label>
              <label className="mt-4 flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-3 text-sm text-slate-700">
                <input
                  checked={consent}
                  onChange={(event) => setConsent(event.target.checked)}
                  type="checkbox"
                  className="mt-1 h-4 w-4 rounded border-slate-300 text-[#003DA5]"
                />
                <span>
                  I consent to a Co-op Bank BNPL credit check for this purchase.
                </span>
              </label>
              <p className="mt-3 text-xs leading-5 text-slate-500">
                By continuing, you consent to processing under the Kenya Data
                Protection Act and Co-operative Bank credit assessment policies.
              </p>
            </div>

            <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">
              <div className="flex items-center justify-between">
                <span>Purchase amount</span>
                <span className="font-semibold text-slate-900">
                  {formatCurrency(amount, currency)}
                </span>
              </div>
            </div>

            <Button
              type="button"
              className="h-12 w-full rounded-2xl text-white"
              style={{ backgroundColor: COOP_BLUE }}
              onClick={handleCheckEligibility}
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Checking
                  eligibility…
                </>
              ) : (
                "Check Eligibility"
              )}
            </Button>
          </div>
        ) : null}

        {step === "result" && eligibility ? (
          <div className="space-y-4">
            {eligibility.eligible ? (
              <>
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">
                        Approved! ✓
                      </Badge>
                      <h4 className="mt-3 text-lg font-semibold text-emerald-900">
                        {eligibility.customerName}
                      </h4>
                      <p className="mt-1 text-sm text-emerald-800">
                        National ID {maskId(nationalId)} · Phone{" "}
                        {eligibility.phone}
                      </p>
                    </div>
                    <CheckCircle2 className="h-8 w-8 text-emerald-600" />
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl bg-white p-3">
                      <p className="text-xs uppercase tracking-wide text-slate-500">
                        Available limit
                      </p>
                      <p className="mt-1 text-lg font-semibold text-slate-900">
                        {formatCurrency(
                          eligibility.availableLimit ?? 0,
                          currency,
                        )}
                      </p>
                    </div>
                    <div className="rounded-2xl bg-white p-3">
                      <p className="text-xs uppercase tracking-wide text-slate-500">
                        Purchase amount
                      </p>
                      <p className="mt-1 text-lg font-semibold text-slate-900">
                        {formatCurrency(amount, currency)}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 p-4">
                  <p className="text-sm font-semibold text-slate-900">
                    Choose your tenure
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {eligibility.tenure.map((tenure) => (
                      <button
                        key={tenure}
                        type="button"
                        onClick={() => setSelectedTenure(tenure)}
                        className={cn(
                          "rounded-full border px-4 py-2 text-sm font-medium transition",
                          selectedTenure === tenure
                            ? "border-transparent text-white"
                            : "border-slate-200 bg-white text-slate-700",
                        )}
                        style={
                          selectedTenure === tenure
                            ? { backgroundColor: COOP_BLUE }
                            : undefined
                        }
                      >
                        {tenure} days
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-sm font-semibold text-slate-900">
                    Payment breakdown
                  </p>
                  <div className="mt-3 space-y-2 text-sm text-slate-600">
                    <div className="flex items-center justify-between">
                      <span>Purchase amount</span>
                      <span>{formatCurrency(amount, currency)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Interest ({interestRate}%)</span>
                      <span>{formatCurrency(interestAmount, currency)}</span>
                    </div>
                    <div className="flex items-center justify-between font-medium text-slate-900">
                      <span>Total payable</span>
                      <span>{formatCurrency(totalPayable, currency)}</span>
                    </div>
                    <div className="flex items-center justify-between text-slate-900">
                      <span>Monthly payment</span>
                      <span>{formatCurrency(monthlyPayment, currency)}</span>
                    </div>
                  </div>
                </div>

                <Button
                  type="button"
                  className="h-12 w-full rounded-2xl text-white"
                  style={{ backgroundColor: COOP_BLUE }}
                  onClick={handleConfirmBnpl}
                  disabled={loading}
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Sending OTP…
                    </>
                  ) : (
                    "Confirm & Pay Later"
                  )}
                </Button>
              </>
            ) : (
              <div className="space-y-4 rounded-2xl border border-amber-200 bg-amber-50 p-5">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-600" />
                  <div>
                    <h4 className="font-semibold text-amber-900">
                      Not eligible for BNPL at this time
                    </h4>
                    <p className="mt-1 text-sm text-amber-800">
                      {eligibility.reason ||
                        "Please use another payment method for now."}
                    </p>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 rounded-2xl"
                  onClick={onCancel}
                >
                  Try another method
                </Button>
              </div>
            )}
          </div>
        ) : null}

        {step === "otp" ? (
          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-start gap-3">
                <Building2 className="mt-0.5 h-5 w-5 text-[#003DA5]" />
                <div>
                  <h4 className="font-semibold text-slate-900">Verify OTP</h4>
                  <p className="mt-1 text-sm text-slate-600">
                    Enter the OTP sent to {otpPhone}.
                  </p>
                  <p className="mt-2 text-xs text-slate-500">Demo: use 1234</p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-6 gap-2">
              {otpDigits.map((digit, index) => (
                <input
                  key={`otp-${index}`}
                  ref={(element) => {
                    otpRefs.current[index] = element;
                  }}
                  value={digit}
                  onChange={(event) =>
                    updateOtpDigit(index, event.target.value)
                  }
                  onKeyDown={(event) => handleOtpKeyDown(event, index)}
                  inputMode="numeric"
                  maxLength={1}
                  className="h-12 rounded-2xl border border-slate-200 text-center text-lg font-semibold outline-none transition focus:border-[#003DA5] focus:ring-2 focus:ring-[#003DA5]/20"
                />
              ))}
            </div>

            <Button
              type="button"
              className="h-12 w-full rounded-2xl text-white"
              style={{ backgroundColor: COOP_BLUE }}
              onClick={handleVerifyOtp}
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Verifying…
                </>
              ) : (
                "Verify"
              )}
            </Button>

            <div className="text-center text-sm text-slate-500">
              Didn&apos;t receive it?{" "}
              <button
                type="button"
                onClick={() => {
                  void handleResendOtp();
                }}
                disabled={resendCountdown > 0 || loading}
                className="font-medium text-[#003DA5] disabled:text-slate-400"
              >
                {resendCountdown > 0
                  ? `Resend in ${resendCountdown}s`
                  : "Resend OTP"}
              </button>
            </div>
          </div>
        ) : null}

        {step === "success" && approvedTransaction ? (
          <div className="space-y-4 text-center">
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
              <CheckCircle2 className="h-12 w-12 animate-pulse" />
            </div>
            <div>
              <h4 className="text-2xl font-semibold text-slate-900">
                Payment approved!
              </h4>
              <p className="mt-2 text-sm text-slate-600">
                {formatCurrency(amount, currency)} — Pay{" "}
                {formatCurrency(approvedTransaction.monthlyPayment, currency)}
                /month for {approvedTransaction.tenure} days.
              </p>
              <p className="mt-2 text-sm text-slate-500">
                Merchant will be paid by Co-op Bank within 24 hours.
              </p>
            </div>
            <div className="rounded-2xl bg-slate-50 p-4 text-left text-sm text-slate-600">
              <div className="flex items-center justify-between">
                <span>Customer</span>
                <span>{approvedTransaction.customerName}</span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span>Co-op reference</span>
                <span>{approvedTransaction.coopReference || "Pending"}</span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span>Total payable</span>
                <span>
                  {formatCurrency(approvedTransaction.totalPayable, currency)}
                </span>
              </div>
            </div>
            <Button
              type="button"
              className="h-12 w-full rounded-2xl text-white"
              style={{ backgroundColor: COOP_BLUE }}
              onClick={() => onSuccess(approvedTransaction)}
            >
              Done
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
