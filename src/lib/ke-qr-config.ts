import { useEffect, useState } from "react";

export type KeQrConfig = {
  pspId: string | null;
  mcc: string | null;
  city: string | null;
};

const EMPTY: KeQrConfig = { pspId: null, mcc: null, city: null };

// The KE-QR scheme config is platform-global and public (a PSP/merchant id set by
// an admin), so it's fetched once and shared across every PaymentQr instance.
let cache: KeQrConfig | null = null;
let inflight: Promise<KeQrConfig> | null = null;

export async function loadKeQrConfig(): Promise<KeQrConfig> {
  if (cache) return cache;
  if (typeof fetch === "undefined") return EMPTY;
  if (!inflight) {
    inflight = fetch("/api/ke-qr-config")
      .then((r) => (r.ok ? (r.json() as Promise<KeQrConfig>) : EMPTY))
      .then((c) => {
        cache = { pspId: c.pspId ?? null, mcc: c.mcc ?? null, city: c.city ?? null };
        return cache;
      })
      .catch(() => EMPTY);
  }
  return inflight;
}

// Reset the module cache (e.g. after an admin saves a new PSP id).
export function clearKeQrConfigCache(): void {
  cache = null;
  inflight = null;
}

export function useKeQrConfig(): KeQrConfig {
  const [cfg, setCfg] = useState<KeQrConfig>(cache ?? EMPTY);
  useEffect(() => {
    let mounted = true;
    void loadKeQrConfig().then((c) => {
      if (mounted) setCfg(c);
    });
    return () => {
      mounted = false;
    };
  }, []);
  return cfg;
}
