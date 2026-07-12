import { useEffect, useState } from "react";

import { authFetch } from "@/lib/auth";

type Summary = {
  gross: number;
  fees: number;
  net: number;
  effectiveRate: number;
  count: number;
};

const kes = (m: number) =>
  `KES ${(m / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

// Compact fee-transparency card for the mobile app: the real blended rate the
// merchant paid over the last 30 days, plus gross/fees/net. Renders nothing until
// there's settled volume.
export function FeeCard() {
  const [s, setS] = useState<Summary | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      authFetch("/api/fees/summary?days=30")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!cancelled) setS(d as Summary);
        })
        .catch(() => {});
    load();
    // Refresh when the logged-in venue changes (launch/adopt token).
    window.addEventListener("pesaswap:auth-changed", load);
    return () => {
      cancelled = true;
      window.removeEventListener("pesaswap:auth-changed", load);
    };
  }, []);

  if (!s || s.count === 0) return null;

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            Effective fee rate · 30d
          </p>
          <p className="text-2xl font-bold font-mono">
            {s.effectiveRate.toFixed(2)}%
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] text-muted-foreground">Fees paid</p>
          <p className="text-sm font-semibold font-mono text-amber-600">
            {kes(s.fees)}
          </p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-border/60 text-center">
        <div>
          <p className="text-[10px] text-muted-foreground">Gross</p>
          <p className="text-sm font-mono font-semibold">{kes(s.gross)}</p>
        </div>
        <div>
          <p className="text-[10px] text-muted-foreground">Net kept</p>
          <p className="text-sm font-mono font-semibold text-emerald-600">
            {kes(s.net)}
          </p>
        </div>
      </div>
    </div>
  );
}
