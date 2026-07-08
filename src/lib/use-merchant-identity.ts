import { useEffect, useState } from "react";

import { getMerchantIdentity } from "@/lib/merchant-dashboard";
import { MERCHANT_NAME, TILL_NUMBER } from "@/components/merchant/features/utils";

export type MerchantIdentity = { name: string; till: string };

// The current tenant's public identity (business name + till) for POS / KE-QR /
// receipts. Initialises to the demo constants so SSR + the first client render
// match (no hydration mismatch), then resolves the real per-venue identity after
// mount and re-reads whenever auth/venue changes.
export function useMerchantIdentity(): MerchantIdentity {
  const [identity, setIdentity] = useState<MerchantIdentity>({
    name: MERCHANT_NAME,
    till: TILL_NUMBER,
  });

  useEffect(() => {
    const sync = () => setIdentity(getMerchantIdentity());
    sync();
    window.addEventListener("pesaswap:auth-changed", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("pesaswap:auth-changed", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  return identity;
}
