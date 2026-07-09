// Settlement partner panel - Coop Bank Kenya (replaces the multi-provider FX
// comparison). Funds settle directly to the merchant's Co-operative Bank account.
export function ProviderComparison() {
  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center px-2">
        <h3 className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
          Settlement - Coop Bank Kenya
        </h3>
        <span className="text-[10px] text-muted-foreground italic">
          Direct to your Co-operative Bank account
        </span>
      </div>

      <div className="p-4 bg-card rounded-xl flex items-center justify-between relative overflow-hidden border-2 border-accent">
        <div className="absolute top-0 right-0 bg-accent text-accent-foreground px-3 py-1 text-[9px] font-bold uppercase tracking-widest rounded-bl-lg">
          Settlement partner
        </div>
        <div className="flex items-center gap-4">
          <div className="size-10 bg-emerald-600 rounded-lg flex items-center justify-center font-bold text-white">
            CB
          </div>
          <div>
            <p className="font-bold text-sm">Coop Bank Kenya</p>
            <p className="text-[10px] font-mono text-muted-foreground">
              Fee: KES 0 - Arrival: Instant
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className="font-mono font-bold text-lg">Instant</p>
          <p className="text-[10px] font-mono text-accent">
            Settled to your Co-op account
          </p>
        </div>
      </div>
    </div>
  );
}
