import { useEffect, useState } from "react";

export type PaymentConfig = {
  testMode: boolean;
  loaded: boolean;
};

export function usePaymentConfig(): PaymentConfig {
  const [config, setConfig] = useState<PaymentConfig>({
    testMode: false,
    loaded: false,
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/payments/config");
        if (!response.ok) throw new Error("payment config unavailable");
        const data = (await response.json()) as { testMode?: boolean };
        if (!cancelled) {
          setConfig({ testMode: data.testMode === true, loaded: true });
        }
      } catch {
        if (!cancelled) setConfig({ testMode: false, loaded: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return config;
}
