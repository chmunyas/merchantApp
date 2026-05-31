import { Plus } from "lucide-react";

export function TopHeader({ crumb }: { crumb: string }) {
  return (
    <header className="h-16 border-b border-border flex items-center justify-between px-8 bg-background/80 backdrop-blur-md sticky top-0 z-10">
      <div className="flex items-center gap-4">
        <h1 className="text-sm font-semibold text-muted-foreground">Treasury Overview</h1>
        <span className="text-border">/</span>
        <span className="text-sm font-medium">{crumb}</span>
      </div>
      <div className="flex items-center gap-4">
        <button className="px-3 py-1.5 bg-foreground text-background text-xs font-medium rounded-full inline-flex items-center gap-1.5 hover:opacity-90 transition-opacity">
          <Plus className="size-3.5" /> Add Funds
        </button>
        <div className="size-8 rounded-full bg-muted ring-1 ring-border" />
      </div>
    </header>
  );
}

