import { usePaymentConfig } from "@/lib/use-payment-config";

// A small, non-blocking indicator shown only on the sandbox deployment (where
// payments are simulated). It reads the server's payment mode so the same build
// can serve both production (live M-Pesa) and sandbox (test) without a rebuild.
export function SandboxBadge() {
  const { testMode } = usePaymentConfig();

  if (!testMode) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex justify-center"
      aria-label="Sandbox environment — payments are simulated"
    >
      <div className="mt-1 rounded-full border border-amber-300 bg-amber-100/95 px-3 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-amber-800 shadow-sm backdrop-blur">
        Sandbox · test payments — no real money
      </div>
    </div>
  );
}
