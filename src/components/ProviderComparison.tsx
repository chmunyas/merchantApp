const providers = [
  {
    code: "W",
    name: "Wise",
    detail: "Fee: $4.50 â¢ Arrival: Instant",
    rate: "0.9244",
    total: "â¬92,435.50 total",
    best: true,
    bg: "bg-indigo-600",
    fg: "text-white",
  },
  {
    code: "CC",
    name: "Currencycloud",
    detail: "Fee: $0.00 â¢ Arrival: 1-2 Days",
    rate: "0.9221",
    total: "â¬92,210.00 total",
    bg: "bg-muted border border-border",
    fg: "text-foreground",
  },
  {
    code: "LX",
    name: "LMAX Prime",
    detail: "Institutional Spread â¢ Arrival: T+0",
    rate: "0.9218",
    total: "â¬92,180.10 total",
    bg: "bg-muted border border-border",
    fg: "text-foreground font-mono text-xs",
  },
  {
    code: "VR",
    name: "Verto",
    detail: "Fee: $2.10 â¢ Arrival: Same day",
    rate: "0.9209",
    total: "â¬92,090.00 total",
    bg: "bg-muted border border-border",
    fg: "text-foreground",
  },
];

export function ProviderComparison() {
  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center px-2">
        <h3 className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
          Provider Comparison
        </h3>
        <span className="text-[10px] text-muted-foreground italic">
          Real-time mid-market: 0.9244
        </span>
      </div>

      <div className="space-y-2">
        {providers.map((p) => (
          <div
            key={p.name}
            className={`p-4 bg-card rounded-xl flex items-center justify-between cursor-pointer relative overflow-hidden transition-colors ${
              p.best
                ? "border-2 border-accent"
                : "border border-border hover:border-muted-foreground/40"
            }`}
          >
            {p.best && (
              <div className="absolute top-0 right-0 bg-accent text-accent-foreground px-3 py-1 text-[9px] font-bold uppercase tracking-widest rounded-bl-lg">
                Best Rate
              </div>
            )}
            <div className="flex items-center gap-4">
              <div
                className={`size-10 ${p.bg} rounded-lg flex items-center justify-center font-bold ${p.fg}`}
              >
                {p.code}
              </div>
              <div>
                <p className="font-bold text-sm">{p.name}</p>
                <p className="text-[10px] font-mono text-muted-foreground">{p.detail}</p>
              </div>
            </div>
            <div className="text-right">
              <p className="font-mono font-bold text-lg">{p.rate}</p>
              <p
                className={`text-[10px] font-mono ${
                  p.best ? "text-accent" : "text-muted-foreground"
                }`}
              >
                {p.total}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

