const wallets = [
  { code: "USD", balance: "$1,420,500.00", change: "+0.12% Today", tone: "accent", dot: "bg-blue-100" },
  { code: "EUR", balance: "â¬892,100.22", change: "Locked for swap", tone: "muted", dot: "bg-indigo-100" },
  { code: "GBP", balance: "Â£560,000.00", change: "-2.4% Weekly", tone: "negative", dot: "bg-stone-200" },
  { code: "NGN", balance: "â¦12.4M", change: "Active yield", tone: "accent", dot: "bg-emerald-100", highlight: true },
];

export function WalletsGrid() {
  return (
    <section className="animate-slide-up">
      <div className="flex justify-between items-end mb-4">
        <h2 className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
          Global Balances
        </h2>
        <button className="text-xs font-medium text-muted-foreground hover:text-foreground underline underline-offset-4">
          Manage Currencies
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {wallets.map((w) => (
          <div
            key={w.code}
            className={`p-5 bg-card border border-border rounded-xl ring-1 ring-border ${
              w.highlight
                ? "bg-[radial-gradient(ellipse_at_top_right,var(--color-accent)/8%,transparent)]"
                : ""
            }`}
          >
            <div className="flex justify-between mb-4">
              <span className="font-mono text-xs text-muted-foreground">{w.code}</span>
              <div className={`size-6 rounded-full ${w.dot}`} />
            </div>
            <div className="text-2xl font-bold tracking-tight">{w.balance}</div>
            <div
              className={`text-[10px] font-mono mt-1 ${
                w.tone === "accent"
                  ? "text-accent"
                  : w.tone === "negative"
                  ? "text-destructive"
                  : "text-muted-foreground"
              }`}
            >
              {w.change}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

