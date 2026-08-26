import { decodeTokenClaims } from "@/lib/auth";
import type { PaymentLedgerRow } from "@/lib/payment-ledger";
import { useAuthQuery } from "@/lib/use-auth-query";

export function usePaymentLedger(limit = 100) {
  const claims = decodeTokenClaims();
  const enabled =
    Boolean(claims?.venue && claims.venue !== "main") &&
    ["manager", "merchant"].includes(String(claims?.role ?? ""));

  return useAuthQuery<{ payments: PaymentLedgerRow[] }, PaymentLedgerRow[]>(
    ["payments-list", limit],
    `/api/payments/list?limit=${limit}`,
    {
      enabled,
      select: (data) => data.payments ?? [],
      refetchInterval: enabled ? 15_000 : false,
    },
  );
}
