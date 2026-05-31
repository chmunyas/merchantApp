import { useMemo, useState } from "react";
import { ArrowDown } from "lucide-react";

const rates: Record<string, number> = {
  "USD-EUR": 0.9244,
  "USD-GBP": 0.7842,
  "USD-NGN": 1580,
  "EUR-USD": 1.0815,
  "EUR-GBP": 0.848,
  "GBP-USD": 1.275,
};

export function QuickExchange() {
  const [sell, setSell] = useState("100000");
  const [from, setFrom] = useState("USD");
  const [to, setTo] = useState("EUR");

  const rate = rates[`${from}-${to}`] ?? 1;
  const receive = useMemo(() => {
    const n = Number(sell.replace(/,/g, "")) || 0;
    return (n * rate).toLocaleString("en-US", { maximumFractionDigits: 2 });
  }, [sell, rate]);

  const swap = () => {
    setFrom(to);
    setTo(from);
  };

  return (
    <div className="bg-card border border-border rounded-2xl p-6 ring-1 ring-border">
      <h3 className="text-sm font-bold mb-6">Quick Exchange</h3>
      <div className="space-y-4">
        <div>
          <label className="block text-[10px] font-mono uppercase text-muted-foreground mb-2">
            You Sell
          </label>
          <div className="flex items-center border border-border rounded-lg p-3 focus-within:ring-1 focus-within:ring-ring/40">
            <input
              value={sell}
              onChange={(e) => setSell(e.target.value)}
              className="bg-transparent outline-none font-bold text-lg w-full"
            />
            <select
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="font-mono text-xs font-bold bg-transparent outline-none cursor-pointer"
            >
              <option>USD</option>
              <option>EUR</option>
              <option>GBP</option>
            </select>
          </div>
        </div>

        <div className="flex justify-center -my-2">
          <button
            onClick={swap}
            className="size-8 bg-foreground text-background rounded-full flex items-center justify-center z-10 border-4 border-card hover:scale-105 transition-transform"
            aria-label="Swap currencies"
          >
            <ArrowDown className="size-3.5" />
          </button>
        </div>

        <div>
          <label className="block text-[10px] font-mono uppercase text-muted-foreground mb-2">
            You Receive
          </label>
          <div className="flex items-center border border-border rounded-lg p-3 bg-muted">
            <input
              value={receive}
              readOnly
              className="bg-transparent outline-none font-bold text-lg w-full"
            />
            <select
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="font-mono text-xs font-bold bg-transparent outline-none cursor-pointer"
            >
              <option>EUR</option>
              <option>USD</option>
              <option>GBP</option>
              <option>NGN</option>
            </select>
          </div>
        </div>

        <button className="w-full py-4 bg-foreground text-background rounded-xl font-bold text-sm tracking-wide mt-2 hover:opacity-90 transition-opacity">
          Execute Best Rate
        </button>
        <p className="text-[10px] font-mono text-center text-muted-foreground">
          Rate locked for 54s
        </p>
      </div>
    </div>
  );
}

