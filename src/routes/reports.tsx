import { createFileRoute } from "@tanstack/react-router";
import { TopHeader } from "@/components/TopHeader";

const stats = [
  { label: "FX Volume (30d)", value: "$8.42M", delta: "+12.4%", tone: "accent" },
  { label: "Avg. Spread Saved", value: "0.18%", delta: "vs benchmark", tone: "muted" },
  { label: "Settled Trades", value: "1,284", delta: "+82 this week", tone: "accent" },
  { label: "Pending Settlements", value: "12", delta: "$240k notional", tone: "muted" },
];

export const Route = createFileRoute("/reports")({
  head: () => ({
    meta: [
      { title: "Reports — PesaSwap" },
      { name: "description", content: "Treasury performance, FX volume and provider savings." },
    ],
  }),
  component: ReportsPage,
});

function ReportsPage() {
  return (
    <>
      <TopHeader crumb="Reports" />
      <div className="p-8 max-w-6xl mx-auto space-y-8 animate-slide-up">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {stats.map((s) => (
            <div key={s.label} className="p-5 bg-card border border-border rounded-xl ring-1 ring-border">
              <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                {s.label}
              </p>
              <p className="text-2xl font-bold tracking-tight mt-2">{s.value}</p>
              <p className={`text-[10px] font-mono mt-1 ${s.tone === "accent" ? "text-accent" : "text-muted-foreground"}`}>
                {s.delta}
              </p>
            </div>
          ))}
        </div>

        <div className="bg-card border border-border rounded-2xl p-6 ring-1 ring-border">
          <h3 className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-6">
            Monthly FX Volume
          </h3>
          <div className="h-48 flex items-end gap-2">
            {[35, 52, 48, 63, 58, 72, 80, 76, 88, 92, 84, 96].map((h, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-2">
                <div
                  className="w-full rounded-t-sm bg-foreground/80 hover:bg-accent transition-colors"
                  style={{ height: `${h}%` }}
                />
                <span className="text-[9px] font-mono text-muted-foreground">{i + 1}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

